import React, { useId, useMemo, useState } from 'react';
import { EMAIL_TYPES, emailFormUrl, recommendEmails } from '../../../compose/emailRecommend.js';
import { emailAsText, fillEmailTemplate } from '../../../insights/emailTemplates.js';
import { openInNewTab } from '../../openRecord.js';
import { useTicketFacts } from './data.js';
import { useReport } from './useInsight.js';
import { CopyButton, QuietButton, ReadState } from './bits.jsx';

// N20, which email fits: the kind of email this ticket needs now (from src/compose/emailRecommend.js: resolved and not told yet, waiting
// on the customer, an approval waiting, an SLA missed...) and a plain template for it, filled from the ticket, to copy. What only the
// agent knows stays [in brackets]. No AI: an AI draft of the same email is in AI Assist.

export default function EmailCard({ page, eff, record, active, setSummary }) {
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
  const [chosen, setChosen] = useState('');
  const [opened, setOpened] = useState('');
  const group = useId();
  const top = rec?.picks[0];
  const typeId = chosen || top?.id || '';
  useReport(setSummary, rec ? (top ? `${top.label} fits best` : 'No email needed right now') : '');

  if (!rec) return <ReadState state={ticket} what="this ticket" onRetry={ticket.reload} />;
  const filled = typeId ? fillEmailTemplate(typeId, { pack: rec.pack, agentName: page.user?.name || '', number: record.number }) : null;
  const others = EMAIL_TYPES.filter((t) => !rec.picks.some((p) => p.id === t.id));
  const formUrl = emailFormUrl(page.href, { table: record.table, sysId: record.sysId });

  return (
    <>
      {rec.facts.length > 0 && <p className="ab-hint">{rec.facts.join(' · ')}</p>}
      {rec.note && <p className="ab-note ab-note-warn">{rec.note}</p>}
      <fieldset className="ab-ins-choices">
        <legend className="ab-ins-legend">Kind of email</legend>
        {rec.picks.map((p) => (
          <label key={p.id} className={`ab-ins-choice${typeId === p.id ? ' is-on' : ''}`}>
            <input type="radio" name={group} value={p.id} checked={typeId === p.id} onChange={() => setChosen(p.id)} />
            <span>
              <strong>{p.label}</strong>
              <span className="ab-hint ab-ins-why">{p.why}</span>
            </span>
          </label>
        ))}
        {others.length > 0 && (
          <label className="ab-ins-other">
            <span>{rec.picks.length ? 'Another kind' : 'Choose a kind'}</span>
            <select value={others.some((t) => t.id === typeId) ? typeId : ''} onChange={(e) => setChosen(e.target.value)}>
              <option value="">…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {filled && (
        <>
          <pre className="ab-ins-email" aria-label="Email template">
            {emailAsText(filled)}
          </pre>
          {filled.placeholders > 0 && <p className="ab-hint">Fill in the parts in [brackets] before you send it.</p>}
          <div className="ab-ins-foot">
            <CopyButton value={() => emailAsText(filled)} label="Copy email" />
            {formUrl && (
              <QuietButton onClick={() => setOpened(openInNewTab(page, formUrl) ? 'The email form opened in a new tab.' : 'The email form could not be opened.')}>
                Open the email form
              </QuietButton>
            )}
          </div>
          {opened && <p className="ab-hint" role="status">{opened}</p>}
        </>
      )}
    </>
  );
}
