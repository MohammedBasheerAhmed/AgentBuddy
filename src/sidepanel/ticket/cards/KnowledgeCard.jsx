import { ShowMore } from '../../ui/primitives.jsx';
import { customerArticleLink } from '../../../lib/snLinks.js';
import { useKnowledge } from './data.js';
import { readFully, useReport } from './useInsight.js';
import { CopyButton, ItemLink, Notes, QuietButton, ReadState } from './bits.jsx';
import { t, tn } from '../../../i18n/index.js';

// N3, knowledge for this ticket: published articles that match its words, best first. The row opens the article at its reader in a
// new tab; "Copy link" copies that same address (src/lib/snLinks.js: one address whichever tab the agent has open) to paste into a reply.

// Only the newest matches are read and ranked, and the articles the person can read are the ones the search sees: "found" is about that
// (R-21), and a search that could not see everything says so (R-09).
function noArticles(seen, truncated) {
  if (!seen) return t('No published article found, but some could not be checked. Try the Knowledge screen to search yourself.');
  return truncated ? t('No published article found among the newest matches for the words of this ticket. Try the Knowledge screen to search yourself.') : t('No published article matches the words of this ticket. Try the Knowledge screen to search yourself.');
}

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || '');

export default function KnowledgeCard({ page, eff, record, active, setSummary, setAttention }) {
  const kb = useKnowledge({ page, record, eff, active });
  const hits = Array.isArray(kb.data?.hits) ? kb.data.hits : [];
  const read = Boolean(kb.data && !kb.error);
  // A search that could not see everything (denied, failed, blocked, hidden rows) is not "no matching articles" (R-09).
  const seen = read && readFully(kb.data.access);
  useReport(setSummary, read ? (hits.length ? tn(hits.length, '{n} matching article', '{n} matching articles') : seen ? t('No matching articles') : t('Could not check articles')) : '');
  useReport(setAttention, read && !hits.length && seen ? 'clear' : '');

  return (
    <>
      <ReadState state={kb} what={t('knowledge articles')} onRetry={kb.reload} />
      {hits.length > 0 && (
        <ShowMore
          items={hits}
          render={(h) => {
            const share = customerArticleLink(page, h);
            return (
              <div key={h.sysId} className="ab-ins-row">
                <ItemLink page={page} item={{ ...h, table: 'kb_knowledge' }} line={[h.knowledgeBase, h.viewCount ? tn(h.viewCount, '{n} view', '{n} views') : ''].filter(Boolean).join(' · ')} extra={clip(h.excerpt, 160)} />
                {share && <CopyButton value={share} label={t('Copy link')} title={t("Copy the article's address. Check that the customer can open it.")} />}
              </div>
            );
          }}
        />
      )}
      {read && !hits.length && <p className="ab-hint">{noArticles(seen, kb.data.truncated)}</p>}
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
