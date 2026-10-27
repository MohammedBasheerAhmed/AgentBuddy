// Pieces the report sections share: probing which tables a person can use, labelling states, ranking groups, and the
// "how sure are we" notes (denominators, caps) every section reports the same way.
import { raw, disp } from '../../context/util.js';
import { REPORT_TABLES, LIMITS } from './constants.js';
import { andQuery } from './queryBuilder.js';

export { raw, disp, andQuery };

export const clampInt = (value, min, max, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// ---- States --------------------------------------------------------------------------------------------------------
// Every table words its states differently ("In Progress", "Work in Progress", "Awaiting Info"). Reports group them by what
// they mean, judged from the label the instance shows, so a customised state list still lands in the right column.

export const STATE_CLASSES = Object.freeze([
  { key: 'new', label: 'New' },
  { key: 'working', label: 'Open or in progress' },
  { key: 'waiting', label: 'Waiting or on hold' },
  { key: 'other', label: 'Other' },
]);

export function stateClass(label) {
  const text = String(label || '').trim();
  if (/\b(await\w*|pending|on hold|hold|wait\w*)\b/i.test(text)) return 'waiting';
  if (/^(new|draft|requested|assess|authori[sz]e|scheduled)\b/i.test(text)) return 'new';
  if (/\b(open|progress|work\w*|active|implement\w*|review|assigned|process\w*)\b/i.test(text)) return 'working';
  return 'other';
}

// ---- Tables --------------------------------------------------------------------------------------------------------

/** Known tables only, no duplicates, in the order given. An empty list means all of them. */
export function normalizeTables(input) {
  const known = Object.keys(REPORT_TABLES);
  const list = (Array.isArray(input) ? input : []).map((t) => String(t || '').toLowerCase()).filter((t, i, all) => known.includes(t) && all.indexOf(t) === i);
  return list.length ? list : known;
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
  if (vis.status === 'denied') return `${label}: not available to you.`;
  if (vis.status === 'hidden') return `${label}: you can see no rows in this table, so its numbers would prove nothing. It may be empty, or an access rule may hide it.`;
  if (vis.status === 'blocked') return `${label}: your organisation does not allow reports to read this table.`;
  return `${label}: could not be read${vis.note ? ` (${vis.note})` : ''}.`;
}

// ---- Numbers -------------------------------------------------------------------------------------------------------

/** Sum the successful counts. { value, partial, failed }: `partial` when some tables could not be read, `value` null when none could. */
export function sumResults(results) {
  const ok = results.filter((r) => r && r.ok);
  if (!ok.length) return { value: null, partial: false, failed: results.length };
  return { value: ok.reduce((n, r) => n + (Number(r.value) || 0), 0), partial: ok.length < results.length, failed: results.length - ok.length };
}

/** Largest first, ties by name; stable output for tests and for screens. */
export const byCountDesc = (a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name));

/** The first `n` entries plus one "others" entry that sums the rest (omitted when nothing is left). */
export function topWithOthers(list, n, othersLabel = 'Others') {
  if (list.length <= n) return list;
  const rest = list.slice(n);
  return [...list.slice(0, n), { key: '__others', id: '', name: `${othersLabel} (${rest.length})`, count: rest.reduce((s, x) => s + x.count, 0), others: true }];
}

/** A cap note when a read stopped before the end: "first 3000 of 4210". */
export function capNote(source, read) {
  if (!read?.capped) return null;
  return {
    source,
    fetched: read.fetched,
    total: read.total,
    note: read.total ? `Only the first ${read.fetched} of ${read.total} were read.` : `Only the first ${read.fetched} were read; there are more.`,
  };
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
    access: ctx.access,
    notes: ctx.notes,
    caps: ctx.caps,
    data,
    ...extra,
  };
}

export const usableTables = (ctx) => ctx.tables.filter((t) => t.usable);

export { LIMITS };
