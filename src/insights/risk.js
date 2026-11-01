// N9, risk signals without AI: what src/itsm/sentiment.js already counts (word lists, capital letters, chasers, reopen and
// reassignment counts, time waiting), the caller's VIP flag, the SLA, and a priority check (a VIP caller, high impact or an outage
// pattern on a low-priority ticket). Every signal says WHY in plain words. Pure.
//
// These are word and count rules, not a judgement: the card says so once. Words are named by OUR labels ("unacceptable",
// "fed up"), never quoted from the ticket.

import { computeSignals } from '../itsm/sentiment.js';
import { TIME, shortSpan } from './time.js';
import { customerWaiting } from './glance.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const quoteList = (words) => words.slice(0, 4).map((w) => `"${w}"`).join(', ');
const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** The leading number of a choice like "4 - Low" (priority, impact, urgency); null when there is none. */
export function levelOf(value) {
  const m = /^\s*(\d)\b/.exec(text(value));
  return m ? Number(m[1]) : null;
}

/**
 * Is the priority lower than what the ticket shows? One entry per reason; [] when it looks fine or the priority is not known.
 * @param {{ fields: object, vip: boolean, outageCount: number, urgencyWords: string[] }} input
 */
export function priorityMismatch({ fields = {}, vip = false, outageCount = 0, urgencyWords = [] }) {
  const priority = levelOf(fields.priority);
  if (priority === null) return [];
  const label = text(fields.priority);
  const out = [];
  if (vip && priority >= 3) out.push(`The caller is a VIP but the priority is ${label}.`);
  const impact = levelOf(fields.impact);
  if (impact === 1 && priority >= 3) out.push(`The impact is ${text(fields.impact)} but the priority is ${label}.`);
  if (outageCount >= 3 && priority >= 3) out.push(`${outageCount} other open tickets on the same item point to an outage, but the priority is ${label}.`);
  if (urgencyWords.length && priority >= 4) out.push(`The customer calls it urgent (${quoteList(urgencyWords)}) but the priority is ${label}.`);
  return out;
}

/**
 * @param {{ pack: object, slas?: object[]|null, vip?: boolean, outageCount?: number, now: number }} input
 *   slas: the SLA rows of the `glance` read (null when they could not be read)
 * @returns {{ signals: { id: string, level: 'high'|'medium'|'low', title: string, why: string }[], attention: ''|'warn'|'danger',
 *   summary: string, customerKnown: boolean, commentsRead: number }}
 */
export function riskSignals({ pack, slas = null, vip = false, outageCount = 0, now }) {
  const withSlas = Array.isArray(slas) ? { ...pack, related: { ...(pack?.related || {}), slas: slas.map((s) => ({ ...s, breached: s.breached ? 'true' : 'false' })) } } : pack;
  const s = computeSignals(withSlas || {}, { now });
  const signals = [];
  const add = (id, level, title, why) => signals.push({ id, level, title, why });

  if (vip) add('vip', 'medium', 'VIP caller', 'The caller is marked VIP in ServiceNow.');
  for (const [i, why] of priorityMismatch({ fields: pack?.fields, vip, outageCount, urgencyWords: s.urgencyWords }).entries()) {
    add(`priority-${i}`, 'high', 'Priority may be too low', why);
  }
  if (s.slas && s.slas.breached) add('sla', 'high', 'SLA breached', `${s.slas.breached} of ${s.slas.total} SLA${s.slas.total === 1 ? '' : 's'} on this ticket ${s.slas.breached === 1 ? 'is' : 'are'} breached.`);

  const wait = customerWaiting(pack || {}, now);
  if (wait.waiting && wait.sinceMs !== null && wait.sinceMs >= TIME.DAY) {
    add('waiting', wait.sinceMs >= 2 * TIME.DAY ? 'high' : 'medium', 'Customer waiting', `The customer wrote last and has waited ${wait.approx ? `about ${Math.round(wait.sinceMs / TIME.DAY)} d` : shortSpan(wait.sinceMs)} for an answer.`);
  }
  if (s.customerKnown && s.chasers >= 2) add('chasers', 'medium', 'Customer chasing', `The customer asked for news or wrote again without a reply ${times(s.chasers)}.`);
  if (s.escalationWords.length) add('escalation', 'high', 'Talk of escalation', `Words like ${quoteList(s.escalationWords)} in the customer's messages.`);
  if (s.frustrationWords.length) add('frustration', 'medium', 'Frustrated wording', `Words like ${quoteList(s.frustrationWords)} in the customer's messages.`);
  if (s.shoutingMessages) add('shouting', 'medium', 'Capital letters', `${s.shoutingMessages} message${s.shoutingMessages === 1 ? ' is' : 's are'} written partly in capitals.`);
  if (s.repeatMessages) add('repeat', 'medium', 'Says it happened before', `Phrases like ${quoteList(s.repeatPhrases)} in ${s.repeatMessages} message${s.repeatMessages === 1 ? '' : 's'}.`);
  if (s.reopenCount) add('reopened', s.reopenCount >= 2 ? 'high' : 'medium', 'Reopened', `This ticket was reopened ${times(s.reopenCount)}.`);
  if (s.reassignmentCount !== null && s.reassignmentCount >= 3) add('reassigned', 'medium', 'Passed around', `It was reassigned ${times(s.reassignmentCount)}.`);
  if (s.urgencyWords.length && !signals.some((x) => x.id.startsWith('priority'))) add('urgency', 'low', 'Urgent wording', `Words like ${quoteList(s.urgencyWords)}.`);
  const openingWords = [...s.opening.frustrationWords, ...s.opening.escalationWords];
  if (openingWords.length && !s.frustrationWords.length && !s.escalationWords.length) add('opening', 'low', 'Strong words in the description', `Words like ${quoteList(openingWords)} in the title or description.`);

  const rank = { high: 0, medium: 1, low: 2 };
  signals.sort((a, b) => rank[a.level] - rank[b.level]);
  const high = signals.filter((x) => x.level === 'high').length;
  const medium = signals.filter((x) => x.level === 'medium').length;
  const attention = high ? 'danger' : medium >= 2 ? 'warn' : '';
  const titles = [...new Set(signals.map((x) => x.title))];
  const summary = titles.length ? `${titles.slice(0, 2).join(' · ')}${titles.length > 2 ? ` +${titles.length - 2}` : ''}` : 'No warning signs';
  return { signals, attention, summary, customerKnown: s.customerKnown, commentsRead: s.commentsRead };
}
