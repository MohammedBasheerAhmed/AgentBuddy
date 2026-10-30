import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isFeatureEnabled } from '../../policy/policy.js';
import { read } from '../ask.js';
import { useSectionVisible } from '../SectionVisible.js';
import { PRESETS, CAPS, addDashboard, addPresetDashboard, addWidget, moveWidget, removeDashboard, removeWidget, renameDashboard, setActive, setDashboardSetup, updateWidget } from '../../reports/dashboards.js';
import { createLimiter } from '../../reports/engine/cache.js';
import { createLoadedStore } from '../../reports/ai/loaded.js';
import { addableSections, sectionById } from './sections.js';
import { useDashboards, useReportContext } from './hooks.js';
import { listUrl, openList, openTicket } from './drill.js';
import { dashboardTables, pageIdentity, visibleWidgets, widgetParams } from './dashboardEnv.js';
import { resultTables } from '../../reports/engine/index.js';
import { exportFileName, maskTables, tablesToCsv } from '../../reports/exportTables.js';
import { downloadText } from './download.js';
import WidgetBoundary from './WidgetBoundary.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { recordUrl } from '../openRecord.js';
import { clock } from './format.js';
import ScopeBar from './ScopeBar.jsx';
import BuilderView from './BuilderView.jsx';
import BuilderEditor from './BuilderEditor.jsx';

const AUTO_MS = 5 * 60 * 1000;

const readAuto = () => {
  try {
    return sessionStorage.getItem('ab-reports-auto') === '1';
  } catch {
    return false;
  }
};

/** Name editing keeps its own text until Enter or leaving the field, so the field can be emptied while typing. */
function NameField({ value, onCommit, disabled }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() && text.trim() !== value && onCommit(text);
  return (
    <div className="ab-field">
      <label className="ab-label" htmlFor="ab-dash-name">Dashboard name</label>
      <input id="ab-dash-name" className="ab-input" maxLength={CAPS.name} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </div>
  );
}

function WidgetTools({ index, count, onMove, onEdit, onRemove, label }) {
  return (
    <div className="ab-widget-tools" role="group" aria-label={`Change ${label}`}>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => onMove(-1)} disabled={index === 0}>Move up</button>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => onMove(1)} disabled={index === count - 1}>Move down</button>
      {onEdit && <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onEdit}>Edit</button>}
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onRemove}>Remove</button>
    </div>
  );
}

/**
 * The Team dashboard: a scope picker, the sections as widgets, saved dashboards, refresh, export, print. Used by the side
 * panel's Team tab (layout 'panel') and by the full-page dashboard (layout 'page'): same components, more room.
 *
 * Everything shown is read through the ServiceNow tab `page.tabId` with the person's own session; nothing read is stored.
 */
