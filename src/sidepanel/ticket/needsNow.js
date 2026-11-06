// What needs the agent now, as the first rows of "Understand the ticket", the first of the five rows of the Ticket screen's Insights
// half (docs/focus-layout.md; they used to be a block called "Needs you now" at the top of the screen). Plain sentences built only from
// what the screen already has, the most urgent first. No read of its own and no AI: the SLA, a customer waiting and a possible outage
// come from the Glance (the `glance` read every card shares, src/insights/glance.js buildGlance). The first of them is that row's one
// line, and they count for its dot (focusView.js). The Insights cards that need a look are not repeated here: their own rows say so.
//
// Round 4 (docs/round4.md): before them, two plain facts that need no look but answer "what is this ticket now?": what changed since
// the agent last opened it ("Since you last looked (yesterday 17:05)", src/insights/sinceLooked.js), whose line also leads the row's
// one line, and what the caller wrote last (the message itself, with "Translate" when it is in another script than the panel's).
// They carry no level: they do not colour the row's dot or count on the Insights tab.
// Pure: tests/ticket-needs-now.test.js, tests/understand-since.test.js.

import { waitingText } from '../../insights/glance.js';
import { shortSpan } from '../../insights/time.js';
import { t, tn } from '../../i18n/index.js';

const RANK = { danger: 0, warn: 1 };
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The SLA as one item, or null: breached (danger) or due within the hour (warn). `short`: the Glance's chip ("SLA 1h 20m"). */
function slaItem(sla) {
  if (!sla || typeof sla !== 'object') return null;
  const sub = text(sla.name);
  if (sla.kind === 'breached') {
    const late = Number.isFinite(sla.leftMs) && sla.leftMs < 0 ? shortSpan(-sla.leftMs) : '';
    const said = late ? t('The SLA was due {span} ago', { span: late }) : t('The SLA is breached');
    return { id: 'sla', level: 'danger', text: said, sub, short: text(sla.text) || said };
  }
  if (sla.kind === 'running' && sla.tone === 'warn' && Number.isFinite(sla.leftMs)) {
    const said = t('The SLA is due in {span}', { span: shortSpan(sla.leftMs) });
    return { id: 'sla', level: 'warn', text: said, sub, short: text(sla.text) || said };
  }
  return null;
}

/** A customer whose last message has no answer yet, as one item, or null. (buildGlance says nothing when it cannot tell.) */
function waitingItem(wait) {
  if (!wait?.waiting) return null;
  const sub = wait.messages > 0 ? tn(wait.messages, '{n} message without a reply', '{n} messages without a reply') : '';
  let line;
  if (!Number.isFinite(wait.sinceMs)) line = t('The customer is waiting for a reply');
  else if (wait.approx) line = t('The customer has waited about {span} for a reply', { span: shortSpan(wait.sinceMs) });
  else line = t('The customer has waited {span} for a reply', { span: shortSpan(wait.sinceMs) });
  return { id: 'waiting', level: 'warn', text: line, sub, short: waitingText(wait) || line };
}

/**
 * The facts of the Glance that need a look: the SLA, a customer waiting, a possible outage; the most urgent first (danger before
 * warn). Empty when nothing needs a look. A possible outage is said here only when the Outage spotter card is not among the cards
 * drawn in the list: that card says the same line from the same read (said once, never twice). Since the focus layout it is under
 * All tools, so the list never has it and the outage is said here.
 * Before them come the two plain facts when they are given (round 4): what changed since the agent last looked, and what the caller
 * wrote last. They have no level (they colour nothing and count nowhere).
 * @param {{
 *   glance: { sla?: object, waiting?: object, outage?: { line: string }|null }|null,   buildGlance's answer
 *   cards?: { id: string }[],   the Insights cards drawn in the list (the five rows' cards)
 *   since?: { text: string, sub: string, line: string }|null,   sinceLooked's answer (src/insights/sinceLooked.js); null: not said
 *   caller?: { heading: string, text: string, translate?: boolean }|null,   the caller's newest message (latestCallerMessage) and
 *     whether "Translate" is offered with it
 * }} input
 * @returns {{ id: 'since'|'caller'|'sla'|'waiting'|'outage', level: ''|'danger'|'warn', text: string, sub: string, short?: string,
 *   line?: string, message?: string, translate?: boolean }[]}
 *   short: the fact in a few words for the row's line after "Since you looked: ..." ("SLA 1h 20m"); line: the "since" fact's part
 *   of the row's line; message / translate: the caller's words as read, and whether "Translate" is offered
 */
export function needsNow({ glance = null, cards = [], since = null, caller = null } = {}) {
  const items = [slaItem(glance?.sla), waitingItem(glance?.waiting)].filter(Boolean);
  const outageCard = cards.some((c) => c?.id === 'outage');
  if (glance?.outage?.line && !outageCard) items.push({ id: 'outage', level: 'danger', text: t('Possible outage: {line}', { line: glance.outage.line }), sub: '', short: t('Possible outage') });
  const urgent = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => RANK[a.item.level] - RANK[b.item.level] || a.i - b.i)
    .map((x) => x.item);
  const plain = [];
  if (since && text(since.text)) plain.push({ id: 'since', level: '', text: text(since.text), sub: text(since.sub), line: text(since.line) });
  if (caller && text(caller.text)) plain.push({ id: 'caller', level: '', text: text(caller.heading) || t('The caller wrote'), sub: '', message: caller.text, translate: caller.translate === true });
  return [...plain, ...urgent];
}
