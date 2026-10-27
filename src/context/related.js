// The extras next to a record: SLAs, approvals, child and catalog tasks, request items, requested-item variables, and for the
// domain features the incidents linked to a problem, other changes overlapping a change's window, and recent changes on a
// case's configuration item.
// Each one is optional and fails soft: a refused read becomes an `access` note, never an error, and an empty answer is
// only called "empty" when the user can see rows of that table at all (see access.js).
//
// Every list is read with a condition on the record, and each row is checked against the record again: ServiceNow
// ignores a condition on a column that does not exist and then returns every row, which must never pass for "the
// approvals of this ticket".

import { FEATURE_RELATED, FIELDS_BY_KIND, LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, isSessionExpired, softRead } from './access.js';
import { kindForTable } from './kinds.js';
import { SYS_ID_RE, TABLE_RE, disp, formatSnTime, mapLimit, oneLine, parseSnTime, raw } from './util.js';

const CONCURRENCY = 3;

// What a kind of record can have. The feature narrows this (FEATURE_RELATED) and a sensitive table narrows it to SLAs.
export const RELATED_BY_KIND = Object.freeze({
  incident: ['slas', 'childTasks'],
  problem: ['childTasks', 'linkedIncidents'],
  change: ['approvals', 'changeTasks', 'conflicts'],
  request: ['items', 'approvals'],
  requested_item: ['variables', 'approvals', 'catalogTasks', 'slas'],
  catalog_task: ['slas'],
  case: ['slas', 'childTasks', 'recentChanges'],
  hr_case: ['slas', 'childTasks'],
  task: ['slas', 'childTasks'],
  other: [],
});

/** The extras to read for a kind and feature, in a fixed order. */
export function relatedPlan({ kind, feature, minimised = false }) {
  const wanted = FEATURE_RELATED[feature] || [];
  return (RELATED_BY_KIND[kind] || []).filter((key) => wanted.includes(key) && (!minimised || key === 'slas'));
}

const text = (v, max = LIMITS.relatedText) => oneLine(disp(v), max);
const flag = (v) => (raw(v) === 'true' || raw(v) === 'false' ? raw(v) : '');

// ---- List sources ----------------------------------------------------------------------------------

