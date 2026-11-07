// Message types between the side panel, the service worker and the content script.
// All of them are sent by extension pages only (src/lib/senderCheck.js); nothing a web page sends is ever handled.

export const MSG = Object.freeze({
  // panel -> content script (via chrome.tabs.sendMessage)
  PING: 'ab:ping',
  PAGE_STATE: 'ab:page-state', // { policy? } -> { href, title, record: {table, sysId, number}|null, user, form }  (pageStateMessage below)
  READ: 'ab:read', // { op: 'pack' | 'history' | 'similar' | 'knowledge' | ..., args } -> plain JSON
  FILL_FIELD: 'ab:fill-field', // { field, value, label, mode, expect, replacing? } -> { ok, method?, label?, undo?: { previous, after }, reason? }
  //   mode 'undo' (round 4): { field, value: what the box held before, current: what the insert left there, label, expect } ->
  //   { ok, method? , reason? }; the page refuses ('changed') unless the box still holds `current`. Never a save (src/content/fill.js).

  // service worker -> content script: "this site was turned off". The content script stops its bar and stops answering until the
  // page is reloaded (src/content/index.js). Only ever makes Agent Buddy do less.
  SITE_OFF: 'ab:site-off',

  // content script (the bar on the page) -> service worker. These two are the only requests a content script may make; every
  // other request needs an extension page (src/lib/senderCheck.js).
  BAR_ACTIONS: 'ab:bar-actions', // { table? } -> { actions: [{ id, label }], bar }  what the bar may offer here; without a table: is the bar on at all
  BAR_LAUNCH: 'ab:bar-launch', // { table, sysId, featureId } -> { opened }  open the side panel and ask it to run one action on that record

  // panel / settings -> service worker
  ENABLE_INSTANCE: 'ab:enable-instance', // { origin } after the person granted the browser permission
  DISABLE_INSTANCE: 'ab:disable-instance', // { origin }
  LIST_INSTANCES: 'ab:list-instances',
});

// The error code the service worker answers a content script with when its site is no longer turned on (switched off, the
// browser's permission taken away, the organisation's list changed, "Clear everything"). The content script then retires.
export const SITE_OFF_CODE = 'SITE_OFF';

import { tm } from '../i18n/core.js';

/**
 * The part of the organisation's policy the content script needs for its own reads: blocked tables, the sensitive table prefixes and
 * the HR switch. Extension pages read the managed policy and send this with their requests to the page; the content script merges it
 * with what it reads itself (src/content/policyGuard.js mergePanelPolicy), so it can only make a read stricter. null without a policy.
 */
export function readPolicyOf(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  return { blockedTables: list(policy.blockedTables), sensitiveTablePrefixes: list(policy.sensitiveTablePrefixes), allowHrContent: policy.allowHrContent === true };
}

/**
 * The PAGE_STATE request. To answer it the content script reads too (a number's sys_id, a task's real class, who is signed in), so
 * it carries the policy the way every READ does (src/sidepanel/ask.js).
 */
export function pageStateMessage(policy) {
  const shaped = readPolicyOf(policy);
  return { type: MSG.PAGE_STATE, ...(shaped ? { policy: shaped } : {}) };
}

/** Errors that cross the message boundary travel as { error: { message, code } } so the panel can show plain text. */
// (tm: this file is in the page script's bundle, which has no catalogue; the panel shows the text through plainError, which translates it)
export const toWireError = (err) => ({ error: { message: String(err?.message || err || tm('Something went wrong. Try again; if it keeps happening, tell your administrator.')), code: err?.code || '' } });
