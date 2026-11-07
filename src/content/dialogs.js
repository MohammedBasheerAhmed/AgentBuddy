// Is a dialog open on the page? Pure DOM reading for the dock (src/content/bar.js), apart so it is tested without the dock's styles.
// Nothing here changes the page.

export const DIALOG_SELECTOR = '[aria-modal="true"], .modal.in, .modal.show, dialog[open], .modal-backdrop';

// Is this element drawn (not display: none, not visibility: hidden, in a tree that is shown)?
export function isShown(el) {
  try {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    return el.getClientRects().length > 0;
  } catch {
    return true; // when unsure, count it: the dock then stays out of the way
  }
}

const SHADOW_LOOK_MS = 15;

// A dialog inside a shadow root (a Workspace and the Next Experience draw their dialogs there, where the document's own
// querySelectorAll cannot see; audit of 2026-11-07, S13). Two looks, both read-only: (1) the dialog that holds the focus, found by
// climbing from the focused element through the shadow roots above it (a modal keeps the focus inside itself); (2) a short look through
// the open shadow roots, ended by a clock so a big page costs a few milliseconds a poll. A dialog missed once is seen at the next poll.
export function shadowDialogs(d) {
  let count = 0;
  try {
    let focused = d.activeElement;
    for (let i = 0; focused && i < 30; i += 1) {
      const inner = focused.shadowRoot ? focused.shadowRoot.activeElement : null;
      if (!inner) break;
      focused = inner;
    }
    for (let node = focused, i = 0; node && node.nodeType === 1 && i < 60; i += 1) {
      if (typeof node.matches === 'function' && node.matches(DIALOG_SELECTOR) && isShown(node)) {
        count += 1;
        break;
      }
      const up = node.parentNode;
      node = up && up.nodeType === 11 ? up.host : up;
    }
  } catch {
    /* nothing to look at */
  }
  if (count) return count;
  try {
    const until = Date.now() + SHADOW_LOOK_MS;
    const roots = [d];
    for (let r = 0; r < roots.length && Date.now() < until; r += 1) {
      const nodes = roots[r].querySelectorAll('*');
      for (let i = 0; i < nodes.length; i += 1) {
        if ((i & 127) === 0 && Date.now() > until) return count;
        if (nodes[i].shadowRoot) {
          roots.push(nodes[i].shadowRoot);
          count += [...nodes[i].shadowRoot.querySelectorAll(DIALOG_SELECTOR)].filter(isShown).length;
        }
      }
    }
  } catch {
    /* the part of the page that could not be read is left out */
  }
  return count;
}

