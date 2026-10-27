// The reports engine. `runReport(request, env)` reads one section (or one builder report) and returns plain JSON:
//   { id, title, generatedAt, readAt, scope, tables, access, notes, caps, data }
// Each section is a function of that kind, listed in SECTIONS, so a later add-on (a hand-over summary, coaching hints...) can
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
import { runBuilder, builderTables } from './builder.js';
import { localOffset, quantize } from './time.js';

export const SECTIONS = Object.freeze({
  overview: { title: 'Overview', run: overviewSection, tables: overviewTables },
  workload: { title: 'Workload and ageing', run: workloadSection, tables: workloadTables },
  sla: { title: 'SLA risk radar', run: slaSection, tables: slaTables },
  quality: { title: 'Quality and trend', run: qualitySection, tables: qualityTables },
  fulfilment: { title: 'Request fulfilment', run: fulfilmentSection, tables: fulfilmentTables },
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

/**
 * @param {{ kind?: 'section'|'builder', section?: string, scope?: object, tables?: string[], params?: object, config?: object }} request
 * @param {{ deps: {queryTable: Function, aggregate: Function}, userId: string, runtime: ReturnType<typeof createRuntime>,
 *   now?: number, offsetMin?: number, blocked?: string[], timeoutMs?: number }} env
 */
export async function runReport(request, env) {
  const realNow = env.now ?? Date.now();
  const timeoutMs = env.timeoutMs ?? LIMITS.sectionTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let hardTimer;
  const hardStop = new Promise((_, reject) => {
    hardTimer = setTimeout(() => reject(new ReportError('TIMEOUT', 'This report took too long to read. Try again, or narrow the scope.')), timeoutMs + 4000);
  });
  hardStop.catch(() => {});

  const reader = createReader({ deps: env.deps, cache: env.runtime.cache, limiter: env.runtime.limiter, prefix: env.userId || '', blocked: env.blocked || [], signal: controller.signal });
  const ctx = {
    reader,
    userId: env.userId || '',
    now: quantize(realNow),
    generatedAt: realNow,
    offsetMin: env.offsetMin ?? localOffset(realNow),
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
    if (!Object.prototype.hasOwnProperty.call(SECTIONS, id) || !SECTION_IDS.includes(id)) throw new Error('That report does not exist.');
    ctx.tables = await probeTables(reader, normalizeTables(request.tables));
    ctx.scope = await resolveScope(request.scope, { reader, userId: ctx.userId, tables: ctx.tables.filter((t) => t.usable).map((t) => t.table) });
    // An empty scope would match every ticket in the table: never run with it.
    if (ctx.scope.empty) return sectionResult(id, SECTIONS[id].title, ctx, { available: false, emptyScope: true, reason: ctx.scope.note });
    return SECTIONS[id].run(ctx);
  }

  try {
    const working = work();
    working.catch(() => {}); // if the hard stop wins, a late failure is not reported twice
    const result = await Promise.race([working, hardStop]);
    if (controller.signal.aborted) ctx.notes.push('Some numbers took too long to read and are missing.');
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardTimer);
  }
}
