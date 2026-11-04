// Settings, Basics: how strictly personal data is masked before anything goes to an AI (piiMode), and when the person sees the outgoing
// text first (previewMode). The organisation's policy can set a minimum for each (a floor), never a maximum.
import { PII_MODES, PREVIEW_MODES } from '../../policy/policy.js';
import { looserThanFloor } from '../policyNotes.js';
import { SectionHead, Status, describedBy, useSaveSetting } from '../fields.jsx';
import { t, tm, t as tr } from '../../i18n/index.js';

// (English texts marked with tm(); each is shown with tr(), the translation function, at the moment it is used)
const PII_TEXT = {
  standard: tm('Masks detected personal data (names on the ticket, emails, phone and card numbers, IDs, secrets).'),
  strict: tm('Also refuses sensitive fields and keeps HR free text out entirely.'),
  'local-only': tm('Only allows an AI model running on this computer. Nothing leaves it.'),
};
const PREVIEW_TEXT = { always: tm('Show the exact outgoing text every time'), first: tm('Show it the first time for each action'), never: tm('Do not show it') };
const PII_LABEL = { standard: tm('Standard'), strict: tm('Strict'), 'local-only': tm('Local model only') };

// The organisation's piiMode and previewMode are floors: the person may choose anything at or above them, never below. The select
// stays usable and only the looser choices are switched off, with a note saying what the minimum is. (The policy marks these two
// settings locked only together with a floor, src/policy/policy.js effectiveSettings, so the floor is all there is to show.) When
// there is a floor, a note at the top of the section says so in general.
export function PrivacySection({ eff, reload }) {
  const v = eff.values;
  const { status, save: change } = useSaveSetting(reload);
  const piiFloor = eff.floors?.piiMode || '';
  const previewFloor = eff.floors?.previewMode || '';
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-privacy">
      <SectionHead id="h-privacy" title={t('Privacy')}>
        {t('Before anything goes to an AI, Agent Buddy hides names, email addresses, phone and card numbers and other personal data. These two choices say how strictly, and when you see the text first.')}
      </SectionHead>
      {Object.keys(eff.floors || {}).length > 0 && <p className="ab-note">{t('Your organisation sets a minimum for some privacy settings. You can always choose a stricter one.')}</p>}
      <div className="ab-field ab-set-pick">
        <label className="ab-label" htmlFor="pii">{t('Personal-data protection')}</label>
        <select
          id="pii"
          className="ab-select"
          value={v.piiMode}
          aria-describedby={describedBy('pii-hint', piiFloor && 'pii-floor')}
          onChange={(e) => !looserThanFloor('piiMode', e.target.value, piiFloor) && change({ piiMode: e.target.value })}
        >
          {PII_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('piiMode', m, piiFloor)}>{tr(PII_LABEL[m])}</option>)}
        </select>
        <span className="ab-hint" id="pii-hint">{tr(PII_TEXT[v.piiMode])}</span>
        {piiFloor ? <span className="ab-locked" id="pii-floor">{t('Your organisation requires at least {level}.', { level: tr(PII_LABEL[piiFloor]) })}</span> : null}
      </div>
      <div className="ab-field ab-set-pick">
        <label className="ab-label" htmlFor="preview">{t('Check what is sent')}</label>
        <select
          id="preview"
          className="ab-select"
          value={v.previewMode}
          aria-describedby={previewFloor ? 'preview-floor' : undefined}
          onChange={(e) => !looserThanFloor('previewMode', e.target.value, previewFloor) && change({ previewMode: e.target.value, previewSeen: [] })}
        >
          {PREVIEW_MODES.map((m) => <option key={m} value={m} disabled={looserThanFloor('previewMode', m, previewFloor)}>{tr(PREVIEW_TEXT[m])}</option>)}
        </select>
        {previewFloor ? <span className="ab-locked" id="preview-floor">{t('Your organisation requires at least: {level}.', { level: tr(PREVIEW_TEXT[previewFloor]) })}</span> : null}
      </div>
      <Status status={status} />
    </section>
  );
}
