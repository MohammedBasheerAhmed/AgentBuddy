import { useRef, useState } from 'react';
import { read } from '../ask.js';
import { openRecord } from '../openRecord.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { gapPack } from '../../knowledge/parts.js';
import Notes from './Notes.jsx';

// C7: "articles to write". Recently resolved incidents (and cases) are grouped by what they are about, the ones that already
// have a knowledge article are left out when that can be read, and the groups are ranked by how many tickets they hold. An
// outline for one group can be drafted with AI; only the topic words, counts, category and CI are sent, never the tickets.

const DAYS = [30, 60, 90];

export default function GapsPanel({ page, eff, run, aiReady }) {
  const [days, setDays] = useState(60);
  const [incidents, setIncidents] = useState(true);
  const [cases, setCases] = useState(false);
  const [state, setState] = useState(null); // { phase, data, error }
  const token = useRef(0);
  const feature = featureById('kb-gap-outline');
  const available = isFeatureAvailable(feature, eff.policy);

  async function find() {
    token.current += 1;
    const mine = token.current;
    run.reset();
    setState({ phase: 'loading', data: null, error: '' });
    const tables = [incidents && 'incident', cases && 'sn_customerservice_case'].filter(Boolean);
    try {
      const data = await read(page.tabId, 'kbGaps', { days, tables });
      if (mine === token.current) setState({ phase: 'ready', data, error: '' });
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: err?.message || 'The tickets could not be read.' });
    }
  }

  const data = state?.data;

  return (
    <>
      <section className="ab-card">
        <h2 className="ab-h">Articles to write</h2>
        <p className="ab-sub">Finds topics that keep coming up in recently resolved tickets. Only short descriptions, categories and configuration items are looked at, and nothing is sent to an AI.</p>
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-gap-days">Resolved in the last</label>
          <select id="ab-gap-days" className="ab-select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
        <div className="ab-field">
          <label className="ab-check"><input type="checkbox" checked={incidents} onChange={(e) => setIncidents(e.target.checked)} /> Incidents</label>
          <label className="ab-check"><input type="checkbox" checked={cases} onChange={(e) => setCases(e.target.checked)} /> Customer service cases</label>
        </div>
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-primary" disabled={(!incidents && !cases) || state?.phase === 'loading'} onClick={find}>Find topics</button>
        </div>
      </section>

      {state?.phase === 'loading' && <p className="ab-note" role="status">Reading resolved tickets…</p>}
      {state?.phase === 'error' && <p className="ab-note ab-note-danger" role="alert">{state.error}</p>}

      {data && (
        <section className="ab-card" aria-label="Topics without an article">
          <p className="ab-sub">
            Looked at {data.scanned} resolved ticket{data.scanned === 1 ? '' : 's'} from the last {data.days} days
            {data.link.known ? `; ${data.withArticle} already had an article.` : '.'}
            {data.truncated ? ' Only the newest were read.' : ''}
          </p>
          {data.note && <p className="ab-note ab-note-warn" role="status">{data.note}</p>}
          <Notes access={data.access} />
          {data.clusters.length === 0 && data.scanned > 0 && <p className="ab-hint">No topic came up more than once.</p>}
          {data.scanned === 0 && <p className="ab-hint">No resolved tickets were found in that window.</p>}
          {data.clusters.map((c) => (
            <div key={c.id} className="ab-kb-cluster">
              <div className="ab-row">
                <strong>{c.label}</strong>
                <span className="ab-spacer" />
                <span className="ab-tag">{c.count} ticket{c.count === 1 ? '' : 's'}</span>
              </div>
              <div className="ab-tags">
                {c.withFix > 0 && <span className="ab-tag">{c.withFix} with a written fix</span>}
                {c.category && <span className="ab-tag">{c.category}</span>}
                {c.ci && <span className="ab-tag">{c.ci}</span>}
              </div>
              <ul className="ab-kb-articles">
                {c.examples.map((e) => (
                  <li key={e.sysId}>
                    <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-kb-open" onClick={() => openRecord(page, { table: e.table, sysId: e.sysId })} title="Open this ticket">
                      <span className="ab-record-number">{e.number}</span> {e.title}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="ab-row">
                <button type="button" className="ab-btn ab-btn-sm" disabled={!aiReady || !available || run.busy} onClick={() => run.run(feature, { getPack: async () => gapPack(c, { days: data.days }) })}>
                  {feature.title}
                </button>
              </div>
            </div>
          ))}
          {data.clusters.length > 0 && <p className="ab-hint">An outline is based on the topic words, the numbers, the category and the configuration item only: no ticket text is sent. Any hidden detail shows as a placeholder such as [PERSON_1].</p>}
        </section>
      )}
    </>
  );
}
