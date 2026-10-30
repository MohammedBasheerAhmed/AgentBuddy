import { useEffect, useRef, useState } from 'react';
import { featuresFor } from '../features/registry.js';
import { read } from './ask.js';
import { useRun } from './useRun.js';
import RunPanel from './RunPanel.jsx';
import RelatedView from './RelatedView.jsx';
import QuickBar from './QuickBar.jsx';
import Tabs, { TabPanel } from './Tabs.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import AiKeyNote from './AiKeyNote.jsx';
import { RECORD_TABS } from './recordTabs.js';
import { aiNeedsText, isAiReady } from './aiReady.js';
import { describeHeader, headerPhase } from './recordHeader.js';
import { launchIsForPage } from '../lib/launch.js';
import { panelShowsBar } from '../features/quick.js';

const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const needsStricter = (feature, mode) => Boolean(feature.requires?.minMode) && (MODE_RANK[mode] ?? 0) < (MODE_RANK[feature.requires.minMode] ?? 0);

// "Related and Check", "Related, Request, Check and Checklist": the tabs of this record that need no AI key.
const listWords = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The tab to show on a record of this kind: the one the person was in when this kind has it (checking ticket after ticket), else Actions. */
export function keepTab(current, kind) {
  if (current === 'actions' || current === 'related') return current;
  return RECORD_TABS.some((t) => t.id === current && t.kinds.includes(kind)) ? current : 'actions';
}

