// N9, risk signals without AI: what src/itsm/sentiment.js already counts (word lists, capital letters, chasers, reopen and
// reassignment counts, time waiting), the caller's VIP flag, the SLA, and a priority check (a VIP caller, high impact or an outage
// pattern on a low-priority ticket). Every signal says WHY in plain words. Pure.
//
// These are word and count rules, not a judgement: the card says so once. Words are named by OUR labels ("unacceptable",
// "fed up"), never quoted from the ticket.

import { computeSignals } from '../itsm/sentiment.js';
import { TIME, shortSpan } from './time.js';
import { customerWaiting } from './glance.js';
import { isolate, t, tn } from '../i18n/index.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
// Our own labels for the words the rules found (src/itsm/sentiment.js), in the person's language. (The labels the AI is given stay English.)
function wordLabel(word) {
  switch (word) {
    case 'frustrated':
      return t('frustrated');
    case 'annoyed':
      return t('annoyed');
    case 'ridiculous':
      return t('ridiculous');
    case 'unacceptable':
      return t('unacceptable');
    case 'terrible':
      return t('terrible');
    case 'useless':
      return t('useless');
    case 'fed up':
      return t('fed up');
    case 'angry':
      return t('angry');
    case 'disappointed':
      return t('disappointed');
    case 'worst':
      return t('worst');
    case 'waste of time':
      return t('waste of time');
    case 'shocking':
      return t('shocking');
    case 'poor service':
      return t('poor service');
    case 'nonsense':
      return t('nonsense');
    case 'escalate':
      return t('escalate');
    case 'manager or executive':
      return t('manager or executive');
    case 'complaint':
      return t('complaint');
    case 'legal':
      return t('legal');
    case 'cancel':
      return t('cancel');
    case 'refund':
      return t('refund');
    case 'urgent':
      return t('urgent');
    case 'asap':
      return t('asap');
    case 'immediately':
      return t('immediately');
    case 'critical':
      return t('critical');
    case 'emergency':
      return t('emergency');
    case 'deadline':
      return t('deadline');
    case 'right now':
      return t('right now');
    case 'cannot work':
      return t('cannot work');
    case 'production down':
      return t('production down');
    case 'blocked':
      return t('blocked');
    case 'again':
      return t('again');
    case 'still':
      return t('still');
    case 'nth time':
      return t('nth time');
    case 'every time':
      return t('every time');
    case 'once more':
      return t('once more');
    case 'already told':
      return t('already told');
    case 'same problem':
      return t('same problem');
    case 'many times':
      return t('many times');
    default:
      return word;
  }
}
const quoteList = (words) => words.slice(0, 4).map((w) => `"${wordLabel(w)}"`).join(t(', '));
const times = (n) => (n === 1 ? t('once') : n === 2 ? t('twice') : tn(n, '{n} time', '{n} times'));

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
  if (vip && priority >= 3) out.push(t('The caller is a VIP but the priority is {priority}.', { priority: isolate(label) }));
  const impact = levelOf(fields.impact);
  if (impact === 1 && priority >= 3) out.push(t('The impact is {impact} but the priority is {priority}.', { impact: isolate(text(fields.impact)), priority: isolate(label) }));
  if (outageCount >= 3 && priority >= 3) {
    out.push(
      tn(outageCount, '{n} other open ticket on the same item points to an outage, but the priority is {priority}.', '{n} other open tickets on the same item point to an outage, but the priority is {priority}.', { priority: isolate(label) })
    );
  }
  if (urgencyWords.length && priority >= 4) out.push(t('The customer calls it urgent ({words}) but the priority is {priority}.', { words: quoteList(urgencyWords), priority: isolate(label) }));
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

  if (vip) add('vip', 'medium', t('VIP caller'), t('The caller is marked VIP in ServiceNow.'));
  for (const [i, why] of priorityMismatch({ fields: pack?.fields, vip, outageCount, urgencyWords: s.urgencyWords }).entries()) {
    add(`priority-${i}`, 'high', t('Priority may be too low'), why);
  }
  if (s.slas && s.slas.breached) {
    const why =
      s.slas.total === 1
        ? t('{breached} of {total} SLA on this ticket is breached.', { breached: s.slas.breached, total: s.slas.total })
        : tn(s.slas.breached, '{n} of {total} SLAs on this ticket is breached.', '{n} of {total} SLAs on this ticket are breached.', { total: s.slas.total });
    add('sla', 'high', t('SLA breached'), why);
  }

  const wait = customerWaiting(pack || {}, now);
  if (wait.waiting && wait.sinceMs !== null && wait.sinceMs >= TIME.DAY) {
    const span = wait.approx ? tn(Math.round(wait.sinceMs / TIME.DAY), 'about {n} d', 'about {n} d') : shortSpan(wait.sinceMs);
    add('waiting', wait.sinceMs >= 2 * TIME.DAY ? 'high' : 'medium', t('Customer waiting'), t('The customer wrote last and has waited {span} for an answer.', { span }));
  }
  if (s.customerKnown && s.chasers >= 2) add('chasers', 'medium', t('Customer chasing'), t('The customer asked for news or wrote again without a reply {times}.', { times: times(s.chasers) }));
  if (s.escalationWords.length) add('escalation', 'high', t('Talk of escalation'), t("Words like {words} in the customer's messages.", { words: quoteList(s.escalationWords) }));
  if (s.frustrationWords.length) add('frustration', 'medium', t('Frustrated wording'), t("Words like {words} in the customer's messages.", { words: quoteList(s.frustrationWords) }));
  if (s.shoutingMessages) add('shouting', 'medium', t('Capital letters'), tn(s.shoutingMessages, '{n} message is written partly in capitals.', '{n} messages are written partly in capitals.'));
  if (s.repeatMessages) add('repeat', 'medium', t('Says it happened before'), tn(s.repeatMessages, 'Phrases like {words} in {n} message.', 'Phrases like {words} in {n} messages.', { words: quoteList(s.repeatPhrases) }));
  if (s.reopenCount) add('reopened', s.reopenCount >= 2 ? 'high' : 'medium', t('Reopened'), t('This ticket was reopened {times}.', { times: times(s.reopenCount) }));
  if (s.reassignmentCount !== null && s.reassignmentCount >= 3) add('reassigned', 'medium', t('Passed around'), t('It was reassigned {times}.', { times: times(s.reassignmentCount) }));
  if (s.urgencyWords.length && !signals.some((x) => x.id.startsWith('priority'))) add('urgency', 'low', t('Urgent wording'), t('Words like {words}.', { words: quoteList(s.urgencyWords) }));
  const openingWords = [...s.opening.frustrationWords, ...s.opening.escalationWords];
  if (openingWords.length && !s.frustrationWords.length && !s.escalationWords.length) add('opening', 'low', t('Strong words in the description'), t('Words like {words} in the title or description.', { words: quoteList(openingWords) }));

  const rank = { high: 0, medium: 1, low: 2 };
  signals.sort((a, b) => rank[a.level] - rank[b.level]);
  const high = signals.filter((x) => x.level === 'high').length;
  const medium = signals.filter((x) => x.level === 'medium').length;
  const attention = high ? 'danger' : medium >= 2 ? 'warn' : '';
  const titles = [...new Set(signals.map((x) => x.title))];
  const summary = titles.length ? `${titles.slice(0, 2).join(' · ')}${titles.length > 2 ? ` +${titles.length - 2}` : ''}` : t('No warning signs');
  return { signals, attention, summary, customerKnown: s.customerKnown, commentsRead: s.commentsRead };
}
