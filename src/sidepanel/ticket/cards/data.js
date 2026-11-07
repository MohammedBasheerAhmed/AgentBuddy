// The shared reads of the Ticket screen's Insights half, as hooks. Every read goes to the content script (src/content/ops/insights.js
// and the existing reads), GET only, with the person's own session; the answers stay in panel memory (useInsight.js).
import { read } from '../../ask.js';
import { insightStore, recordKey, useInsight } from './useInsight.js';
import { callerOf } from '../../../domain/callerTickets.js';
import { t } from '../../../i18n/index.js';

export const allowSensitiveOf = (eff) => Boolean(eff?.policy?.allowHrContent);

const TICKET_AGE = 120000; // the ticket's facts: 2 minutes (the Glance reads again sooner, see Glance.jsx)
const LIST_AGE = 300000; // look-alikes, articles, history, changes: 5 minutes

/** The `glance` read: { pack, slas, vip, outage }. Shared by the Glance and most cards. */
export const ticketKey = (page, record) => `${recordKey(page, record)}|ticket`;
export const loadTicket = (page, record, eff) => () => read(page.tabId, 'glance', { table: record.table, sysId: record.sysId, allowSensitive: allowSensitiveOf(eff) });

export function useTicketFacts({ page, record, eff, active, maxAgeMs = TICKET_AGE }) {
  return useInsight({ key: ticketKey(page, record), load: loadTicket(page, record, eff), active, maxAgeMs });
}

// The ticket's facts first (from memory when they are there), then the read that needs them.
const ticketPack = async (page, record, eff) => {
  const answer = await insightStore.get(ticketKey(page, record), loadTicket(page, record, eff), { maxAgeMs: LIST_AGE });
  if (!answer?.pack) throw new Error(t('This ticket could not be read.'));
  return answer.pack;
};

const SEARCH_FIELDS = ['short_description', 'description', 'category', 'subcategory', 'cmdb_ci', 'business_service', 'cat_item', 'product'];

/** What a search needs of the ticket: its id, the few fields the keywords and the boosts come from, and the names to leave out. */
export function slimPack(pack) {
  const fields = {};
  for (const name of SEARCH_FIELDS) if (typeof pack?.fields?.[name] === 'string') fields[name] = pack.fields[name];
  const people = (Array.isArray(pack?.people) ? pack.people : []).map((p) => ({ role: p.role, name: p.name, firstName: p.firstName, lastName: p.lastName }));
  return { table: pack.table, sysId: pack.sysId, number: pack.number, fields, people };
}

/** Solved look-alikes with their group and category (N2, N10, N12). */
export function useLookalikes({ page, record, eff, active }) {
  return useInsight({
    key: `${recordKey(page, record)}|lookalikes`,
    load: async () => read(page.tabId, 'lookalikes', { pack: slimPack(await ticketPack(page, record, eff)), allowSensitive: allowSensitiveOf(eff) }),
    active,
    maxAgeMs: LIST_AGE,
  });
}

/** Published articles that match (N3, N12). */
export function useKnowledge({ page, record, eff, active }) {
  return useInsight({
    key: `${recordKey(page, record)}|knowledge`,
    load: async () => read(page.tabId, 'knowledge', { pack: slimPack(await ticketPack(page, record, eff)) }),
    active,
    maxAgeMs: LIST_AGE,
  });
}

// The columns a person can be the caller in (src/context/people.js PERSON_FIELDS, the roles of callerOf). One that did not come back with the
// ticket (pack.unreadable) is a caller we could not read, which is not a ticket with nobody named (R-09, R-14).
const CALLER_COLUMNS = ['caller_id', 'requested_for', 'contact', 'consumer', 'opened_for', 'subject_person', 'requested_by'];

/**
 * Did a column that holds the caller fail to come back with the ticket? ("Opened by" stands in only when the others name nobody, so
 * it does not count: a caller we could not read is not made up from whoever opened the ticket.)
 */
export const callerUnreadable = (pack) =>
  (Array.isArray(pack?.unreadable) ? pack.unreadable : []).some((name) => CALLER_COLUMNS.includes(name)) ||
  // a sensitive ticket (HR) is read without its identities unless the organisation allows it: its people are not "nobody"
  pack?.sensitive === true ||
  (Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.source === pack?.table && a?.status === 'skipped');

/**
 * The caller's earlier tickets ("Caller's other tickets"). { items, signals, access, callerName } ; no caller: { items: [], signals:
 * null, noCaller: true } (noCaller: 'unreadable' when a column that holds the caller could not be read). The caller is found as the caller briefing finds it (callerOf: the same roles in the same order, and an HR
 * case's employee under subject_person), so the card and the briefing always talk about the same person.
 */
export function useHistory({ page, record, eff, active }) {
  return useInsight({
    key: `${recordKey(page, record)}|history`,
    load: async () => {
      const pack = await ticketPack(page, record, eff);
      const people = Array.isArray(pack.people) ? pack.people : [];
      const who = callerOf(pack);
      const caller = who ? people.find((p) => p?.role === who.role && String(p.sysId || '').toLowerCase() === who.sysId) || { sysId: who.sysId } : null;
      // (the caller column could not be read: not "nobody", and not the person who happened to open the ticket)
      if (!caller || (who.role === 'opened_by' && callerUnreadable(pack))) return { items: [], signals: null, access: [], noCaller: callerUnreadable(pack) ? 'unreadable' : true, callerName: '' };
      const answer = await read(page.tabId, 'history', { callerSysId: caller.sysId, excludeSysId: pack.sysId, allowSensitive: allowSensitiveOf(eff) });
      return { ...answer, callerName: caller.name || '' };
    },
    active,
    maxAgeMs: LIST_AGE,
  });
}

/** Any other read keyed by op name ({ table, sysId } arguments): journey, ciChanges, knownErrors, chatOverview... */
export function useRecordRead({ page, record, eff, active, op, args = {}, maxAgeMs = LIST_AGE, refreshOnShow = false, name = op }) {
  return useInsight({
    key: `${recordKey(page, record)}|${name}`,
    load: () => read(page.tabId, op, { table: record.table, sysId: record.sysId, allowSensitive: allowSensitiveOf(eff), ...args }),
    active,
    maxAgeMs,
    refreshOnShow,
  });
}

export { read };
