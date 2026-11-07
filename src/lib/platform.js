// The one place that knows how the browsers differ for Agent Buddy: which panel the browser has, how it is opened, what the toolbar
// button does, and what the address of the extension's own pages looks like. Everything else asks here instead of assuming Chrome.
//
//   Chrome, Edge  the side panel (sidePanel.open). It is on only for the tabs of the sites the person added: switched off for every
//                 other tab, tab by tab (setPanelDefault, setPanelForTab; the decision is src/background/panelScope.js). The toolbar
//                 button is handled by the extension (wireToolbarButton with a click handler) because a browser does nothing on its
//                 own for a tab whose panel is off. Own pages are chrome-extension://<extension id>.
//   Firefox       the sidebar (sidebarAction). The toolbar button toggles it from action.onClicked. Own pages are
//                 moz-extension://<a random id made at install>, which is NOT runtime.id (that is the add-on's id).
//   Safari        a later phase: no panel API yet ('none'). Its panel will be a window of its own; the places that will open it are
//                 marked "Safari" below. Own pages are safari-web-extension://<a random id>.
//
// The browser is told apart by what its API has (feature detection), never by its user agent string. Every function takes the
// browser's API object (chrome, or browser in Firefox) as an argument, so tests pass a fake one (tests/platform.test.js).

/** The address schemes of an extension's own pages, in Chrome and Edge, Firefox and Safari. */
export const EXTENSION_SCHEMES = Object.freeze(['chrome-extension:', 'moz-extension:', 'safari-web-extension:']);

// The host part of an extension page's address: Chrome's 32 letters, or a UUID (Firefox lower case, Safari upper case). Nothing
// else is believed to be one.
const EXTENSION_HOST_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The browser's extension API: `browser` where the browser has it (Firefox, Safari), else `chrome`. `browser` is believed only when
 * it really is the API: in a content script a page element with id="browser" shows up as window.browser.
 * @param {object} [scope] globalThis (a fake in tests)
 */
export function browserApi(scope = globalThis) {
  const candidate = scope?.browser;
  if (candidate && typeof candidate.runtime?.getURL === 'function') return candidate;
  return scope?.chrome ?? null;
}

/**
 * Which panel this browser has: 'side-panel' (Chrome, Edge), 'sidebar' (Firefox) or 'none' (Safari for now).
 * @param {object} api the browser's extension API (browserApi())
 * @returns {'side-panel'|'sidebar'|'none'}
 */
export function panelKind(api) {
  if (typeof api?.sidePanel?.open === 'function') return 'side-panel';
  if (typeof api?.sidebarAction?.open === 'function') return 'sidebar';
  return 'none';
}

// Firefox opens the sidebar only while a click or a key press on the browser itself is being handled (the toolbar button, a keyboard
// shortcut). A click on the bar on the ServiceNow page reaches the background as a message from the content script, which Firefox
// does not count as one, so open() is refused. If the sidebar is open already, it picks up the request by itself (src/lib/launch.js),
// so that counts as opened; if not, the bar tells the person to use the toolbar button.
function openSidebar(sidebar) {
  let opening;
  try {
    opening = Promise.resolve(sidebar.open()); // (called now, in the same turn as the click or key press)
  } catch (err) {
    opening = Promise.reject(err);
  }
  return opening.then(
    () => undefined,
    async (err) => {
      let open = false;
      try {
        open = (await sidebar.isOpen({})) === true; // {}: the window the person is in
      } catch {
        /* not known: treated as closed */
      }
      if (!open) throw err;
    }
  );
}

/** The page the side panel shows (manifest.json side_panel.default_path; tests/panel-scope-wire.test.js keeps the two the same). */
export const PANEL_PAGE = 'sidepanel.html';

/**
 * Can Agent Buddy switch the side panel on and off tab by tab? Chrome and Edge (116 and later). Firefox's sidebar belongs to the
 * window and cannot be closed from code, and Safari has no panel yet: there the panel is left as it is.
 * @param {object} api the browser's extension API
 */
export function canScopePanel(api) {
  return panelKind(api) === 'side-panel' && typeof api.sidePanel.setOptions === 'function';
}

// What the browser has for a tab (or, with {}, as the default for every tab): { enabled, path } or null when it cannot say.
async function panelOptions(api, details) {
  try {
    const options = await api.sidePanel.getOptions?.(details);
    return options && typeof options === 'object' ? options : null;
  } catch {
    return null;
  }
}

const isTabId = (tabId) => Number.isInteger(tabId) && tabId >= 0;

