import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isFeatureEnabled } from '../../policy/policy.js';
import { activeProfiles } from '../../profiles/profiles.js';
import { read } from '../ask.js';
import { useSectionVisible } from '../SectionVisible.js';
import {
  PRESETS, CAPS, addDashboard, addOrgDashboard, addPresetDashboard, addWidget, exportLayout, importLayout, instanceKey, layoutFileName, moveWidget,
  offerOrgDashboard, removeDashboard, removeWidget, renameDashboard, setActive, setDashboardSetup, updateWidget,
} from '../../reports/dashboards.js';
import { createLimiter } from '../../reports/engine/cache.js';
import { createLoadedStore } from '../../reports/ai/loaded.js';
import { addableSections, sectionById } from './sections.js';
import { useDashboards, useReportContext } from './hooks.js';
import { listUrl, openList, openTicket } from './drill.js';
import { pageIdentity, visibleWidgets, widgetParams } from './dashboardEnv.js';
import { downloadText } from './download.js';
import WidgetBoundary from './WidgetBoundary.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { recordUrl } from '../openRecord.js';
import { andList, clock } from './format.js';
import ScopeBar from './ScopeBar.jsx';
import BuilderView from './BuilderView.jsx';
import BuilderEditor from './BuilderEditor.jsx';
import MoreMenu from './MoreMenu.jsx';
import ExportPanel from './ExportPanel.jsx';
import { dashboardNotes } from './SectionShell.jsx';

const AUTO_MS = 5 * 60 * 1000;
// Coming back to the Team screen after this long reads the numbers again (TRACKER.md 2.4: fast and honest).
const STALE_MS = 5 * 60 * 1000;
const SESSION_TEXT = 'Your ServiceNow session has ended. Sign in again in the ServiceNow tab, then press Try again.';

const readAuto = () => {
  try {
    return sessionStorage.getItem('ab-reports-auto') === '1';
  } catch {
    return false;
  }
};

/** The HR tables may be read: the person works with the HR profile and the organisation allows HR content (the page checks too). */
export const hrReportsAllowed = (eff) => activeProfiles(eff).includes('hr') && eff?.policy?.allowHrContent === true;

/** The scope chip's words: 'Mine', 'My groups (3)', 'My groups (25 of 41)', 'Chosen groups (2)'. Pure. */
export function scopeChipText(scope, context) {
  if (!scope || scope.kind === 'mine') return 'Mine';
  if (scope.kind === 'chosen') return `Chosen groups (${scope.groupIds?.length || 0})`;
  const n = context?.groups?.length;
  if (!Number.isFinite(n)) return 'My groups';
  const total = context?.groupsTotal;
  return `My groups (${Number.isFinite(total) && total > n ? `${n} of ${total}` : n})`;
}

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
 * The Team dashboard (the Insights half of the Team screen, N15-N17): a quiet top row (which dashboard, whose tickets, one "⋯"
 * menu), then the numbers. No AI element: "Explain this dashboard", the hand-over note and coaching are in the AI Assist half
 * (src/sidepanel/team), which works from the results this dashboard loaded (`share`, memory only).
 * Used by the side panel (layout 'panel') and by the full-page dashboard (layout 'page'): same components, more room.
 *
 * props: page, eff, layout, active (the half is on screen: auto-refresh runs and stale numbers are read again only then), share
 * (src/sidepanel/team/teamShare.js; the full page has none and keeps its results to itself).
 * Everything shown is read through the ServiceNow tab `page.tabId` with the person's own session; nothing read is stored.
 */
