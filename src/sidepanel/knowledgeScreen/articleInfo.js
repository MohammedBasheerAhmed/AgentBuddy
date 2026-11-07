// Small pure helpers for the Knowledge screen: how fresh an article is, in words; and the rows the duplicate groups and the
// knowledge-gap topics are exported as (CSV, through src/lib/export.js toCsv). The CSV files keep their English column names and
// values: they are data for a spreadsheet, not text of the panel. (The address of an article, to open or to copy for a customer, is
// src/lib/snLinks.js.)
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
