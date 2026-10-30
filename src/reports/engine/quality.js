// F5 "Quality and trend": how work is going over the last weeks. Opened against resolved per day or week, an estimated
// backlog, mean and median time to resolve, how often tickets come back, how often they are handed over, which categories
// and configuration items generate the most work, and callers who keep calling.
//
// The Aggregate API cannot bucket by date, so the trend reads only the date columns (a bounded number of rows, newest
// first) and buckets them here. When there are more rows than the limit the section says so and marks the oldest buckets partial.
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { andQuery, byCountDesc, raw, sectionResult, usableTables, resolvedColumn } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { DAY, HOUR, bucketCounts, bucketLabels, bucketStarts, mean, median, timeOf } from './time.js';

export const TREND_CHOICES = Object.freeze([
  { id: 'day-14', unit: 'day', span: 14, label: 'Last 14 days' },
  { id: 'day-30', unit: 'day', span: 30, label: 'Last 30 days' },
  { id: 'week-8', unit: 'week', span: 8, label: 'Last 8 weeks' },
  { id: 'week-12', unit: 'week', span: 12, label: 'Last 12 weeks' },
]);

export function normalizeTrend(input) {
  const hit = TREND_CHOICES.find((c) => c.id === input) || TREND_CHOICES.find((c) => c.unit === input?.unit && c.span === Number(input?.span));
  return hit || TREND_CHOICES[1];
}

/**
 * Which buckets are only partly counted because the read stopped early (rows are newest first, so the oldest day or week is
 * the one that is incomplete). `earliest` is the oldest timestamp that was read. Pure.
 */
export function partialBuckets(starts, earliest, capped) {
  if (!capped || !Number.isFinite(earliest)) return starts.map(() => false);
  return starts.map((s) => s <= earliest);
}

/**
 * Open tickets at the END of each bucket, worked backwards from the open count now:
 * before = after - opened + resolved. An estimate: it ignores tickets that left the queue without being resolved.
 */
export function backlogSeries(openNow, opened, resolved) {
  const out = new Array(opened.length).fill(0);
  let level = openNow;
  for (let i = opened.length - 1; i >= 0; i -= 1) {
    out[i] = Math.max(0, level);
    level = level - (opened[i] || 0) + (resolved[i] || 0);
  }
  return out;
}

/** Hours from opened to resolved for rows that have both; negative or missing ones are skipped. Pure. */
export function durationsHours(rows, resolvedField) {
  const out = [];
  rows.forEach((r) => {
    const a = timeOf(raw(r.opened_at));
    const b = timeOf(raw(r[resolvedField]));
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) out.push((b - a) / HOUR);
  });
  return out;
}

/** Callers with at least `min` tickets, most first. `groups` come from an Aggregate API breakdown by caller. Pure. */
export function repeatCallers(groups, min = LIMITS.repeatCallerMin) {
  return groups
    .filter((g) => g.count >= min && g.keys[0]?.value)
    .map((g) => ({ id: g.keys[0].value, name: g.keys[0].display || 'Unknown', count: g.count }))
    .sort(byCountDesc);
}

/** Merge named counts from several tables (same display name adds up), biggest first, top `n`. Pure. */
export function mergeTop(lists, n = 8) {
  const map = new Map();
  lists.flat().forEach((x) => {
    const key = x.name.trim().toLowerCase();
    const row = map.get(key) || { name: x.name, count: 0 };
    row.count += x.count;
    map.set(key, row);
  });
  return [...map.values()].sort(byCountDesc).slice(0, n);
}

const namedCounts = (groups) => groups.filter((g) => g.keys[0]?.value).map((g) => ({ id: g.keys[0].value, name: g.keys[0].display || g.keys[0].value, count: g.count })).sort(byCountDesc);

