// READ operations for the Ticket screen's Insights cards (owner: Insights agent, docs/round3.md). See src/content/ops/index.js.
//
//   glance       { table, sysId }  -> { pack, slas, vip, outage }   N1 (and, from panel memory, N9, N11, N20, N24, N29)
//   lookalikes   { pack }          -> { hits, keywords, access }     N2, N10, N12: solved look-alikes with group and category
//   journey      { table, sysId }  -> { available, changes, note, access }   N24: group, state and priority changes (field history)
//   ciChanges    { table, sysId }  -> { items, keys, access }        N25, N28: changes on the same CI or service, last 7 / next 3 days
//   knownErrors  { table, sysId }  -> { items, keys, access }        N26: open problems and known errors on the same CI or service
//
// Every read is a GET through the context engine's deps (the person's own session; the policy guard refuses blocked tables), every
// argument is checked, and a refusal or an empty answer from a table the user may not see is reported in `access`, never as "none".
// The CI and service are always read from the record itself, by id: nothing the panel sends goes into a query except a checked
// table name and sys_id (and, for look-alikes, the keywords the context engine extracts itself, as for the existing 'similar' read).

import { findOpenDuplicates, findSimilarTickets, readContextPack } from '../../context/index.js';
import { STATUS, confirmEmptyIsReallyEmpty, entry as accessEntry, softRead } from '../../context/access.js';
import { readChangesOnTarget } from '../../context/related.js';
import { FIELDS_BY_KIND } from '../../context/allowlists.js';
import { isSensitiveTable, kindForTable } from '../../context/kinds.js';
import { SYS_ID_RE, cleanText, disp, oneLine, raw } from '../../context/util.js';

const SENSITIVE_NOTE = 'This record is in a sensitive table, so this is not looked up unless sensitive data is allowed.';
const CUSTOMER_ROLES = ['caller', 'requested_for', 'contact', 'consumer'];
const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// `deps.now` is optional (tests pin the clock with it); the live deps do not have it.
const nowOf = (deps) => (typeof deps.now === 'function' ? Number(deps.now()) : Date.now());
const recordOf = (args) => ({ table: String(args.table), sysId: String(args.sysId).toLowerCase() });
const sensitive = (table, deps, allowSensitive) => isSensitiveTable(table, deps.sensitivePrefixes) && !allowSensitive;

// ---- SLAs with their stored times ---------------------------------------------------------------------------------------
// The context engine's SLA extra keeps display values only (fine for a prompt); the glance needs the planned end as an instant.

const SLA_FIELDS = ['sla', 'stage', 'has_breached', 'planned_end_time', 'start_time', 'end_time', 'business_percentage', 'percentage', 'task'];

export async function readSlaTimes({ sysId }, deps, memo = new Map()) {
  const source = 'task_sla';
  const { rows, failure } = await softRead(deps, source, `task=${sysId}^ORDERBYDESCsys_created_on`, SLA_FIELDS, { limit: 21, displayValue: true });
  if (failure) return { items: [], access: [accessEntry(source, failure.status, failure.note)] };
  if (rows.some((row) => !sameId(raw(row.task), sysId))) {
    return { items: [], access: [accessEntry(source, STATUS.ERROR, 'Could not check the SLAs: the instance did not apply the filter on this record, so its rows were not used.')] };
  }
  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
    return { items: [], access: [accessEntry(source, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)] };
  }
  const items = rows.slice(0, 20).map((row) => {
    const pct = Number.parseFloat(raw(row.business_percentage) || raw(row.percentage));
    return {
      name: oneLine(disp(row.sla), 100),
      stage: oneLine(disp(row.stage), 40),
      stageValue: oneLine(raw(row.stage), 40),
      breached: raw(row.has_breached) === 'true',
      plannedEndUtc: oneLine(raw(row.planned_end_time), 40),
      startUtc: oneLine(raw(row.start_time), 40),
      endUtc: oneLine(raw(row.end_time), 40),
      percentage: Number.isFinite(pct) ? Math.round(pct) : null,
    };
  });
  return { items, access: [accessEntry(source, STATUS.OK)] };
}

