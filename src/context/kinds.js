// Which kind of ticket a table holds, which tables are sensitive, and which record a ServiceNow URL points at.

import { parseRecordNumber } from '../lib/recordNumber.js';
import { SYS_ID_RE, TABLE_RE } from './util.js';

export const KINDS = ['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task', 'knowledge', 'chat', 'other'];

const KIND_BY_TABLE = {
  incident: 'incident',
  problem: 'problem',
  change_request: 'change',
  sc_request: 'request',
  sc_req_item: 'requested_item',
  sc_task: 'catalog_task',
  sn_customerservice_case: 'case',
  sn_hr_core_case: 'hr_case',
  task: 'task',
  incident_task: 'task',
  change_task: 'task',
  problem_task: 'task',
  sn_customerservice_task: 'task',
  sn_hr_core_task: 'task',
  // Knowledge articles, and the conversations of a chat or messaging session (the interaction record and its chat tables).
  kb_knowledge: 'knowledge',
  interaction: 'chat',
  sys_cs_conversation: 'chat',
  live_group_profile: 'chat',
  chat_queue_entry: 'chat',
};

// HR case tables come in families: sn_hr_core_case has children per area (sn_hr_core_case_payroll, sn_hr_core_case_benefits,
// sn_hr_core_case_relations, ...) and lifecycle events and employee relations have their own (sn_hr_le_case, sn_hr_er_case). Every
// one of them is an HR case. Before, they fell to 'other', whose field ceiling has no subject_person or opened_for, so the employee
// the case is about was not read as a person and not masked by name. A table of the family that ends in _task stays a task.
const HR_CASE_RE = /^sn_hr_(?:[a-z0-9]+_)*case(?:_[a-z0-9]+)*$/;

// Custom tables that are kinds of task (u_* and x_* tables that extend `task`) are proven task-derived by something the code READS ANYWAY
// (audit of 2026-11-07, F7): the real class a record opened through `task` reports (src/context/pack.js resolveRealClass), or a row of
// the table that carries the columns only a task has (taskRowEvidence below, used by readContextPack). No table is read to find out.
// Such a table gets the generic `task` kind instead of 'other', for as long as this page's script lives: nothing is stored (build rule
// 7), and a script that has not seen the evidence yet keeps saying 'other', which is the honest "not known" answer.
const TASK_CLASSES = new Set();
const MAX_TASK_CLASSES = 200;

/** Remember that a table is a kind of task. Only a table the product does not know by name can be remembered. */
export function rememberTaskClass(table) {
  const name = String(table || '').trim().toLowerCase();
  if (!TABLE_RE.test(name) || name === 'task' || TASK_CLASSES.has(name)) return false;
  if (Object.prototype.hasOwnProperty.call(KIND_BY_TABLE, name) || (HR_CASE_RE.test(name) && !name.endsWith('_task'))) return false;
  if (TASK_CLASSES.size >= MAX_TASK_CLASSES) TASK_CLASSES.delete(TASK_CLASSES.values().next().value);
  TASK_CLASSES.add(name);
  return true;
}

/** Forget every remembered class (tests, and a script that retires). */
export function forgetTaskClasses() {
  TASK_CLASSES.clear();
}

// The columns only a task has: a row of an unknown table that returns all of these (even empty) is a task. They come back with the
// record read anyway (the generic ceiling lists them); a table that is not a task does not have them, and the Table API leaves a column
// it does not have out of the row altogether.
const TASK_ONLY_COLUMNS = Object.freeze(['opened_at', 'opened_by', 'assignment_group']);

/** Does a row read from `table` carry the columns only a task has? (A row is a plain object keyed by column.) */
export function taskRowEvidence(row) {
  return Boolean(row) && typeof row === 'object' && TASK_ONLY_COLUMNS.every((name) => Object.hasOwn(row, name));
}

/** The pack kind for a table name; a table we know nothing about is 'other', unless it is a custom kind of task (see above). */
export function kindForTable(table) {
  const name = String(table || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(KIND_BY_TABLE, name)) return KIND_BY_TABLE[name];
  if (HR_CASE_RE.test(name) && !name.endsWith('_task')) return 'hr_case';
  if (TASK_CLASSES.has(name)) return 'task';
  return 'other';
}

