// Where a ticket is in its life, and which AI actions fit there (TRACKER.md 3.5: "offered by ticket state first").
//
//   stageOf(record, header)    'new' | 'working' | 'resolve' | 'closed' | null (the state is not known, or not one we recognise)
//   GROUPS / groupOf(feature)  what the agent is doing: Understand, Reply, Work it, Resolve
//   SUGGEST[stage]             the actions worth offering first in that stage, best first
//   rules for `when`           small predicates the feature packs use (notClosed, notNew, isMajorIncident, ...)
//
// Pure and small, with no imports but the translation function (core.js, which carries no catalogue): the feature packs use it for
// their `when` rules and src/features/quick.js (which the service worker loads) uses its stage names, so it must not pull the
// registry in.
//
// The state comes from the panel's header read: the DISPLAY value of `state` ("In Progress", "Closed Complete"). Display values
// can be translated or renamed on an instance; a state we do not recognise is `null`, and null never hides an action (only the
// order of suggestions falls back to a neutral one). docs/live-questions/assist.md lists what to check on a real instance.

import { t } from '../i18n/core.js';
import { stageFor } from '../domain/states.js';

export const STAGES = Object.freeze(['new', 'working', 'resolve', 'closed']);

export const GROUPS = Object.freeze([
  // (the label is read when it is shown, so it follows the language of the panel)
  Object.freeze({ id: 'understand', get label() { return t('Understand'); } }),
  Object.freeze({ id: 'reply', get label() { return t('Reply'); } }),
  Object.freeze({ id: 'work', get label() { return t('Work it'); } }),
  Object.freeze({ id: 'resolve', get label() { return t('Resolve'); } }),
]);

const GROUP_IDS = GROUPS.map((g) => g.id);

// ---- state -> stage --------------------------------------------------------------------------------------------------------

const norm = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*-\s*/, '') // "7 - Closed" (a choice list that shows its value)
    .replace(/[_\s]+/g, ' ');

// The meaning of a state is read in ONE place, src/domain/states.js (docs/states.md): the stored value by table first, then the label's
// words in English, German and Arabic. This file only turns that meaning into the stage names the Ticket screen uses.

/** The stage of a ticket from the display text of its state alone; null when the state is empty or not one we recognise. */
export function stageOfState(state, table = '', value = '') {
  return stageFor({ table, value, label: state });
}

/**
 * The stage of the open ticket. `header` is the panel's header read ({ number, short_description, state, stateValue, priority }: the
 * state as shown and as stored); a record may carry its own `state` too. null while the header is loading or when the state is unknown.
 */
export function stageOf(record, header) {
  const fromHeader = header && typeof header.state === 'string' && header.state;
  return stageFor({
    table: record?.table || record?.kind || '',
    value: fromHeader ? header.stateValue : record?.stateValue,
    label: fromHeader ? header.state : record?.state,
    stage: header?.stage,
  });
}

// ---- feature -> group ------------------------------------------------------------------------------------------------------

// A feature may say its own `group`; these are the defaults for the features that do not (and a guard against a typo).
const DEFAULT_GROUP = {
  'record-summary': 'understand',
  'thread-summary': 'understand',
  'sentiment-risk': 'understand',
  'hr-case-brief': 'understand',
  'account-briefing': 'understand',
  'caller-briefing': 'understand',
  'reply-draft': 'reply',
  'missing-info': 'reply',
  'request-explain': 'reply',
  'chat-reply': 'reply',
  'next-best-action': 'work',
  'routing-hint': 'work',
  'handoff-brief': 'work',
  'case-eng-escalation': 'work',
  'major-incident-comms': 'work',
  'problem-rca': 'work',
  'change-cab-brief': 'work',
  'fulfilment-checklist': 'work',
  'article-optimise': 'work',
  'resolution-notes': 'resolve',
  'resolution-improve': 'resolve',
  'kb-article-draft': 'resolve',
  'chat-summary': 'resolve',
};

/** The group a feature belongs to: its own `group` when that is a known one, else the default above, else Understand. */
export function groupOf(feature) {
  const own = feature?.group;
  if (GROUP_IDS.includes(own)) return own;
  return DEFAULT_GROUP[feature?.id] || 'understand';
}

// ---- what to offer first ---------------------------------------------------------------------------------------------------

