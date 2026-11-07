// READ operations for the domain features (see src/content/ops/index.js).
//
//   accountCases { table, sysId }  ->  { cases, more, access }
//     The other cases of the account this case belongs to: at most 10, open ones first and then the newest. Each case is
//     { number, short_description, state, priority, opened_at, resolved_at }. `more` is how many further cases exist (a number),
//     or null when they exist but could not be counted. GET-only through the context engine's deps (so the person's own session
//     and ACLs decide what comes back); the account is read from the case itself, never taken from the panel.
//
// Honesty about access: a refused read (403) and a read that answers "200, no rows" are reported in `access` and never as "this
// account has no other cases" unless the person can see the case table, which they can: they have this case open. A row-level
// rule may still hide other agents' cases, so the empty note says "that you can see".

import { NOTE_TEXT, STATUS, absentColumns, entry as accessEntry, hiddenFieldEntry, isSessionExpired, softRead, tm } from '../../context/access.js';
import { kindForTable } from '../../context/kinds.js';
import { SYS_ID_RE, cleanText, disp, oneLine, raw } from '../../context/util.js';

export const ACCOUNT_CASES_MAX = 10;

// What the account read says (fixed sentences that name no table and not "your user"; marked for the Arabic catalogue).
const ACCOUNT_NOTE = Object.freeze({
  noAccount: tm("This case has no account, so the account's other cases were not looked up."),
  none: tm('No other cases for this account that you can see.'),
  moreExist: tm('More cases exist for this account than are shown.'),
  oneMore: tm('{n} more case exists for this account.'),
  moreCases: tm('{n} more cases exist for this account.'),
});
// contact, consumer and assigned_to are read for the names only (they are masked wherever another case's wording mentions them);
// they are returned as `people` and are not shown. They are on the 'account-briefing' spec for the case kind.
const PEOPLE_FIELDS = ['contact', 'consumer', 'assigned_to'];
const FIELDS = ['sys_id', 'number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'account', ...PEOPLE_FIELDS];

const reply = (cases, more, access) => ({ cases, more, access });

function shapeCase(row) {
  return {
    number: oneLine(disp(row.number), 40),
    short_description: cleanText(disp(row.short_description), 300),
    state: oneLine(disp(row.state), 40),
    priority: oneLine(disp(row.priority), 40),
    opened_at: oneLine(disp(row.opened_at), 40),
    resolved_at: oneLine(disp(row.resolved_at), 40),
    people: [...new Set(PEOPLE_FIELDS.map((c) => oneLine(disp(row[c]), 100)).filter((name) => name && !SYS_ID_RE.test(name)))],
  };
}

/**
 * @param {{ table: string, sysId: string }} record a customer service case (already validated)
 * @param {{ queryTable: Function, countRecords?: Function }} deps same signatures as src/content/tableApi.js
 */
export async function readAccountCases({ table, sysId }, deps) {
  const own = await softRead(deps, table, `sys_id=${sysId}`, ['account'], { limit: 1, displayValue: false });
  if (own.failure) return reply([], 0, [accessEntry(table, own.failure.status, own.failure.note)]);
  // The account column did not come back at all: the user may not read it, which is not "this case has no account" (R-14).
  if (own.rows[0] && absentColumns(own.rows[0], ['account']).length) return reply([], 0, [hiddenFieldEntry(table)]);
  const account = raw(own.rows[0]?.account);
  if (!SYS_ID_RE.test(account)) {
    return reply([], 0, [accessEntry(table, STATUS.SKIPPED, ACCOUNT_NOTE.noAccount)]);
  }

  // Open cases first (active, descending), then the newest. Every row is checked against the account again: an instance that
  // ignores a condition on a column it does not have would otherwise hand back everybody's cases.
  const query = `account=${account}^sys_id!=${sysId}^ORDERBYDESCactive^ORDERBYDESCopened_at`;
  const { rows, failure } = await softRead(deps, table, query, FIELDS, { limit: ACCOUNT_CASES_MAX + 1, displayValue: true });
  if (failure) return reply([], 0, [accessEntry(table, failure.status, failure.note)]);
  if (rows.some((row) => raw(row.account).toLowerCase() !== account.toLowerCase())) {
    return reply([], 0, [accessEntry(table, STATUS.ERROR, NOTE_TEXT.ignoredFilter)]);
  }

  const others = rows.filter((row) => raw(row.sys_id).toLowerCase() !== sysId);
  const cases = others.slice(0, ACCOUNT_CASES_MAX).map(shapeCase);
  if (!cases.length) {
    return reply([], 0, [accessEntry(table, STATUS.EMPTY, ACCOUNT_NOTE.none)]);
  }

  let more = 0;
  if (others.length > ACCOUNT_CASES_MAX) {
    // Counted, not read: the Aggregate API moves no rows. If it cannot be counted, say that more exist.
    more = null;
    try {
      const total = await deps.countRecords?.(table, `account=${account}^sys_id!=${sysId}`);
      if (Number.isFinite(total) && total > ACCOUNT_CASES_MAX) more = total - ACCOUNT_CASES_MAX;
    } catch (err) {
      if (isSessionExpired(err) || err?.name === 'AbortError') throw err;
    }
  }
  const note = more === null ? ACCOUNT_NOTE.moreExist : more ? (more === 1 ? ACCOUNT_NOTE.oneMore : ACCOUNT_NOTE.moreCases).replace('{n}', String(more)) : '';
  return reply(cases, more, [accessEntry(table, STATUS.OK, note)]);
}

export default {
  accountCases: async (args, { deps, checkRecord }) => {
    checkRecord(args); // a plain table name and a 32-character sys_id, or it throws
    const table = String(args.table);
    if (kindForTable(table) !== 'case') throw new Error('The account briefing works on customer service cases.');
    return readAccountCases({ table, sysId: String(args.sysId).toLowerCase() }, deps);
  },
};
