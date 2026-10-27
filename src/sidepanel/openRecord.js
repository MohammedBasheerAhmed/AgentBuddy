import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

// Opening another record in the tab the panel is attached to. Records open in the SAME tab, in the kind of page the agent
// is already using: classic UI via nav_to.do, a portal page (Service Portal, Employee Center, customer service portal) via
// the portal's own ticket page. Only the instance the page is on is ever used as the target.

const portalBase = (href) => {
  try {
    const first = new URL(href).pathname.split('/').filter(Boolean)[0] || 'sp';
    return /^[a-z][a-z0-9_-]{0,30}$/i.test(first) ? `/${first}` : '/sp';
  } catch {
    return '/sp';
  }
};

/** The address of a record, as the page the panel is attached to would open it; '' when it cannot be built safely. */
export function recordUrl(page, { table, sysId }) {
  if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) return '';
  let origin;
  try {
    origin = new URL(page.href).origin;
  } catch {
    return '';
  }
  if (page.surface === 'portal') {
    const id = table === 'kb_knowledge' ? 'kb_article' : 'ticket';
    return `${origin}${portalBase(page.href)}?id=${id}&table=${table}&sys_id=${sysId}`;
  }
  return `${origin}/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=${sysId}`)}`;
}

/** The address of a blank form for a table on the classic UI. */
export function newRecordUrl(page, table) {
  if (!TABLE_RE.test(table || '')) return '';
  try {
    return `${new URL(page.href).origin}/nav_to.do?uri=${encodeURIComponent(`${table}.do?sys_id=-1`)}`;
  } catch {
    return '';
  }
}

export function openUrl(page, url) {
  if (!url) return false;
  try {
    // Never navigate anywhere but the instance the panel is working on.
    if (new URL(url).origin !== new URL(page.href).origin) return false;
    chrome.tabs.update(page.tabId, { url });
    return true;
  } catch {
    return false; // the tab went away
  }
}

export const openRecord = (page, ref) => openUrl(page, recordUrl(page, ref));
export const openNewRecord = (page, table) => openUrl(page, newRecordUrl(page, table));
