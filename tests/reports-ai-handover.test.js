const test = require('node:test');
const assert = require('node:assert/strict');
import { runReport, createRuntime, resultTables, SECTIONS } from '../src/reports/engine/index.js';
import { HANDOVER_HOURS, normalizeHours, waitingKind } from '../src/reports/engine/handover.js';
import { SECTION_IDS } from '../src/reports/engine/constants.js';
import { HANDOVER_HEADINGS, NOTABLE_MAX, buildHandoverPack, checkHandoverNote, handoverParts, pickNotable } from '../src/reports/ai/handover.js';
import { cleanParams, createReportOps } from '../src/content/ops/reports.js';
import { USER, NOW, GROUP_A, HANDOVER_TITLES, ABEL, DANA, PRIYA, MARCUS, INJECTION, handoverWorld, id } from './reports-ai-fixtures.js';

const TABLES = ['incident', 'sc_req_item', 'sc_task'];
const run = (inst, params = {}, scope = { kind: 'groups' }, tables = TABLES) =>
  runReport({ kind: 'section', section: 'handover', scope, tables, params }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

// ---- Small pure pieces ---------------------------------------------------------------------------------------------------

test('the period is 8, 12 or 24 hours and anything else becomes 12', () => {
  assert.deepEqual([...HANDOVER_HOURS], [8, 12, 24]);
  for (const h of [8, 12, 24, '8', '24']) assert.equal(normalizeHours(h), Number(h));
  for (const h of [0, 7, 13, 48, -12, NaN, 'abc', null, undefined, {}, [12]]) assert.equal(normalizeHours(h), h === undefined || h === null ? 12 : 12, String(h));
});

test('the hours knob survives cleanParams only when it is one of the three', () => {
  assert.equal(cleanParams({ hours: 24 }).hours, 24);
  assert.equal(cleanParams({ hours: '8' }).hours, 8);
  for (const bad of [0, 10, 100, 'x', null]) assert.equal('hours' in cleanParams({ hours: bad }), false, String(bad));
  assert.equal('hours' in cleanParams({}), false);
});

test('waitingKind tells the customer, an approval and everything else apart by the label', () => {
  for (const l of ['Awaiting Caller', 'Awaiting User Info', 'Pending Customer', 'Awaiting Info', 'Awaiting Requester']) assert.equal(waitingKind(l), 'customer', l);
  for (const l of ['Awaiting Approval', 'Pending approval', 'Waiting for Approval']) assert.equal(waitingKind(l), 'approval', l);
  for (const l of ['On Hold', 'Pending', 'Awaiting Vendor', '', null, undefined]) assert.equal(waitingKind(l), 'other', String(l));
});

test('the section is registered and its id can be saved on a dashboard', () => {
  assert.ok(SECTION_IDS.includes('handover'));
  assert.equal(typeof SECTIONS.handover.run, 'function');
  assert.equal(SECTIONS.handover.title, 'Shift handover');
});

// ---- The deterministic page ----------------------------------------------------------------------------------------------

test('the handover result: figures, what needs attention, what waits, what happened, the oldest', async () => {
  const r = await run(handoverWorld());
  assert.equal(r.id, 'handover');
  const d = r.data;
  assert.equal(d.available, true);
  assert.equal(d.hours, 12);
  assert.equal(d.until - d.since, 12 * 3600000);
  assert.equal(d.snapshot.open, 15, 'five per table, three tables');
  assert.equal(d.snapshot.breached, 1);
  assert.equal(d.snapshot.atRisk, 1);
  assert.equal(d.snapshot.dueSoon, 1, 'the SLA that has not breached ends within four hours of NOW; a breached one is not "due soon"');
  assert.equal(d.snapshot.unassigned, 15);
  // the SLA list: breached first, with the ticket behind it
  assert.deepEqual(d.sla.top.map((t) => [t.number, t.risk]), [['INC0010001', 'Breached'], ['INC0010002', 'At risk']]);
  assert.equal(d.sla.top[0].owner, PRIYA);
  // waiting, by what it waits for
  assert.equal(d.waiting.total, 12, 'four waiting states of 1-2 tickets, three tables');
  assert.equal(d.waiting.customer, 6);
  assert.equal(d.waiting.approval, 3);
  assert.equal(d.waiting.other, 3);
  assert.deepEqual(d.waiting.byState.map((s) => s.label), ['Awaiting Caller', 'Awaiting Approval', 'On Hold']);
  assert.equal(d.waiting.approvals.mine, 5);
  assert.equal(d.waiting.approvals.team, 5);
  assert.deepEqual(d.waiting.oldest.map((t) => t.number).sort(), ['INC0010004', 'INC0010005']);
  // events
  assert.equal(d.events.opened.available, true);
  assert.deepEqual(d.events.opened.items.map((t) => t.number), ['INC0010001', 'INC0010004', 'INC0010002'], 'most urgent first, then newest');
  assert.deepEqual(d.events.resolved.items.map((t) => t.number), ['INC0010003']);
  assert.equal(d.events.breaches.total, 2);
  assert.deepEqual(d.events.breaches.items.map((t) => t.number), ['INC0010003']);
  assert.deepEqual(d.events.reassigned.items.map((t) => [t.number, t.reassignments]), [['INC0010001', 4]]);
  assert.equal(d.oldest[0].number, 'INC0010005');
  assert.equal(d.oldest[0].ageDays, 7);
  assert.deepEqual(d.waiting.oldest[0].number, 'INC0010005', 'the oldest waiting ticket first');
  // plain JSON, nothing internal left on the items
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  for (const item of [...d.oldest, ...d.events.opened.items, ...d.sla.top]) assert.equal('openedMs' in item, false);
});

test('the blocked tables of the organisation are never asked, and the page says they are blocked', async () => {
  const inst = handoverWorld();
  const r = await runReport({ kind: 'section', section: 'handover', scope: { kind: 'groups' }, tables: TABLES, params: {}, }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0, blocked: ['incident', 'sc_task'] });
  assert.equal(inst.callsTo('incident').length, 0);
  assert.equal(inst.callsTo('sc_task').length, 0);
  assert.ok(r.tables.some((t) => t.table === 'incident' && t.status === 'blocked'));
  assert.equal(r.data.snapshot.open, 5, 'only requested items were counted');
});

