const test = require('node:test');
const assert = require('node:assert/strict');
import { workState } from '../src/mywork/states.js';
import { pickSla, riskOfSla } from '../src/mywork/sla.js';
import { groupQueue, compareNow, filterChips, passes, sharedCis, priorityRank, groupOf } from '../src/mywork/rank.js';
import { spanText, slaText, readText, idleText, dueToday, HOUR, MINUTE, DAY } from '../src/mywork/time.js';
import { tablesForProfiles, readDecision, columnsFor, pluralOf, customerColumn } from '../src/mywork/tables.js';
import { fullListUrl } from '../src/mywork/links.js';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const cell = (value, display) => ({ value: String(value), display_value: String(display ?? value) });
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const NONE = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };

let n = 0;
const item = (over = {}) => {
  n += 1;
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, '0'), number: `INC${String(n).padStart(4, '0')}`, title: `t${n}`, priority: '3 - Moderate', state: 'In Progress', work: 'open', updatedAt: NOW - HOUR, openedAt: NOW - DAY, ci: null, sla: null, marker: NONE, ...over };
};
const sla = (over = {}) => ({ name: 'Resolution', breached: false, paused: false, percentage: 10, basis: 'business', dueAt: NOW + 10 * HOUR, risk: 'ok', ...over });

// ---- states --------------------------------------------------------------------------------------------------------------------

test('states: display words decide, the fixed base values back them up', () => {
  assert.equal(workState({ table: 'incident', state: 'Resolved', stateValue: '6' }), 'resolved');
  assert.equal(workState({ table: 'incident', state: '', stateValue: '6' }), 'resolved');
  assert.equal(workState({ table: 'sn_customerservice_case', state: 'Resolved' }), 'resolved');
  assert.equal(workState({ table: 'incident', state: 'On Hold', stateValue: '3', holdReason: 'Awaiting Caller', holdReasonValue: '1' }), 'waiting-customer');
  assert.equal(workState({ table: 'incident', state: 'On Hold', stateValue: '3', holdReason: 'Awaiting Vendor', holdReasonValue: '4' }), 'on-hold');
  assert.equal(workState({ table: 'incident', state: 'Pending', stateValue: '3', holdReasonValue: '1' }), 'waiting-customer');
  assert.equal(workState({ table: 'sn_customerservice_case', state: 'Awaiting Info', stateValue: '18' }), 'waiting-customer');
  assert.equal(workState({ table: 'sc_task', state: 'Pending', stateValue: '-5' }), 'on-hold');
  assert.equal(workState({ table: 'sn_hr_core_case', state: 'Awaiting Acceptance' }), 'waiting-customer');
  assert.equal(workState({ table: 'incident', state: 'New', stateValue: '1' }), 'new');
  assert.equal(workState({ table: 'incident', state: 'In Progress', stateValue: '2' }), 'open');
  assert.equal(workState({ table: 'sc_task', state: 'Work in Progress' }), 'open');
  // A hold reason left behind after the ticket went back to work does not hide it.
  assert.equal(workState({ table: 'incident', state: 'In Progress', stateValue: '2', holdReason: 'Awaiting Caller', holdReasonValue: '1' }), 'open');
  // Unknown words are live work.
  assert.equal(workState({ table: 'u_custom', state: 'Triage' }), 'open');
});

// ---- SLA -------------------------------------------------------------------------------------------------------------------------

const slaRow = ({ pct = 10, bpct, breached = false, stage = 'in_progress', end = NOW + 5 * HOUR, name = 'Resolution' } = {}) => ({
  task: cell('x'),
  sla: cell('d', name),
  stage: cell(stage, stage === 'paused' ? 'Paused' : 'In progress'),
  has_breached: cell(breached ? 'true' : 'false'),
  percentage: cell(String(pct)),
  ...(bpct === undefined ? {} : { business_percentage: cell(String(bpct)) }),
  planned_end_time: cell(utc(end), 'shown in the person\'s zone'),
});

