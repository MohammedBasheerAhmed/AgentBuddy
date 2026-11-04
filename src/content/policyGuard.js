// The organisation's policy at the READ boundary.
//
// `blockedTables` used to be checked only when an AI run was prepared (src/lib/pipeline.js), after the data had been read. The
// content script has no policy of its own, so a blocked table was still read for the panel, for related lists, for reference
// answers and for the journal. This module loads the managed policy in the content script and wraps the deps every READ operation
// uses (queryTable, fetchRecord, countRecords, countByColumn, aggregate), so a read of a blocked table is refused with
// the error code 'BLOCKED_TABLE' before a request is made:
//
//   - the table named in the call, case-insensitively;
//   - every table a dot-walked column passes through, in the columns asked for and in the query's conditions: each step is a reference
//     column, checked by the table it points at (DOT_WALK_TABLES: 'request.requested_for' reads sc_request, 'user.user_name' reads
//     sys_user); a step that is not on that list is refused while anything is blocked;
//   - sys_journal_field rows whose `name` is a blocked table (the notes of a record of a blocked table), by the query and, as a
//     second check, by the rows that come back;
//   - `task` reads whose rows are of a blocked class (a child task that is an incident when incident is blocked): sys_class_name is
//     added to the columns asked for, and the whole read is refused when any row is of a blocked class.
//
// The refusal is an error with `code: 'BLOCKED_TABLE'`. The readers (src/context/access.js classifyReadError / softRead) turn it
// into an access entry with status 'blocked' and the note "Your organisation does not allow Agent Buddy to read X records", never
// into an empty result, a zero or "you cannot see it". Reading the record itself throws, so the whole read fails with that message.
//
// UNVERIFIED (docs/live-questions/policy.md, question 1): that `chrome.storage.managed` can be read from a content script. So the
// side panel (which CAN read it) also sends its normalised policy with every READ, and the two are merged: the lists are joined and
// HR content must be allowed by both, so the panel can only make the result stricter, never looser. If neither source is available
// the lists are empty and the guard blocks nothing (the AI-run check in the pipeline still refuses a blocked table). The policy is loaded
// at most once every 30 seconds, so a change made by IT applies within half a minute without a reload.
//
// This file has no chrome.* import and no network: `getManaged` is injected (tests/policy-hardening-guard.test.js).

import { normalizePolicy } from '../policy/policy.js';
import { TABLE_RE } from '../context/util.js';

export const POLICY_TTL_MS = 30000;

/** The error a refused read throws. The message is fixed wording plus a table name that passed the identifier check. */
export function blockedError(table) {
  const name = String(table || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 80) || 'that table';
  const err = new Error(`Your organisation does not allow Agent Buddy to read ${name} records.`);
  err.code = 'BLOCKED_TABLE';
  return err;
}

// The only policy keys a read needs. The content script runs inside the ServiceNow page's process, so it asks the browser for these
// and nothing else: an AI key the organisation supplies (`providedApiKey`), the AI address and the other settings never enter it.
export const READ_POLICY_KEYS = Object.freeze(['blockedTables', 'sensitiveTablePrefixes', 'allowHrContent']);

/**
 * The raw managed policy, as far as reads need it: `chrome.storage.managed` in the extension. { known: false } when it cannot be read
 * from here. `area` is for tests.
 */
export async function readManaged(area = typeof chrome !== 'undefined' ? chrome.storage?.managed : undefined) {
  try {
    if (!area || typeof area.get !== 'function') return { known: false, raw: {} };
    const got = (await area.get([...READ_POLICY_KEYS])) || {};
    // (a browser that answers with more than was asked for still hands over only these)
    const raw = {};
    for (const key of READ_POLICY_KEYS) if (Object.prototype.hasOwnProperty.call(got, key)) raw[key] = got[key];
    return { known: true, raw };
  } catch {
    // Not readable from here (or the browser has no managed storage): the guard blocks nothing; see the header comment.
    return { known: false, raw: {} };
  }
}

const lower = (value) => String(value ?? '').trim().toLowerCase();
// (a column name follows the same rule as a table name)
const cleanList = (value) => (Array.isArray(value) ? value : []).map(lower).filter((v) => TABLE_RE.test(v)).slice(0, 500);

/**
 * The guard's state with the policy the panel sent merged in: blocked tables and sensitive prefixes are joined; HR content stays
 * allowed only when every known source allows it. Pure; a missing or malformed panel policy changes nothing.
 */
export function mergePanelPolicy(state, panel) {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) return state;
  const blocked = new Set([...state.blocked, ...cleanList(panel.blockedTables)]);
  const sensitivePrefixes = [...new Set([...(state.sensitivePrefixes || []), ...cleanList(panel.sensitiveTablePrefixes)])];
  const panelAllowsHr = panel.allowHrContent === true;
  const allowHrContent = state.known ? state.policy.allowHrContent === true && panelAllowsHr : panelAllowsHr;
  return { known: true, policy: { ...state.policy, allowHrContent }, blocked, sensitivePrefixes };
}

