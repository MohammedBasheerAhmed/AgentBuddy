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
// rule may still hide other agents' cases, so the empty note says "that your user can see".

import { STATUS, entry as accessEntry, isSessionExpired, softRead } from '../../context/access.js';
import { kindForTable } from '../../context/kinds.js';
import { SYS_ID_RE, cleanText, disp, oneLine, raw } from '../../context/util.js';

export const ACCOUNT_CASES_MAX = 10;
const FIELDS = ['sys_id', 'number', 'short_description', 'state', 'priority', 'opened_at', 'resolved_at', 'account'];

const reply = (cases, more, access) => ({ cases, more, access });

function shapeCase(row) {
  return {
    number: oneLine(disp(row.number), 40),
    short_description: cleanText(disp(row.short_description), 300),
    state: oneLine(disp(row.state), 40),
    priority: oneLine(disp(row.priority), 40),
    opened_at: oneLine(disp(row.opened_at), 40),
    resolved_at: oneLine(disp(row.resolved_at), 40),
  };
}

/**
 * @param {{ table: string, sysId: string }} record a customer service case (already validated)
 * @param {{ queryTable: Function, countRecords?: Function }} deps same signatures as src/content/tableApi.js
 */
export async function readAccountCases({ table, sysId }, deps) {
  const own = await softRead(deps, table, `sys_id=${sysId}`, ['account'], { limit: 1, displayValue: false });
  if (own.failure) return reply([], 0, [accessEntry(table, own.failure.status, own.failure.note)]);
  const account = raw(own.rows[0]?.account);
  if (!SYS_ID_RE.test(account)) {
    return reply([], 0, [accessEntry(table, STATUS.SKIPPED, "This case has no account, so the account's other cases were not looked up.")]);
  }

  // Open cases first (active, descending), then the newest. Every row is checked against the account again: an instance that
  // ignores a condition on a column it does not have would otherwise hand back everybody's cases.
  const query = `account=${account}^sys_id!=${sysId}^ORDERBYDESCactive^ORDERBYDESCopened_at`;
  const { rows, failure } = await softRead(deps, table, query, FIELDS, { limit: ACCOUNT_CASES_MAX + 1, displayValue: true });
  if (failure) return reply([], 0, [accessEntry(table, failure.status, failure.note)]);
  if (rows.some((row) => raw(row.account).toLowerCase() !== account.toLowerCase())) {
    return reply([], 0, [accessEntry(table, STATUS.ERROR, `Could not check ${table} by account: the instance did not apply the filter, so its rows were not used.`)]);
  }

  const others = rows.filter((row) => raw(row.sys_id).toLowerCase() !== sysId);
  const cases = others.slice(0, ACCOUNT_CASES_MAX).map(shapeCase);
  if (!cases.length) {
    return reply([], 0, [accessEntry(table, STATUS.EMPTY, 'No other cases for this account that your user can see.')]);
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
  const note = more === null ? 'More cases exist for this account than are shown.' : more ? `${more} more case${more === 1 ? '' : 's'} exist for this account.` : '';
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