test('SLA: breached first, then the running one that ends soonest, paused ones last', () => {
  assert.equal(pickSla([], NOW), null);
  const two = pickSla([slaRow({ end: NOW + 9 * HOUR, name: 'Late' }), slaRow({ end: NOW + 3 * HOUR, name: 'Soon' })], NOW);
  assert.equal(two.name, 'Soon');
  assert.equal(two.dueAt, NOW + 3 * HOUR);
  const paused = pickSla([slaRow({ stage: 'paused', end: NOW - HOUR, pct: 99, name: 'Paused' }), slaRow({ end: NOW + 30 * HOUR, name: 'Running' })], NOW);
  assert.equal(paused.name, 'Running', 'a paused SLA never outranks a running one');
  const onlyPaused = pickSla([slaRow({ stage: 'paused', pct: 99 })], NOW);
  assert.equal(onlyPaused.risk, 'paused');
  const breached = pickSla([slaRow({ end: NOW + HOUR }), slaRow({ breached: true, end: NOW - DAY, name: 'Gone' })], NOW);
  assert.equal(breached.name, 'Gone');
  assert.equal(breached.risk, 'breached');
});

test('SLA risk: 75 % used, or under two hours left; business time decides the share', () => {
  assert.equal(riskOfSla(null, NOW), 'none');
  assert.equal(pickSla([slaRow({ pct: 118, bpct: 62, end: NOW + 20 * HOUR })], NOW).risk, 'ok');
  assert.equal(pickSla([slaRow({ pct: 80, end: NOW + 20 * HOUR })], NOW).risk, 'at-risk');
  assert.equal(pickSla([slaRow({ pct: 10, end: NOW + 90 * MINUTE })], NOW).risk, 'at-risk');
});

// ---- time phrases ----------------------------------------------------------------------------------------------------------------

test('time phrases', () => {
  assert.equal(spanText(45 * MINUTE), '45m');
  assert.equal(spanText(2 * HOUR + 10 * MINUTE), '2h 10m');
  assert.equal(spanText(3 * HOUR), '3h');
  assert.equal(spanText(DAY + 4 * HOUR), '1 d 4 h');
  assert.equal(spanText(12 * DAY), '12 d');
  assert.equal(slaText(sla({ dueAt: NOW + 2 * HOUR + 10 * MINUTE }), NOW), 'SLA due in 2h 10m');
  assert.equal(slaText(sla({ dueAt: NOW - MINUTE }), NOW), 'SLA due now');
  assert.equal(slaText(sla({ breached: true }), NOW), 'SLA breached');
  assert.equal(slaText(sla({ paused: true }), NOW), 'SLA paused');
  assert.equal(slaText(sla({ dueAt: null, percentage: 40.4 }), NOW), 'SLA 40% used');
  assert.equal(slaText(null, NOW), '');
  assert.equal(readText(NOW - 20000, NOW), 'Read just now');
  assert.equal(readText(NOW - 2 * MINUTE, NOW), 'Read 2 min ago');
  assert.equal(readText(NOW - 2 * HOUR, NOW), 'Read 2h ago');
  assert.equal(idleText(NOW - 5 * HOUR, NOW), 'updated 5h ago');
  assert.equal(dueToday(NOW, NOW), true);
  assert.equal(dueToday(NOW + 3 * DAY, NOW), false);
});

// ---- grouping and ranking --------------------------------------------------------------------------------------------------------

test('groups: resolved-but-active folded away; on hold waits; a customer reply brings a held ticket back to "waiting on you"', () => {
  const resolved = item({ work: 'resolved', state: 'Resolved' });
  const held = item({ work: 'waiting-customer', state: 'On Hold' });
  const answered = item({ work: 'waiting-customer', state: 'On Hold', marker: { ...NONE, lastCustomerAt: NOW - HOUR, replied: 'customer' } });
  const live = item();
  const g = groupQueue([resolved, held, answered, live], NOW);
  assert.deepEqual(g.resolved, [resolved]);
  assert.deepEqual(g.waiting, [held]);
  assert.deepEqual(new Set(g.now), new Set([answered, live]));
  assert.equal(groupOf(item({ work: 'on-hold' })), 'waiting');
});

