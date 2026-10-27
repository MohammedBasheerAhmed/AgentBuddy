// Turning report tables into files and clipboard text. A "table" is { title, columns: [{ key, label, person? }], rows }, the
// plain shape every section returns through `resultTables` (src/reports/engine/index.js).
//
// Masking: people's names become "Person 1", "Person 2"... in the order they first appear, the same name always getting the
// same number within one export; group names are kept. Email addresses anywhere in a cell become "[email]", and a known
// name that appears inside a longer text (a ticket title) is replaced too. A name that is written only in free text and is
// not in a person column anywhere in the export cannot be known, so it stays: the export screen says so.
import { toCsv } from '../lib/export.js';

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEEP = new Set(['', '(unassigned)', '(no group)', 'n/a', 'Unknown']);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (value) => (value === null || value === undefined ? '' : String(value));

/** Mask people in a set of tables. Returns new tables; the input is not changed. */
export function maskTables(tables) {
  const people = new Map(); // lower-cased trimmed name -> "Person N"
  const personOf = (name) => {
    const key = name.trim().toLowerCase();
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
  const names = [...people.keys()].sort((a, b) => b.length - a.length); // longest first: "Ann Lee-Smith" before "Ann Lee"
  const nameRes = names.filter((n) => n.length >= 4).map((n) => ({ re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'giu'), to: people.get(n) }));

  const scrub = (value) => {
    let out = text(value).replace(EMAIL_RE, '[email]');
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
        else next[c.key] = scrub(s);
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
