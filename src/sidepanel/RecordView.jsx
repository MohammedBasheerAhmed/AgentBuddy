import { useEffect, useState } from 'react';
import { featuresFor } from '../features/registry.js';
import { read } from './ask.js';
import { useRun } from './useRun.js';
import RunPanel from './RunPanel.jsx';
import RelatedView from './RelatedView.jsx';
import Tabs, { TabPanel } from './Tabs.jsx';
import { RECORD_TABS } from './recordTabs.js';
import { aiNeedsText, isAiReady } from './aiReady.js';
import { describeHeader, headerPhase } from './recordHeader.js';

const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const needsStricter = (feature, mode) => Boolean(feature.requires?.minMode) && (MODE_RANK[mode] ?? 0) < (MODE_RANK[feature.requires.minMode] ?? 0);

export default function RecordView({ page, eff }) {
  const { record } = page;
  const [head, setHead] = useState({ phase: 'loading', header: null }); // phase: loading | ready | failed
  const [tab, setTab] = useState('actions'); // 'actions' | 'related' | a record tab id (src/sidepanel/recordTabs.js)
  const run = useRun({ page, eff, record });

  const key = `${record.table}:${record.sysId}`;
  const aiReady = isAiReady(eff);
  const header = head.header;

  // A different record means a different conversation: drop anything from the previous one.
  useEffect(() => {
    run.reset();
    setHead({ phase: 'loading', header: null });
    setTab('actions');
    let cancelled = false;
    read(page.tabId, 'header', { table: record.table, sysId: record.sysId })
      .then((h) => !cancelled && setHead({ phase: headerPhase(h), header: h }))
      .catch(() => !cancelled && setHead({ phase: 'failed', header: null }));
    return () => {
      cancelled = true;
    };
    // run.reset is stable (useCallback); the key is the record's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page.tabId, record.table, record.sysId]);

  const features = featuresFor(record.kind || 'other', eff.policy);
  const extraTabs = RECORD_TABS.filter((t) => t.kinds.includes(record.kind || 'other'));
  const tabs = [{ id: 'actions', label: 'Actions' }, { id: 'related', label: 'Related' }, ...extraTabs.map((t) => ({ id: t.id, label: t.label }))];
  const shown = tabs.some((t) => t.id === tab) ? tab : 'actions';
  const Extra = extraTabs.find((t) => t.id === shown)?.View;
  const idle = run.phase === 'idle' || run.phase === 'error';
  const card = describeHeader(head, record);

  return (
    <div className="ab-pane">
      <section className="ab-card ab-record">
        <span className="ab-record-number">{card.number}</span>
        <span className={`ab-record-title${card.titleKind === 'text' ? '' : ' ab-muted'}`}>{card.title}</span>
        <div className="ab-tags">
          {card.tags.map((t) => (
            <span key={t} className="ab-tag">{t}</span>
          ))}
        </div>
      </section>

      {!aiReady && <p className="ab-note ab-note-warn">{aiNeedsText(eff, 'these actions')}</p>}

      <Tabs idBase="ab-rec" label="Record tools" tabs={tabs} value={shown} onChange={setTab} shared />

      <TabPanel idBase="ab-rec" shared value={shown} className="ab-pane">
        {shown === 'related' && <RelatedView key={key} page={page} eff={eff} />}

        {Extra && <Extra key={`${shown}:${key}`} page={page} eff={eff} record={record} header={header} run={run} aiReady={aiReady} />}

        {shown === 'actions' && idle && (
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
      </TabPanel>

      <RunPanel run={run} eff={eff} page={page} />
    </div>
  );
}