// `link`: the column that must equal the record's sys_id on every row. `refs`: people to add to the pack's people list.
const SOURCES = {
  slas: {
    table: 'task_sla',
    query: (id) => `task=${id}^ORDERBYDESCsys_created_on`,
    fields: ['sla', 'stage', 'has_breached', 'percentage', 'business_percentage', 'planned_end_time', 'task'],
    link: 'task',
    shape: (row) => {
      // business_percentage follows the SLA's schedule; plain percentage counts nights and weekends too.
      const pct = Number.parseFloat(raw(row.business_percentage) || raw(row.percentage));
      return {
        name: text(row.sla, 100),
        stage: text(row.stage, 40),
        breached: flag(row.has_breached),
        percentage: Number.isFinite(pct) ? String(Math.round(pct)) : '',
        plannedEnd: text(row.planned_end_time, 40),
      };
    },
  },
  approvals: {
    table: 'sysapproval_approver',
    query: (id) => `sysapproval=${id}^ORDERBYDESCsys_created_on`,
    fields: ['approver', 'group', 'state', 'sys_updated_on', 'sysapproval'],
    link: 'sysapproval',
    shape: (row) => ({ approver: text(row.approver, 100), group: text(row.group, 100), state: text(row.state, 40), updated: text(row.sys_updated_on, 40) }),
    refs: (row) => [{ role: 'approver', sysId: raw(row.approver), name: text(row.approver, 100) }],
  },
  childTasks: {
    table: 'task',
    query: (id) => `parent=${id}^sys_class_name!=sysapproval_group^ORDERBYDESCsys_created_on`,
    fields: ['number', 'short_description', 'state', 'assigned_to', 'assignment_group', 'sys_class_name', 'active', 'parent'],
    link: 'parent',
    shape: (row) => ({
      number: text(row.number, 40),
      type: text(row.sys_class_name, 60),
      short_description: text(row.short_description),
      state: text(row.state, 40),
      assignedTo: text(row.assigned_to, 100),
      assignmentGroup: text(row.assignment_group, 100),
      active: flag(row.active),
    }),
    refs: (row) => [{ role: 'task_assignee', sysId: raw(row.assigned_to), name: text(row.assigned_to, 100) }],
  },
  catalogTasks: {
    table: 'sc_task',
    query: (id) => `request_item=${id}^ORDERBYsys_created_on`,
    fields: ['number', 'short_description', 'state', 'assigned_to', 'assignment_group', 'active', 'request_item'],
    link: 'request_item',
    shape: (row) => ({
      number: text(row.number, 40),
      short_description: text(row.short_description),
      state: text(row.state, 40),
      assignedTo: text(row.assigned_to, 100),
      assignmentGroup: text(row.assignment_group, 100),
      active: flag(row.active),
    }),
    refs: (row) => [{ role: 'task_assignee', sysId: raw(row.assigned_to), name: text(row.assigned_to, 100) }],
  },
  changeTasks: {
    table: 'change_task',
    query: (id) => `change_request=${id}^ORDERBYsys_created_on`,
    fields: ['number', 'short_description', 'state', 'assigned_to', 'assignment_group', 'change_task_type', 'active', 'change_request'],
    link: 'change_request',
    shape: (row) => ({
      number: text(row.number, 40),
      type: text(row.change_task_type, 60),
      short_description: text(row.short_description),
      state: text(row.state, 40),
      assignedTo: text(row.assigned_to, 100),
      assignmentGroup: text(row.assignment_group, 100),
      active: flag(row.active),
    }),
    refs: (row) => [{ role: 'task_assignee', sysId: raw(row.assigned_to), name: text(row.assigned_to, 100) }],
  },
  items: {
    table: 'sc_req_item',
    query: (id) => `request=${id}^ORDERBYnumber`,
    fields: ['number', 'short_description', 'state', 'stage', 'cat_item', 'approval', 'assigned_to', 'assignment_group', 'due_date', 'request'],
    link: 'request',
    shape: (row) => ({
      number: text(row.number, 40),
      item: text(row.cat_item, 100),
      short_description: text(row.short_description),
      state: text(row.state, 40),
      stage: text(row.stage, 40),
      approval: text(row.approval, 40),
      assignedTo: text(row.assigned_to, 100),
      assignmentGroup: text(row.assignment_group, 100),
      due: text(row.due_date, 40),
    }),
    refs: (row) => [{ role: 'task_assignee', sysId: raw(row.assigned_to), name: text(row.assigned_to, 100) }],
  },
};

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

async function readListSource(key, { sysId, table: ownTable }, deps, memo) {
  const spec = SOURCES[key];
  const fields = spec.fields;
  const { rows, failure } = await softRead(deps, spec.table, spec.query(sysId), fields, { limit: LIMITS.relatedRows + 1, displayValue: true });
  if (failure) return { access: accessEntry(spec.table, failure.status, failure.note) };

  const own = rows.filter((row) => sameId(raw(row[spec.link]), sysId));
  if (own.length < rows.length) {
    return { access: accessEntry(spec.table, STATUS.ERROR, `Could not check ${spec.table}: the instance did not apply the filter on this record, so its rows were not used.`) };
  }
  if (!rows.length) return emptyResult(spec.table, ownTable, deps, memo, []);

  const kept = own.slice(0, LIMITS.relatedRows);
  const refs = kept.flatMap((row) => (spec.refs ? spec.refs(row) : [])).filter((ref) => SYS_ID_RE.test(ref.sysId));
  const note = own.length > kept.length ? `Showing the first ${kept.length}.` : '';
  return { items: kept.map(spec.shape), refs, access: accessEntry(spec.table, STATUS.OK, note) };
}

