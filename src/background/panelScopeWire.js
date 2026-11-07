// The side panel only on the ServiceNow sites the person added (Chrome and Edge). The rules are pure (panelScope.js); this is the thin part
// that asks the browser. Nothing is remembered between wake-ups of the worker: every start sets the default to "off" and goes over every
// open tab, and every tab event looks at that one tab again, with the active sites read afresh. The browser's own record of what is on
// for a tab is the only state (the calls in src/lib/platform.js ask it first and change only what is not right).
//
//   at every start     the panel is off by default; each open tab is switched on if it is a page of an added site, else off
//   a tab is made, loads, changes address, is shown or is replaced     that tab is looked at again
//   a permission is added     tabs of the site are switched on, nothing is switched off: "Turn on for this site" grants the permission
//                             first and saves the site a moment later, and switching the tab off in between would close the panel
//                             the person is using. The save is a storage change, which looks at every tab.
//   a permission is removed, the list of sites or the organisation's policy changes     every tab is looked at again
//   the toolbar button     see onToolbarClick
//
// A failing call never throws out of a listener: the next event tries again. Firefox and Safari are left as they are (canScopePanel).
import { canScopePanel, openPanel, panelEnabledFor, setPanelDefault, setPanelForTab } from '../lib/platform.js';
import { SETTINGS_KEY } from '../lib/storage.js';
import { afterRefusal, clickPlan, scopeChangeMatters, scopeFor, tabChangeMatters } from './panelScope.js';

/** Where "add a site" is: the Settings page, opened on its ServiceNow sites section (src/options/Options.jsx follows #h-...). */
export const INSTANCES_SETTINGS_PAGE = 'options.html#h-instances';

const isTabId = (tabId) => Number.isInteger(tabId) && tabId >= 0;

/**
 * @param {object} api the browser's extension API (chrome)
 * @param {{ activeOrigins: () => Promise<string[]>, settingsKey?: string }} deps
 *   activeOrigins: the active sites (activeInstances() in the worker: turned on, allowed and granted)
 * @returns {{
 *   active: boolean, onToolbarClick: ((tab: object) => Promise<string>)|undefined,
 *   syncTab: (tabId: number, options?: { onlyEnable?: boolean }) => Promise<void>, syncAll: (options?: { onlyEnable?: boolean }) => Promise<void>,
 *   idle: () => Promise<void>
 * }}
 */
