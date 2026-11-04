// "Test connection" and "Load models" on the Settings page. Both carry the person's key to the AI address (the test also sends one
// word, through the firewall like everything else), so they are refused for the same reasons as every run (src/lib/pipeline.js):
// AI switched off by the organisation, its provider, address and model rules, an address that cannot be used, and a privacy mode
// that only allows a model on this computer. Every refusal comes before the browser is asked for permission and before any request.
// The Settings page only shows the result; it builds no firewall and calls no provider itself.
//
// Dependencies can be injected, so this is unit-tested without a browser or network (tests/connection-check.test.js).
import { PROVIDERS, resolveProviderConfig } from '../providers/config.js';
import { sendChat, truncationNote } from '../providers/index.js';
import { listModels } from '../providers/models.js';
import { createFirewall } from '../pii/index.js';
import { ensureAiPermission } from './aiPermission.js';
import { checkProviderAllowed } from '../policy/policy.js';
import { aiOffProblem, connectionProblem, localOnlyProblem } from './pipeline.js';
import { t } from '../i18n/index.js';

const REAL = { sendChat, listModels, createFirewall, ensureAiPermission };

/**
 * Why Settings may not contact this set-up ('' when it may), in the order the pipeline asks: the organisation first, then the
 * address, then the privacy mode. `forList`: the model rule is left out, because the list is cut to the allowed models afterwards.
 */
export function connectionRefusal({ config, values, policy, forList = false }) {
  const off = aiOffProblem(policy);
  if (off) return off;
  const permitted = forList
    ? checkProviderAllowed({ provider: config.provider, baseUrl: config.baseUrl, model: '' }, { ...policy, allowedModels: null })
    : checkProviderAllowed(config, policy);
  if (!permitted.ok) return permitted.reason;
  return connectionProblem(config) || localOnlyProblem(values?.piiMode, config);
}

/**
 * "Test connection": ask the model for one word. `apiKey` is the key to test (one typed and not saved yet, or the saved one);
 * `timeoutMs` applies to a hosted provider (a model on this computer keeps its own longer limit).
 * Throws a plain message; returns { answer, note } (the first 40 characters of the answer, and what to say when it was cut short).
 */
export async function testConnection({ values, policy, apiKey = '', signal, timeoutMs, deps = {} }) {
  const use = { ...REAL, ...deps };
  const config = resolveProviderConfig(values, apiKey);
  const def = PROVIDERS[config.provider];
  const refusal = connectionRefusal({ config, values, policy });
  if (refusal) throw new Error(refusal);
  if (def.azure && !config.model) throw new Error(t('Enter the name of your Azure deployment first.'));
  if (!apiKey && !config.keyOptional) throw new Error(t('There is no {label} key yet. Paste it in the key box, press Save key, then test again.', { label: def.label }));
  // A hosted provider needs the browser's permission for its address first (asked from the click).
  await use.ensureAiPermission(config);
  // The test goes through the same firewall as everything else, in the person's privacy mode: there is no side door to the provider.
  const firewall = use.createFirewall({ mode: values.piiMode, people: [], blockedFields: [], endpointIsLocal: config.local });
  const request = firewall.buildRequest({ feature: 'connection-test', table: '', system: 'Reply with the single word OK.', userInstruction: 'ping', parts: [] });
  const reply = await use.sendChat(config, request, { kind: 'validate', skipBudget: true, signal, timeoutMs: config.local ? undefined : timeoutMs });
  return { answer: String(reply.content).slice(0, 40), note: reply.truncated ? truncationNote(reply) : '' };
}

/**
 * "Load models": the model ids the server offers, cut to the ones the organisation allows. Only the key goes out, to the address
 * chats go to. Throws a plain message.
 */
export async function loadModelList({ values, policy, apiKey = '', signal, deps = {} }) {
  const use = { ...REAL, ...deps };
  const config = resolveProviderConfig(values, apiKey);
  const refusal = connectionRefusal({ config, values, policy, forList: true });
  if (refusal) throw new Error(refusal);
  if (!config.apiKey && !config.keyOptional) throw new Error(t('There is no {label} key yet. Paste it in the key box, press Save key, then load the models.', { label: PROVIDERS[config.provider].label }));
  await use.ensureAiPermission(config);
  const ids = await use.listModels(config, undefined, { signal });
  const allowed = policy?.allowedModels;
  return allowed?.length ? ids.filter((id) => allowed.includes(id)) : ids;
}
