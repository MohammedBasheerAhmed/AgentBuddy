// Message types between the side panel, the service worker and the content script.
// All of them are sent by extension pages only (src/lib/senderCheck.js); nothing a web page sends is ever handled.

export const MSG = Object.freeze({
  // panel -> content script (via chrome.tabs.sendMessage)
  PING: 'ab:ping',
  PAGE_STATE: 'ab:page-state', // -> { href, title, record: {table, sysId, number}|null, user, form }
  READ: 'ab:read', // { op: 'pack' | 'history' | 'similar' | 'knowledge' | ..., args } -> plain JSON
  FILL_FIELD: 'ab:fill-field', // { field, value, label } -> { ok, method?, reason? }

  // panel / settings -> service worker
  ENABLE_INSTANCE: 'ab:enable-instance', // { origin } after the person granted the browser permission
  DISABLE_INSTANCE: 'ab:disable-instance', // { origin }
  LIST_INSTANCES: 'ab:list-instances',
});

/** Errors that cross the message boundary travel as { error: { message, code } } so the panel can show plain text. */
export const toWireError = (err) => ({ error: { message: String(err?.message || err || 'Something went wrong.'), code: err?.code || '' } });