// Zero rows: a fact only when the user can see rows of the table (the record's own table and `task` count as visible).
async function emptyResult(source, ownTable, deps, memo, items) {
  if (source === ownTable || source === 'task') return { items, access: accessEntry(source, STATUS.EMPTY) };
  const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
  if (seen.status === STATUS.EMPTY) return { items, access: accessEntry(source, STATUS.EMPTY) };
  return { access: accessEntry(source, seen.status, seen.note) };
}

// ---- Requested-item variables ------------------------------------------------------------------------

const VARIABLE_FIELDS = [
  'request_item',
  'sc_item_option.value',
  'sc_item_option.order',
  'sc_item_option.item_option_new.question_text',
  'sc_item_option.item_option_new.name',
  'sc_item_option.item_option_new.type',
  'sc_item_option.item_option_new.reference',
];

// Variable types that only lay out the form, by label (the stored type is a number that differs between releases)
// and by the few codes that are stable: 11 label, 12 break, 14 macro, 15 UI page, 17 macro with label, 19/20 containers.
const LAYOUT_TYPE = /^(label|break|container|macro|ui page|html|split|rich text|formatter|attachment)/i;
const LAYOUT_CODES = new Set(['11', '12', '14', '15', '17', '19', '20']);
// Answers that must never reach a prompt: masked/password types, and anything named like a secret.
const SECRET_TYPE = /mask|password|encrypt/i;
const SECRET_NAME = /(?<![a-z])(pass(word|code|phrase|wd)?|pwd|secrets?|tokens?|api[_ -]?key|credential|pin|ssn|cvv|iban|social[_ -]?security|credit[_ -]?card|card[_ -]?number)(?![a-z])/i;
const ID_LIST = /^[0-9a-f]{32}(,[0-9a-f]{32})*$/i;

// Reference answers hold a sys_id. The column that shows a person what it is, by table; 'name' for the rest.
const DISPLAY_COLUMN = {
  task: 'number',
  incident: 'number',
  sc_req_item: 'number',
  sc_request: 'number',
  sc_task: 'number',
  change_request: 'number',
  problem: 'number',
  kb_knowledge_base: 'title',
  kb_knowledge: 'short_description',
  sc_cat_item: 'name',
};

// The tables a reference answer may be resolved against. The table comes from the variable's definition (record data), so it is not
// trusted: a name outside this list is not read, and the answer is left out with a note. People, groups, places, configuration items,
// catalog items, articles and the task tables are what request forms ask for. Subclasses of cmdb_ci are allowed by prefix.
export const REFERENCE_TABLES = Object.freeze([
  'sys_user', 'sys_user_group', 'cmn_location', 'cmn_department', 'cmn_cost_center', 'core_company', 'customer_account', 'csm_consumer',
  'customer_contact', 'cmdb_ci', 'cmdb_ci_service', 'cmdb_model', 'sc_cat_item', 'kb_knowledge', 'kb_knowledge_base', 'task', 'incident',
  'problem', 'change_request', 'sc_request', 'sc_req_item', 'sc_task',
]);
export const isReferenceTableAllowed = (table) => REFERENCE_TABLES.includes(table) || /^cmdb_ci_[a-z0-9_]+$/.test(table);

async function resolveReferences(wanted, deps) {
  // wanted: Map<refTable, Set<sysId>> -> Map<sysId, display name>
  const names = new Map();
  let failed = false;
  const blocked = new Set(); // tables the organisation does not allow
  for (const [refTable, ids] of wanted) {
    const column = DISPLAY_COLUMN[refTable] || 'name';
    // eslint-disable-next-line no-await-in-loop -- a few small reads, kept sequential.
    const { rows, failure } = await softRead(deps, refTable, `sys_idIN${[...ids].join(',')}`, ['sys_id', column], { limit: ids.size + 2, displayValue: false });
    if (failure?.status === STATUS.BLOCKED) blocked.add(refTable);
    else if (failure) failed = true;
    rows.forEach((row) => raw(row[column]) && names.set(raw(row.sys_id).toLowerCase(), oneLine(raw(row[column]), 100)));
  }
  return { names, failed, blocked: [...blocked] };
}

