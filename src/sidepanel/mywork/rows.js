import { groupQueue, hasReply, isAtRisk, sharedCis } from '../../mywork/rank.js';
import { RISK_LIMITS, ticketsWithUnreadFacts, waitingOnYouDays, withRisk } from '../../mywork/risk.js';
import { spanText } from '../../mywork/time.js';
import { isolate, t, tn } from '../../i18n/index.js';

// The five rows of My work's first screen (round 5, board A, docs/round5.md), worked out from what the screen already reads (one READ,
// src/content/ops/mywork.js; the same tickets, SLAs and comment markers the queue shows). Nothing new is read. Pure: `now` goes in.
//
// A row says one finding in words and the number it stands for. A row with nothing to report says so calmly and still shows. A number
// that cannot be read honestly is `count: null` and the line says "could not be read": never a zero.
//
//   needs     SLA breached, and a customer (or someone else) who wrote and has had no answer for RISK_LIMITS.waitingDays days or more
//             (src/mywork/risk.js waitingOnYouDays: the "waiting on you" reason): the two are told apart on the line
//   risk      "At risk" (src/mywork/risk.js) without the tickets of the first row: close to breaching, reopened or handed on often,
//             an important customer
//   replied   the customer (or someone else) wrote after my last customer-visible comment, less than that long ago (the marker the
//             queue's "Customer replied" chip uses)
// A ticket is counted on the first of these three rows it fits, so the numbers never add up to more tickets than there are.
//   waiting   on hold, on the customer or on somebody else, and nobody has written since (the queue's "waiting" group)
//   cause     several of my tickets on one configuration item (src/mywork/rank.js sharedCis): maybe one cause

const live = (item) => item.work !== 'resolved';
const bySysId = (list) => [...new Map(list.map((i) => [i.sysId, i])).values()];

/** Which ticket types and states could the read not tell about: true when none of my live tickets has a readable comment history. */
function commentsUnread(items) {
  const list = items.filter(live);
  return list.length > 0 && !list.some((i) => i.marker?.known);
}

/** Why an at-risk ticket is on the row, as one of three kinds (the first that fits): sla, bounced, important. */
export function riskKind(item) {
  const ids = (item.atRisk || []).map((r) => r.id);
  if (ids.includes('sla')) return 'sla';
  if (ids.includes('reopened') || ids.includes('reassigned')) return 'bounced';
  return 'important';
}

const nonEmpty = (parts) => parts.filter(Boolean);

/**
 * @param {object} data the My work read (src/mywork/read.js)
 * @param {{ now: number, policy?: object }} options
 * @returns {{ unread: boolean, items: object[], open: number, capped: boolean, rows: Record<'needs'|'risk'|'replied'|'waiting'|'cause', { count: number|null, line: string, level: string, items: object[], clusters?: object[] }>, needing: number|null, unreadFacts: number }}
 */