test('the period moves the dates the queries use', async () => {
  const inst12 = handoverWorld();
  await run(inst12, { hours: 12 });
  assert.ok(inst12.callsTo('incident', 'opened_at>=2026-10-27 00:00:00').length > 0, '12 hours before NOW is midnight');
  const inst8 = handoverWorld();
  const r8 = await run(inst8, { hours: 8 });
  assert.equal(r8.data.hours, 8);
  assert.ok(inst8.callsTo('incident', 'opened_at>=2026-10-27 04:00:00').length > 0);
  assert.ok(inst8.callsTo('task_sla', 'planned_end_time>=2026-10-27 04:00:00^planned_end_time<=2026-10-27 12:00:00').length > 0, 'breaches are looked for inside the period only');
  const r24 = await run(handoverWorld(), { hours: 24 });
  assert.equal(r24.data.hours, 24);
  assert.equal((await run(handoverWorld(), { hours: 99 })).data.hours, 12);
});

test('every read is a GET-shaped query and urgent means priority 1 or 2', async () => {
  const inst = handoverWorld();
  await run(inst);
  const opened = inst.callsTo('incident', 'opened_at>=').filter((c) => c.query.includes('priorityIN'));
  assert.ok(opened.length > 0);
  assert.ok(opened.every((c) => c.query.includes('priorityIN1,2')));
  assert.ok(opened.every((c) => c.query.startsWith(`assignment_groupIN${GROUP_A}`)), 'the scope is always in front');
  assert.ok(inst.calls.every((c) => c.kind === 'query' || c.kind === 'aggregate'));
});

test('reads are bounded: short lists, and the requester name column is read for the lists only', async () => {
  const inst = handoverWorld();
  await run(inst);
  const lists = inst.calls.filter((c) => c.kind === 'query' && c.table === 'incident' && c.query !== '');
  assert.ok(lists.length <= 6, `${lists.length} list reads on the incident table`);
  assert.ok(lists.every((c) => c.options.limit <= 8), 'no list asks for more than eight rows');
  assert.ok(lists.every((c) => c.fields.includes('opened_by') && !c.fields.includes('description') && !c.fields.includes('work_notes')));
});

