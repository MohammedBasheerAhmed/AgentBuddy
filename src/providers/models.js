// Which models a provider's server offers, so a person can pick one instead of typing it: GET <address>/models with their key
// (OpenAI-style servers, company gateways and most vendors answer this). No ticket text is in this request, only the key, and
// only to the address chat requests go to. The call itself is in openai.js (the one place that talks to these servers); this file
// reads the answer. Anthropic has a different list call and is not covered: its models are listed by hand. Azure OpenAI is not
// covered either: what the person picks there is a deployment name, and Azure gives a key no list of deployments (only the
// management API, which needs an Azure sign-in, does), so Settings asks for the names instead.
import { apiOf, PROVIDERS } from './config.js';
import { fetchModelsBody } from './openai.js';
import { t, isolate } from '../i18n/index.js';

export const MAX_MODELS = 500;
const ID_RE = /^[\w.:/@+-]{1,120}$/; // what a model id may look like (letters, digits, . : / @ + - _), whatever a server sends

/** The model ids in an answer to GET /models (OpenAI: { data: [{ id }] }; some servers send { models: [...] } or a bare list). */
export function parseModelIds(body) {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const ids = new Set();
  for (const item of list) {
    const raw = typeof item === 'string' ? item : item?.id ?? item?.name ?? item?.model;
    if (typeof raw !== 'string') continue;
    const id = raw.trim().replace(/^models\//, ''); // Gemini names them "models/gemini-..."
    if (ID_RE.test(id)) ids.add(id);
    if (ids.size >= MAX_MODELS) break;
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Can "Load models" ask this provider's server for a list? (Settings hides the button and explains when not.) */
export const canListModels = (provider) => apiOf(provider) === 'openai' && !PROVIDERS[provider]?.azure;

/**
 * Ask the server for its models. `config` is resolveProviderConfig()'s answer ({ provider, baseUrl, apiKey, keyOptional }).
 * Throws a plain message the person can act on; the typed model name always still works. `fetchFn` is for tests; `signal` cancels.
 */
export async function listModels(config, fetchFn, { signal, sleep } = {}) {
  if (PROVIDERS[config.provider]?.azure) throw new Error(t('Azure OpenAI does not give a key a list of your deployments. Type the deployment name instead.'));
  if (apiOf(config.provider) !== 'openai') throw new Error(t('This AI service has no list to load here. Pick one of the listed models or type its name.'));
  if (config.invalidBaseUrl) throw new Error(t('The AI address is not valid: {reason}', { reason: config.invalidBaseUrl }));
  if (config.provider === 'custom' && !config.baseUrl) throw new Error(t('Enter the address of your AI server in Settings first.'));
  if (!config.apiKey && !config.keyOptional) throw new Error(t('Enter your key first, then load the models.'));
  const { host, body } = await fetchModelsBody({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetchFn, signal, sleep });
  const ids = parseModelIds(body);
  if (!ids.length) throw new Error(t('{host} answered, but with no models. Type the model name instead.', { host: isolate(host) }));
  return ids;
}
