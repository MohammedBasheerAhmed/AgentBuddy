// Message types between the side panel, the service worker and the content script.
// All of them are sent by extension pages only (src/lib/senderCheck.js); nothing a web page sends is ever handled.

export const MSG = Object.freeze({
  // panel -> content script (via chrome.tabs.sendMessage)
  PING: 'ab:ping',
  PAGE_STATE: 'ab:page-state', // -> { href, title, record: {table, sysId, number}|null, user, form }
  READ: 'ab:read', // { op: 'pack' | 'history' | 'similar' | 'knowledge' | ..., args } -> plain JSON
  FILL_FIELD: 'ab:fill-field', // { field, value, label } -> { ok, method?, reason? }

  // content script (the bar on the page) -> service worker. These two are the only requests a content script may make; every
  // other request needs an extension page (src/lib/senderCheck.js).
  BAR_ACTIONS: 'ab:bar-actions', // { table } -> { actions: [{ id, label }] }  what the bar may offer on this page
  BAR_LAUNCH: 'ab:bar-launch', // { table, sysId, featureId } -> { opened }  open the side panel and ask it to run one action on that record

  // panel / settings -> service worker
  ENABLE_INSTANCE: 'ab:enable-instance', // { origin } after the person granted the browser permission
  DISABLE_INSTANCE: 'ab:disable-instance', // { origin }
  LIST_INSTANCES: 'ab:list-instances',
});

/** Errors that cross the message boundary travel as { error: { message, code } } so the panel can show plain text. */
export const toWireError = (err) => ({ error: { message: String(err?.message || err || 'Something went wrong.'), code: err?.code || '' } });