test('without SLA access the page still works and says so; the SLA numbers are null, never 0', async () => {
  const r = await run(handoverWorld({ denied: ['task_sla'] }));
  const d = r.data;
  assert.equal(d.available, true);
  assert.equal(d.sla.available, false);
  assert.equal(d.snapshot.breached, null);
  assert.equal(d.snapshot.atRisk, null);
  assert.equal(d.events.breaches.available, false);
  assert.equal(d.events.breaches.total, null);
  assert.ok(r.access.some((a) => a.source === 'task_sla' && /not available to you/i.test(a.note)));
  assert.equal(d.snapshot.open, 15, 'the rest is unaffected');
});

test('a table the person cannot read is left out and named; a scope with no usable table says there is nothing to hand over', async () => {
  const some = await run(handoverWorld({ denied: ['sc_task'] }));
  assert.equal(some.data.snapshot.open, 10);
  assert.ok(some.tables.some((t) => t.table === 'sc_task' && t.status === 'denied'));
  const none = await run(handoverWorld({ denied: TABLES }));
  assert.equal(none.data.available, false);
  assert.match(none.data.reason, /No ticket table can be read/);
  assert.deepEqual(resultTables(none), []);
});

test('an empty scope never runs wide open', async () => {
  const inst = handoverWorld({ denied: ['sys_user_grmember'], rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'assigned_to' , then: [] }] });
  const r = await run(inst, {}, { kind: 'groups' });
  // memberships unreadable and no ticket names a group: the engine stops before reading any list
  assert.equal(r.data.available, false);
  assert.equal(r.data.emptyScope, true);
});

test('tables without a resolved date or reassignment count say what is missing', async () => {
  const r = await run(handoverWorld({ missingColumns: ['resolved_at', 'closed_at', 'reassignment_count'] }));
  assert.equal(r.data.events.resolved.available, false);
  assert.equal(r.data.events.reassigned.available, false);
  assert.ok(r.notes.some((n) => /resolved date/.test(n)));
  assert.ok(r.notes.some((n) => /Reassignment counts are not available/.test(n)));
});

test('the page exports as tables for CSV, print and copy, with the assignee column marked as a person', async () => {
  const r = await run(handoverWorld());
  const tables = resultTables(r);
  assert.equal(tables[0].title, 'Shift handover');
  assert.ok(tables[0].rows.some((row) => row.measure === 'Open' && row.value === 15));
  const sla = tables.find((t) => t.title === 'Closest to breaking');
  assert.ok(sla.columns.find((c) => c.key === 'owner').person === true);
  assert.ok(tables.some((t) => /opened in the last 12 hours/.test(t.title)));
  const failed = await run(handoverWorld({ denied: ['task_sla'] }));
  assert.ok(resultTables(failed)[0].rows.some((row) => row.value === 'n/a'), 'a missing number is n/a, not 0');
});

test('reportRun accepts the section and the hours through the operation, and rejects the two panel-only ids', async () => {
  const inst = handoverWorld();
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER, firstName: 'A', lastName: 'B' }), runtime: createRuntime() });
  const r = await ops.reportRun({ section: 'handover', scope: { kind: 'groups' }, tables: TABLES, params: { hours: 24, junk: 1 } });
  assert.equal(r.data.hours, 24);
  for (const section of ['coaching', 'insights']) await assert.rejects(() => ops.reportRun({ section, scope: { kind: 'mine' } }), /does not exist/, section);
  await assert.rejects(() => ops.reportRun({ section: 'nope' }), /does not exist/);
});

// ---- Picking the notable tickets ------------------------------------------------------------------------------------------

const item = (n, extra = {}) => ({ table: 'incident', kind: 'incident', sysId: id(n), number: `INC${n}`, title: `t${n}`, priority: '1 - Critical', priorityValue: '1', state: 'In Progress', owner: `Owner ${n}`, group: 'Desk', maskNames: [], ...extra });
const data = (over = {}) => ({
  available: true,
  hours: 12,
  sla: { available: true, top: [] },
  events: { opened: { items: [] }, resolved: { items: [] }, breaches: { items: [] }, reassigned: { items: [] } },
  waiting: { oldest: [] },
  oldest: [],
  ...over,
});

