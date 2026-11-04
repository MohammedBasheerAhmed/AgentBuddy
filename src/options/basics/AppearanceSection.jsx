// Settings, Basics: light, dark, or the computer's own setting (src/ui/useTheme.js). The panel, this page, the team page and the bar on
// the ServiceNow page follow it.
import { THEMES } from '../../ui/useTheme.js';
import { Status, useSaveSetting } from '../fields.jsx';
import { t, tm } from '../../i18n/index.js';

const THEME_WORDS = { system: tm('Same as the computer'), light: tm('Light'), dark: tm('Dark') };

/** Light, dark, or the computer's own setting: the panel, this page, the team page and the bar on the ServiceNow page follow it. */
export function AppearanceSection({ eff, reload }) {
  const { status, save } = useSaveSetting(reload);
  return (
    <section className="ab-section" aria-labelledby="h-appearance">
      <h2 className="ab-h" id="h-appearance">{t('Appearance')}</h2>
      <div className="ab-field">
        <label className="ab-label" htmlFor="theme-choice">{t('Colours')}</label>
        <select id="theme-choice" className="ab-select" value={eff.values.theme} aria-describedby="theme-hint" onChange={(e) => save({ theme: e.target.value })}>
          {THEMES.map((id) => (
            <option key={id} value={id}>{t(THEME_WORDS[id])}</option>
          ))}
        </select>
        <span className="ab-hint" id="theme-hint">{t('The panel, this page, the team page and the bar on the ServiceNow page. The sun and moon button in the panel switches it too.')}</span>
      </div>
      <Status status={status} />
    </section>
  );
}
