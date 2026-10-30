// What the service worker does for the bar on the ServiceNow page (src/content/bar.js). Everything the worker needs from the browser
// comes in as `deps`, so the rules are unit-tested without chrome.* (tests/bar-background.test.js).
//
// A content script may make exactly two requests, and both only from the top frame of a page of an instance the person turned on:
//   BAR_ACTIONS  which actions may the bar show for a record of this table? (pins and policy applied here, where the policy is readable)
//                Without a table: is the bar switched on at all here? The bar asks that before it looks at the page, so a bar that is
//                switched off (by the person or by policy `disablePageBar`) reads nothing from the page.
//   BAR_LAUNCH   open the side panel and ask it to run one of those actions
// The worker never runs an action itself: it opens the panel and leaves a short-lived request (src/lib/launch.js). The panel runs
// the action through the usual steps, including the check of what will be sent.
//
// A content script whose site is no longer turned on (switched off, the browser's permission taken away, the organisation's list
// changed) is answered with the code SITE_OFF and retires: no bar, no answers to the panel, until the page is reloaded.
import { MSG, SITE_OFF_CODE } from '../lib/messages.js';
import { contentScriptOrigin } from '../lib/senderCheck.js';
import { kindForTable } from '../context/kinds.js';
import { TABLE_RE } from '../context/util.js';
import { isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { quickActions } from '../features/quick.js';
import { FEATURE_ID_RE, makeLaunch } from '../lib/launch.js';

export const BAR_TYPES = new Set([MSG.BAR_ACTIONS, MSG.BAR_LAUNCH]);

function siteOff() {
  const err = new Error('This site is not turned on.');
  err.code = SITE_OFF_CODE;
  return err;
}

/**
 * @param {object} message { type, table?, sysId?, featureId? }
 * @param {object} sender  chrome's MessageSender
 * @param {object} deps    { runtimeId, activeInstances(), loadSettings(), loadPolicy(), openPanel(tabId), saveLaunch(launch), now() }
 */
export async function handleBarMessage(message, sender, deps) {
  const origin = contentScriptOrigin(sender, deps.runtimeId);
  if (!origin) throw new Error('This request is only allowed from the page of a site you turned on.');
  // BAR_ACTIONS with no table at all is the question "is the bar on here?"; an empty or odd table is still refused.
  const probe = message.type === MSG.BAR_ACTIONS && message.table === undefined;
  const table = typeof message.table === 'string' ? message.table.trim().toLowerCase() : '';
  if (!probe && !TABLE_RE.test(table)) throw new Error('That is not a valid record.');

  // The browser opens the side panel only while the click that asked for it is still being handled, and that ends the first time
  // this function waits for anything. So the panel is opened first, before the checks below; if a check then fails the person has
  // an open panel and nothing else (no action is started).
  let opening = null;
  if (message.type === MSG.BAR_LAUNCH && FEATURE_ID_RE.test(String(message.featureId || ''))) {
    try {
      opening = Promise.resolve(deps.openPanel(sender.tab.id)).then(() => true, () => false);
    } catch {
      opening = Promise.resolve(false);
    }
  }

  const [instances, settings, policy] = await Promise.all([deps.activeInstances(), deps.loadSettings(), deps.loadPolicy()]);
  // The script is registered only on enabled instances; this is the second lock on the same door. A page that is still open after
  // its site was turned off is told so, and its script retires.
  if (!instances.includes(origin)) throw siteOff();

  // The person (or the organisation) switched the bar off: it shows nothing and does not look at the page.
  const bar = settings.pageBar !== false && !policy.disablePageBar;
  if (probe) return { actions: [], bar };

  // Hidden for this record: the organisation blocked the table, or it is HR content the organisation does not allow.
  const shown = bar && isTableAllowed(table, policy) && !(isSensitiveByPolicy(table, policy) && !policy.allowHrContent);
  const actions = shown ? quickActions({ kind: kindForTable(table), pins: settings.quickPins, policy }) : [];

  if (message.type === MSG.BAR_ACTIONS) return { actions, bar };

  // BAR_LAUNCH: only an action the bar was allowed to offer for this table.
  if (!actions.some((a) => a.id === message.featureId)) throw new Error('That action is not available here.');
  const launch = makeLaunch({ tabId: sender.tab.id, table, sysId: message.sysId, featureId: message.featureId, now: deps.now() });
  if (!launch) throw new Error('That is not a valid request.');
  await deps.saveLaunch(launch);
  return { opened: opening ? await opening : false };
}

/**
 * Tell the pages of a site that is being turned off, so their content scripts retire at once instead of at their next check.
 * Called BEFORE the browser's permission for the site is removed: without it the tabs of the site can no longer be found.
 * @param {string} pattern  the site's match pattern (instancePattern(origin))
 * @param {{ queryTabs: (q: object) => Promise<object[]>, sendToTab: (tabId: number, message: object) => Promise<any> }} deps
 * @returns {Promise<number>} how many tabs were told
 */
export async function retireOpenTabs(pattern, { queryTabs, sendToTab }) {
  let tabs = [];
  try {
    tabs = (await queryTabs({ url: pattern })) || [];
  } catch {
    return 0;
  }
  const ids = tabs.map((t) => t?.id).filter((id) => Number.isInteger(id) && id >= 0);
  await Promise.all(ids.map((id) => Promise.resolve().then(() => sendToTab(id, { type: MSG.SITE_OFF })).catch(() => {})));
  return ids.length;
}

/**
 * Close chrome.storage.local and chrome.storage.session to content scripts where the browser lets an extension say so.
 * Nothing in a content script needs them (it reads only chrome.storage.managed, for the policy), and both hold things a page process
 * must not reach or change: settings (the AI address, the preview and privacy modes, the turned-on sites), the activity log, the
 * unlocked AI key and the bar's launch request. storage.session is closed by default; it is pinned anyway. storage.local is open to
 * content scripts by default, and an older browser cannot close it (it then stays as it was: the call fails and is ignored).
 * @param {object} storage chrome.storage (or a fake)
 * @returns {Promise<Record<string, 'closed'|'unchanged'>>}
 */
export async function restrictStorageAccess(storage) {
  const out = {};
  for (const name of ['session', 'local', 'sync']) {
    const area = storage ? storage[name] : null;
    out[name] = 'unchanged';
    if (!area || typeof area.setAccessLevel !== 'function') continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- three areas, once per start of the worker
      await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      out[name] = 'closed';
    } catch {
      /* this browser does not support it for this area */
    }
  }
  return out;
}
