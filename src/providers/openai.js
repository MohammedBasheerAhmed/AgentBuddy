// OpenAI-style adapter (Chat Completions): OpenAI itself, Azure OpenAI, company gateways, the presets (Gemini, Mistral, Groq,
// DeepSeek, OpenRouter), Ollama and any compatible server. Keep this module the only place that knows that request/response
// shape; anthropic.js is its sibling. Sending, time limits, retries and error wording are in http.js.
import { OPENAI_MODEL, OPENAI_API_URL } from './config.js';
import { toOpenAIMessages, toOpenAITools, fromOpenAIResponse } from './messages.js';
import { chatCompletionsUrl, modelsUrl, azureChatUrl } from '../lib/aiUsage.js';
import { AiError, requestJson, LIST_TIMEOUT_MS } from './http.js';
import { t, isolate } from '../i18n/index.js';

// The output limit sent where the server is known to accept it (OpenAI's own API and Azure OpenAI take max_completion_tokens; the
// older max_tokens is refused by their reasoning models). Other compatible servers keep their own default: some refuse a limit above
// their model's maximum (DeepSeek's chat model stops at 8192).
export const MAX_OUTPUT_TOKENS = 16000;

// Reasoning models refuse a temperature other than the default. A name can carry a vendor prefix (openai/gpt-5 on OpenRouter). An Azure
// deployment can have any name, so a refusal is also handled after the fact: the field is left out and the request sent again.
const FIXED_TEMPERATURE = /(^|\/)(gpt-5|o\d)/i;

// Fields this adapter adds on its own and can leave out when a server says it does not accept them.
const OPTIONAL_FIELDS = ['temperature', 'max_completion_tokens', 'max_tokens'];

/** Where a chat request goes and how the key is sent. `config` fields: baseUrl, azure, model. */
export function chatTarget({ baseUrl = '', azure = null, model = '' }) {
  if (azure) return { url: azureChatUrl(baseUrl, azure, model), keyHeader: 'api-key' };
  return { url: baseUrl ? chatCompletionsUrl(baseUrl) : OPENAI_API_URL, keyHeader: 'Authorization' };
}

const keyHeaders = (keyHeader, apiKey) => (!apiKey ? {} : keyHeader === 'api-key' ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` });
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return t('the AI address');
  }
};

/**
 * GET <address>/models: what the server answers with when asked which models it offers (parsed in models.js). The request has no
 * body and carries only the key; nothing from a ticket can be in it. Throws a plain sentence the person can act on.
 * `baseUrl` is already validated; '' means OpenAI's own API. Azure has no list a key can read (models.js says so before calling).
 */
export async function fetchModelsBody({ apiKey, baseUrl = '', fetchFn, signal, sleep }) {
  const base = baseUrl || OPENAI_API_URL.replace(/\/chat\/completions$/, '');
  const host = hostOf(base);
  try {
    const body = await requestJson({
      url: modelsUrl(base),
      init: { method: 'GET', headers: { Accept: 'application/json', ...keyHeaders('Authorization', apiKey) } },
      who: host,
      host,
      secrets: [apiKey],
      signal,
      timeoutMs: LIST_TIMEOUT_MS,
      fetchFn,
      sleep,
    });
    return { host, body };
  } catch (err) {
    if (err?.code === 'BAD_KEY' || err?.code === 'NO_ACCESS') throw new AiError(t('{host} rejected the API key. Check it and try again.', { host: isolate(host) }), err.code);
    if (err?.code === 'BAD_ANSWER') return { host, body: null }; // not JSON (a sign-in page): "answered, but with no models"
    if (err?.status && err.status !== 429 && err.status < 500) throw new AiError(t('{host} does not give a list of its models (answer {status}). Type the model name instead.', { host: isolate(host), status: err.status }), 'NO_LIST');
    throw err;
  }
}

/**
 * Neutral messages in, neutral { content, toolCalls, stopReason, truncated, usage } out.
 * `baseUrl` (already validated) points at any OpenAI-compatible server: <base>/chat/completions; for Azure (`azure` set) it is the
 * resource address and `model` the deployment. `keyOptional` is for a server on this machine that needs no key. `name` is the
 * provider's name for messages. `signal` cancels; `timeoutMs`, `fetchFn` and `sleep` are passed to http.js.
 */
export async function sendOpenAI({ apiKey, model = OPENAI_MODEL, messages, tools = [], baseUrl = '', azure = null, keyOptional = false, name = '', signal, timeoutMs, fetchFn, sleep }) {
  const who = name || (baseUrl ? t('The endpoint {host}', { host: isolate(hostOf(baseUrl)) }) : 'OpenAI');
  if (!apiKey && !keyOptional) {
    throw new AiError(!baseUrl && !name ? t('Missing OpenAI API key. Configure it in the Agent Buddy settings.') : t('Missing API key for {who}. Configure it in the Agent Buddy settings.', { who }), 'NO_KEY');
  }
  const wire = toOpenAIMessages(messages);
  const body = { model, messages: wire };
  if (!FIXED_TEMPERATURE.test(model)) body.temperature = 0.2;
  if (azure || !baseUrl) body.max_completion_tokens = MAX_OUTPUT_TOKENS;
  if (tools.length) body.tools = toOpenAITools(tools);

  const { url, keyHeader } = chatTarget({ baseUrl, azure, model });
  // The plain text that was sent, so an error that quotes it is not shown (http.js safeReason).
  const sent = wire.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  const dropped = new Set();
  for (;;) {
    try {
      const data = await requestJson({
        url,
        init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...keyHeaders(keyHeader, apiKey) }, body: JSON.stringify(body) },
        who,
        host: hostOf(url),
        secrets: [apiKey],
        sent,
        signal,
        timeoutMs,
        fetchFn,
        sleep,
        deploymentWord: azure ? 'deployment' : 'model',
      });
      return fromOpenAIResponse(data, who);
    } catch (err) {
      // "Unsupported parameter: 'temperature'" / "max_tokens is too large" / "Unrecognized request argument: max_completion_tokens":
      // leave that field out and send once more. Each field is dropped at most once, so this ends.
      const field = err?.status === 400 ? (err.params || []).find((p) => OPTIONAL_FIELDS.includes(p) && p in body && !dropped.has(p)) : null;
      if (!field) throw err;
      dropped.add(field);
      delete body[field];
    }
  }
}
