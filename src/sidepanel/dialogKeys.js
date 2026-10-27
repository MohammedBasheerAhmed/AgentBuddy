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
