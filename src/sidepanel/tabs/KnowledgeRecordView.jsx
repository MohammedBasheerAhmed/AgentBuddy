import { useCallback, useEffect, useState } from 'react';
import { read } from '../ask.js';
import { articleFromPack, checkArticle } from '../../knowledge/articleChecks.js';
import { checkOutgoing } from '../../safeSend/index.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import Notes from '../knowledge/Notes.jsx';

// C5: checks on the article that is open, then optional AI suggestions. The checks run here on the pack the context engine read
// (nothing is sent anywhere); "Suggest improvements" goes through useRun like every other AI feature and is Copy only.
// props: { page, eff, record, header, run, aiReady }

const SECRET_KINDS = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const LEVEL = { problem: 'Fix', warn: 'Check', info: 'Consider' };

// Passwords, keys and card numbers in a published article. Email addresses and phone numbers are normal there, so only the serious kinds count.
const countSecrets = (text) => checkOutgoing(text, { people: [] }).findings.filter((f) => f.severity === 'high' && SECRET_KINDS.has(f.kind)).length;

function summaryLine(counts) {
  const parts = [];
  if (counts.problem) parts.push(`${counts.problem} to fix`);
  if (counts.warn) parts.push(`${counts.warn} worth checking`);
  if (counts.info) parts.push(`${counts.info} to consider`);
  return parts.length ? parts.join(', ') : 'No problems found.';
}

const ago = (days) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`);

export default function KnowledgeRecordView({ page, eff, record, run, aiReady }) {
  const [state, setState] = useState({ phase: 'loading', result: null, access: [], error: '' });
  const feature = featureById('article-optimise');
  const available = isFeatureAvailable(feature, eff.policy);

  const load = useCallback(async () => {
    setState({ phase: 'loading', result: null, access: [], error: '' });
    try {
      const pack = await read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'article-check' });
      const result = checkArticle(articleFromPack(pack), { now: Date.now(), scanSecrets: countSecrets });
      setState({ phase: 'ready', result, access: pack.access || [], error: '' });
    } catch (err) {
      setState({ phase: 'error', result: null, access: [], error: err?.message || 'The article could not be read.' });
    }
  }, [page.tabId, record.table, record.sysId]);

  useEffect(() => {
    load();
  }, [load]);

  const { phase, result, access, error } = state;
  const facts = result?.facts;

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-kb-head">
          <h2 className="ab-h">Checks on this article</h2>
          <span className="ab-spacer" />
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={phase === 'loading'}>Refresh</button>
        </div>
        <p className="ab-sub">Found with your own session. Nothing here is sent to an AI.</p>
        {phase === 'loading' && <p className="ab-note" role="status">Reading the article…</p>}
        {phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{error}</p>}
        {phase === 'ready' && (
          <>
            <p className={`ab-note ${result.counts.problem ? 'ab-note-danger' : result.counts.warn ? 'ab-note-warn' : 'ab-note-ok'}`} role="status">{summaryLine(result.counts)}</p>
            <div className="ab-tags">
              <span className="ab-tag">{facts.words} words</span>
              {facts.headings !== null && <span className="ab-tag">{facts.headings} heading{facts.headings === 1 ? '' : 's'}</span>}
              {facts.updatedDaysAgo !== null && <span className="ab-tag">changed {ago(facts.updatedDaysAgo)}</span>}
              {facts.views !== null && <span className="ab-tag">{facts.views} view{facts.views === 1 ? '' : 's'}</span>}
              <span className="ab-tag">{facts.keywords} keyword{facts.keywords === 1 ? '' : 's'}</span>
            </div>
            <ul className="ab-kb-findings">
              {result.findings.map((f) => (
                <li key={f.id} className={`ab-kb-finding ab-kb-${f.level}`}>
                  <span className="ab-kb-level">{LEVEL[f.level]}</span>
                  <span className="ab-kb-finding-body">
                    <strong>{f.title}</strong>
                    <span className="ab-kb-detail">{f.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Notes access={access} />
          </>
        )}
      </section>

      <section className="ab-card">
        <h2 className="ab-h">Suggestions from AI</h2>
        <p className="ab-sub">Title, keywords, structure, clarity, missing prerequisites and steps that look out of date. The text goes through the privacy filter first. You copy what you want into the article yourself.</p>
        {!available && <p className="ab-note ab-note-warn">Your organisation has switched this off.</p>}
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-primary" disabled={!aiReady || !available || run.busy} onClick={() => run.run(feature)}>
            {feature.title}
          </button>
        </div>
      </section>
    </>
  );
}
