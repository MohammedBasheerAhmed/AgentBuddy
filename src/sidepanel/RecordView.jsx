import { useEffect, useState } from 'react';
import { featuresFor } from '../features/registry.js';
import { read } from './ask.js';
import { useRun } from './useRun.js';
import RunPanel from './RunPanel.jsx';
import RelatedView from './RelatedView.jsx';
import { RECORD_TABS } from './recordTabs.js';

const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const needsStricter = (feature, mode) => Boolean(feature.requires?.minMode) && (MODE_RANK[mode] ?? 0) < (MODE_RANK[feature.requires.minMode] ?? 0);

export default function RecordView({ page, eff }) {
  const { record } = page;
  const [header, setHeader] = useState(null);
  const [tab, setTab] = useState('actions'); // 'actions' | 'related' | a record tab id (src/sidepanel/recordTabs.js)
  const run = useRun({ page, eff, record });

  const key = `${record.table}:${record.sysId}`;
  const aiReady = Boolean(eff.apiKey) || Boolean(eff.values.providedApiKey) || ['ollama'].includes(eff.values.provider);

  // A different record means a different conversation: drop anything from the previous one.
  useEffect(() => {
    run.reset();
    setHeader(null);
    setTab('actions');
    let cancelled = false;
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId })
      .then((h) => !cancelled && setHeader(h))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // run.reset is stable (useCallback); the key is the record's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page.tabId, record.table, record.sysId]);

  const features = featuresFor(record.kind || 'other', eff.policy);
  const extraTabs = RECORD_TABS.filter((t) => t.kinds.includes(record.kind || 'other'));
  const tabs = [['actions', 'Actions'], ['related', 'Related'], ...extraTabs.map((t) => [t.id, t.label])];
  const Extra = extraTabs.find((t) => t.id === tab)?.View;
  const idle = run.phase === 'idle' || run.phase === 'error';

  return (
    <>
      <section className="ab-card ab-record">
        <span className="ab-record-number">{record.number || header?.number || record.table}</span>
        <span className="ab-record-title">{header?.short_description || 'Loading…'}</span>
        <div className="ab-tags">
          <span className="ab-tag">{record.table}</span>
          {header?.state && <span className="ab-tag">{header.state}</span>}
          {header?.priority && <span className="ab-tag">{header.priority}</span>}
        </div>
      </section>

      {!aiReady && (
        <p className="ab-note ab-note-warn">
          {eff.keyLocked ? 'Your AI key is locked. Unlock it in Settings.' : 'Add an AI key in Settings to use these actions.'}
        </p>
      )}

      <div className="ab-row" role="tablist" aria-label="Panel sections">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ab-btn ab-btn-sm${tab === id ? ' ab-btn-primary' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'related' && <RelatedView key={key} page={page} eff={eff} />}

      {Extra && <Extra key={`${tab}:${key}`} page={page} eff={eff} record={record} header={header} run={run} aiReady={aiReady} />}

      {tab === 'actions' && idle && (
        <section className="ab-features" aria-label="Actions">
          {features.map((f) => (
            <button key={f.id} type="button" className="ab-feature" disabled={!aiReady} onClick={() => run.run(f)}>
              <span className="ab-feature-title">{f.title}</span>
              <span className="ab-feature-desc">{f.description}</span>
              {needsStricter(f, eff.values.piiMode) && <span className="ab-feature-desc">Needs Strict privacy mode. Change it in Settings.</span>}
            </button>
          ))}
        </section>
      )}

      <RunPanel run={run} eff={eff} page={page} />
    </>
  );
}
