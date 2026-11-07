// The READ operation 'header': the few columns the panel shows at the top of a ticket (number, title, state, priority), in one small
// read through the policy guard.
//
// The title is free text. On a sensitive record (an HR-family table, a table the policy's sensitiveTablePrefixes name, or a record
// opened through `task` whose real class cannot be looked up) it is read only when sensitive data is allowed, as every other read of
// such a record (src/content/reads.js, src/context/pack.js): the panel asks with `allowSensitive` and the guard lowers it to what the
// managed policy allows. The number, state and priority still show. Pure apart from the injected guard and deps
// (tests/content-header.test.js).

import { isSensitiveTable } from '../context/kinds.js';
import { resolveRealClass } from '../context/pack.js';
import { SYS_ID_RE, TABLE_RE, disp, raw } from '../context/util.js';

/**
 * @param {{ table: string, sysId: string, allowSensitive?: boolean }} args from the panel (validated here)
 * @param {{ guard: { deps: Function, allowSensitive: Function }, deps: { queryTable: Function }, policy?: object }} context
 *   policy: the panel's normalised policy, merged with the managed one by the guard (it can only make the read stricter)
 * @returns {Promise<{ number: string, short_description: string, state: string, stateValue: string, priority: string, major_incident_state?: string }>}
 */
export async function readHeader(args, { guard, deps, policy = null }) {
  const table = args?.table;
  const sysId = args?.sysId;
  if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) throw new Error('That is not a valid record.');
  const guarded = await guard.deps(deps, policy);
  const allowSensitive = await guard.allowSensitive(args.allowSensitive === true, policy);
  let withheld = false;
  if (!allowSensitive) {
    const real = await resolveRealClass({ table, sysId }, guarded);
    withheld = real.unresolved || isSensitiveTable(real.table, guarded.sensitivePrefixes);
  }
  // An incident also says whether it is a major one (the Major Incident plugin's column; absent elsewhere, then simply not returned).
  const columns = ['number', ...(withheld ? [] : ['short_description']), 'state', 'priority', ...(table === 'incident' ? ['major_incident_state'] : [])];
  const rows = await guarded.queryTable(table, `sys_id=${sysId}`, columns, { limit: 1, displayValue: true });
  const row = rows[0] || {};
  return {
    number: disp(row.number),
    short_description: withheld ? '' : disp(row.short_description),
    state: disp(row.state),
    // The state as ServiceNow stores it ('3'): the same row, no new read. A renamed or translated state is still understood by it (src/domain/states.js).
    stateValue: raw(row.state),
    priority: disp(row.priority),
    ...(row.major_incident_state !== undefined ? { major_incident_state: disp(row.major_incident_state) } : {}),
    // The title was not asked for (a sensitive ticket) or did not come back (a column the person cannot read): that is not an empty title.
    ...(withheld || !Object.hasOwn(row, 'short_description') ? { titleHidden: true } : {}),
  };
}
