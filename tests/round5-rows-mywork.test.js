import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import MyWorkView from '../src/sidepanel/mywork/MyWorkView.jsx';
import { myWorkRows, myWorkSummary, riskKind } from '../src/sidepanel/mywork/rows.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { HOUR, DAY } from '../src/mywork/time.js';

// Round 5, board A (docs/round5.md): My work opens on FIVE rows. Each row says one finding and the number it stands for, a row with
// nothing to report is a calm sentence (the row still shows), a number that cannot be read is never a zero, and everything of today's
// screen stays reachable ("All N open tickets, with filters").

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const USER = '46d44a23a9fe19810012d100cca80666';
const M = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };
const SLA_BREACHED = { breached: true, paused: false, percentage: 140, dueAt: NOW - DAY, risk: 'breached' };
const SLA_RISK = { breached: false, paused: false, percentage: 80, dueAt: NOW + HOUR, risk: 'at-risk' };
const customerWrote = (agoMs) => ({ ...M, lastCustomerAt: NOW - agoMs, lastAt: NOW - agoMs, replied: 'customer' });

let n = 0;
function item(over = {}) {
  n += 1;
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, 'a'), number: `INC00${String(n).padStart(5, '0')}`, title: `Ticket ${n}`, priority: '3 - Moderate', state: 'In Progress', holdReason: '', work: 'open', updatedAt: NOW - 2 * HOUR, openedAt: NOW - DAY, ci: null, group: null, sla: null, marker: M, ...over };
}
const queueOf = (items, over = {}) => ({ items, totals: {}, total: items.length, more: false, empty: items.length ? null : 'nothing', names: {}, listQuery: `assigned_to=${USER}^active=true`, ...over });
const dataOf = (items, over = {}) => ({
  version: 1,
  readAt: NOW,
  queue: queueOf(items, over.queue),
  approvals: { items: [], total: 0, listQuery: '' },
  groups: { groups: [{ id: 'g'.repeat(32), name: 'Service Desk' }], items: [], total: 0, more: false, listQuery: '', names: {}, note: '' },
  access: [],
});
const rowsOf = (items, over) => myWorkRows(dataOf(items, over), { now: NOW, policy: normalizePolicy({}) });

// ---- the numbers of the five rows -----------------------------------------------------------------------------------------------------

test('needs you now: the breached SLAs and the customers who have waited for days for an answer, each ticket once', () => {
  const breached = item({ sla: SLA_BREACHED });
  const bothAndOld = item({ sla: SLA_BREACHED, marker: customerWrote(3 * DAY) }); // breached AND answered late: counted once, as breached
  const waitingDays = item({ marker: customerWrote(3 * DAY) });
  const fresh = item({ marker: customerWrote(HOUR) }); // wrote an hour ago: that is the third row, not this one
  const plain = item();
  const m = rowsOf([breached, bothAndOld, waitingDays, fresh, plain]);
  assert.equal(m.rows.needs.count, 3);
  assert.equal(m.rows.needs.line, '2 SLAs breached · 1 customer waiting for your answer');
  assert.equal(m.rows.needs.level, 'danger');
  assert.deepEqual(new Set(m.rows.needs.items.map((i) => i.sysId)), new Set([breached, bothAndOld, waitingDays].map((i) => i.sysId)));
  assert.equal(m.needing, 3);
});

test('at risk today: what the "At risk" rule finds, without the tickets of the first row, said by kind', () => {
  const close = item({ sla: SLA_RISK });
  const bounced = item({ reassignments: 3 });
  const reopened = item({ reopens: 1 });
  const vip = item({ vip: true });
  const breached = item({ sla: SLA_BREACHED }); // in the first row, not here
  const m = rowsOf([close, bounced, reopened, vip, breached]);
  assert.equal(m.rows.risk.count, 4);
  assert.equal(m.rows.risk.line, '1 close to breaching, 2 reopened or handed on often, 1 for an important customer');
  assert.equal(m.rows.risk.level, 'warn');
  assert.ok(!m.rows.risk.items.some((i) => i.sysId === breached.sysId));
  assert.equal(riskKind({ atRisk: [{ id: 'reopened' }, { id: 'sla' }] }), 'sla', 'the first kind that fits');
});

test('replied to you: the customer (or someone else) wrote after your last comment, less than two days ago', () => {
  const customer = item({ marker: customerWrote(3 * HOUR) });
  const other = item({ marker: { ...M, lastOtherAt: NOW - HOUR, lastAt: NOW - HOUR, replied: 'other' } });
  const resolved = item({ work: 'resolved', state: 'Resolved', marker: customerWrote(HOUR) }); // finished: nothing to answer
  const m = rowsOf([customer, other, resolved, item()]);
  assert.equal(m.rows.replied.count, 2);
  assert.equal(m.rows.replied.line, '1 customer wrote back after your last comment · 1 new comment from someone else');
});

