// What the panel believes about the active tab, as pure state transitions (usePage.js feeds them, tests/panel-page-state.test.js
// pins them). No chrome.*, no React.
//
// Why this exists: a browser tab that is loading, or that is not a ServiceNow page at all, cannot answer the content script's
// PAGE_STATE message. The panel used to treat one missing answer as "not turned on for this page" and throw every section
// away, with the Write drafts and the Duplicates results inside them. Now:
//   - one missing answer from the page we were just working on is a hiccup: the last answer is kept and marked stale;
//   - a second missing answer, at least GRACE_MS after the first, is believed: the page becomes 'not-enabled';
//   - a tab we have never heard from is believed at once (nothing to hold on to);
//   - whatever happens, the last page that did answer is remembered (lastGood, lastSeen) so the sections can keep working.
//
// state = {
//   page:      what to treat as the current page: { status: 'loading' } | the content script's answer
//              ({ status: 'record' | 'no-record', tabId, href, ... }) | { status: 'not-enabled', tabId, origin }
//   stale:     true while `page` is the previous answer, kept through a missing one
//   lastGood:  the last page that answered, while its tab still exists (cleared when that tab closes)
//   lastSeen:  the last page that answered, even if its tab has closed (only used to keep a visited section mounted)
//   failures, failedTab, failedSince: the run of missing answers from one tab
//   answered:  { [tabId]: true } tabs whose content script has answered at least once
// }

import { isTicketTable } from '../context/kinds.js';

export const GRACE_POLLS = 2;
export const GRACE_MS = 2000;

export const isEnabledPage = (page) => page?.status === 'record' || page?.status === 'no-record';

export const initialPageState = () => ({
  page: { status: 'loading' },
  stale: false,
  lastGood: null,
  lastSeen: null,
  failures: 0,
  failedTab: 0,
  failedSince: 0,
  answered: {},
});

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The record the content script says the page shows, or null when it is not a ticket page. The content script decides (it sees the
 * form: src/content/recordResolver.js); this is the second look, for an answer from a copy of it that was injected before an update
 * and still treats any `/<name>.do?sys_id=` as a record: a ticket's table, one of the organisation's families, or a record that
 * carries a number (the form proved it) passes. Nothing else becomes the Ticket screen. Pure.
 * @param {*} record  what the page said (untrusted)  @param {string[]} [extraPrefixes] the policy's sensitiveTablePrefixes
 */
export function vetRecord(record, extraPrefixes) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.table !== 'string' || typeof record.sysId !== 'string' || !record.sysId) return null;
  const numbered = typeof record.number === 'string' && record.number.trim() !== '';
  return numbered || isTicketTable(record.table, { extraPrefixes }) ? record : null;
}

/**
 * @param {object} state a value from initialPageState()/reducePage()
 * @param {{ type: 'answer', page: object, at?: number } | { type: 'silent', tabId: number, origin?: string, at?: number } | { type: 'closed', tabId: number }} event
 *   answer: the content script of the active tab answered with an enabled page (status 'record' or 'no-record')
 *   silent: the active tab did not answer (no content script, loading, not a web page)
 *   closed: a browser tab went away
 */
export function reducePage(state, event) {
  if (event.type === 'answer') {
    const page = sameJson(state.page, event.page) ? state.page : event.page;
    const lastGood = sameJson(state.lastGood, event.page) ? state.lastGood : event.page;
    return {
      page,
      stale: false,
      lastGood,
      lastSeen: lastGood,
      failures: 0,
      failedTab: 0,
      failedSince: 0,
      answered: state.answered[event.page.tabId] ? state.answered : { ...state.answered, [event.page.tabId]: true },
    };
  }

  if (event.type === 'closed') {
    const answered = { ...state.answered };
    delete answered[event.tabId];
    return { ...state, answered, lastGood: state.lastGood?.tabId === event.tabId ? null : state.lastGood };
  }

  // silent
  const timed = Number.isFinite(event.at);
  const at = timed ? event.at : 0;
  const tabId = event.tabId || 0;
  const sameRun = state.failures > 0 && state.failedTab === tabId;
  const failures = sameRun ? state.failures + 1 : 1;
  const failedSince = sameRun ? state.failedSince : at;
  const notEnabled = { status: 'not-enabled', tabId, origin: event.origin || '' };

  // Nothing to hold on to: the first look at the panel, a page that was already not enabled, or a tab that never answered.
  const holdable = isEnabledPage(state.page);
  const tabChanged = state.page.tabId !== tabId;
  const neverAnswered = !state.answered[tabId];
  if (!holdable || (tabChanged && neverAnswered)) {
    return { ...state, page: sameJson(state.page, notEnabled) ? state.page : notEnabled, stale: false, failures, failedTab: tabId, failedSince };
  }

  // The page we were working on missed an answer (or a known tab we switched to did): hold the last answer for a moment.
  if (failures < GRACE_POLLS || (timed && at - failedSince < GRACE_MS)) {
    return { ...state, stale: true, failures, failedTab: tabId, failedSince };
  }
  return { ...state, page: notEnabled, stale: false, failures, failedTab: tabId, failedSince };
}