async function readVariables({ sysId }, deps, memo) {
  const source = 'sc_item_option_mtom';
  const { rows, failure } = await softRead(deps, source, `request_item=${sysId}`, VARIABLE_FIELDS, { limit: 120, displayValue: true });
  if (failure) return { access: accessEntry(source, failure.status, failure.note) };
  if (rows.some((row) => !sameId(raw(row.request_item), sysId))) {
    return { access: accessEntry(source, STATUS.ERROR, `Could not check ${source}: the instance did not apply the filter on this record, so its rows were not used.`) };
  }
  if (!rows.length) return emptyResult(source, '', deps, memo, []);

  let left = 0;
  let labelled = 0;
  const candidates = [];
  for (const row of rows) {
    const question = oneLine(disp(row['sc_item_option.item_option_new.question_text']) || raw(row['sc_item_option.item_option_new.name']), LIMITS.variableQuestion);
    const typeLabel = disp(row['sc_item_option.item_option_new.type']);
    const typeCode = raw(row['sc_item_option.item_option_new.type']);
    const name = raw(row['sc_item_option.item_option_new.name']);
    const value = disp(row['sc_item_option.value']).trim();
    if (question) labelled += 1;
    if (LAYOUT_CODES.has(typeCode) || LAYOUT_TYPE.test(typeLabel) || !value) continue;
    if (SECRET_TYPE.test(typeLabel) || SECRET_NAME.test(name) || SECRET_NAME.test(question)) {
      left += 1;
      continue;
    }
    if (!question) continue;
    candidates.push({ question, value, order: Number.parseFloat(raw(row['sc_item_option.order'])) || 0, refTable: raw(row['sc_item_option.item_option_new.reference']) });
  }

  if (!labelled) {
    return { access: accessEntry(source, STATUS.DENIED, 'Your user cannot read the variable definitions, so the answers could not be labelled with their questions.') };
  }

  // Reference answers are sys_ids: show the name, or leave the answer out. Never a raw id. A table that is not on the allow-list is
  // never read (silently refused; the note below counts the answers that were left out).
  const wanted = new Map();
  let notAllowed = 0;
  candidates.forEach((c) => {
    if (!ID_LIST.test(c.value)) return;
    if (!TABLE_RE.test(c.refTable)) return;
    if (!isReferenceTableAllowed(c.refTable)) {
      notAllowed += 1;
      return;
    }
    if (!wanted.has(c.refTable)) wanted.set(c.refTable, new Set());
    c.value.split(',').forEach((id) => wanted.get(c.refTable).add(id.toLowerCase()));
  });
  const { names, failed, blocked } = wanted.size ? await resolveReferences(wanted, deps) : { names: new Map(), failed: false, blocked: [] };

  let unresolved = 0;
  const items = [];
  for (const c of candidates.sort((a, b) => a.order - b.order)) {
    let value = c.value;
    if (ID_LIST.test(value)) {
      const shown = value.split(',').map((id) => names.get(id.toLowerCase()));
      if (shown.some((n) => !n)) {
        unresolved += 1;
        continue;
      }
      value = shown.join(', ');
    }
    items.push({ question: c.question, value: oneLine(value, LIMITS.variableValue) });
  }

  const shownItems = items.slice(0, LIMITS.variables);
  const notes = [];
  if (left) notes.push(`${left} masked or secret answer${left === 1 ? ' was' : 's were'} left out.`);
  if (unresolved) {
    const why = blocked.length ? ` (your organisation does not allow reading ${blocked.join(', ')})` : notAllowed ? ' (a referenced table is not one Agent Buddy reads)' : failed ? ' (the referenced table could not be read)' : '';
    notes.push(`${unresolved} reference answer${unresolved === 1 ? '' : 's'} could not be shown${why}.`);
  }
  if (items.length > shownItems.length) notes.push(`Showing the first ${shownItems.length}.`);
  // A person named in an answer ("Manager: ...") is a person on this record: add them so the firewall masks the name wherever it appears.
  const refs = [];
  for (const c of candidates) {
    if (c.refTable !== 'sys_user' || !ID_LIST.test(c.value)) continue;
    for (const id of c.value.split(',')) {
      const name = names.get(id.toLowerCase());
      if (name) refs.push({ role: 'variable_reference', sysId: id.toLowerCase(), name });
    }
  }
  return { items: shownItems, refs, access: accessEntry(source, STATUS.OK, notes.join(' ')) };
}

