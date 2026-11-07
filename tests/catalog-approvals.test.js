import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalChase } from '../src/checks/approvalChase.js';
import { buildRequestView, requestExplainParts } from '../src/checks/requestView.js';
import { readContextPack } from '../src/context/pack.js';
import { formatSnTime } from '../src/context/util.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_CATALOG } from '../src/i18n/ar/catalog.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { RITM_ID, approvalRows } from './fixtures/sn-requested-item.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { DAVE } from './fixtures/sn-users.js';

// Wave 6, the catalog fulfiller: the approval chase. Inside the Request card's status line: who the request is waiting on and for how long
// ("Waiting on Dana Lee for 3 days"), the one waited on longest when there are several, a group named for a group approval, and only who
// when the time cannot be read. The time is the approval's creation time (sys_updated_on moves whenever anyone touches the row). No reminder
// button; nothing is sent.

registerCatalogue('ar', AR_CATALOG); // (until the lead wires it into src/i18n/ar/index.js)
test.afterEach(() => setLanguage('en'));

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 7, 12);
const ago = (ms) => formatSnTime(NOW - ms);
const row = (who, state, createdUtc, extra = {}) => ({ approver: who, group: '', state, updated: '2026-11-07 08:00:00', createdUtc, ...extra });
const packWith = (approvals, fields = {}) => ({ kind: 'requested_item', table: 'sc_req_item', fields: { number: 'RITM0010050', state: 'Work in Progress', approval: 'requested', ...fields }, related: { approvals }, access: [], people: [] });

// ---- the read: the creation time, for the panel only ----------------------------------------------------------------------------------------

test('the approvals are read with the time they were asked for, kept as stored (UTC), and it reaches no prompt', async () => {
  const tables = buildInstance();
  tables.sysapproval_approver = approvalRows().map((r) => (r.state.value === 'requested' ? { ...r, sys_created_on: v('2026-01-02 03:04:05', '2026-01-02 05:04:05') } : r));
  const deps = fakeDeps(tables);
  const pack = await readContextPack({ table: 'sc_req_item', sysId: RITM_ID }, deps, { feature: 'request-status' });
  const asked = deps.callsTo('sysapproval_approver')[0].fields;
  assert.ok(asked.includes('sys_created_on'), 'one more column of a read that was already made, no new read');
  assert.equal(deps.callsTo('sysapproval_approver').length, 1);
  const waiting = pack.related.approvals.find((a) => a.state === 'Requested');
  assert.equal(waiting.createdUtc, '2026-01-02 03:04:05', 'the stored value, not the reader\'s display of it');
  assert.equal(waiting.updated, '2026-10-24 08:00:00', 'the last update is still there, as it was');
  // the AI's copy names the fields it sends: the creation time is not one
  const sent = JSON.stringify(requestExplainParts(pack));
  assert.ok(!sent.includes('03:04:05') && !sent.includes('createdUtc'), sent.slice(0, 200));
});

// ---- the line ----------------------------------------------------------------------------------------------------------------------------

test('one approval waiting: who, and for how long in words', () => {
  const at = (ms) => approvalChase(packWith([row('Dana Lee', 'Requested', ago(ms))]), { now: NOW });
  assert.equal(at(3 * DAY + 5 * HOUR).line, 'Waiting on Dana Lee for 3 days.');
  assert.equal(at(DAY).line, 'Waiting on Dana Lee for 1 day.');
  assert.equal(at(5 * HOUR).line, 'Waiting on Dana Lee for 5 hours.');
  assert.equal(at(12 * MIN).line, 'Waiting on Dana Lee for 12 minutes.');
  assert.equal(at(10 * 1000).line, 'Waiting on Dana Lee for under a minute.');
  const out = at(3 * DAY + 5 * HOUR);
  assert.deepEqual([out.who, out.named, out.ms, out.others], ['Dana Lee', true, 3 * DAY + 5 * HOUR, 0]);
});

