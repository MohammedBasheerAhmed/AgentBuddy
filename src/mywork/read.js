// N13, N14 and the data for N27: everything the My work screen shows, read in one go with the person's own session. GET only, through
// the injected `deps` (the content script hands every READ operation its policy-guarded reads, src/content/policyGuard.js), so ACLs
// and the organisation's policy decide what comes back. Pure apart from `deps`: unit-tested with a fake (tests/mywork-read.test.js).
//
// How the queue is read, and why (the old My day read 25 rows per table, newest first, and lost the oldest tickets):
//   1. COUNT first. One Aggregate API read on `task` (assigned to me, active) grouped by class names every class that has something
//      for me, custom ones too, and how many, without reading any text. When that is refused (no read on `task`, or no Aggregate
//      API), each table of the person's work profiles is counted on its own; a count that fails is "unknown", not zero.
//   2. READ each class from its own table, in pages, most urgent priority first and the least recently touched first, up to a cap per
//      class. A capped class says "200 of 340" and the screen offers the full list in ServiceNow. A class the organisation blocks is
//      not read ('blocked'); HR and other sensitive classes only with HR content allowed (and the HR profile on, for HR); a table the
//      instance does not have is left out without a word. My own queue also reads the few columns that say why a ticket is at risk
//      (the reassignment and reopen counts, the customer's VIP flag, a case's account: src/context/specs/mywork.js); no text.
//   3. SLAs of every ticket in batches (task_sla, one read per 50 tickets).
//   4. WHO WROTE LAST: one read per 40 tickets of the newest customer-visible comments (sys_journal_field, element = comments), with
//      only the author's login and the time, never the text. Compared with my login and the customer's (read on the ticket as a
//      dot-walked column and kept here: it never goes back to the panel).
//   5. APPROVALS waiting on me (sysapproval_approver, approver = me, state = requested) and the UNASSIGNED tickets of my groups
//      (assignment group in my groups, nobody assigned, active), oldest first.
// A lost session ends the whole read (the panel says "log in again"); any other failure is one plain access note, never raw API text.
import { SYS_ID_RE, TABLE_RE, raw, disp, parseSnTime, oneLine } from '../context/util.js';
import { classifyReadError, confirmEmptyIsReallyEmpty, STATUS } from '../context/access.js';
import { readMyTeam } from '../reports/engine/scope.js';
import { normalizeGroups } from '../reports/engine/reader.js';
import { SLA_COLUMNS } from '../reports/myDay.js';
import { columnsFor, customerColumn, vipColumn, accountColumn, tablesForProfiles, readDecision, pluralOf, singularOf } from './tables.js';
import { workState } from './states.js';
import { mostPressingSla } from './sla.js';
import { entriesByTicket, markerFor, windowStart, UNKNOWN_MARKER } from './markers.js';
import { rankQueue } from './rank.js';
import { say, tm } from '../reports/engine/say.js';

export const LIMITS = Object.freeze({
  perClass: 200, // rows of my queue read per class (in pages)
  pageSize: 100,
  classes: 12, // classes of my queue read at most
  groupPerClass: 50, // unassigned tickets read per class
  groupItems: 100, // unassigned tickets kept
  approvals: 50,
  slaChunk: 50,
  journalChunk: 40,
  journalRows: 400, // newest comments read per chunk of tickets
  parallel: 4, // requests in flight at once
});

const JOURNAL_COLUMNS = Object.freeze(['element_id', 'sys_created_on', 'sys_created_by']);
const APPROVAL_COLUMNS = Object.freeze(['sys_id', 'sysapproval', 'source_table', 'sys_created_on', 'due_date', 'sysapproval.sys_class_name']);

// ---- small helpers ----------------------------------------------------------------------------------------------------------

/** Run at most `max` requests at once; the rest wait their turn. */
export function createLimiter(max) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= max || !waiting.length) return;
    running += 1;
    const { fn, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        running -= 1;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      next();
    });
}

