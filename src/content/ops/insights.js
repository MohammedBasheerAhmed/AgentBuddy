// READ operations for the Ticket screen's Insights cards (owner: Insights agent, docs/round3.md). See src/content/ops/index.js.
//
//   glance       { table, sysId }  -> { pack, slas, vip, outage, linked? }   N1 (and, from panel memory, N9, N11, N20, N24, N29); linked: a problem's incident count
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
import { NOTE_TEXT, STATUS, absentColumns, confirmEmptyIsReallyEmpty, entry as accessEntry, hiddenFieldEntry, softRead, tm } from '../../context/access.js';
import { readChangesOnTarget } from '../../context/related.js';
import { readChoiceLabels } from '../../context/choices.js';
import { FIELDS_BY_KIND } from '../../context/allowlists.js';
import { customersOf } from '../../context/identity.js';
import { isSensitiveTable, kindForTable } from '../../context/kinds.js';
import { SYS_ID_RE, cleanText, disp, oneLine, raw, sameId } from '../../context/util.js';

const SENSITIVE_NOTE = NOTE_TEXT.sensitiveLookup;

// What the Insights reads say (fixed sentences that name no table, no column and not "your user"; marked for the Arabic catalogue).
const INSIGHT_NOTE = Object.freeze({
  vipUnread: tm('The VIP flag of the caller could not be read.'),
  noHistory: tm('The history of this ticket is not available to you, so the path between groups is not shown.'),
  newestChanges: tm('Showing the newest {n} changes.'),
  noCiOrServiceProblems: tm('This ticket has no configuration item or service, so problems on it were not looked up.'),
  oneCheckFailed: tm('One of the two checks (configuration item or service) could not be read.'),
  changesKinds: tm('Changes are looked up for incidents, problems, changes and cases.'),
  problemsKinds: tm('Problems are looked up for incidents, problems, changes and cases.'),
});

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
    return { items: [], access: [accessEntry(source, STATUS.ERROR, NOTE_TEXT.ignoredFilter)] };
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
  const person = customersOf(pack).find((p) => SYS_ID_RE.test(p.sysId || ''));
  if (!person || pack?.sensitive) return { status: 'unknown', access: [] };
  const id = person.sysId.toLowerCase();
  const { rows, failure } = await softRead(deps, 'sys_user', `sys_id=${id}`, ['sys_id', 'vip'], { limit: 1, displayValue: false });
  if (failure) return { status: 'unknown', access: [accessEntry('sys_user', failure.status, failure.status === STATUS.BLOCKED ? failure.note : INSIGHT_NOTE.vipUnread)] };
  const row = rows.find((r) => sameId(raw(r.sys_id), id));
  const flag = row ? raw(row.vip) : '';
  const status = flag === 'true' ? 'yes' : flag === 'false' ? 'no' : 'unknown';
  // The caller's row, or its VIP column, did not come back: the flag is hidden from this user, which is not "not a VIP" (R-14, R-20).
  const unread = !row || absentColumns(row, ['vip']).length > 0;
  return { status, access: unread ? [accessEntry('sys_user', STATUS.DENIED, INSIGHT_NOTE.vipUnread)] : [] };
}

// ---- The record's own CI and service -----------------------------------------------------------------------------------

async function ownKeys({ table, sysId }, deps) {
  const ceiling = FIELDS_BY_KIND[kindForTable(table)] || [];
  const columns = ['cmdb_ci', 'business_service'].filter((c) => ceiling.includes(c));
  if (!columns.length) return { keys: [], failure: null };
  const { rows, failure } = await softRead(deps, table, `sys_id=${sysId}`, ['sys_id', ...columns], { limit: 1, displayValue: false });
  if (failure) return { keys: [], failure };
  const row = rows.find((r) => sameId(raw(r.sys_id), sysId));
  if (!row) return { keys: [], failure: { status: STATUS.ERROR, note: NOTE_TEXT.error } };
  // A configuration item or service that did not come back at all is one the user may not read: not "the ticket has none" (R-14).
  if (absentColumns(row, columns).length) return { keys: [], failure: null, hidden: true };
  return { keys: columns.map((c) => [c, raw(row[c]).toLowerCase()]).filter(([, id]) => SYS_ID_RE.test(id)), failure: null };
}