// launch / onLaunchDone: an action the bar on the ServiceNow page asked for (src/lib/launch.js); it is used once.
//
// The record's tabs keep what was found or chosen in them while another tab is on show: a tab that has been opened stays mounted
// (hidden), for this record. The tabs whose answer can change while the person works (the Check tab reads the form) read again when
// they are shown again; the earlier answer stays on screen meanwhile. Each tab has its own error boundary: one that breaks says so and
// leaves the record, its quick actions and the other tabs working.
export default function RecordView({ page, eff, launch = null, onLaunchDone = () => {} }) {
  const { record } = page;
  const [head, setHead] = useState({ phase: 'loading', header: null }); // phase: loading | ready | failed
  const [tab, setTab] = useState('actions'); // 'actions' | 'related' | a record tab id (src/sidepanel/recordTabs.js)
  const [opened, setOpened] = useState({ key: '', ids: [] }); // the tabs opened on this record (they stay mounted)
  const run = useRun({ page, eff, record });
  const [launchNote, setLaunchNote] = useState('');
  const root = useRef(null);
  // Where the focus goes back to when the answer is closed (or the preview cancelled, or "Stop waiting" pressed): the action that
  // started it. The button itself is gone while the answer is on screen, so it is found again by its feature id.
  const giveBack = useRef(null);
  const lastPhase = useRef(run.phase);

  const key = `${record.table}:${record.sysId}`;
  const kind = record.kind || 'other';
  const aiReady = isAiReady(eff);
  const header = head.header;

  // A different record means a different conversation: drop anything from the previous one.
  useEffect(() => {
    run.reset();
    giveBack.current = null;
    setHead({ phase: 'loading', header: null });
    setTab((current) => keepTab(current, kind));
    setLaunchNote('');
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

  const features = featuresFor(kind, eff.policy);
  const idle = run.phase === 'idle' || run.phase === 'error';

  const start = (feature, from) => {
    giveBack.current = { selector: from === 'quick' ? `[data-quick="${feature.id}"]` : `[data-feature="${feature.id}"]` };
    run.run(feature);
  };
  // What a record tab gets as `run`: the same run, remembering the control that started it so the focus can go back to it.
  const tabRun = {
    ...run,
    run: (feature, options) => {
      const el = typeof document !== 'undefined' ? document.activeElement : null;
      giveBack.current = { element: root.current && el && root.current.contains(el) ? el : null };
      return run.run(feature, options);
    },
  };

  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = run.phase;
    if (run.phase !== 'idle' || before === 'idle') return;
    const back = giveBack.current;
    giveBack.current = null;
    const box = root.current;
    if (!back || !box) return;
    const target = (back.selector && box.querySelector(back.selector)) || (back.element?.isConnected ? back.element : null);
    target?.focus();
    if (!target || document.activeElement !== target) box.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }, [run.phase]);

  // The bar on the page asked for an action on THIS record: start it exactly as a click in the list would (same permission, masking,
  // preview and policy steps). If the record on screen is not the one it named, it waits until it is, or until it expires.
  useEffect(() => {
    if (!launchIsForPage(launch, page)) return;
    onLaunchDone();
    const feature = features.find((f) => f.id === launch.featureId);
    if (!feature) setLaunchNote('That action is not available for this record.');
    else if (!aiReady) setLaunchNote(aiNeedsText(eff, 'this action'));
    else if (!idle) setLaunchNote('Close the answer on screen first, then choose the action again.');
    else {
      setLaunchNote('');
      start(feature, 'list');
    }
    // Only a new request, or the page it names arriving, matters here; the rest is read as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, page.tabId, key]);

  const extraTabs = RECORD_TABS.filter((t) => t.kinds.includes(kind));
  const tabs = [{ id: 'actions', label: 'Actions' }, { id: 'related', label: 'Related' }, ...extraTabs.map((t) => ({ id: t.id, label: t.label }))];
  const shown = tabs.some((t) => t.id === tab) ? tab : 'actions';
  const mounted = new Set([...(opened.key === key ? opened.ids : []), shown]);
  const chooseTab = (id) => {
    setTab(id);
    setOpened((o) => ({ key, ids: [...new Set([...(o.key === key ? o.ids : []), shown, id])] }));
  };
  const card = describeHeader(head, record);
  const noAiTabs = listWords(['Related', ...extraTabs.map((t) => t.label)]);

  return (
    <div className="ab-pane" ref={root}>
      <section className="ab-card ab-record" aria-label="Open record">
        <span className="ab-record-number">{card.number}</span>
        <span className={`ab-record-title${card.titleKind === 'text' ? '' : ' ab-muted'}`}>{card.title}</span>
        <div className="ab-tags">
          {card.tags.map((t) => (
            <span key={t} className="ab-tag">{t}</span>
          ))}
        </div>
      </section>

      {panelShowsBar(features.length) && <QuickBar kind={kind} features={features} eff={eff} disabled={!aiReady || !idle} onRun={(f) => start(f, 'quick')} />}

      {run.phase === 'done' && <p className="ab-hint">One answer at a time: close the answer below to choose another action.</p>}
      {launchNote && <p className="ab-note ab-note-warn" role="status">{launchNote}</p>}

      <AiKeyNote eff={eff} what="these actions" also={`${noAiTabs} work without a key.`} />

      <Tabs idBase="ab-rec" label="Record tools" tabs={tabs} value={shown} onChange={chooseTab} />

      <TabPanel idBase="ab-rec" id="actions" hidden={shown !== 'actions'} className="ab-pane">
        {idle && (
          <section className="ab-features" aria-label="Actions">
            {features.map((f) => (
              <button key={f.id} type="button" className="ab-feature" data-feature={f.id} disabled={!aiReady} onClick={() => start(f, 'list')}>
                <span className="ab-feature-title">{f.title}</span>
                <span className="ab-feature-desc">{f.description}</span>
                {needsStricter(f, eff.values.piiMode) && <span className="ab-feature-desc">Needs Strict privacy mode. Change it in Settings.</span>}
              </button>
            ))}
          </section>
        )}
      </TabPanel>

      <TabPanel idBase="ab-rec" id="related" hidden={shown !== 'related'} className="ab-pane">
        {mounted.has('related') && (
          <ErrorBoundary resetKey={key}>
            <RelatedView key={key} page={page} eff={eff} />
          </ErrorBoundary>
        )}
      </TabPanel>

      {extraTabs.map(({ id, View }) => (
        <TabPanel key={id} idBase="ab-rec" id={id} hidden={shown !== id} className="ab-pane">
          {mounted.has(id) && (
            <ErrorBoundary resetKey={key}>
              <View key={key} page={page} eff={eff} record={record} header={header} run={tabRun} aiReady={aiReady} active={shown === id} />
            </ErrorBoundary>
          )}
        </TabPanel>
      ))}

      <ErrorBoundary resetKey={`${key}:${run.active?.id || ''}`}>
        <RunPanel run={run} eff={eff} page={page} />
      </ErrorBoundary>
    </div>
  );
}
