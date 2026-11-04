// Keyboard behaviour of a row of tabs (the standard tab pattern), as a pure function.
import { isRtl } from '../i18n/index.js';

/**
 * Which tab a key moves to: the index to select, or -1 when the key means nothing to a tab list.
 * Left/Right wrap around; Home and End go to the first and last. In a right-to-left language the row runs the other way: Left is
 * the next tab and Right the previous one.
 */
export function nextTabIndex(key, at, count) {
  if (!(count > 0)) return -1;
  const here = at >= 0 && at < count ? at : 0;
  const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
  const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case forward:
      return (here + 1) % count;
    case backward:
      return (here - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}

/** The ids a tab and its panel get, so aria-controls and aria-labelledby always point at each other. */
export const tabId = (base, id) => `${base}-tab-${id}`;
export const panelId = (base, id) => `${base}-panel-${id}`;
