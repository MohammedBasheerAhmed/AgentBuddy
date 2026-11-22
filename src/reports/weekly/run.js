// Runs one weekly read: the signed-in person's own week ("My week") or the weekly report of a Team scope. The same set-up as
// runReport (src/reports/engine/index.js): one reader with the page's cache and limit on parallel requests, the tables the person can
// read, the scope, the person's time zone, and a time limit so a slow instance gives up instead of hanging. Pure given `env.deps`.
//
// HR-family tables are never read here: the weekly views are for the people who work the ticket tables, and the report's text and PDF go
// to people who may not see HR content.
import { LIMITS } from '../engine/constants.js';
import { createReader, ReportError } from '../engine/reader.js';
import { normalizeTables, probeTables, sectionResult } from '../engine/common.js';
import { resolveScope } from '../engine/scope.js';
import { localOffset, quantize } from '../engine/time.js';
import { tm } from '../engine/say.js';
import { weekWindows, cleanWhich } from './weeks.js';
import { countableTables, readMyWeek, readTeamWeek } from './read.js';

/**
 * @param {{ kind: 'team' | 'mine', which?: 'last' | 'this', scope?: object, tables?: string[] }} request
 * @param {{ deps: object, userId: string, runtime: object, now?: number, offsetMin?: number|Function, zone?: object, blocked?: string[], isBlocked?: Function, timeoutMs?: number }} env
 */
export async function runWeekly(request, env) {
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
  const offsetMin = env.offsetMin ?? (typeof env.zone?.tz === 'function' ? env.zone.tz : localOffset);
  const now = quantize(realNow);
  const ctx = {
    reader,
    userId: env.userId || '',
    now,
    generatedAt: realNow,
    offsetMin,
    zone: env.zone ? { id: String(env.zone.id || ''), source: env.zone.source === 'servicenow' ? 'servicenow' : 'browser', note: String(env.zone.note || '') } : null,
    windows: weekWindows({ now, tz: offsetMin, which: cleanWhich(request.which) }),
    tables: [],
    scope: null,
    notes: [],
    access: [],
    caps: [],
  };
  const mine = request.kind === 'mine';

  async function work() {
    ctx.tables = await probeTables(reader, normalizeTables(request.tables, { allowSensitive: false }));
    ctx.scope = await resolveScope(mine ? { kind: 'mine' } : request.scope, { reader, userId: ctx.userId, tables: ctx.tables.filter((t) => t.usable).map((t) => t.table) });
    const w = ctx.windows;
    const window = { which: w.which, partial: w.partial, start: w.current.start, end: w.current.end, previousStart: w.previous.start, previousEnd: w.previous.end, first: w.first, last: w.last };
    // An empty scope would match every ticket in the table: never run with it.
    if (ctx.scope.empty) return sectionResult(mine ? 'my-week' : 'weekly', tm('Weekly report'), ctx, { available: false, emptyScope: true, reason: ctx.scope.note, window });
    if (!countableTables(ctx).length) return sectionResult(mine ? 'my-week' : 'weekly', tm('Weekly report'), ctx, { available: false, reason: ctx.tables.some((t) => t.usable) ? tm('None of the ticket types you can read has a closing date to count.') : tm('No ticket type can be read.'), window });
    const data = mine ? await readMyWeek(ctx) : await readTeamWeek(ctx);
    return sectionResult(mine ? 'my-week' : 'weekly', mine ? tm('My week') : tm('Weekly report'), ctx, { available: true, window, ...data });
  }

  try {
    const working = work();
    working.catch(() => {}); // if the hard stop wins, a late failure is not reported twice
    const result = await Promise.race([working, hardStop]);
    if (controller.signal.aborted) {
      const note = tm('Some numbers took too long to read and are missing.');
      if (Array.isArray(result?.notes) && !result.notes.includes(note)) result.notes.push(note);
    }
    return result;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardTimer);
  }
}
