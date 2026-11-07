// One answer to "is this action offered on this ticket to this person?", for the panel, the bar on the ServiceNow page and the
// keyboard shortcuts (audit of 2026-11-07, W-08). Before, the bar chose from a table of defaults and pins and ignored the panel's
// rules, so it offered "Draft a reply" on a change task and a problem, and offered an HR action in a privacy mode that refuses every
// HR function. Now both ask featureShown() and modeBelow():
//
//   featureShown(feature, { record, header, eff, kind? })   its kind, the organisation's policy, the person's profiles and the state
//                                                           rules (`when`): exactly what the Ticket screen's list shows
//   modeNeeded(feature, table, policy) / modeBelow(eff, mode)  the privacy mode a record needs (Strict for HR and the other sensitive
//                                                           families: pipeline.js requiredMode says the same) and whether the person's is lower
//   barFeatureShown(id, { table, eff })                     the bar's question: the same, from the facts the worker has (the table; the
//                                                           state of the ticket is not known there)
//
// Light on purpose: the service worker loads this file and must not load the feature registry (prompts, context specs). The facts the
// bar needs about each action it can show are BAR_FEATURES below; tests/roles-visibility.test.js keeps them in step with the registry.
import { isFeatureEnabled, isSensitiveByPolicy } from '../policy/policy.js';
import { profilesOfFeature, shownFor, withProfiles } from '../profiles/profiles.js';
import { kindForTable } from '../context/kinds.js';
import { hasCustomer, replyable, whenAllows } from './stages.js';
import { ALL_TASKS, CLOSE_NOTES_KINDS, WORKABLE } from './packs/kinds.js';

const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };

/** The same test as registry.js isFeatureAvailable: not switched off by the organisation, and a default-off action only when allowed. */
export const featureAvailable = (feature, policy) => Boolean(feature) && isFeatureEnabled(feature.id, policy) && !(feature.defaultOff && policy?.coachingEnabled !== true);

/**
 * Is this action offered on this record? `feature` needs { id, kinds, when?, profiles? } (a registry feature, or a row of BAR_FEATURES).
 * @param {object} feature
 * @param {{ record?: object, header?: object|null, eff?: object, kind?: string, byProfile?: boolean }} context  the record ({ kind, table }),
 *   the header read (null when the state is not known: every state rule then says yes), the effective settings; byProfile: false leaves
 *   the person's work profiles out of it (only the bar does, see barFeatureShown)
 */
export function featureShown(feature, { record = null, header = null, eff = null, kind, byProfile = true } = {}) {
  const here = kind || record?.kind || 'other';
  return (
    featureAvailable(feature, eff?.policy) &&
    (feature.kinds || []).includes(here) &&
    (!byProfile || shownFor(profilesOfFeature(feature), eff)) &&
    whenAllows(feature, record, header)
  );
}

/** The privacy mode an action needs on a record of this table: its own minimum, or Strict on a sensitive (HR) table. '' when any will do. */
export function modeNeeded(feature, table, policy) {
  const own = feature?.requires?.minMode || '';
  const sensitive = table && isSensitiveByPolicy(table, policy) ? 'strict' : '';
  return (MODE_RANK[own] ?? -1) >= (MODE_RANK[sensitive] ?? -1) ? own : sensitive;
}

/** Is the person's privacy mode lower than `mode`? ('' needs nothing.) */
export const modeBelow = (eff, mode) => Boolean(mode) && (MODE_RANK[eff?.values?.piiMode] ?? 0) < (MODE_RANK[mode] ?? 0);

// ---- The bar ------------------------------------------------------------------------------------------------------------------------

