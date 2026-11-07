import { useCallback, useEffect, useRef, useState } from 'react';
import { MSG, pageStateMessage } from '../lib/messages.js';
import { initialPageState, reducePage, vetRecord } from './pageState.js';
import { hostLooksLikeServiceNow, siteVerdict } from './firstRun.js';

const POLL_MS = 2500;

const originOf = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
};

// What the panel knows about the active tab:
//   { status: 'loading' }
//   { status: 'not-enabled', tabId, origin }  no content script answered (site not enabled, or not a web page). One missing answer
//                                             from a page we were just working on is not believed: see pageState.js (stale, lastGood)
//   { status: 'no-record', tabId, href, user }  enabled, but the page is not a record
//   { status: 'record', tabId, href, record: {table, sysId, number}, user, form }
// Every state of an enabled page also carries surface ('classic' | 'workspace' | 'portal' | 'other') and, on a portal page,
// portal: { base: '/esc', pageId: 'ticket' } (null elsewhere). The address is read again on every poll, so a portal that
// moves between tickets without a reload (history.pushState) is followed within one poll.
const PORTAL_BASE_RE = /^\/[a-z][a-z0-9_-]{0,30}$/;
const PORTAL_PAGE_RE = /^[a-z0-9_.-]{0,80}$/;

// The content script's answer is data from a page we do not control: only a well-formed portal description gets through.
export function cleanPortal(portal, surface) {
  if (surface !== 'portal' || !portal || typeof portal !== 'object') return null;
  const base = typeof portal.base === 'string' ? portal.base.toLowerCase() : '';
  const pageId = typeof portal.pageId === 'string' ? portal.pageId.toLowerCase() : '';
  return PORTAL_BASE_RE.test(base) && PORTAL_PAGE_RE.test(pageId) ? { base, pageId } : null;
}

// One look at the active tab, as an event for reducePage (src/sidepanel/pageState.js). `policy`: the organisation's, sent along as
// with every READ (the content script reads to answer: a number's sys_id, a task's real class, who is signed in).
async function observeActivePage(policy) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { type: 'silent', tabId: 0, origin: '' };
  try {
    const state = await chrome.tabs.sendMessage(tab.id, pageStateMessage(policy));
    if (!state || state.error) throw new Error(state?.error?.message || 'No answer.');
    // (a record that is not a ticket's is no record: vetRecord)
    const record = vetRecord(state.record, policy?.sensitiveTablePrefixes);
    return { type: 'answer', page: { ...state, record, portal: cleanPortal(state.portal, state.surface), status: record ? 'record' : 'no-record', tabId: tab.id } };
  } catch {
    // The URL is only visible when the browser granted access to the site (or the toolbar button was just used on it).
    return { type: 'silent', tabId: tab.id, origin: originOf(tab.url) };
  }
}

/**
 * { page, stale, lastGood, lastSeen, refresh }. `page` is the current page; while the active tab misses an answer for a moment it
 * stays the last answer with `stale: true` (see pageState.js). `lastGood` is the last page that answered while its tab is still
 * open: the sections keep working on it when the active tab is not a ServiceNow page. `lastSeen` also survives that tab closing.
 * @param {object|null} [policy] the organisation's normalised policy (eff.policy): every look at the page carries it, as every READ does
 */
export function usePage(policy = null) {
  const [state, setState] = useState(initialPageState);
  const busy = useRef(false);
  const again = useRef(false); // something happened (a tab switch, a navigation) while a look was on its way: look once more after it
  const alive = useRef(true);
  // The latest policy, read by the next look (a policy that loads after the panel opened does not restart the polling).
  const policyRef = useRef(policy);
  policyRef.current = policy;

  // One look at a time, and none lost: a tab switch while a look waits for its answer used to be dropped, so the panel showed the
  // tab it had for up to one poll. Now the look that is running is followed by one more.
  const refresh = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        // eslint-disable-next-line no-await-in-loop -- one look after the other, in order
        const event = await observeActivePage(policyRef.current);
        if (!alive.current) return;
        setState((prev) => reducePage(prev, { ...event, at: Date.now() }));
      } while (again.current && alive.current);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const onTab = () => refresh();
    const onClosed = (tabId) => setState((prev) => reducePage(prev, { type: 'closed', tabId }));
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onTab);
    chrome.tabs.onRemoved.addListener(onClosed);
    return () => {
      alive.current = false;
      clearInterval(timer);
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
      chrome.tabs.onRemoved.removeListener(onClosed);
    };
  }, [refresh]);

  return { page: state.page, stale: state.stale, lastGood: state.lastGood, lastSeen: state.lastSeen, refresh };
}

