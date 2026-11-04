// READ operations for the reports area (see src/content/ops/index.js). All of them are GET-only Table/Aggregate reads with
// the person's own session; ACLs decide what comes back. Nothing they return is stored, and no report text is sent anywhere.
//
//   reportContext  which report tables the person can read, who they are, which groups they belong to, their time zone
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
import { getSessionUser } from '../sessionToken.js';
import { blockedError } from '../policyGuard.js';
import { createRuntime, runReport } from '../../reports/engine/index.js';
import { createReader, attempt } from '../../reports/engine/reader.js';
import { normalizeTables, probeTables, tableAccess } from '../../reports/engine/common.js';
import { readMyTeam } from '../../reports/engine/scope.js';
import { chooseZone } from '../../reports/engine/time.js';
import { buildQuery } from '../../reports/engine/queryBuilder.js';
import { SECTION_IDS, USER_ZONE_FIELDS } from '../../reports/engine/constants.js';
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
  // The dashboard's "as of" instant (one per load, shared by its widgets); the engine ignores it unless it is recent (asOfFor).
  const asOf = Math.floor(Number(input?.asOf));
  if (Number.isFinite(asOf) && asOf > 0) out.asOf = asOf;
  return out;
}

/**
 * The reads a report makes. The content script hands every READ operation its policy-guarded reads (`ctx.deps`, made by
 * src/content/policyGuard.js from the managed policy merged with the panel's): the Table API read is taken from there, so the
 * guard's checks apply to reports exactly as to every other read (blocked tables, dot-walked columns through a blocked table, rows
 * of a blocked class in `task`). The guarded reads carry no Aggregate API call, so `aggregate` is the table client's own, behind the
 * same guard's checkRead(): the table, and every table a dot-walked group-by, average or query column passes through.
 * Tests call the operations without `ctx`: then the injected deps are used as they are.
 */
export function readsFor(base, ctx) {
  const guarded = ctx?.deps;
  if (!guarded || typeof guarded.queryTable !== 'function' || typeof guarded.isBlocked !== 'function') return { deps: base, isBlocked: null };
  const isBlocked = (table) => guarded.isBlocked(String(table || '').toLowerCase());
  // If the content script's reads ever carry their own (guarded) Aggregate API call, that one is used underneath.
  const aggregateRead = typeof guarded.aggregate === 'function' ? guarded.aggregate : base.aggregate;
  const aggregate = async (table, options = {}) => {
    // The guard's own check for a read it does not make: the table, every table a dot-walked column passes through (by the table the
    // reference column points at, not by the column's name), in the group-by and average columns and in the query's conditions.
    if (typeof guarded.checkRead === 'function') {
      guarded.checkRead(table, options.query, [...(options.groupBy || []), ...(options.avgFields || [])]);
    } else if (isBlocked(table)) {
      throw blockedError(String(table || '').toLowerCase());
    }
    return aggregateRead(table, options);
  };
  return { deps: { queryTable: guarded.queryTable, aggregate }, isBlocked };
}

/** Blocked tables from the organisation's policy, as the panel passes them: plain lower-case identifiers. */
export function cleanBlocked(input) {
  return (Array.isArray(input) ? input : [])
    .map((t) => String(t || '').toLowerCase())
    .filter((t) => TABLE_RE.test(t))
    .slice(0, 100);
}

/**
 * @param {{ deps?: object, getSession?: (deps?: object) => Promise<{userId: string, name: string}|null>, runtime?: object }} [injected]
 *   Replaced by fakes in tests/reports-ops.test.js.
 */
/**
 * The signed-in person's ServiceNow time zone (sys_user.time_zone, a name such as 'Europe/Berlin'): '' when the profile uses the
 * system zone, null when it cannot be read. A GET of one column of their own user record; failures are soft.
 */
export async function readUserZone(reader, userId) {
  const got = await attempt(() => reader.rows('sys_user', buildQuery([{ op: 'eq', field: 'sys_id', value: userId }]), [...USER_ZONE_FIELDS], { limit: 1, displayValue: false }), 'sys_user');
  if (!got.ok || !got.value.length) return null;
  const row = got.value[0];
  if (!Object.prototype.hasOwnProperty.call(row, 'time_zone')) return null; // the column is not readable for this person
  const value = row.time_zone && typeof row.time_zone === 'object' ? row.time_zone.value : row.time_zone;
  return oneLine(value == null ? '' : String(value), 60);
}

/** The zone as plain JSON for the panel (the offset function stays in the content script). */
const zoneJson = (zone) => ({ id: zone.id, source: zone.source, note: zone.note });

/**
 * May this read include HR-family tables? Only when the panel asked (the HR profile is on and the organisation allows HR content)
 * AND the content script let that stand (src/content/reads.js lowers allowSensitive unless the managed policy allows HR content).
 */
const sensitiveFor = (ctx) => ({ allowSensitive: ctx?.allowSensitive === true, sensitivePrefixes: Array.isArray(ctx?.deps?.sensitivePrefixes) ? ctx.deps.sensitivePrefixes : [] });

