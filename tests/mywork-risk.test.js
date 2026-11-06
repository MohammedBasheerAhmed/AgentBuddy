const test = require('node:test');
const assert = require('node:assert/strict');
import { riskReasons, riskLine, withRisk, waitingOnYouDays, RISK_LIMITS, REASON_ORDER } from '../src/mywork/risk.js';
import { groupQueue, filterChips, passes, isAtRisk, compareNow } from '../src/mywork/rank.js';
import { HOUR, DAY, MINUTE } from '../src/mywork/time.js';
import { columnsFor, riskColumnsFor, vipColumn, accountColumn, customerColumn, KNOWN_TABLES } from '../src/mywork/tables.js';
import { RISK_COLUMNS, VIP_COLUMNS, ACCOUNT_COLUMNS } from '../src/context/specs/mywork.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { kindForTable } from '../src/context/kinds.js';
import { walkTables } from '../src/content/policyGuard.js';
import { setLanguage } from '../src/i18n/index.js';

// Tickets at risk (round 4, docs/round4.md): the reasons, their thresholds and their words, the order of the queue with them, the
// filter chip, and the columns they are read from.

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const M = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };
const POLICY = { priorityAccounts: ['Boxeo', 'Acme Corp'] };

let n = 0;
const item = (over = {}) => {
  n += 1;
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, '0'), number: `INC${String(n).padStart(4, '0')}`, title: `t${n}`, priority: '3 - Moderate', state: 'In Progress', work: 'open', updatedAt: NOW - HOUR, openedAt: NOW - DAY, ci: null, sla: null, marker: M, reassignments: null, reopens: null, vip: null, account: '', ...over };
};
const sla = (over = {}) => ({ name: 'Resolution', breached: false, paused: false, percentage: 10, basis: 'business', dueAt: NOW + 10 * HOUR, risk: 'ok', ...over });
const replied = (ago, who = 'customer') => ({ ...M, [who === 'customer' ? 'lastCustomerAt' : 'lastOtherAt']: NOW - ago, lastAt: NOW - ago, replied: who });
const ids = (it) => riskReasons(it, { now: NOW, policy: POLICY }).map((r) => r.id);
const line = (it) => riskLine(riskReasons(it, { now: NOW, policy: POLICY }));

// ---- each reason and its threshold ---------------------------------------------------------------------------------------------

test('thresholds are named: reassigned 2 or more, reopened 1 or more, waiting on you 2 days or more', () => {
  assert.deepEqual({ ...RISK_LIMITS }, { reassignments: 2, reopens: 1, waitingDays: 2 });
  assert.deepEqual([...REASON_ORDER], ['reopened', 'reassigned', 'waiting', 'sla', 'vip', 'account']);
});

test('reassigned: from 2 times; 1 is not a bounce', () => {
  assert.deepEqual(ids(item({ reassignments: 1 })), []);
  assert.deepEqual(ids(item({ reassignments: 2 })), ['reassigned']);
  assert.equal(line(item({ reassignments: 2 })), 'Reassigned 2 times');
  assert.equal(line(item({ reassignments: 7 })), 'Reassigned 7 times');
});

test('reopened: from once', () => {
  assert.deepEqual(ids(item({ reopens: 0 })), []);
  assert.equal(line(item({ reopens: 1 })), 'Reopened once');
  assert.equal(line(item({ reopens: 2 })), 'Reopened twice');
  assert.equal(line(item({ reopens: 4 })), 'Reopened 4 times');
});

test('waiting on you: the customer wrote after my last comment, 2 whole days ago or more', () => {
  assert.deepEqual(ids(item({ marker: replied(2 * DAY - MINUTE) })), [], '1 day 23 h 59 min is not 2 days');
  assert.deepEqual(ids(item({ marker: replied(2 * DAY) })), ['waiting']);
  assert.equal(line(item({ marker: replied(4 * DAY + 5 * HOUR) })), 'Waiting on you 4 days');
  // On a ticket whose customer is not known, the newest word by someone else counts the same way ("New comment").
  assert.equal(line(item({ marker: replied(3 * DAY, 'other') })), 'Waiting on you 3 days');
  // Nobody wrote after me, the comments could not be read, or the ticket is resolved: nothing waits on me.
  assert.ok(Number.isNaN(waitingOnYouDays(item({ marker: { ...M, lastMineAt: NOW - HOUR, lastCustomerAt: NOW - 9 * DAY } }), NOW)));
  assert.deepEqual(ids(item({ marker: { ...replied(9 * DAY), known: false } })), []);
  assert.deepEqual(ids(item({ work: 'resolved', marker: replied(9 * DAY) })), []);
  // A ticket on hold for the customer that the customer answered is waiting on me too.
  assert.deepEqual(ids(item({ work: 'waiting-customer', marker: replied(3 * DAY) })), ['waiting']);
});

