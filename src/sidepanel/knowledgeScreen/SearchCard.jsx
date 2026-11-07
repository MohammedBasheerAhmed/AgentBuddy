import { useEffect, useRef, useState } from 'react';
import { read, plainError } from '../ask.js';
import RecordLink from '../RecordLink.jsx';
import ErrorNote from '../ErrorNote.jsx';
import Notes from '../knowledge/Notes.jsx';
import { EmptyNote } from '../ui/primitives.jsx';
import { MoreRows, Section } from '../write/Section.jsx';
import { useTicketHeaderRead } from '../write/TicketLine.jsx';
import { copyText } from '../reports/download.js';
import { freshnessOf } from './articleInfo.js';
import { customerArticleLink } from '../../lib/snLinks.js';
import { placeOf } from './shared.js';
import { KNOWLEDGE_SECTIONS } from './railSections.js';
import { isolate, t } from '../../i18n/index.js';

// N23 Knowledge search, for everyone: a search box over the published articles the person can read, ranked like the ticket's
// "Knowledge that may help" (src/context/knowledge.js searchKnowledgeText). GET only, with their own session; nothing is sent to an
// AI. Each result opens at the article reader in a new tab (RecordLink: the ticket on screen is not replaced) and has "Copy link" for
// sharing with a customer: the same address (src/lib/snLinks.js), whichever tab the person has open.
// With a ticket open, the screen starts with the same search run once on the ticket's title ("Articles for INC0012345"), so there is
// something useful before anything is typed. Both are keyed by the tab and instance (placeOf) and keep nothing once the panel closes.

const SLOW_MS = 3000;

/** One article as a row: number and title (a link that opens it), where it lives and how fresh it is, a short excerpt, Copy link. */
function Hit({ page, hit, copied, onCopy }) {
  const fresh = freshnessOf(hit);
  // Where it lives and how fresh it is, as one quiet line; an article that is old or about to expire says so in a chip.
  const warn = fresh.level === 'stale' || fresh.level === 'expiring';
  const meta = [hit.knowledgeBase, hit.category, warn ? '' : fresh.text].filter(Boolean).join(' · ');
  return (
    <li className="ab-row ab-kbx-hit">
      <div className="ab-row-main">
        <RecordLink page={page} item={{ table: 'kb_knowledge', sysId: hit.sysId, number: hit.number }} className="ab-row-title ab-kbx-hit-title">
          <span className="ab-kbx-number">{hit.number}</span> {hit.title}
        </RecordLink>
        {(meta || warn) && (
          <span className="ab-row-sub ab-kbx-hit-meta">
            {meta}
            {warn && <span className={`ab-chip ab-chip-warn ab-kbx-fresh ab-kbx-fresh-${fresh.level}`}>{fresh.text}</span>}
          </span>
        )}
        {hit.excerpt && <p className="ab-kbx-excerpt">{hit.excerpt}</p>}
      </div>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-kbx-copy" disabled={!customerArticleLink(page, hit)} onClick={() => onCopy(hit)}>
        {copied ? t('Link copied') : t('Copy link')}
      </button>
    </li>
  );
}

/**
 * The knowledge search of one tab and instance: run(words) reads, a newer run or the component going away drops an older answer,
 * a read longer than 3 seconds says what it waits for (TRACKER.md 2.4). onReady(data, asked) is told about each answer kept.
 * state: null | { phase: 'reading' | 'ready' | 'error', data, error, asked, slow }
 */
function useKbSearch(page, onReady = () => {}) {
  const [state, setState] = useState(null);
  const token = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => {
    token.current += 1;
    clearTimeout(timer.current);
  }, []);

  async function run(asked) {
    token.current += 1;
    const mine = token.current;
    setState({ phase: 'reading', data: null, error: '', asked, slow: false });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => mine === token.current && setState((s) => (s?.phase === 'reading' ? { ...s, slow: true } : s)), SLOW_MS);
    try {
      const data = await read(page.tabId, 'kbSearch', { query: asked });
      if (mine !== token.current) return;
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      const clean = { ...data, hits, access: Array.isArray(data?.access) ? data.access : [] };
      setState({ phase: 'ready', data: clean, error: '', asked });
      onReady(clean, asked);
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: plainError(err, t('The knowledge base could not be searched.')), asked });
    } finally {
      if (mine === token.current) clearTimeout(timer.current);
    }
  }
  return { state, run };
}

/** "Copy link" for the rows of one list: [sysId of the last article copied, copy(hit)]. */
function useCopyLink(page) {
  const [copied, setCopied] = useState('');
  const copy = async (hit) => {
    const url = customerArticleLink(page, hit);
    if (url && (await copyText(url))) setCopied(hit.sysId);
  };
  return [copied, copy, setCopied];
}

