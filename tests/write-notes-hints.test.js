import test from 'node:test';
import assert from 'node:assert/strict';
import { HINT_TICKET_FIELDS, namesToLookUp, readNotesHints, voteRouting } from '../src/compose/notesHints.js';
import ops, { notesHintsArgs } from '../src/content/ops/compose.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { blankFormsFor } from '../src/sidepanel/compose/NotesPanel.jsx';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// AI24 Notes to ticket (round 3): suggestions for caller, category and assignment group, without AI and never filled; and the blank
// form the panel offers to open.

const id = (n) => `${String(n).padStart(4, '0')}${'0'.repeat(28)}`;
const NET = id(9001);
const DESK = id(9002);
const row = (n, title, category, group, groupName) => ({
  sys_id: v(id(n)),
  short_description: v(title),
  category: v(category, category.charAt(0).toUpperCase() + category.slice(1)),
  assignment_group: v(group, groupName),
  resolved_at: v(`2026-10-${String(10 + n).padStart(2, '0')} 09:00:00`),
  description: v('LEAK-DESCRIPTION'),
});
const tables = () => ({
  incident: [
    row(1, 'VPN keeps disconnecting', 'network', NET, 'Network Support'),
    row(2, 'VPN disconnects after sleep', 'network', NET, 'Network Support'),
    row(3, 'VPN client error 809', 'network', DESK, 'Service Desk'),
    row(4, 'Printer offline', 'hardware', DESK, 'Service Desk'),
  ],
  sys_user: [
    { sys_id: v(id(1)), name: v('Abel Tuter'), email: v('abel.tuter@example.com'), department: v(id(50), 'Sales'), active: v('true') },
    { sys_id: v(id(2)), name: v('Abel Tuter'), email: v('abel.tuter2@example.com'), department: v(id(51), 'Finance'), active: v('true') },
    { sys_id: v(id(3)), name: v('Priya Raman'), email: v('priya@example.com'), department: v(id(52), 'IT'), active: v('true') },
  ],
});

test('the vote: a category or group most look-alikes share, never one with a single vote or a small minority', () => {
  const voter = (category, groupId, label) => ({ category: category ? { value: category, label: category } : null, group: groupId ? { id: groupId, label } : null });
  const out = voteRouting([voter('network', NET, 'Network Support'), voter('network', NET, 'Network Support'), voter('hardware', DESK, 'Service Desk')]);
  assert.deepEqual(out, { looked: 3, category: { value: 'network', name: 'network', count: 2 }, group: { id: NET, name: 'Network Support', count: 2 } });
  assert.deepEqual(voteRouting([voter('network', NET, 'N')]), { looked: 1, category: null, group: null }, 'one vote is not a suggestion');
  const spread = voteRouting(['a', 'b', 'c', 'd', 'e', 'a', 'b', 'c', 'd', 'e'].map((c) => voter(c)));
  assert.equal(spread.category, null, '2 of 10 is not a suggestion');
  assert.equal(voteRouting([voter('x', 'not-an-id', 'X'), voter('x', 'not-an-id', 'X')]).group, null, 'a group must be a sys_id');
  assert.deepEqual(voteRouting(null), { looked: 0, category: null, group: null });
});

test('names to look up: full names only, at most three, nothing that could change a query', () => {
  assert.deepEqual(namesToLookUp(['Abel Tuter', 'abel tuter', 'Priya', "Mary-Jane O'Neil", 'Bob^Smith', 'Eve javascript:x', 'A B', 'C D', 'E F']), ['Abel Tuter', "Mary-Jane O'Neil", 'A B']);
  assert.deepEqual(namesToLookUp('Abel Tuter'), []);
});

test('the suggestions read: look-alikes by the short description\'s words, a vote; users by exact name; GET only, few columns', async () => {
  const deps = fakeDeps(tables());
  const out = await readNotesHints({ table: 'incident', text: 'VPN disconnecting all morning', names: ['Abel Tuter', 'Nobody Here'] }, deps);
  assert.deepEqual(out.routing.category, { value: 'network', name: 'Network', count: 3 });
  assert.deepEqual(out.routing.group, { id: NET, name: 'Network Support', count: 2 });
  assert.equal(out.routing.looked, 3, 'only the tickets that share a word vote');
  assert.deepEqual(out.callers.map((c) => [c.name, c.matches.map((m) => m.department)]), [['Abel Tuter', ['Sales', 'Finance']], ['Nobody Here', []]]);
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'));
  assert.deepEqual(deps.callsTo('incident')[0].fields, [...HINT_TICKET_FIELDS]);
  assert.match(deps.callsTo('incident')[0].query, /^resolved_atISNOTEMPTY\^short_descriptionLIKE/);
  assert.equal(deps.callsTo('sys_user')[0].query, 'active=true^name=Abel Tuter');
  assert.ok(!JSON.stringify(out).includes('LEAK'), 'nothing outside the columns asked for');
  for (const name of HINT_TICKET_FIELDS.filter((f) => f !== 'sys_id')) {
    assert.ok(FIELDS_BY_KIND.incident.includes(name) && FIELDS_BY_KIND.case.includes(name), `${name} is inside the incident and case ceilings`);
  }
});

test('the suggestions read is honest about what it could not read, and refuses other tables', async () => {
  const denied = await readNotesHints({ table: 'incident', text: 'VPN down', names: ['Abel Tuter'] }, fakeDeps(tables(), { denied: ['incident', 'sys_user'] }));
  assert.equal(denied.routing.category, null);
  assert.deepEqual(denied.access.map((a) => [a.source, a.status]), [['incident', 'denied'], ['sys_user', 'denied']]);
  await assert.rejects(() => readNotesHints({ table: 'sn_hr_core_case', text: 'x' }, fakeDeps({})), /new incident or case/);
  const noWords = await readNotesHints({ table: 'case', text: 'it is not working', names: [] }, fakeDeps({}));
  assert.deepEqual(noWords.keywords, []);
});

test('the op checks its arguments', async () => {
  assert.throws(() => notesHintsArgs({ table: 'incident', text: '   ' }), /no short description/);
  assert.deepEqual(notesHintsArgs({ table: 'incident', text: 'x'.repeat(400), names: ['A B', 7, null, 'y'.repeat(80)] }), { table: 'incident', text: 'x'.repeat(300), names: ['A B', 'y'.repeat(60)] });
  const out = await ops.notesHints({ table: 'incident', text: 'VPN disconnecting' }, { deps: fakeDeps(tables()) });
  assert.equal(out.routing.category.value, 'network');
});

test('the blank form offered: an incident for IT, a case for customer service, both for both', () => {
  const eff = (profiles) => ({ values: { profiles }, policy: {} });
  assert.deepEqual(blankFormsFor(eff(['it'])).map((f) => f.table), ['incident']);
  assert.deepEqual(blankFormsFor(eff(['csm'])).map((f) => f.table), ['sn_customerservice_case']);
  assert.deepEqual(blankFormsFor(eff(['it', 'csm'])).map((f) => f.table), ['incident', 'sn_customerservice_case']);
  assert.deepEqual(blankFormsFor(eff(['req'])).map((f) => f.table), ['incident'], 'someone with neither still gets the incident');
});