test('SLA: breached, or at risk as the SLA chip says (75 % used or under 2 hours left); paused or fine is no reason', () => {
  assert.equal(line(item({ sla: sla({ breached: true, risk: 'breached', percentage: 140 }) })), 'SLA breached');
  assert.equal(line(item({ sla: sla({ percentage: 75, risk: 'at-risk' }) })), 'SLA nearly used');
  assert.equal(line(item({ sla: sla({ percentage: 30, dueAt: NOW + 90 * MINUTE, risk: 'at-risk' }) })), 'SLA nearly used');
  assert.deepEqual(ids(item({ sla: sla({ percentage: 74, risk: 'ok' }) })), []);
  assert.deepEqual(ids(item({ sla: sla({ paused: true, percentage: 95, risk: 'paused' }) })), []);
  assert.deepEqual(ids(item({ sla: null })), []);
});

test('VIP caller and priority account: each is a reason; the account is compared as N28 does, and only with a policy list', () => {
  assert.equal(line(item({ vip: true })), 'VIP caller');
  assert.deepEqual(ids(item({ vip: false })), []);
  assert.equal(line(item({ table: 'sn_customerservice_case', type: 'sn_customerservice_case', account: '  boxeo ' })), 'Priority account');
  assert.equal(line(item({ account: 'Acme  Corp' })), 'Priority account', 'spaces and case do not matter');
  assert.deepEqual(ids(item({ account: 'Other Ltd' })), []);
  assert.deepEqual(riskReasons(item({ account: 'Boxeo' }), { now: NOW }), [], 'no policy: no priority account');
  assert.deepEqual(riskReasons(item({ account: 'Boxeo' }), { now: NOW, policy: { priorityAccounts: [] } }), []);
});

test('rows without the columns (null counts, unknown VIP, no account, no SLA, no comments) are simply not at risk', () => {
  assert.deepEqual(riskReasons(item({ marker: { ...M, known: false } }), { now: NOW, policy: POLICY }), []);
  assert.deepEqual(riskReasons({ table: 'incident', work: 'open' }, { now: NOW }), [], 'an item with none of the facts');
  assert.deepEqual(riskReasons(item({ reassignments: '5', reopens: NaN, vip: 'true' }), { now: NOW }), [], 'only real numbers and true count');
  assert.deepEqual(riskReasons(null, { now: NOW }), []);
  assert.deepEqual(riskReasons(item({ reassignments: 3 }), {}), ['reassigned'].map((id) => ({ id, count: 3 })), 'no clock needed for the counters');
});

test('a resolved ticket is never at risk, whatever its history', () => {
  const done = item({ work: 'resolved', reopens: 3, reassignments: 5, vip: true, account: 'Boxeo', sla: sla({ breached: true, risk: 'breached' }) });
  assert.deepEqual(ids(done), []);
  assert.equal(isAtRisk({ ...done, atRisk: [{ id: 'vip' }] }), false);
});

// ---- combinations and the order of the words ----------------------------------------------------------------------------------

test('the line: every reason, in one order, joined by " · ", only the first word capitalised (the approved examples)', () => {
  assert.equal(line(item({ reassignments: 3, marker: replied(2 * DAY + HOUR) })), 'Reassigned 3 times · waiting on you 2 days');
  assert.equal(line(item({ table: 'sn_customerservice_case', type: 'sn_customerservice_case', reopens: 2, account: 'Boxeo' })), 'Reopened twice · priority account');
  assert.equal(line(item({ vip: true, sla: sla({ percentage: 82, risk: 'at-risk' }) })), 'SLA nearly used · VIP caller');
  const all = item({ reopens: 1, reassignments: 4, marker: replied(5 * DAY), sla: sla({ breached: true, risk: 'breached' }), vip: true, account: 'Boxeo' });
  assert.deepEqual(ids(all), ['reopened', 'reassigned', 'waiting', 'sla', 'vip', 'account']);
  assert.equal(line(all), 'Reopened once · reassigned 4 times · waiting on you 5 days · SLA breached · VIP caller · priority account');
  assert.equal(riskLine([]), '');
  assert.equal(riskLine(undefined), '');
  assert.equal(riskLine([{ id: 'unknown' }, { id: 'vip' }, { id: '__proto__' }]), 'VIP caller', 'an unknown reason is left out');
});

