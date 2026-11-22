// READ operations for "My week" and the weekly report (round 5, docs/round5.md). See src/content/ops/index.js.
//
//   myWeek        the signed-in person's own week: tickets closed, time to resolve, first reply, reopened, SLAs, closed tickets by area
//   weeklyReport  the week of a Team scope: came in, closed, backlog change, SLAs kept, reopened, what needs a decision, the oldest tickets
//   weeklyClear   forget this file's short-lived cache (the Refresh button)
//
// GET only, through the policy-guarded reads the content script hands every operation (src/content/ops/reports.js readsFor). The week is
// counted in the person's own ServiceNow time zone. Nothing is stored and nothing here sends anything: the panel draws the numbers, and
// only counts and ticket numbers can reach an AI (src/reports/weekly/ai.js).
import { SYS_ID_RE, oneLine } from '../../context/util.js';
import { getSessionUser } from '../sessionToken.js';
import { queryTable, aggregate } from '../tableApi.js';
import { createRuntime } from '../../reports/engine/index.js';
import { createReader } from '../../reports/engine/reader.js';
import { chooseZone } from '../../reports/engine/time.js';
import { normalizeScope } from '../../reports/engine/scope.js';
import { runWeekly } from '../../reports/weekly/run.js';
import { cleanWhich } from '../../reports/weekly/weeks.js';
import { cleanBlocked, readUserZone, readsFor } from './reports.js';

/** The scope the panel sends, cleaned (a known kind, valid group ids, short names). */
export const cleanScope = (input) => normalizeScope(input);

/**
 * @param {{ deps?: object, getSession?: Function, runtime?: object, now?: () => number }} [injected] replaced by fakes in tests
 */
export function createWeeklyOps({ deps = { queryTable, aggregate }, getSession = getSessionUser, runtime = createRuntime(), now = () => Date.now() } = {}) {
  async function whoAmI(ctx) {
    const session = await getSession(ctx?.deps);
    const userId = typeof session?.userId === 'string' ? session.userId : '';
    if (!SYS_ID_RE.test(userId)) throw new Error('Agent Buddy could not tell who is signed in. Reload the page and try again.');
    return { userId };
  }

  async function run(kind, args, ctx) {
    const { userId } = await whoAmI(ctx);
    const reads = readsFor(deps, ctx);
    const blocked = cleanBlocked(args?.blocked);
    const reader = createReader({ deps: reads.deps, cache: runtime.cache, limiter: runtime.limiter, prefix: userId, blocked, isBlocked: reads.isBlocked });
    // The week is the person's own: their ServiceNow time zone (one cached read of their own user record), else the browser's, said once.
    const zone = chooseZone(await readUserZone(reader, userId));
    const request = {
      kind,
      which: cleanWhich(args?.which),
      scope: kind === 'team' ? cleanScope(args?.scope) : undefined,
      tables: Array.isArray(args?.tables) ? args.tables.map((t) => oneLine(String(t || ''), 60)) : undefined,
    };
    // The result is plain JSON: the zone's offset function stays in the content script.
    return runWeekly(request, { deps: reads.deps, isBlocked: reads.isBlocked, userId, runtime, blocked, zone, now: now() });
  }

  return {
    myWeek: (args = {}, ctx) => run('mine', args, ctx),
    weeklyReport: (args = {}, ctx) => run('team', args, ctx),
    weeklyClear: async () => {
      runtime.cache.clear();
      return { ok: true };
    },
  };
}

export default createWeeklyOps();
