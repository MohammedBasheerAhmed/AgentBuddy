import { useLayoutEffect } from 'react';

/** The words a theme setting may hold. 'system' follows the computer's light or dark setting. */
export const THEMES = ['system', 'light', 'dark'];

/** What the page needs: 'light' or 'dark' when the person chose one, '' for "same as the system" (theme.css then follows the computer). */
export function themeAttribute(setting) {
  return setting === 'light' || setting === 'dark' ? setting : '';
}

/** The theme a click on the header's sun/moon button leads to: the opposite of what is on screen now, whatever the setting was. */
export function nextTheme(setting, systemDark) {
  const showing = themeAttribute(setting) || (systemDark ? 'dark' : 'light');
  return showing === 'dark' ? 'light' : 'dark';
}

/** Does the computer ask for dark colours now? (false where it cannot be asked: a test, a worker) */
export function systemIsDark() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  } catch {
    return false;
  }
}

/**
 * The colours of a page: call it in the root component with the `theme` setting. It puts data-theme on the page, which theme.css reads
 * (no attribute: the colours follow the computer). Like useLanguage, it runs before the children draw.
 */
export function useTheme(setting) {
  const attribute = themeAttribute(setting);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (attribute) root.setAttribute('data-theme', attribute);
    else root.removeAttribute('data-theme');
  }, [attribute]);
  return attribute;
}
