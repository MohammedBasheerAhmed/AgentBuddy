// What "My week" and the weekly report SHOW, as one plain model per view: the panel, the PDF page, the text a person copies and the CSV are
// all drawn from it, so they can never disagree (round 5, docs/round5.md). Pure given the weekly result (src/reports/weekly/read.js) and the
// language: no React, no browser. Every number in it was read; a number that could not be read honestly is not in it (it is in `missing`).
//
//   { kind: 'team' | 'mine', title, period, scope, readAt, partial, comparedWith,
//     tiles: [{ key, value, label, change: { text, tone } | null, sub, title }],
//     areas: [{ name, count }], decisions: [{ id, text, parts }], oldest: [{ number, title, age, sla }],
//     missing: [{ label, why }], paragraph }
import { t, tn, isolate, isRtl } from '../../../i18n/index.js';
import { shown } from '../../../reports/shown.js';
import { change, durationTolerance } from '../../../reports/weekly/figures.js';
import { span } from '../format.js';

// ---- Dates and periods ------------------------------------------------------------------------------------------------------------

// The digits stay 0-9 in Arabic, as in ServiceNow itself.
const locale = () => (isRtl() ? 'ar-u-nu-latn' : undefined);
const utcDay = ({ y, m, d }) => new Date(Date.UTC(y, m - 1, d));
const dayFormat = (options) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options });

/** "9 to 15 Nov" (the days of a whole week, in the person's language). */
export function rangeText(first, last) {
  if (!first || !last) return '';
  const a = utcDay(first);
  const b = utcDay(last);
  const f = dayFormat({ day: 'numeric', month: 'short' });
  if (typeof f.formatRange === 'function') {
    try {
      return f.formatRange(a, b);
    } catch {
      // (an old engine: fall through to the two dates)
    }
  }
  return `${f.format(a)} – ${f.format(b)}`;
}

/** "Mon 16 Nov". */
export const dayText = (day) => (day ? dayFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(utcDay(day)) : '');

/** The week as the person reads it: "9 to 15 Nov", or "Mon 16 Nov to today". */
export function periodText(window) {
  if (!window) return '';
  return window.partial ? t('{date} to today', { date: dayText(window.first) }) : rangeText(window.first, window.last);
}

/** What a change is against: the same days of last week while this week is still going, else the week before. */
export const comparedWith = (partial) => (partial ? t('the same days last week') : t('the week before'));
/** The same, as the phrase My week uses ("last week" is the whole of the week before the one being looked at). */
const against = (which, partial) => (partial ? t('the same days last week') : which === 'last' ? t('the week before') : t('last week'));

// ---- Change lines -----------------------------------------------------------------------------------------------------------------

const line = (text, tone) => ({ text, tone });
// A sign and a number keep their order in a right-to-left sentence: '+9' must not become '9+'.
const LRM = String.fromCharCode(0x200e);
const ltr = (text) => `${LRM}${text}${LRM}`;

/** "+3 on last week" / "-2" for a count; null when there is nothing to compare. `long`: with what it is compared with. */
export function countChange(now, before, { goodWhen = null, long = false, period = '' } = {}) {
  const c = change(now, before, { goodWhen });
  if (!c) return null;
  if (c.dir === 'same') return line(long ? t('Same as {period}', { period }) : t('same'), 'neutral');
  const n = Math.abs(c.delta);
  if (long) return line(c.dir === 'up' ? t('+{n} on {period}', { n, period }) : t('-{n} on {period}', { n, period }), c.tone);
  return line(ltr(c.dir === 'up' ? `+${n}` : `-${n}`), c.tone);
}

/** "3 more than last week" / "1 fewer than last week": for the reopened tickets of My week. */
export function moreFewer(now, before, { period }) {
  const c = change(now, before, { goodWhen: 'down' });
  if (!c) return null;
  if (c.dir === 'same') return line(t('Same as {period}', { period }), 'neutral');
  const n = Math.abs(c.delta);
  return line(c.dir === 'up' ? t('{n} more than {period}', { n, period }) : t('{n} fewer than {period}', { n, period }), c.tone);
}