const isFatal = (err) => err?.code === 'SESSION_EXPIRED' || err?.name === 'AbortError';
// The words classifyReadError uses for a table the instance does not have (a plugin that is not installed): left out, not reported.
const MISSING_RE = /invalid table|\b404\b|does not exist|no such table|unknown table/i;

/**
 * What a failed read means, in our own words. Throws a lost session or a cancel. { status, missing }: `missing` is a table the instance
 * does not have (left out without a word); 'timeout' is a read that ran out of time (src/content/tableApi.js, code SN_TIMEOUT).
 */
export function failureOf(err, table) {
  if (isFatal(err)) throw err;
  const { status } = classifyReadError(err, table);
  if (status === STATUS.BLOCKED || status === STATUS.DENIED) return { status, missing: false };
  if (MISSING_RE.test(String(err?.message || ''))) return { status: STATUS.SKIPPED, missing: true };
  if (err?.code === 'SN_TIMEOUT' || err?.code === 'TIMEOUT') return { status: 'timeout', missing: false };
  return { status: STATUS.ERROR, missing: false };
}

const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** One plain access line about `what` ("incidents", "SLAs"): never the API's own text. */
export function accessNote(status, what, capitalised = capFirst(what)) {
  // (written in English, as the page script has no language: the panel shows it translated, src/reports/shown.js)
  if (status === STATUS.DENIED) return say(tm('You cannot read {what}.'), { what });
  if (status === STATUS.BLOCKED) return say(tm('Your organisation does not allow Agent Buddy to read {what}.'), { what });
  if (status === 'timeout') return say(tm('{what} took too long to read.'), { what: capitalised });
  return say(tm('{what} could not be read just now.'), { what: capitalised });
}

const lowerPlural = (table, names) => pluralOf(table, names?.[table]).toLowerCase().replace(/^hr /, 'HR ');
const ms = (v) => {
  const t = parseSnTime(raw(v));
  return Number.isFinite(t) ? t : null;
};

// ---- counting and paging ----------------------------------------------------------------------------------------------------

/**
 * How many tickets match `query`, per class. { source: 'task' | 'tables', counts: Map<class, number | null>, names: { class: label } }.
 * null = the count failed; the row read then tells what is wrong.
 */
export async function countByClass(deps, query, fallbackTables, run) {
  if (typeof deps.countByColumn === 'function') {
    try {
      const result = await run(() => deps.countByColumn('task', query, 'sys_class_name'));
      if (Array.isArray(result)) {
        const counts = new Map();
        const names = {};
        for (const g of result) {
          const fields = Array.isArray(g?.groupby_fields) ? g.groupby_fields : [];
          const f = fields.find((x) => x?.field === 'sys_class_name') || fields[0];
          const cls = String(f?.value ?? '').toLowerCase();
          const n = Number(g?.stats?.count);
          if (!TABLE_RE.test(cls) || !Number.isFinite(n) || n <= 0) continue;
          counts.set(cls, (counts.get(cls) || 0) + Math.floor(n));
          const label = oneLine(f?.display_value || '', 60);
          if (label && label !== cls) names[cls] = label;
        }
        return { source: 'task', counts, names };
      }
    } catch (err) {
      if (isFatal(err)) throw err; // anything else: count table by table
    }
  }
  const counts = new Map();
  await Promise.all(
    fallbackTables.map(async (table) => {
      if (typeof deps.countRecords !== 'function') {
        counts.set(table, null);
        return;
      }
      try {
        const n = Number(await run(() => deps.countRecords(table, query)));
        counts.set(table, Number.isFinite(n) ? n : null);
      } catch (err) {
        if (isFatal(err)) throw err;
        counts.set(table, null);
      }
    })
  );
  return { source: 'tables', counts, names: {} };
}

/**
 * Read up to `cap` rows of one table in pages (one at a time). `ended` is true when the read reached the end of what this person can
 * see (a short page, or as many rows as the count said); false when it stopped at the cap with more to come.
 */
