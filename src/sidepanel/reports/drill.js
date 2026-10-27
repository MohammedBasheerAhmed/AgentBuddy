// Opening a ServiceNow list or record from a report. Always the instance the page is on (same origin), always in the tab the
// panel is attached to. On the full-page dashboard the ServiceNow tab is brought to the front, because the dashboard is a
// tab of its own and must stay open.
import { TABLE_RE } from '../../context/util.js';
import { recordUrl } from '../openRecord.js';

const MAX_QUERY = 6000;

/** The address of a list on the classic UI, or '' when it cannot be built safely. */
export function listUrl(page, table, query) {
  if (!TABLE_RE.test(table || '')) return '';
  const text = String(query || '');
  if (text.length > MAX_QUERY) return '';
  let origin;
  try {
    origin = new URL(page.href).origin;
  } catch {
    return '';
  }
  const inner = `${table}_list.do?sysparm_query=${encodeURIComponent(text)}`;
  return `${origin}/nav_to.do?uri=${encodeURIComponent(inner)}`;
}

/** Navigate the page's tab to `url` when it is on the same instance. Returns true when it was started. */
export function openInPageTab(page, url, { focus = false } = {}) {
  if (!url) return false;
  try {
    if (new URL(url).origin !== new URL(page.href).origin) return false;
    chrome.tabs.update(page.tabId, focus ? { url, active: true } : { url });
    if (focus && page.windowId && chrome.windows?.update) chrome.windows.update(page.windowId, { focused: true });
    return true;
  } catch {
    return false; // the tab went away
  }
}

export const openList = (page, table, query, options) => openInPageTab(page, listUrl(page, table, query), options);
export const openTicket = (page, ref, options) => openInPageTab(page, recordUrl(page, ref), options);
