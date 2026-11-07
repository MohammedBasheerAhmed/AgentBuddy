// A fake Chrome for the panel-scope tests (not a test itself). It behaves as Chrome does in the parts that matter:
//   - the side panel has a default and per-tab options; a tab without options of its own has the default; the manifest's default is "on";
//   - sidePanel.open() works only while the click or key press is being handled (`userDoes`) and only for a tab whose panel is on;
//   - a panel that is open on a tab that gets switched off closes;
//   - without the `tabs` permission a tab's address is visible only for the sites the extension has access to (`granted`) and for a tab
//     that was just clicked (activeTab); otherwise tab.url is missing.
// `calls` records what was asked of the browser, in order; `reads` the questions (getOptions, tabs.get, tabs.query).
import { PANEL_PAGE } from '../src/lib/platform.js';

export const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';

export function event() {
  const listeners = [];
  return { listeners, addListener: (fn) => listeners.push(fn), fire: (...args) => listeners.map((fn) => fn(...args)) };
}

/**
 * @param {{ tabs?: object[], active?: string[], granted?: string[], failSetOptions?: boolean, failGetOptions?: boolean,
 *           failTabsGet?: boolean, createFails?: boolean, afterQuery?: () => void }} [options]
 *   tabs: { id, url }  active: the sites turned on (activeInstances())  granted: the sites the browser gave access to (default: active)
 */
export function world({ tabs = [], active = [], granted = active, failSetOptions = false, failGetOptions = false, failTabsGet = false, createFails = false, afterQuery = null } = {}) {
  const calls = [];
  const reads = [];
  const w = { calls, reads, active: [...active], granted: [...granted], clicked: new Set(), openPanels: new Set(), gesture: false, flags: { failSetOptions, failGetOptions, failTabsGet, createFails } };
  const tabMap = new Map(tabs.map((tab) => [tab.id, { ...tab }]));
  const panel = { default: { enabled: true, path: PANEL_PAGE }, byTab: new Map() };
  const effective = (tabId) => ({ ...(panel.byTab.get(tabId) || panel.default) });

  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  };
  // Chrome without the `tabs` permission: no address, except for the sites the extension has access to and a tab that was just clicked.
  const seen = (tab) => {
    if (w.granted.includes(originOf(tab.url)) || w.clicked.has(tab.id)) return { ...tab };
    const rest = { ...tab };
    delete rest.url;
    return rest;
  };

  const events = {
    tabsCreated: event(), tabsUpdated: event(), tabsActivated: event(), tabsReplaced: event(),
    permAdded: event(), permRemoved: event(), storageChanged: event(), actionClicked: event(),
  };

  w.api = {
    runtime: { id: EXT_ID, getURL: (p) => `chrome-extension://${EXT_ID}/${p}`, openOptionsPage: () => (calls.push(['openOptionsPage']), Promise.resolve()) },
    sidePanel: {
      setOptions: (options) => {
        calls.push(['setOptions', options]);
        if (w.flags.failSetOptions) return Promise.reject(new Error('No tab with id.'));
        const { tabId, ...rest } = options;
        if (tabId === undefined) {
          panel.default = { ...panel.default, ...rest };
          if (rest.enabled === false) for (const id of [...w.openPanels]) if (!panel.byTab.has(id)) w.openPanels.delete(id);
        } else {
          panel.byTab.set(tabId, { ...effective(tabId), ...rest });
          if (rest.enabled === false) w.openPanels.delete(tabId); // a panel on a tab that is switched off closes by itself
        }
        return Promise.resolve();
      },
      getOptions: (details) => {
        reads.push(['getOptions', details]);
        if (w.flags.failGetOptions) return Promise.reject(new Error('not now'));
        return Promise.resolve(details?.tabId === undefined ? { ...panel.default } : effective(details.tabId));
      },
      open: (options) => {
        calls.push(['open', options]);
        if (!w.gesture) return Promise.reject(new Error('`sidePanel.open()` may only be called in response to a user gesture.'));
        if (effective(options.tabId).enabled === false) return Promise.reject(new Error(`No active side panel for tabId: ${options.tabId}.`));
        w.openPanels.add(options.tabId);
        return Promise.resolve();
      },
      setPanelBehavior: (options) => (calls.push(['behavior', options]), Promise.resolve()),
    },
    action: { onClicked: events.actionClicked },
    tabs: {
      onCreated: events.tabsCreated,
      onUpdated: events.tabsUpdated,
      onActivated: events.tabsActivated,
      onReplaced: events.tabsReplaced,
      get: (id) => {
        reads.push(['tabs.get', id]);
        if (w.flags.failTabsGet || !tabMap.has(id)) return Promise.reject(new Error(`No tab with id: ${id}.`));
        return Promise.resolve(seen(tabMap.get(id)));
      },
      query: () => {
        reads.push(['tabs.query']);
        const list = [...tabMap.values()].map(seen);
        if (afterQuery) afterQuery();
        return Promise.resolve(list);
      },
      create: (options) => {
        calls.push(['tabs.create', options]);
        return w.flags.createFails ? Promise.reject(new Error('Illegal URL')) : Promise.resolve({ id: 99 });
      },
    },
    permissions: { onAdded: events.permAdded, onRemoved: events.permRemoved },
    storage: { onChanged: events.storageChanged },
  };

  w.events = events;
  w.activeOrigins = async () => [...w.active];
  /** Is the panel on for this tab now (its own setting, else the default)? */
  w.enabled = (tabId) => effective(tabId).enabled !== false;
  w.panelOptions = (tabId) => effective(tabId);
  w.defaultOptions = () => ({ ...panel.default });
  /** What was asked of the browser, without the questions. */
  w.writes = () => calls.map((c) => c.slice());
  w.forget = () => {
    calls.length = 0;
    reads.length = 0;
  };
  /** The tab as the browser hands it over with a click: its address is visible (activeTab). */
  w.clickTab = (tabId) => {
    w.clicked.add(tabId);
    return { ...tabMap.get(tabId) };
  };
  /** Change a tab's address, the way a navigation does (no event: fire the ones the test is about). */
  w.setUrl = (tabId, url) => {
    tabMap.set(tabId, { ...tabMap.get(tabId), url });
  };
  w.addTab = (tab) => {
    tabMap.set(tab.id, { ...tab });
  };
  w.closeTab = (tabId) => {
    tabMap.delete(tabId);
    panel.byTab.delete(tabId);
    w.openPanels.delete(tabId);
  };
  /** The browser handling a click or a key press: the panel can be opened in this turn and not after the first await. */
  w.userDoes = (fn) => {
    w.gesture = true;
    try {
      return fn();
    } finally {
      w.gesture = false;
    }
  };
  /** The worker stopping and starting again: its listeners are gone, the browser keeps what it was told. */
  w.restart = () => {
    for (const e of Object.values(events)) e.listeners.length = 0;
  };
  return w;
}
