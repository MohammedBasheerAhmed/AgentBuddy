// Agent Buddy service worker (in Firefox the same file runs as an event page: it uses nothing that only a service worker has).
// Deliberately small: it holds no keys, makes no AI calls and never talks to ServiceNow.
// Its jobs are (1) open the panel from the toolbar button, (2) register the content scripts on exactly the
// instances the person enabled (and the browser granted), (3) keep that registration in sync with the permissions, and
// (4) answer the bar on the ServiceNow page: which actions it may show, and "open the panel and run this one" (bar.js).
import { MSG, pageStateMessage, toWireError } from '../lib/messages.js';
import { tm } from '../i18n/core.js'; // (an English text marked for the catalogue: the panel shows it in its language, see plainError)
import { checkExtensionSender } from '../lib/senderCheck.js';
import { browserApi, extensionIdentity, openPanel, wireToolbarButton } from '../lib/platform.js';
import { keyStore, loadPolicy, loadSettings, saveSettings } from '../lib/storage.js';
import { instancePattern, isInstanceAllowed, normalizeInstance } from '../policy/policy.js';
import { BAR_TYPES, barAiOn, handleBarMessage, restrictStorageAccess, retireOpenTabs } from './bar.js';
import { handleCommand } from './commands.js';
import { LAUNCH_KEY } from '../lib/launch.js';
import { describeInstances, reinjectAfterInstalled, wantedInstances } from './instances.js';

// First thing on every start of the worker: content scripts may not read or change chrome.storage.local / .session (where the
// browser supports closing them). Nothing in a content script needs them; see restrictStorageAccess in bar.js.
restrictStorageAccess(chrome.storage).catch(() => {});

// How this browser differs (the side panel of Chrome and Edge, the sidebar of Firefox) is in src/lib/platform.js.
const api = browserApi();
// This extension's id and the origin of its own pages (chrome-extension://<id>; moz-extension://<uuid> in Firefox). Only those pages
// may ask the worker for anything (src/lib/senderCheck.js).
const OWN = extensionIdentity(chrome.runtime);
// The toolbar button opens the panel. Set up on every start: in Firefox only a listener added while the event page starts wakes it.
wireToolbarButton(api);

const CONTENT_ID = 'ab-content';
const BRIDGE_ID = 'ab-bridge';

// Which instances are active = turned on by the person, or listed exactly in the organisation's allowedInstances (managed policy or
// an enterprise build), AND still granted by the browser (src/background/instances.js).
async function activeInstances() {
  const [settings, policy] = await Promise.all([loadSettings(), loadPolicy()]);
  const wanted = wantedInstances(settings, policy);
  const granted = [];
  for (const origin of wanted) {
    // eslint-disable-next-line no-await-in-loop -- a handful of origins at most.
    if (await chrome.permissions.contains({ origins: [instancePattern(origin)] })) granted.push(origin);
  }
  return granted;
}

/** Make the registered content scripts match exactly the active instances. */
// One sync at a time: two at once (a permission granted while "Turn on" saves the site) would both unregister and then both register
// the same script ids, and the second registration fails.
let syncing = Promise.resolve();
export function syncContentScripts() {
  const run = syncing.then(syncNow, syncNow);
  syncing = run.catch(() => {});
  return run;
}

async function syncNow() {
  const origins = await activeInstances();
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_ID, BRIDGE_ID] });
  } catch {
    /* nothing registered yet */
  }
  if (!origins.length) return [];
  // `https://<instance>/*` already covers the portals of the instance: Service Portal (/sp), Employee Center (/esc), the customer
  // service and HR portals (/csm, /csp, /hrsp) and any portal suffix a customer chose are pages of the SAME origin. They are
  // single-page apps in the top frame, so both scripts stay top-frame only (allFrames false): the bridge reaches same-origin
  // frames such as a rich-text editor from there. The scripts stay loaded while the app changes pages, and the content script
  // reads the address afresh on every request. A portal on its own web address is another origin and must be turned on itself.
  const matches = origins.map(instancePattern);
  await chrome.scripting.registerContentScripts([
    // The page-world bridge: reads g_form / g_user / g_ck and can fill one field. Runs first, in the page's own world.
    { id: BRIDGE_ID, matches, js: ['pagebridge.js'], world: 'MAIN', runAt: 'document_start', allFrames: false, persistAcrossSessions: true },
    // The content script: record detection and GET-only reads with the person's own session.
    { id: CONTENT_ID, matches, js: ['content.bundle.js'], world: 'ISOLATED', runAt: 'document_idle', allFrames: false, persistAcrossSessions: true },
  ]);
  return origins;
}

// A page that is already open when the person enables the instance does not get registered scripts until it reloads, so
// inject into matching tabs right away.
async function injectIntoOpenTabs(origin) {
  const tabs = await chrome.tabs.query({ url: instancePattern(origin) });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pagebridge.js'], world: 'MAIN' });
      // eslint-disable-next-line no-await-in-loop
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.bundle.js'], world: 'ISOLATED' });
    } catch {
      /* the tab navigated away or is not injectable */
    }
  }
}

