// The run pipeline for an AI feature, from ContextPack to text on screen:
//
//   policy checks -> parts (fitted to the model, with what is not available) -> firewall (mask + seal) -> [preview, person
//   confirms] -> provider -> re-hydrate -> audit
//
// Fitting (fitToModel, src/lib/tokens.js): every request is estimated before it is sent; when it would be longer than the model
// takes, the oldest notes are left out first and the request says so. A local server (Ollama) would otherwise cut the START of the
// prompt, the rules and the task, without a word. The system rules are never cut.
//
// Dependencies are injected so the whole flow is unit-tested without a browser or network (tests/pipeline.test.js).
// The side panel passes the real firewall, sendChat and logAudit. Nothing here knows about React or chrome.*.

import { checkProviderAllowed, isFeatureEnabled, isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { partsFor, isFeatureAvailable } from '../features/registry.js';
import { NOT_AVAILABLE_FIELD, isJournalPart, journalCut, madeWithout, notAvailablePart, peopleFor, unavailable } from '../features/parts.js';
import { NEVER_REHYDRATE, RULES_PREAMBLE, placesOf } from '../pii/firewall.js';
import { alignedLower } from '../pii/dictionary.js';
import { truncationNote } from '../providers/messages.js';
import { LOCAL_CONTEXT, estimateMessages, estimateParts, estimateTokens, fitParts, promptBudget } from './tokens.js';
import { t, tm, t as tr, getLanguage } from '../i18n/index.js';
import { answerLanguageRule } from '../prompts/rules.js';
import { withFormat } from '../formats/formats.js';

// A placeholder of a kind that is never put back (a password, a card, an IBAN, an ID number), as the tokenizer writes it.
const KEPT_PLACEHOLDER = new RegExp(`\\[(?:${NEVER_REHYDRATE.join('|')})_\\d{1,6}\\]`);
export const KEPT_NOTE = tm(
  'Passwords, card and ID numbers stay hidden in answers (shown as [SECRET_1], [CARD_1]...). Add the real value yourself only if it really belongs there.'
); // an English text: keptNote() shows it in the panel's language

/** The sentence shown above an answer that still carries a never-put-back placeholder; '' when it carries none. */
export const keptNote = (text) => (KEPT_PLACEHOLDER.test(String(text || '')) ? tr(KEPT_NOTE) : '');

// Privacy modes from least to most protective (see src/policy/policy.js).
const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const MODE_LABEL = { strict: tm('Strict'), 'local-only': tm('Local-only') };

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
 * The privacy mode a run needs, so a view can say "Needs Strict privacy mode" before the click: the feature's own minimum
 * (`requires.minMode`), and Strict on any record of a sensitive (HR) table, for every function (AI0.2). '' when any mode will do.
 * assertRunnable enforces the same rules.
 */
export function requiredMode(feature, pack, policy, pageTable = '') {
  const own = feature?.requires?.minMode || '';
  const hr = isSensitivePack(pack, policy) || (pageTable && isSensitiveByPolicy(pageTable, policy)) ? 'strict' : '';
  return (MODE_RANK[own] ?? -1) >= (MODE_RANK[hr] ?? -1) ? own : hr;
}

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
  if (config.invalidBaseUrl) return t('The AI address is not valid: {reason}', { reason: config.invalidBaseUrl });
  if (config.provider === 'custom' && !config.baseUrl) return t('Enter the address of your AI server in Settings first.');
  return '';
}

/**
 * '' unless the organisation switched AI off (`aiEnabled: false`); then the sentence that says so. Switching AI off is not only a
 * matter of hiding buttons: every send refuses, and so do the Settings page's "Test connection" and "Load models".
 */
export const aiOffProblem = (policy) => (policy?.aiEnabled === false ? t('Your organisation has switched AI Assist off.') : '');

/**
 * '' unless the privacy mode only allows a model on this computer and this endpoint is not one; then the sentence that says so.
 * One rule for every send and for both Settings actions (src/lib/connectionCheck.js), which carry the key and must not reach a
 * hosted provider either: checked before the browser is asked for permission to contact it.
 */