/** "-3 pts" (short) or "3 points better than last week" for a share in percent. */
export function pointsChange(now, before, { long = false, period = '' } = {}) {
  const c = change(now, before, { goodWhen: 'up' });
  if (!c) return null;
  if (c.dir === 'same') return line(long ? t('Same as {period}', { period }) : t('same'), 'neutral');
  const n = Math.abs(c.delta);
  if (long) return line(c.dir === 'up' ? t('{n} points better than {period}', { n, period }) : t('{n} points worse than {period}', { n, period }), c.tone);
  return line(ltr(t('{n} pts', { n: c.dir === 'up' ? `+${n}` : `-${n}` })), c.tone);
}

/** "8 min faster than last week" for a time where shorter is better. */
export function timeChange(nowMs, beforeMs, { period }) {
  const c = change(nowMs, beforeMs, { goodWhen: 'down', tolerance: durationTolerance(beforeMs) });
  if (!c) return null;
  if (c.dir === 'same') return line(t('Same as {period}', { period }), 'neutral');
  const s = span(Math.abs(c.delta));
  return line(c.dir === 'down' ? t('{span} faster than {period}', { span: s, period }) : t('{span} slower than {period}', { span: s, period }), c.tone);
}

// ---- Needs a decision -------------------------------------------------------------------------------------------------------------

/** The words of one decision, from its numbers, as plain text (the PDF, the copied text and the CSV; the screen draws the same sentences with the key part in bold). */
export function decisionText(d) {
  if (d.id === 'cause') {
    if (d.name) return t('Open a problem for {name}: {count} tickets, one likely cause.', { name: isolate(d.name), count: d.count });
    return t('Open a problem: {count} tickets share one likely cause.', { count: d.count });
  }
  if (d.id === 'load') return t('Two people hold {percent}% of the open tickets. Rebalance the work.', { percent: d.percent });
  return t('{ratio} closes had no fix note. Ask for one at close.', { ratio: t('{without} of {closed}', { without: d.without, closed: d.closed }) });
}
// ---- The tiles --------------------------------------------------------------------------------------------------------------------

const tile = (key, value, label, changeLine = null, extra = {}) => ({ key, value, label, change: changeLine, sub: '', title: '', ...extra });

const LABELS = {
  cameIn: () => t('Came in'),
  closed: () => t('Closed'),
  backlog: () => t('Backlog'),
  sla: () => t('SLA kept'),
  reopened: () => t('Reopened'),
};

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** The weekly report's five numbers, in the order of the board; a number that was not read is not there. Pure. */
export function teamTiles(data) {
  const n = data.numbers || {};
  const partial = Boolean(data.window?.partial);
  const out = [];
  if (n.cameIn) out.push(tile('cameIn', String(n.cameIn.value), LABELS.cameIn(), countChange(n.cameIn.value, n.cameIn.prev)));
  if (n.closed) out.push(tile('closed', String(n.closed.value), LABELS.closed(), countChange(n.closed.value, n.closed.prev, { goodWhen: 'up' })));
  if (n.backlog) {
    const v = n.backlog.value;
    out.push(tile('backlog', ltr(signed(v)), LABELS.backlog(), v > 0 ? line(t('worse'), 'bad') : v < 0 ? line(t('better'), 'good') : line(t('no change'), 'neutral'), { title: t('Came in minus closed') }));
  }
  if (n.sla) out.push(tile('sla', `${n.sla.percent}%`, LABELS.sla(), pointsChange(n.sla.percent, n.sla.prev), { title: t('{kept} of {total} SLAs that came due were kept', { kept: n.sla.kept, total: n.sla.total }) }));
  if (n.reopened) {
    const types = (n.reopened.types || []).map((x) => shown(x).toLowerCase()).join(', ');
    // (a week that is still going is compared with the same days of last week: those tickets have had longer to come back, so no change is drawn)
    out.push(tile('reopened', String(n.reopened.value), LABELS.reopened(), partial ? null : countChange(n.reopened.value, n.reopened.prev, { goodWhen: 'down' }), { title: t('{n} of {of} closed {types} came back', { n: n.reopened.value, of: n.reopened.of, types }) }));
  }
  return out;
}

