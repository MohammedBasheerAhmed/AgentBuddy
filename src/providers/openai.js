// OpenAI provider adapter. Keep this module the only place that knows about
// OpenAI's specific request/response shape; anthropic.js is its sibling.
import { OPENAI_MODEL, OPENAI_API_URL } from './config.js';
import { toOpenAIMessages, toOpenAITools, fromOpenAIResponse } from './messages.js';
import { chatCompletionsUrl, modelsUrl } from '../lib/aiUsage.js';

// Reasoning models reject a non-default temperature.
const FIXED_TEMPERATURE = /^(gpt-5|o\d)/i;

// The provider's own one-line reason from an error body ({"error":{"message":"..."}}), or ''.
function providerReason(text) {
  try {
    const data = JSON.parse(text);
    const message = data?.error?.message || data?.message;
    return typeof message === 'string' ? message.slice(0, 160) : '';
  } catch {
    return '';
  }
}

/**
 * GET <address>/models: what the server answers with when asked which models it offers (parsed in models.js). The request has no
 * body and carries only the key; nothing from a ticket can be in it. Throws a plain sentence the person can act on.
 * `baseUrl` is already validated; '' means OpenAI's own API.
 */
export async function fetchModelsBody({ apiKey, baseUrl = '', fetchFn = (...args) => fetch(...args) }) {
  const base = baseUrl || OPENAI_API_URL.replace(/\/chat\/completions$/, '');
  const host = new URL(base).host;
  let response;
  try {
    response = await fetchFn(modelsUrl(base), { method: 'GET', headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } });
  } catch {
    throw new Error(`Could not reach ${host}. Check your internet connection, VPN or proxy, and that the browser allowed access to this address.`);
  }
  if (response.status === 401 || response.status === 403) throw new Error(`${host} rejected the API key. Check it and try again.`);
  if (!response.ok) throw new Error(`${host} does not give a list of its models (answer ${response.status}). Type the model name instead.`);
  const body = await response.json().catch(() => null);
  return { host, body };
}

/** Neutral messages in, neutral { content, toolCalls, ... } out. */
// `baseUrl` (already validated by validateBaseUrl) points at any OpenAI-compatible server: <base>/chat/completions.
// `keyOptional` is for a server on this machine that needs no key.
export async function sendOpenAI({ apiKey, model = OPENAI_MODEL, messages, tools = [], baseUrl = '', keyOptional = false, name = '' }) {
  // `name` is the provider's own label (Gemini, DeepSeek...); a bare custom address is described by its host.
  const who = name || (baseUrl ? `The endpoint ${new URL(baseUrl).host}` : 'OpenAI');
  if (!apiKey && !keyOptional) {
    throw new Error(!baseUrl && !name ? 'Missing OpenAI API key. Configure it in the Agent Buddy settings.' : `Missing API key for ${who}. Configure it in the Agent Buddy settings.`);
  }

  const body = { model, messages: toOpenAIMessages(messages) };
  if (!FIXED_TEMPERATURE.test(model)) body.temperature = 0.2;
  if (tools.length) body.tools = toOpenAITools(tools);

  const label = who;
  let response;
  try {
    response = await fetch(baseUrl ? chatCompletionsUrl(baseUrl) : OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch only throws when nothing came back at all (offline, blocked by a firewall or VPN, no permission for the address).
    if (err?.name === 'AbortError') throw err;
    throw new Error(`Could not reach ${baseUrl ? new URL(baseUrl).host : 'api.openai.com'}. Check your internet connection, VPN or proxy, and that the browser allowed access to this address. Nothing was sent.`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    if (response.status === 401) throw new Error(`${label} rejected the API key. Check it in Agent Buddy settings.`);
    const reason = providerReason(errorBody);
    if (response.status === 402) throw new Error(`${label} says the account has no balance left${reason ? ` (${reason})` : ''}. Add credit on the provider's site, then try again.`);
    if (response.status === 429) throw new Error(`${label} is limiting requests${reason ? ` (${reason})` : ''}. Wait a minute and try again.`);
    throw new Error(`${label} request failed (${response.status}): ${errorBody.slice(0, 300)}`);
  }

  return fromOpenAIResponse(await response.json());
}
