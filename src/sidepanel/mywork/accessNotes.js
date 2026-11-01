// The access notes of My work in the language of the panel.
//
// The page script writes them in English (it has no language, src/mywork/read.js) and the panel shows them with shown() (the Arabic is
// found by the English text, src/reports/shown.js). A few sentences are long ones with a fixed tail ("... turn on the HR profile in
// Settings to see them.") that a loose pattern of another screen ("{person} in {group}") could match first, so they are matched here,
// by their own pattern, before shown() is asked.
import { shown } from '../../reports/shown.js';
import { t } from '../../i18n/index.js';

const HR_PROFILE = 'turn on the HR profile in Settings to see them\\.';
const KEPT_OUT = 'your organisation keeps this content out of Agent Buddy\\.';

/** One note, in the language of the panel (as it is when there is nothing to translate it with). */
export function noteText(note) {
  const text = String(note ?? '');
  let m = new RegExp(`^1 (.+) is not listed: ${HR_PROFILE}$`).exec(text);
  if (m) return t('1 {what} is not listed: turn on the HR profile in Settings to see them.', { what: shown(m[1]) });
  m = new RegExp(`^1 (.+) is not listed: ${KEPT_OUT}$`).exec(text);
  if (m) return t('1 {what} is not listed: your organisation keeps this content out of Agent Buddy.', { what: shown(m[1]) });
  m = new RegExp(`^(\\d+) (.+) are not listed: ${HR_PROFILE}$`).exec(text);
  if (m) return t('{n} {what} are not listed: turn on the HR profile in Settings to see them.', { n: m[1], what: shown(m[2]) });
  m = new RegExp(`^(\\d+) (.+) are not listed: ${KEPT_OUT}$`).exec(text);
  if (m) return t('{n} {what} are not listed: your organisation keeps this content out of Agent Buddy.', { n: m[1], what: shown(m[2]) });
  m = new RegExp(`^(.+) are not listed: ${HR_PROFILE}$`).exec(text);
  if (m) return t('{what} are not listed: turn on the HR profile in Settings to see them.', { what: shown(m[1]) });
  m = new RegExp(`^(.+) are not listed: ${KEPT_OUT}$`).exec(text);
  if (m) return t('{what} are not listed: your organisation keeps this content out of Agent Buddy.', { what: shown(m[1]) });
  return shown(text);
}
