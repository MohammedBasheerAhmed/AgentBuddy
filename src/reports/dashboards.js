// Saved dashboards: which sections and custom reports a person put on a dashboard, in which order, for which scope and
// tables. CONFIGURATION ONLY. Nothing a report read (no number, no name, no ticket) is ever stored; widgets are re-read each
// time. Stored in chrome.storage.local under `agentbuddy_dashboards`, versioned, size-capped, and cleaned on every load
// so a hand-edited or corrupt value cannot break the panel. Pure given an injected storage; tested in tests/reports-dashboards.test.js
// and tests/team-dashboards.test.js.
//
// PER INSTANCE. A dashboard names groups by sys_id, and a sys_id means nothing on another instance: shown there it matched no ticket
// and drew zeros that looked real. So what is stored is { version: 2, instances: { '<origin>': { version: 1, activeId, dashboards } } }:
// each ServiceNow instance has its own dashboards. The one-list format of earlier versions is adopted by the first instance that
// loads it (its chosen groups are then checked against that instance by the engine, src/reports/engine/scope.js).
import { SECTION_IDS, REPORT_TABLE_IDS } from './engine/constants.js';
import { normalizeScope } from './engine/scope.js';
import { normalizeBuilderConfig } from './engine/builder.js';
import { TREND_CHOICES } from './engine/quality.js';
import { LAYOUT_KIND, LAYOUT_MAX_CHARS, LAYOUT_VERSION, layoutEnvelopeProblem } from './layoutFile.js';
import { isolate, t, tm } from '../i18n/core.js';

export { LAYOUT_KIND, LAYOUT_VERSION };

export const DASHBOARDS_KEY = 'agentbuddy_dashboards';
/** The version of ONE instance's dashboards ({ version, activeId, dashboards }). */
export const DASHBOARDS_VERSION = 1;
/** The version of what is stored under DASHBOARDS_KEY ({ version, instances }). */
export const STORE_VERSION = 2;
export const CAPS = Object.freeze({ dashboards: 12, widgets: 24, name: 60, bytes: 60000, instances: 10, file: LAYOUT_MAX_CHARS });

/** The key a ServiceNow address is stored under: its origin in lower case ('https://acme.service-now.com'), or '' when it has none. */
export function instanceKey(href) {
  try {
    const url = new URL(String(href || ''));
    return /^https?:$/.test(url.protocol) ? url.origin.toLowerCase() : '';
  } catch {
    return '';
  }
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const cleanName = (value, fallback) => {
  // eslint-disable-next-line no-control-regex -- control characters are what it takes out
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CAPS.name);
  return text || fallback;
};
// Two dashboard names are the same dashboard when they differ only in case (the organisation's dashboard is matched by its name).
const nameKey = (name) => String(name ?? '').trim().toLowerCase();

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
    // Not 'My day': the My work screen is that. This is the same dashboard as the others, for one's own tickets only.
    name: tm('My numbers'),
    scope: { kind: 'mine' },
    tables: null,
    widgets: [{ type: 'section', section: 'overview' }, { type: 'section', section: 'sla' }, { type: 'section', section: 'fulfilment' }],
  },
  {
    id: 'preset-team',
    name: tm('Team overview'),
    scope: { kind: 'groups' },
    tables: null,
    // Insights only. "Explain this dashboard" is under the Team screen's AI Assist half and explains these sections' numbers.
    widgets: [
      { type: 'section', section: 'overview' },
      { type: 'section', section: 'workload' },
      { type: 'section', section: 'sla' },
      { type: 'section', section: 'quality' },
      { type: 'section', section: 'fulfilment' },
    ],
  },
  {
    id: 'preset-handover',
    name: tm('Shift handover'),
    scope: { kind: 'groups' },
    tables: null,
    // The hand-over tables (N16). The note written from them is under AI Assist (AI28).
    widgets: [{ type: 'section', section: 'handover' }],
  },
]);

function presetDashboard(preset, makeId) {
  return sanitizeDashboard({ ...preset, widgets: preset.widgets.map((w) => ({ ...w, id: makeId('w') })) }, makeId);
}

/**
 * The dashboards of a first run. `lead`: the person works as a team lead, so the first thing shown is Team overview for their groups;
 * anyone else (who opened Team through 'Show everything') starts with their own tickets. `org`: the organisation's dashboard (the
 * policy's `defaultDashboard`, a layout): when it is one this version can show, it comes first and is the one on show, for a lead too;
 * a ready-made dashboard of the same name gives way to it.
 */