export async function readPages(deps, table, query, fields, { cap, pageSize, total = null, run }) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  while (rows.length < cap) {
    const want = Math.min(pageSize, cap - rows.length);
    const at = offset;
    // eslint-disable-next-line no-await-in-loop -- pages are read one after the other, so the instance is not hit with a burst.
    const page = await run(() => deps.queryTable(table, query, fields, { limit: want, offset: at, displayValue: true }));
    const list = Array.isArray(page) ? page : [];
    for (const r of list) {
      const id = raw(r?.sys_id).toLowerCase();
      if (SYS_ID_RE.test(id) && !seen.has(id)) {
        seen.add(id);
        rows.push(r);
      }
    }
    offset += list.length;
    if (list.length < want) return { rows, ended: true };
    if (total !== null && offset >= total) return { rows, ended: true };
  }
  return { rows, ended: total !== null && rows.length >= total };
}

// ---- items ------------------------------------------------------------------------------------------------------------------

/** A counter column (reassignment_count, reopen_count) as a whole number; null when the row does not carry it. */
function countOf(value) {
  const text = raw(value).trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  return Number(text);
}

/** A true/false column (the customer's VIP flag): true, false, or null when the row does not carry it. */
function flagOf(value) {
  const text = raw(value).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return null;
}

/**
 * One ticket row as My work keeps it. `type` is the table it was read from (labels, filters); `table` its own class (the link).
 * The "at risk" facts (src/mywork/risk.js) are there only when the row was read with them (my queue, src/context/specs/mywork.js):
 * reassignments and reopens (null when not read), vip (null when not known) and account (a case's account name, '' when not read).
 */
export function itemOf(row, type) {
  const cls = raw(row.sys_class_name).toLowerCase();
  const ci = raw(row.cmdb_ci).toLowerCase();
  const group = raw(row.assignment_group).toLowerCase();
  const table = TABLE_RE.test(cls) ? cls : type;
  const vip = vipColumn(type);
  const account = accountColumn(type);
  return {
    table,
    type,
    sysId: raw(row.sys_id).toLowerCase(),
    number: oneLine(disp(row.number), 40),
    title: oneLine(disp(row.short_description), 160),
    priority: oneLine(disp(row.priority), 40),
    state: oneLine(disp(row.state), 60),
    holdReason: oneLine(disp(row.hold_reason), 60),
    work: workState({ table: type, state: disp(row.state), stateValue: raw(row.state), holdReason: disp(row.hold_reason), holdReasonValue: raw(row.hold_reason) }),
    updatedAt: ms(row.sys_updated_on),
    openedAt: ms(row.opened_at),
    ci: SYS_ID_RE.test(ci) ? { id: ci, name: oneLine(disp(row.cmdb_ci), 80) } : null,
    group: SYS_ID_RE.test(group) ? { id: group, name: oneLine(disp(row.assignment_group), 80) } : null,
    reassignments: countOf(row.reassignment_count),
    reopens: countOf(row.reopen_count),
    vip: vip ? flagOf(row[vip]) : null,
    account: account ? oneLine(disp(row[account]), 80) : '',
    sla: null,
    marker: UNKNOWN_MARKER,
  };
}

/** A note for a class that is not read: blocked by policy, HR content off, or the HR profile not on. */
function skipEntry(decision, table, count, names) {
  const what = lowerPlural(table, names);
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  if (decision === 'blocked') return { source: table, status: STATUS.BLOCKED, note: accessNote(STATUS.BLOCKED, what) };
  const one = singularOf(table, names?.[table]).replace(/^(?!HR )./, (c) => c.toLowerCase());
  const profile = decision === 'hr-profile';
  let note;
  if (n === 1) note = profile ? say(tm('1 {what} is not listed: turn on the HR profile in Settings to see them.'), { what: one }) : say(tm('1 {what} is not listed: your organisation keeps this content out of Agent Buddy.'), { what: one });
  else if (n) note = profile ? say(tm('{n} {what} are not listed: turn on the HR profile in Settings to see them.'), { n, what }) : say(tm('{n} {what} are not listed: your organisation keeps this content out of Agent Buddy.'), { n, what });
  else note = profile ? say(tm('{what} are not listed: turn on the HR profile in Settings to see them.'), { what: capFirst(what) }) : say(tm('{what} are not listed: your organisation keeps this content out of Agent Buddy.'), { what: capFirst(what) });
  return { source: table, status: STATUS.SKIPPED, note };
}