/** What a search found, as rows; or that it is reading, failed, or found nothing (`empty`). */
function Results({ page, state, empty, label, moreHint = true, copied, onCopy, onRetry }) {
  if (!state) return null;
  if (state.phase === 'reading') return <p className="ab-sub" role="status">{state.slow ? t('Still searching the knowledge base. Large bases take a moment…') : t('Searching…')}</p>;
  if (state.phase === 'error') return <ErrorNote error={state.error} onRetry={onRetry} />;
  const data = state.data;
  return (
    <>
      {data.hits.length === 0 ? (
        <EmptyNote>{empty}</EmptyNote>
      ) : (
        <MoreRows items={data.hits} label={label} className="ab-kbx-hits" render={(hit) => <Hit key={hit.sysId} page={page} hit={hit} copied={copied === hit.sysId} onCopy={onCopy} />} />
      )}
      {moreHint && data.more && data.hits.length > 0 && <p className="ab-hint">{t('More articles match. Add a word to narrow it down.')}</p>}
      <Notes access={data.access.filter((a) => a.status !== 'ok' && a.status !== 'empty')} />
    </>
  );
}

/**
 * The search for the tab and instance `page` is on. Another tab or instance starts it over (placeOf): the results on screen are
 * the old instance's articles, and a search still on its way for it is dropped as the old card goes away.
 */
export default function SearchCard(props) {
  return <Search key={placeOf(props.page)} {...props} />;
}

function Search({ page, active, onSummary = () => {} }) {
  const [query, setQuery] = useState('');
  const [copied, copy, setCopied] = useCopyLink(page);
  const search = useKbSearch(page, (data, asked) => {
    onSummary(data.hits.length ? t('{count} for "{query}"', { count: `${data.hits.length}${data.more ? '+' : ''}`, query: isolate(asked.slice(0, 30)) }) : '');
  });

  function go(e) {
    e?.preventDefault?.();
    const asked = query.trim();
    if (!asked) return;
    setCopied('');
    search.run(asked);
  }

  const state = search.state;
  return (
    <div className="ab-kbx-search">
      <div className="ab-wk-inline ab-kbx-searchrow" role="search">
        <label className="ab-offscreen-label" htmlFor="ab-kb-search">{t('Search knowledge')}</label>
        <input id="ab-kb-search" className="ab-input" type="search" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(e)} placeholder={t('Words from the problem, or an article number')} autoComplete="off" />
        <button type="button" className="ab-btn ab-btn-primary" onClick={go} disabled={!active || !query.trim() || state?.phase === 'reading'}>{t('Search')}</button>
      </div>
      {!state && <p className="ab-hint">{t('Every published article you can read, best match first: the same ranking as on a ticket.')}</p>}
      <Results
        page={page}
        state={state}
        label={t('Articles found')}
        empty={t('No published article you can read matches "{asked}". Try other words, or fewer.', { asked: isolate(state?.asked || '') })}
        copied={copied}
        onCopy={copy}
        onRetry={go}
      />
    </div>
  );
}

// ---- Articles for the open ticket -------------------------------------------------------------------------------------------

/** The open record when it is a ticket (not an article: its own title would only find itself), else null. */
export function ticketOf(page) {
  const record = page?.record;
  if (!record?.table || !record?.sysId || record.table === 'kb_knowledge') return null;
  return record;
}

/**
 * "Articles for INC0012345": the knowledge search, run once per record on the ticket's title (the header read the Write screen
 * makes), only while the screen is on show. Reads only; no AI. A sensitive record whose title may not be read is said, not searched.
 * Keyed by the tab and instance like the search (placeOf).
 */
export function TicketArticles(props) {
  return <ForTicket key={placeOf(props.page)} {...props} />;
}

function ForTicket({ page, eff, active }) {
  const record = ticketOf(page);
  const recordKey = record ? `${record.table}:${record.sysId}` : '';
  const { header, done } = useTicketHeaderRead(page, active && Boolean(record), Boolean(eff?.policy?.allowHrContent));
  const title = String(header?.short_description || '').replace(/\s+/g, ' ').trim();
  const [searched, setSearched] = useState(''); // the record whose title was searched
  const [copied, copy, setCopied] = useCopyLink(page);
  const search = useKbSearch(page);

  useEffect(() => {
    if (!active || !recordKey || !title || searched === recordKey) return;
    setSearched(recordKey);
    setCopied('');
    search.run(title);
    // The record and its title decide when to search; the search object changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, recordKey, title, searched]);

  if (!record) {
    return (
      <div className="ab-section ab-wk-section ab-kbx-ticket" data-card="kb-ticket">
        <EmptyNote>{t('Open a ticket to see the articles that match it here, or search below.')}</EmptyNote>
      </div>
    );
  }
  const number = record.number || header?.number || '';
  const mine = searched === recordKey; // what is on screen is about this record, never the one before
  let body;
  if (mine) {
    body = (
      <Results
        page={page}
        state={search.state}
        label={t('Articles for the open ticket')}
        moreHint={false}
        empty={t("No published article you can read matches this ticket's title. Search with other words below.")}
        copied={copied}
        onCopy={copy}
        onRetry={() => search.run(title)}
      />
    );
  } else if (done && !title) {
    body = <p className="ab-hint">{t("This ticket's title cannot be read here, so search with your own words below.")}</p>;
  } else {
    body = <p className="ab-sub" role="status">{t('Searching…')}</p>;
  }
  return (
    <Section rail={KNOWLEDGE_SECTIONS.ticket} title={KNOWLEDGE_SECTIONS.ticket.label({ number })} className="ab-kbx-ticket">
      {body}
    </Section>
  );
}
