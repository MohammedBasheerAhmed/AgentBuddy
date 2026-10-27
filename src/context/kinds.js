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

/** The pack kind for a table name; a table we know nothing about is 'other'. */
export function kindForTable(table) {
  return KIND_BY_TABLE[String(table || '').trim().toLowerCase()] || 'other';
}

// HR data (cases about a person's leave, pay, conduct) is the most sensitive thing a fulfiller reads. Its tables are
// recognised by prefix so custom tables in the same family are covered too.
const SENSITIVE_PREFIXES = ['sn_hr_'];

/** True for tables whose free text and identities are only read when the caller asks for sensitive data. */
export function isSensitiveTable(table) {
  const name = String(table || '').trim().toLowerCase();
  return SENSITIVE_PREFIXES.some((prefix) => name.startsWith(prefix));
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

// The reference a table plus search params describe: sys_id first (exact), then a number. "-1" is a new record.
function refFrom(table, params) {
  if (!TABLE_RE.test(table)) return null;
  const sysId = sysIdOf(params.get('sys_id')) || sysIdFromQuery(params.get('sysparm_query'));
  if (sysId) return { table, sysId };
  const number = numberFromQuery(params.get('sysparm_query'));
  return number ? { table, number } : null;
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
    const id = sysIdOf(workspace[2]);
    return id ? { table: workspace[1].toLowerCase(), sysId: id } : null;
  }

  // Classic forms: /incident.do?sys_id=... or ?sysparm_query=number=INC... . A list (incident_list.do) is not a record.
  const classic = /\/([a-z][a-z0-9_]*)\.do$/i.exec(path);
  if (classic) {
    const table = classic[1].toLowerCase();
    return table.endsWith('_list') ? null : refFrom(table, params);
  }

  // Portals: /sp?id=ticket&table=incident&sys_id=...
  const portalTable = (params.get('table') || '').toLowerCase();
  if (portalTable) return refFrom(portalTable, params);

  return null;
}

/**
 * The record a ServiceNow address points at: { table, sysId } or { table, number }, or null when it is a list, a
 * new record (sys_id -1) or something else. Accepts absolute or relative addresses.
 */
export function parseRecordRef(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  return parseRelative(url, 0);
}
