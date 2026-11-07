// Opening a ServiceNow list or record from a report. Always the instance the page is on (same origin), in the tab the panel is
// attached to: a drill-down is "go work on this". If that would replace a Workspace or portal tab with a classic page (a list is
// always a classic page), it opens in a new tab next to it instead. On the full-page dashboard the ServiceNow tab is brought to the
// front, because the dashboard is a tab of its own and must stay open.
import { listLink, staysInOwnUi } from '../../lib/snLinks.js';
import { openInNewTab, recordUrl } from '../openRecord.js';

/** The address of a list on the classic UI, or '' when it cannot be built safely (src/lib/snLinks.js, shared with My work). */
export const listUrl = (page, table, query) => listLink(page, table, query);

/** Navigate the page's tab to `url` when it is on the same instance (a new tab next to it when that would replace a Workspace or portal). Returns true when it was started. */
export function openInPageTab(page, url, { focus = false } = {}) {
  if (!url) return false;
  try {
    if (new URL(url).origin !== new URL(page.href).origin) return false;
    if (staysInOwnUi(page, url)) chrome.tabs.update(page.tabId, focus ? { url, active: true } : { url });
    else if (!openInNewTab(page, url)) return false;
    if (focus && page.windowId && chrome.windows?.update) chrome.windows.update(page.windowId, { focused: true });
    return true;
  } catch {
    return false; // the tab went away
  }
}

export const openList = (page, table, query, options) => openInPageTab(page, listUrl(page, table, query), options);
export const openTicket = (page, ref, options) => openInPageTab(page, recordUrl(page, ref), options);
