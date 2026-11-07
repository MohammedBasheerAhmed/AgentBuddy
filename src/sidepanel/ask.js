import { MSG } from '../lib/messages.js';
import { READ_REASON, readReasonOf, reasonSentence } from '../context/access.js';
import { t, tm, t as tr, getLanguage } from '../i18n/index.js';

// English constants (the tests and the callers compare them); every use below shows them in the language of the panel.
export const LOST_TOUCH = tm('Agent Buddy lost touch with this page. Reload the ServiceNow page and try again.');
export const PANEL_UPDATED = tm('Agent Buddy was updated. Close this panel and open it again.');

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
const browserProblem = (message) => (UPDATED_RE.test(message) ? tr(PANEL_UPDATED) : LOST_TOUCH_RE.some((rx) => rx.test(message)) ? tr(LOST_TOUCH) : '');

// Words that are for whoever debugs a read, never for a person: the read layer's old technical messages ('Table API query on "x" failed
// (500)'), an HTTP code, "Table API", "your user", the name of a table. The read layer now keeps them in `error.detail` and `status`; an
// error that still carries them in its message (an older reader, another layer) is said by its reason instead.
const TECHNICAL = /\bTable API\b|\bAggregate API\b|\b(?:query|count|breakdown|report) (?:on|of) "|\bfailed \(\d{3}\)|\byour user\b|\bHTTP (?:error |status )?\d{3}\b|\b(?:invalid|unknown|no such) (?:table|field|column|query)\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i;
// An HTTP code in brackets after a plain clause ("... refused the request (answer 403)."): the clause is fine, the number is not.
const HTTP_CODE = /\s*\((?:answer\s+)?[1-5]\d\d\)/g;

/**
 * The words to show a person for an error: one plain clause and, where there is one, the next step. The browser's own text about a lost
 * connection becomes one plain sentence; a message that is already ours (or the page's) passes through, with an HTTP code in brackets
 * taken out; a message that is technical (see TECHNICAL) is replaced by the fixed sentence of the error's reason ("Not available to you
 * with your role.", "You are signed out of ServiceNow. Sign in again, then try again."), or by the fallback. A text that comes from
 * another part of the extension (the service worker, the page) in English is looked up like t(): it is shown in Arabic when the
 * catalogue has the same text (tm() marks it there).
 */
export function plainError(err, fallback = t('Something went wrong. Try again; if it keeps happening, tell your administrator.')) {
  const message = String(err?.message ?? err ?? '').trim();
  const lost = browserProblem(message);
  if (lost) return lost;
  if (!message) return tr(fallback);
  const reason = readReasonOf(err);
  const fixed = reasonSentence(reason); // (an English text the engine marked with tm(): src/context/access.js)
  // The organisation's block names the table in its message (src/content/policyGuard.js): the fixed sentence says whose rule it is.
  if (reason === READ_REASON.BLOCKED) return tr(fixed);
  const clean = message.replace(HTTP_CODE, '').trim();
  if (!TECHNICAL.test(clean)) return tr(clean);
  return tr(fixed || fallback);
}

/** Send one message to the content script of a tab and unwrap its answer; errors from the page come back as Error with .code. */
export async function ask(tabId, message) {
  let answer;
  try {
    // The page script builds some texts the panel shows (My work, the gaps, the form fields): it speaks the panel's language, so each
    // request says which one it is.
    answer = await chrome.tabs.sendMessage(tabId, { ...message, language: getLanguage() });
  } catch (err) {
    const text = browserProblem(String(err?.message ?? ''));
    if (!text) throw err;
    const lost = new Error(text);
    lost.code = 'LOST_TOUCH';
    throw lost;
  }
  // Nobody answered (the page was replaced while the message was on its way).
  if (answer === undefined || answer === null) {
    const lost = new Error(tr(LOST_TOUCH));
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