// ---- Domain extras: linked incidents, schedule conflicts, recent changes ----------------------------------------------------
// These three need more than "rows whose link column is this record": a problem's incidents can be many (so the oldest and the
// newest are read and the rest counted), and a change's conflicts are searched by the change's own CI, service and planned
// window. Those few values are read from the record itself (recordColumns) and only ever used to build the condition.

const DAY = 86400000;
const CHANGE_TABLE = 'change_request';
const INCIDENT_TABLE = 'incident';

// `deps.now` is optional (tests pin the clock with it); the live deps do not have it.
const nowOf = (deps) => (typeof deps.now === 'function' ? Number(deps.now()) : Date.now());

/**
 * A few columns of the record itself, needed to know what to look for (its configuration item, its planned window).
 * Only columns on the kind's display ceiling are asked for, and the values are not copied into the pack. One read per record
 * and column set, shared by every extra that needs it (memo).
 * @returns {Promise<{ row?: object, failure?: { status: string, note: string } }>}
 */
function recordColumns({ table, sysId }, columns, deps, memo) {
  const key = `record:${sysId}:${columns.join(',')}`;
  if (memo?.has(key)) return memo.get(key);
  const promise = (async () => {
    const ceiling = FIELDS_BY_KIND[kindForTable(table)] || [];
    const outside = columns.filter((name) => !ceiling.includes(name));
    if (outside.length) return { failure: { status: STATUS.ERROR, note: `Could not check ${table}: ${outside.join(', ')} may not be read for this kind of record.` } };
    const { rows, failure } = await softRead(deps, table, `sys_id=${sysId}`, columns, { limit: 1, displayValue: false });
    if (failure) return { failure };
    if (!rows.length) return { failure: { status: STATUS.ERROR, note: `Could not read ${table} again to find what to look for.` } };
    return { row: rows[0] };
  })();
  memo?.set(key, promise);
  return promise;
}

const skipped = (source, note) => ({ access: accessEntry(source, STATUS.SKIPPED, note) });

// ---- Incidents linked to a problem

// caller_id, opened_by and assigned_to are read so the people named in these incidents' wording and close notes are masked exactly
// (display names only). Every column here is on the 'problem-rca' spec for the incident kind (src/context/specs/domain.js); a test
// keeps the two in step.
const INCIDENT_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'opened_at', 'resolved_at', 'cmdb_ci', 'close_notes', 'problem_id', 'caller_id', 'opened_by', 'assigned_to'];

// The display names of the people on rows of other tickets (people columns of the rows, display values only: no extra table is read).
const REFERENCE_PERSON_COLUMNS = ['caller_id', 'opened_for', 'contact', 'consumer', 'requested_for', 'requested_by', 'assigned_to', 'opened_by'];
const personNames = (rows, columns = REFERENCE_PERSON_COLUMNS) =>
  rows.flatMap((row) => columns.map((column) => oneLine(disp(row[column]), 100))).filter((name) => name && !SYS_ID_RE.test(name));

