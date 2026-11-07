// The words for the stored values of a ticket's columns (a state's 3 is "On Hold", a priority's 1 is "1 - Critical"), in the signed-in
// person's own language.
//
// Where they come from (docs/live-checks-2026-11-07.md): NOT the choice table. A plain agent cannot read sys_choice in any query shape
// (403), but the UI meta service answers for an agent and for a person with no role, with each column's `label` and `choices`. That is
// one more GET address of the read layer (src/content/tableApi.js readTableMeta, injected here as `deps.readTableMeta`); this file only
// asks for it, with the organisation's policy applied first, and turns a failure into the same fixed access entries as every other read.
//
// When the service cannot tell (it failed, the person may not read it, the value is not in the list) the caller falls back to the
// ticket's own display value for the value it still holds, and then to plain wording ("State changed"): a stored value is never shown
// as a word ("State 10") and no label is made up.

import { classifyReadError, isSessionExpired } from './access.js';

const isAbort = (err) => err?.name === 'AbortError';

/**
 * The organisation's policy for a read of the labels of `table`: the policy guard's own check (src/content/policyGuard.js
 * `checkRead`, which every READ operation's deps carry) throws BLOCKED_TABLE for a blocked table, or `isBlocked` says so. A table the
 * policy blocks is never asked for.
 */
function checkNotBlocked(deps, table) {
  if (typeof deps.checkRead === 'function') {
    deps.checkRead(table, '', []);
    return;
  }
  if (typeof deps.isBlocked === 'function' && deps.isBlocked(String(table).toLowerCase())) {
    const err = new Error('Your organisation does not allow Agent Buddy to read this.');
    err.code = 'BLOCKED_TABLE';
    err.table = String(table);
    throw err;
  }
}

/**
 * The labels of some columns of a table.
 * @param {object} deps the reads of the context engine, plus `readTableMeta(table, columns)` when the reader has it
 * @param {string} table the ticket's own table
 * @param {string[]} columns the columns whose choices are wanted ('state', 'priority')
 * @returns {Promise<{ labels: Map<string, string>, columnLabels: Map<string, string>, failure: { status: string, note: string, reason?: string }|null }>}
 *   labels: 'column:value' -> the word for the value; columnLabels: 'column' -> the word for the column. Nothing is thrown for a
 *   refusal or a failure (it is the `failure`); only a lost sign-in or a cancelled read is.
 */
export async function readChoiceLabels(deps, table, columns) {
  const labels = new Map();
  const columnLabels = new Map();
  if (typeof deps?.readTableMeta !== 'function') return { labels, columnLabels, failure: null };
  try {
    checkNotBlocked(deps, table);
    const meta = await deps.readTableMeta(table, columns);
    for (const column of columns) {
      const entry = meta && Object.hasOwn(meta, column) ? meta[column] : null;
      if (!entry) continue;
      if (entry.label) columnLabels.set(column, entry.label);
      for (const choice of Array.isArray(entry.choices) ? entry.choices : []) if (choice?.value && choice.label) labels.set(`${column}:${choice.value}`, choice.label);
    }
    return { labels, columnLabels, failure: null };
  } catch (err) {
    if (isSessionExpired(err) || isAbort(err)) throw err;
    return { labels, columnLabels, failure: classifyReadError(err) };
  }
}
