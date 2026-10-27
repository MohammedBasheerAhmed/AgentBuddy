// The organisation's policy at the READ boundary.
//
// `blockedTables` used to be checked only when an AI run was prepared (src/lib/pipeline.js), after the data had been read. The
// content script has no policy of its own, so a blocked table was still read for the panel, for related lists, for reference
// answers and for the journal. This module loads the managed policy in the content script and wraps the deps every READ operation
// uses (queryTable, fetchRecord, countRecords, countByColumn, aggregate, queryAll), so a read of a blocked table is refused with
// the error code 'BLOCKED_TABLE' before a request is made:
//
//   - the table named in the call, case-insensitively;
//   - a table named by a dot-walked column ('sc_item_option.item_option_new.question_text' reads sc_item_option and item_option_new);
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

export const POLICY_TTL_MS = 30000;

/** The error a refused read throws. The message is fixed wording plus a table name that passed the identifier check. */
export function blockedError(table) {
  const name = String(table || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 80) || 'that table';
  const err = new Error(`Your organisation does not allow Agent Buddy to read ${name} records.`);
  err.code = 'BLOCKED_TABLE';
  return err;
}

/** The raw managed policy: `chrome.storage.managed` in the extension. { known: false } when it cannot be read from here. */
async function readManaged() {
  try {
    const area = typeof chrome !== 'undefined' ? chrome.storage?.managed : undefined;
    if (!area || typeof area.get !== 'function') return { known: false, raw: {} };
    return { known: true, raw: (await area.get(null)) || {} };
  } catch {
    // Not readable from here (or the browser has no managed storage): the guard blocks nothing; see the header comment.
    return { known: false, raw: {} };
  }
}

const lower = (value) => String(value ?? '').trim().toLowerCase();
const NAME_RE = /^[a-z][a-z0-9_]{0,79}$/;
const cleanList = (value) => (Array.isArray(value) ? value : []).map(lower).filter((v) => NAME_RE.test(v)).slice(0, 500);

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
    let got = null;
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
      for (const field of Array.isArray(fields) ? fields : []) {
        if (typeof field !== 'string' || !field.includes('.')) continue;
        for (const step of field.toLowerCase().split('.').slice(0, -1)) if (blocked.has(step)) refuse(step);
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
          checkCall(table, query, []);
          return deps[op](table, query, ...rest);
        };
      }
    }
    // aggregate(table, options) and queryAll(table, query, fields, options) exist on some deps (the reports engine, tests).
    if (typeof deps.aggregate === 'function') {
      wrapped.aggregate = async (table, options = {}) => {
        checkCall(table, options?.query, [...(options?.groupBy || []), ...(options?.avgFields || [])]);
        return deps.aggregate(table, options);
      };
    }
    if (typeof deps.queryAll === 'function') {
      wrapped.queryAll = async (table, query, fields, options) => {
        checkCall(table, query, fields);
        return checkRows(table, await deps.queryAll(table, query, fieldsFor(table, fields), options));
      };
    }
    return Object.freeze({ ...deps, ...wrapped, isBlocked, sensitivePrefixes: s.known ? s.sensitivePrefixes : undefined });
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