test('ranking: breached, at risk (least time left first), customer replied, then priority, SLA time left, idle time', () => {
  const p1 = item({ priority: '1 - Critical' });
  const p3idle = item({ updatedAt: NOW - 5 * DAY });
  const p3busy = item({ updatedAt: NOW - HOUR });
  const breached = item({ priority: '4 - Low', sla: sla({ breached: true, risk: 'breached', dueAt: NOW - DAY }) });
  const soon = item({ priority: '4 - Low', sla: sla({ risk: 'at-risk', dueAt: NOW + 30 * MINUTE }) });
  const later = item({ priority: '2 - High', sla: sla({ risk: 'at-risk', dueAt: NOW + 90 * MINUTE }) });
  const replied = item({ priority: '3 - Moderate', marker: { ...NONE, lastCustomerAt: NOW - HOUR, replied: 'customer' } });
  const p3running = item({ sla: sla({ dueAt: NOW + 20 * HOUR }) });
  const p3paused = item({ sla: sla({ paused: true, risk: 'paused', dueAt: NOW - HOUR }) });
  const order = groupQueue([p3busy, p3idle, p3paused, p1, later, replied, soon, breached, p3running], NOW).now;
  assert.deepEqual(order, [breached, soon, later, replied, p1, p3running, p3paused, p3idle, p3busy]);
  assert.ok(compareNow(p3running, p3paused, NOW) < 0, 'a paused SLA ranks after a running one');
});

test('waiting: the longest quiet first; resolved: the oldest first', () => {
  const a = item({ work: 'waiting-customer', marker: { ...NONE, lastAt: NOW - 2 * DAY } });
  const b = item({ work: 'waiting-customer', marker: { ...NONE, lastAt: NOW - 6 * DAY } });
  const c = item({ work: 'on-hold', updatedAt: NOW - 4 * DAY });
  assert.deepEqual(groupQueue([a, b, c], NOW).waiting, [b, c, a]);
});

test('priority rank from the display text', () => {
  assert.equal(priorityRank('1 - Critical'), 1);
  assert.equal(priorityRank(''), 9);
  assert.equal(priorityRank('High'), 9);
});

// ---- filters with counts ---------------------------------------------------------------------------------------------------------

test('filter chips carry counts, show only what would show something, and filter the list', () => {
  const list = [
    item({ priority: '1 - Critical', sla: sla({ breached: true, risk: 'breached' }) }),
    item({ priority: '2 - High' }),
    item({ type: 'sc_task', table: 'sc_task', work: 'waiting-customer' }),
    item({ type: 'sc_task', table: 'sc_task', marker: { ...NONE, replied: 'customer', lastCustomerAt: NOW } }),
    item({ type: 'sc_task', table: 'sc_task' }),
  ];
  const chips = filterChips(list);
  const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
  assert.equal(byId['status:breached'].count, 1);
  assert.equal(byId['status:waiting'].count, 1);
  assert.equal(byId['status:replied'].count, 1);
  assert.equal(byId['prio:1'].count, 1);
  assert.equal(byId['type:sc_task'].label, 'Catalog tasks');
  assert.equal(byId['type:sc_task'].count, 3);
  assert.equal(byId['type:incident'].count, 2);
  assert.equal(byId['status:due'], undefined, 'a chip with nothing behind it is not shown');
  assert.equal(chips.findIndex((c) => c.id === 'type:sc_task') < chips.findIndex((c) => c.id === 'type:incident'), true, 'the biggest type first');
  assert.equal(list.filter((i) => passes(i, 'type:sc_task')).length, 3);
  assert.equal(list.filter((i) => passes(i, '')).length, 5);
  // One type only: no type chips.
  assert.ok(!filterChips([item(), item()]).some((c) => c.id.startsWith('type:')));
});

