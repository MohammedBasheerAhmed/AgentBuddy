import { useCallback, useEffect, useRef, useState } from 'react';
import { MSG } from '../lib/messages.js';

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
//   { status: 'not-enabled', tabId, origin }  no content script answered (site not enabled, or not a web page)
//   { status: 'no-record', tabId, href, user }  enabled, but the page is not a record
//   { status: 'record', tabId, href, record: {table, sysId, number}, user, form }
async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { status: 'not-enabled', tabId: 0, origin: '' };
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: MSG.PAGE_STATE });
    if (!state || state.error) throw new Error(state?.error?.message || 'No answer.');
    return { ...state, status: state.record ? 'record' : 'no-record', tabId: tab.id };
  } catch {
    // The URL is only visible when the browser granted access to the site (or the toolbar button was just used on it).
    return { status: 'not-enabled', tabId: tab.id, origin: originOf(tab.url) };
  }
}

export function usePage() {
  const [page, setPage] = useState({ status: 'loading' });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await readActivePage();
      // Avoid re-rendering the whole panel every poll when nothing changed.
      setPage((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    const onTab = () => refresh();
    chrome.tabs.onActivated.addListener(onTab);
    chrome.tabs.onUpdated.addListener(onTab);
    return () => {
      clearInterval(timer);
      chrome.tabs.onActivated.removeListener(onTab);
      chrome.tabs.onUpdated.removeListener(onTab);
    };
  }, [refresh]);

  return { page, refresh };
}
