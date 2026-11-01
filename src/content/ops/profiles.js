// READ operations for the work profiles (src/profiles): what the first-run suggestion needs beyond the person's roles, which the
// page state already carries. Owner: the lead (docs/round3.md).
//
// Two counts, GET only, with the person's own session: do they manage an active assignment group (team lead), and is catalog work
// assigned to them (request fulfilment). A count that cannot be read is "no", never an error: the person ticks profiles themselves.
import { getSessionUser } from '../sessionToken.js';
import { SYS_ID_RE } from '../../context/util.js';

const countOr0 = async (deps, table, query) => {
  try {
    const n = await deps.countRecords(table, query);
    return Number.isFinite(Number(n)) ? Number(n) : 0;
  } catch {
    return 0;
  }
};

export default {
  /** { managesGroup: boolean, hasCatalogWork: boolean } for the signed-in person. */
  async profileHints(_args, { deps }) {
    const session = await getSessionUser(deps);
    const me = String(session?.userId || '');
    if (!SYS_ID_RE.test(me)) return { managesGroup: false, hasCatalogWork: false };
    const [groups, tasks, items] = await Promise.all([
      countOr0(deps, 'sys_user_group', `manager=${me}^active=true`),
      countOr0(deps, 'sc_task', `assigned_to=${me}^active=true`),
      countOr0(deps, 'sc_req_item', `assigned_to=${me}^active=true`),
    ]);
    return { managesGroup: groups > 0, hasCatalogWork: tasks + items > 0 };
  },
};
