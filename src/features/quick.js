// The few actions worth one click: the ones a fulfiller uses all day, offered in a bar (in the side panel and on the ServiceNow
// page) so they are not buried in the full list. This file is deliberately small: the service worker uses it too, and it must not
// pull the whole feature registry (prompts, context specs) into the worker.
//
// It only chooses ids. Whether an id is a real feature of the open record's kind is decided where the action runs, by the panel
// (featuresFor in registry.js), and tests/quick-actions.test.js keeps this table and the registry in step.
import { isFeatureEnabled } from '../policy/policy.js';

export const MAX_QUICK = 4;

// The bar in the side panel is a shortcut past a long list. Where the Actions list is only a few buttons (a chat, a knowledge article,
// a page we know nothing about) a bar would just repeat it, so the panel shows the bar from this many actions up. (The bar on the
// ServiceNow page is not affected: there it saves opening the panel.)
export const QUICK_MIN_LIST = 4;

/** Does the side panel show its bar for a record whose Actions list has this many actions? */
export const panelShowsBar = (actionCount) => actionCount >= QUICK_MIN_LIST;

// A short label for every feature that can be pinned. (The full titles in the Actions list are sentences; a bar needs a word or two.)
export const QUICK_LABELS = Object.freeze({
  'record-summary': 'Summarise',
  'reply-draft': 'Draft a reply',
  'resolution-notes': 'Resolution notes',
  'handoff-brief': 'Hand-off brief',
  'missing-info': 'What is missing?',
  'sentiment-risk': 'Sentiment and risk',
  'next-best-action': 'Next best action',
  'thread-summary': 'Summarise discussion',
  'routing-hint': 'Where should this go?',
  'kb-article-draft': 'Knowledge article',
  'major-incident-comms': 'Major incident update',
  'problem-rca': 'Problem statement and RCA',
  'change-cab-brief': 'CAB brief',
  'account-briefing': 'Brief me before the call',
  'case-eng-escalation': 'Engineering escalation',
  'hr-case-brief': 'HR case brief',
  'article-optimise': 'Improve this article',
  'chat-summary': 'Summarise chat',
  'chat-reply': 'Suggest replies',
});

// What the bar offers for a kind of record until the person pins their own.
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

/** True for an id that has a label here (so it can be pinned and shown in a bar). */
export const isQuickId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(QUICK_LABELS, id);

/** A person's pins for one kind, cleaned: known ids only, no repeats, at most MAX_QUICK. Anything else becomes []. */
export function cleanPins(pins, kind) {
  const list = Array.isArray(pins?.[kind]) ? pins[kind] : [];
  const out = [];
  for (const id of list) {
    if (isQuickId(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_QUICK) break;
  }
  return out;
}

/**
 * The actions the bar shows for a kind of record: the person's pins when they have any, else the defaults; minus whatever the
 * organisation's policy switched off. When every pin is switched off the defaults apply (still minus the policy).
 * @param {{ kind: string, pins?: object, policy?: object }} input
 * @returns {{ id: string, label: string }[]}
 */
export function quickActions({ kind, pins, policy } = {}) {
  const allowed = (ids) => ids.filter((id) => isQuickId(id) && isFeatureEnabled(id, policy));
  const own = allowed(cleanPins(pins, kind));
  const ids = own.length ? own : allowed(QUICK_DEFAULTS[kind] || QUICK_DEFAULTS.other);
  return ids.map((id) => ({ id, label: QUICK_LABELS[id] }));
}
