import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLevel, groupLine, groupOfCard, insightGroups, lookCount, needsLook, orderMembers, readLaunch } from '../src/sidepanel/ticket/focusView.js';
import { actionPlan, primaryAction } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { SUGGEST } from '../src/features/stages.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The Ticket screen's five rows worked out without React (docs/focus-layout.md, A): which row a card is in, what a row says without
// being opened (its line), its status (the dot), the number on the Insights tab, how a launch id is read, and which of the five AI
// actions carries the one filled mark.

const card = (id) => ({ id, title: id });
// An incident in progress, in the order cardsFor gives.
const CARDS = ['steps', 'knowledge', 'related', 'risk', 'email', 'journey', 'resolve', 'caller', 'outage'].map(card);
const SLA = { id: 'sla', level: 'danger', text: 'The SLA was due 2 h ago', sub: 'P2 resolution' };
const WAIT = { id: 'waiting', level: 'warn', text: 'The customer has waited 2 d for a reply', sub: '' };

test('the five rows: in the order of the five, their cards, and the rest (no "All clear" row: five rows always show)', () => {
  const { groups, rest } = insightGroups({ cards: CARDS });
  assert.deepEqual(groups.map((g) => g.id), ['understand', 'fix', 'caller', 'reply', 'close']);
  assert.deepEqual(groups.map((g) => g.cards.map((c) => c.id)), [['journey'], ['steps', 'knowledge'], ['caller'], ['email'], ['resolve']]);
  assert.deepEqual(rest.map((c) => c.id), ['related', 'risk', 'outage']);
  assert.ok(groups.every((g) => g.level === '' && g.line === '' && g.look === false && Array.isArray(g.needs)), 'nothing reported yet: plain, no line');
  assert.deepEqual(insightGroups(), { groups: [], rest: [] });
});

test('the facts that need the agent now belong to "Understand the ticket": its line is the first of them, and they colour its dot', () => {
  const reports = { journey: { summary: '3 reassignments', attention: '' } };
  const { groups } = insightGroups({ cards: CARDS, reports, needs: [SLA, WAIT] });
  const understand = groups[0];
  assert.deepEqual(understand.needs.map((n) => n.id), ['sla', 'waiting']);
  assert.equal(understand.line, 'The SLA was due 2 h ago', 'the fact, not the card');
  assert.equal(understand.level, 'danger');
  assert.equal(understand.look, true);
  assert.ok(groups.slice(1).every((g) => g.needs.length === 0), 'the other rows have no facts');
  // No fact: the first card's line.
  assert.equal(insightGroups({ cards: CARDS, reports }).groups[0].line, '3 reassignments');
});

test('a record without a card for "Understand the ticket" still shows its facts, in a row of their own', () => {
  const { groups } = insightGroups({ cards: ['steps', 'related'].map(card), needs: [WAIT] });
  assert.deepEqual(groups.map((g) => g.id), ['understand', 'fix']);
  assert.deepEqual(groups[0].cards, []);
  assert.equal(groups[0].title, 'Understand the ticket');
  assert.equal(groups[0].line, WAIT.text);
  assert.equal(groups[0].level, 'warn');
  // ...and no row for it when there is nothing to say.
  assert.deepEqual(insightGroups({ cards: ['steps'].map(card), needs: [] }).groups.map((g) => g.id), ['fix']);
});

test('a row\'s line: its cards\' lines, the ones that need a look first, two at most, joined by " · "', () => {
  const fix = { id: 'fix', cards: ['steps', 'knowledge', 'checklist'].map(card) };
  assert.equal(groupLine(fix, { steps: { summary: '2 fixes' }, knowledge: { summary: '3 matching articles' }, checklist: { summary: '1 of 4 done' } }), '2 fixes · 3 matching articles');
  assert.equal(groupLine(fix, { steps: { summary: '' }, knowledge: { summary: '3 matching articles' } }), '3 matching articles', 'an empty line is skipped');
  assert.equal(groupLine(fix, { knowledge: { summary: 'No matching articles' }, checklist: { summary: '1 of 4 done', attention: 'warn' } }), '1 of 4 done · No matching articles', 'the line explains the dot');
  assert.equal(groupLine(fix, {}), '');
  assert.equal(groupLine({ id: 'reply', cards: [card('email')] }, { email: { summary: '  Status update fits best ' } }), 'Status update fits best');
  // "Understand the ticket" says one thing: the first card's line.
  assert.equal(groupLine({ id: 'understand', cards: ['request', 'journey'].map(card) }, { request: { summary: 'Waiting for approval' }, journey: { summary: '2 hand-offs' } }), 'Waiting for approval');
  assert.equal(groupLine(null), '');
});

