// The order of the Ticket screen's Insights cards: what matters for the ticket's state comes first (TRACKER.md 2.4, "only what your
// work needs"). A New ticket wants missing details and routing; one In progress wants fixes; one waiting wants the right email; a
// resolved one wants "Ready to resolve?". Pure: what the state MEANS is read in one place (src/domain/states.js, docs/states.md): the
// stored value of the header's state by table first, then the words of its label in any of the languages it knows; a state it does not
// know falls back to the in-progress order.

import { bucketFor } from '../domain/states.js';

/**
 * 'new' | 'progress' | 'hold' | 'resolved' | 'closed' for a ticket.
 * @param {{ state?: string, stateValue?: string, stage?: string }|null} header the panel's header read (the state as shown and as stored)
 * @param {{ table?: string, kind?: string }|null} [record] the open record (the table decides how a stored value is read)
 */
export function stateBucket(header, record = null) {
  return bucketFor({ table: record?.table || record?.kind || '', value: header?.stateValue, label: header?.state, stage: header?.stage });
}

// Rank per card and bucket (lower is earlier). A card that is not listed for a bucket uses its `base`.
const RANKS = {
  outage: { base: 50, new: 40 }, // the Glance banner says it first when it matters
  request: { base: 8 },
  checklist: { base: 9 },
  fulfilled: { base: 12 }, // (right after the checklist: how the last ones went, before the look-alikes' fixes)
  chat: { base: 9 },
  article: { base: 9 },
  account: { base: 12 },
  missing: { base: 60, new: 10, hold: 30 },
  routing: { base: 70, new: 14 },
  related: { base: 20, new: 18 },
  steps: { base: 15, new: 22, resolved: 40 },
  knowledge: { base: 18, new: 24, resolved: 25 },
  changes: { base: 25, new: 26 },
  knownErrors: { base: 26, new: 27 },
  risk: { base: 30, new: 28, hold: 20 },
  email: { base: 40, hold: 10, resolved: 12, closed: 20 },
  journey: { base: 45, hold: 15, resolved: 30, closed: 15 },
  resolve: { base: 80, new: 95, resolved: 6, closed: 10 },
};

/** The rank of one card for a record and its header (the `order` function of a card entry). */
export function rankFor(id, header, record = null) {
  const r = RANKS[id] || { base: 100 };
  const bucket = stateBucket(header, record);
  return r[bucket] ?? r.base;
}

// Cards open on first view, per bucket: the two or three that answer the question of that moment. The rest show their summary line.
const OPEN = {
  new: ['missing', 'routing', 'request', 'checklist', 'chat', 'article'],
  progress: ['steps', 'request', 'checklist', 'chat', 'article'],
  hold: ['email', 'request', 'checklist', 'chat'],
  resolved: ['resolve', 'email', 'request', 'checklist'],
  closed: ['journey', 'request', 'article'],
};

/** Should this card start open for a record in this state? */
export const openFor = (id, header, record = null) => (OPEN[stateBucket(header, record)] || []).includes(id);
