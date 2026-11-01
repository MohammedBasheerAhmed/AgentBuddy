// The facts about a chat that need no AI: who took part, how many messages, how long the customer has been waiting, and what
// they said last. Pure: it reads a ContextPack of kind 'chat' (src/context/chat.js puts the messages in pack.journal).

import { parseSnTime } from '../context/util.js';
import { t, tn } from '../i18n/core.js'; // core, not index: the content script imports this file and has no need of the whole catalogue

const MINUTE = 60000;
const ENDED_STATE = /closed|complete|ended|resolved|abandon|cancel/i;

const minutesBetween = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, Math.round((to - from) / MINUTE)) : null);

/**
 * @param {object} pack ContextPack (kind 'chat')
 * @param {{ now?: number }} [options]
 * @returns {{
 *   count: number, byCustomer: number, byAgent: number, byBot: number, unclear: number, canTellSides: boolean,
 *   participants: { name: string, role: string, email: string }[],
 *   firstAt: string, lastAt: string, durationMinutes: number|null,
 *   firstResponseMinutes: number|null, ended: boolean, waitingMinutes: number|null,
 *   lastMessage: { when: string, by: string, side: string, text: string }|null,
 *   lastCustomer: { when: string, by: string, text: string }|null,
 * }}
 */
export function chatOverview(pack, { now = Date.now() } = {}) {
  const messages = (Array.isArray(pack?.journal) ? pack.journal : []).filter((m) => m && m.text);
  const side = (m) => m.side || '';
  const byCustomer = messages.filter((m) => side(m) === 'customer');
  const byAgent = messages.filter((m) => side(m) === 'agent');
  const byBot = messages.filter((m) => side(m) === 'bot');
  const unclear = messages.length - byCustomer.length - byAgent.length - byBot.length;

  const last = messages[messages.length - 1] || null;
  const lastCustomer = byCustomer[byCustomer.length - 1] || null;
  const firstCustomer = byCustomer[0] || null;
  const firstAgentAfter = firstCustomer ? byAgent.find((m) => parseSnTime(m.when) >= parseSnTime(firstCustomer.when)) : null;

  const closedAt = pack?.related?.times?.closed_at || '';
  const ended = Boolean(closedAt) || ENDED_STATE.test(String(pack?.fields?.state || ''));

  // Waiting: the customer spoke last and nobody has answered since. Not meaningful once the chat is over.
  const lastIsCustomer = last && side(last) === 'customer';
  const waitingMinutes = !ended && lastIsCustomer ? minutesBetween(parseSnTime(last.when), now) : null;

  const firstAt = messages[0]?.when || '';
  const lastAt = last?.when || '';
  const slim = (m) => (m ? { when: m.when || '', by: m.by || '', side: side(m), text: m.text } : null);

  return {
    count: messages.length,
    byCustomer: byCustomer.length,
    byAgent: byAgent.length,
    byBot: byBot.length,
    unclear,
    canTellSides: messages.length > 0 && byCustomer.length + byAgent.length > 0,
    participants: (Array.isArray(pack?.people) ? pack.people : [])
      .filter((p) => p && p.name)
      .map((p) => ({ name: p.name, role: p.role || '', email: p.email || '' })),
    firstAt,
    lastAt,
    durationMinutes: minutesBetween(parseSnTime(firstAt), parseSnTime(lastAt)),
    firstResponseMinutes: firstCustomer && firstAgentAfter ? minutesBetween(parseSnTime(firstCustomer.when), parseSnTime(firstAgentAfter.when)) : null,
    ended,
    waitingMinutes,
    lastMessage: slim(last),
    lastCustomer: lastCustomer ? { when: lastCustomer.when || '', by: lastCustomer.by || '', text: lastCustomer.text } : null,
  };
}

/** "3 minutes", "1 hour 5 minutes", "2 days" for a number of minutes. */
export function describeMinutes(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return t('less than a minute');
  if (minutes < 60) return tn(minutes, '{n} minute', '{n} minutes');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    const hoursText = tn(hours, '{n} hour', '{n} hours');
    return rest ? t('{hours} {minutes}', { hours: hoursText, minutes: tn(rest, '{n} minute', '{n} minutes') }) : hoursText;
  }
  return tn(Math.floor(hours / 24), '{n} day', '{n} days');
}
