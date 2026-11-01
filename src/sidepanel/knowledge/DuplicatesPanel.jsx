import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { read } from '../ask.js';
import RecordLink from '../RecordLink.jsx';
import { MERGE_MAX_ARTICLES } from '../../knowledge/parts.js';
import { DUPLICATE_THRESHOLD, findDuplicateClusters } from '../../knowledge/similarity.js';
import { KB_MAX_ARTICLES, KB_MAX_OFFSET } from '../../context/knowledge.js';
import { toCsv } from '../../lib/export.js';
import { downloadText } from '../reports/download.js';
import { EmptyNote, ShowMore } from '../ui/primitives.jsx';
import Notes from './Notes.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { plainNote } from '../plainAccess.js';
import { compareLocked, compareStillCurrent, selectionKey } from './duplicatesState.js';
import { DUPLICATE_COLUMNS, duplicateRows, exportFileName } from '../knowledgeScreen/articleInfo.js';

// N18 Duplicate article finder (Insights, no AI): pick a knowledge base (and, if you like, a category), see groups of published
// articles whose titles read alike, page through more titles, pick one group and compare the TEXT of its articles. Titles and counts
// are all that is read about the whole scope; an article's text is only read for the few in the group you pick. The group whose text
// was compared is handed to the AI Assist half (onCompared), where "Draft a merged article" works from it.

const pct = (ratio) => `${Math.round(ratio * 100)}%`;
const MAX_TITLES = KB_MAX_OFFSET + KB_MAX_ARTICLES; // every title is compared with every other one, here in the panel

/** The articles of several pages as one list (a page read again after a change can repeat an article). */
export function mergePages(pages) {
  const seen = new Set();
  const out = [];
  for (const page of pages) {
    for (const a of Array.isArray(page) ? page : []) {
      if (!a?.sysId || seen.has(a.sysId)) continue;
      seen.add(a.sysId);
      out.push(a);
    }
  }
  return out;
}

/** "Compared 300 of 1,240 titles." / "Compared 12 titles." */
export function comparedText(scanned, total) {
  const n = Number(scanned) || 0;
  if (Number.isFinite(total) && total > n) return `Compared ${n.toLocaleString('en')} of ${Number(total).toLocaleString('en')} titles.`;
  return `Compared ${n.toLocaleString('en')} title${n === 1 ? '' : 's'}.`;
}

