// F5 "Quality and trend": how work is going over the last weeks. Opened against resolved per day or week, an estimated
// backlog, mean and median time to resolve, how often tickets come back, how often they are handed over, which categories
// and configuration items generate the most work, and callers who keep calling.
//
// The Aggregate API cannot bucket by date, so the trend reads only the date columns (a bounded number of rows, newest
// first) and buckets them here. When there are more rows than the limit the section says so and marks the oldest buckets partial.
import { LIMITS } from './constants.js';
import { attempt } from './reader.js';
import { say, tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName } from '../shown.js';
import { andQuery, byCountDesc, raw, sectionResult, usableTables, resolvedColumn, readOpenStates, openOf } from './common.js';
import { buildQuery } from './queryBuilder.js';
import { DAY, HOUR, bucketCounts, bucketLabels, bucketStarts, localDaysBetween, mean, median, timeOf } from './time.js';

export const TREND_CHOICES = Object.freeze([
  { id: 'day-14', unit: 'day', span: 14, label: tm('Last 14 days') },
  { id: 'day-30', unit: 'day', span: 30, label: tm('Last 30 days') },
  { id: 'week-8', unit: 'week', span: 8, label: tm('Last 8 weeks') },
  { id: 'week-12', unit: 'week', span: 12, label: tm('Last 12 weeks') },
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
    .map((g) => ({ id: g.keys[0].value, name: g.keys[0].display || tm('Unknown'), count: g.count }))
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

async function readTable(ctx, tableInfo, { starts, since, step, windowDays }) {
  const { reader, scope, now } = ctx;
  const q = (...extra) => andQuery(scope.query, ...extra);
  const sinceOpened = buildQuery([{ op: 'since', field: 'opened_at', ms: since }]);
  const newestFirst = (field) => buildQuery([{ op: 'since', field, ms: since }], { orderBy: field, descending: true });
  const rf = resolvedColumn(tableInfo);
  const qual = tableInfo.meta.quality;
  const has = (col) => col && tableInfo.cols.has(col);

  const [openedRead, resolvedRead, openedCount, activeNow, openStates, reopened, avgReassign, multiReassigned, categories, cis, callers] = await Promise.all([
    attempt(() => reader.pages(tableInfo.table, q(newestFirst('opened_at')), ['opened_at'], { max: LIMITS.dateRowsMax }), tableInfo.table),
    rf ? attempt(() => reader.pages(tableInfo.table, q(newestFirst(rf)), [rf, 'opened_at'], { max: LIMITS.dateRowsMax }), tableInfo.table) : null,
    attempt(() => reader.count(tableInfo.table, q(sinceOpened)), tableInfo.table),
    attempt(() => reader.count(tableInfo.table, q('active=true')), tableInfo.table),
    // A ticket resolved but not yet closed is still active. The backlog walks back from "open now" and adds every resolved ticket back,
    // so it must start from the open count the Overview shows (active less those): counted in both, they were there twice.
    readOpenStates(reader, tableInfo.table, q('active=true')),
    has(qual.reopen) ? attempt(() => reader.count(tableInfo.table, q(sinceOpened, buildQuery([{ op: 'gt', field: qual.reopen, value: 0 }]))), tableInfo.table) : null,
    has(qual.reassign) ? attempt(() => reader.averages(tableInfo.table, q(sinceOpened), [qual.reassign]), tableInfo.table) : null,
    has(qual.reassign) ? attempt(() => reader.count(tableInfo.table, q(sinceOpened, buildQuery([{ op: 'gte', field: qual.reassign, value: LIMITS.pingPongMin }]))), tableInfo.table) : null,
    has(qual.category) ? attempt(() => reader.groups(tableInfo.table, q(sinceOpened), [qual.category]), tableInfo.table) : null,
    has(qual.ci) ? attempt(() => reader.groups(tableInfo.table, q(sinceOpened), [qual.ci]), tableInfo.table) : null,
    // One group per caller could be thousands of groups on a big queue: the instance is asked for the repeat callers only.
    has(qual.caller) ? attempt(() => reader.groups(tableInfo.table, q(buildQuery([{ op: 'since', field: 'opened_at', ms: now - LIMITS.repeatCallerDays * DAY }])), [qual.caller], { minCount: LIMITS.repeatCallerMin }), tableInfo.table) : null,
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
  const openNow = openOf(activeNow, openStates.done);
  return { tableInfo, rf, opened, resolved, openedRead, resolvedRead, openedCount, openNow, reopened, avgReassign, multiReassigned, categories, cis, callers, durations, windowDays };
}

export async function qualitySection(ctx) {
  const trend = normalizeTrend(ctx.params.trend);
  const step = trend.unit === 'week' ? 7 * DAY : DAY;
  const starts = bucketStarts({ now: ctx.now, unit: trend.unit, count: trend.span, offsetMin: ctx.offsetMin });
  const since = starts[0];
  // The calendar days the trend covers, today included: "Last 14 days" is 14 days at any hour (a rounded difference said 13 before noon).
  const windowDays = localDaysBetween(since, ctx.now, ctx.offsetMin) + 1;
  const tables = usableTables(ctx);
  const parts = await Promise.all(tables.map((tableInfo) => readTable(ctx, tableInfo, { starts, since, step, windowDays })));

  parts.forEach((p) => {
    const failed = [p.openedRead, p.resolvedRead, p.openedCount, p.openNow].filter((v) => v && !v.ok);
    if (failed.length) ctx.access.push({ source: p.tableInfo.table, status: failed[0].status, note: `${p.tableInfo.meta.label}: ${failed[0].note}` });
    [[tm('opened'), p.opened], [tm('resolved'), p.resolved]].forEach(([what, b]) => {
      if (!b?.capped) return;
      const units = trend.unit === 'week' ? tm('weeks') : tm('days');
      const note = b.total
        ? say(tm('{table}: only the first {fetched} of {total} {what} dates were read, so the oldest {units} are partial.'), { table: p.tableInfo.meta.label, fetched: b.fetched, total: b.total, what, units })
        : say(tm('{table}: only the first {fetched} {what} dates were read, so the oldest {units} are partial.'), { table: p.tableInfo.meta.label, fetched: b.fetched, what, units });
      ctx.caps.push({ source: p.tableInfo.table, fetched: b.fetched, total: b.total, note });
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
  if (!backlogOk && usable.length) ctx.notes.push(tm('The backlog trend is not shown: it needs every table\'s resolved dates and a complete read.'));

  const durations = parts.flatMap((p) => p.durations);
  const resolvedRead = parts.filter((p) => p.resolvedRead?.ok);
  const mttrCapped = resolvedRead.some((p) => p.resolvedRead.value.capped);

  const openedExact = parts.filter((p) => p.openedCount.ok);
  const reopenParts = parts.filter((p) => p.reopened?.ok && p.openedCount.ok);
  const reopenedN = reopenParts.reduce((n, p) => n + p.reopened.value, 0);
  const reopenBase = reopenParts.reduce((n, p) => n + p.openedCount.value, 0);

  const reassignParts = parts.filter((p) => p.avgReassign?.ok && p.avgReassign.value[p.tableInfo.meta.quality.reassign] !== null && p.openedCount.ok);
  const reassignBase = reassignParts.reduce((n, p) => n + p.openedCount.value, 0);
  const reassignAvg = reassignBase ? reassignParts.reduce((n, p) => n + p.avgReassign.value[p.tableInfo.meta.quality.reassign] * p.openedCount.value, 0) / reassignBase : null;
  const multiN = reassignParts.filter((p) => p.multiReassigned?.ok).reduce((n, p) => n + p.multiReassigned.value, 0);

  const callerPart = parts.find((p) => p.callers);
  const repeat = callerPart?.callers?.ok ? repeatCallers(callerPart.callers.value) : [];

  const cat = parts.filter((p) => p.categories?.ok).map((p) => namedCounts(p.categories.value));
  const ci = parts.filter((p) => p.cis?.ok).map((p) => namedCounts(p.cis.value));

  return sectionResult('quality', tm('Quality and trend'), ctx, {
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
      tablesCounted: usable.map((p) => p.tableInfo.meta.label),
    },
    windowDays,
    opened: openedExact.length ? { value: openedExact.reduce((n, p) => n + p.openedCount.value, 0), partial: openedExact.length < parts.length } : null,
    resolved: resolvable.length ? { value: resolvedSeries.reduce((a, b) => a + b, 0), capped: resolvable.some((p) => p.resolved.capped) } : null,
    mttr: durations.length
      ? { meanHours: mean(durations), medianHours: median(durations), sample: durations.length, capped: mttrCapped, window: say(tm('tickets resolved in the last {days} days'), { days: windowDays }) }
      : null,
    reopen: reopenParts.length ? { reopened: reopenedN, of: reopenBase, percent: reopenBase ? (reopenedN / reopenBase) * 100 : 0, window: say(tm('tickets opened in the last {days} days'), { days: windowDays }) } : null,
    reassign: reassignParts.length ? { average: reassignAvg, multi: multiN, of: reassignBase, multiPercent: reassignBase ? (multiN / reassignBase) * 100 : 0, threshold: LIMITS.pingPongMin } : null,
    categories: mergeTop(cat, 8),
    cis: mergeTop(ci, 8),
    // How many callers there were in all is not known (the instance sends only the repeat callers), so it is not claimed.
    repeatCallers: callerPart?.callers?.ok ? { items: repeat.slice(0, 10), total: repeat.length, days: LIMITS.repeatCallerDays, min: LIMITS.repeatCallerMin, table: callerPart.tableInfo.meta.label } : null,
    perTable: parts.map((p) => ({
      table: p.tableInfo.table,
      label: p.tableInfo.meta.label,
      opened: p.openedCount.ok ? p.openedCount.value : null,
      resolved: p.resolved ? p.resolved.counts.reduce((a, b) => a + b, 0) : null,
      openNow: p.openNow.ok ? p.openNow.value : null,
      meanHours: p.durations.length ? mean(p.durations) : null,
    })),
  });
}

export function qualityTables(result) {
  const d = result.data;
  if (!d || d.available === false) return []; // an empty scope or a table list with nothing to read has no tables
  const out = [];
  const weekly = d.trend.unit === 'week';
  out.push({
    title: weekly ? t('Opened and resolved per week') : t('Opened and resolved per day'),
    columns: [
      { key: 'label', label: weekly ? t('Week starting') : t('Day') },
      { key: 'opened', label: t('Opened') },
      ...(d.trend.resolved ? [{ key: 'resolved', label: t('Resolved') }] : []),
      ...(d.trend.backlog ? [{ key: 'backlog', label: t('Open at the end (estimate)') }] : []),
      { key: 'partial', label: t('Complete?') },
    ],
    rows: d.trend.labels.map((label, i) => ({ label, opened: d.trend.opened[i], resolved: d.trend.resolved?.[i], backlog: d.trend.backlog?.[i], partial: d.trend.partial[i] ? t('partial') : t('yes') })),
  });
  const measures = [];
  if (d.mttr) measures.push({ measure: t('Mean time to resolve (hours)'), value: Math.round(d.mttr.meanHours * 10) / 10, note: shown(d.mttr.window) });
  if (d.mttr) measures.push({ measure: t('Median time to resolve (hours)'), value: Math.round(d.mttr.medianHours * 10) / 10, note: t('{count} tickets', { count: d.mttr.sample }) });
  if (d.reopen) measures.push({ measure: t('Reopen rate (%)'), value: Math.round(d.reopen.percent * 10) / 10, note: t('{reopened} of {total} {window}', { reopened: d.reopen.reopened, total: d.reopen.of, window: shown(d.reopen.window) }) });
  if (d.reassign) measures.push({ measure: t('Average reassignments'), value: Math.round(d.reassign.average * 100) / 100, note: t('{multi} of {total} reassigned {threshold}+ times', { multi: d.reassign.multi, total: d.reassign.of, threshold: d.reassign.threshold }) });
  if (measures.length) out.push({ title: t('Quality measures'), columns: [{ key: 'measure', label: t('Measure') }, { key: 'value', label: t('Value') }, { key: 'note', label: t('Based on') }], rows: measures });
  if (d.categories.length) out.push({ title: t('Top categories'), columns: [{ key: 'name', label: t('Category') }, { key: 'count', label: t('Tickets') }], rows: d.categories.map((c) => ({ ...c, name: placeholderName(c.name) })) });
  if (d.cis.length) out.push({ title: t('Top configuration items'), columns: [{ key: 'name', label: t('Configuration item') }, { key: 'count', label: t('Tickets') }], rows: d.cis.map((c) => ({ ...c, name: placeholderName(c.name) })) });
  if (d.repeatCallers?.items.length) {
    out.push({ title: t('Callers with {min}+ tickets in {days} days', { min: d.repeatCallers.min, days: d.repeatCallers.days }), columns: [{ key: 'name', label: t('Caller'), person: true }, { key: 'count', label: t('Tickets') }], rows: d.repeatCallers.items.map((c) => ({ ...c, name: placeholderName(c.name) })) });
  }
  return out;
}