/**
 * Read the rows of every class `counted` names, per class, through `readDecision`.
 * @returns {{ items, logins: Map, access, totals: object, answered: string[] }}
 */
async function readClasses(deps, counted, { query, order, cap, pageSize, group, risk = false, accounts = false, policy, run, max }) {
  const items = [];
  const logins = new Map();
  const access = [];
  const totals = {};
  const answered = [];
  const classes = [...counted.counts.entries()].filter(([, n]) => n === null || n > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (classes.length > max) access.push({ source: 'task', status: STATUS.SKIPPED, note: say(tm('Only the {max} biggest kinds of ticket are listed.'), { max }) });
  await Promise.all(
    classes.slice(0, max).map(async ([table, total]) => {
      const decision = readDecision(table, policy);
      if (decision === 'invalid') return;
      if (decision !== 'read') {
        access.push(skipEntry(decision, table, total, counted.names));
        return;
      }
      try {
        const got = await readPages(deps, table, `${query}${order}`, columnsFor(table, { group, risk, accounts }), { cap, pageSize, total, run });
        answered.push(table);
        const column = customerColumn(table);
        for (const r of got.rows) {
          const item = itemOf(r, table);
          items.push(item);
          const login = column ? raw(r[column]).trim().toLowerCase() : '';
          if (login) logins.set(item.sysId, login);
        }
        // Ended before the count: the rest of what the count saw is not visible to this person. Say what can be seen.
        totals[table] = { shown: got.rows.length, total: got.ended ? got.rows.length : total, more: !got.ended };
      } catch (err) {
        const f = failureOf(err, table);
        if (!f.missing) access.push({ source: table, status: f.status, note: accessNote(f.status, lowerPlural(table, counted.names)) });
      }
    })
  );
  return { items, logins, access, totals, answered };
}

// ---- SLAs and comments --------------------------------------------------------------------------------------------------------

const NO_SLA = tm('SLA information is not available to you, so tickets are ordered by priority.');

async function addSlas(deps, items, { run, now, limits }) {
  const ids = [...new Set(items.map((i) => i.sysId))];
  if (!ids.length) return [];
  const rows = [];
  try {
    for (let i = 0; i < ids.length; i += limits.slaChunk) {
      const chunk = ids.slice(i, i + limits.slaChunk);
      // eslint-disable-next-line no-await-in-loop -- one batch after the other
      const got = await run(() => deps.queryTable('task_sla', `taskIN${chunk.join(',')}^active=true`, [...SLA_COLUMNS], { limit: chunk.length * 4, displayValue: true }));
      rows.push(...(Array.isArray(got) ? got : []));
    }
  } catch (err) {
    const f = failureOf(err, 'task_sla');
    return f.missing ? [] : [{ source: 'task_sla', status: f.status, note: NO_SLA }];
  }
  const byTask = new Map();
  for (const r of rows) {
    const task = raw(r.task).toLowerCase();
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task).push(r);
  }
  for (const item of items) item.sla = mostPressingSla(byTask.get(item.sysId), now);
  if (!rows.length) {
    // No SLA row at all: these tickets may have none, or an access rule hides every SLA from this person. Only the first is fine.
    const seen = await confirmEmptyIsReallyEmpty('task_sla', deps, new Map());
    if (seen.status !== STATUS.EMPTY) return [{ source: 'task_sla', status: seen.status === STATUS.EMPTY_OR_HIDDEN ? 'hidden' : seen.status, note: NO_SLA }];
  }
  return [];
}