export default function DuplicatesPanel({ page, active = true, onCompared = () => {} }) {
  const [scopes, setScopes] = useState({ phase: 'idle', items: [], access: [], error: '' });
  const [kb, setKb] = useState('');
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [found, setFound] = useState(null); // { phase: 'loading' | 'ready' | 'error' | 'more', pages: article[][], total, truncated, access, error }
  const [picked, setPicked] = useState(null); // { cluster, selected: Set(sysId), phase, texts, error }
  const [note, setNote] = useState('');
  const token = useRef(0);
  const compareToken = useRef(0); // a newer Compare (or a changed selection) makes an older answer count for nothing
  const mergeHeading = useRef(null);
  const pickedNow = useRef(null); // the group on screen at the last render, for a read that comes back later
  pickedNow.current = picked;

  const scopeToken = useRef(0);
  const loadScopes = useCallback(() => {
    scopeToken.current += 1;
    const mine = scopeToken.current;
    setScopes({ phase: 'loading', items: [], access: [], error: '' });
    read(page.tabId, 'kbScopes', {})
      .then((out) => mine === scopeToken.current && setScopes({ phase: 'ready', items: out.items || [], access: out.access || [], error: '' }))
      .catch((err) => mine === scopeToken.current && setScopes({ phase: 'error', items: [], access: [], error: err?.message || 'The knowledge bases could not be listed.' }));
  }, [page.tabId]);

  // The knowledge bases are listed the first time the tool is on show (not while it is folded away).
  useEffect(() => {
    if (active && scopes.phase === 'idle') loadScopes();
  }, [active, scopes.phase, loadScopes]);
  useEffect(
    () => () => {
      scopeToken.current += 1;
      token.current += 1;
    },
    []
  );

  // Opening the compare part moves focus to it, so a keyboard or screen reader user lands where the new controls are.
  const pickedId = picked?.cluster.id;
  useEffect(() => {
    if (pickedId) mergeHeading.current?.focus();
  }, [pickedId]);

  const forget = () => {
    token.current += 1;
    compareToken.current += 1;
    setFound(null);
    setPicked(null);
    setNote('');
    onCompared(null);
  };

  const chooseKb = (id) => {
    forget();
    setKb(id);
    setCategory('');
    setCategories([]);
    if (!id) return;
    const mine = token.current;
    read(page.tabId, 'kbScopes', { knowledgeBase: id })
      .then((out) => mine === token.current && setCategories(out.items || []))
      .catch(() => {}); // categories are optional: the whole base can still be searched
  };

  // Another category: what was found (or is being found) was for the old scope, so it is dropped, also when it is still on its way.
  function chooseCategory(id) {
    forget();
    setCategory(id);
  }

  // "Stop" while titles are compared: the answer, when it comes, is dropped (pages already read stay).
  function stop() {
    token.current += 1;
    setFound((f) => (f && f.pages.length ? { ...f, phase: 'ready' } : null));
  }

  async function readPage(offset) {
    token.current += 1;
    const mine = token.current;
    try {
      const data = await read(page.tabId, 'kbDuplicates', { knowledgeBase: kb, category, offset });
      if (mine !== token.current) return;
      // (the answer comes from the page: a list that is missing is an empty one, never a crash)
      const articles = Array.isArray(data?.articles) ? data.articles : (Array.isArray(data?.clusters) ? data.clusters.flatMap((c) => c.articles || []) : []);
      setFound((f) => ({
        phase: 'ready',
        pages: [...(offset > 0 && f ? f.pages : []), articles],
        total: Number.isFinite(data?.total) ? data.total : null,
        truncated: Boolean(data?.truncated),
        access: Array.isArray(data?.access) ? data.access : [],
        error: '',
      }));
    } catch (err) {
      if (mine !== token.current) return;
      setFound((f) => (offset > 0 && f ? { ...f, phase: 'ready', error: err?.message || 'The next titles could not be read.' } : { phase: 'error', pages: [], access: [], error: err?.message || 'The articles could not be compared.' }));
    }
  }

  function find() {
    forget();
    setFound({ phase: 'loading', pages: [], access: [], error: '' });
    readPage(0);
  }

  const articles = useMemo(() => mergePages(found?.pages || []), [found?.pages]);
  const clusters = useMemo(() => findDuplicateClusters(articles, { threshold: DUPLICATE_THRESHOLD }), [articles]);
  const canPage = found?.phase === 'ready' && found.truncated && articles.length < MAX_TITLES;

  function more() {
    compareToken.current += 1;
    setPicked(null);
    onCompared(null);
    setFound((f) => ({ ...f, phase: 'more', error: '' }));
    readPage(articles.length);
  }

  function pick(cluster) {
    if (compareLocked(picked)) return;
    compareToken.current += 1;
    onCompared(null);
    setPicked({ cluster, selected: new Set(cluster.articles.slice(0, MERGE_MAX_ARTICLES).map((a) => a.sysId)), phase: 'choosing', texts: null, error: '' });
  }

  function toggle(sysId) {
    compareToken.current += 1;
    onCompared(null);
    setPicked((p) => {
      if (!p || compareLocked(p)) return p;
      const selected = new Set(p.selected);
      if (selected.has(sysId)) selected.delete(sysId);
      else if (selected.size < MERGE_MAX_ARTICLES) selected.add(sysId);
      return { ...p, selected, phase: 'choosing', texts: null };
    });
  }

  // The answer is applied only if it is still for this group with these articles ticked (see duplicatesState.js).
  async function compare() {
    if (!picked || compareLocked(picked)) return;
    const ids = [...picked.selected];
    compareToken.current += 1;
    const request = { token: compareToken.current, key: selectionKey(picked.cluster.id, ids) };
    const stillMine = (p) => compareStillCurrent(request, { token: compareToken.current, picked: p });
    setPicked((p) => ({ ...p, phase: 'loading', error: '' }));
    try {
      const texts = await read(page.tabId, 'kbArticleTexts', { sysIds: ids });
      if (!stillMine(pickedNow.current)) return;
      onCompared({ cluster: pickedNow.current.cluster, texts, at: Date.now() });
      setPicked((p) => (stillMine(p) ? { ...p, phase: 'compared', texts } : p));
    } catch (err) {
      setPicked((p) => (stillMine(p) ? { ...p, phase: 'choosing', error: err?.message || 'The articles could not be read.' } : p));
    }
  }

  function exportGroups() {
    try {
      downloadText(exportFileName('duplicate-articles'), toCsv(duplicateRows(clusters), DUPLICATE_COLUMNS));
      setNote(`Saved ${clusters.length} group${clusters.length === 1 ? '' : 's'} as a CSV file in your downloads.`);
    } catch {
      setNote('The browser did not save the file.');
    }
  }

  const sel = picked?.selected.size || 0;
  const locked = compareLocked(picked); // a read is on its way: nothing it depends on may change
  const reading = found?.phase === 'loading' || found?.phase === 'more';
  const okNote = found?.access?.find((a) => a.status === 'ok' && a.note)?.note;

  return (
    <div className="ab-kbx-tool">
      <p className="ab-hint">Compares titles of published articles, 300 at a time, newest changed first. Text is only read inside a group you pick.</p>
      {scopes.phase === 'loading' && <p className="ab-sub" role="status">Looking for knowledge bases…</p>}
      {scopes.phase === 'error' && <ErrorNote error={scopes.error} onRetry={loadScopes} />}
      {scopes.phase === 'ready' && scopes.items.length === 0 && <EmptyNote>No published articles are available to you.</EmptyNote>}
      <Notes access={scopes.access} />
      {scopes.items.length > 0 && (
        <>
          <div className="ab-field">
            <label className="ab-label" htmlFor="ab-kb-base">Knowledge base</label>
            <select id="ab-kb-base" className="ab-select" value={kb} disabled={reading} onChange={(e) => chooseKb(e.target.value)}>
              <option value="">Choose one…</option>
              {scopes.items.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.count})</option>
              ))}
            </select>
          </div>
          {categories.length > 0 && (
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-kb-category">Category (optional)</label>
              <select id="ab-kb-category" className="ab-select" value={category} onChange={(e) => chooseCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.count})</option>
                ))}
              </select>
            </div>
          )}
          <div className="ab-row">
            <button type="button" className="ab-btn" disabled={!kb || reading} onClick={find}>Find duplicates</button>
          </div>
        </>
      )}

      {reading && (
        <p className="ab-sub" role="status">
          Comparing titles…{' '}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={stop}>Stop</button>
        </p>
      )}
      {found?.phase === 'error' && <ErrorNote error={found.error} onRetry={find} />}

      {found && found.phase !== 'loading' && found.phase !== 'error' && (
        <section className="ab-kbx-results" aria-label="Duplicate groups">
          <p className="ab-sub">
            {comparedText(articles.length, found.total)}{' '}
            {clusters.length ? `${clusters.length} group${clusters.length === 1 ? '' : 's'} read alike.` : 'No near-duplicates found.'}
          </p>
          <Notes access={found.access} />
          {found.error && <ErrorNote error={found.error} onRetry={more} />}
          {canPage && (
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-sm" onClick={more}>Compare {Math.min(KB_MAX_ARTICLES, (found.total || Infinity) - articles.length).toLocaleString('en')} more</button>
            </div>
          )}
          {okNote && !canPage && found.truncated && <p className="ab-hint">{plainNote(okNote)}</p>}
          <ShowMore
            items={clusters}
            className="ab-list"
            render={(c) => (
              <div key={c.id} className={`ab-kb-cluster${picked?.cluster.id === c.id ? ' ab-kb-picked' : ''}`}>
                <div className="ab-row">
                  <strong>{c.articles.length} articles{c.exactTitle ? ' with the same title' : ' that read alike'}</strong>
                  <span className="ab-spacer" />
                  <button type="button" className="ab-btn ab-btn-sm" disabled={locked} onClick={() => pick(c)}>Compare</button>
                </div>
                {c.sharedWords.length > 0 && <div className="ab-tags">{c.sharedWords.map((w) => <span key={w} className="ab-tag">{w}</span>)}</div>}
                <ul className="ab-kb-articles">
                  {c.articles.map((a) => (
                    <li key={a.sysId}>
                      <RecordLink page={page} item={{ table: 'kb_knowledge', sysId: a.sysId }} className="ab-btn ab-btn-quiet ab-btn-sm ab-kb-open">
                        <span className="ab-record-number">{a.number}</span> {a.title}
                      </RecordLink>
                      <span className="ab-hint">{a.views} view{a.views === 1 ? '' : 's'}{a.updated ? ` · changed ${a.updated.slice(0, 10)}` : ''}</span>
                    </li>
                  ))}
                </ul>
                <p className="ab-hint">Most read: {c.keep.number}</p>
              </div>
            )}
          />
          {clusters.length > 0 && (
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={exportGroups}>Export groups (CSV)</button>
            </div>
          )}
          {note && <p className="ab-hint" role="status">{note}</p>}
        </section>
      )}

      {picked && (
        <section className="ab-kbx-compare" aria-label="Compare the text">
          <h3 className="ab-h" ref={mergeHeading} tabIndex={-1}>Compare the text</h3>
          <p className="ab-sub">Choose two to {MERGE_MAX_ARTICLES} articles.</p>
          <ul className="ab-kb-articles">
            {picked.cluster.articles.map((a) => (
              <li key={a.sysId}>
                <label className="ab-check">
                  <input type="checkbox" checked={picked.selected.has(a.sysId)} onChange={() => toggle(a.sysId)} disabled={locked || (!picked.selected.has(a.sysId) && sel >= MERGE_MAX_ARTICLES)} />
                  <span><span className="ab-record-number">{a.number}</span> {a.title}</span>
                </label>
              </li>
            ))}
          </ul>
          {picked.error && <ErrorNote error={picked.error} onRetry={compare} />}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={sel < 2 || picked.phase === 'loading'} onClick={compare}>
              {picked.phase === 'loading' ? 'Reading…' : 'Compare their text'}
            </button>
          </div>
          {picked.phase === 'compared' && picked.texts && (
            <>
              <ul className="ab-kb-pairs">
                {(picked.texts.pairs || []).map((p) => (
                  <li key={`${p.a}:${p.b}`}>
                    <strong>{p.a}</strong> and <strong>{p.b}</strong>: {pct(p.containment)} of the shorter text also appears in the other ({pct(p.jaccard)} of all the wording is shared).
                  </li>
                ))}
              </ul>
              <Notes access={picked.texts.access} />
              <p className="ab-hint">To draft one merged article from these, switch to AI Assist.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
