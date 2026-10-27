// Dot-walking for the fake Table and Aggregate APIs. The shared fake (tests/fixtures/sn-fakeDeps.js) reads "task.assigned_to" as the
// display text of the task reference, which is what a unit test needs. The reports ask real questions with dot-walked columns
// ("task_sla rows whose TASK is assigned to me", "approvals whose request is a requested item"), so this wrapper adds, for each
// dotted name in a query or a field list, a synthetic column to a COPY of the rows, holding the value found by following the
// references. The shared fake already prefers a column that exists over its own dot handling, so nothing in it changes.
import { fakeDeps } from '../tests/fixtures/sn-fakeDeps.js';

const rawOf = (c) => (c && typeof c === 'object' ? String(c.value ?? '') : String(c ?? ''));
const empty = () => ({ value: '', display_value: '' });

/** The record with this sys_id in any table: { table, row } or null. Task-like ids are unique across the fixtures. */
function findById(tables, id) {
  if (!id) return null;
  for (const [table, rows] of Object.entries(tables)) {
    const row = (rows || []).find((r) => rawOf(r.sys_id) === id);
    if (row) return { table, row };
  }
  return null;
}

/** The cell reached by following `parts` from `row` (parts[0] is a column of the row). */
function walk(tables, row, parts) {
  const first = row[parts[0]];
  if (first === undefined) return undefined;
  if (parts.length === 1) return first;
  const target = findById(tables, rawOf(first));
  if (!target) return empty();
  // A record's class is the table it lives in unless the row says otherwise.
  if (parts[1] === 'sys_class_name' && parts.length === 2) return target.row.sys_class_name !== undefined ? target.row.sys_class_name : { value: target.table, display_value: target.table };
  return walk(tables, target.row, parts.slice(1)) ?? empty();
}

// `task` is the parent of every ticket table: a read of it sees the tickets of its children (the reports look tickets up there by sys_id).
const TASK_CHILDREN = ['incident', 'problem', 'change_request', 'sc_req_item', 'sc_task', 'sn_customerservice_case', 'change_task'];
function withTaskUnion(tables) {
  const seen = new Set((tables.task || []).map((r) => rawOf(r.sys_id)));
  const rows = [...(tables.task || [])];
  for (const child of TASK_CHILDREN) {
    for (const row of tables[child] || []) {
      if (seen.has(rawOf(row.sys_id))) continue;
      seen.add(rawOf(row.sys_id));
      rows.push(row.sys_class_name === undefined ? { ...row, sys_class_name: { value: child, display_value: child } } : row);
    }
  }
  return { ...tables, task: rows };
}

const DOTTED = /[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+/g;

/** Same four functions as fakeDeps, with dot-walked columns understood. */
export function dotwalkDeps(source, behaviour) {
  const plain = fakeDeps(source, behaviour);
  async function queryTable(table, query = '', fields = [], options = {}) {
    const tables = table === 'task' ? withTaskUnion(source) : source;
    const names = [...new Set(`${query},${fields.join(',')}`.match(DOTTED) || [])];
    const rows = tables[table] || [];
    const usable = names.filter((n) => rows.some((r) => n.split('.')[0] in r));
    if (!usable.length) return (table === 'task' ? fakeDeps(tables, behaviour) : plain).queryTable(table, query, fields, options);
    const augmented = rows.map((row) => {
      const extra = {};
      for (const n of usable) {
        const cell = walk(tables, row, n.split('.'));
        if (cell !== undefined) extra[n] = cell;
      }
      return { ...row, ...extra };
    });
    return fakeDeps({ ...tables, [table]: augmented }, behaviour).queryTable(table, query, fields, options);
  }
  async function fetchRecord(table, sysId, fields = [], options = {}) {
    if (!sysId) return null;
    return (await queryTable(table, `sys_id=${sysId}`, fields, { ...options, limit: 1 }))[0] || null;
  }
  async function countRecords(table, query = '') {
    return (await queryTable(table, query, ['sys_id'], { limit: 100000 })).length;
  }
  return { ...plain, queryTable, fetchRecord, countRecords };
}
