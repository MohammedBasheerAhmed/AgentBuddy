// The engine's texts for a person, written in English on purpose.
//
// The reports engine runs inside the ServiceNow page (src/content/ops/reports.js), where no language is set and no Arabic is
// loaded, and the AI reads its notes and labels as they are. So the engine never translates: it writes English, and the side
// panel shows it in the person's language where it is drawn (src/reports/shown.js, which finds the Arabic by the English text).
//
//     say(tm('No update in {days}+ days'), { days })      // 'No update in 3+ days'
//     { label: tm('Open') }                                // a fixed text: marked here, shown later with shown(label)
//
// `tm` only marks the text as a key (scripts/lib/i18nCheck.js reads it); `say` only fills the {names}. Neither looks anything up.
import { tm } from '../../i18n/core.js';

export { tm };

const PARAM = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** The English text with its {names} filled. A {name} with no value stays as written. */
export function say(text, params) {
  if (!params) return text;
  return text.replace(PARAM, (whole, name) => (Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole));
}
