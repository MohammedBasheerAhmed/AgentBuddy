import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

// Opening another record in the tab the panel is attached to. Records open in the SAME tab, in the kind of page the agent
// is already using: classic UI via nav_to.do, a portal page (Service Portal, Employee Center, customer service portal, HR portal)
// via the portal's own ticket page. Only the instance the page is on is ever used as the target.

const PORTAL_SEGMENT_RE = /^[a-z][a-z0-9_-]{0,30}$/i;
// ticket, standard_ticket, csm_ticket, hr_ticket: the page a portal shows a ticket on.
const TICKET_PAGE_RE = /^[a-z0-9_]{0,30}ticket$/;

// Which portal the page is on: the content script's answer (page.portal.base), else the first segment of the address, else /sp.
const portalBase = (page) => {
  const given = page.portal?.base;
  if (typeof given === 'string' && given.startsWith('/') && PORTAL_SEGMENT_RE.test(given.slice(1))) return given.toLowerCase();
  try {
    const first = new URL(page.href).pathname.split('/').filter(Boolean)[0] || '';
    return PORTAL_SEGMENT_RE.test(first) ? `/${first.toLowerCase()}` : '/sp';
  } catch {
    return '/sp';
  }
};

// Another ticket opens on the same kind of page as this one (a customer service portal has its own csm_ticket page), and on the
// shared `ticket` page when the agent is not on a ticket now. An article has its own page.
const portalPageId = (page, table) => {
  if (table === 'kb_knowledge') return 'kb_article';
  const current = typeof page.portal?.pageId === 'string' ? page.portal.pageId.toLowerCase() : '';
  return TICKET_PAGE_RE.test(current) ? current : 'ticket';
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
  if (page.surface === 'portal') return `${origin}${portalBase(page)}?id=${portalPageId(page, table)}&table=${table}&sys_id=${sysId.toLowerCase()}`;
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
