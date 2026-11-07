import { blankFormLink, linkFor, staysInOwnUi } from '../lib/snLinks.js';

// Opening another record from the panel. WHAT the address is lives in one place, src/lib/snLinks.js (the classic form, a Workspace's
// record route, a portal's ticket page, the article reader); this file is the thin wrappers the screens use, and WHERE it opens:
//   openUrl / openRecord / openNewRecord   in the tab the panel is attached to ("go work on this": My work, a blank form the person
//                                          asked for). If the address would take a Workspace or a portal tab to a classic page, it
//                                          opens in a new tab instead: that tab is never replaced.
//   openInNewTab / openRecordTab           in a new tab next to it ("look at this": a related ticket, an article, a duplicate; the
//                                          ticket being worked on, with anything typed on it and not saved, stays put)
// Only the instance the page is on is ever used as the target.

export { workspacePrefix } from '../lib/snLinks.js';

/** The address of a record as the agent opens it (an article: its reader; `intent: 'author'` its authoring form); '' when it cannot be built safely. */
export const recordUrl = (page, ref, opts) => linkFor(page, ref, { audience: 'agent', intent: opts?.intent });

/** The address of a blank form for a table on the classic UI. */
export const newRecordUrl = (page, table) => blankFormLink(page, table);

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
    // In front: the screens keep the last ServiceNow tab when the tab on show is another site, and a tab changed in the background
    // would look like nothing happened.
    chrome.tabs.update(page.tabId, { url, active: true });
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

/**
 * "Go work on this": in the tab the panel is attached to, unless that would replace a Workspace or portal tab with a classic page
 * (a list, a blank form, a ticket from a Workspace home page): then in a new tab next to it. Returns true when it was started.
 */
export const openWork = (page, url) => (staysInOwnUi(page, url) ? openUrl(page, url) : openInNewTab(page, url));

export const openRecord = (page, ref) => openWork(page, recordUrl(page, ref));
export const openRecordTab = (page, ref) => openInNewTab(page, recordUrl(page, ref));
export const openNewRecord = (page, table) => openWork(page, newRecordUrl(page, table));

/** Does a blank form for this table open in a new tab from this page? (A Workspace or portal tab: yes.) For the line that says where it opened. */
export const newRecordOpensInNewTab = (page, table) => {
  const url = newRecordUrl(page, table);
  return Boolean(url) && !staysInOwnUi(page, url);
};
