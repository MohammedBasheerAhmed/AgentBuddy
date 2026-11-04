// The few actions worth one click: the ones a fulfiller uses all day, offered in a bar (in the side panel and on the ServiceNow
// page) so they are not buried in the full list. This file is deliberately small: the service worker uses it too, and it must not
// pull the whole feature registry (prompts, context specs) into the worker.
//
// It only chooses ids. Whether an id is a real feature of the open record's kind is decided where the action runs, by the panel
// (featuresFor in registry.js), and tests/quick-actions.test.js keeps this table and the registry in step.
//
// Two kinds of item since round 3 (TRACKER.md F6):
//   AI items        a feature id ('record-summary'): runs the AI action (preview first, as everywhere)
//   Insights items  'card:<id>' ('card:ready'): opens that card of the Insights half; nothing is sent anywhere
// Two callers:
//   quickActions()  the worker, for the bar on the ServiceNow page: AI items only, { id, label } as before. It may pass `stage`.
//   quickItems()    the side panel: both kinds, marked, for the state the ticket is in, minus what this record does not offer.
import { isFeatureEnabled } from '../policy/policy.js';
import { t } from '../i18n/core.js';

export const MAX_QUICK = 4;

// A short label for every feature that can be pinned. (The full titles in the Actions list are sentences; a bar needs a word or two.)
// (Getters: the words are looked up when they are read, so they follow the language. This file imports core.js, not index.js: the
// service worker and the bar on the ServiceNow page use it and have no need of the whole Arabic catalogue; the panel registers it.)
export const QUICK_LABELS = Object.freeze({
  get 'record-summary'() {
    return t('Summarise');
  },
  get 'reply-draft'() {
    return t('Draft a reply');
  },
  get 'resolution-notes'() {
    return t('Resolution notes');
  },
  get 'handoff-brief'() {
    return t('Hand-off brief');
  },
  get 'missing-info'() {
    return t('What is missing?');
  },
  get 'sentiment-risk'() {
    return t('Sentiment and risk');
  },
  get 'next-best-action'() {
    return t('Next best action');
  },
  get 'thread-summary'() {
    return t('Summarise discussion');
  },
  get 'routing-hint'() {
    return t('Where should this go?');
  },
  get 'kb-article-draft'() {
    return t('Knowledge article');
  },
  get 'major-incident-comms'() {
    return t('Major incident update');
  },
  get 'problem-rca'() {
    return t('Problem statement and RCA');
  },
  get 'change-cab-brief'() {
    return t('CAB brief');
  },
  get 'account-briefing'() {
    return t('Brief me before the call');
  },
  get 'case-eng-escalation'() {
    return t('Engineering escalation');
  },
  get 'hr-case-brief'() {
    return t('HR case brief');
  },
  get 'article-optimise'() {
    return t('Improve this article');
  },
  get 'chat-summary'() {
    return t('Summarise chat');
  },
  get 'chat-reply'() {
    return t('Suggest replies');
  },
  get 'request-explain'() {
    return t('Status for the requester');
  },
  get 'resolution-improve'() {
    return t('Improve my notes');
  },
  get 'fulfilment-checklist'() {
    return t('Draft a checklist');
  },
  // The email drafts moved to the Ticket screen in round 3 (AI Assist, Reply), so they can be pinned too.
  get 'email-ask-info'() {
    return t('Email: ask for info');
  },
  get 'email-status-update'() {
    return t('Email: status update');
  },
  get 'email-resolution'() {
    return t('Email: resolved');
  },
  get 'email-approval-nudge'() {
    return t('Email: approval reminder');
  },
  get 'email-apology'() {
    return t('Email: sorry for the wait');
  },
  get 'email-closure'() {
    return t('Email: closed');
  },
});

// Insights items: a card of the Ticket screen's Insights half (src/sidepanel/ticket/cards/index.js INSIGHT_CARDS, by its id). The
// panel offers one only where that card exists for the record and the person's profiles. The item's id stays as it was ('card:ready'
// is in people's pins and in a request the bar on the page leaves); `card` is the id of the card it opens, and
// tests/quick-actions.test.js checks that every one is a real card.
export const QUICK_CARDS = Object.freeze({
  'card:ready': Object.freeze({
    card: 'resolve',
    get label() {
      return t('Ready to resolve?');
    },
  }),
  'card:related': Object.freeze({
    card: 'related',
    get label() {
      return t('Related tickets');
    },
  }),
});

// What the bar offers for a kind of record until the person pins their own, when the ticket's state is not known (the bar on the
// ServiceNow page does not read it).
export const QUICK_DEFAULTS = Object.freeze({
  incident: ['record-summary', 'reply-draft', 'resolution-notes'],
  problem: ['record-summary', 'reply-draft', 'problem-rca'],
  change: ['record-summary', 'change-cab-brief', 'thread-summary'],
  request: ['record-summary', 'reply-draft', 'missing-info'],
  requested_item: ['record-summary', 'reply-draft', 'resolution-notes'],
  catalog_task: ['record-summary', 'reply-draft', 'resolution-notes'],
  case: ['record-summary', 'reply-draft', 'resolution-notes'],
  hr_case: ['record-summary', 'reply-draft'],
  task: ['record-summary', 'reply-draft', 'resolution-notes'],
  knowledge: ['article-optimise'],
  chat: ['chat-summary', 'chat-reply'],
  other: ['record-summary', 'thread-summary'],
});

