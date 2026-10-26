// The run pipeline for an AI feature, from ContextPack to text on screen:
//
//   policy checks -> firewall (mask + seal) -> [preview, person confirms] -> provider -> re-hydrate -> audit
//
// Dependencies are injected so the whole flow is unit-tested without a browser or network (tests/pipeline.test.js).
// The side panel passes the real firewall, sendChat and logAudit. Nothing here knows about React or chrome.*.

import { checkProviderAllowed, isFeatureEnabled, isTableAllowed } from '../policy/policy.js';
import { partsFor } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';

export class RunBlocked extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RunBlocked';
    this.code = code;
  }
}

const isHrTable = (table) => String(table || '').startsWith('sn_hr_');

/** Should the person see the exact outgoing text first? `seen` is the set of feature ids already confirmed once. */
export function previewRequired(previewMode, featureId, seen = []) {
  if (previewMode === 'never') return false;
  if (previewMode === 'always') return true;
  return !seen.includes(featureId);
}

/**
 * Everything that can be refused before a single byte is built. Throws RunBlocked with a message fit for the person.
 * @param {object} p { feature, pack, values (effective settings), policy, config (resolveProviderConfig), hasKey }
 */
export function assertRunnable({ feature, pack, values, policy, config, hasKey }) {
  if (!isFeatureEnabled(feature.id, policy)) throw new RunBlocked('Your organisation has switched this feature off.', 'FEATURE_OFF');
  if (!isTableAllowed(pack.table, policy)) throw new RunBlocked(`Your organisation does not allow Agent Buddy to use ${pack.table} records.`, 'TABLE_BLOCKED');
  if (isHrTable(pack.table) && !policy?.allowHrContent) {
    throw new RunBlocked('HR case content is not sent to an AI model unless your organisation allows it. Ask your administrator.', 'HR_BLOCKED');
  }
  if (config.invalidBaseUrl) throw new RunBlocked(`The AI address is not valid: ${config.invalidBaseUrl}`, 'BAD_URL');
  const allowed = checkProviderAllowed(config, policy);
  if (!allowed.ok) throw new RunBlocked(allowed.reason, 'PROVIDER_BLOCKED');
  if (values.piiMode === 'local-only' && !config.local) {
    throw new RunBlocked('Your privacy mode only allows an AI model running on this computer. Choose Ollama or another local server in Settings.', 'NOT_LOCAL');
  }
  if (!config.apiKey && !config.keyOptional) throw new RunBlocked('Add your AI key in Settings first.', 'NO_KEY');
  if (!config.model) throw new RunBlocked('Choose an AI model in Settings first.', 'NO_MODEL');
}

/**
 * Mask and seal the request for a feature. Returns what the preview shows; nothing has been sent yet.
 * @returns {{ request: object, firewall: object, preview: string, stats: object }}
 */
export function prepareRun({ feature, pack, values, policy, config, hasKey = true, createFirewall }) {
  assertRunnable({ feature, pack, values, policy, config, hasKey });
  const firewall = createFirewall({
    mode: values.piiMode,
    people: peopleFor(pack),
    blockedFields: policy?.blockedFields || [],
    endpointIsLocal: Boolean(config.local),
    // HR free text only gets here when the policy allowed it explicitly (assertRunnable).
    allowHrFreeText: isHrTable(pack.table) && Boolean(policy?.allowHrContent),
  });
  const request = firewall.buildRequest({
    feature: feature.id,
    table: pack.table,
    system: feature.system,
    userInstruction: feature.instruction,
    parts: partsFor(feature, pack),
  });
  return { request, firewall, preview: request.preview, stats: request.stats, feature, pack };
}

/**
 * Send a prepared (and, if required, confirmed) request. Always writes an audit entry, whatever happens.
 * @returns {{ text: string, usage: object }} text is re-hydrated: real names are back, locally only.
 */
export async function executeRun({ prepared, config, values, host = '', previewShown = false, sendChat, logAudit, now = () => Date.now() }) {
  const { request, firewall, feature, pack } = prepared;
  const started = now();
  const base = {
    feature: feature.id,
    table: pack.table,
    sysId: pack.sysId,
    provider: config.provider,
    model: config.model,
    host,
    mode: values.piiMode,
    preview: previewShown ? 'shown' : 'skipped',
    stats: request.stats,
  };
  try {
    const reply = await sendChat(config, request, { host });
    const text = firewall.rehydrate(reply.content || '');
    await logAudit({ ...base, usage: reply.usage, outcome: 'sent', ms: now() - started });
    return { text, usage: reply.usage || {} };
  } catch (err) {
    await logAudit({ ...base, outcome: 'error', reason: errorReason(err), ms: now() - started });
    throw err;
  }
}

/** Machine-readable reason for the audit log (never the message, which could echo content). */
export function errorReason(err) {
  if (err?.code && /^[A-Z_]{2,30}$/.test(err.code)) return err.code;
  if (/rejected the API key/i.test(String(err?.message))) return 'BAD_KEY';
  if (/rate limit/i.test(String(err?.message))) return 'RATE_LIMIT';
  if (/cap reached/i.test(String(err?.message))) return 'BUDGET';
  return 'PROVIDER_ERROR';
}

/** The person closed the preview without sending. */
export async function auditCancelled({ feature, pack, config, values, stats, logAudit }) {
  await logAudit({ feature: feature.id, table: pack.table, sysId: pack.sysId, provider: config.provider, model: config.model, mode: values.piiMode, preview: 'shown', stats, outcome: 'cancelled' });
}

/** A request the firewall or policy refused before sending. */
export async function auditBlocked({ feature, pack, config, values, err, logAudit }) {
  await logAudit({ feature: feature.id, table: pack?.table, sysId: pack?.sysId, provider: config?.provider, model: config?.model, mode: values?.piiMode, outcome: 'blocked', reason: errorReason(err) });
}
