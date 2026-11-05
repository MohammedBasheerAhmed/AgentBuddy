import test from 'node:test';
import assert from 'node:assert/strict';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { RAIL_CARDS, railCardsFor } from '../src/features/railCatalog.js';
import { cardIcon } from '../src/sidepanel/ui/featureIcons.js';
import { rankFor } from '../src/insights/order.js';
import { setLanguage } from '../src/i18n/index.js';
import { normalizePolicy } from '../src/policy/policy.js';

// Settings > Side rail lists the Insights cards from a light copy (src/features/railCatalog.js), so the Settings page does not carry the
// card components. The copy must stay exactly the cards of the Ticket screen: same ids in the same order, same titles, kinds and
// profiles. A card added, renamed or moved there and not here fails here.

const eff = (values = {}) => ({ values: { profiles: ['it'], ...values }, locked: {}, policy: normalizePolicy({}) });

test('the catalog is INSIGHT_CARDS exactly: ids in order, titles, kinds and profiles', () => {
  assert.deepEqual(RAIL_CARDS.map((c) => c.id), INSIGHT_CARDS.map((c) => c.id));
  for (const [i, card] of INSIGHT_CARDS.entries()) {
    const copy = RAIL_CARDS[i];
    assert.equal(copy.title, card.title, card.id);
    assert.deepEqual([...copy.kinds], [...card.kinds], `${card.id}: kinds`);
    assert.deepEqual([...copy.profiles], [...card.profiles], `${card.id}: profiles`);
    assert.equal(typeof card.when, 'undefined', `${card.id} says when it applies to a record: the catalog cannot know that, say so in Settings`);
  }
});

test('the titles follow the language, as the cards do', () => {
  try {
    setLanguage('ar');
    for (const [i, card] of INSIGHT_CARDS.entries()) {
      assert.equal(RAIL_CARDS[i].title, card.title, card.id);
      assert.ok(/[؀-ۿ]/.test(RAIL_CARDS[i].title), `${card.id}: ${RAIL_CARDS[i].title}`);
    }
  } finally {
    setLanguage('en');
  }
});

test('railCardsFor: the cards of the kind and the person\'s profiles, in the order a ticket being worked shows them; every one has an icon', () => {
  const ids = railCardsFor('incident', eff()).map((c) => c.id);
  const expected = INSIGHT_CARDS.filter((c) => c.kinds.includes('incident') && (c.profiles.includes('all') || c.profiles.includes('it'))).map((c) => c.id);
  assert.deepEqual([...ids].sort(), [...expected].sort());
  for (let i = 1; i < ids.length; i += 1) assert.ok(rankFor(ids[i - 1], null) <= rankFor(ids[i], null), `${ids[i - 1]} before ${ids[i]}`);
  assert.ok(!ids.includes('account'), 'a customer service card is not for an IT person');
  assert.ok(railCardsFor('case', eff({ profiles: ['csm'] })).some((c) => c.id === 'account'));
  assert.ok(railCardsFor('case', eff({ showEverything: true })).some((c) => c.id === 'account'), 'Show everything shows every card');
  assert.deepEqual(railCardsFor('nothing-like-this', eff()), []);
  for (const c of RAIL_CARDS) assert.notEqual(cardIcon(c.id), 'chevronRight', `${c.id} has its own icon`);
});