// ---- The caller's VIP flag ----------------------------------------------------------------------------------------------

/** { status: 'yes' | 'no' | 'unknown', access }. Unknown when there is no caller, the user row is not readable or the flag is hidden. */
export async function readVip(pack, deps) {
  const person = (Array.isArray(pack?.people) ? pack.people : []).find((p) => CUSTOMER_ROLES.includes(p?.role) && SYS_ID_RE.test(p?.sysId || ''));
  if (!person || pack?.sensitive) return { status: 'unknown', access: [] };
  const id = person.sysId.toLowerCase();
  const { rows, failure } = await softRead(deps, 'sys_user', `sys_id=${id}`, ['sys_id', 'vip'], { limit: 1, displayValue: false });
  if (failure) return { status: 'unknown', access: [accessEntry('sys_user', failure.status, failure.status === STATUS.BLOCKED ? failure.note : 'The VIP flag of the caller could not be read.')] };
  const row = rows.find((r) => sameId(raw(r.sys_id), id));
  const flag = row ? raw(row.vip) : '';
  return { status: flag === 'true' ? 'yes' : flag === 'false' ? 'no' : 'unknown', access: [] };
}

// ---- The record's own CI and service -----------------------------------------------------------------------------------

async function ownKeys({ table, sysId }, deps) {
  const ceiling = FIELDS_BY_KIND[kindForTable(table)] || [];
  const columns = ['cmdb_ci', 'business_service'].filter((c) => ceiling.includes(c));
  if (!columns.length) return { keys: [], failure: null };
  const { rows, failure } = await softRead(deps, table, `sys_id=${sysId}`, ['sys_id', ...columns], { limit: 1, displayValue: false });
  if (failure) return { keys: [], failure };
  const row = rows.find((r) => sameId(raw(r.sys_id), sysId));
  if (!row) return { keys: [], failure: { status: STATUS.ERROR, note: `Could not read ${table} again to find its configuration item and service.` } };
  return { keys: columns.map((c) => [c, raw(row[c]).toLowerCase()]).filter(([, id]) => SYS_ID_RE.test(id)), failure: null };
}

// ---- Field history (N24) ------------------------------------------------------------------------------------------------
// sys_audit holds one row per changed field. Many instances let only admins read it; then the journey says so and works from the
// record's counters. Only three fields are asked for (assignment group, state, priority: all on the ticket's display ceiling), and
// their stored values are turned into names with two more small reads (group names, choice labels), each soft.

const TRACKED = ['assignment_group', 'state', 'priority'];
const AUDIT_FIELDS = ['documentkey', 'fieldname', 'oldvalue', 'newvalue', 'sys_created_on'];
const MAX_CHANGES = 60;
const NO_HISTORY = 'The field history of this record is not readable for your user, so the path between groups is not shown.';
// Labels for when the choice list cannot be read: priority is the same everywhere; incident states are the base system's.
const PRIORITY_LABEL = { 1: '1 - Critical', 2: '2 - High', 3: '3 - Moderate', 4: '4 - Low', 5: '5 - Planning' };
const INCIDENT_STATE = { 1: 'New', 2: 'In Progress', 3: 'On Hold', 6: 'Resolved', 7: 'Closed', 8: 'Canceled' };

async function choiceLabels(table, deps) {
  const { rows, failure } = await softRead(deps, 'sys_choice', `nameIN${table},task^elementINstate,priority^language=en^inactive=false`, ['name', 'element', 'value', 'label'], { limit: 200, displayValue: false });
  const labels = new Map();
  if (failure) return labels;
  // The table's own choices win over the ones it inherits from task.
  for (const row of [...rows].sort((a, b) => (raw(a.name) === table ? 1 : 0) - (raw(b.name) === table ? 1 : 0))) {
    const label = oneLine(raw(row.label), 60);
    if (label) labels.set(`${raw(row.element)}:${raw(row.value)}`, label);
  }
  return labels;
}

