// Provider dispatch. The only way to reach a model is sendChat(), and sendChat() only accepts a request that was
// produced (and sealed) by the PII firewall. The model is never given tools: it can only return text.
import { PROVIDERS, apiOf } from './config.js';
import { sendOpenAI } from './openai.js';
import { sendAnthropic } from './anthropic.js';
import { assertSealed } from '../pii/seal.js';
import { assertWithinCaps, recordCall } from './budget.js';

/**
 * @param {object} config { provider, model, apiKey, baseUrl, keyOptional, promptCache } from resolveProviderConfig()
 * @param {object} sealed a SealedRequest from the firewall (src/pii)
 * @param {object} [options] { host?: instance host for the usage log, kind?: 'chat' | 'validate', skipBudget? }
 * @returns {Promise<{content: string, stopReason: string, usage: object}>}
 */
export async function sendChat(config, sealed, { host = '', kind = 'chat', skipBudget = false } = {}) {
  // First line of defence: anything that did not come through the firewall is refused before it can leave the browser.
  assertSealed(sealed);
  // A spend cap that is reached refuses the call here too.
  if (!skipBudget) await assertWithinCaps(config.provider);
  const started = Date.now();
  const reply =
    apiOf(config.provider) === 'openai'
      ? await sendOpenAI({ apiKey: config.apiKey, model: config.model, messages: sealed.messages, baseUrl: config.baseUrl || '', keyOptional: Boolean(config.keyOptional), name: PROVIDERS[config.provider]?.baseUrl ? PROVIDERS[config.provider].label : '' })
      : await sendAnthropic({ apiKey: config.apiKey, model: config.model, messages: sealed.messages, effort: 'low', baseUrl: config.baseUrl || '', promptCache: config.promptCache !== false });
  await recordCall({ provider: config.provider, model: config.model, ms: Date.now() - started, usage: reply.usage, host, kind });
  return reply;
}
