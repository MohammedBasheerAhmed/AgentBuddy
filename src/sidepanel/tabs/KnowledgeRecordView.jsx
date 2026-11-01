import { read } from '../ask.js';
import { articleFromPack, checkArticle } from '../../knowledge/articleChecks.js';
import { checkOutgoing } from '../../safeSend/index.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import Notes from '../knowledge/Notes.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { aiNeedsText } from '../aiReady.js';
import { useLoader } from '../checks/useLoader.js';
import { t, tn, t as tr } from '../../i18n/index.js';

// C5: checks on the article that is open, then optional AI suggestions. The checks run here on the pack the context engine read
// (nothing is sent anywhere); "Suggest improvements" goes through useRun like every other AI feature and is Copy only.
// props: { page, eff, record, header, run, aiReady, active }

const SECRET_KINDS = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const levelWord = (level) => ({ problem: t('Fix'), warn: t('Check'), info: t('Consider') })[level];

// Passwords, keys and card numbers in a published article. Email addresses and phone numbers are normal there, so only the serious kinds count.
const countSecrets = (text) => checkOutgoing(text, { people: [] }).findings.filter((f) => f.severity === 'high' && SECRET_KINDS.has(f.kind)).length;

function summaryLine(counts) {
  const parts = [];
  if (counts.problem) parts.push(t('{n} to fix', { n: counts.problem }));
  if (counts.warn) parts.push(t('{n} worth checking', { n: counts.warn }));
  if (counts.info) parts.push(t('{n} to consider', { n: counts.info }));
  return parts.length ? parts.join(t(', ')) : t('No problems found.');
}

const ago = (days) => (days <= 0 ? t('today') : tn(days, '{n} day ago', '{n} days ago'));

export default function KnowledgeRecordView({ page, eff, record, run, aiReady, active = true }) {
  const feature = featureById('article-optimise');
  const available = isFeatureAvailable(feature, eff.policy);

  // Read again when the tab comes back into view (the article may have been edited meanwhile); the last result stays meanwhile.
  const [state, load] = useLoader(async () => {
    const pack = await read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'article-check' });
    return { result: checkArticle(articleFromPack(pack), { now: Date.now(), scanSecrets: countSecrets }), access: Array.isArray(pack?.access) ? pack.access : [] };
  }, [page.tabId, record.table, record.sysId], { active });

  const phase = state.data ? 'ready' : state.phase;
  const { result, access } = state.data || { result: null, access: [] };
  const error = state.error;
  const facts = result?.facts;

  return (
    <>
      <section className="ab-card">
        <div className="ab-row ab-kb-head">
          <h2 className="ab-h">{t('Checks on this article')}</h2>
          <span className="ab-spacer" />
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={state.phase === 'loading'}>{t('Refresh')}</button>
        </div>
        <p className="ab-sub">{t('Found with your own session. Nothing here is sent to an AI.')}</p>
        {phase === 'loading' && <p className="ab-note" role="status">{t('Reading the article…')}</p>}
        {phase === 'error' && <ErrorNote error={error} onRetry={load} />}
        {phase === 'ready' && (
          <>
            <p className={`ab-note ${result.counts.problem ? 'ab-note-danger' : result.counts.warn ? 'ab-note-warn' : 'ab-note-ok'}`} role="status">{summaryLine(result.counts)}</p>
            <div className="ab-tags">
              <span className="ab-tag">{t('{words} words', { words: facts.words })}</span>
              {facts.headings !== null && <span className="ab-tag">{tn(facts.headings, '{n} heading', '{n} headings')}</span>}
              {facts.updatedDaysAgo !== null && <span className="ab-tag">{t('changed {when}', { when: ago(facts.updatedDaysAgo) })}</span>}
              {facts.views !== null && <span className="ab-tag">{tn(facts.views, '{n} view', '{n} views')}</span>}
              <span className="ab-tag">{tn(facts.keywords, '{n} keyword', '{n} keywords')}</span>
            </div>
            <ul className="ab-kb-findings">
              {result.findings.map((f) => (
                <li key={f.id} className={`ab-kb-finding ab-kb-${f.level}`}>
                  <span className="ab-kb-level">{levelWord(f.level)}</span>
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
        <h2 className="ab-h">{t('Suggestions from AI')}</h2>
        <p className="ab-sub">{t('Title, keywords, structure, clarity, missing prerequisites and steps that look out of date. The text goes through the privacy filter first. You copy what you want into the article yourself.')}</p>
        {!available && <p className="ab-note ab-note-warn">{t('Your organisation has switched this off.')}</p>}
        {available && !aiReady && <p className="ab-hint">{aiNeedsText(eff, 'this button') || t('Add an AI key in Settings to use this button.')}</p>}
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-primary" disabled={!aiReady || !available || run.busy} onClick={() => run.run(feature)}>
            {tr(feature.title)}
          </button>
        </div>
      </section>
    </>
  );
}