// HR data (cases about a person's leave, pay, conduct) is the most sensitive thing a fulfiller reads. Security and audit data is as
// sensitive: a security incident names the people and systems under investigation, a vulnerability says where a system can be
// attacked, a GRC issue or audit finding says what is wrong with a control. Their tables are recognised by prefix so custom tables in
// the same family are covered too. These prefixes are always on the list; the organisation's policy can add more
// (`sensitiveTablePrefixes`, src/policy/policy.js) and never remove one.
//
// A built-in prefix behaves exactly as a prefix the policy adds: free text and identities are read only when the organisation allows
// sensitive content (`allowHrContent`); the AI path asks the same question through isSensitiveByPolicy (src/policy/policy.js), which
// must consult this list too (an AI run on such a record then needs that switch, an approved endpoint and Strict mode). What stays
// HR-only is decided by the table KIND, not by this list: kindForTable above still gives 'hr_case' to the sn_hr_ case family alone
// (the HR case brief, the HR work profile), so a security incident is never treated as an HR case.
// Unverified table names: docs/live-questions/reads.md.
export const BUILT_IN_SENSITIVE_PREFIXES = Object.freeze([
  'sn_hr_', // HR Service Delivery: cases, tasks, lifecycle events, employee relations
  'sn_si_', // Security Incident Response: security incidents, their tasks and requests
  'sn_vul_', // Vulnerability Response: vulnerable items, vulnerabilities, remediation tasks
  'sn_grc_', // Governance, risk and compliance (IRM): issues, profiles, indicators
  'sn_risk_', // Risk management: risks, risk assessments
  'sn_compliance_', // Policy and compliance: controls, policies, citations
  'sn_audit_', // Audit management: engagements, audit tasks, findings
]);
const SENSITIVE_PREFIXES = BUILT_IN_SENSITIVE_PREFIXES;

/**
 * True for tables whose free text and identities are only read when the caller asks for sensitive data: the built-in families
 * (BUILT_IN_SENSITIVE_PREFIXES) and the policy's own prefixes.
 * @param {string} table
 * @param {string[]} [extraPrefixes] the policy's sensitiveTablePrefixes (lower case); the content script passes `deps.sensitivePrefixes`
 */
export function isSensitiveTable(table, extraPrefixes) {
  const name = String(table || '').trim().toLowerCase();
  if (!name) return false;
  const extra = Array.isArray(extraPrefixes) ? extraPrefixes.map((p) => String(p || '').trim().toLowerCase()).filter(Boolean) : [];
  return SENSITIVE_PREFIXES.some((prefix) => name.startsWith(prefix)) || extra.some((prefix) => name.startsWith(prefix));
}

// ---- Is this page a ticket? ----------------------------------------------------------------------
//
// An address like /ui_page.do?sys_id=<hex> (or a portal link with table=<name>, or a form that reports a table and a sys_id) names a
// table, but not every table is a ticket: a UI page, a script, a user, a report, the home page all have forms and sys_ids. The panel
// treats a page as "a record to work on" only when the table is
//   1) one the product knows (kindForTable is not 'other'), or one of the built-in families the product already handles (security,
//      vulnerability, GRC, audit, HR: BUILT_IN_SENSITIVE_PREFIXES) or the organisation's own record families (the policy's
//      sensitiveTablePrefixes, passed in as `extraPrefixes`), or
//   2) in a list a person with the source can extend: PORTAL_PAGE_TABLES (below) or TICKET_TABLES, or
//   3) proven by the live form: g_form answers with a number (src/content/recordResolver.js; decided there, where the form is known).
// Everything else is "no record": the plain "Open a ticket" help, no reads of a table named after a page, no bar, no "last viewed"
// (audit of 2026-11-07, part 2).

/**
 * The tables of a customer's own ticket-like records that a Workspace or a portal address names (those pages have no g_form to prove
 * it). Add the table name: `'u_facilities_request'`, `'x_acme_visit'`. A classic form of such a table needs no entry: its form has a
 * number. Empty on purpose: ServiceNow's own tables are known already.
 */
export const TICKET_TABLES = Object.freeze([]);

/**
 * Is a record of this table a ticket-like record the panel works on? (Not the live-form proof: that is the resolver's.)
 * @param {string} table
 * @param {{ extraPrefixes?: string[], extraTables?: string[] }} [options] the organisation's own families (policy
 *   sensitiveTablePrefixes) and any other tables the caller was told to trust
 */