async function readTable(ctx, t, { starts, since, step, windowDays }) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const sinceOpened = buildQuery([{ op: 'since', field: 'opened_at', ms: since }]);
  const newestFirst = (field) => buildQuery([{ op: 'since', field, ms: since }], { orderBy: field, descending: true });
  const rf = resolvedColumn(t);
  const qual = t.meta.quality;
  const has = (col) => col && t.cols.has(col);

  const [openedRead, resolvedRead, openedCount, openNow, reopened, avgReassign, multiReassigned, categories, cis, callers] = await Promise.all([
    attempt(() => reader.pages(t.table, q(newestFirst('opened_at')), ['opened_at'], { max: LIMITS.dateRowsMax }), t.table),
    rf ? attempt(() => reader.pages(t.table, q(newestFirst(rf)), [rf, 'opened_at'], { max: LIMITS.dateRowsMax }), t.table) : null,
    attempt(() => reader.count(t.table, q(sinceOpened)), t.table),
    attempt(() => reader.count(t.table, q('active=true')), t.table),
    has(qual.reopen) ? attempt(() => reader.count(t.table, q(sinceOpened, buildQuery([{ op: 'gt', field: qual.reopen, value: 0 }]))), t.table) : null,
    has(qual.reassign) ? attempt(() => reader.averages(t.table, q(sinceOpened), [qual.reassign]), t.table) : null,
    has(qual.reassign) ? attempt(() => reader.count(t.table, q(sinceOpened, buildQuery([{ op: 'gte', field: qual.reassign, value: LIMITS.pingPongMin }]))), t.table) : null,
    has(qual.category) ? attempt(() => reader.groups(t.table, q(sinceOpened), [qual.category]), t.table) : null,
    has(qual.ci) ? attempt(() => reader.groups(t.table, q(sinceOpened), [qual.ci]), t.table) : null,
    // One group per caller could be thousands of groups on a big queue: the instance is asked for the repeat callers only.
    has(qual.caller) ? attempt(() => reader.groups(t.table, q(buildQuery([{ op: 'since', field: 'opened_at', ms: now - LIMITS.repeatCallerDays * DAY }])), [qual.caller], { minCount: LIMITS.repeatCallerMin }), t.table) : null,
  ]);

  // Bucket the dates that were read.
  const bucket = (read, field) => {
    if (!read?.ok) return null;
    const times = read.value.rows.map((r) => timeOf(raw(r[field]))).filter((x) => Number.isFinite(x) && x >= since);
    const earliest = times.length ? Math.min(...times) : NaN;
    return { counts: bucketCounts(times, starts, step), partial: partialBuckets(starts, earliest, read.value.capped), capped: read.value.capped, fetched: read.value.fetched, total: read.value.total };
  };
  const opened = bucket(openedRead, 'opened_at');
  const resolved = rf ? bucket(resolvedRead, rf) : null;

  const durations = resolvedRead?.ok && rf ? durationsHours(resolvedRead.value.rows.filter((r) => timeOf(raw(r[rf])) >= since), rf) : [];
  return { t, rf, opened, resolved, openedRead, resolvedRead, openedCount, openNow, reopened, avgReassign, multiReassigned, categories, cis, callers, durations, windowDays };
}