test('the line in Arabic: each reason in its own words and plural forms', () => {
  setLanguage('ar');
  try {
    assert.equal(riskLine([{ id: 'reassigned', count: 3 }, { id: 'waiting', days: 2 }]), 'أعيد إسنادها 3 مرات · بانتظارك منذ يومين');
    assert.equal(riskLine([{ id: 'reopened', count: 2 }, { id: 'account' }]), 'أعيد فتحها مرتين · حساب ذو أولوية');
    assert.equal(riskLine([{ id: 'sla', breached: false }, { id: 'vip' }]), 'اتفاقية مستوى الخدمة أوشكت على النفاد · متصل VIP');
    assert.equal(riskLine([{ id: 'waiting', days: 11 }]), 'بانتظارك منذ 11 يوما');
  } finally {
    setLanguage('en');
  }
});

test('withRisk: the tickets at risk carry their reasons, the others are returned as they are', () => {
  const calm = item();
  const hot = item({ reassignments: 2 });
  const out = withRisk([calm, hot], { now: NOW, policy: POLICY });
  assert.equal(out[0], calm);
  assert.notEqual(out[1], hot, 'a copy: the answer from the page is not changed');
  assert.deepEqual(out[1].atRisk, [{ id: 'reassigned', count: 2 }]);
  assert.equal(hot.atRisk, undefined);
  assert.deepEqual(withRisk(undefined, { now: NOW }), []);
});

// ---- the order of the queue with tickets at risk ----------------------------------------------------------------------------

test('ranking: at risk first; inside each band the old order (breached, SLA at risk, replied, priority...)', () => {
  const breached = item({ priority: '4 - Low', sla: sla({ breached: true, risk: 'breached', dueAt: NOW - DAY }) });
  const soon = item({ priority: '4 - Low', sla: sla({ risk: 'at-risk', dueAt: NOW + 30 * MINUTE }) });
  const bouncedReply = item({ priority: '3 - Moderate', reassignments: 3, marker: replied(HOUR) });
  const reopenedP4 = item({ priority: '4 - Low', reopens: 1 });
  const vipP3 = item({ priority: '3 - Moderate', vip: true });
  const freshReply = item({ priority: '2 - High', marker: replied(HOUR) });
  const p1 = item({ priority: '1 - Critical' });
  const p3 = item({ priority: '3 - Moderate' });
  const list = withRisk([p3, p1, freshReply, vipP3, reopenedP4, bouncedReply, soon, breached], { now: NOW, policy: POLICY });
  const order = groupQueue(list, NOW).now.map((i) => i.sysId);
  assert.deepEqual(order, [breached, soon, bouncedReply, vipP3, reopenedP4, freshReply, p1, p3].map((i) => i.sysId));
  // A P4 that bounced comes before a calm P1: at risk decides first.
  assert.ok(compareNow(list.find((i) => i.sysId === reopenedP4.sysId), p1, NOW) < 0);
});

test('ranking without the reasons (the page script ranks before the panel adds them) is the order My work always had', () => {
  const breached = item({ sla: sla({ breached: true, risk: 'breached' }) });
  const bounced = item({ priority: '4 - Low', reassignments: 5 });
  const p1 = item({ priority: '1 - Critical' });
  assert.deepEqual(groupQueue([bounced, p1, breached], NOW).now, [breached, p1, bounced]);
});

test('waiting on the customer or others: the tickets at risk first there too, then the longest quiet', () => {
  const quietLong = item({ work: 'waiting-customer', marker: { ...M, lastAt: NOW - 6 * DAY } });
  const reopenedShort = item({ work: 'on-hold', reopens: 2, marker: { ...M, lastAt: NOW - DAY } });
  const quietShort = item({ work: 'waiting-customer', marker: { ...M, lastAt: NOW - 2 * DAY } });
  const list = withRisk([quietShort, quietLong, reopenedShort], { now: NOW });
  assert.deepEqual(groupQueue(list, NOW).waiting.map((i) => i.sysId), [reopenedShort, quietLong, quietShort].map((i) => i.sysId));
});

// ---- the filter chip ----------------------------------------------------------------------------------------------------------

