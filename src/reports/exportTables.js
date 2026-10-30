// Turning report tables into files and clipboard text. A "table" is { title, columns: [{ key, label, person? }], rows }, the
// plain shape every section returns through `resultTables` (src/reports/engine/index.js).
//
// Masking: people's names become "Person 1", "Person 2"... in the order they first appear, the same name always getting the
// same number within one export; group names are kept. Email addresses anywhere in a cell become "[email]", and a known
// name that appears inside a longer text (a ticket title) is replaced too. A name written only in free text ("Laptop for
// Anna Schmidt", "spoke with Dr. Priya Raman") is found by the firewall's prose-name detector (src/pii/names.js) and numbered
// after the people of the person columns, in table, row and column order, so the numbering is the same every time. A name
// with no cue around it ("Anna Schmidt laptop") can still be missed: the export screen says so.
import { toCsv } from '../lib/export.js';
import { detectProseNames } from '../pii/names.js';
import { resolveOverlaps } from '../pii/detectors.js';

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEEP = new Set(['', '(unassigned)', '(no group)', 'n/a', 'Unknown']);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (value) => (value === null || value === undefined ? '' : String(value));
const nameKey = (name) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Mask people in a set of tables. Returns new tables; the input is not changed.
 * @param {object[]} tables
 * @param {{ mode?: 'standard' | 'strict' | 'local-only' }} [options] the privacy mode: Strict also masks capitalised full
 *   names with no cue in front of them (see src/pii/names.js).
 */
export function maskTables(tables, { mode = 'standard' } = {}) {
  const people = new Map(); // lower-cased trimmed name -> "Person N"
  const personOf = (name) => {
    const key = nameKey(name);
    if (!people.has(key)) people.set(key, `Person ${people.size + 1}`);
    return people.get(key);
  };

  // First pass: every name in a person column, in table order, so numbering does not depend on column order.
  tables.forEach((t) =>
    t.rows.forEach((row) =>
      t.columns.forEach((c) => {
        if (!c.person) return;
        const value = text(row[c.key]).trim();
        if (value && !KEEP.has(value)) personOf(value);
      })
    )
  );

  // A name found in prose that is one word of exactly one person-column name ("spoke with Ann" when "Ann Lee" is the owner)
  // is that person; any other name found in prose is a person of its own.
  const columnNames = [...people.keys()];
  const known = (found) => {
    const key = nameKey(found);
    if (people.has(key)) return key;
    if (/\s/.test(key)) return key;
    const owners = columnNames.filter((n) => n.split(/[\s-]+/).includes(key));
    return owners.length === 1 ? owners[0] : key;
  };

  // Second pass: names written in free-text cells, in table, row and column order.
  const prose = new Map(); // row object -> { column key -> findings }
  tables.forEach((t) =>
    t.rows.forEach((row) =>
      t.columns.forEach((c) => {
        const value = row[c.key];
        if (c.person || typeof value !== 'string' || !value) return;
        const found = resolveOverlaps(detectProseNames(value, { mode }));
        if (!found.length) return;
        if (!prose.has(row)) prose.set(row, {});
        prose.get(row)[c.key] = found;
        found.forEach((f) => personOf(known(f.value)));
      })
    )
  );

  const names = [...people.keys()].sort((a, b) => b.length - a.length); // longest first: "Ann Lee-Smith" before "Ann Lee"
  const nameRes = names.filter((n) => n.length >= 4).map((n) => ({ re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'giu'), to: people.get(n) }));

  const scrub = (value, found = []) => {
    // The names found in this very cell first (by position, so a short name such as "Tom" is replaced where it was found), then
    // emails, then every known name wherever else it is written.
    let out = '';
    let pos = 0;
    for (const f of found) {
      out += value.slice(pos, f.start) + people.get(known(f.value));
      pos = f.end;
    }
    out = (out + value.slice(pos)).replace(EMAIL_RE, '[email]');
    nameRes.forEach(({ re, to }) => {
      out = out.replace(re, (_, lead) => `${lead}${to}`);
    });
    return out;
  };

  return tables.map((t) => ({
    ...t,
    rows: t.rows.map((row) => {
      const next = { ...row };
      t.columns.forEach((c) => {
        const value = row[c.key];
        if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return;
        const s = text(value);
        if (c.person) next[c.key] = KEEP.has(s.trim()) ? s : personOf(s);
        else next[c.key] = scrub(s, prose.get(row)?.[c.key]);
      });
      return next;
    }),
  }));
}

/** CSV for one table. Header cells are the column labels. The formula-injection guard of toCsv applies to every cell. */
export function tableToCsv(table) {
  const labels = table.columns.map((c) => c.label);
  const rows = table.rows.map((row) => Object.fromEntries(table.columns.map((c) => [c.label, row[c.key] ?? ''])));
  return toCsv(rows, labels);
}

/** CSV for several tables in one file: the title of each on its own line, a blank line between. A single table is plain CSV. */
export function tablesToCsv(tables) {
  const real = tables.filter((t) => t.rows.length || t.columns.length);
  if (real.length === 1) return tableToCsv(real[0]);
  return real.map((t) => `${toCsv([], [t.title])}\r\n${tableToCsv(t)}`).join('\r\n\r\n');
}

// A cell pasted into a spreadsheet must not run as a formula: same rule as the CSV guard.
const guardCell = (value) => {
  let s = text(value).replace(/[\t\r\n]+/g, ' ').trim();
  if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return s;
};

/** Tab-separated text, which pastes as a table into a spreadsheet, a mail or a document. */
export function tablesToTsv(tables) {
  return tables
    .filter((t) => t.columns.length)
    .map((t) => [t.title, t.columns.map((c) => guardCell(c.label)).join('\t'), ...t.rows.map((row) => t.columns.map((c) => guardCell(row[c.key])).join('\t'))].join('\n'))
    .join('\n\n');
}

/** A safe file name: letters, digits and dashes, with the date. */
export function exportFileName(title, now = new Date()) {
  const slug = text(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report';
  return `agent-buddy-${slug}-${now.toISOString().slice(0, 10)}.csv`;
}
