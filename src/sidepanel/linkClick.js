// Links to ServiceNow records and lists. A record in the panel is a real link (an <a href> on the instance the page is on), so the
// browser's own behaviour works: Ctrl/Cmd+click or the middle button opens a new tab, and the right-click menu offers "Open link in
// new tab". A plain click is handled by the panel instead: it opens the record in the tab the panel is attached to.

/** A plain left click. Anything else (Ctrl, Cmd, Shift, Alt, the middle button) is left to the browser. */
export const isPlainClick = (event) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

export const NEW_TAB_HINT = 'Opens in this tab. Ctrl+click, middle-click or right-click to use a new tab.';
