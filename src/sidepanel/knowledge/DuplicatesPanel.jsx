import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { openRecord } from '../openRecord.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { MERGE_MAX_ARTICLES, mergePack } from '../../knowledge/parts.js';
import Notes from './Notes.jsx';

// C6: pick a knowledge base (and, if you like, a category), see groups of published articles whose titles read alike, pick one
// group, compare the text of its articles, and have the AI draft one merged article. Titles and counts are all that is read
// about the whole scope; the text of an article is only read for the few in the group you pick.

const pct = (ratio) => `${Math.round(ratio * 100)}%`;

export default function DuplicatesPanel({ page, eff, run, aiReady }) {
  const [scopes, setScopes] = useState({ phase: 'loading', items: [], access: [], error: '' });
  const [kb, setKb] = useState('');
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [found, setFound] = useState(null); // { phase, data, error }
  const [picked, setPicked] = useState(null); // { cluster, selected: Set(sysId), phase, texts, error }
  const token = useRef(0);
  const feature = featureById('kb-merge-draft');
  const available = isFeatureAvailable(feature, eff.policy);

  useEffect(() => {
    let cancelled = false;
    read(page.tabId, 'kbScopes', {})
      .then((out) => !cancelled && setScopes({ phase: 'ready', items: out.items || [], access: out.access || [], error: '' }))
      .catch((err) => !cancelled && setScopes({ phase: 'error', items: [], access: [], error: err?.message || 'The knowledge bases could not be listed.' }));
    return () => {
      cancelled = true;
    };
  }, [page.tabId]);

  const chooseKb = useCallback(
    (id) => {
      token.current += 1;
      setKb(id);
      setCategory('');
      setCategories([]);
      setFound(null);
      setPicked(null);
      if (!id) return;
      const mine = token.current;
      read(page.tabId, 'kbScopes', { knowledgeBase: id })
        .then((out) => mine === token.current && setCategories(out.items || []))
        .catch(() => {}); // categories are optional: the whole base can still be searched
    },
    [page.tabId]
  );

  async function find() {
    token.current += 1;
    const mine = token.current;
    run.reset();
    setPicked(null);
    setFound({ phase: 'loading', data: null, error: '' });
    try {
      const data = await read(page.tabId, 'kbDuplicates', { knowledgeBase: kb, category });
      if (mine === token.current) setFound({ phase: 'ready', data, error: '' });
    } catch (err) {
      if (mine === token.current) setFound({ phase: 'error', data: null, error: err?.message || 'The articles could not be compared.' });
    }
  }

  function pick(cluster) {
    run.reset();
    setPicked({
      cluster,
      selected: new Set(cluster.articles.slice(0, MERGE_MAX_ARTICLES).map((a) => a.sysId)),
      phase: 'choosing',
      texts: null,
      error: '',
    });
  }

  function toggle(sysId) {
    setPicked((p) => {
      const selected = new Set(p.selected);
      if (selected.has(sysId)) selected.delete(sysId);
      else if (selected.size < MERGE_MAX_ARTICLES) selected.add(sysId);
      return { ...p, selected, phase: 'choosing', texts: null };
    });
  }

  async function compare() {
    const ids = [...picked.selected];
    setPicked((p) => ({ ...p, phase: 'loading', error: '' }));
    try {
      const texts = await read(page.tabId, 'kbArticleTexts', { sysIds: ids });
      setPicked((p) => (p ? { ...p, phase: 'compared', texts } : p));
    } catch (err) {
      setPicked((p) => (p ? { ...p, phase: 'choosing', error: err?.message || 'The articles could not be read.' } : p));
    }
  }

  const data = found?.data;
  const sel = picked?.selected.size || 0;

  return (
    <>
      <section className="ab-card">
        <h2 className="ab-h">Find near-duplicate articles</h2>
        <p className="ab-sub">Compares the titles of published articles in one knowledge base. Nothing is sent to an AI until you ask for a merged draft.</p>
        {scopes.phase === 'loading' && <p className="ab-note" role="status">Looking for knowledge bases…</p>}
        {scopes.phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{scopes.error}</p>}
        {scopes.phase === 'ready' && scopes.items.length === 0 && <p className="ab-note ab-note-warn">No published articles are available to you.</p>}
        <Notes access={scopes.access} />
        {scopes.items.length > 0 && (
          <>
            <div className="ab-field">
              <label className="ab-label" htmlFor="ab-kb-base">Knowledge base</label>
              <select id="ab-kb-base" className="ab-select" value={kb} onChange={(e) => chooseKb(e.target.value)}>
                <option value="">Choose one…</option>
                {scopes.items.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.count})</option>
                ))}
              </select>
            </div>
            {categories.length > 0 && (
              <div className="ab-field">
                <label className="ab-label" htmlFor="ab-kb-category">Category (optional)</label>
                <select id="ab-kb-category" className="ab-select" value={category} onChange={(e) => { setCategory(e.target.value); setFound(null); setPicked(null); }}>
                  <option value="">All categories</option>
                  {categories.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.count})</option>
                  ))}
                </select>
              </div>
            )}
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-primary" disabled={!kb || found?.phase === 'loading'} onClick={find}>Find duplicates</button>
            </div>
          </>
        )}
      </section>

      {found?.phase === 'loading' && <p className="ab-note" role="status">Comparing titles…</p>}
      {found?.phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{found.error}</p>}

      {data && (
        <section className="ab-card" aria-label="Duplicate groups">
          <p className="ab-sub">
            Compared {data.scanned} title{data.scanned === 1 ? '' : 's'}.{' '}
            {data.clusters.length ? `${data.clusters.length} group${data.clusters.length === 1 ? '' : 's'} read alike.` : 'No near-duplicates found.'}
          </p>
          <Notes access={data.access} />
          {data.access.some((a) => a.status === 'ok' && a.note) && <p className="ab-hint">{data.access.find((a) => a.status === 'ok' && a.note).note}</p>}
          {data.clusters.map((c) => (
            <div key={c.id} className={`ab-kb-cluster${picked?.cluster.id === c.id ? ' ab-kb-picked' : ''}`}>
              <div className="ab-row">
                <strong>{c.articles.length} articles{c.exactTitle ? ' with the same title' : ' that read alike'}</strong>
                <span className="ab-spacer" />
                <button type="button" className="ab-btn ab-btn-sm" onClick={() => pick(c)}>Compare</button>
              </div>
              {c.sharedWords.length > 0 && <div className="ab-tags">{c.sharedWords.map((w) => <span key={w} className="ab-tag">{w}</span>)}</div>}
              <ul className="ab-kb-articles">
                {c.articles.map((a) => (
                  <li key={a.sysId}>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-kb-open" onClick={() => openRecord(page, { table: 'kb_knowledge', sysId: a.sysId })} title="Open this article">
                      <span className="ab-record-number">{a.number}</span> {a.title}
                    </button>
                    <span className="ab-hint">{a.views} view{a.views === 1 ? '' : 's'}{a.updated ? ` · changed ${a.updated.slice(0, 10)}` : ''}</span>
                  </li>
                ))}
              </ul>
              <p className="ab-hint">Most read: {c.keep.number}</p>
            </div>
          ))}
        </section>
      )}

      {picked && (
        <section className="ab-card" aria-label="Compare and merge">
          <h2 className="ab-h">Compare and draft a merge</h2>
          <p className="ab-sub">Choose two to {MERGE_MAX_ARTICLES} articles to merge.</p>
          <ul className="ab-kb-articles">
            {picked.cluster.articles.map((a) => (
              <li key={a.sysId}>
                <label className="ab-check">
                  <input type="checkbox" checked={picked.selected.has(a.sysId)} onChange={() => toggle(a.sysId)} disabled={!picked.selected.has(a.sysId) && sel >= MERGE_MAX_ARTICLES} />
                  <span><span className="ab-record-number">{a.number}</span> {a.title}</span>
                </label>
              </li>
            ))}
          </ul>
          {picked.error && <p className="ab-note ab-note-danger" role="alert">{picked.error}</p>}
          <div className="ab-row">
            <button type="button" className="ab-btn" disabled={sel < 2 || picked.phase === 'loading'} onClick={compare}>
              {picked.phase === 'loading' ? 'Reading…' : 'Compare their text'}
            </button>
          </div>
          {picked.phase === 'compared' && picked.texts && (
            <>
              <ul className="ab-kb-pairs">
                {picked.texts.pairs.map((p) => (
                  <li key={`${p.a}:${p.b}`}>
                    <strong>{p.a}</strong> and <strong>{p.b}</strong>: {pct(p.containment)} of the shorter text also appears in the other ({pct(p.jaccard)} of all the wording is shared).
                  </li>
                ))}
              </ul>
              <Notes access={picked.texts.access} />
              {!available && <p className="ab-note ab-note-warn">Your organisation has switched the merge draft off.</p>}
              <p className="ab-hint">The two to four articles go through the privacy filter. In the draft, hidden details show as placeholders such as [EMAIL_1]: put the real ones in yourself before you publish.</p>
              <div className="ab-row">
                <button
                  type="button"
                  className="ab-btn ab-btn-primary"
                  disabled={!aiReady || !available || run.busy}
                  onClick={() => run.run(feature, { getPack: async () => mergePack(picked.texts.articles, picked.texts.access) })}
                >
                  {feature.title}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
