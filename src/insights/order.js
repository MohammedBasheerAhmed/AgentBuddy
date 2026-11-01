// The order of the Ticket screen's Insights cards: what matters for the ticket's state comes first (TRACKER.md 2.4, "only what your
// work needs"). A New ticket wants missing details and routing; one In progress wants fixes; one waiting wants the right email; a
// resolved one wants "Ready to resolve?". Pure: the state is read from the header (display text, so any language of the state names
// that uses these words works; anything else falls back to the in-progress order).

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** 'new' | 'progress' | 'hold' | 'resolved' | 'closed' from a state's display text. */
export function stateBucket(state) {
  const s = text(state).toLowerCase();
  if (!s) return 'progress';
  if (/\b(closed|cancel+ed|complete[d]?|skipped|incomplete)\b/.test(s)) return 'closed';
  if (/\b(resolved|fulfil+ed|solved)\b/.test(s)) return 'resolved';
  if (/\b(on hold|hold|pending|awaiting|waiting)\b/.test(s)) return 'hold';
  if (/\b(new|open|draft|submitted|requested)\b/.test(s)) return 'new';
  return 'progress';
}

// Rank per card and bucket (lower is earlier). A card that is not listed for a bucket uses its `base`.
const RANKS = {
  outage: { base: 50, new: 40 }, // the Glance banner says it first when it matters
  request: { base: 8 },
  checklist: { base: 9 },
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
export function rankFor(id, header) {
  const r = RANKS[id] || { base: 100 };
  const bucket = stateBucket(header?.state);
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
export const openFor = (id, header) => (OPEN[stateBucket(header?.state)] || []).includes(id);
