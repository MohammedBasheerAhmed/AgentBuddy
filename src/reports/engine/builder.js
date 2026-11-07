// The small report builder: a table, a few filter presets, one grouping and one measure. The configuration is a closed
// vocabulary (names from fixed lists), so a saved widget or a message from the panel can never carry a query of its own.
import { SYS_ID_RE } from '../../context/util.js';
import { LIMITS, REPORT_TABLES, REPORT_TABLE_IDS, isSensitiveReportTable } from './constants.js';
import { attempt, keyName } from './reader.js';
import { andQuery, capNote, probeTables, raw, disp, resolvedColumn, stateName, tableAccess } from './common.js';
import { FILTER_PRESETS, buildQuery, normalizePresets, presetConditions, windowDaysOf, QueryError } from './queryBuilder.js';
import { readMyGroups } from './scope.js';
import { DAY, bucketCounts, bucketLabels, bucketStarts, localWeeksCovering, mean, timeOf } from './time.js';
import { partialBuckets } from './quality.js';
import { say, tm } from './say.js';
import { t } from '../../i18n/core.js';
import { shown, placeholderName } from '../shown.js';

export const GROUP_BY = Object.freeze([
  { id: 'none', label: tm('No grouping (one number)') },
  { id: 'state', label: tm('State'), field: 'state' },
  { id: 'priority', label: tm('Priority'), field: 'priority' },
  { id: 'assignment_group', label: tm('Assignment group'), field: 'assignment_group' },
  { id: 'assigned_to', label: tm('Assigned to'), field: 'assigned_to', person: true },
  { id: 'category', label: tm('Category'), field: 'category' },
  { id: 'cmdb_ci', label: tm('Configuration item'), field: 'cmdb_ci' },
  { id: 'opened_day', label: tm('Day opened'), time: { field: 'opened_at', unit: 'day' } },
  { id: 'opened_week', label: tm('Week opened'), time: { field: 'opened_at', unit: 'week' } },
  { id: 'resolved_day', label: tm('Day resolved'), time: { field: 'resolved', unit: 'day' } },
  { id: 'resolved_week', label: tm('Week resolved'), time: { field: 'resolved', unit: 'week' } },
]);

export const METRICS = Object.freeze([
  { id: 'count', label: tm('Number of tickets') },
  { id: 'avg_resolve_days', label: tm('Average days to resolve') },
  { id: 'avg_age_days', label: tm('Average age of open tickets (days)') },
]);

export const CHARTS = Object.freeze([
  { id: 'bar', label: tm('Bars') },
  { id: 'donut', label: tm('Donut') },
  { id: 'line', label: tm('Line over time') },
  { id: 'table', label: tm('Numbers only') },
]);

const byId = (list, id) => list.find((x) => x.id === id);

/** A builder configuration from anything: unknown names fall back to safe defaults. Never throws. */
export function normalizeBuilderConfig(input) {
  const table = REPORT_TABLE_IDS.includes(input?.table) ? input.table : 'incident';
  const groupBy = byId(GROUP_BY, input?.groupBy) ? input.groupBy : 'state';
  const timeGroup = Boolean(byId(GROUP_BY, groupBy).time);
  let metric = byId(METRICS, input?.metric) ? input.metric : 'count';
  if (timeGroup) metric = 'count'; // averages per day are not offered: too few tickets per bucket to mean anything
  let chart = byId(CHARTS, input?.chart) ? input.chart : timeGroup ? 'line' : 'bar';
  if (chart === 'line' && !timeGroup) chart = 'bar';
  if (timeGroup && chart === 'donut') chart = 'line';
  // A donut shows the shares of a whole. Averages are not parts of anything: their sum and its percentages mean nothing.
  if (metric !== 'count' && chart === 'donut') chart = 'bar';
  // eslint-disable-next-line no-control-regex -- control characters are what it takes out
  const title = typeof input?.title === 'string' ? input.title.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) : '';
  return { table, presets: normalizePresets(input?.presets), groupBy, metric, chart, title };
}

/** "Open, in my groups, opened in the last 30 days" for the heading. */
export function describeFilter(presets) {
  const names = normalizePresets(presets).map((id) => byId(FILTER_PRESETS, id).label);
  return names.length ? names.join(', ') : tm('All tickets');
}

// A chart holds at most this many groups.
const MAX_ITEMS = 40;