const EMAIL_KINDS = ['incident', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case'];
const REQUEST_KINDS = ['request', 'requested_item', 'catalog_task'];

// The facts about each action the bar can show that decide whether it is offered. `when` is only the rule that depends on the TABLE
// (a problem and a change task have no customer to reply to); the rules that depend on the ticket's state are left out, because the
// bar does not know the state: the panel applies them when the action is opened. `major-incident-comms` is left unruled for the same
// reason (the panel says yes only for a major incident). Keep in step with src/features/packs/*.js: the test fails when they differ.
export const BAR_FEATURES = Object.freeze(
  Object.fromEntries(
    [
      { id: 'record-summary', kinds: ALL_TASKS },
      { id: 'reply-draft', kinds: WORKABLE, when: replyable },
      { id: 'resolution-notes', kinds: [...CLOSE_NOTES_KINDS] },
      { id: 'prepare-close', kinds: [...CLOSE_NOTES_KINDS] },
      { id: 'translate-message', kinds: WORKABLE, when: (record) => hasCustomer(record) },
      { id: 'handoff-brief', kinds: [...WORKABLE, 'change'] },
      { id: 'missing-info', kinds: WORKABLE, when: replyable },
      { id: 'sentiment-risk', kinds: ['incident', 'request', 'requested_item', 'case'] },
      { id: 'next-best-action', kinds: ['incident', 'case', 'requested_item', 'catalog_task', 'task'] },
      { id: 'thread-summary', kinds: ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'task', 'other'] },
      { id: 'routing-hint', kinds: ['incident', 'case'] },
      { id: 'kb-article-draft', kinds: ['incident', 'problem', 'case', 'requested_item', 'task'] },
      { id: 'major-incident-comms', kinds: ['incident'] },
      { id: 'problem-rca', kinds: ['problem'] },
      { id: 'change-cab-brief', kinds: ['change'] },
      { id: 'account-briefing', kinds: ['case'] },
      { id: 'caller-briefing', kinds: ['incident', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task', 'chat'] },
      { id: 'case-eng-escalation', kinds: ['case'] },
      { id: 'hr-case-brief', kinds: ['hr_case'], requires: { minMode: 'strict' } },
      { id: 'article-optimise', kinds: ['knowledge'] },
      { id: 'chat-summary', kinds: ['chat'] },
      { id: 'chat-reply', kinds: ['chat'] },
      { id: 'request-explain', kinds: REQUEST_KINDS },
      { id: 'resolution-improve', kinds: ['incident', 'change', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'] },
      { id: 'fulfilment-checklist', kinds: ['requested_item', 'catalog_task'] },
      { id: 'email-ask-info', kinds: EMAIL_KINDS },
      { id: 'email-status-update', kinds: EMAIL_KINDS },
      { id: 'email-resolution', kinds: EMAIL_KINDS },
      { id: 'email-approval-nudge', kinds: EMAIL_KINDS, when: (record) => REQUEST_KINDS.includes(record?.kind) },
      { id: 'email-apology', kinds: EMAIL_KINDS },
      { id: 'email-closure', kinds: EMAIL_KINDS },
    ].map((row) => [row.id, Object.freeze(row)])
  )
);

/**
 * May the bar (and a keyboard shortcut) offer this action on a ticket of this table? The panel's rules, from what the worker knows: the
 * table (so the kind, and whether there is a customer), the person's profiles and the organisation's policy, and the privacy mode
 * (an HR ticket needs Strict: a button that can only open a refusal is not offered). `eff` is effectiveSettings(settings, policy);
 * `kind` is the table's kind (worked out from the table when it is not given).
 */
export function barFeatureShown(id, { table = '', kind: given = '', eff = null } = {}) {
  const feature = BAR_FEATURES[id];
  if (!feature) return false;
  const kind = given || kindForTable(table);
  // The person's profiles decide only once the person has chosen them. Until then the panel works them out from the roles the page tells
  // it (profiles.js withProfiles), which the worker cannot see, and a guess here would hide an action the panel shows (a change
  // manager's CAB brief). A requested item or a catalog task always has the fulfilment tools, and a case the customer service tools.
  const chosen = eff?.values?.profilesConfirmed === true || (Array.isArray(eff?.values?.profiles) && eff.values.profiles.length > 0);
  if (!featureShown(feature, { record: { kind, table }, header: null, eff: withProfiles(eff, { kind }), kind, byProfile: chosen })) return false;
  return !modeBelow(eff, modeNeeded(feature, table, eff?.policy));
}

