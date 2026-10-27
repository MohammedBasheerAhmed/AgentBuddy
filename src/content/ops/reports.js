// READ operations for the reports area (see src/content/ops/index.js). All of them are GET-only Table/Aggregate reads with
// the person's own session; ACLs decide what comes back. Nothing they return is stored, and no report text is sent anywhere.
//
//   reportContext  which report tables the person can read, who they are, which groups they belong to
//   reportGroups   search groups by name (for "chosen groups")
//   reportRun      run one section or one builder report
//   reportClear    forget the short-lived cache (the Refresh button)
//   coachingSample the sample of resolved tickets for ONE group (close notes, close code, the group's customer-visible comments)
//                  that the coaching snapshot reviews. Only the panel's 'coaching' section asks for it, and only when the
//                  organisation's policy has switched coaching on; this file cannot see the policy, the panel is the gate.
//
// The one cache and the one limit on parallel requests live here, so every widget on every open dashboard shares them.
import { SYS_ID_RE, TABLE_RE, oneLine } from '../../context/util.js';
import { queryTable, aggregate } from '../tableApi.js';
import { tryCallPage } from '../pageBridge.js';
import { createRuntime, runReport } from '../../reports/engine/index.js';
import { createReader, attempt } from '../../reports/engine/reader.js';
import { normalizeTables, probeTables, tableAccess } from '../../reports/engine/common.js';
import { readMyGroups } from '../../reports/engine/scope.js';
import { buildQuery } from '../../reports/engine/queryBuilder.js';
import { SECTION_IDS, REPORT_TABLE_IDS } from '../../reports/engine/constants.js';
import { TREND_CHOICES } from '../../reports/engine/quality.js';
import { normalizeHours } from '../../reports/engine/handover.js';
import { readCoachingSample } from '../../reports/engine/coaching.js';
import { normalizeCoachingRequest } from '../../reports/ai/coaching.js';

const clean = (value, min, max) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

/** The few knobs a section takes; anything else the panel sends is dropped. */
export function cleanParams(input) {
  const out = {};
  if (TREND_CHOICES.some((c) => c.id === input?.trend)) out.trend = input.trend;
  const stale = clean(input?.staleDays, 1, 60);
  if (stale !== undefined) out.staleDays = stale;
  const top = clean(input?.top, 3, 30);
  if (top !== undefined) out.top = top;
  // The shift handover's period: 8, 12 or 24 hours (anything else is ignored, so the section uses its default).
  if (input?.hours !== undefined && Number(input.hours) === normalizeHours(input.hours)) out.hours = normalizeHours(input.hours);
  return out;
}

/** Blocked tables from the organisation's policy, as the panel passes them: plain lower-case identifiers. */
export function cleanBlocked(input) {
  return (Array.isArray(input) ? input : [])
    .map((t) => String(t || '').toLowerCase())
    .filter((t) => TABLE_RE.test(t))
    .slice(0, 100);
}

/**
 * @param {{ deps?: object, getSession?: () => Promise<{userId?: string, firstName?: string, lastName?: string}|null>, runtime?: object }} [injected]
 *   Replaced by fakes in tests/reports-ops.test.js.
 */
export function createReportOps({ deps = { queryTable, aggregate }, getSession = () => tryCallPage('getSessionInfo'), runtime = createRuntime() } = {}) {
  async function whoAmI() {
    const session = await getSession();
    const userId = String(session?.userId || '');
    if (!SYS_ID_RE.test(userId)) throw new Error('Agent Buddy could not tell who is signed in. Reload the page and try again.');
    return { userId, name: [session.firstName, session.lastName].filter(Boolean).join(' ') };
  }

  const readerFor = (userId, blocked) => createReader({ deps, cache: runtime.cache, limiter: runtime.limiter, prefix: userId, blocked: cleanBlocked(blocked) });

  return {
    async reportContext(args = {}) {
      const { userId, name } = await whoAmI();
      const reader = readerFor(userId, args.blocked);
      const [tables, groups] = await Promise.all([probeTables(reader, REPORT_TABLE_IDS), attempt(() => readMyGroups(reader, userId), 'sys_user_grmember')]);
      return {
        user: { name },
        tables: tableAccess(tables).map((t, i) => ({ ...t, usable: tables[i].usable })),
        groups: groups.ok ? groups.value : null,
        groupsNote: groups.ok ? (groups.value.length ? '' : 'You are not a member of any group that you can see.') : 'Your group memberships are not available to you.',
        readAt: reader.readAt || Date.now(),
      };
    },

    async reportGroups(args = {}) {
      const { userId } = await whoAmI();
      const search = oneLine(args.search || '', 60);
      if (search.length < 2) return { groups: [], note: 'Type at least two letters of the group name.' };
      const reader = readerFor(userId, args.blocked);
      const query = `${buildQuery([{ op: 'like', field: 'name', value: search }, { op: 'true', field: 'active' }])}^ORDERBYname`;
      const found = await attempt(() => reader.rows('sys_user_group', query, ['sys_id', 'name'], { limit: 20, displayValue: false }), 'sys_user_group');
      if (!found.ok) return { groups: [], note: found.status === 'denied' ? 'Groups are not available to you.' : found.note };
      return { groups: found.value.filter((r) => SYS_ID_RE.test(String(r.sys_id || ''))).map((r) => ({ id: String(r.sys_id), name: oneLine(r.name, 80) })), note: found.value.length ? '' : 'No group matches.' };
    },

    async reportRun(args = {}) {
      const { userId } = await whoAmI();
      const kind = args.kind === 'builder' ? 'builder' : 'section';
      if (kind === 'section' && !SECTION_IDS.includes(args.section)) throw new Error('That report does not exist.');
      const request = {
        kind,
        section: args.section,
        scope: args.scope,
        tables: Array.isArray(args.tables) ? normalizeTables(args.tables) : undefined,
        params: cleanParams(args.params),
        config: args.config,
      };
      return runReport(request, { deps, userId, runtime, blocked: cleanBlocked(args.blocked) });
    },

    async reportClear() {
      runtime.cache.clear();
      return { ok: true };
    },

    // Every argument is checked by normalizeCoachingRequest (one group id, a date range of at most 92 days, a sample of 1 to 10,
    // known non-HR tables). The answer is plain JSON; nothing is kept here (the read uses a cache of its own that is dropped).
    async coachingSample(args = {}) {
      const { userId } = await whoAmI();
      const now = Date.now();
      const request = normalizeCoachingRequest(args, { now });
      return readCoachingSample(request, { deps, userId, blocked: cleanBlocked(args.blocked), now });
    },
  };
}

export default createReportOps();
