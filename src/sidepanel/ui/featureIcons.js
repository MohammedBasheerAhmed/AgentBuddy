// Which icon stands for an AI action or an Insights card (the ids of src/features/quick.js). Plain data, so the panel's logic and its tests
// can use it without drawing anything; the drawing is in icons.jsx.
const FEATURE_ICONS = {
  'record-summary': 'file',
  'reply-draft': 'reply',
  'resolution-notes': 'checkCircle',
  'handoff-brief': 'clipboard',
  'missing-info': 'help',
  'sentiment-risk': 'alert',
  'next-best-action': 'arrowRight',
  'thread-summary': 'message',
  'routing-hint': 'navigation',
  'kb-article-draft': 'filePlus',
  'major-incident-comms': 'flag',
  'problem-rca': 'search',
  'change-cab-brief': 'clipboard',
  'account-briefing': 'users',
  'caller-briefing': 'user',
  'case-eng-escalation': 'arrowUp',
  'hr-case-brief': 'clipboard',
  'article-optimise': 'pen',
  'chat-summary': 'message',
  'chat-reply': 'reply',
  'request-explain': 'help',
  'resolution-improve': 'pen',
  'fulfilment-checklist': 'clipboard',
  'email-ask-info': 'mail',
  'email-status-update': 'mail',
  'email-resolution': 'mail',
  'email-approval-nudge': 'mail',
  'email-apology': 'mail',
  'email-closure': 'mail',
  'card:ready': 'checkCircle',
  'card:related': 'link',
};

/** The icon name for a feature or card id; the AI spark for one this table does not know. */
export const featureIcon = (id) => FEATURE_ICONS[id] || 'spark';

// The icon of each Insights card of the Ticket screen (src/sidepanel/ticket/cards INSIGHT_CARDS, by card id): the side rail lists the
// cards by these, and Settings > Side rail shows them beside the names. tests/shell-rail.test.js checks every card has one.
const CARD_ICONS = {
  request: 'clipboard',
  checklist: 'check',
  article: 'file',
  chat: 'message',
  account: 'users',
  caller: 'user',
  missing: 'help',
  routing: 'navigation',
  steps: 'enter',
  related: 'link',
  knowledge: 'book',
  changes: 'refresh',
  knownErrors: 'alert',
  risk: 'flag',
  email: 'mail',
  journey: 'clock',
  resolve: 'checkCircle',
  outage: 'monitor',
};

/** The icon name for an Insights card id; a plain chevron for one this table does not know (never the AI spark: a card sends nothing). */
export const cardIcon = (id) => CARD_ICONS[id] || 'chevronRight';

// The icon of each of the five pain points (src/features/focus.js PAIN_POINTS): their rows in Insights and the side rail.
const PAIN_ICONS = { understand: 'eye', fix: 'tool', caller: 'user', reply: 'reply', close: 'checkCircle' };

/** The icon name for a pain point id. */
export const painIcon = (id) => PAIN_ICONS[id] || 'chevronRight';

// The icon of each screen of the panel (src/profiles/profiles.js SCREENS): the icon bar at the bottom of the panel shows these.
const SCREEN_ICONS = { ticket: 'ticket', mywork: 'inbox', team: 'users', write: 'pen', knowledge: 'book' };

/** The icon name for a screen id; a plain dot-less fallback (the AI spark) for one this table does not know. */
export const screenIcon = (id) => SCREEN_ICONS[id] || 'spark';