/** "My week"'s five numbers. Pure. */
export function mineTiles(data) {
  const now = data.now || {};
  const before = data.before || {};
  const w = data.window || {};
  const period = against(w.which, w.partial);
  const out = [];
  if (now.closed !== null && now.closed !== undefined) out.push(tile('closed', String(now.closed), t('Tickets closed'), countChange(now.closed, before.closed ?? null, { goodWhen: 'up', long: true, period })));
  if (now.reply) out.push(tile('reply', span(now.reply.meanMs), t('Average first reply'), timeChange(now.reply.meanMs, before.reply?.meanMs ?? NaN, { period }), { title: t('From {n} tickets', { n: now.reply.n }) }));
  if (now.typicalMs !== null && now.typicalMs !== undefined) out.push(tile('typical', span(now.typicalMs), t('Typical time to resolve'), timeChange(now.typicalMs, before.typicalMs ?? NaN, { period })));
  if (now.reopened) out.push(tile('reopened', t('{n} of {of}', { n: now.reopened.n, of: now.reopened.of }), t('Reopened after closing'), w.partial ? null : moreFewer(now.reopened.n, before.reopened?.n ?? NaN, { period }), { title: now.reopened.types?.length ? t('Counted for {types}', { types: now.reopened.types.map((x) => shown(x).toLowerCase()).join(', ') }) : '' }));
  if (now.sla) out.push(tile('sla', `${now.sla.percent}%`, t('Answered inside the SLA'), pointsChange(now.sla.percent, before.sla?.percent ?? NaN, { long: true, period }), { sub: t('{kept} of {total} closed tickets that had an SLA', { kept: now.sla.kept, total: now.sla.total }), wide: true }));
  return out;
}

const MISSING_LABEL = {
  cameIn: () => t('Came in'),
  closed: () => t('Closed'),
  backlog: () => t('Backlog'),
  sla: () => t('SLA kept'),
  reopened: () => t('Reopened'),
  typical: () => t('Typical time to resolve'),
  reply: () => t('Average first reply'),
};
const mineMissing = { sla: () => t('Answered inside the SLA'), reopened: () => t('Reopened after closing'), closed: () => t('Tickets closed') };

/** The numbers that were left out, each with the reason (in the panel's language): [{ label, why }]. */
export function missingList(data, kind) {
  return (data.leftOut || []).map(({ key, why }) => ({ label: (kind === 'mine' && mineMissing[key] ? mineMissing[key] : MISSING_LABEL[key] || (() => key))(), why: shown(why) }));
}

// ---- The models -------------------------------------------------------------------------------------------------------------------

const ageText = (days) => (days <= 0 ? t('today') : t('{n} d', { n: days }));
const slaText = (sla) => (sla === 'breached' ? t('Breached') : sla === 'at-risk' ? t('At risk') : sla === 'ok' ? t('On track') : sla === 'none' ? t('No SLA') : t('Not available to you'));

const areaName = (a) => (a.plain ? shown(a.name) : a.name);

/**
 * @param {object} result the weekly result (a 'team' read)
 * @param {{ paragraph?: string, scope?: string }} options the AI paragraph when there is one, the scope as the person reads it
 */
export function teamModel(result, { paragraph = '', scope = '' } = {}) {
  const data = result.data;
  return {
    kind: 'team',
    title: t('Weekly report'),
    period: periodText(data.window),
    scope,
    readAt: result.readAt,
    partial: Boolean(data.window?.partial),
    comparedWith: comparedWith(data.window?.partial),
    tiles: teamTiles(data),
    areas: (data.areas || []).map((a) => ({ name: areaName(a), count: a.count })),
    decisions: (data.decisions || []).map((d) => ({ id: d.id, text: decisionText(d), source: d })),
    oldest: (data.oldest || []).map((o) => ({ number: o.number, title: o.title, age: ageText(o.ageDays), sla: slaText(o.sla) })),
    types: (data.types || []).map((x) => shown(x)),
    missing: missingList(data, 'team'),
    paragraph: paragraph || '',
  };
}

/** @param {object} result the weekly result (a 'mine' read) */
export function mineModel(result, { paragraph = '' } = {}) {
  const data = result.data;
  return {
    kind: 'mine',
    title: t('My week'),
    period: periodText(data.window),
    scope: '',
    readAt: result.readAt,
    partial: Boolean(data.window?.partial),
    comparedWith: against(data.window?.which, data.window?.partial),
    tiles: mineTiles(data),
    areas: (data.now?.areas || []).map((a) => ({ name: areaName(a), count: a.count })),
    decisions: [],
    oldest: [],
    types: (data.types || []).map((x) => shown(x)),
    missing: missingList(data, 'mine'),
    paragraph: paragraph || '',
  };
}