export async function qualitySection(ctx) {
  const trend = normalizeTrend(ctx.params.trend);
  const step = trend.unit === 'week' ? 7 * DAY : DAY;
  const starts = bucketStarts({ now: ctx.now, unit: trend.unit, count: trend.span, offsetMin: ctx.offsetMin });
  const since = starts[0];
  const windowDays = Math.round((ctx.now - since) / DAY);
  const tables = usableTables(ctx);
  const parts = await Promise.all(tables.map((t) => readTable(ctx, t, { starts, since, step, windowDays })));

  parts.forEach((p) => {
    const failed = [p.openedRead, p.resolvedRead, p.openedCount, p.openNow].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.t.table, status: failed[0].status, note: `${p.t.meta.label}: ${failed[0].note}` });
    [['opened', p.opened], ['resolved', p.resolved]].forEach(([what, b]) => {
      if (b?.capped) ctx.caps.push({ source: p.t.table, fetched: b.fetched, total: b.total, note: `${p.t.meta.label}: only the first ${b.fetched}${b.total ? ` of ${b.total}` : ''} ${what} dates were read, so the oldest ${trend.unit}s are partial.` });
    });
  });

  // One trend over all the tables whose dates could be read.
  const usable = parts.filter((p) => p.opened);
  const sum = (key) => starts.map((_, i) => usable.reduce((n, p) => n + (p[key]?.counts[i] || 0), 0));
  const resolvable = usable.filter((p) => p.resolved);
  const openedSeries = sum('opened');
  const resolvedSeries = starts.map((_, i) => resolvable.reduce((n, p) => n + p.resolved.counts[i], 0));
  const partial = starts.map((_, i) => usable.some((p) => p.opened.partial[i]) || resolvable.some((p) => p.resolved.partial[i]));
  const backlogOk = resolvable.length === usable.length && usable.length > 0 && parts.every((p) => p.openNow.ok) && !usable.some((p) => p.opened.capped || p.resolved?.capped);
  const backlogPerTable = backlogOk ? usable.map((p) => backlogSeries(p.openNow.value, p.opened.counts, p.resolved.counts)) : null;
  const backlog = backlogPerTable ? starts.map((_, i) => backlogPerTable.reduce((n, series) => n + series[i], 0)) : null;
  if (!backlogOk && usable.length) ctx.notes.push('The backlog trend is not shown: it needs every table\'s resolved dates and a complete read.');

  const durations = parts.flatMap((p) => p.durations);
  const resolvedRead = parts.filter((p) => p.resolvedRead?.ok);
  const mttrCapped = resolvedRead.some((p) => p.resolvedRead.value.capped);

  const openedExact = parts.filter((p) => p.openedCount.ok);
  const reopenParts = parts.filter((p) => p.reopened?.ok && p.openedCount.ok);
  const reopenedN = reopenParts.reduce((n, p) => n + p.reopened.value, 0);
  const reopenBase = reopenParts.reduce((n, p) => n + p.openedCount.value, 0);

  const reassignParts = parts.filter((p) => p.avgReassign?.ok && p.avgReassign.value[p.t.meta.quality.reassign] !== null && p.openedCount.ok);
  const reassignBase = reassignParts.reduce((n, p) => n + p.openedCount.value, 0);
  const reassignAvg = reassignBase ? reassignParts.reduce((n, p) => n + p.avgReassign.value[p.t.meta.quality.reassign] * p.openedCount.value, 0) / reassignBase : null;
  const multiN = reassignParts.filter((p) => p.multiReassigned?.ok).reduce((n, p) => n + p.multiReassigned.value, 0);

  const callerPart = parts.find((p) => p.callers);
  const repeat = callerPart?.callers?.ok ? repeatCallers(callerPart.callers.value) : [];

  const cat = parts.filter((p) => p.categories?.ok).map((p) => namedCounts(p.categories.value));
  const ci = parts.filter((p) => p.cis?.ok).map((p) => namedCounts(p.cis.value));

  return sectionResult('quality', 'Quality and trend', ctx, {
    trend: {
      id: trend.id,
      unit: trend.unit,
      span: trend.span,
      label: trend.label,
      labels: bucketLabels(starts, ctx.offsetMin),
      opened: openedSeries,
      resolved: resolvable.length ? resolvedSeries : null,
      backlog,
      partial,
      tablesCounted: usable.map((p) => p.t.meta.label),
    },
    windowDays,
    opened: openedExact.length ? { value: openedExact.reduce((n, p) => n + p.openedCount.value, 0), partial: openedExact.length < parts.length } : null,
    resolved: resolvable.length ? { value: resolvedSeries.reduce((a, b) => a + b, 0), capped: resolvable.some((p) => p.resolved.capped) } : null,
    mttr: durations.length
      ? { meanHours: mean(durations), medianHours: median(durations), sample: durations.length, capped: mttrCapped, window: `tickets resolved in the last ${windowDays} days` }
      : null,
    reopen: reopenParts.length ? { reopened: reopenedN, of: reopenBase, percent: reopenBase ? (reopenedN / reopenBase) * 100 : 0, window: `tickets opened in the last ${windowDays} days` } : null,
    reassign: reassignParts.length ? { average: reassignAvg, multi: multiN, of: reassignBase, multiPercent: reassignBase ? (multiN / reassignBase) * 100 : 0, threshold: LIMITS.pingPongMin } : null,
    categories: mergeTop(cat, 8),
    cis: mergeTop(ci, 8),
    // How many callers there were in all is not known (the instance sends only the repeat callers), so it is not claimed.
    repeatCallers: callerPart?.callers?.ok ? { items: repeat.slice(0, 10), total: repeat.length, days: LIMITS.repeatCallerDays, min: LIMITS.repeatCallerMin, table: callerPart.t.meta.label } : null,
    perTable: parts.map((p) => ({
      table: p.t.table,
      label: p.t.meta.label,
      opened: p.openedCount.ok ? p.openedCount.value : null,
      resolved: p.resolved ? p.resolved.counts.reduce((a, b) => a + b, 0) : null,
      openNow: p.openNow.ok ? p.openNow.value : null,
      meanHours: p.durations.length ? mean(p.durations) : null,
    })),
  });
}

