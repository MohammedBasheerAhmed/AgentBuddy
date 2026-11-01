// READ operations for the My work screen (owner: My work agent, docs/round3.md). See src/content/ops/index.js.
//
//   myWork   the signed-in agent's open tickets (every type, counted first, read in pages), their SLAs and who wrote last, the
//            approvals waiting on them and the unassigned tickets of their groups (src/mywork/read.js).
//
// GET only, through the policy-guarded deps the content script hands every operation (blocked tables are refused, HR content only
// when the guard allows it: `allowSensitive` here is the guard's answer, never the panel's wish). Who is signed in comes from the
// page (src/content/sessionToken.js), never from the panel. Nothing is stored; the answer carries no ticket text but titles.
import { getSessionUser } from '../sessionToken.js';
import { PROFILE_IDS } from '../../profiles/ids.js';
import { readMyWork } from '../../mywork/read.js';

/** The only argument the panel sends: the person's work profiles (which tables to count when `task` cannot be counted). */
export function cleanMyWorkArgs(args) {
  const list = Array.isArray(args?.profiles) ? args.profiles : [];
  const profiles = [];
  for (const p of list) if (typeof p === 'string' && PROFILE_IDS.includes(p) && !profiles.includes(p)) profiles.push(p);
  return { profiles };
}

/** The operations, with who-am-I injectable for tests. */
export function makeMyWorkOps({ whoAmI = getSessionUser, now = () => Date.now() } = {}) {
  return {
    myWork: async (args, { deps, allowSensitive } = {}) => {
      const { profiles } = cleanMyWorkArgs(args);
      const session = await whoAmI(deps);
      return readMyWork({ userId: session?.userId || '', userName: session?.userName || '' }, deps, { profiles, allowSensitive: allowSensitive === true, now: now() });
    },
  };
}

export default makeMyWorkOps();