// Best first. Only the features a record really has (its kind, the person's profiles, the `when` rules) are taken from these, so
// a list can name features of several kinds: a problem in "new" gets its RCA, a case gets the account briefing, and so on.
// New: understand it and get it to the right place. Working: reply and move it on. Resolve: wrap up and keep the knowledge.
export const SUGGEST = Object.freeze({
  new: Object.freeze(['record-summary', 'hr-case-brief', 'account-briefing', 'major-incident-comms', 'change-cab-brief', 'problem-rca', 'missing-info', 'routing-hint', 'request-explain', 'fulfilment-checklist', 'chat-reply', 'article-optimise', 'sentiment-risk']),
  working: Object.freeze(['reply-draft', 'major-incident-comms', 'hr-case-brief', 'change-cab-brief', 'problem-rca', 'chat-reply', 'request-explain', 'fulfilment-checklist', 'next-best-action', 'record-summary', 'case-eng-escalation', 'handoff-brief', 'chat-summary', 'article-optimise']),
  resolve: Object.freeze(['prepare-close', 'resolution-notes', 'resolution-improve', 'kb-article-draft', 'chat-summary', 'record-summary', 'reply-draft']),
  closed: Object.freeze(['record-summary', 'kb-article-draft', 'chat-summary', 'thread-summary']),
  // The state is not known (still loading, or a state we do not recognise): the everyday three.
  unknown: Object.freeze(['record-summary', 'reply-draft', 'chat-reply', 'chat-summary', 'article-optimise', 'next-best-action', 'resolution-notes', 'hr-case-brief', 'change-cab-brief', 'problem-rca']),
});

/** How the suggestions are introduced, in a few words. */
export const STAGE_WORDS = Object.freeze({
  get new() { return t('Suggested for a new ticket'); },
  get working() { return t('Suggested while you work on it'); },
  get resolve() { return t('Suggested for wrapping up'); },
  get closed() { return t('Suggested for a closed ticket'); },
  get unknown() { return t('Suggested'); },
});

// ---- rules for a feature's `when(record, header)` --------------------------------------------------------------------------
// Every rule says yes while the state is unknown: an action is never hidden because a read was slow or a state was renamed.
// The one exception is isMajorIncident: there "not known" is "no" (an update for executives on an ordinary ticket is noise).

/** Not on a closed or cancelled ticket. */
export const notClosed = (record, header) => stageOf(record, header) !== 'closed';

/** Not on a ticket that has just come in (nothing has been done yet, so there is nothing to write up). */
export const notNew = (record, header) => stageOf(record, header) !== 'new';

/** While the ticket is open and being worked: not resolved, not closed. */
export const stillOpen = (record, header) => !['resolve', 'closed'].includes(stageOf(record, header));

// A problem and the tasks of a problem or a change are internal work: there is no customer to reply to.
const INTERNAL_TABLES = new Set(['problem', 'change_task', 'problem_task']);

/** A record with someone to reply to: not a problem, and not a task of a problem or a change. */
export const hasCustomer = (record) => record?.kind !== 'problem' && !INTERNAL_TABLES.has(String(record?.table || '').toLowerCase());

/** A ticket someone can still be written to about: open, and with a customer ("Draft a reply", "Ask for the missing details"). */
export const replyable = (record, header) => notClosed(record, header) && hasCustomer(record);

/**
 * A major incident: an incident whose major incident state (the Major Incident Management plugin) is proposed or accepted. When
 * the header does not carry that column (the plugin is not installed, or the read does not ask for it), priority 1 stands in.
 * A header that carries the column EMPTY is an incident that is not a major one, whatever its priority.
 */
export function isMajorIncident(record, header) {
  if (record?.kind !== 'incident' || !header || typeof header !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(header, 'major_incident_state')) {
    const mis = norm(header.major_incident_state);
    return mis === 'accepted' || mis === 'proposed';
  }
  const priority = String(header.priority ?? '').trim();
  return /^1(\b|\s|-)/.test(priority) || /^critical$/i.test(priority);
}

/** Run a feature's `when` safely: absent means always; a rule that throws counts as "yes" (a broken rule must not hide work). */
export function whenAllows(feature, record, header) {
  if (typeof feature?.when !== 'function') return true;
  try {
    return feature.when(record || {}, header || null) !== false;
  } catch {
    return true;
  }
}

/**
 * A short caution about where a feature's text lands on this record, or ''. A comment on a catalog task stays on the task: the
 * requester reads the requested item, not its tasks.
 */
export function cautionFor(feature, record) {
  const id = feature?.id;
  if (!['reply-draft', 'missing-info', 'request-explain'].includes(id)) return '';
  if (record?.kind === 'catalog_task') {
    if (record.requesterCanRead === true) return t('The requester can read comments on this task.');
    if (record.requesterCanRead === false) return t('The requester may not see this. Use the requested item to reach them.');
    return t('The requester may not see comments on a catalog task. Use the requested item to reach them.');
  }
  if (record?.kind === 'task') return t('The requester may not see comments on a task. Check who can see them.');
  return '';
}