test('a row\'s status: the most telling of its cards (and facts): danger, warn, good news, plain; "clear" only when all say so', () => {
  const two = ['steps', 'knowledge'].map(card);
  assert.equal(groupLevel(two, { steps: { attention: 'ok' }, knowledge: { attention: 'warn' } }), 'warn');
  assert.equal(groupLevel(two, { steps: { attention: 'danger' }, knowledge: { attention: 'warn' } }), 'danger');
  assert.equal(groupLevel(two, { steps: { attention: 'ok' }, knowledge: { attention: 'clear' } }), 'ok');
  assert.equal(groupLevel(two, { steps: { attention: 'ok' } }), 'ok', 'good news shows over a card that has said nothing yet');
  assert.equal(groupLevel(two, { steps: { attention: 'clear' } }), '', 'one card has not reported: not "nothing to report"');
  assert.equal(groupLevel(two, { steps: { attention: 'clear' }, knowledge: { attention: 'clear' } }), 'clear');
  assert.equal(groupLevel(two, { steps: { attention: 'red' } }), '', 'an unknown status is plain');
  assert.equal(groupLevel([card('journey')], { journey: { attention: 'clear' } }, [WAIT]), 'warn', 'the facts count');
  assert.equal(groupLevel([], {}, []), '');
  for (const level of ['danger', 'warn']) assert.equal(needsLook(level), true);
  for (const level of ['ok', 'clear', '', undefined]) assert.equal(needsLook(level), false);
});

test('the cards inside a row: the ones that need a look first (danger, then warn), the others in the record\'s order', () => {
  const cards = ['a', 'b', 'c', 'd'].map(card);
  assert.deepEqual(orderMembers(cards, { b: { attention: 'warn' }, c: { attention: 'clear' }, d: { attention: 'danger' } }).map((c) => c.id), ['d', 'b', 'a', 'c']);
  assert.deepEqual(orderMembers(cards).map((c) => c.id), ['a', 'b', 'c', 'd'], 'before any report: the record\'s order');
  assert.deepEqual(orderMembers(), []);
});

test('the number on the Insights tab: the rows that need a look (a fact, or a card that said danger or warn); a card of the rest does not count', () => {
  const reports = { steps: { attention: 'ok' }, caller: { attention: 'warn' }, email: { attention: 'clear' }, risk: { attention: 'danger' }, outage: { attention: 'danger' } };
  const { groups } = insightGroups({ cards: CARDS, reports, needs: [WAIT] });
  assert.deepEqual(groups.filter((g) => g.look).map((g) => g.id), ['understand', 'caller']);
  assert.equal(lookCount(groups), 2);
  assert.equal(lookCount(insightGroups({ cards: CARDS }).groups), 0);
  assert.equal(lookCount(), 0);
});

test('the row a card is drawn in, or none for a card of the rest', () => {
  const { groups } = insightGroups({ cards: CARDS });
  assert.equal(groupOfCard(groups, 'knowledge')?.id, 'fix');
  assert.equal(groupOfCard(groups, 'caller')?.id, 'caller');
  assert.equal(groupOfCard(groups, 'related'), null);
  assert.equal(groupOfCard(groups, ''), null);
  assert.equal(groupOfCard(groups, null), null);
});

