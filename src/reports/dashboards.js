// Saved dashboards: which sections and custom reports a person put on a dashboard, in which order, for which scope and
// tables. CONFIGURATION ONLY. Nothing a report read (no number, no name, no ticket) is ever stored; widgets are re-read each
// time. Stored in chrome.storage.local under `agentbuddy_dashboards`, versioned, size-capped, and cleaned on every load
// so a hand-edited or corrupt value cannot break the panel. Pure given an injected storage; tested in tests/reports-dashboards.test.js.
import { SECTION_IDS, REPORT_TABLE_IDS } from './engine/constants.js';
import { normalizeScope } from './engine/scope.js';
import { normalizeBuilderConfig } from './engine/builder.js';
import { TREND_CHOICES } from './engine/quality.js';

export const DASHBOARDS_KEY = 'agentbuddy_dashboards';
export const DASHBOARDS_VERSION = 1;
export const CAPS = Object.freeze({ dashboards: 12, widgets: 24, name: 60, bytes: 60000 });

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const cleanName = (value, fallback) => {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CAPS.name);
  return text || fallback;
};

/** A new random id: lower-case letters and digits. Injected in tests. */
export function randomId(prefix = 'x') {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;
}

// ---- Ready-made dashboards -----------------------------------------------------------------------------------------

export const PRESETS = Object.freeze([
  {
    id: 'preset-my-day',
    name: 'My day at a glance',
    scope: { kind: 'mine' },
    tables: null,
    widgets: [{ type: 'section', section: 'overview' }, { type: 'section', section: 'sla' }, { type: 'section', section: 'fulfilment' }],
  },
  {
    id: 'preset-team',
    name: 'Team overview',
    scope: { kind: 'groups' },
    tables: null,
    widgets: [{ type: 'section', section: 'overview' }, { type: 'section', section: 'workload' }, { type: 'section', section: 'sla' }, { type: 'section', section: 'quality' }, { type: 'section', section: 'fulfilment' }],
  },
]);

function presetDashboard(preset, makeId) {
  return sanitizeDashboard({ ...preset, widgets: preset.widgets.map((w) => ({ ...w, id: makeId('w') })) }, makeId);
}

export function defaultState(makeId = randomId) {
  const dashboards = PRESETS.map((p) => presetDashboard(p, makeId));
  return { version: DASHBOARDS_VERSION, activeId: dashboards[0].id, dashboards };
}

// ---- Cleaning ------------------------------------------------------------------------------------------------------

export function sanitizeWidget(input, makeId = randomId) {
  const id = ID_RE.test(String(input?.id || '')) ? input.id : makeId('w');
  if (input?.type === 'builder') return { id, type: 'builder', builder: normalizeBuilderConfig(input.builder) };
  if (input?.type === 'section' && SECTION_IDS.includes(input.section)) {
    const widget = { id, type: 'section', section: input.section };
    const params = {};
    if (TREND_CHOICES.some((c) => c.id === input.params?.trend)) params.trend = input.params.trend;
    const stale = Math.floor(Number(input.params?.staleDays));
    if (Number.isFinite(stale) && stale >= 1 && stale <= 60) params.staleDays = stale;
    if (Object.keys(params).length) widget.params = params;
    return widget;
  }
  return null;
}

export function sanitizeDashboard(input, makeId = randomId) {
  if (!input || typeof input !== 'object') return null;
  const id = ID_RE.test(String(input.id || '')) ? input.id : makeId('d');
  let scope;
  try {
    scope = normalizeScope(input.scope);
  } catch {
    scope = normalizeScope({ kind: 'mine' });
  }
  const tables = Array.isArray(input.tables) ? input.tables.filter((t, i, all) => REPORT_TABLE_IDS.includes(t) && all.indexOf(t) === i) : [];
  const seen = new Set();
  const widgets = [];
  for (const w of Array.isArray(input.widgets) ? input.widgets : []) {
    const clean = sanitizeWidget(w, makeId);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    widgets.push(clean);
    if (widgets.length >= CAPS.widgets) break;
  }
  return { id, name: cleanName(input.name, 'My dashboard'), scope, tables: tables.length ? tables : null, widgets };
}

/**
 * Whatever was in storage, as a valid state. `status` says what happened:
 *   'ok' it was valid (possibly tidied), 'empty' nothing stored yet, 'corrupt' unreadable (defaults used),
 *   'newer' written by a newer version of Agent Buddy (defaults used in memory, the stored value is never overwritten).
 */
export function sanitizeState(stored, makeId = randomId) {
  if (stored === undefined || stored === null) return { state: defaultState(makeId), status: 'empty' };
  if (typeof stored !== 'object' || Array.isArray(stored)) return { state: defaultState(makeId), status: 'corrupt' };
  if (Number(stored.version) > DASHBOARDS_VERSION) return { state: defaultState(makeId), status: 'newer' };
  if (Number(stored.version) !== DASHBOARDS_VERSION || !Array.isArray(stored.dashboards)) return { state: defaultState(makeId), status: 'corrupt' };
  const ids = new Set();
  const dashboards = [];
  for (const d of stored.dashboards) {
    const clean = sanitizeDashboard(d, makeId);
    if (!clean || ids.has(clean.id)) continue;
    ids.add(clean.id);
    dashboards.push(clean);
    if (dashboards.length >= CAPS.dashboards) break;
  }
  if (!dashboards.length) return { state: defaultState(makeId), status: 'corrupt' };
  const activeId = dashboards.some((d) => d.id === stored.activeId) ? stored.activeId : dashboards[0].id;
  return { state: { version: DASHBOARDS_VERSION, activeId, dashboards }, status: 'ok' };
}

