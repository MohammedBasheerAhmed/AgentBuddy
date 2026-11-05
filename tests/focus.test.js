import test from 'node:test';
import assert from 'node:assert/strict';
import { PAIN_IDS, PAIN_POINTS, focusActions, focusCards, painOfCard } from '../src/features/focus.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { FEATURES } from '../src/features/registry.js';
import { painIcon } from '../src/sidepanel/ui/featureIcons.js';
import { setLanguage } from '../src/i18n/index.js';

// The five pain points of the focus layout (docs/focus-layout.md): the table every tab of the Ticket screen is drawn from, and the two
// ways it sorts a record's cards and actions into "the five" and "the rest". Pure; the screen and All tools rely on it.

const card = (id) => ({ id, title: id });
const item = (id, reason = '') => ({ feature: { id, title: id }, reason, caution: '' });

test('the five, in the order the agent chose them, each with a name, cards, actions and an icon', () => {
  assert.deepEqual(PAIN_IDS, ['understand', 'fix', 'caller', 'reply', 'close']);
  assert.deepEqual(
    PAIN_POINTS.map((p) => p.title),
    ['Understand the ticket', 'Find the fix', 'Same caller', 'Reply', 'Close well']
  );
  for (const p of PAIN_POINTS) {
    assert.ok(p.cards.length > 0 && p.actions.length > 0, p.id);
    assert.notEqual(painIcon(p.id), 'chevronRight', `${p.id} has its own icon`);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.cards) && Object.isFrozen(p.actions), `${p.id} cannot be changed by accident`);
  }
  assert.ok(Object.isFrozen(PAIN_POINTS));
});

test('every card and action the table names is real, and none is in two pain points', () => {
  const cardIds = new Set(INSIGHT_CARDS.map((c) => c.id));
  const featureIds = new Set(FEATURES.map((f) => f.id));
  const cards = PAIN_POINTS.flatMap((p) => p.cards);
  const actions = PAIN_POINTS.flatMap((p) => p.actions);
  for (const id of cards) assert.ok(cardIds.has(id), `card ${id} is an Insights card`);
  // (caller-briefing comes with part B of the focus layout: until it is in the registry, the slot falls to the account briefing)
  for (const id of actions) assert.ok(featureIds.has(id) || id === 'caller-briefing', `action ${id} is a feature`);
  assert.equal(new Set(cards).size, cards.length, 'a card is in one pain point at most');
  assert.equal(new Set(actions).size, actions.length, 'an action is in one pain point at most');
});

test('the titles follow the language the panel is in now', () => {
  try {
    setLanguage('ar');
    assert.equal(PAIN_POINTS[0].title, 'فهم التذكرة');
    assert.equal(PAIN_POINTS[3].title, 'الرد');
  } finally {
    setLanguage('en');
  }
  assert.equal(PAIN_POINTS[0].title, 'Understand the ticket');
});

test('painOfCard: the pain point a card answers, or "" for a card of the rest', () => {
  assert.equal(painOfCard('journey'), 'understand');
  assert.equal(painOfCard('steps'), 'fix');
  assert.equal(painOfCard('caller'), 'caller');
  assert.equal(painOfCard('account'), 'caller');
  assert.equal(painOfCard('email'), 'reply');
  assert.equal(painOfCard('resolve'), 'close');
  for (const id of ['related', 'missing', 'routing', 'risk', 'changes', 'knownErrors', 'outage', 'made-up', '', undefined]) assert.equal(painOfCard(id), '', String(id));
});

test('focusCards: the groups in the order of the five (not the cards\' order), each card in the record\'s order, empty groups left out', () => {
  // An incident in progress, in the order cardsFor gives (by the ticket's state).
  const cards = ['steps', 'knowledge', 'related', 'risk', 'email', 'journey', 'resolve', 'caller', 'outage'].map(card);
  const { groups, rest } = focusCards(cards);
  assert.deepEqual(groups.map((g) => g.id), ['understand', 'fix', 'caller', 'reply', 'close']);
  assert.deepEqual(groups.map((g) => g.cards.map((c) => c.id)), [['journey'], ['steps', 'knowledge'], ['caller'], ['email'], ['resolve']]);
  assert.deepEqual(groups.map((g) => g.title), ['Understand the ticket', 'Find the fix', 'Same caller', 'Reply', 'Close well']);
  assert.deepEqual(rest.map((c) => c.id), ['related', 'risk', 'outage'], 'the rest in the record\'s order');
  assert.equal(groups[1].cards[0], cards[0], 'the very card objects, not copies');
});