/**
 * Switch the side panel on or off for every tab that has no setting of its own. Done on every start of the worker, with `false`: a tab
 * is switched on only when it is on an added site. Said again each time, whatever the browser has (a tab with a setting of its own is
 * not touched by it, so there is nothing to disturb). Rejects when the browser refuses.
 * @param {object} api the browser's extension API
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true when the browser was asked
 */
export async function setPanelDefault(api, enabled) {
  if (!canScopePanel(api)) return false;
  await api.sidePanel.setOptions({ enabled });
  return true;
}

/**
 * Switch the side panel on or off for one tab. A panel that is open on a tab that is switched off closes by itself. Asks first and
 * changes nothing that is already right, so a tab that stays on an added site keeps its open panel as it is (a page load on it asks
 * again). Rejects when the browser refuses (the tab has just closed).
 * @param {object} api the browser's extension API
 * @param {number} tabId
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true when something was changed
 */
export async function setPanelForTab(api, tabId, enabled) {
  if (!canScopePanel(api) || !isTabId(tabId)) return false;
  const now = await panelOptions(api, { tabId });
  if (now && (now.enabled !== false) === enabled && (!enabled || now.path === PANEL_PAGE)) return false;
  await api.sidePanel.setOptions(enabled ? { tabId, path: PANEL_PAGE, enabled: true } : { tabId, enabled: false });
  return true;
}

/**
 * Is the side panel switched on for this tab? null when the browser cannot say.
 * @returns {Promise<boolean|null>}
 */
export async function panelEnabledFor(api, tabId) {
  if (!canScopePanel(api) || !isTabId(tabId)) return null;
  const now = await panelOptions(api, { tabId });
  return now ? now.enabled !== false : null;
}

/**
 * Open the panel for the tab `tabId`. The browser's API is called NOW, before this returns: a browser opens its panel only while the
 * click or key press that asked for it is still being handled, and that ends the first time anything is awaited. So call this before
 * your first await. Resolves when the panel is open (or already was), rejects when it is not. In Chrome and Edge a tab whose panel is
 * switched off (a page that is not an added site) refuses.
 * `enable`: Chrome and Edge only. Switch the panel on for this tab in the same turn, before opening it (the browser keeps the order of
 * the two calls), for a ServiceNow page that is not added yet; the other browsers ignore it.
 * @param {object} api the browser's extension API
 * @param {number} tabId
 * @param {{ enable?: boolean }} [options]
 * @returns {Promise<void>}
 */
export function openPanel(api, tabId, { enable = false } = {}) {
  try {
    const kind = panelKind(api);
    if (kind === 'side-panel') {
      if (enable && canScopePanel(api)) {
        try {
          // (not awaited: awaiting would end the click; if the browser refuses, open() below is refused too and says so)
          Promise.resolve(api.sidePanel.setOptions({ tabId, path: PANEL_PAGE, enabled: true })).catch(() => {});
        } catch {
          /* open() below tells the caller */
        }
      }
      return Promise.resolve(api.sidePanel.open({ tabId })).then(() => undefined);
    }
    if (kind === 'sidebar') return openSidebar(api.sidebarAction);
    // Safari (a later phase): open the panel's own window here.
    return Promise.reject(new Error('This browser has no panel for Agent Buddy.'));
  } catch (err) {
    return Promise.reject(err);
  }
}

const wired = new WeakSet();

/**
 * Make the toolbar button open the panel. Call it once, at the top level of the background script, so it runs on every start: in
 * Firefox the background is an event page, and only a listener added while it starts wakes it for the next click.
 *   Chrome, Edge  with `onClick`: the extension handles the click itself (src/background/panelScopeWire.js), because the browser
 *                 opens nothing for a tab whose panel is switched off (a page that is not an added site) and the extension decides
 *                 what that click means there. `onClick(tab)` is called inside the click, before anything is awaited, and must ask
 *                 the browser to open the panel in that same turn (openPanel). Without `onClick` the browser opens the side panel
 *                 itself (setPanelBehavior; it remembers that, so saying it again is harmless).
 *   Firefox       a click toggles the sidebar; toggle() is called inside the listener, before anything is awaited
 *   Safari        (a later phase) nothing yet: the button will open the panel's own window
 * @param {object} api the browser's extension API
 * @param {(tab: object) => any} [onClick] Chrome and Edge only (see above)
 * @returns {'side-panel'|'sidebar'|'none'} what was set up
 */