export function wirePanelScope(api, { activeOrigins, settingsKey = SETTINGS_KEY }) {
  if (!canScopePanel(api)) {
    return { active: false, onToolbarClick: undefined, syncTab: async () => {}, syncAll: async () => {}, idle: async () => {} };
  }

  const running = new Set(); // the work in flight, for idle()
  const track = (promise) => {
    running.add(promise);
    promise.then(() => running.delete(promise), () => running.delete(promise));
    return promise;
  };

  // One tab is looked at one job at a time, in the order asked: two events for it close together (a load that starts and ends) must not
  // ask the browser in a mixed-up order. Other tabs go in parallel. (Scheduling only; what the browser has is the state.)
  const lines = new Map();
  function inOrder(tabId, job) {
    const before = lines.get(tabId) || Promise.resolve();
    const run = before.then(job);
    const tail = run.then(() => {}, () => {});
    lines.set(tabId, tail);
    tail.then(() => {
      if (lines.get(tabId) === tail) lines.delete(tabId);
    });
    return run;
  }

  // The active sites, or null when they cannot be read: then nothing is changed (reading badly must not switch every panel off).
  async function readOrigins() {
    try {
      const list = await activeOrigins();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  }

  // The default for every tab is "off". Every tab job waits for it: asking a tab's state before the default is set could see the
  // manifest's "on" and wrongly leave the tab as it is.
  const ready = setPanelDefault(api, false).catch(() => {});

  // Look at one tab again (its address as it is now) and set the panel to match. onlyEnable: switch on, never off.
  function lookAtTab(tabId, origins, onlyEnable) {
    return inOrder(tabId, async () => {
      await ready;
      let tab;
      try {
        tab = await api.tabs.get(tabId);
      } catch {
        return; // the tab has closed
      }
      const sites = origins || (await readOrigins());
      if (!sites) return;
      const enabled = scopeFor(tab, sites).enabled;
      if (!enabled && onlyEnable) return;
      try {
        await setPanelForTab(api, tabId, enabled);
      } catch {
        /* the tab closed meanwhile, or the browser refused: the next event looks again */
      }
    }).catch(() => {});
  }

  function syncTab(tabId, { onlyEnable = false } = {}) {
    if (!isTabId(tabId)) return Promise.resolve();
    return track(lookAtTab(tabId, null, onlyEnable));
  }

  function syncAll({ onlyEnable = false } = {}) {
    return track(
      (async () => {
        await ready;
        let tabs;
        try {
          tabs = await api.tabs.query({});
        } catch {
          return;
        }
        const origins = await readOrigins();
        if (!origins) return;
        await Promise.all((tabs || []).filter((tab) => isTabId(tab?.id)).map((tab) => lookAtTab(tab.id, origins, onlyEnable)));
      })().catch(() => {})
    );
  }

  async function openInstancesSettings() {
    try {
      await api.tabs.create({ url: api.runtime.getURL(INSTANCES_SETTINGS_PAGE) });
    } catch {
      try {
        await api.runtime.openOptionsPage();
      } catch {
        /* nothing more to try */
      }
    }
  }

  /**
   * A click on the toolbar button, called by the browser with the tab that was clicked (its address is visible: activeTab). Nothing is
   * awaited before the browser is asked to open the panel; everything after depends on how that went.
   *   an added site         the panel is on for the tab already, so it opens
   *   looks like ServiceNow, not added     the panel is switched on for the tab and opened in the same turn, so its "Turn on for this
   *                         site" can be used
   *   any other page        the browser refuses (the panel is off there): Settings opens at the ServiceNow sites instead
   * @returns {Promise<'opened'|'settings'|'failed'|'ignored'>}
   */
  function onToolbarClick(tab) {
    const tabId = tab?.id;
    if (!isTabId(tabId)) return Promise.resolve('ignored');
    const { enable } = clickPlan(tab);
    const opening = openPanel(api, tabId, { enable }); // (the browser is asked now, in this turn)
    return track(
      opening
        .then(() => true, () => false)
        .then(async (opened) => {
          // An open that was accepted for a tab the browser says is off cannot be believed; one for a tab just switched on is.
          if (opened && (enable || (await panelEnabledFor(api, tabId)) !== false)) return 'opened';
          const origins = (await readOrigins()) || [];
          if (afterRefusal(tab, origins) === 'settings') {
            await openInstancesSettings();
            return 'settings';
          }
          // An added site that was not switched on yet (the browser has just started): switch it on, so the next click opens it.
          if (scopeFor(tab, origins).kind === 'added') await syncTab(tabId);
          return 'failed';
        })
        .catch(() => 'failed')
    );
  }

  // Listeners are added here, at the top level of the worker, so they wake it after it was stopped.
  const guard = (fn) => (...args) => {
    try {
      Promise.resolve(fn(...args)).catch(() => {});
    } catch {
      /* a listener never throws */
    }
  };
  api.tabs?.onCreated?.addListener?.(guard((tab) => syncTab(tab?.id)));
  api.tabs?.onUpdated?.addListener?.(guard((tabId, changeInfo) => (tabChangeMatters(changeInfo) ? syncTab(tabId) : undefined)));
  api.tabs?.onActivated?.addListener?.(guard((info) => syncTab(info?.tabId)));
  api.tabs?.onReplaced?.addListener?.(guard((addedTabId) => syncTab(addedTabId)));
  api.permissions?.onAdded?.addListener?.(guard(() => syncAll({ onlyEnable: true })));
  api.permissions?.onRemoved?.addListener?.(guard(() => syncAll()));
  api.storage?.onChanged?.addListener?.(guard((changes, area) => (scopeChangeMatters(changes, area, settingsKey) ? syncAll() : undefined)));

  syncAll(); // every open tab, now

  async function idle() {
    await ready;
    while (running.size) await Promise.all([...running]); // eslint-disable-line no-await-in-loop -- until nothing new was started
  }

  return { active: true, onToolbarClick, syncTab, syncAll, idle };
}
