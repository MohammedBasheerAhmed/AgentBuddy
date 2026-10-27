// The run pipeline for an AI feature, from ContextPack to text on screen:
//
//   policy checks -> firewall (mask + seal) -> [preview, person confirms] -> provider -> re-hydrate -> audit
//
// Dependencies are injected so the whole flow is unit-tested without a browser or network (tests/pipeline.test.js).
// The side panel passes the real firewall, sendChat and logAudit. Nothing here knows about React or chrome.*.

import { checkProviderAllowed, isFeatureEnabled, isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { partsFor, isFeatureAvailable } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';

// Privacy modes from least to most protective (see src/policy/policy.js).
const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const MODE_LABEL = { strict: 'Strict', 'local-only': 'Local-only' };

export class RunBlocked extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RunBlocked';
    this.code = code;
  }
}

/**
 * Is this record in a sensitive (HR-family) table under the policy? `sn_hr_` always counts, the policy's sensitiveTablePrefixes add
 * to it. A pack can also say so itself (`pack.sensitive`): the context engine sets it when a record was addressed by a base class
 * (`task`) and its real class could not be looked up, so it is treated as HR rather than guessed to be harmless.
 */
export const isSensitivePack = (pack, policy) => pack?.sensitive === true || isSensitiveByPolicy(pack?.table, policy);

/**
 * Should the person see the exact outgoing text first? `seen` is the set of feature ids already confirmed once.
 * `pack` is optional: a pack with `requirePreview === true` carries text about OTHER people's tickets or articles (look-alikes,
 * linked incidents, an account's other cases...), so even in "first" mode the person sees it every time, not only once per
 * feature. "never" is the organisation's or the person's explicit choice and is kept.
 */
export function previewRequired(previewMode, featureId, seen = [], pack = null) {
  if (previewMode === 'never') return false;
  if (previewMode === 'always') return true;
  if (pack?.requirePreview === true) return true;
  return !seen.includes(featureId);
}

/**
 * Why this provider setup cannot be used to reach an AI endpoint ('' when it can). Shared by every send, including the
 * Settings page's "Test connection", so no path can skip it.
 * 'custom' means "my own server": without an address the provider layer would fall back to OpenAI's own API and send the
 * person's key (and the masked ticket text) there.
 */
export function connectionProblem(config) {
  if (config.invalidBaseUrl) return `The AI address is not valid: ${config.invalidBaseUrl}`;
  if (config.provider === 'custom' && !config.baseUrl) return 'Enter the address of your AI server in Settings first.';
  return '';
}

/**
 * Everything that can be refused before a single byte is built. Throws RunBlocked with a message fit for the person.
 * @param {object} p { feature, pack, values (effective settings), policy, config (resolveProviderConfig), hasKey, pageTable }
 *   pageTable: the table of the form the person is on, when it can differ from the pack's table (Rewrite and Notes-to-ticket label
 *   their pack 'compose'). The blocked-table and HR rules apply to it as well as to `pack.table`.
 */