// When the state IS known (src/features/stages.js): what fits that stage, best first. Items a record does not offer are skipped and
// the next ones move up, so one list serves every kind; the kind's own defaults follow as a fallback.
export const QUICK_STAGE_DEFAULTS = Object.freeze({
  new: Object.freeze(['record-summary', 'missing-info', 'routing-hint', 'card:related']),
  working: Object.freeze(['reply-draft', 'record-summary', 'next-best-action', 'card:related']),
  resolve: Object.freeze(['card:ready', 'resolution-notes', 'kb-article-draft', 'reply-draft']),
  closed: Object.freeze(['record-summary', 'kb-article-draft', 'card:related']),
});

// The one action a kind is opened for comes first in every stage (a change is opened to brief the CAB).
const KIND_FIRST = Object.freeze({
  change: ['change-cab-brief'],
  problem: ['problem-rca'],
  hr_case: ['hr-case-brief'],
  case: [],
  knowledge: ['article-optimise'],
  chat: ['chat-reply', 'chat-summary'],
});

/** True for an AI id that has a label here (so it can be pinned and shown in a bar). */
export const isQuickId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(QUICK_LABELS, id);

/** True for an Insights item id ('card:ready'). */
export const isQuickCard = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(QUICK_CARDS, id);

/** The Insights item that opens this card ('resolve' -> 'card:ready'), or '' when none does. (Not `card:${id}`: see QUICK_CARDS.) */
export const quickCardItem = (card) => Object.keys(QUICK_CARDS).find((id) => QUICK_CARDS[id].card === card) || '';

const isKnown = (id) => isQuickId(id) || isQuickCard(id);

/** A person's pins for one kind, cleaned: known ids only (AI or Insights), no repeats, at most MAX_QUICK. Anything else becomes []. */
export function cleanPins(pins, kind) {
  const list = Array.isArray(pins?.[kind]) ? pins[kind] : [];
  const out = [];
  for (const id of list) {
    if (isKnown(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_QUICK) break;
  }
  return out;
}

const STAGES = new Set(Object.keys(QUICK_STAGE_DEFAULTS));

/**
 * The defaults for a kind of record: by its stage when that is known (the kind's own action first, then the stage's list, then the
 * kind's defaults), else the kind's defaults alone (exactly as before stages existed).
 * @param {string} kind
 * @param {string|null} [stage] 'new' | 'working' | 'resolve' | 'closed' (src/features/stages.js)
 * @returns {string[]} ids, best first, no repeats (more than MAX_QUICK: the caller drops what the record does not offer, then cuts)
 */
export function quickDefaults(kind, stage = null) {
  const base = QUICK_DEFAULTS[kind] || QUICK_DEFAULTS.other;
  if (!STAGES.has(stage)) return [...base];
  return [...new Set([...(KIND_FIRST[kind] || []), ...QUICK_STAGE_DEFAULTS[stage], ...base])];
}

/**
 * The AI actions the bar on the ServiceNow page shows for a kind of record: the person's pins when they have any, else the
 * defaults; minus whatever the organisation's policy switched off. When every pin is switched off the defaults apply (still minus
 * the policy). Insights items are never returned here (the page bar runs AI actions only).
 * @param {{ kind: string, pins?: object, policy?: object, stage?: string|null, aiOn?: boolean }} input
 *   stage: the ticket's stage when the caller knows it; aiOn: false when AI is switched off (by the organisation, or "Skip AI")
 * @returns {{ id: string, label: string }[]}
 */
export function quickActions({ kind, pins, policy, stage = null, aiOn = true } = {}) {
  if (aiOn === false) return [];
  const allowed = (ids) => ids.filter((id) => isQuickId(id) && isFeatureEnabled(id, policy));
  const own = allowed(cleanPins(pins, kind));
  // The page bar's suggestions stay three (its own pins may be four), with or without a stage.
  const ids = own.length ? own : allowed(quickDefaults(kind, stage)).slice(0, 3);
  return ids.map((id) => ({ id, label: QUICK_LABELS[id] }));
}

/**
 * The side panel's bar: AI and Insights items for the open record, each marked, at most MAX_QUICK.
 * @param {{
 *   kind: string, stage?: string|null, pins?: object, policy?: object,
 *   offered?: Iterable<string>,  the AI feature ids this record offers right now (kind, profiles, state rules, policy)
 *   cards?: Iterable<string>,    the Insights card ids this record shows ('resolve', 'related')
 *   ai?: boolean,                false: no AI items at all (AI switched off, skipped, or not set up yet)
 * }} input
 * @returns {{ id: string, label: string, ai: boolean, card?: string }[]}
 */
export function quickItems({ kind, stage = null, pins, policy, offered = [], cards = [], ai = true } = {}) {
  const features = new Set(offered);
  const shownCards = new Set(cards);
  const usable = (id) =>
    isQuickCard(id) ? shownCards.has(QUICK_CARDS[id].card) : ai && isQuickId(id) && features.has(id) && isFeatureEnabled(id, policy);
  const own = cleanPins(pins, kind).filter(usable);
  // Without pins: the defaults, then any other card the record shows when there is room (with AI off, the cards are all there is).
  const ids = (own.length ? own : [...new Set([...quickDefaults(kind, stage), ...Object.keys(QUICK_CARDS)])].filter(usable)).slice(0, MAX_QUICK);
  return ids.map((id) => (isQuickCard(id) ? { id, label: QUICK_CARDS[id].label, ai: false, card: QUICK_CARDS[id].card } : { id, label: QUICK_LABELS[id], ai: true }));
}
