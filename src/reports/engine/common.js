// Pieces the report sections share: probing which tables a person can use, labelling states, ranking groups, and the
// "how sure are we" notes (denominators, caps) every section reports the same way.
import { raw, disp } from '../../context/util.js';
import { classifyState, reportClassFor } from '../../domain/states.js';
import { REPORT_TABLES, LIMITS, isSensitiveReportTable } from './constants.js';
import { andQuery, buildQuery } from './queryBuilder.js';
import { attempt } from './reader.js';
import { say, tm } from './say.js';

export { raw, disp, andQuery };

export const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// ---- States --------------------------------------------------------------------------------------------------------
// Every table words its states differently ("In Progress", "Work in Progress", "Awaiting Info"). Reports group them by what they mean:
// by the stored value of the state for the ticket's own table, then by the words of the label the site shows (src/domain/states.js,
// docs/states.md), so a renamed, translated or customised state list still lands in the right column.

export const STATE_CLASSES = Object.freeze([
  { key: 'new', label: tm('New') },
  { key: 'working', label: tm('Open or in progress') },
  { key: 'waiting', label: tm('Waiting or on hold') },
  // Resolved but still active: an incident or a case stays active after Resolved until it is closed (by the caller or after a few
  // days). Counted on its own, so it neither inflates "Open" nor fills "No update in 3+ days" while it waits to close.
  { key: 'resolved', label: tm('Resolved, not closed') },
  { key: 'other', label: tm('Other') },
]);

/**
 * The report class of one state: 'new' | 'working' | 'waiting' | 'resolved' (finished, cancelled included, but still active) | 'other'.
 * `table` and `value` (the stored value) make it exact; with the label alone the words decide.
 */
export function stateClass(label, { table = '', value = '' } = {}) {
  return reportClassFor({ table, value, label });
}

// The plain word for a state that came back with no label (a stored number is not a word for a person): marked here, shown in the
// panel's language by shown() where the row is drawn (the row says `plain`).
const PLAIN_STATE = Object.freeze({
  new: tm('New'),
  working: tm('In progress'),
  waiting: tm('On hold'),
  resolved: tm('Resolved'),
  closed: tm('Closed'),
  cancelled: tm('Cancelled'),
  unknown: tm('Unknown state'),
});

/**
 * What to call a state in a breakdown: the label the site gave it; when there is none, or it is only the stored number, the plain word
 * for what the state means (never the number). { name, plain }: `plain` is true for an engine word (shown() translates it), false for
 * the site's own label or the '(none)' placeholder.
 */
export function stateName(key, table = '') {
  const display = String(key?.display ?? '').trim();
  const value = String(key?.value ?? '').trim();
  if (display && !(display === value && /^[+-]?\d+$/.test(display))) return { name: display, plain: false };
  if (!display && !value) return { name: tm('(none)'), plain: false };
  return { name: PLAIN_STATE[classifyState({ table, value })], plain: true };
}

// ---- Tables --------------------------------------------------------------------------------------------------------

/**
 * Known tables only, no duplicates, in the order given. An empty list means all of them. A sensitive (HR-family) table is kept only
 * with `allowSensitive` (the person works with the HR profile and the organisation allows HR content); otherwise it is dropped
 * wherever it came from, so a forged or stale request cannot read it.
 */
export function normalizeTables(input, { allowSensitive = false, sensitivePrefixes = [] } = {}) {
  const known = Object.keys(REPORT_TABLES).filter((t) => allowSensitive || !isSensitiveReportTable(t, sensitivePrefixes));
  const list = (Array.isArray(input) ? input : []).map((t) => String(t || '').toLowerCase()).filter((t, i, all) => known.includes(t) && all.indexOf(t) === i);
  return list.length ? list : known;
}

/**
 * The states of a breakdown (groups by state of ACTIVE tickets) that mean "resolved, waiting to close". Pure.
 * { count, values, labels }: values are the stored state values, for a query that leaves them out or lists them.
 */
export function resolvedStates(groups, table = '') {
  const done = (groups || []).filter((g) => stateClass(g.keys[0]?.display, { table, value: g.keys[0]?.value }) === 'resolved');
  return {
    count: done.reduce((n, g) => n + g.count, 0),
    values: [...new Set(done.map((g) => g.keys[0].value).filter((v) => v !== ''))],
    labels: [...new Set(done.map((g) => stateName(g.keys[0], table).name).filter(Boolean))],
  };
}