// The table each reference column Agent Buddy dot-walks through points at. A step's own name says nothing about the table it reads
// ('request' leads to sc_request, 'user' to sys_user), so a blocked table is matched against these. Only the columns some read in
// src/ walks are listed: tests/policy-hardening-dotwalk.test.js finds every dot-walk in src/ and fails when a step is missing here, and
// the guard refuses a step it does not know while anything is blocked, so a new dot-walk cannot pass a blocked table unnoticed.
export const DOT_WALK_TABLES = Object.freeze({
  __proto__: null,
  // a requested item's variables (sc_item_option_mtom -> sc_item_option -> item_option_new)
  sc_item_option: Object.freeze(['sc_item_option']),
  item_option_new: Object.freeze(['item_option_new']),
  // a requested item's request, a catalog task's requested item
  request: Object.freeze(['sc_request']),
  request_item: Object.freeze(['sc_req_item']),
  // the ticket an SLA or an approval belongs to
  task: Object.freeze(['task']),
  sysapproval: Object.freeze(['task']),
  // a membership's group and user; a ticket's customer (a customer contact is a sys_user row too: customer_contact extends it)
  group: Object.freeze(['sys_user_group']),
  user: Object.freeze(['sys_user']),
  caller_id: Object.freeze(['sys_user']),
  requested_for: Object.freeze(['sys_user']),
  requested_by: Object.freeze(['sys_user']),
  opened_for: Object.freeze(['sys_user']),
  contact: Object.freeze(['customer_contact', 'sys_user']),
});

/**
 * The tables a dot-walked column reads on its way ('request.requested_for' -> ['sc_request']; a plain column -> []), or null when a
 * step is not in DOT_WALK_TABLES. The last part is the column read at the end, not a table.
 */
export function walkTables(column) {
  const steps = String(column ?? '').trim().toLowerCase().split('.').slice(0, -1);
  const tables = [];
  for (const step of steps) {
    const to = DOT_WALK_TABLES[step];
    if (!to) return null;
    tables.push(...to);
  }
  return tables;
}

// The columns the conditions (and sort orders) of an encoded query name: "active=true^ORtask.assigned_to=x^ORDERBYDESCopened_at" ->
// ['active', 'task.assigned_to', 'opened_at']. A doubled caret is a caret inside a value, not the start of a condition.
const QUERY_COLUMN_RE = /^(?:NQ|OR|ORDERBYDESC|ORDERBY|GROUPBY)?([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)/;
const queryColumns = (query) =>
  String(query || '')
    .replace(/\^\^/g, '\u0000')
    .split('^')
    .map((part) => QUERY_COLUMN_RE.exec(part.trim())?.[1] || '')
    .filter(Boolean);

// Clauses of an encoded query: "name=incident^element_id=...^ORDERBYDESCsys_created_on" -> [['name', '=', 'incident'], ...].
// Column names are lower case and operators upper case in an encoded query, which keeps "business_service" from being read as "bus" + IN.
function clausesOf(query) {
  return String(query || '')
    .split('^')
    .map((part) => /^(?:OR|NQ)?([a-z][a-z0-9_.]*?)(!=|=|NOT IN|IN|STARTSWITH|ENDSWITH|NOT LIKE|LIKE)(.*)$/.exec(part.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2], m[3]]);
}

/**
 * @param {{ getManaged?: () => Promise<{ known: boolean, raw: object }>, now?: () => number, ttlMs?: number, timeoutMs?: number }} [options]
 *   timeoutMs: how long to wait for the browser's answer before treating the policy as unknown (a read must never hang on it)
 */
