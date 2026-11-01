import { useLayoutEffect } from 'react';
import { browserLanguage, direction, resolveLanguage, setLanguage } from './index.js';

/**
 * The language of a page: call it first in the root component with the `language` setting. It sets the language BEFORE the
 * children render (they read it through t()), and puts `lang` and `dir` on the page. The root renders its children under
 * `key={lang}`, so a change of language redraws every text.
 */
export function useLanguage(setting) {
  const lang = setLanguage(resolveLanguage(setting, browserLanguage()));
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = direction(lang);
  }, [lang]);
  return lang;
}
