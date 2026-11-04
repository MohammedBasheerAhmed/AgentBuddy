import { useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import RecordLink from '../RecordLink.jsx';
import { toCsv } from '../../lib/export.js';
import { downloadText } from '../reports/download.js';
import { EmptyNote, ShowMore } from '../ui/primitives.jsx';
import Notes from './Notes.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { TOPIC_COLUMNS, exportFileName, topicRows } from '../knowledgeScreen/articleInfo.js';
import { placeOf } from '../knowledgeScreen/shared.js';
import { shown as shownText } from '../../reports/shown.js';
import { formatNumber, isolate, t, tn } from '../../i18n/index.js';

// N19 Knowledge-gap radar (Insights, no AI): "articles to write". Recently resolved incidents (and cases) are grouped by what they
// are about, the ones that already have a knowledge article are left out when that can be read, and the groups are ranked by how
// many tickets they hold. The scope can be everything the person can see, their own groups, or one category, and the panel says how
// many of how many tickets were looked at. The topics are handed to the AI Assist half (onFound), where an outline can be drafted.
// While a search reads, its choices are locked (the answer is for what was chosen when it started) and it can be stopped.

const DAYS = [30, 60, 90];
const n = (v) => formatNumber(Number(v || 0));

/** "Looked at 500 of 12,400 tickets resolved in the last 60 days in your groups." */
export function lookedAtText(data, scopePhrase = '') {
  const scanned = Number(data?.scanned) || 0;
  const total = Number.isFinite(data?.total) ? data.total : null;
  const days = data?.days || 60;
  if (total !== null && total > scanned) {
    const params = { scanned: n(scanned), total: n(total), days, scope: scopePhrase };
    return scopePhrase ? t('Looked at {scanned} of {total} tickets resolved in the last {days} days {scope}.', params) : t('Looked at {scanned} of {total} tickets resolved in the last {days} days.', params);
  }
  const params = { n: n(scanned), days, scope: scopePhrase };
  return scopePhrase
    ? tn(scanned, 'Looked at {n} ticket resolved in the last {days} days {scope}.', 'Looked at {n} tickets resolved in the last {days} days {scope}.', params)
    : tn(scanned, 'Looked at {n} ticket resolved in the last {days} days.', 'Looked at {n} tickets resolved in the last {days} days.', params);
}

/** The scope as words, for the summary line ("in your 3 groups", "in category Network"). */
export function scopeWords(scope, categories = []) {
  if (scope?.kind === 'mine') return scope.groups ? (scope.groups === 1 ? t('in your group') : t('in your {count} groups', { count: scope.groups })) : t('in your groups');
  if (scope?.kind === 'category') return t('in category {name}', { name: isolate(categories.find((c) => c.value === scope.category)?.name || scope.category) });
  return '';
}

/**
 * The radar for the tab and instance `page` is on. Another tab or instance starts it over (placeOf): the categories, topics and
 * example tickets on screen are the old instance's, and a read still on its way for it is dropped as the old radar goes away.
 */
export default function GapsPanel(props) {
  return <GapsRadar key={placeOf(props.page)} {...props} />;
}

function GapsRadar({ page, active = true, onFound = () => {} }) {
  const [days, setDays] = useState(60);
  const [incidents, setIncidents] = useState(true);
  const [cases, setCases] = useState(false);
  const [scope, setScope] = useState('all'); // 'all' | 'mine' | 'cat:<value>'
  const [scopes, setScopes] = useState({ phase: 'idle', categories: [], total: null, key: '' });
  const [state, setState] = useState(null); // { phase, data, error }
  const [note, setNote] = useState('');
  const token = useRef(0);
  const scopeToken = useRef(0);
  const loading = state?.phase === 'loading';
  const tables = [incidents && 'incident', cases && 'sn_customerservice_case'].filter(Boolean);
  const scopeKey = `${days}|${tables.join(',')}`;

  // What the scope picker offers (categories with counts, and the total): read when the radar is on show, again when the window or
  // the tables change. Counts and names only. "My groups" is always offered; the groups are read when it is used.
  useEffect(() => {
    if (!active || !tables.length || scopes.key === scopeKey) return undefined;
    scopeToken.current += 1;
    const mine = scopeToken.current;
    setScopes((s) => ({ ...s, phase: 'loading', key: scopeKey }));
    read(page.tabId, 'kbGapScopes', { days, tables })
      .then((out) => mine === scopeToken.current && setScopes({ phase: 'ready', categories: Array.isArray(out?.categories) ? out.categories : [], total: Number.isFinite(out?.total) ? out.total : null, key: scopeKey }))
      .catch(() => mine === scopeToken.current && setScopes({ phase: 'error', categories: [], total: null, key: scopeKey }));
    return undefined;
    // The window and the tables decide when to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, scopeKey]);
  useEffect(
    () => () => {
      token.current += 1;
      scopeToken.current += 1;
    },
    []
  );

  // A category the new list no longer offers (no tickets in this window) falls back to everything.
  useEffect(() => {
    if (scopes.phase !== 'ready') return;
    if (scope.startsWith('cat:') && !scopes.categories.some((c) => `cat:${c.value}` === scope)) setScope('all');
  }, [scopes, scope]);

  const scopeArgs = () => (scope === 'mine' ? { scope: 'mine' } : scope.startsWith('cat:') ? { scope: 'category', category: scope.slice(4) } : { scope: 'all' });

  async function find() {
    token.current += 1;
    const mine = token.current;
    setNote('');
    onFound(null);
    setState({ phase: 'loading', data: null, error: '' });
    try {
      const data = await read(page.tabId, 'kbGaps', { days, tables, ...scopeArgs() });
      // (the answer comes from the page: a list that is missing is an empty one, never a crash)
      const clean = { ...data, scanned: Number(data?.scanned) || 0, clusters: Array.isArray(data?.clusters) ? data.clusters : [], access: Array.isArray(data?.access) ? data.access : [], link: data?.link || {} };
      if (mine !== token.current) return;
      setState({ phase: 'ready', data: clean, error: '' });
      const words = scopeWords(clean.scope, scopes.categories);
      onFound(clean.clusters.length ? { clusters: clean.clusters, days: clean.days || days, scopeText: words, at: Date.now() } : null);
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: err?.message || t('The tickets could not be read.') });
    }
  }

  function stop() {
    token.current += 1;
    setState(null);
  }

  function exportTopics() {
    try {
      downloadText(exportFileName('knowledge-gaps'), toCsv(topicRows(state.data.clusters), TOPIC_COLUMNS));
      setNote(tn(state.data.clusters.length, 'Saved {n} topic as a CSV file in your downloads.', 'Saved {n} topics as a CSV file in your downloads.'));
    } catch {
      setNote(t('The browser did not save the file.'));
    }
  }

  const data = state?.data;

  return (
    <div className="ab-kbx-tool">
      <p className="ab-hint">{t('Topics that keep coming up in resolved tickets without an article. Looks at titles, categories and items only; at most the newest 500.')}</p>
      <div className="ab-kbx-controls">
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-gap-days">{t('Resolved in the last')}</label>
          <select id="ab-gap-days" className="ab-select" value={days} disabled={loading} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{tn(d, '{n} day', '{n} days')}</option>)}
          </select>
        </div>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-gap-scope">{t('Whose tickets')}</label>
          <select id="ab-gap-scope" className="ab-select" value={scope} disabled={loading} onChange={(e) => setScope(e.target.value)}>
            <option value="all">{Number.isFinite(scopes.total) ? t('Everything I can see ({count})', { count: n(scopes.total) }) : t('Everything I can see')}</option>
            <option value="mine">{t('My groups')}</option>
            {scopes.categories.map((c) => (
              <option key={c.value} value={`cat:${c.value}`}>{t('Category: {name} ({count})', { name: isolate(c.name), count: n(c.count) })}</option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="ab-field ab-fieldset">
        <legend className="ab-label">{t('Tickets to look at')}</legend>
        <label className="ab-check"><input type="checkbox" checked={incidents} disabled={loading} onChange={(e) => setIncidents(e.target.checked)} /> {t('Incidents')}</label>
        <label className="ab-check"><input type="checkbox" checked={cases} disabled={loading} onChange={(e) => setCases(e.target.checked)} /> {t('Customer service cases')}</label>
      </fieldset>
      <div className="ab-row">
        <button type="button" className="ab-btn" disabled={!tables.length || loading} onClick={find}>{t('Find topics')}</button>
      </div>

      {loading && (
        <p className="ab-sub" role="status">
          {t('Reading resolved tickets…')}{' '}
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={stop}>{t('Stop')}</button>
        </p>
      )}
      {state?.phase === 'error' && <ErrorNote error={state.error} onRetry={find} />}

      {data && (
        <section className="ab-kbx-results" aria-label={t('Topics without an article')}>
          <p className="ab-sub">
            {lookedAtText(data, scopeWords(data.scope, scopes.categories))}
            {data.link.known ? ` ${tn(data.withArticle, '{n} already had an article.', '{n} already had an article.', { n: n(data.withArticle) })}` : ''}
          </p>
          {data.note && <p className="ab-note ab-note-warn" role="status">{shownText(data.note)}</p>}
          <Notes access={data.access} />
          {data.clusters.length === 0 && data.scanned > 0 && <EmptyNote>{t('No topic came up more than once. Try a longer window or a wider scope.')}</EmptyNote>}
          {data.scanned === 0 && <EmptyNote>{t('No resolved tickets were found in that window and scope.')}</EmptyNote>}
          <ShowMore
            items={data.clusters}
            className="ab-list"
            render={(c) => (
              <div key={c.id} className="ab-kb-cluster">
                <div className="ab-row">
                  <strong>{shownText(c.label)}</strong>
                  <span className="ab-spacer" />
                  <span className="ab-tag">{tn(c.count, '{n} ticket', '{n} tickets')}</span>
                </div>
                <div className="ab-tags">
                  {c.withFix > 0 && <span className="ab-tag">{t('{withFix} with a written fix', { withFix: c.withFix })}</span>}
                  {c.category && <span className="ab-tag">{c.category}</span>}
                  {c.ci && <span className="ab-tag">{c.ci}</span>}
                </div>
                <ul className="ab-kb-articles">
                  {c.examples.map((e) => (
                    <li key={e.sysId}>
                      <RecordLink page={page} item={{ table: e.table, sysId: e.sysId }} className="ab-btn ab-btn-quiet ab-btn-sm ab-kb-open">
                        <span className="ab-record-number">{e.number}</span> {e.title}
                      </RecordLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          />
          {data.clusters.length > 0 && (
            <>
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={exportTopics}>{t('Export topics (CSV)')}</button>
              </div>
              <p className="ab-hint">{t('To draft an outline for one of these, switch to AI Assist.')}</p>
            </>
          )}
          {note && <p className="ab-hint" role="status">{note}</p>}
        </section>
      )}
    </div>
  );
}
