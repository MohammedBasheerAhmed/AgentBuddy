// Settings, Basics: the language of the panel and this page (src/i18n), and the language the AI writes its answers in.
import { LANGUAGES, t } from '../../i18n/index.js';
import { SectionHead, Status, useSaveSetting } from '../fields.jsx';

/** Language: the language of the panel and this page, and the language the AI writes in. Saved at once, shown at once. */
export function LanguageSection({ eff, reload }) {
  const { status, save: change } = useSaveSetting(reload);
  const aiOn = eff.policy?.aiEnabled !== false;
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-language">
      <SectionHead id="h-language" title={t('Language')}>
        {aiOn ? t('The language Agent Buddy shows, and the one AI answers are written in.') : t('The language Agent Buddy shows.')}
      </SectionHead>
      <div className="ab-field ab-set-pick">
        <label className="ab-label" htmlFor="language-choice">{t('Language of the panel and this page')}</label>
        <select id="language-choice" className="ab-select" value={eff.values.language} aria-describedby="language-hint" onChange={(e) => change({ language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.id === 'auto' ? t('Same as the browser') : l.name}</option>
          ))}
        </select>
        <span className="ab-hint" id="language-hint">{t('The panel, this page and the team page. What is in a ticket is never translated.')}</span>
      </div>
      {aiOn && (
        <div className="ab-field ab-set-pick">
          <label className="ab-label" htmlFor="answer-language">{t('Language of AI answers')}</label>
          <select id="answer-language" className="ab-select" value={eff.values.answerLanguage} aria-describedby="answer-language-hint" onChange={(e) => change({ answerLanguage: e.target.value })}>
            <option value="ticket">{t('The language of the ticket')}</option>
            <option value="panel">{t('The language of the panel')}</option>
          </select>
          <span className="ab-hint" id="answer-language-hint">{t("A reply to an Arabic ticket is written in Arabic, and one to an English ticket in English. Choose the panel's language to always get answers in it.")}</span>
        </div>
      )}
      <Status status={status} />
    </section>
  );
}