async function groupNames(ids, deps) {
  const names = new Map();
  if (!ids.length) return names;
  const { rows } = await softRead(deps, 'sys_user_group', `sys_idIN${ids.join(',')}`, ['sys_id', 'name'], { limit: ids.length + 1, displayValue: false });
  for (const row of rows) if (SYS_ID_RE.test(raw(row.sys_id)) && raw(row.name)) names.set(raw(row.sys_id).toLowerCase(), oneLine(raw(row.name), 100));
  return names;
}

export async function readFieldHistory({ table, sysId }, deps, memo = new Map()) {
  const source = 'sys_audit';
  const unavailable = (status, note) => ({ available: false, changes: [], note, access: [accessEntry('field history', status, note)] });
  const query = `tablename=${table}^documentkey=${sysId}^fieldnameIN${TRACKED.join(',')}^ORDERBYsys_created_on`;
  const { rows, failure } = await softRead(deps, source, query, AUDIT_FIELDS, { limit: MAX_CHANGES + 1, displayValue: false });
  if (failure) return unavailable(failure.status, failure.status === STATUS.BLOCKED ? failure.note : NO_HISTORY);
  if (rows.some((row) => !sameId(raw(row.documentkey), sysId) || !TRACKED.includes(raw(row.fieldname)))) {
    return unavailable(STATUS.ERROR, 'The field history answered with other records, so it was not used.');
  }
  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
    if (seen.status !== STATUS.EMPTY) return unavailable(seen.status, NO_HISTORY);
    return { available: true, changes: [], note: '', access: [accessEntry('field history', STATUS.EMPTY)] };
  }
  const kept = rows.slice(0, MAX_CHANGES);
  const groupIds = [...new Set(kept.filter((r) => raw(r.fieldname) === 'assignment_group').flatMap((r) => [raw(r.oldvalue), raw(r.newvalue)]).map((id) => id.toLowerCase()).filter((id) => SYS_ID_RE.test(id)))];
  const [groups, labels] = await Promise.all([groupNames(groupIds, deps), kept.some((r) => raw(r.fieldname) !== 'assignment_group') ? choiceLabels(table, deps) : new Map()]);
  const nameOf = (field, value) => {
    const v = raw(value).trim();
    if (!v) return '';
    if (field === 'assignment_group') return SYS_ID_RE.test(v) ? groups.get(v.toLowerCase()) || 'a group you cannot see' : '';
    const label = labels.get(`${field}:${v}`) || (field === 'priority' ? PRIORITY_LABEL[v] : table === 'incident' && field === 'state' ? INCIDENT_STATE[v] : '');
    return label || `${field === 'state' ? 'State' : 'Priority'} ${oneLine(v, 20)}`;
  };
  const changes = kept.map((row) => ({
    field: raw(row.fieldname),
    from: nameOf(raw(row.fieldname), row.oldvalue),
    to: nameOf(raw(row.fieldname), row.newvalue),
    atUtc: oneLine(raw(row.sys_created_on), 40),
  }));
  const note = rows.length > MAX_CHANGES ? `Showing the first ${MAX_CHANGES} changes.` : '';
  return { available: true, changes, note, access: [accessEntry('field history', STATUS.OK, note)] };
}

// ---- Problems and known errors on the same CI or service (N26) ---------------------------------------------------------

const PROBLEM_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'priority', 'known_error', 'workaround', 'sys_updated_on', 'cmdb_ci', 'business_service'];

