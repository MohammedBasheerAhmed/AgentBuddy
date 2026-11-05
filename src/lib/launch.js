// A request from the bar on the ServiceNow page to the side panel: "run this action on this record".
//
// The service worker writes one (chrome.storage.session, which a content script cannot read) right after it opened the panel; the
// panel reads it, runs the action the same way a click on the action would (permission, masking, preview, policy), and deletes it.
// It holds a tab, a record (table and sys_id) and a feature id: no ticket text, no name. It expires quickly so that a click which
// found the panel unable to open (and so was never picked up) cannot start an AI request minutes later, when the person is looking
// at something else, and it names the exact record so that moving on to the next ticket does not run it on that one.

import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

export const LAUNCH_KEY = 'ab:launch';
export const LAUNCH_TTL_MS = 30000;
// A feature id ('reply-draft'), or an Insights card of the Ticket screen ('card:ready', src/features/quick.js QUICK_CARDS): the bar
// offers the cards when AI is off, and the panel then opens that card instead of running an action. All tools (in the panel) also
// sends 'show:<card id>' (any Insights card of the record, alone; card ids are camelCase: 'show:knownErrors') and 'ask:ticket' (AI
// Assist with "Ask about this ticket" open): docs/focus-layout.md. Neither starts an AI request, so the worker accepting them from the
// bar too (src/background/bar.js) lets nothing new happen.
export const FEATURE_ID_RE = /^(?:(?:card:)?[a-z][a-z0-9-]{0,63}|show:[a-zA-Z][a-zA-Z0-9]{0,39}|ask:ticket)$/;

/** A request for the panel, or null when any part of it is not valid. `now` is passed in so tests do not wait. */
export function makeLaunch({ tabId, table, sysId, featureId, now }) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  if (typeof table !== 'string' || !TABLE_RE.test(table)) return null;
  if (typeof sysId !== 'string' || !SYS_ID_RE.test(sysId)) return null;
  if (typeof featureId !== 'string' || !FEATURE_ID_RE.test(featureId)) return null;
  if (!Number.isFinite(now)) return null;
  return { tabId, table, sysId: sysId.toLowerCase(), featureId, at: now };
}

/** The stored value if it is a well-formed request that is still fresh, else null (storage is not trusted blindly). */
export function freshLaunch(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const launch = makeLaunch({ tabId: raw.tabId, table: raw.table, sysId: raw.sysId, featureId: raw.featureId, now: raw.at });
  if (!launch || !Number.isFinite(now)) return null;
  const age = now - launch.at;
  // (a time in the future is not believed either)
  return age >= 0 && age <= LAUNCH_TTL_MS ? launch : null;
}

/** Is the request for the record the panel is showing: the same tab, and that very record open in it? */
export function launchIsForPage(launch, page) {
  const record = page?.record;
  return Boolean(launch && record) && page.tabId === launch.tabId && record.table === launch.table && String(record.sysId || '').toLowerCase() === launch.sysId;
}
