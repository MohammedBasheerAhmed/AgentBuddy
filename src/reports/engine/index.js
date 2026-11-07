// The reports engine. `runReport(request, env)` reads one section (or one builder report) and returns plain JSON:
//   { id, title, generatedAt, readAt, scope, tables, access, notes, caps, data }
// Each section is a function of that kind, listed in SECTIONS, so an add-on (the hand-over note, the dashboard explainer) can
// take the same JSON as its input. Pure given `env.deps` (queryTable, aggregate), so the tests drive it with a fake instance.
import { LIMITS, SECTION_IDS } from './constants.js';
import { createCache, createLimiter } from './cache.js';
import { createReader, ReportError } from './reader.js';
import { normalizeTables, probeTables, sectionResult } from './common.js';
import { resolveScope } from './scope.js';
import { overviewSection, overviewTables } from './overview.js';
import { workloadSection, workloadTables } from './workload.js';
import { slaSection, slaTables } from './sla.js';
import { qualitySection, qualityTables } from './quality.js';
import { fulfilmentSection, fulfilmentTables } from './fulfilment.js';
import { handoverSection, handoverTables } from './handover.js';
import { attentionSection, attentionTables } from './attention.js';
import { runBuilder, builderTables } from './builder.js';
import { localOffset, quantize } from './time.js';
import { tm } from './say.js';

export const SECTIONS = Object.freeze({
  attention: { title: tm('Needs attention now'), run: attentionSection, tables: attentionTables },
  overview: { title: tm('Overview'), run: overviewSection, tables: overviewTables },
  workload: { title: tm('Workload and ageing'), run: workloadSection, tables: workloadTables },
  sla: { title: tm('SLA risk radar'), run: slaSection, tables: slaTables },
  quality: { title: tm('Quality and trend'), run: qualitySection, tables: qualityTables },
  fulfilment: { title: tm('Request fulfilment'), run: fulfilmentSection, tables: fulfilmentTables },
  handover: { title: tm('Shift handover'), run: handoverSection, tables: handoverTables },
});

/** The rows of a result as plain tables: [{ title, columns: [{key,label,person?}], rows }]. For CSV, print and copy. */
export function resultTables(result) {
  if (!result) return [];
  if (result.id === 'builder') return builderTables(result);
  return SECTIONS[result.id]?.tables(result) || [];
}

/** One cache and one limiter for the whole page: every section shares them. */
export function createRuntime({ ttlMs = LIMITS.cacheTtlMs, concurrency = LIMITS.concurrency, now } = {}) {
  return { cache: createCache({ ttlMs, max: LIMITS.cacheEntries, ...(now ? { now } : {}) }), limiter: createLimiter(concurrency) };
}

// How old the dashboard's "as of" instant may be and still be used (see asOfFor).
export const AS_OF_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The instant a report counts "now" from. A dashboard passes one `params.asOf` for all its widgets of one load, so they ask the
 * SAME questions ("no update since <date>", "due before <date>"): the second widget's reads are then cache hits instead of new
 * requests one minute later, and two widgets never disagree about the same number. Anything that is not a recent instant (in the
 * future, older than ten minutes, not a number) is ignored and the real time is used.
 */
export function asOfFor(params, realNow) {
  const asOf = Number(params?.asOf);
  if (!Number.isFinite(asOf) || asOf > realNow + 60000 || asOf < realNow - AS_OF_MAX_AGE_MS) return realNow;
  return Math.min(asOf, realNow);
}

/**
 * @param {{ kind?: 'section'|'builder', section?: string, scope?: object, tables?: string[], params?: object, config?: object }} request
 * @param {{ deps: {queryTable: Function, aggregate: Function}, userId: string, runtime: ReturnType<typeof createRuntime>,
 *   now?: number, offsetMin?: number | ((ms: number) => number), blocked?: string[], isBlocked?: (table: string) => boolean,
 *   timeoutMs?: number, zone?: { id: string, source: string, tz: Function, note: string }, allowSensitive?: boolean,
 *   sensitivePrefixes?: string[] }} env
 *   offsetMin: the time zone (minutes west of UTC, or a function of the instant; default the browser's zone, summer time included)
 *   zone: the person's ServiceNow time zone as chosen by chooseZone (./time.js); used when offsetMin is not given
 *   allowSensitive: HR-family tables may be read (the HR profile is on and the organisation allows HR content)
 */
export async function runReport(request, env) {
  const realNow = env.now ?? Date.now();
  const timeoutMs = env.timeoutMs ?? LIMITS.sectionTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let hardTimer;
  const hardStop = new Promise((_, reject) => {
    hardTimer = setTimeout(() => reject(new ReportError('TIMEOUT', tm('This report took too long to read. Try again, or narrow the scope.'))), timeoutMs + 4000);
  });
  hardStop.catch(() => {});

  const reader = createReader({ deps: env.deps, cache: env.runtime.cache, limiter: env.runtime.limiter, prefix: env.userId || '', blocked: env.blocked || [], isBlocked: env.isBlocked, signal: controller.signal });
  const ctx = {
    reader,
    userId: env.userId || '',
    now: quantize(asOfFor(request.params, realNow)),
    generatedAt: realNow,
    offsetMin: env.offsetMin ?? (typeof env.zone?.tz === 'function' ? env.zone.tz : localOffset),
    zone: env.zone ? { id: String(env.zone.id || ''), source: env.zone.source === 'servicenow' ? 'servicenow' : 'browser', note: String(env.zone.note || '') } : null,
    allowSensitive: env.allowSensitive === true,
    sensitivePrefixes: Array.isArray(env.sensitivePrefixes) ? env.sensitivePrefixes : [],
    params: request.params && typeof request.params === 'object' ? request.params : {},
    tables: [],
    scope: null,
    notes: [],
    access: [],
    caps: [],
  };

  async function work() {
    if (request.kind === 'builder') return runBuilder(ctx, request.config);
    const id = request.section;
    if (!Object.prototype.hasOwnProperty.call(SECTIONS, id) || !SECTION_IDS.includes(id)) throw new Error(tm('That report does not exist.'));
    ctx.tables = await probeTables(reader, normalizeTables(request.tables, { allowSensitive: ctx.allowSensitive, sensitivePrefixes: ctx.sensitivePrefixes }));
    ctx.scope = await resolveScope(request.scope, { reader, userId: ctx.userId, tables: ctx.tables.filter((t) => t.usable).map((t) => t.table) });
    // An empty scope would match every ticket in the table: never run with it.
    if (ctx.scope.empty) return sectionResult(id, SECTIONS[id].title, ctx, { available: false, emptyScope: true, reason: ctx.scope.note });
    return SECTIONS[id].run(ctx);
  }

  try {
    const working = work();
    working.catch(() => {}); // if the hard stop wins, a late failure is not reported twice
    const result = await Promise.race([working, hardStop]);
    if (controller.signal.aborted) {
      // The result already holds its own copy of the notes (sectionResult removes repeats), so the note goes there.
      const note = tm('Some numbers took too long to read and are missing.');
      if (Array.isArray(result?.notes) && !result.notes.includes(note)) result.notes.push(note);
    }
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardTimer);
  }
}