// ---- Text and files ---------------------------------------------------------------------------------------------------------------

const changeSuffix = (x) => (x.change ? ` (${x.change.text})` : '');

/** Plain text for an email or a message: the title and period, the paragraph, one line per number, the areas, the decisions. */
export function modelToText(model) {
  const lines = [`${model.title}: ${[model.period, model.scope].filter(Boolean).join(', ')}`, ''];
  if (model.paragraph) lines.push(model.paragraph, '');
  for (const x of model.tiles) lines.push(`${x.label}: ${x.value}${x.sub ? ` ${x.sub}` : ''}${changeSuffix(x)}`);
  // (the short changes of the weekly report, "+9", say nothing without what they are against)
  if (model.tiles.some((x) => x.change) && model.kind === 'team') lines.push(t('Compared with {period}.', { period: model.comparedWith }));
  if (model.areas.length) lines.push('', t('Where the week went:'), ...model.areas.map((a) => `- ${a.name}: ${a.count}`));
  if (model.decisions.length) lines.push('', t('Needs a decision:'), ...model.decisions.map((d, i) => `${i + 1}. ${d.text}`));
  if (model.missing.length) lines.push('', t('Not shown, because it could not be read honestly: {labels}.', { labels: model.missing.map((m) => m.label).join(', ') }));
  return lines.join('\n');
}

/** The tables of the CSV, in the shape src/reports/exportTables.js takes. */
export function modelToTables(model) {
  const tables = [
    {
      title: `${model.title} (${[model.period, model.scope].filter(Boolean).join(', ')})`,
      columns: [
        { key: 'measure', label: t('Measure') },
        { key: 'value', label: t('Value') },
        { key: 'change', label: t('Compared with {period}', { period: model.comparedWith }) },
      ],
      rows: model.tiles.map((x) => ({ measure: x.label, value: x.value, change: x.change?.text || '' })),
    },
  ];
  if (model.areas.length) tables.push({ title: t('Closed by area'), columns: [{ key: 'name', label: t('Area') }, { key: 'count', label: t('Tickets') }], rows: model.areas });
  if (model.decisions.length) tables.push({ title: t('Needs a decision'), columns: [{ key: 'text', label: t('Decision') }], rows: model.decisions.map((d) => ({ text: d.text })) });
  if (model.oldest.length) {
    tables.push({
      title: t('Oldest open tickets'),
      columns: [{ key: 'number', label: t('Ticket') }, { key: 'title', label: t('Short description') }, { key: 'age', label: t('Age') }, { key: 'sla', label: t('SLA') }],
      rows: model.oldest,
    });
  }
  return tables;
}

/** How many tickets: for the screen reader line under a bar. */
export const ticketsText = (n) => tn(n, '{n} ticket', '{n} tickets');

// ---- Small texts ---------------------------------------------------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0');

/** "Numbers read from ServiceNow on 16 Nov at 15:36. Nothing was changed." (the foot of the PDF). */
export function readFooter(readAt) {
  if (!Number.isFinite(readAt)) return t('Numbers read from ServiceNow. Nothing was changed.');
  const d = new Date(readAt);
  const date = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(d);
  return t('Numbers read from ServiceNow on {date} at {time}. Nothing was changed.', { date, time: `${two(d.getHours())}:${two(d.getMinutes())}` });
}

/** The site's short name for the top of the PDF ("dev364920"), or ''. */
export function siteName(page) {
  try {
    return new URL(page?.href || page?.origin || '').hostname.replace(/\.(service-now|servicenow)\.com$/i, '');
  } catch {
    return '';
  }
}

/** What could not be read, said once each, in the panel's language: the engine's access and general notes. */
export function readNotes(result) {
  const all = [...(result?.access || []).map((a) => a.note), ...(result?.notes || []), ...(result?.caps || []).map((c) => c.note), result?.scope?.note].filter(Boolean);
  return [...new Set(all.map((n) => shown(n)))];
}
