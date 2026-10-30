// Provider dispatch. The only way to reach a model is sendChat(), and sendChat() only accepts a request that was
// produced (and sealed) by the PII firewall. The model is never given tools: it can only return text.
import { apiOf, providerName } from './config.js';
import { sendOpenAI } from './openai.js';
import { sendAnthropic } from './anthropic.js';
import { assertSealed } from '../pii/seal.js';
import { assertWithinCaps, recordCall } from './budget.js';
import { AiError, DEFAULT_TIMEOUT_MS, LOCAL_TIMEOUT_MS } from './http.js';

// The sentence for an answer that stopped part-way (messages.js); the run pipeline shows it next to the answer.
export { truncationNote } from './messages.js';

/**
 * @param {object} config { provider, model, apiKey, baseUrl, keyOptional, local, azure?, promptCache } from resolveProviderConfig()
 * @param {object} sealed a SealedRequest from the firewall (src/pii)
 * @param {object} [options]
 *   host: instance host for the usage log; kind: 'chat' | 'validate'; skipBudget;
 *   signal: an AbortSignal that cancels the request (the person pressed Cancel);
 *   timeoutMs: the time limit (default 2 minutes, 5 for a model on this computer);
 *   fetchFn, sleep: for tests.
 * @returns {Promise<{content: string, stopReason: string, truncated: boolean, usage: object}>} `truncated`: the text was cut short
 *   (see truncationNote); the caller must say so next to the answer.
 */
export async function sendChat(config, sealed, { host = '', kind = 'chat', skipBudget = false, signal, timeoutMs, fetchFn, sleep } = {}) {
  // First line of defence: anything that did not come through the firewall is refused before it can leave the browser.
  assertSealed(sealed);
  // 'custom' is "my own server". With no address the OpenAI adapter would fall back to api.openai.com and send the key there.
  if (config.provider === 'custom' && !config.baseUrl) throw new AiError('Enter the address of your AI server in Settings first.', 'BAD_URL');
  // An address that did not pass the check (or an Azure set-up that is not complete) leaves baseUrl empty: never let that fall back
  // to the vendor's public API with this key.
  if (config.invalidBaseUrl) throw new AiError(`The AI address is not valid: ${config.invalidBaseUrl}`, 'BAD_URL');
  if (config.azure && !config.model) throw new AiError('Enter the name of your Azure deployment in Settings first.', 'NO_MODEL');
  // A spend cap that is reached refuses the call here too.
  if (!skipBudget) await assertWithinCaps(config.provider);
  if (signal?.aborted) throw new AiError('Cancelled. Nothing was sent.', 'CANCELLED');
  const limit = timeoutMs || (config.local ? LOCAL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const common = { apiKey: config.apiKey, model: config.model, messages: sealed.messages, baseUrl: config.baseUrl || '', name: providerName(config), signal, timeoutMs: limit, fetchFn, sleep };
  const started = Date.now();
  const reply =
    apiOf(config.provider) === 'openai'
      ? await sendOpenAI({ ...common, azure: config.azure || null, keyOptional: Boolean(config.keyOptional) })
      : await sendAnthropic({ ...common, effort: 'low', promptCache: config.promptCache !== false });
  await recordCall({ provider: config.provider, model: config.model, ms: Date.now() - started, usage: reply.usage, host, kind });
  return { ...reply, truncated: Boolean(reply.truncated) };
}