test('filter chip: "At risk" first in the existing row, with its count; a resolved ticket is not counted', () => {
  const list = withRisk(
    [
      item({ reassignments: 2 }),
      item({ vip: true, sla: sla({ breached: true, risk: 'breached' }) }),
      item({ work: 'waiting-customer', reopens: 1 }),
      item({ work: 'resolved', reopens: 4 }),
      item(),
    ],
    { now: NOW, policy: POLICY }
  );
  const chips = filterChips(list);
  assert.deepEqual(chips[0], { id: 'status:risk', label: 'At risk', count: 3 });
  assert.equal(chips.find((c) => c.id === 'status:breached').count, 1, 'the other chips are unchanged');
  assert.equal(list.filter((i) => passes(i, 'status:risk')).length, 3);
  // Nothing at risk (or no reasons worked out): no chip.
  assert.ok(!filterChips([item(), item({ reassignments: 1 })]).some((c) => c.id === 'status:risk'));
  assert.ok(!filterChips([item({ reassignments: 9 })]).some((c) => c.id === 'status:risk'), 'only withRisk marks a ticket');
});

// ---- the columns: the spec, the ceiling, the walks ------------------------------------------------------------------------------

test('every "at risk" column is on its kind\'s display ceiling (the field allowlist), and every walk is one the guard knows', () => {
  for (const [column, kinds] of Object.entries(RISK_COLUMNS)) {
    for (const kind of kinds) assert.ok(FIELDS_BY_KIND[kind]?.includes(column), `${column} on the ${kind} ceiling`);
  }
  for (const [kind, column] of [...Object.entries(VIP_COLUMNS), ...Object.entries(ACCOUNT_COLUMNS)]) {
    const root = column.split('.')[0];
    assert.ok(FIELDS_BY_KIND[kind]?.includes(root), `${root} (of ${column}) on the ${kind} ceiling`);
    assert.ok(walkTables(column), `${column}: every step is in DOT_WALK_TABLES`);
  }
});

test('the VIP flag is walked from the same customer column as the login My work already reads; never on HR or sensitive kinds', () => {
  for (const table of Object.keys(KNOWN_TABLES)) {
    const vip = vipColumn(table);
    if (!vip) continue;
    assert.equal(vip, customerColumn(table).replace(/\.user_name$/, '.vip'), table);
  }
  assert.deepEqual(['incident', 'sc_req_item', 'sc_task', 'sn_customerservice_case'].map(vipColumn), ['caller_id.vip', 'requested_for.vip', 'request_item.requested_for.vip', 'contact.vip']);
  assert.equal(vipColumn('sn_hr_core_case'), '');
  assert.equal(vipColumn('change_request'), '');
  assert.deepEqual(riskColumnsFor('sn_hr_core_case', { accounts: true }), [], 'an HR case: nothing');
  assert.deepEqual(riskColumnsFor('u_facilities'), [], 'a custom class: nothing');
});

test('columnsFor: the risk columns only for my queue, the account only when asked, nothing changes for the other reads', () => {
  assert.deepEqual(riskColumnsFor('incident'), ['reassignment_count', 'reopen_count', 'caller_id.vip']);
  assert.deepEqual(riskColumnsFor('problem'), ['reassignment_count']);
  assert.deepEqual(riskColumnsFor('incident_task'), ['reassignment_count']);
  assert.deepEqual(riskColumnsFor('change_request'), [], 'a change has no reassignment count on its ceiling');
  assert.deepEqual(riskColumnsFor('sn_customerservice_case'), ['reassignment_count', 'contact.vip']);
  assert.deepEqual(riskColumnsFor('sn_customerservice_case', { accounts: true }), ['reassignment_count', 'contact.vip', 'account']);
  assert.equal(accountColumn('sn_customerservice_case'), 'account');
  assert.equal(accountColumn('incident'), '');
  assert.ok(!columnsFor('incident').includes('reassignment_count'), 'without `risk`, the columns are the old ones');
  assert.ok(!columnsFor('incident', { group: true }).some((c) => /reassignment|reopen|\.vip$|^account$/.test(c)));
  assert.ok(columnsFor('incident', { risk: true }).includes('caller_id.vip'));
  assert.ok(!columnsFor('incident', { risk: true }).some((c) => /description$|comments|work_notes|close_notes/.test(c) && c !== 'short_description'), 'still no free text but the title');
  assert.equal(kindForTable('sn_customerservice_case'), 'case');
});