export function qualityTables(result) {
  const d = result.data;
  if (!d) return [];
  const out = [];
  out.push({
    title: `Opened and resolved per ${d.trend.unit}`,
    columns: [
      { key: 'label', label: d.trend.unit === 'week' ? 'Week starting' : 'Day' },
      { key: 'opened', label: 'Opened' },
      ...(d.trend.resolved ? [{ key: 'resolved', label: 'Resolved' }] : []),
      ...(d.trend.backlog ? [{ key: 'backlog', label: 'Open at the end (estimate)' }] : []),
      { key: 'partial', label: 'Complete?' },
    ],
    rows: d.trend.labels.map((label, i) => ({ label, opened: d.trend.opened[i], resolved: d.trend.resolved?.[i], backlog: d.trend.backlog?.[i], partial: d.trend.partial[i] ? 'partial' : 'yes' })),
  });
  const measures = [];
  if (d.mttr) measures.push({ measure: 'Mean time to resolve (hours)', value: Math.round(d.mttr.meanHours * 10) / 10, note: d.mttr.window });
  if (d.mttr) measures.push({ measure: 'Median time to resolve (hours)', value: Math.round(d.mttr.medianHours * 10) / 10, note: `${d.mttr.sample} tickets` });
  if (d.reopen) measures.push({ measure: 'Reopen rate (%)', value: Math.round(d.reopen.percent * 10) / 10, note: `${d.reopen.reopened} of ${d.reopen.of} ${d.reopen.window}` });
  if (d.reassign) measures.push({ measure: 'Average reassignments', value: Math.round(d.reassign.average * 100) / 100, note: `${d.reassign.multi} of ${d.reassign.of} reassigned ${d.reassign.threshold}+ times` });
  if (measures.length) out.push({ title: 'Quality measures', columns: [{ key: 'measure', label: 'Measure' }, { key: 'value', label: 'Value' }, { key: 'note', label: 'Based on' }], rows: measures });
  if (d.categories.length) out.push({ title: 'Top categories', columns: [{ key: 'name', label: 'Category' }, { key: 'count', label: 'Tickets' }], rows: d.categories });
  if (d.cis.length) out.push({ title: 'Top configuration items', columns: [{ key: 'name', label: 'Configuration item' }, { key: 'count', label: 'Tickets' }], rows: d.cis });
  if (d.repeatCallers?.items.length) {
    out.push({ title: `Callers with ${d.repeatCallers.min}+ tickets in ${d.repeatCallers.days} days`, columns: [{ key: 'name', label: 'Caller', person: true }, { key: 'count', label: 'Tickets' }], rows: d.repeatCallers.items });
  }
  return out;
}
