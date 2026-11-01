// What the Team screen's two halves share, in memory only (TRACKER.md 2.1: "both halves follow the same context, nothing is read
// again"). The Insights half (the dashboard) loads the numbers; the AI Assist half explains them and writes the hand-over note from
// them, so it must see exactly what Insights read:
//   loaded      the results the dashboard's widgets have loaded (src/reports/ai/loaded.js): engine JSON, never stored
//   live        how many Insights dashboards are on screen for this tab and instance (0: AI Assist reads the numbers itself)
//   asOf        the dashboard's "as of" instant for its current load, so a read AI Assist makes asks the same questions (cache hits)
//   refreshKey  bumps when the dashboard is refreshed, so AI Assist reads again too
// Nothing here touches chrome.storage: closing the panel drops it all. One share per ServiceNow tab and instance.
import { createLoadedStore } from '../../reports/ai/loaded.js';
import { instanceKey } from '../../reports/dashboards.js';

const shares = new Map();

/** The share key for a page: its tab and its instance. */
export const shareKey = (page) => `${page?.tabId ?? ''}|${instanceKey(page?.href)}`;

function createShare() {
  const listeners = new Set();
  let version = 0;
  const share = {
    loaded: createLoadedStore(),
    live: 0,
    asOf: 0,
    refreshKey: 0,
    dashboardId: '',
    emit() {
      version += 1;
      listeners.forEach((fn) => fn());
    },
    /** The dashboard (Insights) says what it shows now. */
    set(patch) {
      let changed = false;
      for (const [k, v] of Object.entries(patch || {})) {
        if (['asOf', 'refreshKey', 'dashboardId'].includes(k) && share[k] !== v) {
          share[k] = v;
          changed = true;
        }
      }
      if (changed) share.emit();
    },
    /** An Insights dashboard mounted (+1) or went away (-1). */
    mount(delta) {
      share.live = Math.max(0, share.live + delta);
      share.emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Changes whenever anything above changed (for useSyncExternalStore). */
    version: () => version,
  };
  return share;
}

/** The share for this page (created on first use). */
export function teamShare(page) {
  const key = shareKey(page);
  if (!shares.has(key)) shares.set(key, createShare());
  return shares.get(key);
}

/** Forget every share (tests). */
export const resetTeamShares = () => shares.clear();
