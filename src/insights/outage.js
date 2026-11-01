// N29, the outage spotter: other OPEN tickets on the same configuration item or business service, opened in the last few hours.
// When enough of them arrive close together it is probably one outage, not one person's problem. Pure: works on the answer of the
// open-duplicates check (src/context/similar.js findOpenDuplicates), which reads by the record's own CI and service ids.

import { isolate, t, tn } from '../i18n/index.js';

export const OUTAGE_RULE = Object.freeze({ hours: 2, threshold: 3 });

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** Which of the two the tickets share most: the CI's name, else the service's, from the ticket's own fields. */
function targetOf(hits, fields) {
  const ci = text(fields?.cmdb_ci);
  const service = text(fields?.business_service);
  const byCi = hits.filter((h) => Array.isArray(h.same) && h.same.includes('cmdb_ci')).length;
  const byService = hits.filter((h) => Array.isArray(h.same) && h.same.includes('business_service')).length;
  if (ci && (byCi >= byService || !service)) return ci;
  if (service) return service;
  return ci || t('the same service');
}

/**
 * @param {{ hits?: object[], windowHours?: number, access?: object[] }} answer the open-duplicates answer
 * @param {object} pack the ticket (its CI and service names)
 * @param {{ hours?: number, threshold?: number }} [rule]
 * @returns {{ readable: boolean, count: number, total: number, hours: number, windowHours: number, over: boolean, target: string,
 *   recent: object[], hits: object[], note: string, line: string }}
 *   count: other open tickets in the last `hours`; total: in the whole window; over: count reached the threshold
 */
export function outageSignal(answer, pack, { hours = OUTAGE_RULE.hours, threshold = OUTAGE_RULE.threshold } = {}) {
  const hits = (Array.isArray(answer?.hits) ? answer.hits : []).filter((h) => h && typeof h === 'object' && text(h.number));
  const access = Array.isArray(answer?.access) ? answer.access : [];
  const readable = access.some((a) => a?.status === 'ok' || a?.status === 'empty');
  const skipped = access.find((a) => a?.status === 'skipped');
  const recent = hits.filter((h) => Number.isFinite(h.hoursAgo) && h.hoursAgo <= hours);
  const target = targetOf(hits, pack?.fields);
  const count = recent.length;
  const over = readable && count >= threshold;
  const windowHours = Number.isFinite(answer?.windowHours) ? answer.windowHours : 24;
  const inHours = (n) => tn(n, '{n} h', '{n} h');
  let line = '';
  if (over) line = tn(count, '{n} other open ticket on {target} in the last {hours}', '{n} other open tickets on {target} in the last {hours}', { target: isolate(target), hours: inHours(hours) });
  else if (readable && hits.length) line = tn(hits.length, '{n} other open ticket on {target} in the last {hours}', '{n} other open tickets on {target} in the last {hours}', { target: isolate(target), hours: inHours(windowHours) });
  else if (readable) line = t('No other open tickets on {target} in the last {hours}', { target: isolate(target), hours: inHours(windowHours) });
  return { readable, count, total: hits.length, hours, windowHours, over, target, recent, hits, note: skipped ? text(skipped.note) : '', line };
}