export function createReportOps({ deps = { queryTable, aggregate }, getSession = getSessionUser, runtime = createRuntime() } = {}) {
  // Who is signed in, the way every other operation finds out (src/content/sessionToken.js getSessionUser): the page's answer checked
  // and cut to size, and on a page that names no user id (a portal) one "Me" read through the guarded reads the operation was given.
  async function whoAmI(ctx) {
    const session = await getSession(ctx?.deps);
    const userId = typeof session?.userId === 'string' ? session.userId : '';
    if (!SYS_ID_RE.test(userId)) throw new Error('Agent Buddy could not tell who is signed in. Reload the page and try again.');
    return { userId, name: typeof session.name === 'string' ? session.name : '' };
  }

  const readerFor = (userId, blocked, ctx) => {
    const reads = readsFor(deps, ctx);
    return createReader({ deps: reads.deps, cache: runtime.cache, limiter: runtime.limiter, prefix: userId, blocked: cleanBlocked(blocked), isBlocked: reads.isBlocked });
  };

  return {
    async reportContext(args = {}, ctx) {
      const { userId, name } = await whoAmI(ctx);
      const reader = readerFor(userId, args.blocked, ctx);
      const sensitive = sensitiveFor(ctx);
      const [tables, snZone] = await Promise.all([probeTables(reader, normalizeTables([], sensitive)), readUserZone(reader, userId)]);
      // The groups are ranked by open work in the tables this person can read, when there are more than a scope holds.
      const usable = tables.filter((t) => t.usable).map((t) => t.table);
      const team = await attempt(() => readMyTeam(reader, userId, { tables: usable }), 'sys_user_grmember');
      return {
        user: { name },
        tables: tableAccess(tables).map((t, i) => ({ ...t, usable: tables[i].usable, sensitive: Boolean(tables[i].meta.sensitive) })),
        groups: team.ok ? team.value.groups : null,
        groupsTotal: team.ok ? team.value.total : null,
        groupsNote: team.ok ? (team.value.groups.length ? team.value.note : 'You are not a member of any active group that you can see.') : 'Your group memberships are not available to you.',
        zone: zoneJson(chooseZone(snZone)),
        readAt: reader.readAt || Date.now(),
      };
    },

    async reportGroups(args = {}, ctx) {
      const { userId } = await whoAmI(ctx);
      const search = oneLine(args.search || '', 60);
      if (search.length < 2) return { groups: [], note: 'Type at least two letters of the group name.' };
      const reader = readerFor(userId, args.blocked, ctx);
      const query = `${buildQuery([{ op: 'like', field: 'name', value: search }, { op: 'true', field: 'active' }])}^ORDERBYname`;
      const found = await attempt(() => reader.rows('sys_user_group', query, ['sys_id', 'name'], { limit: 20, displayValue: false }), 'sys_user_group');
      if (!found.ok) return { groups: [], note: found.status === 'denied' ? 'Groups are not available to you.' : found.note };
      return { groups: found.value.filter((r) => SYS_ID_RE.test(String(r.sys_id || ''))).map((r) => ({ id: String(r.sys_id), name: oneLine(r.name, 80) })), note: found.value.length ? '' : 'No group matches.' };
    },

    async reportRun(args = {}, ctx) {
      const { userId } = await whoAmI(ctx);
      const kind = args.kind === 'builder' ? 'builder' : 'section';
      if (kind === 'section' && !SECTION_IDS.includes(args.section)) throw new Error('That report does not exist.');
      const request = {
        kind,
        section: args.section,
        scope: args.scope,
        tables: Array.isArray(args.tables) ? normalizeTables(args.tables, sensitiveFor(ctx)) : undefined,
        params: cleanParams(args.params),
        config: args.config,
      };
      const reads = readsFor(deps, ctx);
      // 'Today' and 'this week' in the person's ServiceNow time zone (one cached read of their own user record).
      const zone = chooseZone(await readUserZone(readerFor(userId, args.blocked, ctx), userId));
      return runReport(request, { deps: reads.deps, isBlocked: reads.isBlocked, userId, runtime, blocked: cleanBlocked(args.blocked), zone, ...sensitiveFor(ctx) });
    },

    async reportClear() {
      runtime.cache.clear();
      return { ok: true };
    },

    // Every argument is checked by normalizeCoachingRequest (one group id, a date range of at most 92 days, a sample of 1 to 10,
    // known non-HR tables). The answer is plain JSON; nothing is kept here (the read uses a cache of its own that is dropped).
    async coachingSample(args = {}, ctx) {
      const { userId } = await whoAmI(ctx);
      const now = Date.now();
      const request = normalizeCoachingRequest(args, { now });
      const reads = readsFor(deps, ctx);
      return readCoachingSample(request, { deps: reads.deps, isBlocked: reads.isBlocked, userId, blocked: cleanBlocked(args.blocked), now });
    },
  };
}

export default createReportOps();
