// Settings, Basics, "My work": after how many days a customer who is waiting (or has not answered) counts as a follow-up due. The
// choices and the fallback are those of the follow-ups themselves (src/mywork/followups.js), so this page and My work agree.
import { FOLLOW_UP_DAY_CHOICES, cleanDays } from '../../mywork/followups.js';
import { SectionHead, Status, useSaveSetting } from '../fields.jsx';
import { t, tn } from '../../i18n/index.js';

/** My work: after how many days a customer who is waiting (or has not answered) counts as a follow-up due. */
export function FollowUpSection({ eff, reload }) {
  const { status, save } = useSaveSetting(reload);
  const value = cleanDays(eff.values.followUpDays);
  function change(text) {
    const days = Number(text);
    if (!FOLLOW_UP_DAY_CHOICES.includes(days)) return;
    save({ followUpDays: days });
  }
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-followup">
      <SectionHead id="h-followup" title={t('My work')}>{t('When a follow-up is due in My work.')}</SectionHead>
      <div className="ab-field ab-set-pick">
        <label className="ab-label" htmlFor="follow-up-days">{t('Follow-ups due after')}</label>
        <select id="follow-up-days" className="ab-select" value={String(value)} aria-describedby="follow-up-hint" onChange={(e) => change(e.target.value)}>
          {FOLLOW_UP_DAY_CHOICES.map((d) => (
            <option key={d} value={String(d)}>{tn(d, '{n} day', '{n} days')}</option>
          ))}
        </select>
        <span className="ab-hint" id="follow-up-hint">{t('A customer who has not had an update, or has not answered, for this long shows under follow-ups in My work.')}</span>
      </div>
      <Status status={status} />
    </section>
  );
}
