import React, { useEffect, useRef, useState } from 'react';
import { read, plainError } from '../ask.js';
import RecordLink from '../RecordLink.jsx';
import ErrorNote from '../ErrorNote.jsx';
import Notes from '../knowledge/Notes.jsx';
import { EmptyNote, ShowMore } from '../ui/primitives.jsx';
import { copyText } from '../reports/download.js';
import { articleShareUrl, freshnessOf } from './articleInfo.js';

// N23 Knowledge search, for everyone: a search box over the published articles the person can read, ranked like the ticket's
// "Knowledge that may help" (src/context/knowledge.js searchKnowledgeText). GET only, with their own session; nothing is sent to an
// AI. Each result opens in the person's own UI (RecordLink) and has "Copy link" for sharing with a customer.

const SLOW_MS = 3000;

function Hit({ page, hit, copied, onCopy }) {
  const fresh = freshnessOf(hit);
  const meta = [hit.knowledgeBase, hit.category].filter(Boolean).join(' · ');
  return (
    <article className="ab-kbx-hit" aria-label={`${hit.number} ${hit.title}`}>
      <RecordLink page={page} item={{ table: 'kb_knowledge', sysId: hit.sysId }} className="ab-kbx-hit-title">
        <span className="ab-record-number">{hit.number}</span> {hit.title}
      </RecordLink>
      <div className="ab-kbx-hit-meta">
        {meta && <span>{meta}</span>}
        {fresh.text && <span className={`ab-tag ab-kbx-fresh ab-kbx-fresh-${fresh.level}`}>{fresh.text}</span>}
      </div>
      {hit.excerpt && <p className="ab-kbx-excerpt">{hit.excerpt}</p>}
      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={!articleShareUrl(page, hit)} onClick={() => onCopy(hit)}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </article>
  );
}

export default function SearchCard({ page, active, onSummary = () => {} }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState(null); // { phase: 'reading' | 'ready' | 'error', data, error, asked, slow }
  const [copied, setCopied] = useState('');
  const token = useRef(0);
  const timer = useRef(null);

  useEffect(() => () => {
    token.current += 1;
    clearTimeout(timer.current);
  }, []);

  async function search(e) {
    e?.preventDefault?.();
    const asked = query.trim();
    if (!asked) return;
    token.current += 1;
    const mine = token.current;
    setCopied('');
    setState({ phase: 'reading', data: null, error: '', asked, slow: false });
    clearTimeout(timer.current);
    // A read longer than 3 seconds says what it is waiting for (TRACKER.md 2.4).
    timer.current = setTimeout(() => mine === token.current && setState((s) => (s?.phase === 'reading' ? { ...s, slow: true } : s)), SLOW_MS);
    try {
      const data = await read(page.tabId, 'kbSearch', { query: asked });
      if (mine !== token.current) return;
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      setState({ phase: 'ready', data: { ...data, hits, access: Array.isArray(data?.access) ? data.access : [] }, error: '', asked });
      onSummary(hits.length ? `${hits.length}${data?.more ? '+' : ''} for "${asked.slice(0, 30)}"` : '');
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: plainError(err, 'The knowledge base could not be searched.'), asked });
    } finally {
      clearTimeout(timer.current);
    }
  }

  async function copy(hit) {
    const url = articleShareUrl(page, hit);
    if (url && (await copyText(url))) setCopied(hit.sysId);
  }

  const data = state?.phase === 'ready' ? state.data : null;
  return (
    <div className="ab-kbx-search">
      <div className="ab-row ab-kbx-searchrow" role="search">
        <label className="ab-offscreen-label" htmlFor="ab-kb-search">Search knowledge</label>
        <input id="ab-kb-search" className="ab-input" type="search" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(e)} placeholder="Words from the problem, or an article number" autoComplete="off" />
        <button type="button" className="ab-btn ab-btn-primary ab-btn-sm" onClick={search} disabled={!active || !query.trim() || state?.phase === 'reading'}>Search</button>
      </div>

      {!state && <p className="ab-hint">Every published article you can read, best match first: the same ranking as on a ticket.</p>}
      {state?.phase === 'reading' && <p className="ab-sub" role="status">{state.slow ? 'Still searching the knowledge base. Large bases take a moment…' : 'Searching…'}</p>}
      {state?.phase === 'error' && <ErrorNote error={state.error} onRetry={search} />}
      {data && (
        <>
          {data.hits.length === 0 ? (
            <EmptyNote>No published article you can read matches "{state.asked}". Try other words, or fewer.</EmptyNote>
          ) : (
            <ShowMore items={data.hits} className="ab-list ab-kbx-hits" render={(hit) => <Hit key={hit.sysId} page={page} hit={hit} copied={copied === hit.sysId} onCopy={copy} />} />
          )}
          {data.more && data.hits.length > 0 && <p className="ab-hint">More articles match. Add a word to narrow it down.</p>}
          <Notes access={data.access.filter((a) => a.status !== 'ok' && a.status !== 'empty')} />
        </>
      )}
    </div>
  );
}
