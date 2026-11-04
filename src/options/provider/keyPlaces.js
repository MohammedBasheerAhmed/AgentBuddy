// Where the AI key can be kept ("Where to keep the key" in Settings, src/policy/policy.js KEY_STORAGE_MODES), in words: the choice's
// label, what it means, and the short place the line under the key box names. English texts marked with tm(); each is shown with tr(),
// the translation function, at the moment it is used.
import { tm } from '../../i18n/index.js';

export const KEY_MODE_TEXT = {
  local: tm("Kept in Agent Buddy's own storage in this browser. ServiceNow pages cannot read it, but anyone who can read your browser profile on disk can. Use a key with a spend limit."),
  session: tm('Kept in memory only and forgotten when the browser closes. Nothing is written to disk. You enter it again next time.'),
  encrypted: tm('Kept encrypted with a passphrase. You enter the passphrase once per browser session.'),
};
export const KEY_MODE_LABEL = { local: tm('This browser (simple)'), session: tm('Memory only (forgotten on close)'), encrypted: tm('Encrypted with a passphrase') };
export const KEY_WHERE = { local: tm('this browser'), session: tm('memory only'), encrypted: tm('this browser, encrypted') };