export default function ReportsDashboard({ page, eff, layout = 'panel', active = true, share = null }) {
  const policy = eff?.policy;
  const blocked = useMemo(() => policy?.blockedTables || [], [policy]);
  const disabled = Boolean(policy) && !isFeatureEnabled('reports', policy);
  const lead = activeProfiles(eff).includes('lead');
  const hrOk = hrReportsAllowed(eff);
  const instance = instanceKey(page?.href);
  // The organisation's dashboard (policy `defaultDashboard`, N17): the first one for someone with none yet, offered once to anyone else.
  const org = policy?.defaultDashboard || null;
  const { ready, state, status, saveFailed, update } = useDashboards({ instance, lead, org });
  const [refreshKey, setRefreshKey] = useState(0);
  const [mask, setMask] = useState(false);
  const maskMode = eff?.values?.piiMode || 'standard';
  const [customize, setCustomize] = useState(false);
  const [editing, setEditing] = useState(null); // { widgetId } for an existing custom report, {} for a new one
  const [auto, setAuto] = useState(readAuto);
  const [readAts, setReadAts] = useState({});
  const [adding, setAdding] = useState('overview');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [sessionLost, setSessionLost] = useState(false);
  const fileInput = useRef(null);
  const context = useReportContext({ tabId: page.tabId, blocked, refreshKey, allowSensitive: hrOk });

  const dash = ready ? state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0] : null;
  const canEdit = ready && status !== 'newer';
  const focus = layout === 'page';

  const tableList = context.data?.tables || [];
  const usableIds = tableList.filter((t) => t.usable).map((t) => t.table);
  const selected = dash ? (dash.tables ? dash.tables.filter((t) => usableIds.includes(t)) : usableIds) : [];

  const refresh = useCallback(async () => {
    setSessionLost(false);
    try {
      await read(page.tabId, 'reportClear');
    } catch {
      /* the next read will say what is wrong */
    }
    setRefreshKey((k) => k + 1);
  }, [page.tabId]);

  const say = useCallback((text) => {
    setNotice(text);
    setTimeout(() => setNotice(''), 5000);
  }, []);

  // A section that is not on screen (another screen, or the AI Assist half) must not keep working: the timer runs only while shown.
  const sectionVisible = useSectionVisible();
  const shown = sectionVisible && active !== false;
  useEffect(() => {
    if (!auto || !shown) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [auto, shown, refresh]);

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
  // What the widgets have loaded, in memory only: the export menu and the AI Assist half work from it without reading again.
  const ownLoaded = useMemo(() => createLoadedStore(), []);
  const loaded = share?.loaded || ownLoaded;
  const noteRead = useCallback((id, ms) => setReadAts((prev) => (prev[id] === ms ? prev : { ...prev, [id]: ms })), []);
  const loadedEntries = useSyncExternalStore(loaded.subscribe, loaded.snapshot, loaded.snapshot);
  const onSessionLost = useCallback(() => setSessionLost(true), []);

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
      allowSensitive: hrOk,
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
      onSessionLost,
      loaded,
      myGroups: JSON.parse(groupsJson),
      groupsNote,
    }),
    // The scope is compared by value so a re-render of the dashboard does not restart every widget's read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stablePage, layout, scopeJson, selectedJson, blocked, hrOk, refreshKey, asOf, limiter, mask, maskMode, canEdit, dash?.id, focus, update, noteRead, onSessionLost, loaded, groupsJson, groupsNote]
  );

  // Tell the AI Assist half what is on screen (memory only).
  useEffect(() => {
    if (!share) return undefined;
    share.mount(1);
    return () => share.mount(-1);
  }, [share]);
  useEffect(() => {
    share?.set({ asOf, refreshKey, dashboardId: dash?.id || '' });
  }, [share, asOf, refreshKey, dash?.id]);

  // The ServiceNow session ended while reading which tables can be used: the same one banner.
  useEffect(() => {
    if (context.code === 'SESSION_EXPIRED') setSessionLost(true);
  }, [context.code]);

  const widgetIds = dash ? visibleWidgets(dash.widgets, { policy }).shown.map((w) => w.id) : [];
  const times = widgetIds.map((id) => readAts[id]).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : null;

  // Shown again after a while: read again, so what is on screen is not old news.
  const wasShown = useRef(shown);
  useEffect(() => {
    if (shown && !wasShown.current && oldest && Date.now() - oldest > STALE_MS) refresh();
    wasShown.current = shown;
  }, [shown, oldest, refresh]);

  if (disabled) {
    return (
      <section className="ab-card">
        <h2 className="ab-h">Team and queue</h2>
        <p className="ab-sub">Your organisation has turned reports off.</p>
      </section>
    );
  }
  if (!ready || !dash) return <p className="ab-sub" role="status">Loading your dashboards…</p>;

  const { shown: widgets, hidden: aiSections } = visibleWidgets(dash.widgets, { policy, customize: customize && canEdit });
  const notes = [
    ...(context.data?.zone?.source === 'browser' && context.data.zone.note ? [context.data.zone.note] : []),
    ...(dash.scope.kind === 'groups' && groupsNote ? [groupsNote] : []),
    ...dashboardNotes(loadedEntries, widgetIds),
  ].filter((n, i, all) => n && all.indexOf(n) === i);

  const setup = (patch) => update((s) => setDashboardSetup(s, dash.id, patch));
  const onTables = (list) => setup({ tables: list.length === usableIds.length && usableIds.every((t) => list.includes(t)) ? null : list });
  const missingPresets = PRESETS.filter((p) => !state.dashboards.some((d) => d.id === p.id));
  const editingWidget = editing?.widgetId ? dash.widgets.find((w) => w.id === editing.widgetId) : null;

  const saveLayout = () => {
    const file = exportLayout(dash);
    if (!file) return;
    downloadText(layoutFileName(dash.name), JSON.stringify(file, null, 2), 'application/json;charset=utf-8');
    say(`Layout of "${dash.name}" saved to your downloads. It holds no numbers and no tickets.`);
  };
  const loadLayout = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > CAPS.file) {
      say('The file is too big to be a dashboard layout.');
      return;
    }
    let text = '';
    try {
      text = await file.text();
    } catch {
      say('The file could not be read.');
      return;
    }
    let outcome = null;
    update((s) => {
      outcome = importLayout(text, s);
      return outcome.ok ? outcome.state : s;
    });
    say(outcome?.ok ? `Added "${outcome.name}". Its groups are checked against this instance when it loads.` : outcome?.reason || 'The file could not be loaded.');
  };
  // Never a lock: the added dashboard is the person's own copy, to change or remove like any other.
  const addOrg = () => {
    let outcome = null;
    update((s) => {
      outcome = addOrgDashboard(s, org);
      return outcome.ok ? outcome.state : s;
    });
    say(outcome?.ok ? `Added "${outcome.name}", your organisation's dashboard. It is your own copy: change or remove it as you like.` : outcome?.reason || 'The dashboard could not be added.');
  };

  const menu = [
    { id: 'refresh', label: 'Refresh', onSelect: refresh },
    { id: 'auto', label: 'Refresh every 5 minutes', checked: auto, onSelect: () => toggleAuto(!auto) },
    canEdit && { id: 'customize', label: customize ? 'Stop customizing' : 'Customize', onSelect: () => setCustomize((c) => !c) },
    canEdit && offerOrgDashboard(state, org) && { id: 'org-dashboard', label: "Add your organisation's dashboard", onSelect: addOrg },
    { id: 'export', label: 'Export…', onSelect: () => setExporting(true) },
    { id: 'print', label: 'Print or save as PDF', onSelect: () => window.print() },
    layout === 'panel' && { id: 'page', label: 'Open full page', onSelect: () => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?tab=${page.tabId}`) }) },
  ];
  const noTables = context.data && !selected.length;
  const hrWanted = activeProfiles(eff).includes('hr') && !hrOk;

  return (
    <div className={`ab-dash ab-dash-${layout}`}>
      {sessionLost && (
        <div className="ab-note ab-note-warn ab-dash-session" role="alert">
          <p>{SESSION_TEXT}</p>
          <button type="button" className="ab-btn ab-btn-sm" onClick={refresh}>Try again</button>
        </div>
      )}

      <div className="ab-dash-toolbar ab-dash-top">
        <label className="ab-dash-select">
          <span className="ab-chart-sr">Dashboard</span>
          <select className="ab-select ab-select-quiet" value={dash.id} onChange={(e) => update((s) => setActive(s, e.target.value))}>
            {state.dashboards.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ab-chip ab-scope-chip" aria-expanded={scopeOpen} aria-controls="ab-dash-scope" onClick={() => setScopeOpen((o) => !o)} title="Whose tickets, and which tables">
          {scopeChipText(dash.scope, context.data)}
        </button>
        <MoreMenu label="More: refresh, customize, export, print" items={menu} />
      </div>
      <p className="ab-statusline" role="status">
        {notice ? `${notice} ` : ''}
        {oldest ? `Read at ${clock(oldest)}` : 'Reading the numbers…'}
        {oldest && selected.length ? ` · ${selected.length} ${selected.length === 1 ? 'table' : 'tables'}` : ''}
        {auto ? ' · refreshes every 5 minutes' : ''}
      </p>

      {status === 'newer' && <p className="ab-note ab-note-warn">Your saved dashboards were made by a newer version of Agent Buddy, so the ready-made ones are shown and nothing is saved.</p>}
      {status === 'corrupt' && <p className="ab-note ab-note-warn">Your saved dashboards could not be read, so the ready-made ones are shown.</p>}
      {saveFailed && <p className="ab-note ab-note-warn">Your changes could not be saved on this computer.</p>}

      {scopeOpen && (
        <div id="ab-dash-scope">
          <ScopeBar scope={dash.scope} tables={tableList} selected={selected} context={context.data} tabId={page.tabId} blocked={blocked} onScope={(scope) => setup({ scope })} onTables={onTables} canEdit={canEdit} />
        </div>
      )}

      {notes.length > 0 && (
        <details className="ab-details ab-dash-notes">
          <summary>{notes.length === 1 ? '1 note about these numbers' : `${notes.length} notes about these numbers`}</summary>
          <ul className="ab-dash-notes-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      {exporting && <ExportPanel name={dash.name} entries={loadedEntries} order={widgetIds} mask={mask} setMask={setMask} maskMode={maskMode} onClose={() => setExporting(false)} />}

      {customize && canEdit && (
        <section className="ab-card ab-customize" aria-label="Customize this dashboard">
          <NameField value={dash.name} onCommit={(name) => update((s) => renameDashboard(s, dash.id, name))} />
          <div className="ab-row">
            <label className="ab-widget-select">
              <span className="ab-chart-sr">Section to add</span>
              <select className="ab-select" value={adding} onChange={(e) => setAdding(e.target.value)}>
                {addableSections(policy).map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addWidget(s, dash.id, { type: 'section', section: adding }))} disabled={dash.widgets.length >= CAPS.widgets}>Add section</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setEditing({})} disabled={dash.widgets.length >= CAPS.widgets}>Add custom report</button>
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => setCustomize(false)}>Done</button>
          </div>
          <p className="ab-hint">{sectionById(adding)?.description}</p>
          <details className="ab-details">
            <summary>More</summary>
            <div className="ab-row">
              <button type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addDashboard(s, { name: 'New dashboard', scope: dash.scope }))} disabled={state.dashboards.length >= CAPS.dashboards}>New dashboard</button>
              {missingPresets.map((p) => (
                <button key={p.id} type="button" className="ab-btn ab-btn-sm" onClick={() => update((s) => addPresetDashboard(s, p.id))}>Add "{p.name}"</button>
              ))}
              <button type="button" className="ab-btn ab-btn-sm" onClick={saveLayout}>Save layout as a file</button>
              <button type="button" className="ab-btn ab-btn-sm" onClick={() => fileInput.current?.click()} disabled={state.dashboards.length >= CAPS.dashboards}>Load a layout file</button>
              <input ref={fileInput} type="file" accept="application/json,.json" className="ab-offscreen" tabIndex={-1} aria-hidden="true" onChange={loadLayout} />
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
          </details>
          <p className="ab-hint">Only the layout is saved, on this computer and for this instance: sections, order, groups. Never numbers or names.</p>
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

      {context.phase === 'error' && !context.data && context.code !== 'SESSION_EXPIRED' && <ErrorNote error={context.error} onRetry={refresh} />}
      {context.phase === 'loading' && !context.data && <p className="ab-note" role="status">Checking which tables you can read…</p>}
      {noTables && (
        <p className="ab-note ab-note-warn">
          No ticket table is available for this dashboard. {usableIds.length ? 'Turn a table on under the scope above.' : 'You cannot read incidents, requests, cases, problems, changes or change tasks with your roles.'}
          {hrWanted ? ' HR cases are shown when your organisation allows HR content in Agent Buddy.' : ''}
        </p>
      )}

      {context.data && (
        <div className="ab-widgets">
          {widgets.map((w) => {
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
            if (section?.ai) {
              // Only in Customize (visibleWidgets leaves AI sections out otherwise): a place-holder that can be removed, never the AI itself.
              return (
                <div key={w.id} className="ab-widget-slot">
                  {tools}
                  <section className="ab-card ab-widget" aria-label={section.label}>
                    <h2 className="ab-h">{section.label}</h2>
                    <p className="ab-hint">This is under AI Assist now. Remove it from this dashboard.</p>
                  </section>
                </div>
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
          {!dash.widgets.length && <p className="ab-sub">This dashboard is empty. Choose Customize in the ⋯ menu to add sections.</p>}
          {aiSections.length > 0 && <p className="ab-hint">{andList(aiSections)} {aiSections.length === 1 ? 'is' : 'are'} under AI Assist.</p>}
        </div>
      )}
    </div>
  );
}
