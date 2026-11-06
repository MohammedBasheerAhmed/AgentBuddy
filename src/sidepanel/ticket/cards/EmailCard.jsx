import { useId, useMemo, useState } from 'react';
import { EMAIL_TYPES, callerLanguage, emailFormUrl, recommendEmails, replyLanguage } from '../../../compose/emailRecommend.js';
import { emailAsText, emailLanguage, fillEmailTemplate } from '../../../insights/emailTemplates.js';
import { openInNewTab } from '../../openRecord.js';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { CopyButton, QuietButton, ReadState } from './bits.jsx';
import { Facts } from '../../checks/Bits.jsx';
import { isFeatureEnabled } from '../../../policy/policy.js';
import { getLanguage, t, t as tr } from '../../../i18n/index.js';

// N20, which email fits: the kind of email this ticket needs now (from src/compose/emailRecommend.js: resolved and not told yet, waiting
// on the customer, an approval waiting, an SLA missed...) and a plain template for it, filled from the ticket, to copy. What only the
// agent knows stays [in brackets]. No AI: an AI draft of the same email is in AI Assist.
//
// Round 4 (docs/round4.md), the only card of the Reply row, so its summary is the row's line. Two facts, no new button: the language the
// caller writes in and the one Draft a reply will write in for the setting "Language of AI answers" (said only when it is not the
// panel's language, src/compose/emailRecommend.js replyLanguage), and what the safe-to-send check looks at before a reply goes out
// (src/safeSend: internal words, a next step, the tone). That line says what is checked, not a result.

export default function EmailCard({ page, eff, record, active, setSummary, setAttention }) {
  const ticket = useTicketFacts({ page, record, eff, active });
  const answer = ticket.data;
  const rec = useMemo(() => {
    if (!answer?.pack) return null;
    // The SLA rows of the glance read, in the shape the recommender reads (only when they could be read).
    const slasRead = (answer.slas?.access || []).every((a) => a?.status === 'ok' || a?.status === 'empty');
    const slas = slasRead ? (answer.slas?.items || []).map((s) => ({ name: s.name, stage: s.stage, breached: s.breached ? 'true' : 'false', percentage: s.percentage === null ? '' : String(s.percentage) })) : undefined;
    const pack = slas ? { ...answer.pack, related: { ...(answer.pack.related || {}), slas } } : answer.pack;
    return { pack, ...recommendEmails(pack, { now: Date.now() }) };
  }, [answer]);
  const panel = getLanguage();
  const setting = eff?.values?.answerLanguage;
  const ai = eff?.policy?.aiEnabled !== false && isFeatureEnabled('reply-draft', eff?.policy);
  const language = useMemo(() => (rec ? replyLanguage({ caller: callerLanguage(rec.pack), setting, panel, ai }) : null), [rec, setting, panel, ai]);
  const [chosen, setChosen] = useState('');
  const [opened, setOpened] = useState('');
  const group = useId();
  const top = rec?.picks[0];
  const typeId = chosen || top?.id || '';
  const fits = rec ? (top ? t('{label} fits best', { label: tr(top.label) }) : t('No email needed right now')) : '';
  useReport(setSummary, fits && language?.line ? `${fits} · ${language.line}` : fits);
  useReport(setAttention, rec && !top ? 'clear' : '');

  if (!rec) return <ReadState state={ticket} what={t('this ticket')} onRetry={ticket.reload} />;
  // The template is written in the language the reply row names (language.reply: 'ar' | 'en'), or, when that is not known, in the
  // language emailLanguage picks by the same "Language of AI answers" rule (src/insights/emailTemplates.js).
  const templateLanguage = language?.reply || emailLanguage(rec.pack, { answerLanguage: setting, panelLanguage: panel });
  const filled = typeId ? fillEmailTemplate(typeId, { pack: rec.pack, agentName: page.user?.name || '', number: record.number, language: templateLanguage }) : null;
  const others = EMAIL_TYPES.filter((kind) => !rec.picks.some((p) => p.id === kind.id));
  const formUrl = emailFormUrl(page.href, { table: record.table, sysId: record.sysId });

  return (
    <>
      {rec.facts.length > 0 && <p className="ab-hint">{rec.facts.join(' · ')}</p>}
      <Facts
        tight
        rows={[
          ...(language?.fact ? [{ label: t('Language'), value: language.fact }] : []),
          { label: t('Before it is sent'), value: t('Checked: internal words · a next step · the tone') },
        ]}
      />
      {rec.note && <p className="ab-note ab-note-warn">{rec.note}</p>}
      <fieldset className="ab-ins-choices">
        <legend className="ab-ins-legend">{t('Kind of email')}</legend>
        {rec.picks.map((p) => (
          <label key={p.id} className={`ab-ins-choice${typeId === p.id ? ' is-on' : ''}`}>
            <input type="radio" name={group} value={p.id} checked={typeId === p.id} onChange={() => setChosen(p.id)} />
            <span>
              <strong>{tr(p.label)}</strong>
              <span className="ab-hint ab-ins-why">{p.why}</span>
            </span>
          </label>
        ))}
        {others.length > 0 && (
          <label className="ab-ins-other">
            <span>{rec.picks.length ? t('Another kind') : t('Choose a kind')}</span>
            <select value={others.some((kind) => kind.id === typeId) ? typeId : ''} onChange={(e) => setChosen(e.target.value)}>
              <option value="">…</option>
              {others.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {tr(kind.label)}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {filled && (
        <>
          <pre className="ab-ins-email" aria-label={t('Email template')}>
            {emailAsText(filled)}
          </pre>
          {filled.placeholders > 0 && <p className="ab-hint">{t('Fill in the parts in [brackets] before you send it.')}</p>}
          <div className="ab-ins-foot">
            <CopyButton value={() => emailAsText(filled)} label={t('Copy email')} />
            {formUrl && (
              <QuietButton onClick={() => setOpened(openInNewTab(page, formUrl) ? t('The email form opened in a new tab.') : t('The email form could not be opened.'))}>
                {t('Open the email form')}
              </QuietButton>
            )}
          </div>
          {opened && <p className="ab-hint" role="status">{opened}</p>}
        </>
      )}
    </>
  );
}