/**
 * The first `n` counted groups, and the rest added up into one "Others (n)" entry (it opens no list): the shares, the donut and the
 * table are then of the real total, not of the first groups only.
 */
function withOthers(items, n) {
  if (items.length <= n) return items;
  const rest = items.slice(n);
  const sum = rest.reduce((s, x) => s + x.value, 0);
  return [...items.slice(0, n), { key: '__others', label: say(tm('Others ({n})'), { n: rest.length }), value: sum, n: sum, query: '', others: true }];
}

/** Group of drill-down: the query for one bar. */
function itemQuery(base, field, value) {
  if (!field) return base;
  const cond = value === '' || value == null ? { op: 'empty', field } : { op: 'eq', field, value };
  try {
    return andQuery(base, buildQuery([cond]));
  } catch (err) {
    if (err instanceof QueryError) return ''; // a value that cannot be written safely gets no drill-down
    throw err;
  }
}

async function breachedIds(reader, table) {
  const rows = await reader.rows('task_sla', `active=true^has_breached=true^task.sys_class_name=${table}`, ['task'], { limit: 100 });
  const ids = [...new Set(rows.map((r) => raw(r.task)).filter((id) => SYS_ID_RE.test(id)))];
  return { ids, capped: rows.length >= 100 };
}

export async function runBuilder(ctx, rawConfig) {
  const config = normalizeBuilderConfig(rawConfig);
  const { reader, now } = ctx;
  const meta = REPORT_TABLES[config.table];
  // An HR-family table is read only for someone with the HR profile whose organisation allows HR content (see constants.js).
  if (isSensitiveReportTable(config.table, ctx.sensitivePrefixes) && !ctx.allowSensitive) {
    return { id: 'builder', title: meta.label, generatedAt: ctx.generatedAt, readAt: ctx.generatedAt, scope: { kind: 'builder', label: describeFilter(config.presets), groups: [], inferred: false, note: '' }, tables: [], access: [], notes: [], caps: [], data: { available: false, reason: say(tm('{table} are shown only with the HR profile, when your organisation allows HR content.'), { table: meta.label }), status: 'blocked', config } };
  }
  const [tableInfo] = await probeTables(reader, [config.table]);
  ctx.tables = [tableInfo];
  const base = {
    id: 'builder',
    title:
      config.title ||
      (config.groupBy === 'none'
        ? say(tm('{table}: {measure}'), { table: meta.label, measure: byId(METRICS, config.metric).label.toLowerCase() })
        : say(tm('{table}: {measure} by {groupBy}'), { table: meta.label, measure: byId(METRICS, config.metric).label.toLowerCase(), groupBy: byId(GROUP_BY, config.groupBy).label.toLowerCase() })),
    generatedAt: ctx.generatedAt,
    scope: { kind: 'builder', label: describeFilter(config.presets), groups: [], inferred: false, note: '' },
    tables: tableAccess([tableInfo]),
    access: ctx.access,
    notes: ctx.notes,
    caps: ctx.caps,
  };
  const fail = (reason, status = 'error') => ({ ...base, readAt: reader.readAt || ctx.generatedAt, data: { available: false, reason, status, config } });
  if (!tableInfo.usable) return fail(tableAccess([tableInfo])[0].note || tm('This ticket type is not available to you.'), tableInfo.vis.status);

  // Filter -> conditions. Presets that need the person's id or groups read them here.
  let groupIds = [];
  if (config.presets.includes('my_groups')) {
    const groups = await attempt(() => readMyGroups(reader, ctx.userId), 'sys_user_grmember');
    if (!groups.ok || !groups.value.length) return fail(groups.ok ? tm('You are not in any group that Agent Buddy can see.') : tm('Your groups are not available to you.'));
    groupIds = groups.value.map((g) => g.id);
  }
  let conditions;
  try {
    conditions = presetConditions(config.presets, { userId: ctx.userId, groupIds, now: ctx.now });
  } catch (err) {
    if (err instanceof QueryError) return fail(err.message);
    throw err;
  }
  if (config.presets.includes('breached')) {
    const ids = await attempt(() => breachedIds(reader, config.table), 'task_sla');
    if (!ids.ok) return fail(tm('SLA information is not available to you.'), ids.status);
    if (!ids.value.ids.length) {
      // "Nothing breached" is only true when this person can see SLA records at all; otherwise the report would show a made-up 0.
      const vis = await reader.visibility('task_sla');
      if (vis.status !== 'ok') return fail(vis.status === 'hidden' ? tm('You can\'t see any SLAs at all, so "SLA breached" cannot be worked out.') : tm('SLA information is not available to you.'), vis.status);
    }
    if (!ids.value.ids.length) conditions.push({ op: 'in', field: 'sys_id', values: ['0'.repeat(32)] }); // nothing breached: match nothing
    else conditions.push({ op: 'in', field: 'sys_id', values: ids.value.ids });
    if (ids.value.capped) ctx.notes.push(tm('Only the first 100 breached tickets are included.'));
  }
  let query;
  try {
    query = buildQuery(conditions);
  } catch (err) {
    if (err instanceof QueryError) return fail(err.message);
    throw err;
  }

  const group = byId(GROUP_BY, config.groupBy);
  const metric = config.metric;
  const out = { config, table: config.table, tableLabel: meta.label, filter: describeFilter(config.presets), query, groupBy: group.id, groupLabel: group.label, metric, available: true };
  const unit = metric === 'count' ? tm('tickets') : tm('days');

  // ---- count, no time grouping: the Aggregate API gives exact numbers ----
  if (metric === 'count' && !group.time) {
    if (group.id === 'none') {
      const n = await attempt(() => reader.count(config.table, query), config.table);
      if (!n.ok) return fail(n.note, n.status);
      return { ...base, readAt: reader.readAt || ctx.generatedAt, data: { ...out, unit, items: [{ key: 'all', label: meta.label, value: n.value, n: n.value, query }], total: n.value } };
    }
    const g = await attempt(() => reader.groups(config.table, query, [group.field]), config.table);
    if (!g.ok) return fail(g.status === 'error' ? say(tm('{groupBy} is not available on {table}. {note}'), { groupBy: group.label, table: meta.label.toLowerCase(), note: g.note }) : g.note, g.status);
    const items = g.value
      .map((x) => {
        // A state with no label of its own is named by what it means (never by its stored number); `plain` says the word is the engine's.
        const key = x.keys[0];
        const state = group.field === 'state' && (key?.value || key?.display) ? stateName(key, config.table) : null;
        return { key: key?.value || '', label: state ? state.name : keyName(key, tm('(empty)')), ...(state?.plain ? { plain: true } : {}), value: x.count, n: x.count };
      })
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .map((x) => ({ ...x, query: itemQuery(query, group.field, x.key) }));
    return { ...base, readAt: reader.readAt || ctx.generatedAt, data: { ...out, unit, items: withOthers(items, MAX_ITEMS), total: items.reduce((n, x) => n + x.value, 0), hidden: Math.max(0, items.length - MAX_ITEMS), person: Boolean(group.person) } };
  }

  // ---- everything else reads a bounded number of rows and works them out here ----
  const rf = resolvedColumn(tableInfo);
  if (group.time?.field === 'resolved' || metric === 'avg_resolve_days') {
    if (!rf) return fail(tm('This ticket type has no resolved date to work from.'));
  }
  const openOnly = metric === 'avg_age_days' ? andQuery(query, 'active=true') : query;

  if (group.time) {
    const field = group.time.field === 'resolved' ? rf : 'opened_at';
    // The weeks drawn are the ones the report's own window touches ("opened in the last 7 days" is two weeks, not twelve): a week
    // before the window can only be empty because of the filter, and drawn as 0 it would look like a quiet week. (A ticket resolved
    // in a week was opened by then, so this holds for the resolved weeks too.) Without a window, the last 12 weeks.
    const windowDays = windowDaysOf(config.presets);
    const span = group.time.unit === 'week' ? (windowDays ? localWeeksCovering(now - windowDays * DAY, now, ctx.offsetMin) : 12) : windowDays && windowDays <= 30 ? windowDays : 30;
    const starts = bucketStarts({ now, unit: group.time.unit, count: span, offsetMin: ctx.offsetMin });
    const since = starts[0];
    const read = await attempt(
      () => reader.pages(config.table, andQuery(query, buildQuery([{ op: 'since', field, ms: since }], { orderBy: field, descending: true })), [field], { max: LIMITS.dateRowsMax }),
      config.table
    );
    if (!read.ok) return fail(read.note, read.status);
    if (read.value.capped) ctx.caps.push(capNote(config.table, read.value));
    const times = read.value.rows.map((r) => timeOf(raw(r[field]))).filter((x) => Number.isFinite(x));
    const counts = bucketCounts(times, starts, group.time.unit === 'week' ? 7 * DAY : DAY);
    const labels = bucketLabels(starts, ctx.offsetMin);
    const counted = counts.reduce((a, b) => a + b, 0);
    // A read that stopped at its limit (newest first) counted only part of the oldest buckets: they are marked, and the sum is not
    // called the total.
    const partial = partialBuckets(starts, times.length ? Math.min(...times) : NaN, read.value.capped);
    return {
      ...base,
      readAt: reader.readAt || ctx.generatedAt,
      data: {
        ...out,
        unit,
        series: { labels, values: counts, partial },
        items: labels.map((label, i) => ({ key: String(starts[i]), label, value: counts[i], n: counts[i] })),
        total: counted,
        ...(read.value.capped ? { basedOn: say(tm('{count} tickets (the first ones read; there are more)'), { count: counted }) } : {}),
        timeUnit: group.time.unit,
      },
    };
  }

  // Averages per group.
  const fields = [group.field, 'opened_at', ...(metric === 'avg_resolve_days' ? [rf] : [])].filter(Boolean);
  const where = metric === 'avg_resolve_days' ? andQuery(query, `${rf}ISNOTEMPTY`) : openOnly;
  const order = metric === 'avg_resolve_days' ? buildQuery([], { orderBy: rf, descending: true }) : buildQuery([], { orderBy: 'opened_at', descending: true });
  const read = await attempt(() => reader.pages(config.table, andQuery(where, order), fields, { max: LIMITS.dateRowsMax, displayValue: true }), config.table);
  if (!read.ok) return fail(read.note, read.status);
  if (read.value.capped) ctx.caps.push(capNote(config.table, read.value));
  const buckets = new Map();
  read.value.rows.forEach((r) => {
    const opened = timeOf(raw(r.opened_at));
    const end = metric === 'avg_resolve_days' ? timeOf(raw(r[rf])) : now;
    if (!Number.isFinite(opened) || !Number.isFinite(end) || end < opened) return;
    const key = group.id === 'none' ? 'all' : raw(r[group.field]);
    const entry = buckets.get(key) || { key, label: group.id === 'none' ? meta.label : disp(r[group.field]) || tm('(empty)'), days: [] };
    entry.days.push((end - opened) / DAY);
    buckets.set(key, entry);
  });
  // A bar opens the tickets its average was worked out from: the filter AND what the measure adds (only open ones, or only resolved).
  const items = [...buckets.values()]
    .map((b) => ({ key: b.key, label: b.label, value: Math.round(mean(b.days) * 10) / 10, n: b.days.length, query: group.id === 'none' ? where : itemQuery(where, group.field, b.key) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const allDays = [...buckets.values()].flatMap((b) => b.days);
  return {
    ...base,
    readAt: reader.readAt || ctx.generatedAt,
    data: { ...out, unit, items: items.slice(0, 40), total: allDays.length, overall: allDays.length ? Math.round(mean(allDays) * 10) / 10 : null, person: Boolean(group.person), basedOn: read.value.capped ? say(tm('{count} tickets (the first ones read; there are more)'), { count: allDays.length }) : say(tm('{count} tickets'), { count: allDays.length }) },
  };
}

export function builderTables(result) {
  const d = result.data;
  if (!d?.available) return [];
  const valueLabel = d.metric === 'count' ? t('Tickets') : d.metric === 'avg_resolve_days' ? t('Average days to resolve') : t('Average age (days)');
  return [
    {
      title: shown(result.title),
      columns: [{ key: 'label', label: d.groupBy === 'none' ? t('Measure') : shown(d.groupLabel), person: Boolean(d.person) }, { key: 'value', label: valueLabel }, ...(d.metric === 'count' ? [] : [{ key: 'n', label: t('Tickets counted') }])],
      // The engine's own words ("Others (3)", "(empty)") in the language of the panel; a value from the instance as it is.
      rows: d.items.map((i) => ({ ...i, label: i.others || i.plain ? shown(i.label) : placeholderName(i.label) })),
    },
  ];
}