const NO_JOURNAL = tm('Who wrote last is not visible to you, so "customer replied" and the follow-ups are not shown.');

async function addMarkers(deps, items, logins, me, { run, limits }) {
  const targets = items.filter((i) => i.work !== 'resolved');
  if (!targets.length) return [];
  if (!me) return [{ source: 'sys_journal_field', status: STATUS.SKIPPED, note: tm('Agent Buddy could not tell your user name, so "customer replied" and the follow-ups are not shown.') }];
  try {
    for (let i = 0; i < targets.length; i += limits.journalChunk) {
      const chunk = targets.slice(i, i + limits.journalChunk);
      const query = `element=comments^element_idIN${chunk.map((t) => t.sysId).join(',')}^ORDERBYDESCsys_created_on`;
      // eslint-disable-next-line no-await-in-loop -- one batch after the other
      const rows = await run(() => deps.queryTable('sys_journal_field', query, [...JOURNAL_COLUMNS], { limit: limits.journalRows }));
      const list = Array.isArray(rows) ? rows : [];
      const since = windowStart(list, limits.journalRows);
      const entries = entriesByTicket(list);
      for (const item of chunk) item.marker = markerFor(entries.get(item.sysId) || [], { me, customer: logins.get(item.sysId) || '', since });
    }
  } catch (err) {
    const f = failureOf(err, 'sys_journal_field');
    for (const item of targets) item.marker = UNKNOWN_MARKER;
    return f.missing ? [] : [{ source: 'sys_journal_field', status: f.status, note: NO_JOURNAL }];
  }
  return [];
}

// ---- the three lists --------------------------------------------------------------------------------------------------------

async function readQueue(deps, userId, { profiles, accounts, policy, run, limits }) {
  const query = `assigned_to=${userId}^active=true`;
  const counted = await countByClass(deps, query, tablesForProfiles(profiles), run);
  const got = await readClasses(deps, counted, {
    query,
    order: '^ORDERBYpriority^ORDERBYsys_updated_on^ORDERBYnumber',
    cap: limits.perClass,
    pageSize: limits.pageSize,
    group: false,
    // (my own tickets only: what says why one is at risk, src/context/specs/mywork.js)
    risk: true,
    accounts,
    policy,
    run,
    max: limits.classes,
  });

  // What an empty queue means: 'nothing' (the counts or the reads prove it), 'unseen' (nothing visible at all in the tables that
  // answered, so "nothing assigned to you" would be a guess) or 'unread' (nothing could be counted or read).
  let empty = null;
  if (!got.items.length) {
    const counted0 = counted.source === 'task' || [...counted.counts.values()].some((n) => n === 0);
    if (got.answered.length) {
      empty = 'unseen';
      const memo = new Map();
      for (const table of got.answered) {
        // eslint-disable-next-line no-await-in-loop -- one small read at a time, and usually only one.
        const seen = await confirmEmptyIsReallyEmpty(table, deps, memo);
        if (seen.status === STATUS.EMPTY) {
          empty = 'nothing';
          break;
        }
      }
    } else empty = counted0 ? 'nothing' : 'unread';
  }
  const known = Object.values(got.totals);
  return {
    ...got,
    names: counted.names,
    empty,
    total: known.reduce((n, t) => n + (Number.isFinite(t.total) ? t.total : t.shown), 0),
    more: known.some((t) => t.more),
    listQuery: query,
  };
}

