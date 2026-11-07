// Links to ServiceNow records and lists. A record in the panel is a real link (an <a href> on the instance the page is on), so the
// browser's own behaviour works: Ctrl/Cmd+click or the middle button opens a new tab, and the right-click menu offers "Open link in
// new tab". A plain click is handled by the panel instead: it opens the record in a new tab next to the one the panel is attached to
// (a "look at this" link: the ticket being worked on, and anything typed on it, must stay put), or, for a "go work on this" link (a
// worklist row, a list), in the tab the panel is attached to. Where each one opens is src/sidepanel/openRecord.js.
import { tm } from '../i18n/index.js';

/** A plain left click. Anything else (Ctrl, Cmd, Shift, Alt, the middle button) is left to the browser. */
export const isPlainClick = (event) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

// English texts marked for the catalogue: a view shows them through the translation function, in the language of the panel.
export const NEW_TAB_HINT = tm('Opens in this tab. Ctrl+click, middle-click or right-click to use a new tab.');

export const OWN_TAB_HINT = tm('Opens in a new tab next to this ticket, so the ticket you are working on stays open.');