function shapeIncident(row) {
  return {
    number: text(row.number, 40),
    short_description: text(row.short_description),
    state: text(row.state, 40),
    opened: text(row.opened_at, 40),
    resolved: text(row.resolved_at, 40),
    ci: text(row.cmdb_ci, 100),
    closeNotes: oneLine(disp(row.close_notes), LIMITS.historyCloseNotes),
  };
}

// Oldest first, by the stored (UTC) time so the order does not depend on the reader's date format.
const byOpened = (a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t : 0);

/**
 * The incidents linked to a problem (incident.problem_id): at most 20. Up to 20 are all read; more than that, the oldest 10 and
 * the newest 10 are read (the start and the latest state of the story) and the total is counted, not read.
 * The summary { total, shown } says how much is missing (total is null when the count could not be read).
 */
async function readLinkedIncidents({ sysId, table: ownTable }, deps, memo) {
  const source = INCIDENT_TABLE;
  const cap = LIMITS.relatedRows;
  const half = Math.floor(cap / 2);
  const read = (order, limit) => softRead(deps, source, `problem_id=${sysId}^${order}`, INCIDENT_FIELDS, { limit, displayValue: true });
  // The instance ignoring a condition shows up as rows of other problems: none of them may be used.
  const wrongRows = (rows) => rows.some((row) => !sameId(raw(row.problem_id), sysId));

  const first = await read('ORDERBYopened_at', cap + 1);
  if (first.failure) return { access: accessEntry(source, first.failure.status, first.failure.note) };
  if (wrongRows(first.rows)) {
    return { access: accessEntry(source, STATUS.ERROR, `Could not check ${source}: the instance did not apply the filter on this problem, so its rows were not used.`) };
  }
  if (!first.rows.length) return emptyResult(source, ownTable, deps, memo, []);

  const shaped = (rows) => rows.map((row) => ({ id: raw(row.sys_id).toLowerCase(), t: parseSnTime(raw(row.opened_at)), item: shapeIncident(row), row }));
  const finish = (entries, total, note) => {
    const sorted = [...entries].sort(byOpened);
    return { items: sorted.map((e) => e.item), summary: { total, shown: sorted.length }, access: accessEntry(source, STATUS.OK, note), names: personNames(sorted.map((e) => e.row)), reference: true };
  };

  if (first.rows.length <= cap) return finish(shaped(first.rows), first.rows.length, '');

  let total = null;
  try {
    const n = await deps.countRecords?.(source, `problem_id=${sysId}`);
    if (Number.isFinite(n) && n > cap) total = n;
  } catch (err) {
    if (isSessionExpired(err) || err?.name === 'AbortError') throw err;
  }
  const outOf = total ?? `more than ${cap}`;
  const oldest = shaped(first.rows.slice(0, half));
  const newest = await read('ORDERBYDESCopened_at', cap - half);
  if (newest.failure || wrongRows(newest.rows)) {
    const kept = shaped(first.rows.slice(0, cap));
    return finish(kept, total, `Showing the oldest ${kept.length} of ${outOf}.`);
  }
  const seen = new Set(oldest.map((e) => e.id));
  const tail = shaped(newest.rows).filter((e) => !seen.has(e.id));
  return finish([...oldest, ...tail], total, `Showing the oldest ${oldest.length} and the newest ${tail.length} of ${outOf}.`);
}

// ---- Other changes in a change's window (conflicts) and recent changes on a case's CI

// requested_by and assigned_to are read for the same reason as on the linked incidents: to mask the people the rows name.
const CHANGE_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'type', 'risk', 'start_date', 'end_date', 'cmdb_ci', 'business_service', 'requested_by', 'assigned_to'];
const CONFLICT_ROWS = 10;
const CONFLICT_READ = 50;
const RECENT_ROWS = 5;
const RECENT_READ = 25;
const RECENT_BEFORE = 14 * DAY;
const RECENT_AFTER = 7 * DAY;

