// The decisions of the bar on the ServiceNow page that need no DOM, so tests can check them (tests/bar-logic.test.js).

export const PREFS_KEY = 'agentbuddy-bar';
export const POLL_MS = 2000; // how often the page is looked at for the record that is open
export const REASK_MS = 20000; // how often the service worker is asked again for the actions (a pin or a switch changed in Settings)

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

// A context that was invalidated (the extension was reloaded or updated while the page stayed open): the old script cannot reach the
// worker any more and must remove its bar rather than show buttons that do nothing.
export const isGone = (err) => /Extension context invalidated|Receiving end does not exist/i.test(String(err?.message || err));

/** What to tell the person after a click: '' when the panel opened and has taken over. */
export function launchNotice(answer) {
  if (answer?.error) return String(answer.error.message || 'Agent Buddy could not do that.');
  if (answer?.opened === false) return 'Click the Agent Buddy button in your browser toolbar. The action starts in the panel.';
  return '';
}
