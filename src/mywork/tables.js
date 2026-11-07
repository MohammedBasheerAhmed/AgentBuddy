// Which ticket tables My work reads, what it reads from each, and what to call them. Pure.
//
// The queue is "every open ticket assigned to me" whatever its type. The count comes first, from ONE Aggregate API read on `task`
// grouped by class (src/mywork/read.js): that names every class that has something for me, including custom ones, without reading
// any ticket text. Rows are then read per class, from the class's own table, because only there are its own columns (who the
// customer is, the hold reason) and its own state labels (the `task` table's state choices are not the incident's: an incident
// "On Hold" is 3, which `task` would show as "Closed Complete").
import { TABLE_RE } from '../context/util.js';
import { isSensitiveTable, kindForTable } from '../context/kinds.js';
import { RISK_COLUMNS, VIP_COLUMNS, ACCOUNT_COLUMNS } from '../context/specs/mywork.js';
import { tm } from '../i18n/core.js';

// Columns every task-derived table has. Nothing here is free text except the title (short_description).
//   sys_id, number, short_description   the row, its number, the one line a person recognises it by
//   priority, state                     the chip and the order
//   sys_updated_on, opened_at           how long it has been quiet; how long it has waited in the group queue
//   sys_class_name                      the real type of the row (a task may be of a child class)
//   cmdb_ci                             "3 of your tickets are on the same CI" (the outage note)
export const COMMON_COLUMNS = Object.freeze(['sys_id', 'number', 'short_description', 'priority', 'state', 'sys_updated_on', 'opened_at', 'sys_class_name', 'cmdb_ci']);

/**
 * The tables My work knows by name.
 *   customer   the reference to the person the ticket is for; its `.user_name` (dot-walked) is compared with the author of the
 *              newest customer-visible comment, so "Customer replied" means the customer and not a colleague. It is used in the
 *              content script only and never returned to the panel.
 *   hold       the table has a hold reason (On hold: Awaiting caller / vendor / change...). A column the table does not have is
 *              ignored by the Table API, so asking for it on an older release costs nothing.
 *   stage      the table has a stage that can say what its state does not (a requested item that still waits for its approval:
 *              src/domain/states.js). Read the same way.
 */
// (one and many are shown to the person, in sentences too: marked with tm(), translated where they are drawn)
export const KNOWN_TABLES = Object.freeze({
  incident: { one: tm('Incident'), many: tm('Incidents'), customer: 'caller_id', hold: true },
  incident_task: { one: tm('Incident task'), many: tm('Incident tasks') },
  problem: { one: tm('Problem'), many: tm('Problems') },
  problem_task: { one: tm('Problem task'), many: tm('Problem tasks') },
  change_request: { one: tm('Change'), many: tm('Changes'), customer: 'requested_by' },
  change_task: { one: tm('Change task'), many: tm('Change tasks') },
  sc_req_item: { one: tm('Requested item'), many: tm('Requested items'), customer: 'requested_for', hold: true, stage: true },
  sc_task: { one: tm('Catalog task'), many: tm('Catalog tasks'), customer: 'request_item.requested_for', hold: true },
  sn_customerservice_case: { one: tm('Case'), many: tm('Cases'), customer: 'contact', hold: true },
  sn_customerservice_task: { one: tm('Case task'), many: tm('Case tasks') },
  sn_hr_core_case: { one: tm('HR case'), many: tm('HR cases'), customer: 'opened_for' },
  sn_hr_core_task: { one: tm('HR task'), many: tm('HR tasks') },
});

// The tables each work profile reads when the one-read count on `task` is not available (the person may not read `task`, or the
// Aggregate API is refused): then each table is counted on its own, and only the ones the person works on are asked.
const PROFILE_TABLES = {
  it: ['incident', 'incident_task', 'problem', 'problem_task', 'change_request', 'change_task', 'sc_req_item', 'sc_task'],
  req: ['sc_req_item', 'sc_task'],
  csm: ['sn_customerservice_case', 'sn_customerservice_task'],
  hr: ['sn_hr_core_case', 'sn_hr_core_task'],
  mpc: ['problem', 'problem_task', 'change_request', 'change_task'],
};

/** The tables to count one by one for these profiles (IT when none is given). */
export function tablesForProfiles(profiles) {
  const list = Array.isArray(profiles) && profiles.length ? profiles : ['it'];
  const out = [];
  for (const id of list) for (const t of PROFILE_TABLES[id] || []) if (!out.includes(t)) out.push(t);
  return out.length ? out : [...PROFILE_TABLES.it];
}

const HR_FAMILY_RE = /^sn_hr_/;
export const isHrTable = (table) => HR_FAMILY_RE.test(String(table || ''));