export const localOnlyProblem = (piiMode, config) =>
  piiMode === 'local-only' && !config?.local ? t('Your privacy mode only allows an AI model running on this computer. Choose Ollama or another local server in Settings.') : '';

/**
 * Everything that can be refused before a single byte is built. Throws RunBlocked with a message fit for the person.
 * @param {object} p { feature, pack, values (effective settings), policy, config (resolveProviderConfig), pageTable }
 *   pageTable: the table of the form the person is on, when it can differ from the pack's table (Rewrite and Notes-to-ticket label
 *   their pack 'compose'). The blocked-table and HR rules apply to it as well as to `pack.table`.
 */
export function assertRunnable({ feature, pack, values, policy, config, pageTable = '' }) {
  const off = aiOffProblem(policy);
  if (off) throw new RunBlocked(off, 'AI_OFF');
  if (!isFeatureEnabled(feature.id, policy)) throw new RunBlocked(t('Your organisation has switched this feature off.'), 'FEATURE_OFF');
  // A feature that stays off until the organisation turns it on (the coaching snapshot).
  if (!isFeatureAvailable(feature, policy)) throw new RunBlocked(t('Your organisation has not switched this feature on.'), 'FEATURE_OFF');
  // A feature can ask for a stricter privacy mode than the person chose (the HR case brief needs Strict).
  const needed = feature.requires?.minMode;
  if (needed && (MODE_RANK[values.piiMode] ?? 0) < (MODE_RANK[needed] ?? 0)) {
    throw new RunBlocked(t('This needs {mode} privacy mode. Change it in Settings.', { mode: tr(MODE_LABEL[needed] || needed) }), 'MODE_TOO_LOW');
  }
  const page = String(pageTable || '').trim();
  for (const table of [pack.table, page]) {
    if (table && !isTableAllowed(table, policy)) throw new RunBlocked(t('Your organisation does not allow Agent Buddy to use {table} records.', { table }), 'TABLE_BLOCKED');
  }
  if (isSensitivePack(pack, policy) || (page && isSensitiveByPolicy(page, policy))) {
    if (!policy?.allowHrContent) {
      throw new RunBlocked(t('HR case content is not sent to an AI model unless your organisation allows it. Ask your administrator.'), 'HR_BLOCKED');
    }
    // Allowing HR content is not enough on its own: the text may only go to an endpoint the organisation has approved, which means
    // the policy pins the AI provider or address, or the model runs on this computer.
    if (!(policy?.aiProvider || policy?.aiBaseUrl || config?.local)) {
      throw new RunBlocked(
        t('HR case content can only be sent to an AI endpoint your organisation has approved. Ask your administrator to set the AI provider in the policy, or use a model that runs on this computer.'),
        'HR_BLOCKED'
      );
    }
    // And every function on an HR record runs in Strict (or Local-only) privacy mode, not only the HR brief: Strict masks names with no
    // cue in front of them and refuses sensitive fields (src/pii/firewall.js). Keyed on the table (isSensitivePack), not on the record
    // kind, so an HR child table (sn_hr_core_case_payroll...) or a policy prefix is covered whatever kind it is mapped to.
    if ((MODE_RANK[values?.piiMode] ?? 0) < MODE_RANK.strict) {
      throw new RunBlocked(t('HR records need Strict privacy mode (or Local-only). Change the privacy mode in Settings, then try again.'), 'MODE_TOO_LOW');
    }
  }
  // The organisation's rules before the address: an AI address in the policy that is not valid (policy.aiBlocked) must say "ask
  // your administrator", not "The AI address is not valid", which sends the person to a field they cannot change.
  const allowed = checkProviderAllowed(config, policy);
  if (!allowed.ok) throw new RunBlocked(allowed.reason, 'PROVIDER_BLOCKED');
  const problem = connectionProblem(config);
  if (problem) throw new RunBlocked(problem, 'BAD_URL');
  const notLocal = localOnlyProblem(values.piiMode, config);
  if (notLocal) throw new RunBlocked(notLocal, 'NOT_LOCAL');
  if (!config.apiKey && !config.keyOptional) throw new RunBlocked(t('Add your AI key in Settings first.'), 'NO_KEY');
  if (!config.model) throw new RunBlocked(t('Choose an AI model in Settings first.'), 'NO_MODEL');
}