// ---- Field history (N24) ------------------------------------------------------------------------------------------------
// sys_audit holds one row per changed field. Many instances let only admins read it; then the journey says so and works from the
// record's counters. Only three fields are asked for (assignment group, state, priority: all on the ticket's display ceiling), and
// their stored values are turned into names with small reads: group names, and the words of the state and priority choices.
// The choices do NOT come from the choice table (a plain agent cannot read it: docs/live-checks-2026-11-07.md) but from the UI meta
// service, in the person's own language (src/context/choices.js). A value that service does not name falls back to the ticket's own
// display value when it is the value the ticket holds now, and then to plain wording: a stored value is never shown as a word.

const TRACKED = ['assignment_group', 'state', 'priority'];
const AUDIT_FIELDS = ['documentkey', 'fieldname', 'oldvalue', 'newvalue', 'sys_created_on'];
const MAX_CHANGES = 60;
const NO_HISTORY = INSIGHT_NOTE.noHistory;
const CHOICE_FIELDS = ['state', 'priority'];

async function groupNames(ids, deps) {
  const names = new Map();
  if (!ids.length) return names;
  const { rows } = await softRead(deps, 'sys_user_group', `sys_idIN${ids.join(',')}`, ['sys_id', 'name'], { limit: ids.length + 1, displayValue: false });
  for (const row of rows) if (SYS_ID_RE.test(raw(row.sys_id)) && raw(row.name)) names.set(raw(row.sys_id).toLowerCase(), oneLine(raw(row.name), 100));
  return names;
}

/**
 * What the ticket itself shows for the state and priority it holds NOW: 'state:2' -> 'In Progress'. The last resort for a value no
 * choice list named (the list could not be read, or it does not have the value): one small read of the ticket with display values.
 * A display value that is only the stored value again is no word and is left out.
 */
async function ownLabels({ table, sysId }, fields, deps) {
  const labels = new Map();
  const { rows } = await softRead(deps, table, `sys_id=${sysId}`, ['sys_id', ...fields], { limit: 1, displayValue: true });
  const row = rows.find((r) => sameId(raw(r.sys_id), sysId));
  if (!row) return labels;
  for (const field of fields) {
    const stored = raw(row[field]).trim();
    const shown = oneLine(disp(row[field]), 60);
    if (stored && shown && shown !== stored) labels.set(`${field}:${stored}`, shown);
  }
  return labels;
}

