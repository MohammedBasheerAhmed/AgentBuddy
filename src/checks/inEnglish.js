// Text that goes to the AI is English whatever language the person reads the panel in. A pure module that builds both (the status line of a
// request is shown to the person AND is a part of the 'request-explain' prompt data) builds the AI's copy inside inEnglish().
// Synchronous on purpose: the language is put back before anything else can run.
import { getLanguage, setLanguage } from '../i18n/core.js';

export function inEnglish(fn) {
  const was = getLanguage();
  setLanguage('en');
  try {
    return fn();
  } finally {
    setLanguage(was);
  }
}