/**
 * "Incidents", "Catalog tasks"; for a class we do not know, the name the instance gave it, exactly as given ("Facilities request"):
 * it can be in any language, so no English plural is made of it. Else "Other tickets".
 */
export function pluralOf(table, display = '') {
  const known = KNOWN_TABLES[table];
  if (known) return known.many;
  const name = String(display || '').trim();
  if (name && !/^[a-z0-9_]+$/.test(name)) return name;
  return tm('Other tickets');
}

export function singularOf(table, display = '') {
  const known = KNOWN_TABLES[table];
  if (known) return known.one;
  const name = String(display || '').trim();
  return name && !/^[a-z0-9_]+$/.test(name) ? name : tm('Ticket');
}

/**
 * The columns read from one table: the common ones, the hold reason where there is one, the customer's login where known; for the
 * rows of my own queue (`risk`) also what says why a ticket is at risk (riskColumnsFor).
 */
export function columnsFor(table, { group = false, risk = false, accounts = false } = {}) {
  const known = KNOWN_TABLES[table];
  const cols = [...COMMON_COLUMNS];
  if (known?.hold) cols.push('hold_reason');
  if (known?.stage) cols.push('stage');
  if (known?.customer) cols.push(`${known.customer}.user_name`);
  if (group) cols.push('assignment_group');
  if (risk) cols.push(...riskColumnsFor(table, { accounts }));
  return cols;
}

/**
 * The "at risk" columns of one table, by its kind (src/context/specs/mywork.js, where each has its reason): the reassignment and
 * reopen counts, the customer's VIP flag, and, only when the organisation names priority accounts (`accounts`), a case's account.
 * A class the spec does not name (a custom one: kind 'other') gets none.
 */
export function riskColumnsFor(table, { accounts = false } = {}) {
  const kind = kindForTable(table);
  const cols = Object.keys(RISK_COLUMNS).filter((column) => RISK_COLUMNS[column].includes(kind));
  if (VIP_COLUMNS[kind]) cols.push(VIP_COLUMNS[kind]);
  if (accounts && ACCOUNT_COLUMNS[kind]) cols.push(ACCOUNT_COLUMNS[kind]);
  return cols;
}

/** The dot-walked column that holds the customer's VIP flag on this table, or ''. */
export const vipColumn = (table) => VIP_COLUMNS[kindForTable(table)] || '';

/** The column that holds a case's account name on this table, or ''. */
export const accountColumn = (table) => ACCOUNT_COLUMNS[kindForTable(table)] || '';

/** The dot-walked column that holds the customer's login on this table, or ''. */
export const customerColumn = (table) => (KNOWN_TABLES[table]?.customer ? `${KNOWN_TABLES[table].customer}.user_name` : '');

/** Does this kind of ticket have a customer to keep up to date (so "customer not updated" makes sense)? */
export const hasCustomer = (table) => Boolean(KNOWN_TABLES[table]?.customer);

// Tickets whose comments do not reach a customer. A catalog task is worked for a requester who reads the requested item, not its tasks
// (src/features/stages.js cautionFor; docs/live-questions/audit-1107-states.md); a problem has no customer; the tasks of an incident, a
// problem, a change, a case or an HR case are team work. A word owed to a customer is never owed from here (audit of 2026-11-07, F5).
const TEAM_ONLY = new Set(['sc_task', 'problem', 'problem_task', 'incident_task', 'change_task', 'sn_customerservice_task', 'sn_hr_core_task']);

/**
 * Can a word to the customer be written on this kind of ticket (so "customer replied" and "no update to the customer" mean something)?
 * False for a catalog task and the kinds in TEAM_ONLY; true for every other class, a custom one included (as before).
 */
export const reachesCustomer = (table) => !TEAM_ONLY.has(String(table || ''));

/**
 * May the rows of this class be read for this person? 'read' | 'blocked' (the organisation's policy) | 'hr-off' (HR or another
 * sensitive table, and the policy does not allow its content) | 'hr-profile' (HR content is allowed, but the person has not turned
 * the HR profile on) | 'invalid' (not a table name).
 */
export function readDecision(table, { isBlocked, sensitivePrefixes, allowSensitive = false, profiles = [] } = {}) {
  if (!TABLE_RE.test(String(table || ''))) return 'invalid';
  let blocked;
  try {
    blocked = typeof isBlocked === 'function' && Boolean(isBlocked(table));
  } catch {
    blocked = true; // a policy check that cannot answer is not a yes
  }
  if (blocked) return 'blocked';
  if (isSensitiveTable(table, sensitivePrefixes)) {
    if (!allowSensitive) return 'hr-off';
    if (isHrTable(table) && !(Array.isArray(profiles) && profiles.includes('hr'))) return 'hr-profile';
  }
  return 'read';
}
