import React from 'react';
import { ShowMore } from '../../ui/primitives.jsx';
import { articleShareUrl } from '../../../insights/links.js';
import { useKnowledge } from './data.js';
import { useReport } from './useInsight.js';
import { CopyButton, ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t, tn } from '../../../i18n/index.js';

// N3, knowledge for this ticket: published articles that match its words, best first. "Copy link" copies the article's reading
// address (the portal's article page, or the classic article view) to paste into a reply.

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || '');

export default function KnowledgeCard({ page, eff, record, active, setSummary }) {
  const kb = useKnowledge({ page, record, eff, active });
  const hits = Array.isArray(kb.data?.hits) ? kb.data.hits : [];
  useReport(setSummary, kb.data && !kb.error ? (hits.length ? tn(hits.length, '{n} matching article', '{n} matching articles') : t('No matching articles')) : '');

  return (
    <>
      <ReadState state={kb} what={t('knowledge articles')} onRetry={kb.reload} />
      {hits.length > 0 && (
        <ShowMore
          items={hits}
          render={(h) => {
            const share = articleShareUrl(page, h);
            return (
              <div key={h.sysId} className="ab-ins-row">
                <ItemLink page={page} item={{ ...h, table: 'kb_knowledge' }} line={[h.knowledgeBase, h.viewCount ? tn(h.viewCount, '{n} view', '{n} views') : ''].filter(Boolean).join(' · ')} extra={clip(h.excerpt, 160)} />
                {share && <CopyButton value={share} label={t('Copy link')} title={t("Copy the article's address to share it with the customer")} />}
              </div>
            );
          }}
        />
      )}
      {kb.data && !hits.length && !kb.error && <p className="ab-hint">{t('No published article matches the words of this ticket. Try the Knowledge screen to search yourself.')}</p>}
      <Notes access={kb.data?.access} />
      {kb.data && (
        <div className="ab-ins-foot">
          <QuietButton onClick={kb.reload} disabled={kb.phase === 'loading'}>
            {t('Refresh')}
          </QuietButton>
        </div>
      )}
    </>
  );
}