// ---- Changes (pure: each returns a new state) ----------------------------------------------------------------------

const mapDashboard = (state, id, fn) => ({ ...state, dashboards: state.dashboards.map((d) => (d.id === id ? fn(d) : d)) });

export function addDashboard(state, { name, scope, tables, widgets } = {}, makeId = randomId) {
  if (state.dashboards.length >= CAPS.dashboards) return state;
  const dashboard = sanitizeDashboard({ name: cleanName(name, 'New dashboard'), scope: scope || { kind: 'mine' }, tables, widgets: (widgets || []).map((w) => ({ ...w, id: makeId('w') })) }, makeId);
  dashboard.id = makeId('d');
  return { ...state, activeId: dashboard.id, dashboards: [...state.dashboards, dashboard] };
}

export function addPresetDashboard(state, presetId, makeId = randomId) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset || state.dashboards.length >= CAPS.dashboards || state.dashboards.some((d) => d.id === presetId)) return state;
  const dashboard = presetDashboard(preset, makeId);
  return { ...state, activeId: dashboard.id, dashboards: [...state.dashboards, dashboard] };
}

/** Never removes the last dashboard (a panel with none would have nothing to show). */
export function removeDashboard(state, id) {
  if (state.dashboards.length <= 1) return state;
  const dashboards = state.dashboards.filter((d) => d.id !== id);
  return { ...state, dashboards, activeId: dashboards.some((d) => d.id === state.activeId) ? state.activeId : dashboards[0].id };
}

export const renameDashboard = (state, id, name) => mapDashboard(state, id, (d) => ({ ...d, name: cleanName(name, d.name) }));
export const setActive = (state, id) => (state.dashboards.some((d) => d.id === id) ? { ...state, activeId: id } : state);

/** Change a dashboard's scope and/or table set. */
export function setDashboardSetup(state, id, { scope, tables }) {
  return mapDashboard(state, id, (d) => {
    const next = sanitizeDashboard({ ...d, scope: scope ?? d.scope, tables: tables === undefined ? d.tables : tables }, randomId);
    return { ...d, scope: next.scope, tables: next.tables };
  });
}

export function addWidget(state, dashboardId, widget, makeId = randomId) {
  return mapDashboard(state, dashboardId, (d) => {
    if (d.widgets.length >= CAPS.widgets) return d;
    const clean = sanitizeWidget({ ...widget, id: makeId('w') }, makeId);
    return clean ? { ...d, widgets: [...d.widgets, clean] } : d;
  });
}

export const removeWidget = (state, dashboardId, widgetId) => mapDashboard(state, dashboardId, (d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== widgetId) }));

export function updateWidget(state, dashboardId, widgetId, patch) {
  return mapDashboard(state, dashboardId, (d) => ({
    ...d,
    widgets: d.widgets.map((w) => (w.id === widgetId ? sanitizeWidget({ ...w, ...patch, id: w.id }) || w : w)),
  }));
}

/** Move a widget up (-1) or down (+1) by one place; at the ends nothing changes. */
export function moveWidget(state, dashboardId, widgetId, delta) {
  return mapDashboard(state, dashboardId, (d) => {
    const from = d.widgets.findIndex((w) => w.id === widgetId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= d.widgets.length) return d;
    const widgets = [...d.widgets];
    [widgets[from], widgets[to]] = [widgets[to], widgets[from]];
    return { ...d, widgets };
  });
}

// ---- Storage -------------------------------------------------------------------------------------------------------

/**
 * @param {{ get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void> }} storage
 */
export function createDashboardStore({ storage, makeId = randomId }) {
  let readOnly = false;
  return {
    /** { state, status } and remembers whether a newer version's data must be left alone. */
    async load() {
      let stored;
      try {
        stored = await storage.get(DASHBOARDS_KEY);
      } catch {
        return { state: defaultState(makeId), status: 'unavailable' };
      }
      const answer = sanitizeState(stored, makeId);
      readOnly = answer.status === 'newer';
      return answer;
    },
    /** false when nothing was written (newer data on disk, too big, or storage failed). */
    async save(state) {
      if (readOnly) return false;
      const clean = sanitizeState(state, makeId);
      if (clean.status !== 'ok') return false;
      if (JSON.stringify(clean.state).length > CAPS.bytes) return false;
      try {
        await storage.set(DASHBOARDS_KEY, clean.state);
        return true;
      } catch {
        return false;
      }
    },
    get readOnly() {
      return readOnly;
    },
  };
}

/** The real storage: chrome.storage.local. Only extension pages call this. */
export function chromeLocalStorage() {
  return {
    async get(key) {
      return (await chrome.storage.local.get(key))[key];
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}