function shapeChange(row) {
  return {
    number: text(row.number, 40),
    short_description: text(row.short_description),
    state: text(row.state, 40),
    type: text(row.type, 40),
    risk: text(row.risk, 40),
    start: text(row.start_date, 40),
    end: text(row.end_date, 40),
    ci: text(row.cmdb_ci, 100),
    service: text(row.business_service, 100),
  };
}

const filterIgnored = (table, field) => ({ status: STATUS.ERROR, note: `Could not check ${table} by ${field}: the instance did not apply the filter, so its rows were not used.` });

/**
 * Other active changes on the same CI or business service whose planned window overlaps this change's. The instance is asked
 * with a window padded by a day on each side (so a time-zone difference cannot hide a change) and the exact overlap is decided
 * here on the stored UTC times. At most 10 are returned; the number found is kept in the summary.
 */
async function readConflicts(record, deps, memo) {
  const own = await recordColumns(record, ['cmdb_ci', 'business_service', 'start_date', 'end_date'], deps, memo);
  if (own.failure) return { access: accessEntry(CHANGE_TABLE, own.failure.status, own.failure.note) };
  const start = parseSnTime(raw(own.row.start_date));
  const end = parseSnTime(raw(own.row.end_date));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return skipped(CHANGE_TABLE, 'The change has no planned start and end, so schedule conflicts were not checked.');
  }
  const keys = [['cmdb_ci', raw(own.row.cmdb_ci)], ['business_service', raw(own.row.business_service)]].filter(([, id]) => SYS_ID_RE.test(id));
  if (!keys.length) return skipped(CHANGE_TABLE, 'The change has no configuration item or business service, so schedule conflicts were not checked.');

  const found = new Map();
  const failures = [];
  let crowded = false;
  for (const [field, id] of keys) {
    const query = `${field}=${id}^sys_id!=${record.sysId}^active=true^start_date<=${formatSnTime(end + DAY)}^end_date>=${formatSnTime(start - DAY)}^ORDERBYstart_date`;
    // eslint-disable-next-line no-await-in-loop -- two small reads at most, kept sequential.
    const { rows, failure } = await softRead(deps, CHANGE_TABLE, query, CHANGE_FIELDS, { limit: CONFLICT_READ, displayValue: true });
    if (failure) {
      failures.push(failure);
      continue;
    }
    // A condition the instance ignored returns other CIs' changes: none of them is a conflict of this change.
    if (rows.some((row) => !sameId(raw(row[field]), id))) {
      failures.push(filterIgnored(CHANGE_TABLE, field));
      continue;
    }
    if (rows.length >= CONFLICT_READ) crowded = true;
    for (const row of rows) {
      const rowId = raw(row.sys_id).toLowerCase();
      const s = parseSnTime(raw(row.start_date));
      const e = parseSnTime(raw(row.end_date));
      if (!SYS_ID_RE.test(rowId) || rowId === record.sysId || !Number.isFinite(s) || !Number.isFinite(e) || s > end || e < start) continue;
      const hit = found.get(rowId) || { t: s, ...shapeChange(row), same: [], who: personNames([row]) };
      hit.same.push(field);
      found.set(rowId, hit);
    }
  }

  // "None found" is only a fact when every check could be read.
  if (failures.length && !found.size) return { access: accessEntry(CHANGE_TABLE, failures[0].status, failures[0].note) };
  const all = [...found.values()].sort((a, b) => a.t - b.t);
  const shown = all.slice(0, CONFLICT_ROWS);
  const items = shown.map(({ t, who, ...rest }) => rest);
  const notes = [];
  if (failures.length) notes.push('One of the two checks (configuration item or business service) could not be read.');
  if (all.length > items.length) notes.push(`Showing the first ${items.length} of ${all.length}.`);
  if (crowded) notes.push('The instance returned a very long list for this window, so some changes may not be listed.');
  return { items, summary: { total: all.length, shown: items.length }, access: accessEntry(CHANGE_TABLE, items.length ? STATUS.OK : STATUS.EMPTY, notes.join(' ')), names: shown.flatMap((h) => h.who), reference: items.length > 0 };
}