export async function readFieldHistory({ table, sysId }, deps, memo = new Map()) {
  const source = 'sys_audit';
  const unavailable = (status, note) => ({ available: false, changes: [], note, access: [accessEntry('field history', status, note)] });
  // Newest first, so a long history keeps its latest changes (where the ticket is now, and how it got there lately).
  const query = `tablename=${table}^documentkey=${sysId}^fieldnameIN${TRACKED.join(',')}^ORDERBYDESCsys_created_on`;
  const { rows, failure } = await softRead(deps, source, query, AUDIT_FIELDS, { limit: MAX_CHANGES + 1, displayValue: false });
  if (failure) return unavailable(failure.status, failure.status === STATUS.BLOCKED ? failure.note : NO_HISTORY);
  if (rows.some((row) => !sameId(raw(row.documentkey), sysId) || !TRACKED.includes(raw(row.fieldname)))) {
    return unavailable(STATUS.ERROR, NOTE_TEXT.ignoredFilter);
  }
  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
    if (seen.status !== STATUS.EMPTY) return unavailable(seen.status, NO_HISTORY);
    return { available: true, changes: [], note: '', access: [accessEntry('field history', STATUS.EMPTY)] };
  }
  // The newest MAX_CHANGES, then oldest first as the journey reads them (a stable sort: changes made in the same second keep the
  // order the instance gave them). The stored 'YYYY-MM-DD HH:MM:SS' sorts as text.
  const kept = rows.slice(0, MAX_CHANGES).sort((a, b) => (raw(a.sys_created_on) < raw(b.sys_created_on) ? -1 : raw(a.sys_created_on) > raw(b.sys_created_on) ? 1 : 0));
  const groupIds = [...new Set(kept.filter((r) => raw(r.fieldname) === 'assignment_group').flatMap((r) => [raw(r.oldvalue), raw(r.newvalue)]).map((id) => id.toLowerCase()).filter((id) => SYS_ID_RE.test(id)))];
  const choiceFields = CHOICE_FIELDS.filter((field) => kept.some((r) => raw(r.fieldname) === field));
  const [groups, choices] = await Promise.all([groupNames(groupIds, deps), choiceFields.length ? readChoiceLabels(deps, table, choiceFields) : { labels: new Map() }]);
  // The fields that still hold a value no choice named: the ticket's own display value is asked for once, for those (and only then).
  const nameless = new Set();
  for (const r of kept) {
    const field = raw(r.fieldname);
    if (!CHOICE_FIELDS.includes(field)) continue;
    for (const v of [raw(r.oldvalue), raw(r.newvalue)]) if (v.trim() && !choices.labels.has(`${field}:${v.trim()}`)) nameless.add(field);
  }
  const own = nameless.size ? await ownLabels({ table, sysId }, [...nameless], deps) : new Map();
  // The name of a stored value, or '' when there is none to give: a group the user cannot see, a state or a priority no list names.
  // The panel says "a state" / "a priority" / "a group you cannot see" for these in its own language; a raw value ("State 10") is never shown.
  const nameOf = (field, value) => {
    const v = raw(value).trim();
    if (!v) return '';
    if (field === 'assignment_group') return SYS_ID_RE.test(v) ? groups.get(v.toLowerCase()) || '' : '';
    return choices.labels.get(`${field}:${v}`) || own.get(`${field}:${v}`) || '';
  };
  const changes = kept.map((row) => {
    const field = raw(row.fieldname);
    const from = nameOf(field, row.oldvalue);
    const to = nameOf(field, row.newvalue);
    return {
      field,
      from,
      to,
      // a value that was there and has no name: not an empty value
      ...(!from && raw(row.oldvalue).trim() ? { fromUnlabelled: true } : {}),
      ...(!to && raw(row.newvalue).trim() ? { toUnlabelled: true } : {}),
      atUtc: oneLine(raw(row.sys_created_on), 40),
    };
  });
  const note = rows.length > MAX_CHANGES ? INSIGHT_NOTE.newestChanges.replace('{n}', String(MAX_CHANGES)) : '';
  return { available: true, changes, note, access: [accessEntry('field history', STATUS.OK, note)] };
}

// ---- Problems and known errors on the same CI or service (N26) ---------------------------------------------------------

const PROBLEM_FIELDS = ['sys_id', 'number', 'short_description', 'state', 'priority', 'known_error', 'workaround', 'sys_updated_on', 'cmdb_ci', 'business_service'];

export async function readKnownErrors({ table, sysId }, deps, memo = new Map()) {
  const source = 'problem';
  const own = await ownKeys({ table, sysId }, deps);
  if (own.failure) return { items: [], keys: [], access: [accessEntry(source, own.failure.status, own.failure.note)] };
  if (own.hidden) return { items: [], keys: [], access: [hiddenFieldEntry(source)] };
  if (!own.keys.length) return { items: [], keys: [], noTarget: true, access: [accessEntry(source, STATUS.SKIPPED, INSIGHT_NOTE.noCiOrServiceProblems)] };
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
      failures.push({ status: STATUS.ERROR, note: NOTE_TEXT.ignoredFilter });
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
    const first = failures[0] || { status: STATUS.ERROR, note: NOTE_TEXT.error };
    return { items: [], keys: own.keys.map(([c]) => c), access: [accessEntry(source, first.status, first.note)] };
  }
  const items = [...found.values()].slice(0, 10);
  if (items.length) return { items, keys: own.keys.map(([c]) => c), access: [accessEntry(source, STATUS.OK, failures.length ? INSIGHT_NOTE.oneCheckFailed : '')] };
  // None found, but one of the two checks could not be made: not "none".
  if (failures.length) return { items, keys: own.keys.map(([c]) => c), access: [accessEntry(source, failures[0].status, failures[0].note)] };
  const seen = await confirmEmptyIsReallyEmpty(source, deps, memo);
  return { items, keys: own.keys.map(([c]) => c), access: [accessEntry(source, seen.status, seen.status === STATUS.EMPTY ? '' : seen.note)] };
}