export function createPolicyGuard({ getManaged = readManaged, now = Date.now, ttlMs = POLICY_TTL_MS, timeoutMs = 3000 } = {}) {
  let cached = null; // { at, state }
  let inflight = null;

  async function load() {
    let timer;
    let got;
    try {
      got = await Promise.race([
        Promise.resolve().then(() => getManaged()),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } catch {
      got = null;
    } finally {
      clearTimeout(timer);
    }
    const policy = normalizePolicy(got?.raw);
    return { known: got?.known === true, policy, blocked: new Set(policy.blockedTables), sensitivePrefixes: policy.sensitiveTablePrefixes };
  }

  /** { known, policy, blocked: Set, sensitivePrefixes }: the managed policy, read at most once per ttlMs. */
  async function state() {
    if (cached && now() - cached.at < ttlMs) return cached.state;
    if (!inflight) {
      inflight = load()
        .then((s) => {
          cached = { at: now(), state: s };
          return s;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  function guard(deps, s) {
    const blocked = s.blocked;
    const isBlocked = (table) => blocked.has(lower(table));
    const refuse = (table) => {
      throw blockedError(table);
    };

    // The checks that need only the call: the table, the tables a dot-walked column goes through, and the journal's `name`.
    function checkCall(table, query, fields) {
      if (!blocked.size) return;
      const name = lower(table);
      if (blocked.has(name)) refuse(name);
      const columns = [...(Array.isArray(fields) ? fields : []), ...queryColumns(query)];
      for (const column of columns) {
        if (typeof column !== 'string' || !column.includes('.')) continue;
        const walked = walkTables(column);
        // A dot-walk through a column this file does not know: which table it reads cannot be told, so it is not read.
        if (!walked) refuse(column.toLowerCase().split('.').find((step) => !DOT_WALK_TABLES[step]));
        const hit = walked.find((t) => blocked.has(t));
        if (hit) refuse(hit);
      }
      if (name === 'sys_journal_field') {
        for (const [column, op, value] of clausesOf(query)) {
          if (column !== 'name') continue;
          for (const v of value.split(',').map(lower).filter(Boolean)) {
            // An exact table name for = and IN; for the fuzzy operators any blocked name the value could stand for.
            const hit = op === '=' || op === 'IN' ? (blocked.has(v) ? v : '') : [...blocked].find((b) => b.includes(v) || v.includes(b)) || '';
            if (hit) refuse(hit);
          }
        }
      }
    }

    // The columns to ask for: for a table that holds rows of many classes the class and the owning table are added, so the rows
    // can be checked. Only when something is blocked; otherwise the call is exactly what the reader asked for.
    function fieldsFor(table, fields) {
      if (!blocked.size) return fields;
      const name = lower(table);
      const list = Array.isArray(fields) ? [...fields] : [];
      if (list.length && name === 'task' && !list.includes('sys_class_name')) list.push('sys_class_name');
      if (list.length && name === 'sys_journal_field' && !list.includes('name')) list.push('name');
      return list.length ? list : fields;
    }

    // The checks that need the rows: a task of a blocked class, a journal row of a blocked table.
    function checkRows(table, rows) {
      if (!blocked.size) return rows;
      const name = lower(table);
      const column = name === 'task' ? 'sys_class_name' : name === 'sys_journal_field' ? 'name' : '';
      if (!column) return rows;
      for (const row of Array.isArray(rows) ? rows : []) {
        const value = row && typeof row === 'object' ? row[column] : undefined;
        const text = lower(value && typeof value === 'object' ? value.value ?? '' : value);
        if (text && blocked.has(text)) refuse(text);
      }
      return rows;
    }

    const wrapped = {
      queryTable: async (table, query, fields, options) => {
        checkCall(table, query, fields);
        return checkRows(table, await deps.queryTable(table, query, fieldsFor(table, fields), options));
      },
      fetchRecord: async (table, sysId, fields, options) => {
        checkCall(table, `sys_id=${sysId}`, fields);
        const row = await deps.fetchRecord(table, sysId, fieldsFor(table, fields), options);
        if (row) checkRows(table, [row]);
        return row;
      },
    };
    for (const op of ['countRecords', 'countByColumn']) {
      if (typeof deps[op] === 'function') {
        wrapped[op] = async (table, query, ...rest) => {
          // (countByColumn's third argument is the column it groups by: a dot-walk there reads its tables too)
          checkCall(table, query, op === 'countByColumn' && typeof rest[0] === 'string' ? [rest[0]] : []);
          return deps[op](table, query, ...rest);
        };
      }
    }
    // aggregate(table, options) exists on some deps (the reports engine, tests).
    if (typeof deps.aggregate === 'function') {
      wrapped.aggregate = async (table, options = {}) => {
        checkCall(table, options?.query, [...(options?.groupBy || []), ...(options?.avgFields || [])]);
        return deps.aggregate(table, options);
      };
    }
    // checkRead(table, query, columns): the same checks for a read made some other way (the reports' Aggregate API call): throws
    // BLOCKED_TABLE for a blocked table or a dot-walk through one, in the columns or the query's conditions.
    return Object.freeze({ ...deps, ...wrapped, isBlocked, checkRead: checkCall, sensitivePrefixes: s.known ? s.sensitivePrefixes : undefined });
  }

  return {
    state,
    /** The deps with the policy applied (and the panel's policy merged in, when it sent one). Every other property of `deps` is kept. */
    deps: async (deps, panelPolicy) => guard(deps, mergePanelPolicy(await state(), panelPolicy)),
    /** Sync version for a state already in hand (tests). */
    guard,
    /**
     * May the panel's `allowSensitive` stand? The managed policy has the last word on HR content: when it is known and does not
     * allow HR content, the request is lowered to false. When the policy cannot be read here, the panel's value is kept (the
     * panel read the same policy and sets it from `allowHrContent`).
     */
    allowSensitive: async (requested, panelPolicy) => {
      const s = mergePanelPolicy(await state(), panelPolicy);
      return requested === true && (!s.known || s.policy.allowHrContent === true);
    },
    clear: () => {
      cached = null;
    },
  };
}

/** The guard the content script uses. */
export const policyGuard = createPolicyGuard();