test('focusCards: a record without a pain point\'s cards has no row for it; nothing to sort, nothing drawn', () => {
  const { groups, rest } = focusCards(['article', 'related'].map(card));
  assert.deepEqual(groups.map((g) => g.id), ['understand']);
  assert.deepEqual(rest.map((c) => c.id), ['related']);
  assert.deepEqual(focusCards([]), { groups: [], rest: [] });
  assert.deepEqual(focusCards(), { groups: [], rest: [] });
  assert.deepEqual(focusCards(null), { groups: [], rest: [] });
  assert.deepEqual(focusCards([null, {}, { title: 'no id' }]), { groups: [], rest: [] }, 'anything without an id is dropped');
});

test('focusCards: a case shows its account under "Same caller", a request its status under "Understand the ticket"', () => {
  const groups = focusCards(['account', 'caller', 'request', 'checklist', 'journey'].map(card)).groups;
  assert.deepEqual(groups.find((g) => g.id === 'caller').cards.map((c) => c.id), ['account', 'caller']);
  assert.deepEqual(groups.find((g) => g.id === 'understand').cards.map((c) => c.id), ['request', 'journey']);
  assert.deepEqual(groups.find((g) => g.id === 'fix').cards.map((c) => c.id), ['checklist']);
});

test('focusActions: one action per pain point, the first candidate the record offers; the rest in the registry\'s order', () => {
  const items = ['record-summary', 'reply-draft', 'resolution-notes', 'handoff-brief', 'next-best-action', 'thread-summary', 'kb-article-draft'].map((id) => item(id));
  const { five, rest } = focusActions(items);
  assert.deepEqual(five.map((f) => [f.pain, f.item.feature.id]), [
    ['understand', 'record-summary'],
    ['fix', 'next-best-action'],
    ['reply', 'reply-draft'],
    ['close', 'resolution-notes'],
  ]);
  assert.deepEqual(five.map((f) => f.painTitle), ['Understand the ticket', 'Find the fix', 'Reply', 'Close well']);
  assert.deepEqual(rest.map((it) => it.feature.id), ['handoff-brief', 'thread-summary', 'kb-article-draft']);
  assert.equal(five[0].item, items[0], 'the plan\'s own item (its reason and caution travel with it)');
});

test('focusActions: a later candidate fills the slot when the first is not offered; the caller briefing before the account briefing', () => {
  const c = focusActions(['account-briefing', 'hr-case-brief', 'chat-reply'].map((id) => item(id)));
  assert.deepEqual(c.five.map((f) => [f.pain, f.item.feature.id]), [['understand', 'hr-case-brief'], ['caller', 'account-briefing'], ['reply', 'chat-reply']]);
  const both = focusActions(['account-briefing', 'caller-briefing'].map((id) => item(id)));
  assert.deepEqual(both.five.map((f) => f.item.feature.id), ['caller-briefing']);
  assert.deepEqual(both.rest.map((it) => it.feature.id), ['account-briefing'], 'the other one is in All tools');
});

test('focusActions: an action that cannot run still holds its slot (it says why on its row); nothing offered, nothing drawn', () => {
  const { five } = focusActions([item('reply-draft', 'Needs Strict privacy mode.')]);
  assert.equal(five[0].item.reason, 'Needs Strict privacy mode.');
  assert.deepEqual(focusActions([]), { five: [], rest: [] });
  assert.deepEqual(focusActions(), { five: [], rest: [] });
  assert.deepEqual(focusActions([null, {}, { feature: {} }]), { five: [], rest: [] });
});