/**
 * The condition that leaves resolved-but-active tickets out ('' when there are none, or a value cannot be written safely). Written
 * as one `state!=x` per value (AND), the plainest form every instance and list filter understands; there are only one or two.
 */
export function notResolved(values) {
  if (!Array.isArray(values) || !values.length) return '';
  try {
    return buildQuery(values.slice(0, 10).map((value) => ({ op: 'ne', field: 'state', value })));
  } catch {
    return '';
  }
}

/**
 * What "open" means for one table, the same in every section (Overview, Workload, Quality, the hand-over): active tickets, less the
 * ones resolved and waiting to close. It reads the state breakdown of the active tickets in `openQuery` (the same question in every
 * section, so one cached request serves them all) and returns { states (the attempt), done (resolvedStates), live (the condition that
 * leaves the resolved-but-active out, '' when there are none or the breakdown could not be read) }.
 */
export async function readOpenStates(reader, table, openQuery) {
  const states = await attempt(() => reader.groups(table, openQuery, ['state']), table);
  const done = states.ok ? resolvedStates(states.value, table) : { count: 0, values: [], labels: [] };
  return { states, done, live: notResolved(done.values) };
}

/** An attempt that counted the active tickets, as the open count: `done.count` left out (read a moment apart, so never below zero). */
export const openOf = (active, done) => (active?.ok ? { ok: true, value: Math.max(0, active.value - (done?.count || 0)) } : active);

/** The condition that lists only resolved-but-active tickets ('' when there are none). */
export function onlyResolved(values) {
  if (!Array.isArray(values) || !values.length) return '';
  try {
    return buildQuery([{ op: 'in', field: 'state', values }]);
  } catch {
    return '';
  }
}

/**
 * For each requested table: can the person read it, and which optional columns does it have?
 * @returns {Promise<{ table, meta, vis: {status, note}, cols: {known, has}, usable: boolean }[]>}
 */
export async function probeTables(reader, tables) {
  const none = { known: false, has: () => false, names: [] };
  return Promise.all(
    tables.map(async (table) => {
      const meta = REPORT_TABLES[table];
      // One unfiltered one-row read shows both things at once: a row means the table is readable, and its keys are the columns.
      if (!reader.isBlocked(table)) {
        try {
          const cols = await reader.columns(table, meta.optional);
          if (cols.known) return { table, meta, vis: { status: 'ok', note: '' }, cols, usable: true };
        } catch (err) {
          if (err?.code === 'SESSION_EXPIRED') throw err;
          // A denial or a timeout is classified below.
        }
      }
      // No row: a 403, or a 200 with nothing, which proves nothing (confirmEmptyIsReallyEmpty inside visibility()).
      const vis = await reader.visibility(table);
      return { table, meta, vis, cols: none, usable: vis.status === 'ok' };
    })
  );
}

/** The first of the table's "resolved at" columns that exists, or ''. */
export const resolvedColumn = (t) => t.meta.resolvedFields.find((f) => t.cols.has(f)) || '';

/** Per-table access summary for the section result: what the person can and cannot use. */
export function tableAccess(tables) {
  return tables.map((t) => ({
    table: t.table,
    label: t.meta.label,
    status: t.vis.status,
    note: statusNote(t.table, t.meta.label, t.vis),
  }));
}

function statusNote(table, label, vis) {
  if (vis.status === 'ok') return '';
  if (vis.status === 'denied') return say(tm('{table}: not available to you.'), { table: label });
  if (vis.status === 'hidden') return say(tm('{table}: you can see none of them, so its numbers would prove nothing. There may be none, or your role may not let you see them.'), { table: label });
  if (vis.status === 'blocked') return say(tm('{table}: your organisation does not allow reports to read them.'), { table: label });
  return say(tm('{table}: could not be read.'), { table: label });
}

// ---- Numbers -------------------------------------------------------------------------------------------------------

/**
 * A count from a table that is NOT one of the probed ticket tables (task_sla, sysapproval_approver): attempt()'s shape, but a zero
 * is only believed when the person can see at least one row of the table. An access rule that hides every row answers 200 with
 * nothing, and the Aggregate API then says 0: shown as "0 breached" that would be a guess (rule 9). Costs one extra one-row read,
 * and only when the count is 0. `unseen` is the sentence for that case.
 */