async function readApprovals(deps, userId, { policy, run, limits }) {
  const query = `approver=${userId}^state=requested`;
  let rows;
  try {
    rows = await run(() => deps.queryTable('sysapproval_approver', `${query}^ORDERBYsys_created_on`, [...APPROVAL_COLUMNS], { limit: limits.approvals, displayValue: true }));
  } catch (err) {
    const f = failureOf(err, 'sysapproval_approver');
    return { items: [], total: 0, listQuery: query, access: f.missing ? [] : [{ source: 'sysapproval_approver', status: f.status, note: accessNote(f.status, tm('your approvals'), tm('Your approvals')) }] };
  }
  const list = Array.isArray(rows) ? rows : [];
  let total = list.length;
  if (list.length >= limits.approvals && typeof deps.countRecords === 'function') {
    try {
      const n = Number(await run(() => deps.countRecords('sysapproval_approver', query)));
      if (Number.isFinite(n) && n > total) total = n;
    } catch (err) {
      if (isFatal(err)) throw err;
    }
  }
  const items = list
    .map((r) => {
      const task = raw(r.sysapproval).toLowerCase();
      const cls = (raw(r.source_table) || raw(r['sysapproval.sys_class_name'])).toLowerCase();
      return {
        table: 'sysapproval_approver',
        sysId: raw(r.sys_id).toLowerCase(),
        taskId: SYS_ID_RE.test(task) ? task : '',
        type: TABLE_RE.test(cls) ? cls : '',
        number: oneLine(disp(r.sysapproval), 40),
        title: '',
        requestedAt: ms(r.sys_created_on),
        dueAt: ms(r.due_date),
      };
    })
    .filter((a) => SYS_ID_RE.test(a.sysId));

  // The titles of the tickets to approve, only for classes this person may read (no HR text without HR content allowed, nothing of a
  // blocked class). One read on `task` by sys_id; without it the numbers are shown alone.
  const readable = items.filter((a) => a.taskId && a.type && readDecision(a.type, policy) === 'read');
  if (readable.length) {
    try {
      const got = await run(() => deps.queryTable('task', `sys_idIN${readable.map((a) => a.taskId).join(',')}`, ['sys_id', 'short_description', 'sys_class_name'], { limit: readable.length, displayValue: true }));
      const titles = new Map((Array.isArray(got) ? got : []).map((t) => [raw(t.sys_id).toLowerCase(), oneLine(disp(t.short_description), 160)]));
      for (const a of readable) a.title = titles.get(a.taskId) || '';
    } catch (err) {
      if (isFatal(err)) throw err;
    }
  }
  return { items: items.map(({ taskId, ...rest }) => rest), total, listQuery: query, access: [] };
}

const NO_GROUPS = tm('Your group memberships are not visible to you, so the unassigned tickets of your groups cannot be listed.');

async function readGroupQueue(deps, userId, { profiles, policy, run, limits }) {
  // The Team screen's reading of "my groups" (src/reports/engine/scope.js): active groups only; over its cap, the ones with the most open
  // work (one count on `task` grouped by group) are kept, and its note says so.
  const reader = {
    rows: (table, query, fields, options) => run(() => deps.queryTable(table, query, fields, options)),
    groups: async (table, query, groupBy) => normalizeGroups(await run(() => deps.countByColumn(table, query, groupBy[0]))) || [],
  };
  let groups;
  let teamNote;
  try {
    const team = await readMyTeam(reader, userId, { tables: typeof deps.countByColumn === 'function' ? ['task'] : [] });
    groups = team.groups;
    teamNote = team.note || '';
  } catch (err) {
    const f = failureOf(err, 'sys_user_grmember');
    return { groups: [], items: [], total: 0, more: false, listQuery: '', access: f.missing ? [] : [{ source: 'sys_user_grmember', status: f.status, note: NO_GROUPS }] };
  }
  if (!groups.length) return { groups: [], items: [], total: 0, more: false, listQuery: '', access: [] };
  const query = `assignment_groupIN${groups.map((g) => g.id).join(',')}^assigned_toISEMPTY^active=true`;
  const counted = await countByClass(deps, query, tablesForProfiles(profiles), run);
  const got = await readClasses(deps, counted, {
    query,
    order: '^ORDERBYopened_at^ORDERBYnumber',
    cap: limits.groupPerClass,
    pageSize: limits.groupPerClass,
    group: true,
    policy,
    run,
    max: limits.classes,
  });
  const live = got.items.filter((i) => i.work !== 'resolved').sort((a, b) => (a.openedAt ?? Infinity) - (b.openedAt ?? Infinity) || a.number.localeCompare(b.number));
  const known = Object.values(got.totals);
  // (resolved-but-active tickets were counted and read, but nobody needs to pick them up)
  const total = known.reduce((n, t) => n + (Number.isFinite(t.total) ? t.total : t.shown), 0) - (got.items.length - live.length);
  return {
    groups: groups.map((g) => ({ id: g.id, name: oneLine(g.name, 80) })),
    note: teamNote,
    items: live.slice(0, limits.groupItems),
    total: Math.max(total, live.length),
    more: known.some((t) => t.more) || live.length > limits.groupItems,
    listQuery: `${query}^ORDERBYopened_at`,
    names: counted.names,
    access: got.access,
  };
}