export function myWorkRows(data, { now, policy } = {}) {
  const queue = data?.queue || {};
  const raw = Array.isArray(queue.items) ? queue.items : [];
  const items = withRisk(raw, { now, policy });
  const unread = items.length === 0 && (queue.empty === 'unread' || queue.empty === 'unseen');
  const liveItems = items.filter(live);
  const capped = Boolean(queue.more) || (Number.isFinite(queue.total) && queue.total > items.length);
  const open = liveItems.length;
  const blind = (line) => ({ count: null, line, level: '', items: [] });
  if (unread) {
    const line = t('Could not be read.');
    return { unread: true, items, open: 0, capped, rows: { needs: blind(line), risk: blind(line), replied: blind(line), waiting: blind(line), cause: blind(line) }, needing: null, unreadFacts: 0 };
  }

  const g = groupQueue(items, now);
  const noComments = commentsUnread(items);

  // ---- 1. needs you now
  const breached = liveItems.filter((i) => i.sla?.risk === 'breached');
  const breachedIds = new Set(breached.map((i) => i.sysId));
  const answered = liveItems.filter((i) => !breachedIds.has(i.sysId) && waitingOnYouDays(i, now) >= RISK_LIMITS.waitingDays);
  const answeredIds = new Set(answered.map((i) => i.sysId));
  const needsList = bySysId([...g.now, ...g.waiting].filter((i) => breachedIds.has(i.sysId) || answeredIds.has(i.sysId)));
  const needsIds = new Set(needsList.map((i) => i.sysId));
  const needsLine = nonEmpty([
    breached.length ? tn(breached.length, '{n} SLA breached', '{n} SLAs breached') : '',
    answered.length ? tn(answered.length, '{n} customer waiting for your answer', '{n} customers waiting for your answer') : '',
  ]).join(' · ');
  const needs = {
    count: needsList.length,
    line: needsLine ? (noComments ? `${needsLine} · ${t('customers waiting could not be checked')}` : needsLine) : noComments ? t('Nothing is breached. Customers waiting could not be checked.') : t('Nothing is breached and no customer is waiting.'),
    level: breached.length ? 'danger' : answered.length ? 'warn' : '',
    items: needsList,
  };

  // ---- 2. at risk today (the tickets of the first row are counted there)
  const risky = liveItems.filter((i) => isAtRisk(i) && !needsIds.has(i.sysId)).sort((a, b) => g.now.indexOf(a) - g.now.indexOf(b));
  const kinds = { sla: 0, bounced: 0, important: 0 };
  risky.forEach((i) => {
    kinds[riskKind(i)] += 1;
  });
  const unreadFacts = ticketsWithUnreadFacts(items);
  const riskLine = nonEmpty([
    kinds.sla ? tn(kinds.sla, '{n} close to breaching', '{n} close to breaching') : '',
    kinds.bounced ? tn(kinds.bounced, '{n} reopened or handed on often', '{n} reopened or handed on often') : '',
    kinds.important ? tn(kinds.important, '{n} for an important customer', '{n} for an important customer') : '',
  ]).join(', ');
  const risk = {
    count: risky.length,
    line: riskLine || (unreadFacts ? t('No ticket is at risk in what could be read.') : t('No ticket is at risk today.')),
    level: risky.length ? 'warn' : '',
    items: risky,
  };

  // ---- 3. replied to you (the ones that have waited for days are in the first row)
  const replied = liveItems.filter((i) => hasReply(i) && !needsIds.has(i.sysId));
  const fromCustomer = replied.filter((i) => i.marker.replied === 'customer').length;
  const fromOthers = replied.length - fromCustomer;
  const repliedList = g.now.filter((i) => replied.includes(i));
  const repliedLine = nonEmpty([
    fromCustomer ? tn(fromCustomer, '{n} customer wrote back after your last comment', '{n} customers wrote back after your last comment') : '',
    fromOthers ? tn(fromOthers, '{n} new comment from someone else', '{n} new comments from others') : '',
  ]).join(' · ');
  const repliedRow = {
    count: noComments ? null : replied.length,
    line: noComments ? t('Replies could not be read.') : repliedLine || t('No one has written back since your last comment.'),
    level: '',
    items: repliedList,
  };

  // ---- 4. waiting on others
  const waiting = g.waiting;
  const since = (i) => i.marker?.lastAt ?? i.updatedAt;
  const longest = waiting.map(since).filter((v) => Number.isFinite(v)).reduce((m, v) => Math.min(m, v), Infinity);
  const waitingRow = {
    count: waiting.length,
    line: waiting.length
      ? Number.isFinite(longest)
        ? tn(waiting.length, '{n} ticket, waiting longest {span}', '{n} tickets, waiting longest {span}', { span: spanText(now - longest) })
        : tn(waiting.length, '{n} ticket', '{n} tickets')
      : t('Nothing is waiting on others.'),
    level: '',
    items: waiting,
  };

  // ---- 5. same cause?
  const clusters = sharedCis(items);
  const top = clusters[0];
  const cause = {
    count: top ? top.count : 0,
    line: top ? t('{count} of your tickets are on {name}. One cause?', { count: top.count, name: isolate(t(top.name)) }) : t('None of your tickets are on the same item.'),
    level: top ? 'warn' : '',
    items: top ? liveItems.filter((i) => i.ci?.id === top.id) : [],
    clusters,
  };

  return { unread: false, items, open, capped, rows: { needs, risk, replied: repliedRow, waiting: waitingRow, cause }, needing: needs.count, unreadFacts };
}

/** The summary line under "My work": "6 open tickets. 2 need you first." Pure. */
export function myWorkSummary(model) {
  if (model.unread) return '';
  const n = model.open;
  const head = model.capped ? t('{n} or more open tickets.', { n }) : tn(n, '{n} open ticket.', '{n} open tickets.');
  if (!n) return t('Nothing is open for you.');
  const k = model.needing;
  return `${head} ${k ? tn(k, '{n} needs you first.', '{n} need you first.') : t('Nothing needs you first.')}`;
}
