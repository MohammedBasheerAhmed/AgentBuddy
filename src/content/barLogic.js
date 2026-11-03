// The decisions of the dock on the ServiceNow page that need no DOM, so tests can check them (tests/bar-logic.test.js).
import { t } from '../i18n/index.js';

export const PREFS_KEY = 'agentbuddy-bar';
export const POLL_MS = 2000; // how often the page is looked at for the record that is open
export const REASK_MS = 20000; // how often the service worker is asked again for the actions (a pin or a switch changed in Settings)
// How often the service worker is asked "is the bar on here, is this site still on?" while the bar is off or no record is open.
// While the bar is off this is ALL it does: the page itself is not looked at.
export const PROBE_MS = 30000;
// How long an action button must have been on screen, uncovered, before a click on it starts anything (see clickVerdict).
export const ARM_MS = 500;
// How long a note under "nothing was started" stays above the dock before it goes away by itself.
export const NOTICE_MS = 10000;

// An AI action (a feature id) or, when AI is off, an Insights card ('card:ready').
const ACTION_ID_RE = /^(?:card:)?[a-z][a-z0-9-]{0,63}$/;
export const MAX_ACTIONS = 4;

// Where the dock sits along the bottom edge: the middle of the dock, as a percentage of the window's width. It starts in the centre; the
// person can drag it left or right (the place is remembered). It never goes so far to a side that it could leave the window.
export const X_MIN = 5;
export const X_MAX = 95;
export const X_DEFAULT = 50;
// How far the dock keeps from the bottom edge of the window, and from the sides (px).
export const DOCK_BOTTOM_PX = 16;
export const DOCK_EDGE_PX = 8;

/** A place along the edge (a percentage), kept inside the window; null for anything that is not a number (the centre then applies). */
export function clampX(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(X_MAX, Math.max(X_MIN, n)) * 10) / 10;
}

/** Where the middle of the dock is, as a percentage: the person's place, else the centre. */
export const xFor = (prefs) => clampX(prefs?.x) ?? X_DEFAULT;

/**
 * The dock's left edge in pixels: its middle on the chosen place, kept DOCK_EDGE_PX inside the window (a dock wider than the window
 * starts at the left edge). `view` is the width the page has; `width` the dock's own (0 while it is not shown).
 */
export function dockLeft({ x, view, width }) {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const v = Number.isFinite(view) && view > 0 ? view : 0;
  const wanted = (xFor({ x }) / 100) * v - w / 2;
  return Math.round(Math.max(DOCK_EDGE_PX, Math.min(wanted, v - w - DOCK_EDGE_PX)));
}

/**
 * Open or folded, and (once dragged) where along the bottom edge. Kept in the page's own localStorage: two harmless interface
 * choices, nothing about a ticket. Anything unreadable (the page cleared it, or someone wrote something else there) becomes the
 * defaults; the `side` and `top` of the older right-edge tab are ignored. `x` is null until the dock was moved.
 */
export function parsePrefs(raw) {
  let value = null;
  try {
    value = JSON.parse(String(raw));
  } catch {
    /* not JSON: defaults */
  }
  return { open: value?.open === true, x: clampX(value?.x) };
}

export function serializePrefs(prefs) {
  const x = clampX(prefs?.x);
  return JSON.stringify({ open: prefs?.open === true, ...(x === null ? {} : { x }) });
}

// A press on the dock's mark that moves the pointer less than this is a click (open or fold); more is a drag (move the dock sideways).
export const DRAG_PX = 5;
// One press of an arrow key on the mark moves the dock by this much (a percentage of the window's width).
export const KEY_STEP = 5;

/**
 * The dock's place while it is dragged: where it was when the drag started, moved by the pointer's travel, as a percentage of the
 * window's width. null while the pointer has not moved far enough to count as a drag.
 */
export function dragX({ startX, startPx, px, view }) {
  if (!Number.isFinite(startX) || !Number.isFinite(startPx) || !Number.isFinite(px) || !(view > 0)) return null;
  if (Math.abs(px - startPx) < DRAG_PX) return null;
  return clampX(startX + ((px - startPx) / view) * 100);
}

// ---- Below the page's own dialogs ---------------------------------------------------------------------------------------------
//
// The bar must never sit on top of a ServiceNow dialog or its dimmed backdrop (seen on dev364920: the tab stayed bright over a modal).
// Two things keep it below: its layer is lower than the page's dialog layers (BAR_Z: under the classic UI's 1040 backdrop and 1050
// dialog), and while the page shows a dialog the content script can see, the bar is hidden.
export const BAR_Z = 1000;

/**
 * Does the page show a modal dialog right now? From what the content script can see in the top document and the classic form's frame
 * (a Next Experience dialog inside a shadow root is not visible to it; the lower layer covers that case):
 *   bodyClasses  the class names of <body> (the classic UI adds modal-open while a GlideModal is open)
 *   dialogs      how many open modal dialogs it found: [aria-modal="true"], a shown .modal, a <dialog open>, a .modal-backdrop
 */