// ---- the whole screen -------------------------------------------------------------------------------------------------------

/**
 * @param {{ userId: string, userName?: string }} who the signed-in user (from the page; never from the panel)
 * @param {object} deps queryTable, countRecords, countByColumn, and the guard's isBlocked / sensitivePrefixes
 * @param {{ profiles?: string[], allowSensitive?: boolean, accounts?: boolean, now?: number, limits?: object }} [options] accounts: read
 *   a case's account (the organisation names priority accounts); limits: smaller caps (tests)
 */
export async function readMyWork({ userId, userName = '' }, deps, { profiles = [], allowSensitive = false, accounts = false, now = Date.now(), limits: given = {} } = {}) {
  const limits = { ...LIMITS, ...given };
  if (!SYS_ID_RE.test(userId || '')) throw new Error(tm('Agent Buddy could not tell who is signed in. Reload the page and try again.'));
  const me = userId.toLowerCase();
  const run = createLimiter(limits.parallel);
  const policy = { isBlocked: deps.isBlocked, sensitivePrefixes: deps.sensitivePrefixes, allowSensitive: allowSensitive === true, profiles };

  // My login, to tell my comments from the customer's. The page usually gives it; otherwise one small read of my own user row.
  let login = String(userName || '').trim().toLowerCase();
  if (!login) {
    try {
      const rows = await run(() => deps.queryTable('sys_user', `sys_id=${me}`, ['user_name'], { limit: 1 }));
      login = raw(rows?.[0]?.user_name).trim().toLowerCase();
    } catch (err) {
      if (isFatal(err)) throw err;
    }
  }

  const [queue, approvals, groups] = await Promise.all([
    readQueue(deps, me, { profiles, accounts: accounts === true, policy, run, limits }),
    readApprovals(deps, me, { policy, run, limits }),
    readGroupQueue(deps, me, { profiles, policy, run, limits }),
  ]);
  const [slaAccess, journalAccess] = await Promise.all([
    addSlas(deps, [...queue.items.filter((i) => i.work !== 'resolved'), ...groups.items], { run, now, limits }),
    addMarkers(deps, queue.items, queue.logins, login, { run, limits }),
  ]);

  return {
    version: 1,
    readAt: now,
    queue: {
      items: rankQueue(queue.items, now),
      totals: queue.totals,
      total: queue.total,
      more: queue.more,
      empty: queue.empty,
      names: queue.names,
      listQuery: queue.listQuery,
    },
    approvals: { items: approvals.items, total: approvals.total, listQuery: approvals.listQuery },
    groups: { groups: groups.groups, items: groups.items, total: groups.total, more: groups.more, listQuery: groups.listQuery, names: groups.names || {}, note: groups.note || '' },
    access: dedupe([...queue.access, ...slaAccess, ...journalAccess, ...approvals.access, ...groups.access]),
  };
}

// The same note twice (a class blocked in both the queue and the group queue) is said once.
function dedupe(list) {
  const seen = new Set();
  return list.filter((a) => {
    const key = `${a.source}|${a.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
