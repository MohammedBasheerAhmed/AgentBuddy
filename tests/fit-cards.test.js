import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy } from '../src/policy/policy.js';
import { Glance, INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { glanceDetails } from '../src/sidepanel/ticket/cards/Glance.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { cardsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { changeLine, windowText } from '../src/insights/changeLine.js';
import { problemFacts } from '../src/insights/steps.js';
import { buildRequestView, forLine } from '../src/checks/requestView.js';
import { callerOf } from '../src/domain/callerTickets.js';
import { callerUnreadable } from '../src/sidepanel/ticket/cards/data.js';
import { buildJourney, groupPath } from '../src/insights/journey.js';
import { sinceLooked } from '../src/insights/sinceLooked.js';
import { limitedKindNote } from '../src/features/focus.js';

// Audit of 2026-11-07, F3, F6, F14, F15: the facts of a request, a change, a problem and a task, on the cards that are already there.

const A = 'a'.repeat(32);
const record = (kind, table) => ({ table, sysId: A, number: 'X1', kind });
let tab = 700;
const pageFor = (rec) => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/${rec.table}.do?sys_id=${A}`, surface: 'classic', portal: null, record: rec, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = () => ({ ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) });
const SLAS = { items: [], access: [{ source: 'task_sla', status: 'empty' }] };
const glanceOf = (pack) => ({ pack, slas: SLAS, vip: { status: 'no', access: [] }, outage: { hits: [], windowHours: 24, access: [] } });

// ---- F6: a change at a glance -----------------------------------------------------------------------------------------------------

const changePack = (fields = {}) => ({
  version: 1, table: 'change_request', sysId: A, number: 'CHG0030001', kind: 'change',
  fields: { number: 'CHG0030001', short_description: 'Move the mail gateway', state: 'Scheduled', type: 'Normal', risk: 'High', start_date: '2026-11-12 09:00:00', end_date: '2026-11-12 17:00:00', approval: 'Approved', ...fields },
  people: [{ role: 'requested_by', name: 'Dave Loftus', sysId: 'd'.repeat(32) }], journal: [], related: {}, access: [],
});

test('F6: the change line says the type, the risk, the window and the approval, in minutes, from what the glance read brought', () => {
  assert.equal(changeLine(changePack()), 'Normal change · High risk · Window: 2026-11-12 09:00 to 17:00 · Approval: Approved');
  assert.equal(changeLine(changePack({ type: '', risk: '' })), 'Window: 2026-11-12 09:00 to 17:00 · Approval: Approved', 'a part the read did not bring is left out, never guessed');
  assert.equal(changeLine(changePack({ type: '', risk: '', start_date: '', end_date: '', approval: '' })), '');
  assert.equal(windowText('2026-11-12 22:00:00', '2026-11-13 02:00:00'), 'Window: 2026-11-12 22:00 to 2026-11-13 02:00', 'two days: both ends in full');
  assert.equal(windowText('2026-11-12 22:00:00', ''), 'from 2026-11-12 22:00');
  assert.equal(windowText('', '2026-11-12 22:00:00'), 'until 2026-11-12 22:00');
  assert.equal(windowText('', ''), '');
  assert.equal(changeLine({ ...changePack(), kind: 'incident' }), '', 'only a change has this line');
  assert.equal(changeLine(null), '');
});

test('F6: the line is drawn under the chips of a change, and the person who asked for it is the one the details name', async () => {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  const pack = changePack({ requested_by: 'Dave Loftus' });
  fake.onRead('glance', () => glanceOf(pack));
  const rec = record('change', 'change_request');
  const ui = await mount(<Glance page={pageFor(rec)} eff={eff()} record={rec} header={{ number: 'CHG0030001', short_description: 'Move the mail gateway', state: 'Scheduled', priority: '3 - Moderate' }} headPhase="ready" />);
  await settle(6);
  try {
    assert.match(ui.text(), /Normal change · High risk · Window: 2026-11-12 09:00 to 17:00 · Approval: Approved/);
    const facts = glanceDetails(pack, Date.now());
    assert.deepEqual(facts.find((f) => f.key === 'caller'), { key: 'caller', label: 'Requested by', value: 'Dave Loftus' });
  } finally {
    await ui.unmount();
  }
});

test('F6: the person who asked for a change is its caller; the panel looks up their other tickets', () => {
  assert.deepEqual(callerOf(changePack()), { role: 'requested_by', sysId: 'd'.repeat(32) });
  // ...and a column that did not come back is a caller we could not read, not nobody
  assert.equal(callerUnreadable({ ...changePack(), unreadable: ['requested_by'] }), true);
  assert.equal(callerUnreadable(changePack()), false);
});

test('F6: a change has the cards that need no AI: the caller, the related tickets, the emails, the journey and "Ready to resolve?"', () => {
  const ids = cardsFor(INSIGHT_CARDS, record('change', 'change_request'), null, eff()).map((c) => c.id);
  for (const id of ['caller', 'related', 'email', 'journey', 'resolve']) assert.ok(ids.includes(id), id);
  const hr = cardsFor(INSIGHT_CARDS, record('hr_case', 'sn_hr_core_case'), null, eff()).map((c) => c.id);
  assert.ok(hr.includes('resolve'), 'an HR case has the close row too (W-09)');
});

// ---- F3: for whom, what, how many -----------------------------------------------------------------------------------------------------

test('F3: "For X · Item · Quantity n" is one line, the quantity only when it is more than one, a missing part left out', () => {
  const pack = (fields) => ({ fields });
  assert.equal(forLine(pack({ requested_for: 'Abel Tuter', cat_item: 'Standard Laptop', quantity: '2' })), 'For Abel Tuter · Standard Laptop · Quantity 2');
  assert.equal(forLine(pack({ requested_for: 'Abel Tuter', cat_item: 'Standard Laptop', quantity: '1' })), 'For Abel Tuter · Standard Laptop');
  assert.equal(forLine(pack({ cat_item: 'Standard Laptop' })), 'Standard Laptop');
  assert.equal(forLine(pack({ requested_for: 'Abel Tuter' })), 'For Abel Tuter');
  assert.equal(forLine(pack({ quantity: 'lots' })), '');
  assert.equal(forLine(null), '');
  assert.equal(buildRequestView(pack({ requested_for: 'Abel Tuter', cat_item: 'Standard Laptop' })).forLine, 'For Abel Tuter · Standard Laptop');
});

test('F3: the Request card draws the line once, inside the card, for a requested item', async () => {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  const rec = record('requested_item', 'sc_req_item');
  fake.onRead('pack', () => ({
    version: 1, table: 'sc_req_item', sysId: A, number: 'RITM0010050', kind: 'requested_item',
    fields: { number: 'RITM0010050', short_description: 'Laptop', state: 'Work in Progress', requested_for: 'Charlie Whitherspoon', cat_item: 'Standard Laptop', quantity: '3', stage: 'Fulfillment', approval: 'Approved' },
    people: [], journal: [], related: { approvals: [], catalogTasks: [], variables: [] }, access: [],
  }));
  const C = INSIGHT_CARDS.find((c) => c.id === 'request').Card;
  const ui = await mount(<C page={pageFor(rec)} eff={eff()} record={rec} header={{ number: 'RITM0010050' }} active setSummary={() => {}} setAttention={() => {}} />);
  await settle(8);
  try {
    const text = ui.text();
    assert.equal(text.split('For Charlie Whitherspoon · Standard Laptop · Quantity 3').length - 1, 1);
  } finally {
    await ui.unmount();
  }
});

// ---- F15: what a task is a part of ---------------------------------------------------------------------------------------------------------

test('F15: a task says what it is part of, with the way to open it; a ticket without a parent says nothing', () => {
  const task = { kind: 'task', table: 'sn_customerservice_task', fields: { number: 'CSTASK1', parent: 'CS0001234' }, related: { parent: { sysId: 'f'.repeat(32), number: 'CS0001234' } } };
  const row = glanceDetails(task, Date.now()).find((r) => r.key === 'parent');
  assert.deepEqual(row, { key: 'parent', label: 'Part of', value: 'CS0001234', link: { table: 'task', sysId: 'f'.repeat(32), number: 'CS0001234' } });
  assert.equal(glanceDetails({ ...task, related: {} }, Date.now()).some((r) => r.key === 'parent'), false);
  assert.equal(glanceDetails({ ...task, related: { parent: { sysId: 'not an id', number: 'CS0001234' } } }, Date.now()).some((r) => r.key === 'parent'), false, 'only a real id is a link');
});

// ---- F14: a problem's workaround ------------------------------------------------------------------------------------------------------------

test('F14: a problem\'s workaround and known-error mark come from the glance read; nothing is claimed when neither is there', () => {
  const problem = (fields, extra = {}) => ({ kind: 'problem', fields, ...extra });
  assert.deepEqual(problemFacts(problem({ known_error: 'true', workaround: 'Restart the pool each night. It keeps people working.' })), { workaround: 'Restart the pool each night. It keeps people working.', knownError: true, hidden: false });
  assert.deepEqual(problemFacts(problem({ known_error: 'Yes' })), { workaround: '', knownError: true, hidden: false });
  assert.equal(problemFacts(problem({ known_error: 'false' })), null);
  assert.equal(problemFacts(problem({})), null);
  assert.equal(problemFacts({ kind: 'incident', fields: { workaround: 'x' } }), null);
  assert.equal(problemFacts(problem({ known_error: 'true' }, { unreadable: ['workaround'] })).hidden, true, 'a workaround the user may not read is not "none"');
});

// ---- I7: a state or a priority no choice names ----------------------------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 7, 12);
const pack = { fields: { opened_at: '2026-11-01 09:00:00', assignment_group: 'Service Desk' }, people: [], journal: [], related: { times: { opened_at: '2026-11-01 09:00:00' } } };

test('I7: the journey never shows "State 10": a state that changed to a value no choice names is "State changed", a group is named as one the user cannot see', () => {
  const audit = {
    available: true,
    changes: [
      { field: 'state', from: 'New', to: '', toUnlabelled: true, atUtc: '2026-11-02 10:00:00' },
      { field: 'priority', from: '', fromUnlabelled: true, to: '2 - High', atUtc: '2026-11-03 10:00:00' },
      { field: 'assignment_group', from: '', fromUnlabelled: true, to: '', toUnlabelled: true, atUtc: '2026-11-04 10:00:00' },
      { field: 'priority', from: '2 - High', to: '', toUnlabelled: true, atUtc: '2026-11-05 10:00:00' },
    ],
  };
  const journey = buildJourney({ pack, audit, now: NOW });
  const labels = journey.events.map((e) => `${e.label}${e.detail ? ` (${e.detail})` : ''}`);
  assert.ok(labels.includes('State changed (was New)'), labels.join(' | '));
  assert.ok(labels.includes('Priority changed (was 2 - High)'));
  assert.ok(labels.includes('Assigned to a group you cannot see (was a group you cannot see)'));
  assert.ok(labels.includes('Priority: 2 - High'));
  assert.ok(!labels.some((l) => /State \d|Priority \d/.test(l)));
  assert.deepEqual(groupPath(audit.changes), ['a group you cannot see']);
});

test('I7: "Since you last looked" says "moved to a state" and "priority changed" for values no choice names', () => {
  const audit = (changes) => ({ available: true, changes });
  const since = (changes) => sinceLooked({ previous: Date.UTC(2026, 10, 1), pack, audit: audit(changes), now: NOW });
  const state = since([{ field: 'state', to: '', toUnlabelled: true, atUtc: '2026-11-03 10:00:00' }]);
  assert.match(state.sub, /moved to a state/);
  const priority = since([{ field: 'priority', to: '', toUnlabelled: true, atUtc: '2026-11-03 10:00:00' }]);
  assert.match(priority.sub, /priority changed/);
  const named = since([{ field: 'state', to: 'In Progress', atUtc: '2026-11-03 10:00:00' }, { field: 'priority', to: '2 - High', atUtc: '2026-11-03 10:00:00' }]);
  assert.match(named.sub, /moved to In Progress/);
  assert.match(named.sub, /priority now 2 - High/);
  assert.doesNotMatch(`${state.sub} ${priority.sub}`, /State \d|Priority \d/);
});

// ---- F7: a kind the product does not know ---------------------------------------------------------------------------------------------

test('F7: only a table the product knows nothing about gets the limited-kind note; a custom task is a task and is not told it is unknown', () => {
  assert.match(limitedKindNote('other'), /does not know this kind of ticket/);
  assert.equal(limitedKindNote('task'), '');
  const ids = cardsFor(INSIGHT_CARDS, record('task', 'u_facilities_request'), null, eff()).map((c) => c.id);
  for (const id of ['caller', 'related', 'knowledge', 'email', 'journey', 'resolve', 'missing']) assert.ok(ids.includes(id), id);
  assert.deepEqual(cardsFor(INSIGHT_CARDS, record('other', 'u_things'), null, eff()).map((c) => c.id), []);
});