test('the notable tickets come in a fixed order, once each, with every reason', () => {
  const d = data({
    sla: { top: [item(1, { risk: 'At risk', percent: 88 }), item(2, { risk: 'Breached', percent: 120 })] },
    events: { opened: { items: [item(1), item(3, { priorityValue: '2' })] }, resolved: { items: [item(4)] }, breaches: { items: [item(2)] }, reassigned: { items: [item(5, { reassignments: 6 })] } },
    waiting: { oldest: [item(6, { ageDays: 9 })] },
    oldest: [item(6, { ageDays: 9 }), item(7, { ageDays: 20 })],
  });
  const picked = pickNotable(d);
  assert.deepEqual(picked.map((t) => t.number), ['INC2', 'INC1', 'INC3', 'INC4', 'INC5', 'INC6', 'INC7']);
  assert.deepEqual(picked[0].reasons, ['SLA breached', 'SLA breached during the last 12 hours']);
  assert.deepEqual(picked[1].reasons, ['P1 opened in the last 12 hours', 'SLA at risk (88% of the time used)']);
  assert.ok(picked[2].reasons[0].startsWith('P2 opened'));
  assert.deepEqual(picked[4].reasons, ['handed over 6 times']);
  assert.deepEqual(picked[5].reasons, ['one of the oldest waiting (9 days old)', 'one of the oldest open (9 days old)']);
  assert.deepEqual(pickNotable(d), picked, 'the same data gives the same list');
});

test('at most fifteen tickets are picked, the first fifteen in order, and bad input gives nothing', () => {
  const many = Array.from({ length: 40 }, (_, i) => item(i + 1));
  assert.equal(pickNotable(data({ oldest: many })).length, NOTABLE_MAX);
  assert.equal(NOTABLE_MAX, 15);
  assert.deepEqual(pickNotable(data({ oldest: many }), 3).map((t) => t.number), ['INC1', 'INC2', 'INC3']);
  for (const bad of [null, undefined, {}, { available: false }, 'x']) assert.deepEqual(pickNotable(bad), []);
  assert.deepEqual(pickNotable(data({ oldest: [{ title: 'no number' }, null, undefined] })), []);
  assert.deepEqual(pickNotable(data({ oldest: many }), 0), []);
});

// ---- The pack and its parts ----------------------------------------------------------------------------------------------

test('the pack is a report, not a ticket: table "report", people from the listed tickets, figures with their gaps', async () => {
  const r = await run(handoverWorld());
  const pack = buildHandoverPack(r);
  assert.equal(pack.table, 'report');
  assert.equal(pack.sysId, 'handover');
  assert.equal(pack.version, 1);
  assert.equal(pack.requirePreview, true, 'new tickets every shift: the preview is shown every time');
  assert.deepEqual(pack.fields, {});
  assert.deepEqual(pack.journal, []);
  const names = pack.people.map((p) => p.name);
  for (const name of [PRIYA, MARCUS, ABEL, DANA]) assert.ok(names.includes(name), `${name} is on pack.people`);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'once each');
  assert.ok(pack.report.tickets.length <= NOTABLE_MAX);
  assert.equal(pack.report.scope, 'My groups (1): Service Desk');
  assert.equal(pack.report.hours, 12);
  assert.ok(pack.report.figures.every((f) => typeof f.label === 'string'));
  const noSla = buildHandoverPack(await run(handoverWorld({ denied: ['task_sla'] })));
  assert.equal(noSla.report.figures.find((f) => f.label === 'SLA breached now').value, null);
  assert.ok(noSla.report.notes.length > 0 && noSla.report.notes.length <= 6);
});

test('the parts hold the figures and the ticket lines; a missing figure reads "not available", never 0', async () => {
  const pack = buildHandoverPack(await run(handoverWorld({ denied: ['task_sla'] })));
  const parts = handoverParts(pack);
  assert.deepEqual(parts.map((p) => p.field), ['handover_figures', 'handover_tickets']);
  assert.match(parts[0].text, /SLA breached now: not available/);
  assert.match(parts[0].text, /Open tickets: 15/);
  assert.match(parts[0].text, /Team and scope: My groups \(1\): Service Desk/);
  assert.match(parts[1].text, /INC0010001 \(incident\) \| priority: 1 - Critical \| state: In Progress \| group: Service Desk \| assigned to: Priya Raman/);
  assert.match(parts[1].text, /flagged because: /);
  for (const p of parts) assert.ok(p.text.length <= 6000 && p.text.trim());
});