/**
 * Mask and seal the request for a feature. Returns what the preview shows; nothing has been sent yet.
 * `input` is what the firewall was given, kept in memory only so "Mask this too" can have the same firewall build it again.
 * @returns {{ request: object, firewall: object, preview: string, stats: object, input: object, feature: object, pack: object }}
 */
export function prepareRun({ feature: action, pack, values, policy, config, createFirewall, pageTable = '' }) {
  // R11: how this action writes its answer. The person's own format, or the organisation's (locked or standard), becomes the action's
  // system text here, before the size is counted and the preview is built; with none chosen the action is used as it is.
  const feature = withFormat(action, values?.formats, policy?.orgFormats);
  assertRunnable({ feature, pack, values, policy, config, pageTable });
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
  const budget = promptBudget(config);
  const built = partsFor(feature, pack);
  let fit = fitToModel({ feature, pack, parts: built, budget: budget.prompt, source: budget.source });
  // Settings > Language of AI answers: with "The language of the panel" one fixed sentence is added to the task; nothing from the ticket.
  const languageRule = answerLanguageRule(values.answerLanguage, getLanguage());
  const system = languageRule ? `${feature.system}
${languageRule}` : feature.system;
  const make = (parts) =>
    Object.freeze({ feature: feature.id, table: pack.table, system, userInstruction: feature.instruction, parts: Object.freeze(parts) });
  let input = make(fit.parts);
  let request = firewall.buildRequest(input);
  // The estimate made before masking is generous; this is the one that counts: the finished text, rules and wrappers included.
  // When it is still over, leave out more of the oldest notes and build again (a few rounds at most).
  let tokens = estimateMessages(request.messages);
  for (let round = 0; tokens > budget.prompt; round++) {
    let tighter = null;
    if (round < 3) {
      const target = fit.target - (tokens - budget.prompt) - 32;
      try {
        tighter = fitToModel({ feature, pack, parts: built, budget: target, source: budget.source });
      } catch (err) {
        // Even the newest note alone is over this lowered target, an internal number: the person is told the model's own budget,
        // and the size that request would have as the finished text counts it (the estimate, plus what the target was lowered by).
        if (err instanceof RunBlocked && err.code === 'TOO_LONG' && Number.isFinite(err.tokens)) throw tooLong(err.tokens + (budget.prompt - target), budget);
        throw err;
      }
    }
    if (!tighter || tighter.trimmed <= fit.trimmed) throw tooLong(tokens, budget);
    fit = tighter;
    input = make(fit.parts);
    request = firewall.buildRequest(input);
    tokens = estimateMessages(request.messages);
  }
  return {
    request,
    firewall,
    preview: request.preview,
    stats: request.stats,
    input,
    feature,
    pack,
    // What the answer was made without ({ what, why, status }, plain words): the panel shows "Made without: ..." next to the answer.
    madeWithout: fit.madeWithout,
    // About how big the request is, and what the model takes (numbers only).
    size: { tokens, window: budget.window, budget: budget.prompt, source: budget.source, notesLeftOut: fit.trimmed },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The size of a request: fit the model, say what is missing
// ---------------------------------------------------------------------------------------------------------------

// What the firewall adds to every system message, and the slack for the "Not available" part growing by a line once notes are cut.
const RULES_TOKENS = estimateTokens(RULES_PREAMBLE);
const NOT_AVAILABLE_SLACK = 40;

// `tokens` is kept on the error (a number only), so a caller that fitted to a lowered target can say it in the model's terms.
function tooLong(tokens, budget) {
  const head = t('This is too long for the chosen AI model, even with only the newest note: about {tokens} tokens, and the model reads about {budget}.', { tokens: tokens.toLocaleString('en-US'), budget: budget.prompt.toLocaleString('en-US') });
  // A model on this computer is always given the default context of a local server (src/lib/tokens.js), whichever model and however its
  // server is set up: another local model, or a server set up for more, changes nothing here. Only a model elsewhere reads more.
  const next = budget.source === 'local-default'
    ? t('For a model on this computer Agent Buddy always counts on {window} tokens, whatever its server is set up for. Only an AI model that is not on this computer, chosen in Settings, reads more.', { window: LOCAL_CONTEXT.toLocaleString('en-US') })
    : t('Choose a model that reads more in Settings.');
  // (whole sentences, joined by a space)
  const err = new RunBlocked(`${head} ${next}`, 'TOO_LONG');
  err.tokens = tokens;
  return err;
}

/**
 * The parts to send for a model that reads at most `budget` tokens: the oldest notes are left out first (never the fixed prompt, its
 * rules or the record's own columns), and one part says what was not available or was left out. Pure.
 * @returns {{ parts: object[], madeWithout: object[], trimmed: number, target: number }} `target`: the budget it fitted to
 */
export function fitToModel({ feature, pack, parts, budget, source = '' }) {
  // A feature's own "not available" part (the domain features add one) is replaced by the complete one built here.
  const own = (Array.isArray(parts) ? parts : []).filter((p) => p && p.field !== NOT_AVAILABLE_FIELD);
  const list = unavailable(pack);
  const depth = Number(feature?.journal) || 0;
  const notes = own.filter(isJournalPart);
  const sent = notes.length;
  const fields = new Set(notes.map((p) => p.field));
  const draft = notAvailablePart(list, journalCut(pack, { sent, depth, fields }));
  const fixed = RULES_TOKENS + estimateTokens(feature?.system) + estimateTokens(feature?.instruction) + 16 + (draft ? estimateParts([draft]) : 0) + NOT_AVAILABLE_SLACK;
  const fit = fitParts({ parts: own, fixed, budget, droppable: isJournalPart, keep: 1 });
  if (!fit.fits) throw tooLong(fit.tokens, { prompt: budget, source });
  const cut = journalCut(pack, { sent: sent - fit.dropped, depth, trimmed: fit.dropped, fields });
  const missing = notAvailablePart(list, cut);
  return { parts: missing ? [...fit.parts, missing] : fit.parts, madeWithout: madeWithout(list, cut), trimmed: fit.dropped, target: budget };
}

// ---------------------------------------------------------------------------------------------------------------
// "Mask this too": the person adds text to mask in the preview
// ---------------------------------------------------------------------------------------------------------------

const PLACEHOLDER_IN_TEXT = /[[(][A-Z]{2,12}_\d{1,6}[\])]/;
const MASK_MIN = 2;
const MASK_MAX = 200;

// How often `literal` occurs in `text`, ignoring case and the placeholders themselves ("masked" is not counted inside
// "[MASKED_1]"). `words`: only where it is written as a word of its own, which is where the firewall masks text masked by hand
// (placesOf in src/pii/firewall.js: "Ali" is not masked inside "quality"), so the count says what masking will do.
function occurrences(text, literal, words = false) {
  const hay = alignedLower(String(text).replace(/\[[A-Z]{2,12}_\d{1,6}\]/g, (p) => ' '.repeat(p.length)));
  return placesOf(hay, hay, alignedLower(literal), !words).length;
}

/**
 * Mask more text in a prepared run, before it is sent. The text is handed to the SAME firewall, which adds it to what it masks
 * (every occurrence, in every part, with a placeholder like the others) and builds and seals the request again: the request
 * is never edited outside the firewall, and masking can only be added, never taken away. The answer is rehydrated as usual.
 *
 * Returns `{ ok: true, masked, prepared }` with the new prepared run (its request, preview and stats replace the old ones; the
 * stats count the hand-masked places as MANUAL, which the audit log keeps as a number), or `{ ok: false, problem }` with the
 * old run unchanged. Problems: EMPTY, SHORT, LONG, PLACEHOLDER (the selection includes a placeholder), NOT_FOUND (not in what
 * will be sent), PART_OF_WORD (only inside longer words, which masking leaves alone), NOT_DATA (only in Agent Buddy's own fixed
 * wording), FAILED (the firewall refused; the old request stands).
 * @param {object} prepared from prepareRun (or an earlier maskMore)
 * @param {string} text what the person selected or typed
 */
export function maskMore(prepared, text) {
  const literal = typeof text === 'string' ? text.trim() : '';
  if (!literal) return { ok: false, problem: 'EMPTY' };
  if (literal.length > MASK_MAX) return { ok: false, problem: 'LONG' };
  if (literal.length < MASK_MIN || !/[\p{L}\p{N}]/u.test(literal)) return { ok: false, problem: 'SHORT' };
  if (PLACEHOLDER_IN_TEXT.test(literal)) return { ok: false, problem: 'PLACEHOLDER' };
  if (!prepared?.request || !prepared.firewall || !prepared.input) return { ok: false, problem: 'FAILED' };
  if (!occurrences(prepared.request.preview, literal)) return { ok: false, problem: 'NOT_FOUND' };
  const before = occurrences(prepared.request.preview, literal, true);
  if (!before) return { ok: false, problem: 'PART_OF_WORD' };
  let request;
  try {
    request = prepared.firewall.buildRequest({ ...prepared.input, mask: [literal] });
  } catch {
    return { ok: false, problem: 'FAILED' };
  }
  const masked = before - occurrences(request.preview, literal, true);
  if (masked <= 0) return { ok: false, problem: 'NOT_DATA' };
  return { ok: true, masked, prepared: { ...prepared, request, preview: request.preview, stats: request.stats, masks: (prepared.masks || 0) + 1 } };
}

/**
 * Send a prepared (and, if required, confirmed) request. Always writes an audit entry, whatever happens: 'sent', 'error' with the
 * provider's machine code (BAD_KEY, RATE_LIMIT, TIMEOUT...), or 'cancelled' when the person stopped it (`signal`, code CANCELLED).
 * @returns {{ text: string, usage: object, truncated: boolean, notice: string }} text is re-hydrated: real names are back, locally
 *   only. `notice` is what to tell the person when the answer was cut short ('' when it was not).
 */
export async function executeRun({ prepared, config, values, host = '', previewShown = false, sendChat, logAudit, now = () => Date.now(), policy = null, tokensUsedToday = null, signal }) {
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
    const reply = await sendChat(config, request, { host, signal });
    // keepMasked: for text that will be published or shared (a knowledge article) the placeholders stay: real names never come back.
    // Otherwise names, emails and phone numbers come back, but never a password, a card or an ID number (NEVER_REHYDRATE): a
    // model talked into repeating [SECRET_1] gets the placeholder, not the secret, into a draft that may be inserted.
    const text = feature.keepMasked ? String(reply.content || '') : firewall.rehydrate(reply.content || '', { keep: NEVER_REHYDRATE });
    await logAudit({ ...base, usage: reply.usage, outcome: 'sent', ms: now() - started });
    const notice = [truncationNote(reply), feature.keepMasked ? '' : keptNote(text)].filter(Boolean).join(' ');
    return { text, usage: reply.usage || {}, truncated: Boolean(reply.truncated), notice };
  } catch (err) {
    // A request the person stopped is not a failure of the provider.
    await logAudit({ ...base, outcome: err?.code === 'CANCELLED' ? 'cancelled' : 'error', reason: errorReason(err), ms: now() - started });
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
  const err = new RunBlocked(t("Your organisation's daily limit of {cap} AI tokens has been reached. It starts again tomorrow.", { cap: cap.toLocaleString('en-US') }), 'BUDGET');
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