export function assertRunnable({ feature, pack, values, policy, config, hasKey, pageTable = '' }) {
  if (!isFeatureEnabled(feature.id, policy)) throw new RunBlocked('Your organisation has switched this feature off.', 'FEATURE_OFF');
  // A feature that stays off until the organisation turns it on (the coaching snapshot).
  if (!isFeatureAvailable(feature, policy)) throw new RunBlocked('Your organisation has not switched this feature on.', 'FEATURE_OFF');
  // A feature can ask for a stricter privacy mode than the person chose (the HR case brief needs Strict).
  const needed = feature.requires?.minMode;
  if (needed && (MODE_RANK[values.piiMode] ?? 0) < (MODE_RANK[needed] ?? 0)) {
    throw new RunBlocked(`This needs ${MODE_LABEL[needed] || needed} privacy mode. Change it in Settings.`, 'MODE_TOO_LOW');
  }
  const page = String(pageTable || '').trim();
  for (const table of [pack.table, page]) {
    if (table && !isTableAllowed(table, policy)) throw new RunBlocked(`Your organisation does not allow Agent Buddy to use ${table} records.`, 'TABLE_BLOCKED');
  }
  if (isSensitivePack(pack, policy) || (page && isSensitiveByPolicy(page, policy))) {
    if (!policy?.allowHrContent) {
      throw new RunBlocked('HR case content is not sent to an AI model unless your organisation allows it. Ask your administrator.', 'HR_BLOCKED');
    }
    // Allowing HR content is not enough on its own: the text may only go to an endpoint the organisation has approved, which means
    // the policy pins the AI provider or address, or the model runs on this computer.
    if (!(policy?.aiProvider || policy?.aiBaseUrl || config?.local)) {
      throw new RunBlocked(
        'HR case content can only be sent to an AI endpoint your organisation has approved. Ask your administrator to set the AI provider in the policy, or use a model that runs on this computer.',
        'HR_BLOCKED'
      );
    }
  }
  const problem = connectionProblem(config);
  if (problem) throw new RunBlocked(problem, 'BAD_URL');
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
export function prepareRun({ feature, pack, values, policy, config, hasKey = true, createFirewall, pageTable = '' }) {
  assertRunnable({ feature, pack, values, policy, config, hasKey, pageTable });
  const sensitive = isSensitivePack(pack, policy) || Boolean(pageTable && isSensitiveByPolicy(pageTable, policy));
  const firewall = createFirewall({
    mode: values.piiMode,
    people: peopleFor(pack),
    blockedFields: policy?.blockedFields || [],
    endpointIsLocal: Boolean(config.local),
    // HR free text only gets here when the policy allowed it explicitly (assertRunnable).
    allowHrFreeText: sensitive && Boolean(policy?.allowHrContent),
    sensitivePrefixes: policy?.sensitiveTablePrefixes || [],
    sensitiveRecord: sensitive,
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
export async function executeRun({ prepared, config, values, host = '', previewShown = false, sendChat, logAudit, now = () => Date.now(), policy = null, tokensUsedToday = null }) {
  const { request, firewall, feature, pack } = prepared;
  // The organisation's daily token budget (policy.tokenBudgetPerDay), checked before anything is sent. The person's own cap in
  // Settings is checked by the provider layer (src/providers/budget.js), so the smaller of the two always wins.
  await assertWithinPolicyBudget({ policy, tokensUsedToday, feature, pack, config, values, logAudit });
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
    // keepMasked: for text that will be published or shared (a knowledge article) the placeholders stay: real names never come back.
    const text = feature.keepMasked ? String(reply.content || '') : firewall.rehydrate(reply.content || '');
    await logAudit({ ...base, usage: reply.usage, outcome: 'sent', ms: now() - started });
    return { text, usage: reply.usage || {} };
  } catch (err) {
    await logAudit({ ...base, outcome: 'error', reason: errorReason(err), ms: now() - started });
    throw err;
  }
}

/**
 * Refuse the call when the policy's daily token budget is used up. `tokensUsedToday` is an injected `async () => number` (the
 * panel reads its usage log: src/lib/aiUsage.js tokensTodayReader). With no budget in the policy, or no reader, nothing is checked.
 * A storage problem reading the log does not stop the work: the same stance as the person's own caps, which "fail soft".
 */
export async function assertWithinPolicyBudget({ policy, tokensUsedToday, feature, pack, config, values, logAudit }) {
  const cap = Number(policy?.tokenBudgetPerDay) || 0;
  if (!(cap > 0) || typeof tokensUsedToday !== 'function') return;
  let used = 0;
  try {
    used = Number(await tokensUsedToday()) || 0;
  } catch {
    used = 0;
  }
  if (used < cap) return;
  const err = new RunBlocked(`Your organisation's daily limit of ${cap.toLocaleString('en-US')} AI tokens has been reached. It starts again tomorrow.`, 'BUDGET');
  await auditBlocked({ feature, pack, config, values, err, logAudit });
  throw err;
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
