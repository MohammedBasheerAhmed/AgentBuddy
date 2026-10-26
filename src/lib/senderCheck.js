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

/** Throws unless the message came from this extension's own pages. */
export function checkExtensionSender(sender, runtimeId) {
  if (!isFromExtensionPage(sender, runtimeId)) throw new Error(EXTENSION_ONLY);
  return 'extension';
}
