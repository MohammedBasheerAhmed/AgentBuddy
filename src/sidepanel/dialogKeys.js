// Keyboard rules for the preview dialog, and the way it shuts the rest of the panel out. Plain functions so they are tested
// without a browser (tests/panel-dialog.test.js).

/**
 * What a key press means inside the dialog.
 * @param {{ key: string, shiftKey?: boolean }} e the key event
 * @param {number} count how many controls in the dialog can take focus
 * @param {number} at which of them has focus now (-1: none of them)
 * @returns {{ type: 'cancel' } | { type: 'focus', index: number } | null} null: leave the key alone
 */
export function dialogKeyAction(e, count, at) {
  if (e.key === 'Escape') return { type: 'cancel' };
  if (e.key !== 'Tab' || !(count > 0)) return null;
  // Tab never leaves the dialog: after the last control comes the first, before the first comes the last.
  if (e.shiftKey) return { type: 'focus', index: at <= 0 ? count - 1 : at - 1 };
  return { type: 'focus', index: at < 0 || at >= count - 1 ? 0 : at + 1 };
}

/**
 * A key pressed while the dialog is on screen but the focus is NOT inside it: it has not taken the focus yet (it is still
 * waiting to be seen), or the focus was lost (the button that opened it went away). Escape still cancels and Tab brings the
 * focus in. A dialog that is not visible (waiting in a hidden part of the panel) leaves every key alone, and so does a key
 * something else already handled.
 * @param {{ key: string, shiftKey?: boolean, defaultPrevented?: boolean }} e
 * @param {{ visible: boolean, inside: boolean, count: number }} state
 * @returns {{ type: 'cancel' } | { type: 'focus', index: number } | null}
 */
export function outsideKeyAction(e, { visible, inside, count }) {
  if (!visible || inside || e.defaultPrevented) return null;
  if (e.key === 'Escape') return { type: 'cancel' };
  if (e.key === 'Tab' && count > 0) return { type: 'focus', index: e.shiftKey ? count - 1 : 0 };
  return null;
}

/**
 * The text selected inside `container` ('' when the selection is empty or starts or ends outside it). `selection` is the
 * window's Selection (injected, so this is tested without a browser).
 */
export function selectedTextIn(container, selection, max = 1000) {
  if (!container || !selection || selection.isCollapsed || !selection.rangeCount) return '';
  const inside = (n) => Boolean(n) && (n === container || (typeof container.contains === 'function' && container.contains(n)));
  if (!inside(selection.anchorNode) || !inside(selection.focusNode)) return '';
  return String(selection.toString()).trim().slice(0, max);
}

/**
 * Where the focus goes back to when the dialog closes: the control that had it before the dialog took it, if that is still on
 * the page and the focus is now nowhere (on the body, or on nothing). Returns the element to focus, or null.
 */
export function focusToRestore(opener, active, body) {
  if (!opener || opener.isConnected === false || typeof opener.focus !== 'function') return null;
  return !active || active === body ? opener : null;
}

/**
 * Make everything around `node` inert (not clickable, not focusable, hidden from screen readers) while it is open: every sibling
 * of the node and of each of its ancestors. Returns the function that puts things back. `aria-modal` alone does not do this.
 */
export function inertOutside(node) {
  const changed = [];
  let current = node;
  while (current && current.parentElement) {
    for (const sibling of Array.from(current.parentElement.children)) {
      if (sibling !== current && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        changed.push(sibling);
      }
    }
    current = current.parentElement;
  }
  return () => {
    for (const el of changed) el.removeAttribute('inert');
  };
}

export const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