async function enableInstance(rawOrigin) {
  const origin = normalizeInstance(rawOrigin);
  if (!origin) throw new Error(tm('That is not a valid https address.'));
  const policy = await loadPolicy();
  if (!isInstanceAllowed(origin, policy)) throw new Error(tm('Your organisation has not approved this instance for Agent Buddy.'));
  if (!(await chrome.permissions.contains({ origins: [instancePattern(origin)] }))) {
    throw new Error(tm('The browser has not granted access to this site yet. Use the Enable button in the side panel.'));
  }
  const settings = await loadSettings();
  const instances = [...new Set([...(settings.instances || []), origin])];
  await saveSettings({ instances });
  await syncContentScripts();
  await injectIntoOpenTabs(origin);
  return { instances };
}

async function disableInstance(rawOrigin) {
  const origin = normalizeInstance(rawOrigin);
  const settings = await loadSettings();
  const instances = (settings.instances || []).filter((o) => o !== origin);
  await saveSettings({ instances });
  // Pages of the site that are open now keep their content script until they reload: tell them to stop (no bar, no answers to the
  // panel). This must happen while the browser's permission still lets the worker find those tabs.
  if (origin) await retireOpenTabs(instancePattern(origin), { queryTabs: (q) => chrome.tabs.query(q), sendToTab: (id, m) => chrome.tabs.sendMessage(id, m) });
  try {
    await chrome.permissions.remove({ origins: [instancePattern(origin)] });
  } catch {
    /* already gone */
  }
  await syncContentScripts();
  return { instances };
}

// What the bar on the ServiceNow page may ask for (src/background/bar.js holds the rules).
const barDeps = {
  runtimeId: OWN.id,
  activeInstances,
  loadSettings,
  loadPolicy,
  now: () => Date.now(),
  // Can the AI actions run for this person (the organisation allows AI, the person did not skip it, a key is saved or none is
  // needed)? Only whether a key is saved is looked at, never the key itself.
  aiOn: (settings, policy) => barAiOn(settings, policy, { keyMode: (provider) => keyStore().mode(provider) }),
  // (asks the browser at once, before anything is awaited; resolves only when the panel is open: src/lib/platform.js)
  openPanel: (tabId) => openPanel(api, tabId),
  // storage.session: the panel can read it, a content script cannot
  saveLaunch: (launch) => chrome.storage.session.set({ [LAUNCH_KEY]: launch }),
};

// The keyboard shortcuts (manifest commands; src/background/commands.js): open the panel, or open it and start Summarise / Draft a reply.
// (No await before handleCommand: the panel can only be opened while the key press is still being handled.)
// The page is asked with the organisation's policy, as the panel asks it (the content script reads to answer; src/lib/messages.js).
chrome.commands?.onCommand.addListener((command, tab) => {
  handleCommand(command, tab, { ...barDeps, pageState: async (tabId) => chrome.tabs.sendMessage(tabId, pageStateMessage(await loadPolicy())) }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    // The bar's two requests come from a content script; it is checked inside handleBarMessage, before anything else runs.
    // (No await before it: the panel can only be opened while the click that asked for it is still being handled.)
    if (BAR_TYPES.has(message?.type)) return handleBarMessage(message, sender, barDeps);
    // Everything else: only this extension's own pages may ask the worker for anything.
    checkExtensionSender(sender, OWN);
    switch (message?.type) {
      case MSG.ENABLE_INSTANCE:
        return enableInstance(message.origin);
      case MSG.DISABLE_INSTANCE:
        return disableInstance(message.origin);
      case MSG.LIST_INSTANCES: {
        const [instances, settings, policy] = await Promise.all([activeInstances(), loadSettings(), loadPolicy()]);
        // `listed` says which came from the organisation (Settings shows those without a Turn off button).
        return { instances, listed: describeInstances(instances, settings, policy) };
      }
      default:
        throw new Error('Unknown request.');
    }
  })()
    .then(sendResponse)
    .catch((err) => sendResponse(toWireError(err)));
  return true; // answer asynchronously
});

// (the toolbar button is set up above, on every start)
const setup = () => syncContentScripts().catch(() => []);
chrome.runtime.onInstalled.addListener(async ({ reason } = {}) => {
  const origins = await setup();
  // After an update the content scripts in the open ServiceNow tabs belong to the old version and can no longer reach the extension;
  // without a fresh copy the bar and the panel would stop working there until each tab is reloaded. The fresh copy replaces the old
  // one (src/content/index.js), whose bar removes itself. At install, an organisation's instances work in the tabs already open.
  if (!reinjectAfterInstalled(reason)) return;
  for (const origin of origins || []) {
    // eslint-disable-next-line no-await-in-loop -- a handful of sites at most
    await injectIntoOpenTabs(origin).catch(() => {});
  }
});
chrome.runtime.onStartup.addListener(setup);
// A permission taken away in the browser's own UI, or a policy change, must be reflected straight away.
chrome.permissions.onRemoved.addListener(() => syncContentScripts().catch(() => {}));
// A site granted in the browser's own site-access menu may be one the organisation lists: it is turned on at once.
chrome.permissions.onAdded?.addListener(async () => {
  const before = new Set((await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_ID] }).catch(() => []))[0]?.matches || []);
  const origins = await syncContentScripts().catch(() => []);
  for (const origin of origins) {
    // eslint-disable-next-line no-await-in-loop
    if (!before.has(instancePattern(origin))) await injectIntoOpenTabs(origin).catch(() => {});
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed') syncContentScripts().catch(() => {});
});