/** Changes on the case's configuration item made in the last 14 days or planned for the next 7: "did something change?". */
async function readRecentChanges(record, deps, memo) {
  const own = await recordColumns(record, ['cmdb_ci'], deps, memo);
  if (own.failure) return { access: accessEntry(CHANGE_TABLE, own.failure.status, own.failure.note) };
  const ci = raw(own.row.cmdb_ci);
  if (!SYS_ID_RE.test(ci)) return skipped(CHANGE_TABLE, 'The case has no configuration item, so recent changes were not looked up.');

  const now = nowOf(deps);
  const from = now - RECENT_BEFORE;
  const until = now + RECENT_AFTER;
  const query = `cmdb_ci=${ci}^end_date>=${formatSnTime(from - DAY)}^start_date<=${formatSnTime(until + DAY)}^ORDERBYDESCstart_date`;
  const { rows, failure } = await softRead(deps, CHANGE_TABLE, query, CHANGE_FIELDS, { limit: RECENT_READ, displayValue: true });
  if (failure) return { access: accessEntry(CHANGE_TABLE, failure.status, failure.note) };
  if (rows.some((row) => !sameId(raw(row.cmdb_ci), ci))) {
    const bad = filterIgnored(CHANGE_TABLE, 'cmdb_ci');
    return { access: accessEntry(CHANGE_TABLE, bad.status, bad.note) };
  }
  if (!rows.length) return emptyResult(CHANGE_TABLE, record.table, deps, memo, []);

  const kept = rows
    .filter((row) => {
      const s = parseSnTime(raw(row.start_date));
      const e = parseSnTime(raw(row.end_date));
      return Number.isFinite(s) && Number.isFinite(e) && e >= from && s <= until;
    })
    .slice(0, RECENT_ROWS);
  const items = kept.map(shapeChange);
  return { items, access: accessEntry(CHANGE_TABLE, items.length ? STATUS.OK : STATUS.EMPTY), names: personNames(kept), reference: items.length > 0 };
}

// Extras that are not a plain list of rows linked to the record.
const READERS = Object.freeze({ __proto__: null, variables: readVariables, linkedIncidents: readLinkedIncidents, conflicts: readConflicts, recentChanges: readRecentChanges });

// ---- Putting it together -------------------------------------------------------------------------------

/**
 * Read the extras named in `keys` (from relatedPlan).
 * @returns {Promise<{ related: object, refs: object[], access: object[] }>}
 *   `related[key]` is a list when the read worked (an empty list is a confirmed "none"); a key is absent when it could
 *   not be read or the answer was ambiguous, and `access` says why. `refs` are people met on the way (approvers, assignees).
 *   A list that was cut short also gets `related[key + 'Summary'] = { total, shown }` (linked incidents, conflicts).
 */
export async function readRelated(keys, record, deps, memo) {
  const results = await mapLimit(keys, CONCURRENCY, (key) => (READERS[key] ? READERS[key](record, deps, memo) : readListSource(key, record, deps, memo)));
  const related = {};
  keys.forEach((key, i) => {
    if (results[i].items) related[key] = results[i].items;
    if (results[i].items && results[i].summary) related[`${key}Summary`] = results[i].summary;
  });
  const refs = new Map();
  results.flatMap((r) => r.refs || []).forEach((ref) => {
    const sysId = ref.sysId.toLowerCase();
    if (!refs.has(sysId)) refs.set(sysId, { ...ref, sysId, table: 'sys_user' });
  });
  // People named on rows of OTHER tickets (display names), and whether any such row is in the result at all.
  const referenceNames = [...new Set(results.flatMap((r) => r.names || []))];
  const hasReference = results.some((r) => r.reference === true);
  return { related, refs: [...refs.values()], access: results.map((r) => r.access), referenceNames, hasReference };
}