test('waiting on others: on hold, on the customer or others, and how long the longest has waited', () => {
  const onCustomer = item({ work: 'waiting-customer', state: 'On Hold', marker: { ...M, lastAt: NOW - 6 * DAY } });
  const onVendor = item({ work: 'on-hold', state: 'On Hold', updatedAt: NOW - 2 * DAY });
  const m = rowsOf([onCustomer, onVendor, item()]);
  assert.equal(m.rows.waiting.count, 2);
  assert.equal(m.rows.waiting.line, '2 tickets, waiting longest 6 d');
  assert.equal(m.rows.waiting.items[0].sysId, onCustomer.sysId, 'the one that has waited longest first');
});

test('same cause?: three or more of my tickets on one configuration item, the existing wording', () => {
  const ci = { id: 'c'.repeat(32), name: 'VPN Gateway EU' };
  const m = rowsOf([item({ ci }), item({ ci }), item({ ci }), item({ ci: { id: 'd'.repeat(32), name: 'Printer' } })]);
  assert.equal(m.rows.cause.count, 3);
  assert.equal(m.rows.cause.line, '3 of your tickets are on VPN Gateway EU. One cause?');
  assert.equal(m.rows.cause.items.length, 3);
});

test('a row with nothing to report is a calm sentence with a zero, and the five rows are always there', () => {
  const m = rowsOf([item()]);
  assert.deepEqual(Object.keys(m.rows), ['needs', 'risk', 'replied', 'waiting', 'cause']);
  assert.equal(m.rows.needs.line, 'Nothing is breached and no customer is waiting.');
  assert.equal(m.rows.risk.line, 'No ticket is at risk today.');
  assert.equal(m.rows.replied.line, 'No one has written back since your last comment.');
  assert.equal(m.rows.waiting.line, 'Nothing is waiting on others.');
  assert.equal(m.rows.cause.line, 'None of your tickets are on the same item.');
  assert.deepEqual(Object.values(m.rows).map((r) => r.count), [0, 0, 0, 0, 0]);
  assert.equal(myWorkSummary(m), '1 open ticket. Nothing needs you first.');
});

test('honest: a read that could not be made is "could not be read" on every row, never a zero', () => {
  const m = rowsOf([], { queue: { empty: 'unread' } });
  assert.equal(m.unread, true);
  for (const row of Object.values(m.rows)) {
    assert.equal(row.count, null);
    assert.equal(row.line, 'Could not be read.');
  }
  assert.equal(myWorkSummary(m), '');
});

test('honest: comments that cannot be read leave "customers waiting" and "replied" unclaimed', () => {
  const blind = { ...M, known: false };
  const m = rowsOf([item({ marker: blind }), item({ marker: blind, sla: SLA_BREACHED })]);
  assert.equal(m.rows.replied.count, null);
  assert.equal(m.rows.replied.line, 'Replies could not be read.');
  assert.equal(m.rows.needs.line, '1 SLA breached · customers waiting could not be checked');
  const calm = rowsOf([item({ marker: blind })]);
  assert.equal(calm.rows.needs.line, 'Nothing is breached. Customers waiting could not be checked.');
});

test('the summary counts live tickets and says so when the list is cut', () => {
  const live = [item({ sla: SLA_BREACHED }), item(), item({ work: 'resolved', state: 'Resolved' })];
  assert.equal(myWorkSummary(rowsOf(live)), '2 open tickets. 1 needs you first.');
  assert.equal(myWorkSummary(rowsOf(live, { queue: { more: true } })), '2 or more open tickets. 1 needs you first.');
  assert.equal(myWorkSummary(rowsOf([])), 'Nothing is open for you.');
});

// ---- the screen -----------------------------------------------------------------------------------------------------------------------

const page = { status: 'other', tabId: 7, href: 'https://acme.service-now.com/now/nav/ui/home', surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth' } };
const eff = () => ({ ready: true, values: {}, locked: {}, policy: normalizePolicy({}) });
const mounted = [];
async function show(items, { opened = [] } = {}) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('myWork', () => ({ ...dataOf(items), readAt: Date.now() }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => opened.push(1)} />);
  mounted.push(ui);
  await settle(8);
  return { ui, fake };
}
afterEach(async () => {
  while (mounted.length) await mounted.pop().unmount().catch(() => {});
});

