// Settings, Basics: what the organisation's policy switches off (`disabledFeatures`), and the ids in it that match no feature, so an
// administrator sees a typo. Shown only when the policy switches something off.
import { unknownDisabledFeatures } from '../policyNotes.js';
import { SectionHead } from '../fields.jsx';
import { t } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';

const switchedOff = (eff) => (Array.isArray(eff.policy?.disabledFeatures) ? eff.policy.disabledFeatures : []);

/** Whether the section is on the page (the menu beside the page lists it only then). */
export const policySectionShown = (eff) => switchedOff(eff).length > 0;

/** What the organisation's policy switches off, and the ids in it that match nothing (a typo switches nothing off). */
export function PolicySection({ eff }) {
  const off = switchedOff(eff);
  if (!off.length) return null;
  const unknown = unknownDisabledFeatures(off);
  const known = off.filter((id) => !unknown.includes(String(id).trim().toLowerCase()));
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-policy">
      <SectionHead id="h-policy" title={t("Your organisation's policy")} />
      {known.length > 0 && (
        <p className="ab-sub">
          {tx('Switched off by your organisation: {features}.', { features: <span className="ab-mono">{known.join(', ')}</span> })}
        </p>
      )}
      {unknown.length > 0 && (
        <p className="ab-note ab-note-warn" id="policy-unknown-features">
          {unknown.length === 1
            ? tx("Your organisation's settings name a feature this version does not have, so nothing is switched off by it: {ids}. Tell your administrator.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })
            : tx("Your organisation's settings name features this version does not have, so nothing is switched off by them: {ids}. Tell your administrator.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })}
        </p>
      )}
    </section>
  );
}