test('launch ids: an AI action, a card from the bar, any card alone, "Ask about this ticket"', () => {
  assert.deepEqual(readLaunch('reply-draft'), { kind: 'feature', id: 'reply-draft' });
  assert.deepEqual(readLaunch('card:ready'), { kind: 'quick', card: 'resolve' });
  assert.deepEqual(readLaunch('card:related'), { kind: 'quick', card: 'related' });
  assert.deepEqual(readLaunch('show:knownErrors'), { kind: 'show', card: 'knownErrors' }, 'card ids are camelCase');
  assert.deepEqual(readLaunch('show:caller'), { kind: 'show', card: 'caller' });
  assert.deepEqual(readLaunch('ask:ticket'), { kind: 'ask' });
  // Anything else is taken as a feature id; the screen then finds no such action and says so (nothing runs).
  assert.deepEqual(readLaunch('show:'), { kind: 'feature', id: 'show:' });
  assert.deepEqual(readLaunch('show:a-b'), { kind: 'feature', id: 'show:a-b' });
  assert.deepEqual(readLaunch('card:nope'), { kind: 'feature', id: 'card:nope' });
  assert.deepEqual(readLaunch('ask:other'), { kind: 'feature', id: 'ask:other' });
  assert.deepEqual(readLaunch(undefined), { kind: 'feature', id: '' });
});

// ---- the one filled mark in AI Assist ---------------------------------------------------------------------------------------

const five = (...ids) => ids.map((id) => ({ pain: 'x', painTitle: 'X', item: { feature: { id }, reason: '', caution: '' } }));

test('the primary: the first of the stage\'s list that is among the five and can run', () => {
  const rows = five('record-summary', 'next-best-action', 'reply-draft', 'resolution-notes');
  assert.equal(primaryAction(rows, 'working'), 'reply-draft');
  assert.equal(primaryAction(rows, 'new'), 'record-summary');
  assert.equal(primaryAction(rows, 'resolve'), 'resolution-notes');
  assert.equal(primaryAction(rows, null), SUGGEST.unknown.find((id) => rows.some((r) => r.item.feature.id === id)));
  // One that cannot run is skipped; the next of the stage's list takes its place.
  const blocked = rows.map((r) => (r.item.feature.id === 'reply-draft' ? { ...r, item: { ...r.item, reason: 'Needs Strict privacy mode.' } } : r));
  assert.equal(primaryAction(blocked, 'working'), SUGGEST.working.find((id) => id !== 'reply-draft' && rows.some((r) => r.item.feature.id === id)));
  // Not in the stage's list: no filled row at all (a closed ticket is not asked to reply).
  assert.equal(primaryAction(five('reply-draft'), 'closed'), '');
  assert.equal(primaryAction([], 'working'), '');
  assert.equal(primaryAction(), '');
});

const A = 'a'.repeat(32);
const eff = (values = {}, policy = {}) => ({ ready: true, apiKey: 'k', values: { piiMode: 'standard', profiles: ['it', 'req', 'csm'], provider: 'openai', model: 'm', ...values }, locked: {}, policy: normalizePolicy(policy) });

test('the plan of a record: the five, the rest and the primary, from the actions the record offers', () => {
  const p = actionPlan({ record: { kind: 'incident', table: 'incident', sysId: A }, header: { state: 'In Progress' }, eff: eff() });
  const fiveIds = p.five.map((f) => f.item.feature.id);
  assert.ok(fiveIds.includes('record-summary') && fiveIds.includes('reply-draft'), fiveIds.join());
  assert.equal(p.primary, 'reply-draft', 'while it is worked on: reply');
  assert.equal(p.five.length + p.rest.length, p.total);
  assert.deepEqual([...fiveIds, ...p.rest.map((it) => it.feature.id)].sort(), p.items.map((it) => it.feature.id).sort(), 'every action is somewhere, once');
  const off = actionPlan({ record: { kind: 'incident', table: 'incident', sysId: A }, header: { state: 'In Progress' }, eff: eff({}, { disabledFeatures: ['reply-draft'] }) });
  assert.ok(!off.items.some((it) => it.feature.id === 'reply-draft'), 'switched off by the organisation: not offered at all');
  assert.notEqual(off.primary, 'reply-draft');
});
