import { MSG } from '../lib/messages.js';

export const LOST_TOUCH = 'Agent Buddy lost touch with this page. Reload the ServiceNow page and try again.';
export const PANEL_UPDATED = 'Agent Buddy was updated. Close this panel and open it again.';

// What the browser says when the page's content script is not there to answer: the tab was open before the site was turned on,
// the page is reloading, the tab closed, or the extension was reloaded. None of it is fit to show a person.
const LOST_TOUCH_RE = [
  /could not establish connection/i,
  /receiving end does not exist/i,
  /message port closed/i,
  /message channel closed/i,
  /no tab with id/i,
  /tab was closed/i,
  /frame with id .* was removed/i,
];
const UPDATED_RE = /extension context invalidated/i;

/** The browser-level text for a failed message, or '' when this is some other error. */
const browserProblem = (message) => (UPDATED_RE.test(message) ? PANEL_UPDATED : LOST_TOUCH_RE.some((rx) => rx.test(message)) ? LOST_TOUCH : '');

/**
 * The words to show a person for an error: the browser's own text about a lost connection becomes one plain sentence; any other
 * message is already ours (or the page's) and passes through.
 */
export function plainError(err, fallback = 'Something went wrong.') {
  const message = String(err?.message ?? err ?? '').trim();
  return browserProblem(message) || message || fallback;
}

/** Send one message to the content script of a tab and unwrap its answer; errors from the page come back as Error with .code. */
export async function ask(tabId, message) {
  let answer;
  try {
    answer = await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    const text = browserProblem(String(err?.message ?? ''));
    if (!text) throw err;
    const lost = new Error(text);
    lost.code = 'LOST_TOUCH';
    throw lost;
  }
  // Nobody answered (the page was replaced while the message was on its way).
  if (answer === undefined || answer === null) {
    const lost = new Error(LOST_TOUCH);
    lost.code = 'LOST_TOUCH';
    throw lost;
  }
  if (answer.error) {
    const err = new Error(answer.error.message);
    err.code = answer.error.code;
    throw err;
  }
  return answer;
}

// The organisation's policy as this extension page sees it (it can read chrome.storage.managed). Every READ carries it so the
// content script can enforce blocked tables and the HR switch even where it cannot read the managed policy itself; the content
// script MERGES it with its own reading, so this can only make a read stricter (src/content/policyGuard.js mergePanelPolicy).
let readPolicy = null;

export function setReadPolicy(policy) {
  readPolicy = policy
    ? { blockedTables: policy.blockedTables || [], sensitiveTablePrefixes: policy.sensitiveTablePrefixes || [], allowHrContent: policy.allowHrContent === true }
    : null;
}

/** A READ operation (src/content/reads.js and src/content/ops/*). */
export const read = (tabId, op, args = {}) => ask(tabId, { type: MSG.READ, op, args, ...(readPolicy ? { policy: readPolicy } : {}) });
