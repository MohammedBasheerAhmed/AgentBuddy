// What the service worker does for the bar on the ServiceNow page (src/content/bar.js). Everything the worker needs from the browser
// comes in as `deps`, so the rules are unit-tested without chrome.* (tests/bar-background.test.js).
//
// A content script may make exactly two requests, and both only from the top frame of a page of an instance the person turned on:
//   BAR_ACTIONS  which actions may the bar show for a record of this table? (pins and policy applied here, where the policy is readable)
//   BAR_LAUNCH   open the side panel and ask it to run one of those actions
// The worker never runs an action itself: it opens the panel and leaves a short-lived request (src/lib/launch.js). The panel runs
// the action through the usual steps, including the check of what will be sent.
import { MSG } from '../lib/messages.js';
import { contentScriptOrigin } from '../lib/senderCheck.js';
import { kindForTable } from '../context/kinds.js';
import { TABLE_RE } from '../context/util.js';
import { isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { quickActions } from '../features/quick.js';
import { FEATURE_ID_RE, makeLaunch } from '../lib/launch.js';

export const BAR_TYPES = new Set([MSG.BAR_ACTIONS, MSG.BAR_LAUNCH]);

/**
 * @param {object} message { type, table, featureId? }
 * @param {object} sender  chrome's MessageSender
 * @param {object} deps    { runtimeId, activeInstances(), loadSettings(), loadPolicy(), openPanel(tabId), saveLaunch(launch), now() }
 */
export async function handleBarMessage(message, sender, deps) {
  const origin = contentScriptOrigin(sender, deps.runtimeId);
  if (!origin) throw new Error('This request is only allowed from the page of a site you turned on.');
  const table = typeof message.table === 'string' ? message.table.trim().toLowerCase() : '';
  if (!TABLE_RE.test(table)) throw new Error('That is not a valid record.');

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
  // The script is registered only on enabled instances; this is the second lock on the same door.
  if (!instances.includes(origin)) throw new Error('This site is not turned on.');

  // Hidden: the person (or the organisation) switched the bar off, the organisation blocked the table, or it is HR content the organisation does not allow.
  const shown = settings.pageBar !== false && !policy.disablePageBar && isTableAllowed(table, policy) && !(isSensitiveByPolicy(table, policy) && !policy.allowHrContent);
  const actions = shown ? quickActions({ kind: kindForTable(table), pins: settings.quickPins, policy }) : [];

  if (message.type === MSG.BAR_ACTIONS) return { actions };

  // BAR_LAUNCH: only an action the bar was allowed to offer for this table.
  if (!actions.some((a) => a.id === message.featureId)) throw new Error('That action is not available here.');
  const launch = makeLaunch({ tabId: sender.tab.id, table, sysId: message.sysId, featureId: message.featureId, now: deps.now() });
  if (!launch) throw new Error('That is not a valid request.');
  await deps.saveLaunch(launch);
  return { opened: opening ? await opening : false };
}
