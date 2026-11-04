// Turn query results into text formats people paste into tickets, wikis and spreadsheets.

/** Reduce a Table API cell (string, or {value, display_value}) to display text. */
export function flattenValue(cell) {
  if (cell == null) return '';
  if (typeof cell === 'object') {
    if ('display_value' in cell && cell.display_value !== '') return String(cell.display_value);
    if ('value' in cell) return String(cell.value ?? '');
    return JSON.stringify(cell);
  }
  return String(cell);
}

// ---- Cells a spreadsheet must not run as a formula (CSV and TSV files, the audit log export, a table pasted from the panel) ----

const FORMULA_START = /^[=+\-@\t\r]/; // (some spreadsheet apps skip a leading tab or carriage return, then read the formula after it)
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * The cell text with an apostrophe in front when a spreadsheet would read it as a formula: it then shows as plain text.
 * keepNumbers: a plain number such as -5 is not a formula, and an apostrophe would turn a column of numbers into text, so a report
 * export leaves it alone. The audit log export guards every such cell (none of its values is a negative number).
 */
export function guardFormula(text, { keepNumbers = false } = {}) {
  const value = text == null ? '' : String(text);
  if (!FORMULA_START.test(value) || (keepNumbers && PLAIN_NUMBER.test(value))) return value;
  return `'${value}`;
}

/** One CSV cell: guarded (guardFormula), and quoted, with its quotes doubled, when it holds a quote, a comma or a line break. */
export function csvCell(text, options) {
  const value = guardFormula(text, options);
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const reportCell = (text) => csvCell(text, { keepNumbers: true });

export function toCsv(rows, columns) {
  const lines = [columns.map(reportCell).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => reportCell(flattenValue(row[c]))).join(',')));
  return lines.join('\r\n');
}
