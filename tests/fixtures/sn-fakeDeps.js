// A fake ServiceNow Table API for the src/context tests: the same four functions as src/content/tableApi.js, answering
// from plain JSON rows. It understands the small slice of sysparm_query the context code writes (sys_id=, element_id=,
// field=value, !=, IN, LIKE, STARTSWITH, ISEMPTY/ISNOTEMPTY, >= <=, dotted names like cmdb_ci.name, ^ for AND, ^OR,
// ORDERBY, ORDERBYDESC) and imitates the behaviours that matter for access:
//
//   denied: ['sys_journal_field']   a table that answers HTTP 403 (error.code = 'ACCESS_DENIED')
//   hidden: ['task_sla']            a table whose ACLs filter every row: HTTP 200 and an empty list, even unfiltered
//   leaky: true                     ignores sysparm_fields and returns EVERY column (to prove the allowlist holds)
//   ignoreUnknownColumns (default)  a condition on a column no row has is ignored, as ServiceNow does
//   errors: { table: Error }        any other failure; expired: ['table'] a lost session (code SESSION_EXPIRED)
//
// Rows are stored the way sysparm_display_value=all returns them ({ value, display_value }); plain strings also work.

/** A cell as the Table API returns it with display values. */
export const v = (value, display) => ({ value: String(value ?? ''), display_value: String(display ?? value ?? '') });

const rawOf = (cell) => (cell && typeof cell === 'object' ? String(cell.value ?? '') : String(cell ?? ''));
const dispOf = (cell) => (cell && typeof cell === 'object' ? String(cell.display_value ?? cell.value ?? '') : String(cell ?? ''));

export function accessDeniedError(table = 'a table') {
  const err = new Error(`Your user is not allowed to read this (403): Access to ${table} is denied by ACL.`);
  err.code = 'ACCESS_DENIED';
  return err;
}

export function sessionExpiredError() {
  const err = new Error('Your ServiceNow session has expired. Log in again, then retry.');
  err.code = 'SESSION_EXPIRED';
  return err;
}

// ---- Query language ---------------------------------------------------------------------------------

// "NOT IN" (with a space) is how ServiceNow writes it and what src/reports/engine/queryBuilder.js emits; "NOTIN" is kept for older tests.
const CONDITION = /^([a-z0-9_.]+?)(ISNOTEMPTY|ISEMPTY|!=|>=|<=|NOT IN|NOTIN|IN|NOTLIKE|LIKE|STARTSWITH|ENDSWITH|=|>|<)(.*)$/;

function parseQuery(query) {
  const groups = [];
  const order = [];
  for (const token of String(query || '').split('^').filter(Boolean)) {
    let m = /^ORDERBYDESC(.+)$/.exec(token);
    if (m) {
      order.push({ field: m[1], desc: true });
      continue;
    }
    m = /^ORDERBY(.+)$/.exec(token);
    if (m) {
      order.push({ field: m[1], desc: false });
      continue;
    }
    const orPart = token.startsWith('OR') && !token.startsWith('ORDERBY');
    const parsed = CONDITION.exec(orPart ? token.slice(2) : token);
    if (!parsed) throw new Error(`fakeDeps cannot read the condition "${token}"`);
    const condition = { field: parsed[1], op: parsed[2], value: parsed[3] };
    if (orPart && groups.length) groups[groups.length - 1].push(condition);
    else groups.push([condition]);
  }
  return { groups, order };
}

// The value a condition looks at: a stored column, or a dotted name read through a reference's display value.
function cell(row, field) {
  if (field in row) return row[field];
  const [head] = field.split('.');
  if (head in row) return { value: dispOf(row[head]), display_value: dispOf(row[head]) };
  return undefined;
}

