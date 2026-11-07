// READ operations for the ITSM features (see src/content/ops/index.js).
//
// routingLookalikes: solved look-alike tickets for the routing hint. The existing 'similar' read ranks look-alikes but does
// not return the two things a routing hint is grounded in, the assignment group and the priority, so this adds them with ONE
// more GET for the few tickets that were found. It reads with the person's own session (ACLs apply): a group or priority they
// cannot read comes back empty, and a refused read is reported in `access`, never worked around.

import { findSimilarTickets } from '../../context/index.js';
import { STATUS, entry as accessEntry, softRead, tm } from '../../context/access.js';
import { SYS_ID_RE, disp, oneLine, raw } from '../../context/util.js';

const LIMIT = 5;
// assignment_group.active (W-15): whether the group a look-alike went to is still in use, walked from the group in this same read (no new
// request). A key that does not come back is not told, and a group that is not told about stays in the hint as it was.
const EXTRA_COLUMNS = ['sys_id', 'assignment_group', 'assignment_group.active', 'priority', 'subcategory'];

// 'true' | 'false' | '': a flag that was not told is not 'false'.
const activeFlag = (cell) => (raw(cell) === 'true' || raw(cell) === 'false' ? raw(cell) : '');

export default {
  /**
   * @param {{ pack: { table: string, sysId: string, fields?: object, people?: object[] }, allowSensitive?: boolean }} args
   * @returns {Promise<{ hits: object[], keywords: string[], access: object[] }>} hits as in 'similar', plus
   *   assignment_group, priority and subcategory (display values, '' when not readable)
   */
  async routingLookalikes(args, { deps, checkPack, allowSensitive = false }) {
    const pack = checkPack(args?.pack);
    // `allowSensitive` is the panel's request after the managed policy has had its say (src/content/reads.js).
    const found = await findSimilarTickets(pack, deps, { resolvedOnly: true, limit: LIMIT, allowSensitive });
    const access = [...found.access];

    // sys_ids come from our own read above, but they are still checked: the query is built from them.
    const ids = found.hits.map((h) => String(h.sysId || '').toLowerCase()).filter((id) => SYS_ID_RE.test(id));
    const extra = new Map();
    if (ids.length) {
      const { rows, failure } = await softRead(deps, pack.table, `sys_idIN${ids.join(',')}`, EXTRA_COLUMNS, { limit: ids.length + 1, displayValue: true });
      if (failure) {
        const blocked = failure.status === STATUS.BLOCKED;
        access.push(accessEntry(pack.table, blocked ? STATUS.BLOCKED : failure.status === STATUS.DENIED ? STATUS.DENIED : STATUS.ERROR, blocked ? failure.note : tm('The assignment group and priority of the look-alike tickets could not be read.')));
      } else {
        rows.forEach((row) => extra.set(raw(row.sys_id).toLowerCase(), row));
      }
    }

    const hits = found.hits.map((hit) => {
      const row = extra.get(String(hit.sysId || '').toLowerCase());
      return {
        ...hit,
        assignment_group: row ? oneLine(disp(row.assignment_group), 100) : '',
        assignment_group_active: row ? activeFlag(row['assignment_group.active']) : '',
        priority: row ? oneLine(disp(row.priority), 40) : '',
        subcategory: row ? oneLine(disp(row.subcategory), 100) : '',
      };
    });
    return { hits, keywords: found.keywords, access };
  },
};
