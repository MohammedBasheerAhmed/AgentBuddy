// Agent Buddy service worker. Deliberately small: it holds no keys, makes no AI calls and never talks to ServiceNow.
// Its jobs are (1) open the side panel from the toolbar button, (2) register the content scripts on exactly the
// instances the person enabled (and the browser granted), (3) keep that registration in sync with the permissions, and
// (4) answer the bar on the ServiceNow page: which actions it may show, and "open the panel and run this one" (bar.js).
import { MSG, toWireError } from '../lib/messages.js';
import { checkExtensionSender } from '../lib/senderCheck.js';
import { loadPolicy, loadSettings, saveSettings } from '../lib/storage.js';
import { instancePattern, isInstanceAllowed, normalizeInstance } from '../policy/policy.js';
import { BAR_TYPES, handleBarMessage } from './bar.js';
import { LAUNCH_KEY } from '../lib/launch.js';

const CONTENT_ID = 'ab-content';
const BRIDGE_ID = 'ab-bridge';

// Which instances are active = enabled by the person (or baked in by policy) AND still granted by the browser.
async function activeInstances() {
  const [settings, policy] = await Promise.all([loadSettings(), loadPolicy()]);
  const wanted = (settings.instances || []).map(normalizeInstance).filter((o) => o && isInstanceAllowed(o, policy));
  const granted = [];
  for (const origin of wanted) {
    // eslint-disable-next-line no-await-in-loop -- a handful of origins at most.
    if (await chrome.permissions.contains({ origins: [instancePattern(origin)] })) granted.push(origin);
  }
  return granted;
}

/** Make the registered content scripts match exactly the active instances. */
export async function syncContentScripts() {
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
  if (!origin) throw new Error('That is not a valid https address.');
  const policy = await loadPolicy();
  if (!isInstanceAllowed(origin, policy)) throw new Error('Your organisation has not approved this instance for Agent Buddy.');
  if (!(await chrome.permissions.contains({ origins: [instancePattern(origin)] }))) {
    throw new Error('The browser has not granted access to this site yet. Use the Enable button in the side panel.');
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
  runtimeId: chrome.runtime.id,
  activeInstances,
  loadSettings,
  loadPolicy,
  now: () => Date.now(),
  openPanel: (tabId) => chrome.sidePanel.open({ tabId }),
  // storage.session: the panel can read it, a content script cannot
  saveLaunch: (launch) => chrome.storage.session.set({ [LAUNCH_KEY]: launch }),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    // The bar's two requests come from a content script; it is checked inside handleBarMessage, before anything else runs.
    // (No await before it: the panel can only be opened while the click that asked for it is still being handled.)
    if (BAR_TYPES.has(message?.type)) return handleBarMessage(message, sender, barDeps);
    // Everything else: only this extension's own pages may ask the worker for anything.
    checkExtensionSender(sender, chrome.runtime.id);
    switch (message?.type) {
      case MSG.ENABLE_INSTANCE:
        return enableInstance(message.origin);
      case MSG.DISABLE_INSTANCE:
        return disableInstance(message.origin);
      case MSG.LIST_INSTANCES:
        return { instances: await activeInstances() };
      default:
        throw new Error('Unknown request.');
    }
  })()
    .then(sendResponse)
    .catch((err) => sendResponse(toWireError(err)));
  return true; // answer asynchronously
});

const setup = () => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  syncContentScripts().catch(() => {});
};
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
// A permission taken away in the browser's own UI, or a policy change, must be reflected straight away.
chrome.permissions.onRemoved.addListener(() => syncContentScripts().catch(() => {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed') syncContentScripts().catch(() => {});
});
