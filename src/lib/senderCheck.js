// Who may send a runtime message to the service worker or to a content script.
//
// Agent Buddy has no web-facing message surface: nothing in a web page ever talks to the service worker, and
// externally_connectable is not declared. Every message that has a side effect must come from one of this extension's own
// pages (side panel, settings). The check is against the frame that SENT the message (sender.origin, falling back to
// sender.url), never the tab's top-level URL: a ServiceNow tab can hold frames from anywhere.
//
// "This extension" is `own` = { id, origin } (src/lib/platform.js extensionIdentity): sender.id must be its id AND the sender's origin
// must be exactly the origin of its own pages. In Chrome and Edge that origin is chrome-extension://<id>; in Firefox it is
// moz-extension://<a random id made at install>, which is not the add-on's id, so the id alone cannot stand for it.

import { MSG } from './messages.js';
import { tm } from '../i18n/core.js';
import { extensionUrlOrigin } from './platform.js';

// (an English text marked for the catalogue; it crosses to the panel as a message, and plainError there shows it in Arabic)
export const EXTENSION_ONLY = tm("This request is only allowed from Agent Buddy's own pages.");

function originOfUrl(url) {
  // Extension pages (chrome-extension:, moz-extension:, safari-web-extension:) have non-special schemes, whose URL.origin is
  // opaque outside the browser: platform.js builds theirs from the scheme and the host.
  const extension = extensionUrlOrigin(url);
  if (extension) return extension;
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return '';
  }
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

// `own` is usable only when it names an id and an extension page's origin. A web page's origin given by mistake would otherwise turn
// this extension's content scripts into "own pages". In Chrome and Edge the origin's host IS the id, and that is held exactly.
function ownOrigin(own) {
  const id = typeof own?.id === 'string' ? own.id : '';
  const origin = typeof own?.origin === 'string' ? own.origin : '';
  if (!id || !origin || extensionUrlOrigin(origin) !== origin) return '';
  if (origin.startsWith('chrome-extension:') && origin !== `chrome-extension://${id}`) return '';
  return origin;
}

/**
 * True when `sender` is one of this extension's own pages (not a content script, not another extension).
 * @param {object} sender the browser's MessageSender
 * @param {{ id: string, origin: string }} own this extension (src/lib/platform.js extensionIdentity)
 */
export function isFromExtensionPage(sender, own) {
  const origin = ownOrigin(own);
  if (!origin || !sender || sender.id !== own.id) return false;
  return senderOrigin(sender) === origin;
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
 * @param {{ id: string, origin: string }} own this extension (src/lib/platform.js extensionIdentity)
 */
export function contentMessageAction(message, sender, own, retired = false) {
  const id = typeof own?.id === 'string' ? own.id : '';
  if (retired || !id || !sender || sender.id !== id) return 'ignore';
  if (message && message.type === MSG.SITE_OFF) return 'retire';
  return isFromExtensionPage(sender, own) ? 'answer' : 'ignore';
}

/**
 * Throws unless the message came from this extension's own pages.
 * @param {{ id: string, origin: string }} own this extension (src/lib/platform.js extensionIdentity)
 */
export function checkExtensionSender(sender, own) {
  if (!isFromExtensionPage(sender, own)) throw new Error(EXTENSION_ONLY);
  return 'extension';
}