test('the screen: five rows, one finding each, the first one open with its tickets, a way to everything else under them', async () => {
  const now = Date.now();
  const breached = item({ title: 'Printer offline', sla: { ...SLA_BREACHED, dueAt: now - DAY } });
  const { ui } = await show([breached, item(), item()]);
  const rows = ui.$$('[data-row]');
  assert.deepEqual(rows.map((r) => r.getAttribute('data-row')), ['needs', 'risk', 'replied', 'waiting', 'cause']);
  assert.deepEqual(rows.map((r) => r.querySelector('.ab-ins-pain-title').textContent), ['Needs you now', 'At risk today', 'Replied to you', 'Waiting on others', 'Same cause?']);
  assert.ok(rows.every((r) => r.querySelector('.ab-fr-line').textContent.length > 0 && r.querySelector('.ab-fr-num')), 'a line and a number on every row');
  assert.equal(rows[0].querySelector('button').getAttribute('aria-expanded'), 'true', 'the first row has tickets: it opens');
  assert.equal(rows[1].querySelector('button').getAttribute('aria-expanded'), 'false');
  assert.match(rows[0].textContent, /Printer offline/);
  assert.match(ui.text(), /3 open tickets\. 1 needs you first\./);
  assert.ok(ui.hasButton('All 3 open tickets, with filters'));
  assert.ok(ui.hasButton(/^My week/));
  assert.match(ui.text(), /Stays in ServiceNow\. Nothing is sent anywhere\./);
  // Calm: a first screenful of few controls (there were 35 on today's screen).
  const controls = ui.$$('button, a, input, select', { all: true }).filter((el) => el.shown);
  assert.ok(controls.length <= 20, `${controls.length} controls`);
  assert.equal(ui.$$('.ab-cardx', { all: true }).length, 0, 'none of today\'s cards on the first screen');
});

test('a row opens in place and folds again; a row with nothing to list says so in the open row too', async () => {
  const { ui } = await show([item()]);
  const head = (id) => ui.$(`[data-row="${id}"] > button`);
  assert.equal(head('needs').getAttribute('aria-expanded'), 'false', 'nothing to list: folded');
  await click(head('waiting'));
  assert.equal(head('waiting').getAttribute('aria-expanded'), 'true');
  assert.match(ui.$('[data-row="waiting"]').textContent, /Nothing is waiting on others\./);
  await click(head('waiting'));
  assert.equal(head('waiting').getAttribute('aria-expanded'), 'false');
});

test('"All N open tickets, with filters" is today\'s screen, and Back returns to the five rows with the focus on the row that opened it', async () => {
  const { ui } = await show([item({ sla: SLA_BREACHED }), item()]);
  await click(ui.button('All 2 open tickets, with filters'));
  assert.ok(ui.$('[data-card="mywork-queue"]'), 'the queue card');
  assert.ok(ui.$('[data-card="mywork-groups"]'));
  assert.ok(ui.$('.ab-mw-auto input'), 'the read every 5 minutes stays reachable');
  assert.ok(!ui.$('[data-row="needs"]', { all: true }), 'the five rows are not drawn behind it');
  await click(ui.button('Back'));
  assert.equal(ui.$$('[data-row]').length, 5);
  assert.equal(document.activeElement?.textContent.trim().startsWith('All 2 open tickets'), true, 'the focus is back on the row that opened it');
});

test('"Same cause?" opens its tickets and "Show them" goes to the list with that filter on', async () => {
  const ci = { id: 'c'.repeat(32), name: 'VPN Gateway EU' };
  const { ui } = await show([item({ ci }), item({ ci }), item({ ci })]);
  await click(ui.$('[data-row="cause"] > button'));
  assert.equal(ui.$$('[data-row="cause"] a').length, 3);
  await click(ui.button('Show them'));
  assert.ok(ui.hasButton('On VPN Gateway EU 3'), 'the filter chip of the list');
});

test('"My week" opens the view of the reports agent (props { onBack }) and Back comes back', async () => {
  const { ui } = await show([item()]);
  await click(ui.button(/^My week/));
  assert.ok(ui.$('[data-view="week"]'), 'the view of the reports agent is mounted');
  assert.ok(!ui.$('[data-row="needs"]', { all: true }));
  await click(ui.button(/^(My work|Back)$/));
  assert.equal(ui.$$('[data-row]').length, 5);
});

test('a read that fails says so plainly and draws no row: nothing claims a number it did not read', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('myWork', () => {
    throw Object.assign(new Error('Nope'), { code: 'FAILED' });
  });
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  mounted.push(ui);
  await settle(8);
  assert.ok(ui.$('.ab-errnote, .ab-note-danger'), 'the plain error with its retry');
  assert.equal(ui.$$('[data-row]', { all: true }).length, 0, 'no row claims a number it did not read');
});