export function pageHasModal({ bodyClasses = [], dialogs = 0 } = {}) {
  return (Array.isArray(bodyClasses) && bodyClasses.includes('modal-open')) || (Number.isFinite(dialogs) && dialogs > 0);
}

// ---- An older copy of the content script, from before an extension update ---------------------------------------------------

/** The DOM event a new copy of the content script sends so that an old copy (in another isolated world) removes its bar. */
export const TAKEOVER_EVENT = 'agentbuddy-content-takeover';

/** Is this copy's extension still there? After an update or a reload chrome.runtime.id is gone (or reading it throws). */
export function runtimeAlive(runtime) {
  try {
    return Boolean(runtime && runtime.id);
  } catch {
    return false;
  }
}

/**
 * What a copy of the content script does when it starts, given what an earlier copy left on the window (nothing when none):
 *   'install'  nothing there
 *   'skip'     a working copy is already there (the tab was injected twice): this one does nothing
 *   'replace'  the copy there belongs to an extension that was updated or reloaded: retire it and take over
 */
export function contentTakeover(prior) {
  if (!prior || typeof prior !== 'object' || typeof prior.alive !== 'function') return 'install';
  let alive = false;
  try {
    alive = prior.alive() === true;
  } catch {
    alive = false;
  }
  return alive ? 'skip' : 'replace';
}

/** Ask the service worker for the actions when the kind of page changed, or when the last answer is old. */
export function needsAsk({ table, lastTable, lastAt, now }) {
  return table !== lastTable || !Number.isFinite(lastAt) || now - lastAt >= REASK_MS;
}

/**
 * The service worker's list of actions, checked anyway (it is text that ends up on the page): known shapes only, at most four. `ai` is
 * worked out from the id here (a card is the only kind that needs no AI), not taken from the answer.
 */
export const cleanActions = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((a) => a && ACTION_ID_RE.test(String(a.id || '')) && typeof a.label === 'string' && a.label.length > 0 && a.label.length <= 60)
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ id: a.id, label: a.label, ai: !a.id.startsWith('card:') }));

// A context that was invalidated (the extension was reloaded or updated while the page stayed open): the old script cannot reach the
// worker any more and must remove its bar rather than show buttons that do nothing.
export const isGone = (err) => /Extension context invalidated|Receiving end does not exist/i.test(String(err?.message || err));

/** What to tell the person after a click: '' when the panel opened and has taken over. */
export function launchNotice(answer) {
  if (answer?.error) return String(answer.error.message || t('Agent Buddy could not do that.'));
  if (answer?.opened === false) return t('Click the Agent Buddy button in your browser toolbar. The action starts in the panel.');
  return '';
}

/**
 * May a trusted click on an action of the bar start it? The page's own scripts cannot press the bar (event.isTrusted), but they can
 * try to make a person press it without knowing: cover it with something that lets clicks through, make it transparent, move it
 * under the pointer, or show it just before a click that was meant for something else. So a click counts only when:
 *   intact   the bar is where Agent Buddy put it and looks as Agent Buddy styled it (the page did not restyle or move its element)
 *   armedAt  the action buttons have been on screen for ARM_MS (also keeps a double click on the folded tab from pressing an action)
 *   seen     what the browser's visibility tracking (IntersectionObserver v2) said last about this button: { visible, since }, or
 *            null when it has said nothing (not supported, or no report yet). When it has spoken, the button must have been fully
 *            visible, with nothing over it and no transparency or filter on it, for ARM_MS.
 * @returns {'ok'|'moved'|'too-soon'|'covered'}
 */
export function clickVerdict({ now, armedAt, seen, intact }) {
  if (!intact) return 'moved';
  if (!Number.isFinite(now) || !Number.isFinite(armedAt) || now - armedAt < ARM_MS) return 'too-soon';
  if (seen && (seen.visible !== true || !Number.isFinite(seen.since) || now - seen.since < ARM_MS)) return 'covered';
  return 'ok';
}

/** What the person reads when a click was not taken ('' for 'ok'). Nothing was started in any of these cases. */
export function clickNotice(verdict) {
  switch (verdict) {
    case 'ok':
      return '';
    case 'too-soon':
      return t('Nothing was started yet. Click the action again to start it.');
    case 'covered':
      return t('Nothing was started: something on the page was covering the bar. Make sure you can see the whole bar, then click again.');
    default:
      return t('Nothing was started: the page had moved or changed the bar. It is back in place; click again if you meant to.');
  }
}

/**
 * The latest report of the browser's visibility tracking for one button, folded into { visible, since }. `since` is when it became
 * visible (kept while it stays visible) or when it stopped being visible.
 */
export function nextSeen(previous, { visible, at }) {
  if (visible) return { visible: true, since: previous && previous.visible ? previous.since : at };
  return { visible: false, since: at };
}