export function isTicketTable(table, { extraPrefixes, extraTables } = {}) {
  const name = String(table || '').trim().toLowerCase();
  if (!TABLE_RE.test(name)) return false;
  if (kindForTable(name) !== 'other') return true;
  if (isSensitiveTable(name, extraPrefixes)) return true;
  const own = (list) => Array.isArray(list) && list.some((item) => String(item || '').trim().toLowerCase() === name);
  return own(Object.values(PORTAL_PAGE_TABLES)) || own(TICKET_TABLES) || own(extraTables);
}

// ---- Record numbers -----------------------------------------------------------------------------

const TABLE_BY_PREFIX = {
  INC: 'incident',
  PRB: 'problem',
  CHG: 'change_request',
  REQ: 'sc_request',
  RITM: 'sc_req_item',
  SCTASK: 'sc_task',
  CS: 'sn_customerservice_case',
  HRC: 'sn_hr_core_case',
  TASK: 'task',
  INT: 'incident_task',
  CTASK: 'change_task',
  PTASK: 'problem_task',
};

/** The usual table for a record number such as INC0010001 ('' when the prefix is not a known one). */
export function tableForNumber(number) {
  const parsed = parseRecordNumber(number);
  const prefix = /^[A-Z]+/.exec(parsed)?.[0] || '';
  return TABLE_BY_PREFIX[prefix] || '';
}

// ---- URLs ---------------------------------------------------------------------------------------

const BASE = 'https://instance.invalid';

/** Decode up to twice while the text still looks percent-encoded (nav_to uris and classic targets are often doubly encoded). */
function unescapeNested(text) {
  let value = String(text || '');
  for (let i = 0; i < 2 && /%(?:3F|3D|26|2F|25)/i.test(value); i += 1) {
    try {
      value = decodeURIComponent(value);
    } catch {
      break;
    }
  }
  return value;
}

const sysIdOf = (value) => {
  const id = String(value || '').trim();
  return SYS_ID_RE.test(id) ? id.toLowerCase() : '';
};

// number=INC0010001 among the clauses of a sysparm_query ("number=INC1^active=true")
function numberFromQuery(query) {
  for (const clause of String(query || '').split('^')) {
    const match = /^number=(.+)$/i.exec(clause.trim());
    const number = match ? parseRecordNumber(match[1]) : '';
    if (number) return number;
  }
  return '';
}

function sysIdFromQuery(query) {
  for (const clause of String(query || '').split('^')) {
    const match = /^sys_id=(.+)$/i.exec(clause.trim());
    const id = match ? sysIdOf(match[1]) : '';
    if (id) return id;
  }
  return '';
}

// The reference a table plus search params describe: sys_id first (exact), then a number. "-1" is a new record: it is described as
// { table, newRecord: true } here and left out by parseRecordRef (only parseNewRecordRef returns it).
function refFrom(table, params) {
  if (!TABLE_RE.test(table)) return null;
  if (String(params.get('sys_id') || '').trim() === '-1') return { table, newRecord: true };
  const sysId = sysIdOf(params.get('sys_id')) || sysIdFromQuery(params.get('sysparm_query'));
  if (sysId) return { table, sysId };
  const number = numberFromQuery(params.get('sysparm_query'));
  return number ? { table, number } : null;
}

// The article reader of the classic UI: /kb_view.do?sysparm_article=KB0010001 (the very link "Copy link" gives), or ?sys_kb_id=<id>.
// It is not a form of a table named kb_view: it shows a kb_knowledge article, so it is read as one (audit 2026-11-07, S9). The number
// is the sure part and is used first; sys_kb_id is taken to be the article's own sys_id (docs/live-questions/audit-1107-gate.md, 10).
const ARTICLE_READER_RE = /^kb_view(?:_customer)?$/;

function articleReaderRef(params) {
  const number = parseRecordNumber(params.get('sysparm_article'));
  if (number) return { table: 'kb_knowledge', number };
  const sysId = sysIdOf(params.get('sys_kb_id')) || sysIdOf(params.get('sys_id'));
  return sysId ? { table: 'kb_knowledge', sysId } : null;
}

