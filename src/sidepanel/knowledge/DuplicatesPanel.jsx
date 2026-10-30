import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import RecordLink from '../RecordLink.jsx';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { MERGE_MAX_ARTICLES, mergePack } from '../../knowledge/parts.js';
import Notes from './Notes.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { plainNote } from '../plainAccess.js';
import { compareLocked, compareStillCurrent, selectionKey } from './duplicatesState.js';

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
  const compareToken = useRef(0); // a newer Compare (or a changed selection) makes an older answer count for nothing
  const mergeHeading = useRef(null);
  const feature = featureById('kb-merge-draft');
  const available = isFeatureAvailable(feature, eff.policy);

  const scopeToken = useRef(0);
  const loadScopes = useCallback(() => {
    scopeToken.current += 1;
    const mine = scopeToken.current;
    setScopes({ phase: 'loading', items: [], access: [], error: '' });
    read(page.tabId, 'kbScopes', {})
      .then((out) => mine === scopeToken.current && setScopes({ phase: 'ready', items: out.items || [], access: out.access || [], error: '' }))
      .catch((err) => mine === scopeToken.current && setScopes({ phase: 'error', items: [], access: [], error: err?.message || 'The knowledge bases could not be listed.' }));
  }, [page.tabId]);

  useEffect(() => {
    loadScopes();
    return () => {
      scopeToken.current += 1;
    };
  }, [loadScopes]);

  // Opening the compare card moves focus to it, so a keyboard or screen reader user lands where the new controls are.
  const pickedId = picked?.cluster.id;
  useEffect(() => {
    if (pickedId) mergeHeading.current?.focus();
  }, [pickedId]);

  const chooseKb = useCallback(
    (id) => {
      token.current += 1;
      compareToken.current += 1;
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

  // Another category: what was found (or is being found) was for the old scope, so it is dropped, also when it is still on its way.
  function chooseCategory(id) {
    token.current += 1;
    compareToken.current += 1;
    setCategory(id);
    setFound(null);
    setPicked(null);
  }

  // "Stop" while titles are compared: the answer, when it comes, is dropped.
  function stop() {
    token.current += 1;
    setFound(null);
  }

  async function find() {
    token.current += 1;
    compareToken.current += 1;
    const mine = token.current;
    run.reset();
    setPicked(null);
    setFound({ phase: 'loading', data: null, error: '' });
    try {
      const data = await read(page.tabId, 'kbDuplicates', { knowledgeBase: kb, category });
      // (the answer comes from the page: a list that is missing is an empty one, never a crash)
      if (mine === token.current) setFound({ phase: 'ready', data: { ...data, scanned: Number(data?.scanned) || 0, clusters: Array.isArray(data?.clusters) ? data.clusters : [], access: Array.isArray(data?.access) ? data.access : [] }, error: '' });
    } catch (err) {
      if (mine === token.current) setFound({ phase: 'error', data: null, error: err?.message || 'The articles could not be compared.' });
    }
  }

  function pick(cluster) {
    if (compareLocked(picked)) return;
    compareToken.current += 1;
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
    compareToken.current += 1;
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
      setPicked((p) => (stillMine(p) ? { ...p, phase: 'compared', texts } : p));
    } catch (err) {
      setPicked((p) => (stillMine(p) ? { ...p, phase: 'choosing', error: err?.message || 'The articles could not be read.' } : p));
    }
  }

  const data = found?.data;
  const sel = picked?.selected.size || 0;
  const locked = compareLocked(picked); // a read is on its way: nothing it depends on may change

  return (
    <>
      <section className="ab-card">
        <h2 className="ab-h">Find near-duplicate articles</h2>
        <p className="ab-sub">Compares the titles of published articles in one knowledge base. Nothing is sent to an AI until you ask for a merged draft.</p>
        {scopes.phase === 'loading' && <p className="ab-note" role="status">Looking for knowledge bases…</p>}
        {scopes.phase === 'error' && <ErrorNote error={scopes.error} onRetry={loadScopes} />}
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
                <select id="ab-kb-category" className="ab-select" value={category} onChange={(e) => chooseCategory(e.target.value)}>
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

      {found?.phase === 'loading' && (
        <p className="ab-note" role="status">
          Comparing titles…{' '}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={stop}>Stop</button>
        </p>
      )}
      {found?.phase === 'error' && <ErrorNote error={found.error} onRetry={find} />}

      {data && (
        <section className="ab-card" aria-label="Duplicate groups">
          <p className="ab-sub">
            Compared {data.scanned} title{data.scanned === 1 ? '' : 's'}.{' '}
            {data.clusters.length ? `${data.clusters.length} group${data.clusters.length === 1 ? '' : 's'} read alike.` : 'No near-duplicates found.'}
          </p>
          <Notes access={data.access} />
          {data.clusters.length > 0 && <p className="ab-hint">Each article opens in this tab.</p>}
          {data.access.some((a) => a.status === 'ok' && a.note) && <p className="ab-hint">{plainNote(data.access.find((a) => a.status === 'ok' && a.note).note)}</p>}
          {data.clusters.map((c) => (
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
          ))}
        </section>
      )}

      {picked && (
        <section className="ab-card" aria-label="Compare and merge">
          <h2 className="ab-h" ref={mergeHeading} tabIndex={-1}>Compare and draft a merge</h2>
          <p className="ab-sub">Choose two to {MERGE_MAX_ARTICLES} articles to merge.</p>
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
                  onClick={() => run.run(feature, { getPack: async () => mergePack(picked.texts.articles, picked.texts.access, picked.texts.people) })}
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