// ---- Is the tab that is not turned on a ServiceNow page? ------------------------------------------------------------------------

/**
 * Runs IN the page, once, when the panel looks at a tab it may offer to turn on (chrome.scripting with the toolbar click's activeTab:
 * no new permission). It reads only whether a few ServiceNow globals and script addresses exist, and returns booleans: no text, no
 * values. Self-contained on purpose (it is serialised and run in the page's own world).
 */
export function pageMarkers() {
  const w = window;
  let scripts;
  try {
    scripts = Array.from(document.scripts || [])
      .slice(0, 400)
      .some((s) => /\/(?:scripts\/[^?#]*\.jsx|uxasset\/|api\/now\/|amb\/)/i.test(s.src || ''));
  } catch (e) {
    scripts = false;
  }
  return {
    gck: typeof w.g_ck === 'string' && w.g_ck.length >= 20,
    now: typeof w.NOW === 'object' && w.NOW !== null,
    glide: typeof w.GlideAjax === 'function' || (typeof w.g_user === 'object' && w.g_user !== null),
    scripts,
  };
}

/** One look at the tab's page for ServiceNow marks; null when the browser does not let the panel look (no activeTab grant). */
export async function lookForServiceNow(tabId) {
  try {
    if (!Number.isInteger(tabId) || !chrome.scripting?.executeScript) return null;
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: pageMarkers });
    const found = result?.result;
    if (!found || typeof found !== 'object') return null;
    // The answer comes from the page: only the four booleans are kept.
    return { gck: found.gck === true, now: found.now === true, glide: found.glide === true, scripts: found.scripts === true };
  } catch {
    return null;
  }
}

/**
 * 'servicenow' | 'other' | 'unknown' for a page that is not turned on, '' for any other page, 'checking' while the look runs.
 * A ServiceNow address needs no look; every other address is looked at once per tab and address.
 */
export function useSiteCheck(page) {
  const origin = page?.status === 'not-enabled' ? String(page.origin || '') : '';
  const tabId = page?.tabId;
  const [seen, setSeen] = useState({ key: '', verdict: '' });
  const key = `${tabId}|${origin}`;
  useEffect(() => {
    if (!origin || hostLooksLikeServiceNow(origin)) return undefined;
    let live = true;
    const look = () =>
      lookForServiceNow(tabId).then((markers) => {
        if (live) setSeen({ key, verdict: siteVerdict({ origin, markers }) });
      });
    look();
    // The tab moved to another page of the same site (the address the panel sees is only the origin): look again once it loaded.
    const onUpdated = (id, change) => {
      if (id === tabId && change?.status === 'complete') look();
    };
    try {
      chrome.tabs.onUpdated.addListener(onUpdated);
    } catch {
      /* no tab events here: the first look stands */
    }
    return () => {
      live = false;
      try {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        /* gone with the panel */
      }
    };
  }, [origin, tabId, key]);
  if (!origin) return '';
  if (hostLooksLikeServiceNow(origin)) return 'servicenow';
  return seen.key === key ? seen.verdict : 'checking';
}

/**
 * The sites Agent Buddy runs on now, as the service worker says (the person's and the organisation's, still granted by the browser);
 * null until it answered. Asked again when the settings change.
 */
export function useActiveInstances(eff) {
  const [list, setList] = useState(null);
  const instances = JSON.stringify(eff?.values?.instances || []);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => chrome.runtime.sendMessage({ type: MSG.LIST_INSTANCES }))
      .then((answer) => {
        if (live && Array.isArray(answer?.instances)) setList(answer.instances.filter((o) => typeof o === 'string'));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [instances]);
  return list;
}