test('several of my tickets on one CI: counted, most first, only from three', () => {
  const vpn = { id: 'c'.repeat(32), name: 'VPN Gateway EU' };
  const mail = { id: 'd'.repeat(32), name: 'Mail' };
  const list = [item({ ci: vpn }), item({ ci: vpn }), item({ ci: vpn }), item({ ci: mail }), item({ ci: mail }), item({ ci: vpn, work: 'resolved' })];
  assert.deepEqual(sharedCis(list).map((c) => [c.name, c.count]), [['VPN Gateway EU', 3]]);
  assert.deepEqual(sharedCis(list, { min: 2 }).map((c) => c.name), ['VPN Gateway EU', 'Mail']);
  assert.equal(list.filter((i) => passes(i, `ci:${vpn.id}`)).length, 4);
});

// ---- tables and policy ------------------------------------------------------------------------------------------------------------

test('tables: profiles choose the per-table counts; HR needs content allowed AND the HR profile; blocked is blocked', () => {
  assert.ok(tablesForProfiles(['csm']).includes('sn_customerservice_case'));
  assert.ok(!tablesForProfiles(['csm']).includes('incident'));
  assert.ok(tablesForProfiles([]).includes('incident'));
  assert.ok(tablesForProfiles(['it', 'req']).filter((t) => t === 'sc_task').length === 1);
  const isBlocked = (t) => t === 'problem';
  assert.equal(readDecision('problem', { isBlocked }), 'blocked');
  assert.equal(readDecision('incident', { isBlocked }), 'read');
  assert.equal(readDecision('sn_hr_core_case', {}), 'hr-off');
  assert.equal(readDecision('sn_hr_core_case', { allowSensitive: true }), 'hr-profile');
  assert.equal(readDecision('sn_hr_core_case', { allowSensitive: true, profiles: ['hr'] }), 'read');
  assert.equal(readDecision('sn_si_incident', { sensitivePrefixes: ['sn_si_'] }), 'hr-off');
  assert.equal(readDecision('sn_si_incident', { sensitivePrefixes: ['sn_si_'], allowSensitive: true }), 'read');
  assert.equal(readDecision('x;y', {}), 'invalid');
  assert.equal(readDecision('incident', { isBlocked: () => { throw new Error('x'); } }), 'blocked');
  assert.ok(columnsFor('incident').includes('caller_id.user_name') && columnsFor('incident').includes('hold_reason'));
  assert.ok(!columnsFor('problem').some((c) => c.includes('.')));
  assert.ok(columnsFor('sc_task', { group: true }).includes('assignment_group'));
  assert.ok(!columnsFor('incident').some((c) => /description$|comments|work_notes|close_notes/.test(c) && c !== 'short_description'), 'no free text but the title');
  assert.equal(customerColumn('sc_task'), 'request_item.requested_for.user_name');
  // (audit P3.13: the instance's own name is used as given; an English "s" would be wrong in any other language)
  assert.equal(pluralOf('u_facilities', 'Facilities request'), 'Facilities request');
  assert.equal(pluralOf('u_facilities', 'طلب المرافق'), 'طلب المرافق', 'an Arabic name gets no Latin "s"');
  assert.equal(pluralOf('u_facilities', ''), 'Other tickets');
});

test('the full-list address stays on the page\'s instance and refuses odd filters', () => {
  const page = { href: 'https://acme.service-now.com/now/sow/home' };
  const url = fullListUrl(page, 'task', `assigned_to=${'a'.repeat(32)}^active=true`);
  assert.ok(url.startsWith('https://acme.service-now.com/nav_to.do?uri='));
  assert.match(decodeURIComponent(url), /task_list\.do\?sysparm_query=assigned_to%3Da{32}%5Eactive%3Dtrue/);
  assert.equal(fullListUrl(page, 'task', 'a<script>'), '');
  assert.equal(fullListUrl(page, 'Bad Table', 'active=true'), '');
  assert.equal(fullListUrl({ href: 'not a url' }, 'task', 'active=true'), '');
});