export async function verifiedCount(reader, table, query, { unseen } = {}) {
  const counted = await attempt(() => reader.count(table, query), table);
  if (!counted.ok || counted.value !== 0) return counted;
  const vis = await reader.visibility(table);
  if (vis.status === 'ok') return counted;
  if (vis.status === 'hidden') return { ok: false, status: 'hidden', note: unseen || vis.note };
  return { ok: false, status: vis.status, note: vis.note };
}

/** Sum the successful counts. { value, partial, failed }: `partial` when some tables could not be read, `value` null when none could. */
export function sumResults(results) {
  const ok = results.filter((r) => r && r.ok);
  if (!ok.length) return { value: null, partial: false, failed: results.length };
  return { value: ok.reduce((n, r) => n + (Number(r.value) || 0), 0), partial: ok.length < results.length, failed: results.length - ok.length };
}

/** Largest first, ties by name; stable output for tests and for screens. */
export const byCountDesc = (a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name));

/** Add up maps of numbers ({ working: 3, waiting: 1 }); undefined when no entry has one. */
function sumMaps(maps) {
  const present = maps.filter((m) => m && typeof m === 'object');
  if (!present.length) return undefined;
  const out = {};
  present.forEach((m) => Object.entries(m).forEach(([k, v]) => (out[k] = (out[k] || 0) + (Number(v) || 0))));
  return out;
}

/**
 * The first `n` entries plus one "others" entry that sums the rest (omitted when nothing is left). The breakdowns the entries carry
 * (`classes` by state, `byTable`) are summed too, so the "others" row draws like the rows it stands for.
 */
export function topWithOthers(list, n, othersLabel = tm('Others ({n})')) {
  if (list.length <= n) return list;
  const rest = list.slice(n);
  // The label is a text with {n} ('Other people ({n})'), or a plain word that "(n)" is added to.
  const name = othersLabel.includes('{n}') ? say(othersLabel, { n: rest.length }) : `${othersLabel} (${rest.length})`;
  const others = { key: '__others', id: '', name, count: rest.reduce((s, x) => s + x.count, 0), others: true };
  ['classes', 'byTable'].forEach((key) => {
    const sum = sumMaps(rest.map((x) => x[key]));
    if (sum) others[key] = sum;
  });
  return [...list.slice(0, n), others];
}

/** A cap note when a read stopped before the end: "first 3000 of 4210". */
export function capNote(source, read) {
  if (!read?.capped) return null;
  return {
    source,
    fetched: read.fetched,
    total: read.total,
    note: read.total ? say(tm('Only the first {fetched} of {total} were read.'), { fetched: read.fetched, total: read.total }) : say(tm('Only the first {fetched} were read; there are more.'), { fetched: read.fetched }),
  };
}

/** The same entry once: a section that builds on another (the hand-over calls the Overview) must not say a thing twice. */
export function uniqueBy(list, keyOf) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((x) => {
    const key = keyOf(x);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Standard result wrapper every section returns, so the panel and later add-ons read one shape. */
export function sectionResult(id, title, ctx, data, extra = {}) {
  return {
    id,
    title,
    generatedAt: ctx.generatedAt,
    readAt: ctx.reader.readAt || ctx.generatedAt,
    scope: { kind: ctx.scope.kind, label: ctx.scope.label, groups: ctx.scope.groups, inferred: ctx.scope.inferred, note: ctx.scope.note },
    tables: tableAccess(ctx.tables),
    access: uniqueBy(ctx.access, (a) => `${a.source}|${a.note}`),
    notes: uniqueBy(ctx.notes, (n) => n),
    caps: uniqueBy(ctx.caps, (c) => `${c.source}|${c.note}`),
    ...(ctx.zone ? { zone: ctx.zone } : {}),
    data,
    ...extra,
  };
}

export const usableTables = (ctx) => ctx.tables.filter((t) => t.usable);

/**
 * Does a report with this scope ({ kind }) show one row PER PERSON of the team (Open work by person, SLA risk by owner)? Today every
 * member of a group sees each member's workload, as the platform's own read rules allow, and a report on one's own tickets (scope
 * "mine") has no other person. The owner has an open decision (audit of 2026-11-07, W-14): perhaps only the group's manager should see
 * per-person rows. If so, this is the ONE place to say it: the Workload engine and the SLA radar's owner bars both ask it (the panel
 * passes the scope kind it was given). Nothing is gated today.
 */
export const showsPersonRows = (scope) => scope?.kind !== 'mine';

export { LIMITS };