export default function ReportsDashboard({ page, eff, layout = 'panel' }) {
  const policy = eff?.policy;
  const blocked = useMemo(() => policy?.blockedTables || [], [policy]);
  const disabled = Boolean(policy) && !isFeatureEnabled('reports', policy);
  const { ready, state, status, saveFailed, update } = useDashboards();
  const [refreshKey, setRefreshKey] = useState(0);
  const [mask, setMask] = useState(false);
  const maskMode = eff?.values?.piiMode || 'standard';
  const [customize, setCustomize] = useState(false);
  const [editing, setEditing] = useState(null); // { widgetId } for an existing custom report, {} for a new one
  const [auto, setAuto] = useState(readAuto);
  const [readAts, setReadAts] = useState({});
  const addable = useMemo(() => addableSections(policy), [policy]);
  const [adding, setAdding] = useState('overview');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const context = useReportContext({ tabId: page.tabId, blocked, refreshKey });

  const dash = ready ? state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0] : null;
  const canEdit = ready && status !== 'newer';
  const focus = layout === 'page';

  const tableList = context.data?.tables || [];
  const usableIds = tableList.filter((t) => t.usable).map((t) => t.table);
  const selected = dash ? (dash.tables ? dash.tables.filter((t) => usableIds.includes(t)) : usableIds) : [];

  const refresh = useCallback(async () => {
    try {
      await read(page.tabId, 'reportClear');
    } catch {
      /* the next read will say what is wrong */
    }
    setRefreshKey((k) => k + 1);
  }, [page.tabId]);

  // The Team section stays mounted (hidden) while another section shows, so the timer pauses unless this section is on screen.
  const sectionVisible = useSectionVisible();
  useEffect(() => {
    if (!auto || !sectionVisible) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [auto, sectionVisible, refresh]);

  const toggleAuto = (on) => {
    setAuto(on);
    try {
      sessionStorage.setItem('ab-reports-auto', on ? '1' : '0');
    } catch {
      /* a per-tab convenience only */
    }
  };

  // At most two widgets read at a time, top to bottom: each gets its own time limit and the first ones appear first.
  const limiter = useMemo(() => createLimiter(2), []);
  // What the widgets have loaded, in memory only, so 'Explain this dashboard' explains the numbers on screen without reading again.
  const loaded = useMemo(() => createLoadedStore(), []);
  const noteRead = useCallback((id, ms) => setReadAts((prev) => (prev[id] === ms ? prev : { ...prev, [id]: ms })), []);
  const loadedEntries = useSyncExternalStore(loaded.subscribe, loaded.snapshot, loaded.snapshot);
  const [exportNote, setExportNote] = useState('');

  // The widgets get a page that changes only when what they depend on changes (the tab, the instance, the kind of page), not on
  // every move of the ServiceNow tab; a click still uses the page as it is now.
  const pageNow = useRef(page);
  pageNow.current = page;
  const identity = pageIdentity(page);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity` is the part of `page` the widgets depend on
  const stablePage = useMemo(() => page, [identity]);

  const groupsJson = JSON.stringify(context.data?.groups || []);
  const groupsNote = context.data?.groupsNote || '';
  const scopeJson = dash ? JSON.stringify(dash.scope) : '';
  const selectedJson = JSON.stringify(selected);
  // One "now" for every widget of one load (asOfFor in the engine): they ask the same questions, so the second widget's reads come from
  // the cache, and two widgets never disagree about the same number. A new load (Refresh, another dashboard, another scope or tables)
  // takes a new instant; a widget added later uses this one while it is recent (the engine ignores one older than ten minutes).
  const loadKey = `${refreshKey}|${dash?.id || ''}|${scopeJson}|${selectedJson}`;
  const asOfRef = useRef({ key: null, at: 0 });
  if (asOfRef.current.key !== loadKey) asOfRef.current = { key: loadKey, at: Date.now() };
  const asOf = asOfRef.current.at;
  const env = useMemo(
    () => ({
      page: stablePage,
      layout,
      scope: dash?.scope,
      scopeKind: dash?.scope.kind,
      tables: JSON.parse(selectedJson),
      blocked,
      refreshKey,
      limiter,
      mask,
      maskMode, // the person's privacy mode: Strict also masks capitalised full names in titles
      setMask,
      canEdit,
      openList: (table, query) => openList(pageNow.current, table, query, { focus }),
      openTicket: (ref) => openTicket(pageNow.current, ref, { focus }),
      ticketHref: (ref) => recordUrl(stablePage, ref), // the same address as a real link, so Ctrl+click and the right-click menu work
      listHref: (table, query) => listUrl(stablePage, table, query), // a list a chart opens, as a real link too
      asOf,
      widgetParams: (widget) => widgetParams(widget, asOf),
      setWidgetParams: (widget, params) => update((s) => updateWidget(s, dash.id, widget.id, { params: { ...(widget.params || {}), ...params } })),
      noteRead,
      loaded,
      myGroups: JSON.parse(groupsJson),
      groupsNote,
    }),
    // The scope is compared by value so a re-render of the dashboard does not restart every widget's read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stablePage, layout, scopeJson, selectedJson, blocked, refreshKey, asOf, limiter, mask, maskMode, canEdit, dash?.id, focus, update, noteRead, loaded, groupsJson, groupsNote]
  );

  if (disabled) {
    return (
      <section className="ab-card">
        <h2 className="ab-h">Team and queue</h2>
        <p className="ab-sub">Your organisation has turned reports off.</p>
      </section>
    );
  }
  if (!ready || !dash) return <p className="ab-sub" role="status">Loading your dashboards…</p>;

  const { shown: widgets, hidden: hiddenSections } = visibleWidgets(dash.widgets, { policy, customize: customize && canEdit });
  const widgetIds = widgets.map((w) => w.id);
  const times = widgetIds.map((id) => readAts[id]).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : null;

  // Everything on the dashboard in one file, from the numbers already on screen (nothing is read again), masked when Mask is on.
  const allTables = dashboardTables(loadedEntries, widgetIds, resultTables);
  const downloadAll = () => {
    const tables = mask ? maskTables(allTables, { mode: maskMode }) : allTables;
    downloadText(exportFileName(dash.name), tablesToCsv(tables));
    setExportNote(mask ? 'CSV saved to your downloads, with names masked.' : 'CSV saved to your downloads.');
    setTimeout(() => setExportNote(''), 4000);
  };

  const setup = (patch) => update((s) => setDashboardSetup(s, dash.id, patch));
  const onTables = (list) => setup({ tables: list.length === usableIds.length && usableIds.every((t) => list.includes(t)) ? null : list });
  const missingPresets = PRESETS.filter((p) => !state.dashboards.some((d) => d.id === p.id));
  const editingWidget = editing?.widgetId ? dash.widgets.find((w) => w.id === editing.widgetId) : null;

  return (
    <div className={`ab-dash ab-dash-${layout}`}>
      <div className="ab-dash-toolbar">
        <label className="ab-dash-select">
          <span className="ab-chart-sr">Dashboard</span>
          <select className="ab-select" value={dash.id} onChange={(e) => update((s) => setActive(s, e.target.value))}>
            {state.dashboards.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ab-btn ab-btn-sm" onClick={refresh}>Refresh</button>
        <button type="button" className="ab-btn ab-btn-sm" aria-pressed={customize} onClick={() => setCustomize((c) => !c)}>{customize ? 'Done' : 'Customize'}</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => window.print()}>Print / Save as PDF</button>
        <button type="button" className="ab-btn ab-btn-sm" onClick={downloadAll} disabled={!allTables.length} title="Every table on this dashboard in one CSV file, made from the numbers on screen">
          Download all as CSV
        </button>
        {layout === 'panel' && (
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?tab=${page.tabId}`) })}>
            Open full page
          </button>
        )}
      </div>
      <p className="ab-statusline" role="status">
        {exportNote ? `${exportNote} ` : ''}
        {oldest ? `Numbers read at ${clock(oldest)}.` : 'Reading the numbers…'}{' '}
        <label className="ab-check ab-inline-check">
          <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
          <span>Refresh every 5 minutes while this is open</span>
        </label>
      </p>

      {status === 'newer' && <p className="ab-note ab-note-warn">Your saved dashboards were made by a newer version of Agent Buddy, so the ready-made ones are shown and nothing is saved.</p>}
      {status === 'corrupt' && <p className="ab-note ab-note-warn">Your saved dashboards could not be read, so the ready-made ones are shown.</p>}
      {saveFailed && <p className="ab-note ab-note-warn">Your changes could not be saved on this computer.</p>}

      <ScopeBar scope={dash.scope} tables={tableList} selected={selected} context={context.data} tabId={page.tabId} blocked={blocked} onScope={(scope) => setup({ scope })} onTables={onTables} canEdit={canEdit} />
      <p className="ab-hint ab-dash-help">A number, bar or row you can click opens that list in ServiceNow; Ctrl+click opens it in a new tab. Every chart has "Show as table".</p>

      {customize && canEdit && (
        <section className="ab-card ab-customize" aria-label="Customize this dashboard">
          <NameField value={dash.name} onCommit={(name) => update((s) => renameDashboard(s, dash.id, name))} />
          <div className="ab-row">
            <label className="ab-widget-select">
              <span className="ab-chart-sr">Section to add</span>
              <select className="ab-select" value={adding} onChange={(e) => setAdding(e.target.value)}>
                {addable.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addWidget(s, dash.id, { type: 'section', section: adding }))} disabled={dash.widgets.length >= CAPS.widgets}>Add section</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setEditing({})} disabled={dash.widgets.length >= CAPS.widgets}>Add custom report</button>
          </div>
          <p className="ab-hint">{sectionById(adding)?.description}</p>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addDashboard(s, { name: 'New dashboard', scope: dash.scope }))} disabled={state.dashboards.length >= CAPS.dashboards}>New dashboard</button>
            {missingPresets.map((p) => (
              <button key={p.id} type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addPresetDashboard(s, p.id))}>Add "{p.name}"</button>
            ))}
            {state.dashboards.length > 1 &&
              (confirmRemove ? (
                <>
                  <span className="ab-hint">Remove "{dash.name}"?</span>
                  <button type="button" className="ab-btn ab-btn-danger ab-btn-sm" onClick={() => { update((s) => removeDashboard(s, dash.id)); setConfirmRemove(false); }}>Yes, remove</button>
                  <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setConfirmRemove(false)}>Keep it</button>
                </>
              ) : (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setConfirmRemove(true)}>Remove this dashboard</button>
              ))}
          </div>
          <p className="ab-hint">Only the layout is saved on this computer: which sections, in what order, and the groups. Numbers and names are never stored.</p>
        </section>
      )}

      {editing && !editing.widgetId && (
        <BuilderEditor
          env={env}
          usableTables={usableIds}
          onCancel={() => setEditing(null)}
          onSave={(config) => {
            update((s) => addWidget(s, dash.id, { type: 'builder', builder: config }));
            setEditing(null);
          }}
        />
      )}

      {context.phase === 'error' && !context.data && <ErrorNote error={context.error} onRetry={refresh} />}
      {context.phase === 'loading' && !context.data && <p className="ab-note" role="status">Checking which tables you can read…</p>}
      {context.data && !selected.length && <p className="ab-note ab-note-warn">No ticket table is available for this dashboard. {usableIds.length ? 'Turn a table on above.' : 'You cannot read incidents, requests, cases, problems or changes with your roles.'}</p>}

      {context.data && (
        <div className="ab-widgets">
          {widgets.map((w, i) => {
            const section = w.type === 'section' ? sectionById(w.section) : null;
            const label = w.type === 'builder' ? w.builder.title || 'custom report' : section?.label || 'section';
            const tools = customize && canEdit && (
              <WidgetTools
                index={dash.widgets.indexOf(w)}
                count={dash.widgets.length}
                label={label}
                onMove={(delta) => update((s) => moveWidget(s, dash.id, w.id, delta))}
                onEdit={w.type === 'builder' ? () => setEditing({ widgetId: w.id }) : undefined}
                onRemove={() => update((s) => removeWidget(s, dash.id, w.id))}
              />
            );
            if (editingWidget && editingWidget.id === w.id) {
              return (
                <BuilderEditor
                  key={w.id}
                  initial={w.builder}
                  env={env}
                  usableTables={usableIds}
                  onCancel={() => setEditing(null)}
                  onSave={(config) => {
                    update((s) => updateWidget(s, dash.id, w.id, { builder: config }));
                    setEditing(null);
                  }}
                />
              );
            }
            return (
              <div key={w.id} className="ab-widget-slot">
                {tools}
                <WidgetBoundary title={label} resetKey={`${refreshKey}|${scopeJson}|${selectedJson}`}>
                  {w.type === 'builder' ? <BuilderView widget={w} env={env} /> : section ? <section.View widget={w} env={env} eff={eff} /> : null}
                </WidgetBoundary>
              </div>
            );
          })}
          {!dash.widgets.length && <p className="ab-sub">This dashboard is empty. Press Customize to add sections.</p>}
          {hiddenSections.length > 0 && <p className="ab-hint">Turned off by your organisation, so not shown: {hiddenSections.join(', ')}.</p>}
        </div>
      )}
    </div>
  );
}