export function wireToolbarButton(api, onClick) {
  const kind = panelKind(api);
  if (!api || wired.has(api)) return kind; // a second listener would toggle the sidebar open and shut again on one click
  if (kind === 'side-panel') {
    const own = typeof onClick === 'function' && typeof api.action?.onClicked?.addListener === 'function';
    try {
      Promise.resolve(api.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: !own })).catch(() => {});
    } catch {
      /* an older browser: the side panel is still opened from the bar and the keyboard shortcuts */
    }
    if (own) {
      api.action.onClicked.addListener((tab) => {
        try {
          Promise.resolve(onClick(tab)).catch(() => {});
        } catch {
          /* nothing to do: the person can still use the keyboard shortcut or open Settings */
        }
      });
    }
  } else if (kind === 'sidebar') {
    const button = api.action ?? api.browserAction;
    if (typeof button?.onClicked?.addListener !== 'function') return kind;
    const sidebar = api.sidebarAction;
    button.onClicked.addListener(() => {
      try {
        Promise.resolve(typeof sidebar.toggle === 'function' ? sidebar.toggle() : sidebar.open()).catch(() => {});
      } catch {
        /* nothing to do: the person can open the sidebar from the browser's own sidebar menu */
      }
    });
  }
  wired.add(api);
  return kind;
}

/**
 * The origin of an extension page's address ('chrome-extension://abc...'), or '' when the address is not one. Built from the scheme
 * and the host: outside the browser (Node) URL.origin says 'null' for these schemes. An address with a port, a user name or a host
 * that is not an extension id is not an extension page's. The host's letters are kept as they are (Safari's id is upper case), so an
 * address that differs in case is a different origin.
 * @param {string} url
 */
export function extensionUrlOrigin(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return '';
  }
  if (!EXTENSION_SCHEMES.includes(parsed.protocol)) return '';
  if (parsed.port || parsed.username || parsed.password || !EXTENSION_HOST_RE.test(parsed.hostname)) return '';
  return `${parsed.protocol}//${parsed.hostname}`;
}

/**
 * The origin of this extension's own pages (side panel, settings, dashboard), from runtime.getURL(''): chrome-extension://<id> in
 * Chrome and Edge, moz-extension://<uuid> in Firefox, safari-web-extension://<uuid> in Safari. '' when it cannot be known (then
 * nothing counts as one of our pages).
 * @param {object} runtime the browser's runtime API (chrome.runtime)
 */
export function extensionOrigin(runtime) {
  try {
    return extensionUrlOrigin(runtime?.getURL?.(''));
  } catch {
    return ''; // an extension context that is gone (a copy of the content script left over from before an update)
  }
}

/**
 * Who "this extension" is, for the sender checks (src/lib/senderCheck.js): its id (what sender.id carries) and the origin of its own
 * pages. Ask once, when the script starts.
 * @param {object} runtime the browser's runtime API (chrome.runtime)
 * @returns {{ id: string, origin: string }}
 */
export function extensionIdentity(runtime) {
  let id = '';
  try {
    id = typeof runtime?.id === 'string' ? runtime.id : '';
  } catch {
    /* an extension context that is gone */
  }
  return Object.freeze({ id, origin: extensionOrigin(runtime) });
}

/**
 * Can Agent Buddy take the person to the browser's page for changing its keyboard shortcuts? Firefox 137 and later open it themselves
 * (commands.openShortcutSettings); Chrome and Edge open it as a tab. An older Firefox cannot (the person finds it under about:addons,
 * the gear, Manage Extension Shortcuts), nor can Safari.
 * @param {object} api the browser's extension API
 */
export function canOpenShortcutSettings(api) {
  if (typeof api?.commands?.openShortcutSettings === 'function') return true;
  return panelKind(api) === 'side-panel' && typeof api?.tabs?.create === 'function';
}

/**
 * Open the browser's page for changing the keyboard shortcuts. `chromiumPage` is the address Chrome or Edge has it at
 * (chrome://extensions/shortcuts, edge://extensions/shortcuts); other browsers do not use it. Rejects when this browser cannot.
 * @param {object} api the browser's extension API
 * @param {string} chromiumPage
 * @returns {Promise<void>}
 */
export function openShortcutSettings(api, chromiumPage) {
  try {
    if (typeof api?.commands?.openShortcutSettings === 'function') return Promise.resolve(api.commands.openShortcutSettings()).then(() => undefined);
    if (canOpenShortcutSettings(api)) return Promise.resolve(api.tabs.create({ url: chromiumPage })).then(() => undefined);
    return Promise.reject(new Error('This browser cannot open its shortcuts page from an extension.'));
  } catch (err) {
    return Promise.reject(err);
  }
}
