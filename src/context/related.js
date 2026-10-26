// The extras next to a record: SLAs, approvals, child and catalog tasks, request items, requested-item variables.
// Each one is optional and fails soft: a refused read becomes an `access` note, never an error, and an empty answer is
// only called "empty" when the user can see rows of that table at all (see access.js).
//
// Every list is read with a condition on the record, and each row is checked against the record again: ServiceNow
// ignores a condition on a column that does not exist and then returns every row, which must never pass for "the
// approvals of this ticket".

import { FEATURE_RELATED, LIMITS } from './allowlists.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from './access.js';
import { SYS_ID_RE, TABLE_RE, disp, mapLimit, oneLine, raw } from './util.js';

const CONCURRENCY = 3;

// What a kind of record can have. The feature narrows this (FEATURE_RELATED) and a sensitive table narrows it to SLAs.
export const RELATED_BY_KIND = Object.freeze({
  incident: ['slas', 'childTasks'],
  problem: ['childTasks'],
  change: ['approvals', 'changeTasks'],
  request: ['items', 'approvals'],
  requested_item: ['variables', 'approvals', 'catalogTasks', 'slas'],
  catalog_task: ['slas'],
  case: ['slas', 'childTasks'],
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
const DISPLAY_COLUMN = { task: 'number', incident: 'number', sc_req_item: 'number', change_request: 'number', problem: 'number', kb_knowledge_base: 'title', sc_cat_item: 'name' };

async function resolveReferences(wanted, deps) {
  // wanted: Map<refTable, Set<sysId>> -> Map<sysId, display name>
  const names = new Map();
  let failed = false;
  for (const [refTable, ids] of wanted) {
    const column = DISPLAY_COLUMN[refTable] || 'name';
    // eslint-disable-next-line no-await-in-loop -- a few small reads, kept sequential.
    const { rows, failure } = await softRead(deps, refTable, `sys_idIN${[...ids].join(',')}`, ['sys_id', column], { limit: ids.size + 2, displayValue: false });
    if (failure) failed = true;
    rows.forEach((row) => raw(row[column]) && names.set(raw(row.sys_id).toLowerCase(), oneLine(raw(row[column]), 100)));
  }
  return { names, failed };
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

  // Reference answers are sys_ids: show the name, or leave the answer out. Never a raw id.
  const wanted = new Map();
  candidates.forEach((c) => {
    if (!ID_LIST.test(c.value)) return;
    if (!TABLE_RE.test(c.refTable)) return;
    if (!wanted.has(c.refTable)) wanted.set(c.refTable, new Set());
    c.value.split(',').forEach((id) => wanted.get(c.refTable).add(id.toLowerCase()));
  });
  const { names, failed } = wanted.size ? await resolveReferences(wanted, deps) : { names: new Map(), failed: false };

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
  if (unresolved) notes.push(`${unresolved} reference answer${unresolved === 1 ? '' : 's'} could not be shown${failed ? ' (the referenced table could not be read)' : ''}.`);
  if (items.length > shownItems.length) notes.push(`Showing the first ${shownItems.length}.`);
  return { items: shownItems, access: accessEntry(source, STATUS.OK, notes.join(' ')) };
}

// ---- Putting it together -------------------------------------------------------------------------------

/**
 * Read the extras named in `keys` (from relatedPlan).
 * @returns {Promise<{ related: object, refs: object[], access: object[] }>}
 *   `related[key]` is a list when the read worked (an empty list is a confirmed "none"); a key is absent when it could
 *   not be read or the answer was ambiguous, and `access` says why. `refs` are people met on the way (approvers, assignees).
 */
export async function readRelated(keys, record, deps, memo) {
  const results = await mapLimit(keys, CONCURRENCY, (key) => (key === 'variables' ? readVariables(record, deps, memo) : readListSource(key, record, deps, memo)));
  const related = {};
  keys.forEach((key, i) => {
    if (results[i].items) related[key] = results[i].items;
  });
  const refs = new Map();
  results.flatMap((r) => r.refs || []).forEach((ref) => {
    const sysId = ref.sysId.toLowerCase();
    if (!refs.has(sysId)) refs.set(sysId, { ...ref, sysId, table: 'sys_user' });
  });
  return { related, refs: [...refs.values()], access: results.map((r) => r.access) };
}
