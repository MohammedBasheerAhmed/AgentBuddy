// Message types between the side panel, the service worker and the content script.
// All of them are sent by extension pages only (src/lib/senderCheck.js); nothing a web page sends is ever handled.

export const MSG = Object.freeze({
  // panel -> content script (via chrome.tabs.sendMessage)
  PING: 'ab:ping',
  PAGE_STATE: 'ab:page-state', // -> { href, title, record: {table, sysId, number}|null, user, form }
  READ: 'ab:read', // { op: 'pack' | 'history' | 'similar' | 'knowledge' | ..., args } -> plain JSON
  FILL_FIELD: 'ab:fill-field', // { field, value, label, mode, expect } -> { ok, method?, label?, reason? }

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

/** Errors that cross the message boundary travel as { error: { message, code } } so the panel can show plain text. */
export const toWireError = (err) => ({ error: { message: String(err?.message || err || 'Something went wrong.'), code: err?.code || '' } });
