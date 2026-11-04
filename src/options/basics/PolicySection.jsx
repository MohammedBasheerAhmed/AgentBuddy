// Settings, Basics: what the organisation's policy switches off (`disabledFeatures`), and the ids in it that match no feature, so an
// administrator sees a typo. Shown only when the policy switches something off.
import { unknownDisabledFeatures } from '../policyNotes.js';
import { t } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';

/** What the organisation's policy switches off, and the ids in it that match nothing (a typo switches nothing off). */
export function PolicySection({ eff }) {
  const off = Array.isArray(eff.policy?.disabledFeatures) ? eff.policy.disabledFeatures : [];
  if (!off.length) return null;
  const unknown = unknownDisabledFeatures(off);
  const known = off.filter((id) => !unknown.includes(String(id).trim().toLowerCase()));
  return (
    <section className="ab-section" aria-labelledby="h-policy">
      <h2 className="ab-h" id="h-policy">{t("Your organisation's policy")}</h2>
      {known.length > 0 && (
        <p className="ab-sub">
          {tx('Switched off by your organisation: {features}.', { features: <span className="ab-mono">{known.join(', ')}</span> })}
        </p>
      )}
      {unknown.length > 0 && (
        <p className="ab-note ab-note-warn" id="policy-unknown-features">
          {unknown.length === 1
            ? tx("The policy's disabledFeatures names an id that matches no feature, so nothing is switched off by it: {ids}. Check the spelling against the list in the deployment guide.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })
            : tx("The policy's disabledFeatures names ids that match no feature, so nothing is switched off by them: {ids}. Check the spelling against the list in the deployment guide.", { ids: <span className="ab-mono">{unknown.join(', ')}</span> })}
        </p>
      )}
    </section>
  );
}
