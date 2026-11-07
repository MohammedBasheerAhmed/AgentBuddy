// Keyboard shortcuts (the manifest's "commands"; the person can change the keys at chrome://extensions/shortcuts or edge://extensions/shortcuts,
// and in Firefox at about:addons, the gear, Manage Extension Shortcuts; Settings opens the right one: src/lib/platform.js).
//
//   open-panel   open the Agent Buddy panel
//   summarise    open the panel and start "Summarise this ticket" on the record that is open
//   reply        open the panel and start "Draft a reply" on the record that is open
//
// An action is never run from here. Like the bar on the page (src/background/bar.js) the worker opens the panel and leaves a short-lived
// request (src/lib/launch.js: a tab, a record, an action id; no text); the panel starts the action through the usual steps, with the
// check of what will be sent first. The action has to be one the bar may offer for that record, so the organisation's policy (blocked
// tables, HR content, AI switched off) and the person's choices hold for a key press exactly as for a click. So do the panel's own rules for the
// kind of ticket (src/features/visibility.js): no reply on a problem or a task of a change, and no HR action outside Strict privacy mode.
import { TABLE_RE } from '../context/util.js';
import { isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { makeLaunch } from '../lib/launch.js';
import { barActions } from './bar.js';

/** command name -> the feature it starts (null: only open the panel) */
export const COMMAND_FEATURES = Object.freeze({ 'open-panel': null, summarise: 'record-summary', reply: 'reply-draft' });

/**
 * @param {string} command  the command's name from the manifest
 * @param {{ id?: number, url?: string }|undefined} tab  the active tab, as the browser passes it with the command
 * @param {{
 *   openPanel: (tabId: number, tab?: object) => Promise<any>, pageState: (tabId: number) => Promise<any>, activeInstances: () => Promise<string[]>,
 *   loadSettings: () => Promise<object>, loadPolicy: () => Promise<object>, aiOn?: Function, saveLaunch: (launch: object) => Promise<any>, now: () => number
 * }} deps
 * @returns {Promise<{ opened: boolean, started: boolean }>}
 */
export async function handleCommand(command, tab, deps) {
  if (!Object.prototype.hasOwnProperty.call(COMMAND_FEATURES, command)) return { opened: false, started: false };
  if (!Number.isInteger(tab?.id) || tab.id < 0) return { opened: false, started: false };
  // The browser opens the side panel only while the key press is still being handled, and that ends the first time anything is
  // awaited: so the panel is opened before every check below, as the bar does.
  // (The tab goes along: on a ServiceNow page that is not added yet the panel is switched on for the key press, as a click on the toolbar
  // button does, so "Turn on for this site" can be used. On any other page that is not an added site the browser refuses and nothing opens.)
  let opening;
  try {
    opening = Promise.resolve(deps.openPanel(tab.id, tab)).then(() => true, () => false); // (called now, not in a later turn)
  } catch {
    opening = Promise.resolve(false);
  }
  const featureId = COMMAND_FEATURES[command];
  if (!featureId) return { opened: await opening, started: false };

  try {
    // Only a page of a site the person turned on has a record to work on.
    let origin = '';
    try {
      origin = new URL(tab.url || '').origin;
    } catch {
      /* the address is not visible to the worker: the content script's answer below decides */
    }
    const [instances, settings, policy] = await Promise.all([deps.activeInstances(), deps.loadSettings(), deps.loadPolicy()]);
    if (origin && !instances.includes(origin)) return { opened: await opening, started: false };
    const state = await deps.pageState(tab.id);
    const record = state?.record;
    const table = typeof record?.table === 'string' ? record.table.trim().toLowerCase() : '';
    if (!TABLE_RE.test(table) || !record?.sysId) return { opened: await opening, started: false };
    // The same rules as for the bar's actions: allowed table, HR content only where the organisation allows it, an action the bar may offer.
    const shown = isTableAllowed(table, policy) && !(isSensitiveByPolicy(table, policy) && !policy.allowHrContent);
    // (a record that carries a number is one the form proved to be a ticket, even when its table is a customer's own)
    const proven = typeof record.number === 'string' && record.number.trim() !== '';
    const actions = shown ? await barActions({ table, settings, policy, deps, proven }) : [];
    if (!actions.some((a) => a.id === featureId)) return { opened: await opening, started: false };
    const launch = makeLaunch({ tabId: tab.id, table, sysId: record.sysId, featureId, now: deps.now() });
    if (!launch) return { opened: await opening, started: false };
    await deps.saveLaunch(launch);
    return { opened: await opening, started: true };
  } catch {
    return { opened: await opening, started: false }; // the panel is open; it shows what the page is
  }
}
