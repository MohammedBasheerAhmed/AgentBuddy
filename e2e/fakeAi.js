// A fake AI endpoint for the end-to-end test: OpenAI-compatible POST /v1/chat/completions on http://localhost:<port>.
//
// It RECORDS every request body, so the test can assert that no raw personal data ever reached "the AI", and it answers
// deterministically by echoing the placeholders it was sent ("Hello [PERSON_1], ..."), so rehydration can be checked.
//
// Modes (fakeAi.setMode):
//   'echo'            (default) a short answer that mentions every placeholder it received
//   'markdown-image'  the answer also contains ![x](https://evil.example/?q=1), as a model that obeyed an injection would
//   'bad-key'         HTTP 401, as a provider rejecting the key
//   'error'           HTTP 500
const http = require('http');

const EXPECTED_KEY = 'sk-e2e-test-key-0001';
const PLACEHOLDER = /\[([A-Z_]{2,20})_(\d+)\]/g;

/** Distinct placeholders in the text, in order of first appearance, grouped by kind. */
function placeholdersIn(text) {
  const byKind = {};
  for (const m of String(text).matchAll(PLACEHOLDER)) {
    const list = (byKind[m[1]] ||= []);
    if (!list.includes(m[0])) list.push(m[0]);
  }
  return byKind;
}

function echoAnswer(userText) {
  const p = placeholdersIn(userText);
  const person = p.PERSON?.[0] || 'the caller';
  const mention = (kinds) => kinds.flatMap((k) => p[k] || []).join(', ') || 'nothing masked';
  return [
    `Issue: ${person} reports a recurring VPN problem.`,
    `Impact: One user. Contact on file: ${mention(['EMAIL', 'PHONE'])}.`,
    `Done so far: The notes also mention ${mention(['CARD', 'SECRET'])}.`,
    `Current state: Handled by ${p.PERSON?.[1] || 'the team'}.`,
    `Next step: Hello ${person}, please confirm your details.`,
  ].join('\n');
}

function startFakeAi() {
  const state = { mode: 'echo' };
  /** Every chat request received: { path, method, auth, body (parsed), raw, at } */
  const requests = [];
  /** Anything that was not a chat completion (should stay empty). */
  const other = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'OPTIONS') return send(204, {});
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        other.push({ method: req.method, path: req.url });
        return send(404, { error: { message: 'unknown route' } });
      }
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        /* recorded below with body null */
      }
      const auth = req.headers.authorization || '';
      requests.push({ method: req.method, path: req.url, auth, body, raw, at: Date.now() });

      if (state.mode === 'bad-key' || auth !== `Bearer ${EXPECTED_KEY}`) return send(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });
      if (state.mode === 'error') return send(500, { error: { message: 'The fake AI is having a bad day' } });

      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const userText = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
      let content = echoAnswer(userText);
      if (state.mode === 'markdown-image') {
        const person = placeholdersIn(userText).PERSON?.[0] || 'the caller';
        content = `Summary for ${person}.\n\n![x](https://evil.example/?q=1)\n\nSee [the report](https://evil.example/report?q=2) for more.`;
      }
      return send(200, {
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        model: body?.model || 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 4) },
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        port,
        baseUrl: `http://localhost:${port}/v1`,
        key: EXPECTED_KEY,
        requests,
        other,
        setMode: (mode) => {
          state.mode = mode;
        },
        /** Forget what was received (between scenarios). */
        reset: () => {
          requests.length = 0;
          other.length = 0;
          state.mode = 'echo';
        },
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}

module.exports = { startFakeAi, placeholdersIn, EXPECTED_KEY };
