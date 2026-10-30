// The decisions of the bar on the ServiceNow page that need no DOM, so tests can check them (tests/bar-logic.test.js).

export const PREFS_KEY = 'agentbuddy-bar';
export const POLL_MS = 2000; // how often the page is looked at for the record that is open
export const REASK_MS = 20000; // how often the service worker is asked again for the actions (a pin or a switch changed in Settings)
// How often the service worker is asked "is the bar on here, is this site still on?" while the bar is off or no record is open.
// While the bar is off this is ALL it does: the page itself is not looked at.
export const PROBE_MS = 30000;
// How long an action button must have been on screen, uncovered, before a click on it starts anything (see clickVerdict).
export const ARM_MS = 500;

const ACTION_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const MAX_ACTIONS = 4;

/**
 * Open or folded, and which edge of the page. Kept in the page's own localStorage: two harmless interface choices, nothing about
 * a ticket. Anything unreadable (the page cleared it, or someone wrote something else there) becomes the defaults.
 */
export function parsePrefs(raw) {
  let value = null;
  try {
    value = JSON.parse(String(raw));
  } catch {
    /* not JSON: defaults */
  }
  return { open: value?.open === true, side: value?.side === 'left' ? 'left' : 'right' };
}

export const serializePrefs = (prefs) => JSON.stringify({ open: prefs.open === true, side: prefs.side === 'left' ? 'left' : 'right' });

/** Ask the service worker for the actions when the kind of page changed, or when the last answer is old. */
export function needsAsk({ table, lastTable, lastAt, now }) {
  return table !== lastTable || !Number.isFinite(lastAt) || now - lastAt >= REASK_MS;
}

/** The service worker's list of actions, checked anyway (it is text that ends up on the page): known shapes only, at most four. */
export const cleanActions = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((a) => a && ACTION_ID_RE.test(String(a.id || '')) && typeof a.label === 'string' && a.label.length > 0 && a.label.length <= 60)
    .slice(0, MAX_ACTIONS)
    .map((a) => ({ id: a.id, label: a.label }));

// A context that was invalidated (the extension was reloaded or updated while the page stayed open): the old script cannot reach the
// worker any more and must remove its bar rather than show buttons that do nothing.
export const isGone = (err) => /Extension context invalidated|Receiving end does not exist/i.test(String(err?.message || err));

/** What to tell the person after a click: '' when the panel opened and has taken over. */
export function launchNotice(answer) {
  if (answer?.error) return String(answer.error.message || 'Agent Buddy could not do that.');
  if (answer?.opened === false) return 'Click the Agent Buddy button in your browser toolbar. The action starts in the panel.';
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
      return 'Nothing was started yet. Click the action again to start it.';
    case 'covered':
      return 'Nothing was started: something on the page was covering the bar. Make sure you can see the whole bar, then click again.';
    default:
      return 'Nothing was started: the page had moved or changed the bar. It is back in place; click again if you meant to.';
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
