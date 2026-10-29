// Who may send a runtime message to the service worker or to a content script.
//
// Agent Buddy has no web-facing message surface: nothing in a web page ever talks to the service worker, and
// externally_connectable is not declared. Every message that has a side effect must come from one of this extension's own
// pages (side panel, settings). The check is against the frame that SENT the message (sender.origin, falling back to
// sender.url), never the tab's top-level URL: a ServiceNow tab can hold frames from anywhere.

export const EXTENSION_ONLY = "This request is only allowed from Agent Buddy's own pages.";

function originOfUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return '';
  }
  // Non-special schemes have an opaque URL.origin outside the browser.
  if (parsed.protocol === 'chrome-extension:') return parsed.host ? `chrome-extension://${parsed.host}` : '';
  return parsed.origin === 'null' ? '' : parsed.origin;
}

/**
 * Origin of the frame that sent the message. sender.origin when the browser reports one (an opaque "null" origin counts as
 * unknown), else the origin of sender.url. '' when unknown. Never sender.tab.url.
 */
export function senderOrigin(sender) {
  if (sender && typeof sender.origin === 'string') return sender.origin === 'null' ? '' : sender.origin;
  return originOfUrl(sender?.url);
}

/** True when `sender` is one of this extension's own pages (not a content script, not another extension). */
export function isFromExtensionPage(sender, runtimeId) {
  if (!runtimeId || !sender || sender.id !== runtimeId) return false;
  const origin = senderOrigin(sender);
  return Boolean(origin) && origin === `chrome-extension://${runtimeId}`;
}

/**
 * The origin of the page that this extension's own content script sent a message from, or '' when the sender is anything else
 * (another extension, an extension page, a frame inside the page, a tab id that is not a real tab). The only thing a content
 * script may ask the service worker is what the bar on the page needs (src/background/bar.js).
 */
export function contentScriptOrigin(sender, runtimeId) {
  if (!runtimeId || !sender || sender.id !== runtimeId) return '';
  if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || sender.frameId !== 0) return '';
  const origin = senderOrigin(sender);
  // Instances are https only (normalizeInstance), so a content script on any other kind of page is not ours to answer.
  return origin.startsWith('https://') ? origin : '';
}

/** Throws unless the message came from this extension's own pages. */
export function checkExtensionSender(sender, runtimeId) {
  if (!isFromExtensionPage(sender, runtimeId)) throw new Error(EXTENSION_ONLY);
  return 'extension';
}