test('a group approval names the group; an approver and a group on one row: the person to chase is the approver', () => {
  assert.equal(approvalChase(packWith([row('', 'Requested', ago(2 * DAY), { group: 'IT Procurement' })]), { now: NOW }).line, 'Waiting on IT Procurement for 2 days.');
  assert.equal(approvalChase(packWith([row('Dana Lee', 'Requested', ago(2 * DAY), { group: 'IT Procurement' })]), { now: NOW }).line, 'Waiting on Dana Lee for 2 days.');
  const nobody = approvalChase(packWith([row('', 'Requested', ago(2 * DAY))]), { now: NOW });
  assert.equal(nobody.line, 'Waiting on an approver you cannot see for 2 days.');
  assert.equal(nobody.named, false);
});

test('several waiting: the one waited on longest is named, and the others are counted', () => {
  const rows = [row('Erin Contact', 'Requested', ago(1 * DAY)), row('Dana Lee', 'Requested', ago(4 * DAY)), row('Hana Rivera', 'Requested', ago(2 * DAY))];
  const out = approvalChase(packWith(rows), { now: NOW });
  assert.equal(out.line, 'Waiting on Dana Lee for 4 days. 2 other approvals are also waiting.');
  assert.equal(out.others, 2);
  assert.equal(approvalChase(packWith(rows.slice(0, 2)), { now: NOW }).line, 'Waiting on Dana Lee for 4 days. 1 other approval is also waiting.');
  // approved and rejected rows are not waiting: they are not counted
  const mixed = [row('Dave Loftus', 'Approved', ago(9 * DAY)), row('Dana Lee', 'Requested', ago(4 * DAY)), row('Bo Chen', 'Cancelled', ago(8 * DAY))];
  assert.equal(approvalChase(packWith(mixed), { now: NOW }).line, 'Waiting on Dana Lee for 4 days.');
});

test('a time that cannot be read: who, not how long (never the last update in its place)', () => {
  for (const createdUtc of ['', 'yesterday', undefined]) {
    const out = approvalChase(packWith([row('Dana Lee', 'Requested', createdUtc)]), { now: NOW });
    assert.equal(out.line, 'Waiting on Dana Lee.', JSON.stringify(createdUtc));
    assert.equal(out.ms, null);
  }
  // one of several has a time: the oldest of the ones that have one is named
  const some = [row('Erin Contact', 'Requested', ''), row('Dana Lee', 'Requested', ago(4 * DAY))];
  assert.equal(approvalChase(packWith(some), { now: NOW }).line, 'Waiting on Dana Lee for 4 days. 1 other approval is also waiting.');
  // none has one: the first that is named, and no time
  const none = [row('', 'Requested', ''), row('Erin Contact', 'Requested', '')];
  assert.equal(approvalChase(packWith(none), { now: NOW }).line, 'Waiting on Erin Contact. 1 other approval is also waiting.');
  // a time ahead of the clock by more than a clock can be out: not a wait
  assert.equal(approvalChase(packWith([row('Dana Lee', 'Requested', formatSnTime(NOW + 2 * HOUR))]), { now: NOW }).line, 'Waiting on Dana Lee.');
  assert.equal(approvalChase(packWith([row('Dana Lee', 'Requested', formatSnTime(NOW + 2 * MIN))]), { now: NOW }).line, 'Waiting on Dana Lee for under a minute.');
});

test('nothing is said when no approval is waiting, or the approvals were not read', () => {
  assert.equal(approvalChase(packWith([]), { now: NOW }), null);
  assert.equal(approvalChase(packWith([row('Dave Loftus', 'Approved', ago(DAY))]), { now: NOW }), null);
  assert.equal(approvalChase(packWith([row('Dave Loftus', 'Rejected', ago(DAY))]), { now: NOW }), null);
  assert.equal(approvalChase({ kind: 'requested_item', related: {} }, { now: NOW }), null);
  assert.equal(approvalChase(null), null);
});

test('in Arabic', () => {
  setLanguage('ar');
  const out = approvalChase(packWith([row('Dana Lee', 'Requested', ago(3 * DAY + HOUR)), row('Erin Contact', 'Requested', ago(DAY))]), { now: NOW });
  assert.match(out.line, /^بانتظار .*Dana Lee.* منذ .*\./);
  assert.match(out.line, /موافقة أخرى واحدة بانتظار الرد أيضا\.$/);
  assert.match(approvalChase(packWith([row('Dana Lee', 'Requested', '')]), { now: NOW }).line, /^بانتظار .*Dana Lee.*\.$/);
});

