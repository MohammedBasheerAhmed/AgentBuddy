import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

// Opening another record from the panel, in the kind of page the agent is already using: the classic UI via nav_to.do, a Workspace
// via its own record route (/now/sow/record/incident/<sys_id>), a portal (Service Portal, Employee Center, customer service portal,
// HR portal) via the portal's own ticket page. Only the instance the page is on is ever used as the target.
//
// Two ways to open it:
//   openUrl / openRecord          in the tab the panel is attached to (My work: picking a ticket to work on)
//   openInNewTab / openRecordTab  in a new tab next to it (the Ticket screen: a look at a related ticket never replaces the one
//                                 being worked on, with its unsaved typing)

const PORTAL_SEGMENT_RE = /^[a-z][a-z0-9_-]{0,30}$/i;
// ticket, standard_ticket, csm_ticket, hr_ticket: the page a portal shows a ticket on.
const TICKET_PAGE_RE = /^[a-z0-9_]{0,30}ticket$/;
// The part of a Workspace address before "/record/": /now/sow, /now/cwf/agent, /now/workspace/agent. Up to three plain segments.
const WORKSPACE_PREFIX_RE = /^(\/now(?:\/[a-z0-9_-]{1,40}){1,3})\/record\/[a-z][a-z0-9_]*\/[0-9a-f]{32}(?:[/?#]|$)/i;
// Records a Workspace's record route is not used for (an article has its own reader; see docs/live-questions/insights.md).
const CLASSIC_ONLY = new Set(['kb_knowledge']);

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

/** The Workspace the page is in ("/now/sow"), read from the address of the record on screen; '' when it cannot be told. */
export function workspacePrefix(page) {
  try {
    const m = WORKSPACE_PREFIX_RE.exec(new URL(page.href).pathname);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

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
  // A Workspace opens a record on its own route, so the agent stays in the Workspace. Away from a record page the Workspace cannot
  // be told for sure, and the classic address works everywhere.
  const prefix = page.surface === 'workspace' && !CLASSIC_ONLY.has(table) ? workspacePrefix(page) : '';
  if (prefix) return `${origin}${prefix}/record/${table}/${sysId.toLowerCase()}`;
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

const sameInstance = (page, url) => {
  try {
    return new URL(url).origin === new URL(page.href).origin;
  } catch {
    return false;
  }
};

export function openUrl(page, url) {
  if (!url) return false;
  try {
    // Never navigate anywhere but the instance the panel is working on.
    if (!sameInstance(page, url)) return false;
    chrome.tabs.update(page.tabId, { url });
    return true;
  } catch {
    return false; // the tab went away
  }
}

/**
 * Open an address of the same instance in a NEW tab, right after the ticket's tab and in front, so the ticket being worked on (and
 * anything typed on it and not saved) stays where it is. Returns true when it was started.
 */
export function openInNewTab(page, url) {
  if (!url || !sameInstance(page, url)) return false;
  try {
    const create = (props) => Promise.resolve(chrome.tabs.create({ url, active: true, ...props })).catch(() => chrome.tabs.create({ url, active: true }));
    const placed = typeof chrome.tabs.get === 'function' && Number.isInteger(page.tabId) ? Promise.resolve(chrome.tabs.get(page.tabId)) : Promise.resolve(null);
    placed
      .then((tab) => create(tab && Number.isInteger(tab.index) ? { index: tab.index + 1, openerTabId: page.tabId, ...(Number.isInteger(tab.windowId) ? { windowId: tab.windowId } : {}) } : {}))
      .catch(() => create({}))
      .catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export const openRecord = (page, ref) => openUrl(page, recordUrl(page, ref));
export const openRecordTab = (page, ref) => openInNewTab(page, recordUrl(page, ref));
export const openNewRecord = (page, table) => openUrl(page, newRecordUrl(page, table));
