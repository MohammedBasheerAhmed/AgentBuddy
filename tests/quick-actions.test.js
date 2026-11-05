import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featuresFor } from '../src/features/registry.js';
import { KINDS } from '../src/context/kinds.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { MAX_QUICK, QUICK_CARDS, QUICK_DEFAULTS, QUICK_LABELS, cleanPins, isQuickId, quickActions, quickCardItem, quickItems } from '../src/features/quick.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { cardIdsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';

// ---- the table and the registry stay in step --------------------------------------------------------------------

test('every kind has defaults, and every default is a real action of that kind (so the bar never offers a button that is not there)', () => {
  for (const kind of KINDS) {
    const ids = QUICK_DEFAULTS[kind];
    assert.ok(Array.isArray(ids) && ids.length > 0, `defaults for ${kind}`);
    assert.ok(ids.length <= MAX_QUICK, `${kind} has at most ${MAX_QUICK}`);
    const offered = featuresFor(kind, normalizePolicy({})).map((f) => f.id);
    for (const id of ids) assert.ok(offered.includes(id), `${kind}: ${id} is in the Actions list`);
  }
});

test('every labelled id is a real feature that the Actions list can offer (and none is off by default)', () => {
  for (const id of Object.keys(QUICK_LABELS)) {
    const feature = FEATURES.find((f) => f.id === id);
    assert.ok(feature, `${id} exists`);
    assert.ok(!feature.defaultOff, `${id} is not a default-off feature`);
    assert.ok((feature.kinds || []).length > 0, `${id} works on a record`);
    assert.ok(QUICK_LABELS[id].length <= 30, `${id}: a short label`);
  }
});

test('every Insights item opens a card the Insights half really has (audit P2.4: "card:ready" named a card "ready" that does not exist)', () => {
  const ids = INSIGHT_CARDS.map((c) => c.id);
  for (const [id, item] of Object.entries(QUICK_CARDS)) assert.ok(ids.includes(item.card), `${id}: no Insights card "${item.card}"`);
  // ...so the small bar on the ServiceNow page offers it (with AI off): a resolved incident puts "Ready to resolve?" first.
  const eff = effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'] }, {});
  const items = quickItems({ kind: 'incident', stage: 'resolve', cards: cardIdsFor({ kind: 'incident' }, null, eff), ai: false });
  assert.deepEqual(items.map((i) => [i.id, i.card]), [['card:ready', 'resolve'], ['card:related', 'related']]);
  assert.equal(quickCardItem('resolve'), 'card:ready');
  assert.equal(quickCardItem('related'), 'card:related');
  assert.equal(quickCardItem('ready'), '', 'there is no card "ready"');
  assert.equal(quickCardItem('journey'), '', 'a card without an item');
});

test('every feature in an Actions list has a short label, so it can be pinned', () => {
  const missing = new Set();
  for (const kind of KINDS) for (const f of featuresFor(kind, normalizePolicy({ coachingEnabled: true }))) if (!isQuickId(f.id)) missing.add(f.id);
  assert.deepEqual([...missing], [], 'add a label for these in src/features/quick.js');
});

// ---- choosing what the bar shows ----------------------------------------------------------------------------------

test('without pins the bar shows the defaults for the kind, with their short labels', () => {
  assert.deepEqual(quickActions({ kind: 'incident' }), [
    { id: 'record-summary', label: 'Summarise' },
    { id: 'reply-draft', label: 'Draft a reply' },
    { id: 'resolution-notes', label: 'Resolution notes' },
  ]);
  assert.deepEqual(quickActions({ kind: 'change' }).map((a) => a.id), ['record-summary', 'change-cab-brief', 'thread-summary']);
});

test('an unknown kind gets the plain defaults', () => {
  assert.deepEqual(quickActions({ kind: 'made-up' }).map((a) => a.id), QUICK_DEFAULTS.other);
  assert.deepEqual(quickActions({}).map((a) => a.id), QUICK_DEFAULTS.other);
});

test('pins replace the defaults for that kind only, in the order pinned', () => {
  const pins = { incident: ['handoff-brief', 'record-summary'] };
  assert.deepEqual(quickActions({ kind: 'incident', pins }).map((a) => a.id), ['handoff-brief', 'record-summary']);
  assert.deepEqual(quickActions({ kind: 'problem', pins }).map((a) => a.id), QUICK_DEFAULTS.problem);
});

test('cleanPins keeps known ids only, once each, and at most four', () => {
  assert.deepEqual(cleanPins({ incident: ['record-summary', 'nope', 'record-summary', 7, null, '__proto__', 'reply-draft'] }, 'incident'), ['record-summary', 'reply-draft']);
  const many = Object.keys(QUICK_LABELS);
  assert.equal(cleanPins({ incident: many }, 'incident').length, MAX_QUICK);
  for (const bad of [undefined, null, 'x', 5, [], { incident: 'record-summary' }, { incident: {} }]) assert.deepEqual(cleanPins(bad, 'incident'), []);
});

test('pins that are all junk fall back to the defaults', () => {
  assert.deepEqual(quickActions({ kind: 'incident', pins: { incident: ['nope', '<script>'] } }).map((a) => a.id), QUICK_DEFAULTS.incident);
});

// ---- the organisation's policy -------------------------------------------------------------------------------------

test('an action the policy switched off is not in the bar (any case, stray spaces)', () => {
  const policy = normalizePolicy({ disabledFeatures: [' Reply-Draft '] });
  assert.deepEqual(quickActions({ kind: 'incident', policy }).map((a) => a.id), ['record-summary', 'resolution-notes']);
  assert.deepEqual(quickActions({ kind: 'incident', pins: { incident: ['reply-draft', 'handoff-brief'] }, policy }).map((a) => a.id), ['handoff-brief']);
});

test('when the policy switches off every pin, the defaults (minus the policy) apply instead of an empty bar', () => {
  const policy = normalizePolicy({ disabledFeatures: ['handoff-brief'] });
  assert.deepEqual(quickActions({ kind: 'incident', pins: { incident: ['handoff-brief'] }, policy }).map((a) => a.id), QUICK_DEFAULTS.incident);
});

test('when the policy switches off everything, the bar is empty', () => {
  const policy = normalizePolicy({ disabledFeatures: Object.keys(QUICK_LABELS) });
  assert.deepEqual(quickActions({ kind: 'incident', policy }), []);
});