test('the ticket titles go in as one quoted line each, with markup and newlines flattened', () => {
  const r = { scope: { label: 'Mine', groups: [] }, data: data({ oldest: [item(1, { title: 'Line one\n<b>line</b> "two"\r\nthree', ageDays: 3 })] }), access: [], notes: [], tables: [], caps: [] };
  const [, tickets] = handoverParts(buildHandoverPack(r));
  const lines = tickets.text.split('\n').filter((l) => l.startsWith('1.'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /short description: "Line one line 'two' three"/);
});

test('a field the organisation blocks is left out of the ticket lines, and its names stay on the people list', async () => {
  const r = await run(handoverWorld());
  const pack = buildHandoverPack(r, { blockedFields: ['Short_Description', 'assigned_to', 'assignment_group'] });
  const text = handoverParts(pack).map((p) => p.text).join('\n');
  assert.ok(!text.includes('short description:'), 'no titles');
  assert.ok(!text.includes(HANDOVER_TITLES[1]));
  assert.ok(!text.includes(PRIYA) && !text.includes('Service Desk'), 'no assignee and no group');
  assert.match(text, /assigned to: nobody/);
  assert.ok(pack.people.some((p) => p.name === PRIYA), 'still masked wherever else the name turns up');
  const noState = handoverParts(buildHandoverPack(r, { blockedFields: ['state', 'priority'] })).map((p) => p.text).join('\n');
  assert.ok(!/state: |priority: 1/.test(noState.split('Notable tickets')[1]));
});

test('no pack when there is nothing to hand over', async () => {
  assert.equal(buildHandoverPack(null), null);
  assert.equal(buildHandoverPack({}), null);
  assert.equal(buildHandoverPack({ data: { available: false } }), null);
  assert.equal(buildHandoverPack(await run(handoverWorld({ denied: TABLES }))), null);
  assert.deepEqual(handoverParts(null), []);
  assert.deepEqual(handoverParts({ report: { kind: 'other' } }), []);
});

test('an empty hand-over still produces parts that say so (the model must not take silence for "all clear")', () => {
  const r = { scope: { label: 'Mine', groups: [] }, data: data({ snapshot: { open: 0, breached: 0, atRisk: 0, dueSoon: 0, stale: 0, staleDays: 3 }, waiting: { total: 0, oldest: [] }, events: { opened: { total: 0, items: [] } } }), access: [], notes: [], tables: [], caps: [] };
  const parts = handoverParts(buildHandoverPack(r));
  assert.match(parts[1].text, /No notable tickets were found in the data\./);
  assert.match(parts[0].text, /Open tickets: 0/);
});

test('a person shown as a raw id (the display value could not be read) is not put on the people list as if it were a name', () => {
  const r = { scope: { label: 'Mine', groups: [] }, data: data({ oldest: [item(1, { owner: id(7), maskNames: [id(8), 'Real Name', 'a'] })] }), access: [], notes: [], tables: [], caps: [] };
  assert.deepEqual(buildHandoverPack(r).people.map((p) => p.name), ['Real Name']);
});

test('the injected text in a title is carried as data only: it never reaches the prompt-shaped fields', async () => {
  const pack = buildHandoverPack(await run(handoverWorld()));
  const ticketText = handoverParts(pack)[1].text;
  assert.ok(ticketText.includes(INJECTION.slice(0, 20)));
  assert.ok(!JSON.stringify(pack.people).includes('PWNED'));
});

// ---- The answer check ---------------------------------------------------------------------------------------------------

test('the note check counts words and finds the headings that did not come back', () => {
  const good = `${HANDOVER_HEADINGS.map((h) => `${h}\n- fine`).join('\n')}`;
  assert.deepEqual(checkHandoverNote(good), { words: 22, tooLong: false, missing: [], ok: true });
  const bulleted = `**Headline:** x\n- Needs attention now: y\nWaiting on others:\n## Watch during the next shift:\nNotes for the incoming team:`;
  assert.deepEqual(checkHandoverNote(bulleted).missing, []);
  const partial = checkHandoverNote('Headline: all quiet.\nNotes for the incoming team: none');
  assert.deepEqual(partial.missing, ['Needs attention now:', 'Waiting on others:', 'Watch during the next shift:']);
  assert.equal(partial.ok, false);
  const long = checkHandoverNote(`${good}\n${'word '.repeat(250)}`);
  assert.equal(long.tooLong, true);
  assert.ok(long.words > 220);
  assert.equal(checkHandoverNote('').words, 0);
  assert.equal(checkHandoverNote(null).missing.length, 5);
});
