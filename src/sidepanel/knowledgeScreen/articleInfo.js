// Small pure helpers for the Knowledge screen: how fresh an article is, in words; the link to share an article with a customer; and
// the rows the duplicate groups and the knowledge-gap topics are exported as (CSV, through src/lib/export.js toCsv). The CSV files keep
// their English column names and values: they are data for a spreadsheet, not text of the panel.
import { t, tn } from '../../i18n/index.js';

/** "3 days", "5 weeks", "8 months", "2 years" for an age in days (>= 1). */
export function ageText(days) {
  const d = Math.max(1, Math.floor(days));
  if (d < 14) return tn(d, '{n} day', '{n} days');
  if (d < 60) return tn(Math.floor(d / 7), '{n} week', '{n} weeks');
  if (d < 365) return tn(Math.floor(d / 30), '{n} month', '{n} months');
  return tn(Math.floor(d / 365), '{n} year', '{n} years');
}

/**
 * How fresh an article is.
 * @param {{ ageDays?: number|null, expiresInDays?: number|null }} hit days since its last change, days until its "valid to" date
 * @returns {{ level: 'fresh' | 'aging' | 'stale' | 'expiring' | 'unknown', text: string }}
 *   expiring: valid for 30 days or less; stale: not changed for more than a year; aging: more than six months
 */
export function freshnessOf({ ageDays = null, expiresInDays = null } = {}) {
  if (Number.isFinite(expiresInDays) && expiresInDays <= 30) {
    return { level: 'expiring', text: expiresInDays <= 0 ? t('Expires today') : tn(expiresInDays, 'Expires in {n} day', 'Expires in {n} days') };
  }
  if (!Number.isFinite(ageDays) || ageDays < 0) return { level: 'unknown', text: '' };
  if (ageDays < 1) return { level: 'fresh', text: t('Updated today') };
  if (ageDays > 365) return { level: 'stale', text: t('Not updated for {age}', { age: ageText(ageDays) }) };
  return { level: ageDays > 180 ? 'aging' : 'fresh', text: t('Updated {age} ago', { age: ageText(ageDays) }) };
}

const PORTAL_SEGMENT_RE = /^\/[a-z][a-z0-9_-]{0,30}$/i;
const NUMBER_RE = /^[A-Za-z]{2,8}\d{4,12}$/;
const SYS_ID_RE = /^[0-9a-f]{32}$/i;

/**
 * The address to share an article with a customer: by its number, which stays the same when a new version is published (a sys_id
 * does not). On a portal page, the portal's article page; elsewhere the instance's article viewer (kb_view.do), which also shows the
 * article to people who only use the portal. Only the instance the panel works on; '' when no address can be built safely.
 * @param {{ href: string, surface?: string, portal?: { base?: string } | null }} page
 * @param {{ number?: string, sysId?: string }} article
 */
export function articleShareUrl(page, { number = '', sysId = '' } = {}) {
  let origin = '';
  try {
    origin = new URL(page?.href || '').origin;
  } catch {
    return '';
  }
  if (!/^https:\/\//.test(origin)) return '';
  const byNumber = NUMBER_RE.test(number) ? `sysparm_article=${number.toUpperCase()}` : '';
  const id = SYS_ID_RE.test(sysId) ? sysId.toLowerCase() : '';
  if (page?.surface === 'portal') {
    const base = PORTAL_SEGMENT_RE.test(page?.portal?.base || '') ? page.portal.base.toLowerCase() : '/sp';
    if (byNumber) return `${origin}${base}?id=kb_article&${byNumber}`;
    return id ? `${origin}${base}?id=kb_article&sys_id=${id}` : '';
  }
  if (byNumber) return `${origin}/kb_view.do?${byNumber}`;
  return id ? `${origin}/kb_view.do?sys_kb_id=${id}` : '';
}

// ---- Exports ------------------------------------------------------------------------------------------------------------------

export const DUPLICATE_COLUMNS = Object.freeze(['Group', 'Number', 'Title', 'Knowledge base', 'Category', 'Views', 'Last changed', 'Suggested to keep']);

/** One row per article of every group ("Group" is 1, 2, 3 ... in the order shown). Titles, counts and dates only. */
export function duplicateRows(clusters) {
  const rows = [];
  (Array.isArray(clusters) ? clusters : []).forEach((c, i) => {
    for (const a of Array.isArray(c?.articles) ? c.articles : []) {
      rows.push({
        Group: String(i + 1),
        Number: a.number || '',
        Title: a.title || '',
        'Knowledge base': a.knowledgeBase || '',
        Category: a.category || '',
        Views: String(Number(a.views) || 0),
        'Last changed': a.updated || '',
        'Suggested to keep': c.keep?.sysId && c.keep.sysId === a.sysId ? 'yes' : '',
      });
    }
  });
  return rows;
}

export const TOPIC_COLUMNS = Object.freeze(['Topic', 'Tickets', 'With a written fix', 'Category', 'Configuration item', 'Example tickets']);

/** One row per topic. The example tickets by number only: a ticket title can name a person. */
export function topicRows(clusters) {
  return (Array.isArray(clusters) ? clusters : []).map((c) => ({
    Topic: c.label || '',
    Tickets: String(Number(c.count) || 0),
    'With a written fix': String(Number(c.withFix) || 0),
    Category: c.category || '',
    'Configuration item': c.ci || '',
    'Example tickets': (Array.isArray(c.examples) ? c.examples : []).map((e) => e.number).filter(Boolean).join(' '),
  }));
}

/** "duplicate-articles-2026-10-30.csv" */
export const exportFileName = (what, now = Date.now()) => `${what}-${new Date(now).toISOString().slice(0, 10)}.csv`;
