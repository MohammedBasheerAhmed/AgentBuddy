// The shared reads of the Ticket screen's Insights half, as hooks. Every read goes to the content script (src/content/ops/insights.js
// and the existing reads), GET only, with the person's own session; the answers stay in panel memory (useInsight.js).
import { read } from '../../ask.js';
import { insightStore, recordKey, useInsight } from './useInsight.js';

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
  if (!answer?.pack) throw new Error('This ticket could not be read.');
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

const CALLER_ROLES = ['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'opened_by'];

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

/** The caller's earlier tickets (N2). { items, signals, access, callerName } ; no caller: { items: [], signals: null, noCaller: true } */
export function useHistory({ page, record, eff, active }) {
  return useInsight({
    key: `${recordKey(page, record)}|history`,
    load: async () => {
      const pack = await ticketPack(page, record, eff);
      const people = Array.isArray(pack.people) ? pack.people : [];
      const caller = CALLER_ROLES.map((role) => people.find((p) => p.role === role && p.sysId)).find(Boolean);
      if (!caller) return { items: [], signals: null, access: [], noCaller: true, callerName: '' };
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