// ---- The incidents linked to a problem, counted (F14) -------------------------------------------------------------------------
// "3 linked incidents that you can see", one line in the problem's glance. The count is of ROWS READ, not of the instance's own total: a row
// the user may not read is still counted in an Aggregate or X-Total-Count answer (docs/live-checks-2026-11-07.md), and the line says "that you
// can see". One limited read of two columns of the incident table, through the same read layer as every other read here:
//   problem_id   the link itself (incident.problem_id, on the incident ceiling since the Check tab reads it: src/context/specs/checks.js); every row
//                is checked against the problem again, because the instance ignores a condition on a column it does not have
//   sys_id       the row's own id
// A full page is a lower bound ("at least"). A read that fails is not a count of none: nothing is said (null). The problem's own incidents are not
// listed or sent anywhere here; the AI's linked-incident read (src/context/related.js readLinkedIncidents) is a different, larger read.
export const LINKED_SHOWN = 50;

/**
 * @returns {Promise<{ count: number, atLeast: boolean } | null>} null when the count could not be told (a refused or blocked read, a condition the
 *   instance ignored, an empty answer from a table the user may not see at all)
 */
export async function readLinkedIncidentCount({ sysId }, deps, memo = new Map()) {
  const { rows, failure } = await softRead(deps, 'incident', `problem_id=${sysId}`, ['sys_id', 'problem_id'], { limit: LINKED_SHOWN + 1, displayValue: false });
  if (failure) return null;
  if (rows.some((row) => !sameId(raw(row.problem_id), sysId))) return null;
  if (!rows.length) {
    const seen = await confirmEmptyIsReallyEmpty('incident', deps, memo);
    return seen.status === STATUS.EMPTY ? { count: 0, atLeast: false } : null;
  }
  return rows.length > LINKED_SHOWN ? { count: LINKED_SHOWN, atLeast: true } : { count: rows.length, atLeast: false };
}

// ---- The operations -----------------------------------------------------------------------------------------------------

const CI_KINDS = ['incident', 'problem', 'case', 'change'];

export default {
  async glance(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const pack = await readContextPack(recordOf(args), deps, { feature: 'insights-ticket', allowSensitive });
    const memo = new Map();
    // (pack.table is the real class when the record was opened as a general task)
    const [slas, vip, outage, linked] = await Promise.all([
      readSlaTimes({ table: pack.table, sysId: pack.sysId }, deps, memo),
      readVip(pack, deps),
      findOpenDuplicates(pack, deps, { windowHours: 24, limit: 25, allowSensitive, now: nowOf(deps) }),
      // (a problem only: how many incidents are linked to it, F14; an incident table the organisation blocks, or a read that fails, gives none)
      pack.kind === 'problem' ? readLinkedIncidentCount({ sysId: pack.sysId }, deps, memo) : null,
    ]);
    return { pack, slas, vip, outage, ...(linked ? { linked } : {}) };
  },

  async lookalikes(args, { deps, checkPack, allowSensitive = false }) {
    const pack = checkPack(args?.pack);
    return findSimilarTickets(pack, deps, { resolvedOnly: true, limit: 8, allowSensitive, routing: true });
  },

  async journey(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { available: false, changes: [], note: SENSITIVE_NOTE, access: [accessEntry('field history', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    // (the panel still sends its language; the words come in the person's own language from the instance, so it is not used here)
    return readFieldHistory(record, deps, new Map());
  },

  async ciChanges(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { items: [], keys: [], access: [accessEntry('change_request', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    if (!CI_KINDS.includes(kindForTable(record.table))) return { items: [], keys: [], access: [accessEntry('change_request', STATUS.SKIPPED, INSIGHT_NOTE.changesKinds)] };
    return readChangesOnTarget(record, deps, { beforeDays: 7, afterDays: 3 });
  },

  async knownErrors(args, { deps, checkRecord, allowSensitive = false }) {
    checkRecord(args);
    const record = recordOf(args);
    if (sensitive(record.table, deps, allowSensitive)) return { items: [], keys: [], access: [accessEntry('problem', STATUS.SKIPPED, SENSITIVE_NOTE)] };
    if (!CI_KINDS.includes(kindForTable(record.table))) return { items: [], keys: [], access: [accessEntry('problem', STATUS.SKIPPED, INSIGHT_NOTE.problemsKinds)] };
    return readKnownErrors(record, deps);
  },
};