export async function readKnownErrors({ table, sysId }, deps, memo = new Map()) {
  const source = 'problem';
  const own = await ownKeys({ table, sysId }, deps);
  if (own.failure) return { items: [], keys: [], access: [accessEntry(source, own.failure.status, own.failure.note)] };
  if (!own.keys.length) return { items: [], keys: [], access: [accessEntry(source, STATUS.SKIPPED, 'This ticket has no configuration item or service, so problems on it were not looked up.')] };
  const found = new Map();
  const failures = [];
  let read = false;
  for (const [field, id] of own.keys) {
    // Open problems, and known errors whether open or not (their workaround still helps).
    const query = `${field}=${id}^sys_id!=${sysId}^active=true^ORknown_error=true^ORDERBYDESCsys_updated_on`;
    // eslint-disable-next-line no-await-in-loop -- two small reads at most, kept sequential.
    const { rows, failure } = await softRead(deps, source, query, PROBLEM_FIELDS, { limit: 20, displayValue: true });
    if (failure) {
      failures.push(failure);
      continue;
    }
    if (rows.some((row) => !sameId(raw(row[field]), id))) {
      failures.push({ status: STATUS.ERROR, note: `Could not check problems by ${field}: the instance did not apply the filter, so its rows were not used.` });
      continue;
    }
    read = true;
    for (const row of rows) {
      const rowId = raw(row.sys_id).toLowerCase();
      if (!SYS_ID_RE.test(rowId) || rowId === sysId) continue;
      const hit = found.get(rowId) || {
        table: source,
        sysId: rowId,
        number: oneLine(disp(row.number), 40),
        short_description: cleanText(disp(row.short_description), 300),
        state: oneLine(disp(row.state), 40),
        priority: oneLine(disp(row.priority), 40),
        knownError: raw(row.known_error) === 'true',
        workaround: cleanText(disp(row.workaround), 600),
        updated: oneLine(disp(row.sys_updated_on), 40),
        same: [],
      };
      hit.same.push(field);
      found.set(rowId, hit);
    }
  }
  if (!read) {
    const first = failures[0] || { status: STATUS.ERROR, note: 'Could not read problems.' };
    return { items: [], keys: own.keys.map(([c]) => c), access: [accessEntry(source, first.status, first.note)] };
  }
  const items = [...found.values()].slice(0, 10);
  if (items.length) return { items, keys: own.keys.map(([c]) => c), access: [accessEntry(source, STATUS.OK, failures.length ? 'One of the two checks (configuration item or service) could not be read.' : '')] };
  const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
  return { items, keys: own.keys.map(([c]) => c), access: [accessEntry(source, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)] };
}

// ---- The operations -----------------------------------------------------------------------------------------------------

const CI_KINDS = ['incident', 'problem', 'case', 'change'];

export default {
  async glance(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const pack = await readContextPack(recordOf(args), deps, { feature: 'insights-ticket', allowSensitive });
    const memo = new Map();
    // (pack.table is the real class when the record was opened as a general task)
    const [slas, vip, outage] = await Promise.all([
      readSlaTimes({ table: pack.table, sysId: pack.sysId }, deps, memo),
      readVip(pack, deps),
      findOpenDuplicates(pack, deps, { windowHours: 24, limit: 25, allowSensitive, now: nowOf(deps) }),
    ]);
    return { pack, slas, vip, outage };
  },

  async lookalikes(args, { deps, checkPack, allowSensitive = false }) {
    const pack = checkPack(args?.pack);
    return findSimilarTickets(pack, deps, { resolvedOnly: true, limit: 8, allowSensitive, routing: true });
  },

  async journey(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { available: false, changes: [], note: SENSITIVE_NOTE, access: [accessEntry('field history', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    return readFieldHistory(record, deps);
  },

  async ciChanges(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { items: [], keys: [], access: [accessEntry('change_request', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    if (!CI_KINDS.includes(kindForTable(record.table))) return { items: [], keys: [], access: [accessEntry('change_request', STATUS.SKIPPED, 'Changes are looked up for incidents, problems, changes and cases.')] };
    return readChangesOnTarget(record, deps, { beforeDays: 7, afterDays: 3 });
  },

  async knownErrors(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { items: [], keys: [], access: [accessEntry('problem', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    if (!CI_KINDS.includes(kindForTable(record.table))) return { items: [], keys: [], access: [accessEntry('problem', STATUS.SKIPPED, 'Problems are looked up for incidents, problems, changes and cases.')] };
    return readKnownErrors(record, deps);
  },
};
