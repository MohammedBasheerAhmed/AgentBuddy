// Anthropic (Claude) provider adapter, the sibling of openai.js. This is the
// only module that knows the Messages API wire format. Sending, time limits,
// retries and error wording are in http.js.
//
// Notes that matter on current Claude models (claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5):
//  - headers: x-api-key, anthropic-version, and (from a browser) anthropic-dangerous-direct-browser-access;
//  - max_tokens is required; 16000 is the usual ceiling for a request that is not streamed;
//  - sampling parameters (temperature, top_p) are rejected, so none are sent;
//  - thinking is adaptive by default and depth is set with output_config.effort ('low' here: summaries and drafts); an older model
//    behind a custom address may refuse effort, so it is left out and the request sent once more;
//  - stop_reason 'max_tokens' (or 'model_context_window_exceeded') means the text was cut short: the reply says `truncated`;
//    'refusal' is turned into a plain error (messages.js);
//  - no tools and no prompt caching: each request is a one-off (a different record every time), so caching the prefix would only
//    add write cost.
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION } from './config.js';
import { toAnthropicRequest, fromAnthropicResponse } from './messages.js';
import { anthropicMessagesUrl } from '../lib/aiUsage.js';
import { AiError, requestJson } from './http.js';
import { t, isolate } from '../i18n/index.js';

export const MAX_OUTPUT_TOKENS = 16000;

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return t('the AI address');
  }
};

// `baseUrl` is an optional Anthropic-compatible proxy (validated); blank = the real API. `name` is how messages name the provider;
// `signal` cancels.
export async function sendAnthropic({ apiKey, model, messages, maxTokens = MAX_OUTPUT_TOKENS, effort = 'medium', baseUrl = '', name = '', signal, timeoutMs, fetchFn, sleep }) {
  if (!apiKey) throw new AiError(t('Missing Anthropic API key. Add it in the Agent Buddy settings.'), 'NO_KEY');
  const url = baseUrl ? anthropicMessagesUrl(baseUrl) : ANTHROPIC_API_URL;
  const who = name || (baseUrl ? t('The endpoint {host}', { host: isolate(hostOf(baseUrl)) }) : 'Anthropic');

  const { system, messages: wire } = toAnthropicRequest(messages);
  let body = {
    model,
    max_tokens: maxTokens,
    messages: wire,
    output_config: { effort },
  };
  if (system) body.system = system;
  const sent = [system, ...wire.map((m) => (typeof m.content === 'string' ? m.content : ''))].join('\n');

  for (let effortDropped = false; ; ) {
    try {
      const data = await requestJson({
        url,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        },
        who,
        host: hostOf(url),
        secrets: [apiKey],
        sent,
        signal,
        timeoutMs,
        fetchFn,
        sleep,
      });
      return fromAnthropicResponse(data);
    } catch (err) {
      const aboutEffort = err?.status === 400 && (err.params || []).some((p) => p === 'effort' || p === 'output_config');
      if (!aboutEffort || effortDropped || !body.output_config) throw err;
      effortDropped = true;
      body = { ...body };
      delete body.output_config;
    }
  }
}