// ---- Portals ------------------------------------------------------------------------------------
//
// A portal address names a PAGE (`id=ticket`), not a table: /sp?id=ticket&table=incident&sys_id=<id>. Pages that carry a
// `table` parameter need nothing here. Pages that show one record WITHOUT a `table` parameter are listed below, so the table
// can be inferred. It is the one place to teach Agent Buddy a customer's own record page: add `<page id>: '<table>'`.
// (Unverified against a real instance: docs/live-questions/portal.md, question 1.)
export const PORTAL_PAGE_TABLES = {
  sc_request: 'sc_request', // ?id=sc_request&sys_id=<request>
  sc_req_item: 'sc_req_item', // ?id=sc_req_item&sys_id=<requested item>
  sc_task: 'sc_task', // ?id=sc_task&sys_id=<catalog task>
  kb_article: 'kb_knowledge', // ?id=kb_article&sys_id=<article>
  kb_article_view: 'kb_knowledge', // ?id=kb_article_view&sysparm_article=KB0010001
};

// Pages that list, search or welcome. A sys_id on one of them is a filter or a category, never "the record being worked", so
// they never parse as a record even when they carry a table name.
const PORTAL_LIST_PAGES = new Set([
  'index', 'home', 'landing', 'welcome', 'my_requests', 'my_tickets', 'tickets', 'requests', 'my_approvals', 'approvals',
  'list', 'search', 'catalog', 'sc_home', 'sc_category', 'kb', 'kb_search', 'topic', 'my_items',
]);

// The first path segment of a portal is its URL suffix (sp, esc, csm, csp, hrsp, or any name the customer chose). These are
// never portals, so a page id inferred from `id=` is not trusted under them.
const NOT_PORTAL_SEGMENTS = new Set(['api', 'now', 'angular', 'images', 'scripts', 'styles', 'assets']);
const PORTAL_SEGMENT_RE = /^[a-z][a-z0-9_-]{0,30}$/i;