function matches(row, { field, op, value }, knownColumns, ignoreUnknownColumns) {
  const [head] = field.split('.');
  if (ignoreUnknownColumns && !knownColumns.has(field) && !knownColumns.has(head)) return true;
  const c = cell(row, field);
  const raw = rawOf(c);
  const shown = dispOf(c);
  const lower = value.toLowerCase();
  switch (op) {
    case '=': return raw === value || shown === value;
    case '!=': return raw !== value && shown !== value;
    case 'IN': return value.split(',').includes(raw) || value.split(',').includes(shown);
    case 'NOT IN':
    case 'NOTIN': return !value.split(',').includes(raw);
    case 'LIKE': return shown.toLowerCase().includes(lower) || raw.toLowerCase().includes(lower);
    case 'NOTLIKE': return !shown.toLowerCase().includes(lower);
    case 'STARTSWITH': return shown.toLowerCase().startsWith(lower);
    case 'ENDSWITH': return shown.toLowerCase().endsWith(lower);
    case 'ISEMPTY': return raw === '';
    case 'ISNOTEMPTY': return raw !== '';
    case '>=': return raw >= value;
    case '<=': return raw <= value;
    case '>': return raw > value;
    case '<': return raw < value;
    default: return false;
  }
}

function project(row, fields, displayValue, leaky) {
  const keys = leaky || !fields.length ? Object.keys(row) : fields.filter((f) => f in row);
  const out = {};
  for (const key of keys) {
    const c = row[key];
    out[key] = displayValue ? { value: rawOf(c), display_value: dispOf(c) } : rawOf(c);
  }
  return out;
}

// ---- The fake -----------------------------------------------------------------------------------------

/**
 * @param {Record<string, object[]>} tables table name -> rows
 * @param {{ denied?: string[], hidden?: string[], leaky?: boolean, ignoreUnknownColumns?: boolean,
 *   errors?: Record<string, Error>, expired?: string[] }} [behaviour]
 * @returns deps { queryTable, fetchRecord, countRecords, countByColumn } plus `calls` (what was asked, in order)
 */
export function fakeDeps(tables, behaviour = {}) {
  const { denied = [], hidden = [], leaky = false, ignoreUnknownColumns = true, errors = {}, expired = [] } = behaviour;
  const calls = [];

  async function queryTable(table, query = '', fields = [], options = {}) {
    calls.push({ fn: 'queryTable', table, query, fields: [...fields], options: { ...options } });
    if (expired.includes(table)) throw sessionExpiredError();
    if (denied.includes(table)) throw accessDeniedError(table);
    if (errors[table]) throw errors[table];
    if (hidden.includes(table)) return [];

    const rows = tables[table] || [];
    const knownColumns = new Set(rows.flatMap((row) => Object.keys(row)));
    const { groups, order } = parseQuery(query);
    let found = rows.filter((row) => groups.every((group) => group.some((c) => matches(row, c, knownColumns, ignoreUnknownColumns))));
    for (const { field, desc } of [...order].reverse()) {
      found = [...found].sort((a, b) => (desc ? -1 : 1) * rawOf(cell(a, field)).localeCompare(rawOf(cell(b, field))));
    }
    const { limit = 50, offset = 0, displayValue = false } = options;
    return found.slice(offset, offset + limit).map((row) => project(row, fields, displayValue, leaky));
  }

  async function fetchRecord(table, sysId, fields = [], options = {}) {
    if (!sysId) return null;
    const rows = await queryTable(table, `sys_id=${sysId}`, fields, { ...options, limit: 1 });
    return rows[0] || null;
  }

  async function countRecords(table, query = '') {
    return (await queryTable(table, query, ['sys_id'], { limit: 100000 })).length;
  }

  async function countByColumn() {
    return [];
  }

  return {
    queryTable,
    fetchRecord,
    countRecords,
    countByColumn,
    calls,
    /** Calls made to one table. */
    callsTo: (table) => calls.filter((c) => c.table === table),
    /** Every column name that was asked for, across all calls. */
    fieldsAsked: () => new Set(calls.flatMap((c) => c.fields)),
  };
}
