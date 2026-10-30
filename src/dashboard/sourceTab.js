// The full-page dashboard reads through ONE ServiceNow tab, named in its address (dashboard.html?tab=<id>). Before it shows
// anything it checks that the tab still exists and that Agent Buddy's content script answers there (so the site is enabled).
// The browser calls are injected so this is tested without a browser (tests/reports-dashboard-page.test.js).
import { MSG } from '../lib/messages.js';
import { surfaceOf } from '../context/surface.js';

/** The tab id from "?tab=123"; 0 when it is missing or not a positive whole number. */
export function parseTabId(search) {
  const n = Number(new URLSearchParams(String(search || '')).get('tab'));
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : 0;
}

const isWebAddress = (href) => {
  try {
    return /^https?:$/.test(new URL(href).protocol);
  } catch {
    return false;
  }
};

/**
 * @param {number} tabId
 * @param {{ tabs: { get: Function, sendMessage: Function } }} api chrome, or a fake
 * @returns {Promise<{ status: 'ready', page: object } | { status: 'no-tab' | 'gone' | 'not-enabled' }>}
 */
export async function checkSourceTab(tabId, api) {
  if (!tabId) return { status: 'no-tab' };
  let tab;
  try {
    tab = await api.tabs.get(tabId);
  } catch {
    return { status: 'gone' };
  }
  if (!tab) return { status: 'gone' };
  try {
    const answer = await api.tabs.sendMessage(tabId, { type: MSG.PING });
    if (!answer || answer.ok !== true) return { status: 'not-enabled' };
  } catch {
    return { status: 'not-enabled' }; // no content script there: the site is not enabled, or the tab has to be reloaded
  }
  // The address is only visible for sites the person enabled, which is also why the content script answered.
  if (!isWebAddress(tab.url)) return { status: 'not-enabled' };
  return { status: 'ready', page: { tabId, href: tab.url, windowId: tab.windowId, surface: surfaceOf(tab.url), status: 'no-record' } };
}

/**
 * What the full page shows after a new check of its tab, given what it showed before. The ServiceNow tab is checked again every
 * time it moves; while the new page is loading its content script does not answer yet, so a check says "not enabled" for a moment.
 * Throwing the dashboard away then (and building it again a second later) restarted every widget on every click in ServiceNow. So
 * a dashboard that was showing STAYS, with `reconnecting: true` (the page says the tab is not answering right now), until the tab
 * answers again or is closed. Pure.
 */
export function nextSource(previous, checked) {
  if (checked?.status === 'ready') return checked;
  if (checked?.status === 'not-enabled' && previous?.status === 'ready' && previous.page) return { status: 'ready', page: previous.page, reconnecting: true };
  return checked || { status: 'no-tab' };
}