// ---- in the request view -------------------------------------------------------------------------------------------------------------------

test('the view carries the line only while the status itself is an approval wait', () => {
  const waiting = buildRequestView(packWith([row('Dana Lee', 'Requested', ago(3 * DAY))]), { now: NOW });
  assert.equal(waiting.status.state, 'approval');
  assert.equal(waiting.waiting.line, 'Waiting on Dana Lee for 3 days.');
  // the status line is untouched (it is also what the AI's status message is written from)
  assert.match(waiting.status.line, /^Waiting for approval from Dana Lee/);
  // a rejection comes first in the status: no wait is dressed over it
  const rejected = buildRequestView(packWith([row('Dave Loftus', 'Rejected', ago(DAY)), row('Dana Lee', 'Requested', ago(3 * DAY))]), { now: NOW });
  assert.equal(rejected.status.state, 'rejected');
  assert.equal(rejected.waiting, null);
  // a finished request
  assert.equal(buildRequestView(packWith([row('Dana Lee', 'Requested', ago(3 * DAY))], { state: 'Closed Complete' }), { now: NOW }).waiting, null);
  // the approvals could not be read: the status says so, and there is no wait to word
  assert.equal(buildRequestView({ kind: 'requested_item', fields: { approval: 'requested', state: 'Work in Progress' }, related: {}, access: [{ source: 'sysapproval_approver', status: 'denied', note: '' }] }, { now: NOW }).waiting, null);
});

// ---- the card ------------------------------------------------------------------------------------------------------------------------------------

const record = { table: 'sc_req_item', sysId: RITM_ID, number: 'RITM0010050', kind: 'requested_item' };
const page = { status: 'record', tabId: 901, href: `https://acme.service-now.com/sc_req_item.do?sys_id=${RITM_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
const eff = () => ({ ready: true, values: { profiles: ['req'] }, locked: {}, policy: normalizePolicy({}) });
const Request = INSIGHT_CARDS.find((c) => c.id === 'request').Card;

async function mountRequest(approvals, report = {}) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('pack', () => packWith(approvals, { stage: 'waiting_for_approval' }));
  const ui = await mount(<Request page={page} eff={eff()} record={record} header={{ number: 'RITM0010050' }} active setSummary={(s) => (report.summary = s)} setAttention={(a) => (report.attention = a)} />);
  await settle(6);
  return { ui, fake };
}

test('the Request card says it in its status line and adds the time to the one line of the row; no reminder, no button of its own', async () => {
  const now = Date.now();
  const report = {};
  const { ui } = await mountRequest([row('Dana Lee', 'Requested', formatSnTime(now - (3 * DAY + 5 * HOUR)))], report);
  try {
    assert.equal(ui.$('[data-fact="approval-wait"]').textContent, 'Waiting on Dana Lee for 3 days.');
    assert.equal(report.summary, 'Chase: Dana Lee (approval) · waiting 3 days');
    assert.ok(!/Remind|Send|Nudge/i.test(ui.text()), 'no reminder');
    const buttons = ui.$$('button').map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    assert.ok(buttons.includes('Refresh') && buttons.every((b) => /^(Approvals|Catalog tasks|Answers to the request questions|Refresh)/.test(b)), `the buttons it always had: ${buttons.join(' | ')}`);
  } finally {
    await ui.unmount();
  }
});

test('with no readable time the card says who and the row\'s line is as it was', async () => {
  const report = {};
  const { ui } = await mountRequest([row('Dana Lee', 'Requested', '')], report);
  try {
    assert.equal(ui.$('[data-fact="approval-wait"]').textContent, 'Waiting on Dana Lee.');
    assert.equal(report.summary, 'Chase: Dana Lee (approval)');
  } finally {
    await ui.unmount();
  }
});

test('with no approval waiting the card shows the status line it always showed', async () => {
  const { ui } = await mountRequest([row('Dave Loftus', 'Approved', ago(DAY))]);
  try {
    assert.equal(ui.$('[data-fact="approval-wait"]'), null);
    assert.ok(ui.$('.ab-ins-line'));
    // the Approvals group still lists the rows when it is opened
    await click(ui.button(/^Approvals/));
    assert.match(ui.text(), new RegExp(DAVE.name));
  } finally {
    await ui.unmount();
  }
});
