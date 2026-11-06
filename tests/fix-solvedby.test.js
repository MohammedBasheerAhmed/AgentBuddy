import test from 'node:test';
import assert from 'node:assert/strict';
import { solvedBy } from '../src/insights/solvedBy.js';
import { setLanguage } from '../src/i18n/index.js';

// Find the fix (round 4): "solved before by": the group most solved look-alikes went to, how many, and who solved most of them. Display
// only (the names never go to an AI). Fewer than two look-alikes that name a group say nothing; a tie says the groups.

const hit = (group, person = '', number = 'INC1') => ({ assignment_group: group, assigned_to: person, number });
const EMAIL = 'Service Desk – Email';

test('the group most solved look-alikes went to, the count, and who solved most of them', () => {
  const r = solvedBy([hit(EMAIL, 'Beth Anglin', 'INC1'), hit(EMAIL, 'Beth Anglin', 'INC2'), hit('service desk – email', 'Abel Tuter', 'INC3'), hit('Network Support', 'Beth Anglin', 'INC4'), hit('', 'Fred Luddy', 'INC5')]);
  assert.equal(r.enough, true);
  assert.equal(r.tie, false);
  assert.equal(r.total, 4, 'only the look-alikes that name a group count');
  assert.deepEqual(r.group, { name: EMAIL, count: 3, numbers: ['INC1', 'INC2', 'INC3'] });
  assert.deepEqual(r.person, { name: 'Beth Anglin', count: 2 }, 'counted inside the top group only (her Network ticket does not count)');
  assert.equal(r.line, 'Solved 3 times before by Service Desk – Email');
  assert.equal(r.after, 'solved 3 times before by Service Desk – Email');
  assert.equal(r.fact, 'Service Desk – Email: 3 solved look-alikes (Beth Anglin solved 2 of them)');
  assert.deepEqual(r.groups.map((g) => [g.name, g.count]), [[EMAIL, 3], ['Network Support', 1]]);
});

test('thresholds: fewer than two look-alikes naming a group say nothing', () => {
  for (const hits of [[], [hit(EMAIL, 'Beth Anglin')], [hit(EMAIL), hit(''), hit('  ')], null, undefined, 'nope', [null, 42, hit(EMAIL)]]) {
    const r = solvedBy(hits);
    assert.equal(r.enough, false, JSON.stringify(hits));
    assert.equal(r.line, '');
    assert.equal(r.after, '');
    assert.equal(r.fact, '');
    assert.equal(r.group, null);
    assert.equal(r.person, null);
  }
  assert.equal(solvedBy([hit(EMAIL)]).total, 1);
  // two of the same group are enough
  const two = solvedBy([hit(EMAIL), hit(EMAIL)]);
  assert.equal(two.enough, true);
  assert.equal(two.line, 'Solved 2 times before by Service Desk – Email');
  assert.equal(two.fact, 'Service Desk – Email: 2 solved look-alikes', 'nobody named: no person');
});

test('a tie says the tied groups (at most three), and names nobody', () => {
  const r = solvedBy([hit('Network Support', 'Beth Anglin'), hit(EMAIL, 'Beth Anglin'), hit('Network Support', 'Beth Anglin'), hit(EMAIL, 'Abel Tuter'), hit('Hardware', 'Fred Luddy')]);
  assert.equal(r.enough, true);
  assert.equal(r.tie, true);
  assert.equal(r.group, null);
  assert.equal(r.person, null);
  assert.equal(r.line, 'Solved before by Network Support, Service Desk – Email');
  assert.equal(r.after, 'solved before by Network Support, Service Desk – Email');
  assert.equal(r.fact, 'Network Support, Service Desk – Email: 2 solved look-alikes each');
  // one each of two groups is a tie too
  const ones = solvedBy([hit('B group'), hit('A group')]);
  assert.equal(ones.tie, true);
  assert.equal(ones.fact, 'A group, B group: 1 solved look-alike each');
  const four = solvedBy([hit('D'), hit('C'), hit('B'), hit('A')]);
  assert.equal(four.line, 'Solved before by A, B, C', 'three groups at most');
});

test('a person is named only for two or more, and only when nobody solved as many', () => {
  const tiePeople = solvedBy([hit(EMAIL, 'Beth Anglin'), hit(EMAIL, 'Beth Anglin'), hit(EMAIL, 'Abel Tuter'), hit(EMAIL, 'Abel Tuter')]);
  assert.equal(tiePeople.person, null);
  assert.equal(tiePeople.fact, 'Service Desk – Email: 4 solved look-alikes');
  const spread = solvedBy([hit(EMAIL, 'Beth Anglin'), hit(EMAIL, 'Abel Tuter'), hit(EMAIL, '')]);
  assert.equal(spread.person, null, 'one each is nobody in particular');
  assert.equal(spread.fact, 'Service Desk – Email: 3 solved look-alikes');
});

test('Arabic: the names stay whole inside the sentence (isolated), the counts take the Arabic plural forms', () => {
  setLanguage('ar');
  try {
    const r = solvedBy([hit(EMAIL, 'Beth Anglin'), hit(EMAIL, 'Beth Anglin'), hit(EMAIL, 'Abel Tuter')]);
    assert.ok(r.line.includes(`⁨${EMAIL}⁩`), r.line);
    assert.ok(r.fact.includes('⁨Beth Anglin⁩'), r.fact);
    assert.ok(!/[a-z]{4,}/.test(r.line.replace(/⁨[^⁩]*⁩/g, '')), `no English left: ${r.line}`);
  } finally {
    setLanguage('en');
  }
});
