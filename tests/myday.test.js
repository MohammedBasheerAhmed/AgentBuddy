const test = require('node:test');
const assert = require('node:assert/strict');
import { readMyDay, rankMyDay, worstSla, riskOf, urgencyScore } from '../src/reports/myDay.js';

const USER = '9'.repeat(32);
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const cell = (value, display) => ({ value, display_value: display ?? value });
const row = (table, id, number, title, priority, updated) => ({
  sys_id: cell(id),
  number: cell(number),
  short_description: cell(title),
  priority: cell(priority[0], priority),
  state: cell('2', 'In Progress'),
  sys_updated_on: cell(updated),
  sys_class_name: cell(table),
});
const sla = (task, pct, breached) => ({ task: cell(task), sla: cell('x', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), planned_end_time: cell('2026-10-27 09:00:00') });

function fakeDeps({ tables, slas = [], denied = [], slaDenied = false }) {
  const calls = [];
  return {
    calls,
    async queryTable(table, query) {
      calls.push({ table, query });
      if (table === 'task_sla') {
        if (slaDenied) throw Object.assign(new Error('403'), { code: 'ACCESS_DENIED' });
        return slas;
      }
      if (denied.includes(table)) throw Object.assign(new Error('403'), { code: 'ACCESS_DENIED' });
      return tables[table] || [];
    },
  };
}

test('breached SLA first, then at-risk, then priority, then longest idle', async () => {
  const deps = fakeDeps({
    tables: {
      incident: [
        row('incident', 'a'.repeat(32), 'INC1', 'P3 quiet', '3 - Moderate', '2026-10-26 11:00:00'),
        row('incident', 'b'.repeat(32), 'INC2', 'P1 healthy', '1 - Critical', '2026-10-26 11:30:00'),
        row('incident', 'c'.repeat(32), 'INC3', 'P4 breached', '4 - Low', '2026-10-26 10:00:00'),
        row('incident', 'd'.repeat(32), 'INC4', 'P3 nearly out', '3 - Moderate', '2026-10-26 09:00:00'),
      ],
    },
    slas: [sla('c'.repeat(32), 130, true), sla('d'.repeat(32), 82, false), sla('b'.repeat(32), 20, false)],
  });
  const { items } = await readMyDay({ userId: USER }, deps, { tables: ['incident'], now: NOW });
  assert.deepEqual(items.map((i) => i.number), ['INC3', 'INC4', 'INC2', 'INC1']);
  assert.equal(items[0].risk, 'breached');
  assert.equal(items[1].risk, 'at-risk');
  assert.equal(items[2].risk, 'ok');
  assert.equal(items[3].risk, 'none');
});

test('the query is for MY active tickets and reads SLAs in one batch', async () => {
  const deps = fakeDeps({ tables: { incident: [row('incident', 'a'.repeat(32), 'INC1', 't', '3 - Moderate', '2026-10-26 11:00:00')] } });
  await readMyDay({ userId: USER }, deps, { tables: ['incident'], now: NOW });
  assert.equal(deps.calls[0].query, `assigned_to=${USER}^active=true^ORDERBYDESCsys_updated_on`);
  assert.equal(deps.calls.filter((c) => c.table === 'task_sla').length, 1);
  assert.match(deps.calls.find((c) => c.table === 'task_sla').query, /^taskIN/);
});

test('a table the agent cannot read is skipped with a note, not an error', async () => {
  const deps = fakeDeps({ tables: { incident: [row('incident', 'a'.repeat(32), 'INC1', 't', '2 - High', '2026-10-26 11:00:00')] }, denied: ['sn_customerservice_case'] });
  const { items, access } = await readMyDay({ userId: USER }, deps, { tables: ['incident', 'sn_customerservice_case'], now: NOW });
  assert.equal(items.length, 1);
  assert.equal(access.find((a) => a.source === 'sn_customerservice_case').status, 'denied');
});

test('without SLA access tickets are ordered by priority and the note says so', async () => {
  const deps = fakeDeps({
    tables: { incident: [row('incident', 'a'.repeat(32), 'INC1', 'low', '4 - Low', '2026-10-26 11:00:00'), row('incident', 'b'.repeat(32), 'INC2', 'high', '2 - High', '2026-10-26 11:00:00')] },
    slaDenied: true,
  });
  const { items, access } = await readMyDay({ userId: USER }, deps, { tables: ['incident'], now: NOW });
  assert.equal(items[0].number, 'INC2');
  assert.ok(access.some((a) => a.source === 'task_sla' && /ordered by priority/.test(a.note)));
});

test('an expired session is reported, not swallowed', async () => {
  const deps = { async queryTable() { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); } };
  await assert.rejects(() => readMyDay({ userId: USER }, deps, { tables: ['incident'], now: NOW }), /expired/);
});

test('a missing user id is refused before any read', async () => {
  const deps = fakeDeps({ tables: {} });
  await assert.rejects(() => readMyDay({ userId: 'nope' }, deps), /who is signed in/);
  assert.equal(deps.calls.length, 0);
});

test('worstSla and riskOf', () => {
  assert.equal(worstSla([]), null);
  assert.equal(riskOf(null), 'none');
  const w = worstSla([sla('t', 40, false), sla('t', 90, false), sla('t', 10, true)]);
  assert.equal(w.breached, true);
  assert.equal(riskOf({ breached: false, percentage: 75 }), 'at-risk');
  assert.equal(riskOf({ breached: false, percentage: 74 }), 'ok');
  assert.ok(urgencyScore({ risk: 'breached', priority: '4 - Low', idleHours: 0 }) < urgencyScore({ risk: 'ok', priority: '1 - Critical', idleHours: 0 }));
  assert.deepEqual(rankMyDay([]), []);
});