/** Every parameter of a portal address, names in lower case: the query string first, then a hash route (#/?id=..., #!/ticket?id=...). */
export function portalParams(url) {
  const out = new Map();
  const add = (list) => {
    for (const [name, value] of list) {
      const key = name.trim().toLowerCase();
      if (key && !out.has(key)) out.set(key, value);
    }
  };
  add(url.searchParams);
  const hash = String(url.hash || '').replace(/^#!?/, '');
  const q = hash.indexOf('?');
  const hashQuery = q >= 0 ? hash.slice(q + 1) : hash.includes('=') && !hash.startsWith('/') ? hash : '';
  if (hashQuery) add(new URLSearchParams(hashQuery));
  return out;
}

// KB0010001 is the one number prefix that tableForNumber (ticket tables) does not know.
const portalTableForNumber = (number) => tableForNumber(number) || (/^KB\d/.test(number) ? 'kb_knowledge' : '');

// A page named after a task table (?id=incident&sys_id=...) shows that table's record.
const pageNamedAfterTable = (page) => (['incident', 'problem', 'change', 'request', 'requested_item', 'catalog_task', 'case', 'hr_case'].includes(kindForTable(page)) ? page : '');

/**
 * The record a portal address points at, or null. `params` come from portalParams, `segments` are the path segments.
 * A sys_id that is present but not valid (a new record is -1) is never replaced by a number: it is "no record".
 */
function portalRef(params, segments) {
  const get = (...names) => {
    for (const name of names) {
      const value = String(params.get(name) || '').trim();
      if (value) return value;
    }
    return '';
  };
  const page = get('id').toLowerCase();
  if (PORTAL_LIST_PAGES.has(page)) return null;

  const article = parseRecordNumber(get('sysparm_article'));
  let table = get('table', 'sysparm_table').toLowerCase();
  // Inferring the table is only done on a portal-shaped address: one short path segment (/sp, /esc, /csm, ...).
  const portalShaped = segments.length <= 1 && (!segments[0] || (PORTAL_SEGMENT_RE.test(segments[0]) && !NOT_PORTAL_SEGMENTS.has(segments[0].toLowerCase())));
  if (!table && portalShaped) table = (article ? 'kb_knowledge' : '') || PORTAL_PAGE_TABLES[page] || pageNamedAfterTable(page);

  const query = get('sysparm_query');
  const idText = get('sys_id', 'sysparm_sys_id', 'sysparm_sysid');
  if (idText) {
    const sysId = sysIdOf(idText);
    return sysId && TABLE_RE.test(table) ? { table, sysId } : null;
  }
  const queryId = sysIdFromQuery(query);
  if (queryId) return TABLE_RE.test(table) ? { table, sysId: queryId } : null;

  const number = parseRecordNumber(get('number', 'sysparm_number')) || article || numberFromQuery(query);
  if (!number) return null;
  if (!table && portalShaped) table = portalTableForNumber(number);
  return TABLE_RE.test(table) ? { table, number } : null;
}

function parseRelative(input, depth) {
  if (depth > 3) return null;
  let url;
  try {
    url = new URL(String(input || '').trim(), BASE);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  const params = url.searchParams;

  // nav_to.do?uri=incident.do%3Fsys_id%3D... : the real address is inside the uri parameter.
  if (/\/nav_to\.do$/i.test(path)) {
    const uri = params.get('uri');
    return uri ? parseRelative(unescapeNested(uri), depth + 1) : null;
  }

  // Next Experience wrapper around a classic page: /now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D...
  const target = /\/params\/target\/(.+)$/i.exec(path + (url.hash || ''));
  if (target) return parseRelative(unescapeNested(target[1]), depth + 1);

  // Workspaces: .../record/<table>/<sys_id>[/...] (SOW, Agent Workspace, CSM, HR, configurable workspaces).
  const workspace = /\/record\/([a-z][a-z0-9_]*)\/([0-9a-f]{32}|-1)(?:[/#?]|$)/i.exec(path + url.hash);
  if (workspace) {
    const table = workspace[1].toLowerCase();
    if (workspace[2] === '-1') return { table, newRecord: true };
    const id = sysIdOf(workspace[2]);
    return id ? { table, sysId: id } : null;
  }

  // Classic forms: /incident.do?sys_id=... or ?sysparm_query=number=INC... . A list (incident_list.do) is not a record.
  const classic = /\/([a-z][a-z0-9_]*)\.do$/i.exec(path);
  if (classic) {
    const table = classic[1].toLowerCase();
    if (ARTICLE_READER_RE.test(table)) return articleReaderRef(params);
    return table.endsWith('_list') ? null : refFrom(table, params);
  }

  // Portals (Service Portal, Employee Center, customer service portal, HR portal): /sp?id=ticket&table=incident&sys_id=...
  return portalRef(portalParams(url), path.split('/').filter(Boolean));
}

// A reference whose table is not a ticket's is no reference (see "Is this page a ticket?" above). `anyTable: true` gives the address
// as it reads, for the one caller that decides with more than the address (the resolver: the policy's own families, the live form).
const vetted = (ref, options) => (ref && (options?.anyTable === true || isTicketTable(ref.table, options)) ? ref : null);

/**
 * The record a ServiceNow address points at: { table, sysId } or { table, number }, or null when it is a list, a
 * new record (sys_id -1), a page of a table that is not a ticket's (/ui_page.do?sys_id=..., /home.do?sys_id=...) or something else.
 * Accepts absolute or relative addresses.
 * @param {string} url
 * @param {{ extraPrefixes?: string[], extraTables?: string[], anyTable?: boolean }} [options] see isTicketTable; anyTable: skip the check
 */
export function parseRecordRef(url, options) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const ref = parseRelative(url, 0);
  return ref && !ref.newRecord ? vetted(ref, options) : null;
}

/**
 * The table of a BLANK form an address points at (sys_id=-1): { table } or null. The classic form says so itself through g_form, but
 * on Next Experience the form sits in an iframe inside the page's shadow DOM, which the page bridge may not reach (or not yet, while
 * the frame loads); the address (/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D-1, a Workspace /record/incident/-1) still
 * tells which table the new record is for. A blank form of a table that is not a ticket's (/ui_page.do?sys_id=-1) is null.
 * @param {string} url
 * @param {{ extraPrefixes?: string[], extraTables?: string[], anyTable?: boolean }} [options] as for parseRecordRef
 */
export function parseNewRecordRef(url, options) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const ref = parseRelative(url, 0);
  const blank = ref?.newRecord && TABLE_RE.test(ref.table) && !ref.table.endsWith('_list') ? { table: ref.table } : null;
  return vetted(blank, options);
}
