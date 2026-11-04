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

function csvCell(text) {
  let value = text;
  // Stop spreadsheet apps from running cell contents as a formula.
  if (/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => csvCell(flattenValue(row[c]))).join(',')));
  return lines.join('\r\n');
}
