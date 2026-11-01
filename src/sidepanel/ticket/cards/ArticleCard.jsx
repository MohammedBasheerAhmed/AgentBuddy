import React from 'react';
import { articleFromPack, checkArticle } from '../../../knowledge/articleChecks.js';
import { checkOutgoing } from '../../../safeSend/index.js';
import { ShowMore } from '../../ui/primitives.jsx';
import { read } from './data.js';
import { recordKey, useInsight, useReport } from './useInsight.js';
import { Notes, QuietButton, ReadState } from './bits.jsx';
import { t } from '../../../i18n/index.js';

// N7, article checks on the knowledge article that is open: length, structure, freshness, views, keywords, and secrets in the text.
// Worked out here on what the context engine read; nothing is sent anywhere. (Suggestions from AI are in AI Assist.)

const SECRET_KINDS = new Set(['SECRET', 'URL_CREDENTIALS', 'CARD', 'IBAN', 'NATIONAL_ID']);
const LEVEL = { problem: 'Fix', warn: 'Check', info: 'Consider' };
// Passwords, keys and card numbers in a published article. Email addresses and phone numbers are normal there, so only the serious kinds count.
const countSecrets = (text) => checkOutgoing(text, { people: [] }).findings.filter((f) => f.severity === 'high' && SECRET_KINDS.has(f.kind)).length;
const ago = (days) => (days <= 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`);

export function articleSummary(counts) {
  const parts = [];
  if (counts.problem) parts.push(`${counts.problem} to fix`);
  if (counts.warn) parts.push(`${counts.warn} worth checking`);
  if (counts.info) parts.push(`${counts.info} to consider`);
  return parts.length ? parts.join(', ') : 'No problems found';
}

export default function ArticleCard({ page, record, active, setSummary, setAttention }) {
  const state = useInsight({
    key: `${recordKey(page, record)}|article`,
    load: async () => {
      const pack = await read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'article-check' });
      return { result: checkArticle(articleFromPack(pack), { now: Date.now(), scanSecrets: countSecrets }), access: Array.isArray(pack?.access) ? pack.access : [] };
    },
    active,
    maxAgeMs: 30000,
    refreshOnShow: true, // the article may have been edited meanwhile
  });
  const result = state.data?.result;
  useReport(setSummary, result ? articleSummary(result.counts) : '');
  useReport(setAttention, result?.counts.problem ? 'warn' : '');

  if (!result) return <ReadState state={state} what="the article" onRetry={state.reload} />;
  const facts = result.facts;
  return (
    <>
      <div className="ab-tags">
        <span className="ab-tag">{t('{words} words', { words: facts.words })}</span>
        {facts.headings !== null && <span className="ab-tag">{facts.headings} heading{facts.headings === 1 ? '' : 's'}</span>}
        {facts.updatedDaysAgo !== null && <span className="ab-tag">changed {ago(facts.updatedDaysAgo)}</span>}
        {facts.views !== null && <span className="ab-tag">{facts.views} view{facts.views === 1 ? '' : 's'}</span>}
        <span className="ab-tag">{facts.keywords} keyword{facts.keywords === 1 ? '' : 's'}</span>
      </div>
      {result.findings.length > 0 ? (
        <ShowMore
          items={result.findings}
          className="ab-kb-findings"
          render={(f) => (
            <div key={f.id} className={`ab-kb-finding ab-kb-${f.level}`}>
              <span className="ab-kb-level">{LEVEL[f.level]}</span>
              <span className="ab-kb-finding-body">
                <strong>{f.title}</strong>
                <span className="ab-kb-detail">{f.detail}</span>
              </span>
            </div>
          )}
        />
      ) : (
        <p className="ab-note ab-note-ok">{t('No problems found in this article.')}</p>
      )}
      <Notes access={state.data.access} />
      <div className="ab-ins-foot">
        <QuietButton onClick={state.reload} disabled={state.phase === 'loading'}>
          {t('Check again')}
        </QuietButton>
      </div>
    </>
  );
}
