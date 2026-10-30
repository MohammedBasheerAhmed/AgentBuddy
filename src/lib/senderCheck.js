// Who may send a runtime message to the service worker or to a content script.
//
// Agent Buddy has no web-facing message surface: nothing in a web page ever talks to the service worker, and
// externally_connectable is not declared. Every message that has a side effect must come from one of this extension's own
// pages (side panel, settings). The check is against the frame that SENT the message (sender.origin, falling back to
// sender.url), never the tab's top-level URL: a ServiceNow tab can hold frames from anywhere.

import { MSG } from './messages.js';

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

/**
 * What the content script does with a runtime message (src/content/index.js):
 *   'answer'  one of this extension's own pages asks (the side panel, the full-page dashboard)
 *   'retire'  this extension says the site was turned off (MSG.SITE_OFF). Only ever makes Agent Buddy do less, so any context of
 *             this extension may say it (in practice the service worker, which may not report an extension origin)
 *   'ignore'  anything else, and everything once the script has retired
 * A content script's runtime.onMessage only ever hears this extension (web pages and other extensions cannot reach it), but the
 * sender is checked anyway.
 */
export function contentMessageAction(message, sender, runtimeId, retired = false) {
  if (retired || !runtimeId || !sender || sender.id !== runtimeId) return 'ignore';
  if (message && message.type === MSG.SITE_OFF) return 'retire';
  return isFromExtensionPage(sender, runtimeId) ? 'answer' : 'ignore';
}

/** Throws unless the message came from this extension's own pages. */
export function checkExtensionSender(sender, runtimeId) {
  if (!isFromExtensionPage(sender, runtimeId)) throw new Error(EXTENSION_ONLY);
  return 'extension';
}