export function defaultState(makeId = randomId, { lead = false, org = null } = {}) {
  const own = org ? orgDashboard(org, makeId) : null;
  const presets = PRESETS.filter((p) => !own || nameKey(p.name) !== nameKey(own.name)).map((p) => presetDashboard(p, makeId));
  const dashboards = own ? [own, ...presets] : presets;
  const first = own || (lead ? dashboards.find((d) => d.id === 'preset-team') : null);
  return { version: DASHBOARDS_VERSION, activeId: (first || dashboards[0]).id, dashboards };
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
  const tables = Array.isArray(input.tables) ? input.tables.filter((table, i, all) => REPORT_TABLE_IDS.includes(table) && all.indexOf(table) === i) : [];
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
export function sanitizeState(stored, makeId = randomId, { lead = false, org = null } = {}) {
  const defaults = () => defaultState(makeId, { lead, org });
  if (stored === undefined || stored === null) return { state: defaults(), status: 'empty' };
  if (typeof stored !== 'object' || Array.isArray(stored)) return { state: defaults(), status: 'corrupt' };
  if (Number(stored.version) > DASHBOARDS_VERSION) return { state: defaults(), status: 'newer' };
  if (Number(stored.version) !== DASHBOARDS_VERSION || !Array.isArray(stored.dashboards)) return { state: defaults(), status: 'corrupt' };
  const ids = new Set();
  const dashboards = [];
  for (const d of stored.dashboards) {
    const clean = sanitizeDashboard(d, makeId);
    if (!clean || ids.has(clean.id)) continue;
    ids.add(clean.id);
    dashboards.push(clean);
    if (dashboards.length >= CAPS.dashboards) break;
  }
  if (!dashboards.length) return { state: defaults(), status: 'corrupt' };
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

// ---- Layout files (export and import) --------------------------------------------------------------------------------
// A dashboard's layout can be saved as a small JSON file and loaded again (on another computer, another instance, or by a colleague).
// The file holds the same configuration as storage and nothing else: sections, order, scope, tables, a name. Loading one is checked
// exactly like storage (sanitizeDashboard): unknown keys are dropped, names are cut short, unknown sections are left out.

// LAYOUT_KIND and LAYOUT_VERSION live in ./layoutFile.js (exported again above), with the check of a file's envelope.

/** The file for one dashboard: { kind, version, dashboard: { name, scope, tables, widgets } } (no ids; they are made on import). */
export function exportLayout(dashboard) {
  let n = 0;
  const clean = sanitizeDashboard(dashboard, (prefix) => `${prefix}-${(n += 1)}`);
  if (!clean) return null;
  // "Every table" is said by leaving `tables` out, not as null: the same file then also works as the organisation's
  // defaultDashboard policy, where the browser's policy schema may refuse a null.
  return {
    kind: LAYOUT_KIND,
    version: LAYOUT_VERSION,
    dashboard: { name: clean.name, scope: clean.scope, ...(clean.tables ? { tables: clean.tables } : {}), widgets: clean.widgets.map(({ id, ...rest }) => rest) },
  };
}

/** 'agent-buddy-dashboard-team-overview.json'. */
export function layoutFileName(name) {
  const slug = String(name || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dashboard';
  return `agent-buddy-dashboard-${slug}.json`;
}

// (texts, not constants: the language can change while the page is open)
const notALayout = () => t('The file is not a dashboard layout saved by Agent Buddy.');
const full = () => t('You have {n} dashboards, the most there can be. Remove one first.', { n: CAPS.dashboards });

// The dashboard of a layout whose envelope is checked, cleaned exactly like storage, with new ids. Shared by a file a person loads and
// the organisation's dashboard, so the two are read the same way. { ok: true, dashboard } or { ok: false, code }.
function cleanLayoutDashboard(input, makeId) {
  const widgets = Array.isArray(input.widgets) ? input.widgets.map((w) => (w && typeof w === 'object' ? { ...w, id: makeId('w') } : w)) : [];
  const clean = sanitizeDashboard({ ...input, id: makeId('d'), widgets }, makeId);
  if (!clean) return { ok: false, code: 'not-layout' };
  if (widgets.length && !clean.widgets.length) return { ok: false, code: 'no-section' };
  return { ok: true, dashboard: clean };
}

/**
 * Add the dashboard in a layout file to `state`. Never throws.
 * @returns {{ ok: true, state: object, name: string } | { ok: false, reason: string }}
 */
export function importLayout(text, state, makeId = randomId) {
  const body = String(text ?? '').replace(/^\uFEFF/, '');
  if (!body.trim()) return { ok: false, reason: t('The file is empty.') };
  if (body.length > CAPS.file) return { ok: false, reason: t('The file is too big to be a dashboard layout.') };
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: notALayout() };
  }
  const envelope = layoutEnvelopeProblem(parsed);
  if (envelope) return { ok: false, reason: envelope === 'newer' ? t('The file was saved by a newer version of Agent Buddy.') : notALayout() };
  if (state.dashboards.length >= CAPS.dashboards) return { ok: false, reason: full() };
  const read = cleanLayoutDashboard(parsed.dashboard, makeId);
  if (!read.ok) return { ok: false, reason: read.code === 'no-section' ? t('The file holds no section this version of Agent Buddy knows.') : notALayout() };
  const clean = read.dashboard;
  const taken = new Set(state.dashboards.map((d) => d.name));
  if (taken.has(clean.name)) clean.name = cleanName(`${clean.name.slice(0, CAPS.name - 11)} (imported)`, clean.name);
  return { ok: true, state: { ...state, activeId: clean.id, dashboards: [...state.dashboards, clean] }, name: clean.name };
}

// ---- The organisation's dashboard (policy key `defaultDashboard`, N17) ----------------------------------------------------------
// An organisation can publish one dashboard for everyone: the layout its lead or service owner saved with "Save layout as a file".
// It is a starting point, never a lock. Someone with no dashboards yet on an instance starts with it, first and on show
// (defaultState); someone who already has dashboards is offered it once in the ⋯ menu (offerOrgDashboard, addOrgDashboard). Either
// way it becomes their own copy, which they can change or remove like any other. It is matched by its name: a person who renamed or
// removed their copy is offered it again.

/**
 * The organisation's dashboard, cleaned like a loaded layout file, with new ids; null when `layout` is not a layout this version can
 * show. It must hold at least one section this version knows: an empty dashboard would be an empty first screen.
 * @param {object|null} layout the policy's `defaultDashboard` ({ kind, version, dashboard })
 */
export function orgDashboard(layout, makeId = randomId) {
  if (layoutEnvelopeProblem(layout)) return null;
  const read = cleanLayoutDashboard(layout.dashboard, makeId);
  return read.ok && read.dashboard.widgets.length ? read.dashboard : null;
}

/**
 * What an administrator should hear about the organisation's dashboard (scripts/check-policy.js passes this to policyProblems; the
 * enterprise build treats each as an error). [] when it is shown exactly as written.
 * @returns {{ level: 'error' | 'note', message: string }[]}
 */
export function orgDashboardProblems(layout) {
  const envelope = layoutEnvelopeProblem(layout);
  if (envelope === 'newer') return [{ level: 'error', message: `it was saved by a newer version of Agent Buddy (version ${LAYOUT_VERSION} is read); it is ignored.` }];
  if (envelope) return [{ level: 'error', message: `it is not a dashboard layout ({ "kind": "${LAYOUT_KIND}", "version": ${LAYOUT_VERSION}, "dashboard": { ... } }); it is ignored.` }];
  let n = 0;
  const read = cleanLayoutDashboard(layout.dashboard, (prefix) => `${prefix}-${(n += 1)}`);
  if (!read.ok || !read.dashboard.widgets.length) return [{ level: 'error', message: 'it holds no section this version of Agent Buddy knows, so it is ignored.' }];
  const out = [];
  const input = layout.dashboard;
  if (typeof input.name !== 'string' || !input.name.trim()) out.push({ level: 'note', message: `it has no name; it is shown as "${read.dashboard.name}".` });
  else if (read.dashboard.name !== input.name) out.push({ level: 'note', message: `its name is shown as "${read.dashboard.name}".` });
  const dropped = input.widgets.filter((w) => !sanitizeWidget(w && typeof w === 'object' ? { ...w, id: 'w-0' } : w, () => 'w-0')).length;
  if (dropped) out.push({ level: 'note', message: `${dropped} of its widgets ${dropped === 1 ? 'is' : 'are'} not a section or custom report this version knows and ${dropped === 1 ? 'is' : 'are'} left out.` });
  if (input.widgets.length - dropped > CAPS.widgets) out.push({ level: 'note', message: `only the first ${CAPS.widgets} widgets are used.` });
  return out;
}

/** The organisation's dashboard is set, this version can show it, and `state` has no dashboard of its name: offer to add it. */
export function offerOrgDashboard(state, layout) {
  const own = orgDashboard(layout, (prefix) => `${prefix}-0`);
  return Boolean(own) && !(state?.dashboards || []).some((d) => nameKey(d.name) === nameKey(own.name));
}

/**
 * Add the organisation's dashboard to `state` as the person's own copy, and show it. The same limits as loading a file.
 * @returns {{ ok: true, state: object, name: string } | { ok: false, reason: string }}
 */
export function addOrgDashboard(state, layout, makeId = randomId) {
  const own = orgDashboard(layout, makeId);
  if (!own) return { ok: false, reason: t('Your organisation has not set a dashboard this version of Agent Buddy can show.') };
  if (state.dashboards.some((d) => nameKey(d.name) === nameKey(own.name))) return { ok: false, reason: t('You already have "{name}".', { name: isolate(own.name) }) };
  if (state.dashboards.length >= CAPS.dashboards) return { ok: false, reason: full() };
  return { ok: true, state: { ...state, activeId: own.id, dashboards: [...state.dashboards, own] }, name: own.name };
}

// ---- Storage -------------------------------------------------------------------------------------------------------

/**
 * What is stored, understood. { status, instances, legacy }:
 *   'empty' nothing stored; 'ok' the per-instance format; 'legacy' the one-list format of earlier versions (in `legacy`);
 *   'corrupt' unreadable; 'newer' written by a newer version (left alone). `instances` maps an instance key to its raw state.
 */
export function readStore(stored) {
  if (stored === undefined || stored === null) return { status: 'empty', instances: {}, legacy: null };
  if (typeof stored !== 'object' || Array.isArray(stored)) return { status: 'corrupt', instances: {}, legacy: null };
  const version = Number(stored.version);
  if (version > STORE_VERSION) return { status: 'newer', instances: {}, legacy: null };
  if (version === DASHBOARDS_VERSION && Array.isArray(stored.dashboards)) return { status: 'legacy', instances: {}, legacy: stored };
  if (version !== STORE_VERSION || !stored.instances || typeof stored.instances !== 'object' || Array.isArray(stored.instances)) return { status: 'corrupt', instances: {}, legacy: null };
  const instances = {};
  for (const [key, value] of Object.entries(stored.instances)) {
    // A key is an origin as instanceKey() writes it ('' for a page without one); anything else is dropped.
    if (key !== '' && instanceKey(key) !== key) continue;
    instances[key] = value;
    if (Object.keys(instances).length >= CAPS.instances) break;
  }
  return { status: 'ok', instances, legacy: null };
}

/**
 * @param {{ get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void> }} storage
 * @param {string} [instance] the instance key (instanceKey(page.href)): each instance has its own dashboards
 * @param {boolean} [lead] the person works as a team lead (decides the dashboard shown first on a first run)
 * @param {object|null} [org] the organisation's dashboard (policy `defaultDashboard`): first and on show on a first run
 */
export function createDashboardStore({ storage, makeId = randomId, instance = '', lead = false, org = null }) {
  let readOnly = false;
  const key = instanceKey(instance) || '';
  const first = { lead, org };

  async function write(instances) {
    await storage.set(DASHBOARDS_KEY, { version: STORE_VERSION, instances });
  }

  return {
    /** { state, status } for this instance, and remembers whether a newer version's data must be left alone. */
    async load() {
      let stored;
      try {
        stored = await storage.get(DASHBOARDS_KEY);
      } catch {
        return { state: defaultState(makeId, first), status: 'unavailable' };
      }
      const root = readStore(stored);
      readOnly = root.status === 'newer';
      if (root.status === 'newer') return { state: defaultState(makeId, first), status: 'newer' };
      if (root.status === 'corrupt') return { state: defaultState(makeId, first), status: 'corrupt' };
      if (root.status === 'legacy') {
        // The earlier one-list format becomes this instance's dashboards, and is written back in the new format at once, so a second
        // instance opened later starts with its own ready-made dashboards instead of this one's groups.
        const adopted = sanitizeState(root.legacy, makeId, first);
        if (adopted.status === 'ok') {
          try {
            await write({ [key]: adopted.state });
          } catch {
            /* stays in the old format; the next save writes the new one */
          }
        }
        return adopted;
      }
      if (!Object.prototype.hasOwnProperty.call(root.instances, key)) return { state: defaultState(makeId, first), status: 'empty' };
      return sanitizeState(root.instances[key], makeId, first);
    },
    /** false when nothing was written (newer data on disk, too big, or storage failed). Other instances' dashboards are kept. */
    async save(state) {
      if (readOnly) return false;
      const clean = sanitizeState(state, makeId);
      if (clean.status !== 'ok') return false;
      if (JSON.stringify(clean.state).length > CAPS.bytes) return false;
      try {
        // Read again just before writing: the panel on another instance may have saved in the meantime.
        const root = readStore(await storage.get(DASHBOARDS_KEY));
        if (root.status === 'newer') {
          readOnly = true;
          return false;
        }
        const instances = { ...root.instances };
        delete instances[key];
        // The most instances kept: the ones used longest ago go first (the order of the keys is the order they were last saved in).
        const others = Object.keys(instances);
        others.slice(0, Math.max(0, others.length - (CAPS.instances - 1))).forEach((k) => delete instances[k]);
        instances[key] = clean.state;
        await write(instances);
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

/** This instance's dashboards out of a stored value that changed (another open copy saved), or null when it says nothing usable. */
export function stateForInstance(stored, instance, makeId = randomId) {
  const root = readStore(stored);
  const key = instanceKey(instance) || '';
  if (root.status === 'legacy') return sanitizeState(root.legacy, makeId);
  if (root.status !== 'ok' || !Object.prototype.hasOwnProperty.call(root.instances, key)) return null;
  return sanitizeState(root.instances[key], makeId);
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
