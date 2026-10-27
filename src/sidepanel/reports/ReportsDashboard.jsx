import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isFeatureEnabled } from '../../policy/policy.js';
import { read } from '../ask.js';
import { PRESETS, CAPS, addDashboard, addPresetDashboard, addWidget, moveWidget, removeDashboard, removeWidget, renameDashboard, setActive, setDashboardSetup, updateWidget } from '../../reports/dashboards.js';
import { createLimiter } from '../../reports/engine/cache.js';
import { REPORT_SECTIONS, sectionById } from './sections.js';
import { useDashboards, useReportContext } from './hooks.js';
import { openList, openTicket } from './drill.js';
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
  const [customize, setCustomize] = useState(false);
  const [editing, setEditing] = useState(null); // { widgetId } for an existing custom report, {} for a new one
  const [auto, setAuto] = useState(readAuto);
  const [readAts, setReadAts] = useState({});
  const [adding, setAdding] = useState(REPORT_SECTIONS[0].id);
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

  useEffect(() => {
    if (!auto) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, AUTO_MS);
    return () => clearInterval(timer);
  }, [auto, refresh]);

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
  const noteRead = useCallback((id, ms) => setReadAts((prev) => (prev[id] === ms ? prev : { ...prev, [id]: ms })), []);

  const scopeJson = dash ? JSON.stringify(dash.scope) : '';
  const selectedJson = JSON.stringify(selected);
  const env = useMemo(
    () => ({
      page,
      layout,
      scope: dash?.scope,
      scopeKind: dash?.scope.kind,
      tables: JSON.parse(selectedJson),
      blocked,
      refreshKey,
      limiter,
      mask,
      setMask,
      canEdit,
      openList: (table, query) => openList(page, table, query, { focus }),
      openTicket: (ref) => openTicket(page, ref, { focus }),
      setWidgetParams: (widget, params) => update((s) => updateWidget(s, dash.id, widget.id, { params: { ...(widget.params || {}), ...params } })),
      noteRead,
    }),
    // The scope is compared by value so a re-render of the dashboard does not restart every widget's read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.tabId, page.href, layout, scopeJson, selectedJson, blocked, refreshKey, limiter, mask, canEdit, dash?.id, focus, update, noteRead]
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

  const widgetIds = dash.widgets.map((w) => w.id);
  const times = widgetIds.map((id) => readAts[id]).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : null;

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
        {layout === 'panel' && (
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?tab=${page.tabId}`) })}>
            Open full page
          </button>
        )}
      </div>
      <p className="ab-statusline" role="status">
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

      {customize && canEdit && (
        <section className="ab-card ab-customize" aria-label="Customize this dashboard">
          <NameField value={dash.name} onCommit={(name) => update((s) => renameDashboard(s, dash.id, name))} />
          <div className="ab-row">
            <label className="ab-widget-select">
              <span className="ab-chart-sr">Section to add</span>
              <select className="ab-select" value={adding} onChange={(e) => setAdding(e.target.value)}>
                {REPORT_SECTIONS.map((s) => (
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

      {context.phase === 'error' && !context.data && <p className="ab-note ab-note-danger" role="alert">{context.error}</p>}
      {context.phase === 'loading' && !context.data && <p className="ab-note" role="status">Checking which tables you can read…</p>}
      {context.data && !selected.length && <p className="ab-note ab-note-warn">No ticket table is available for this dashboard. {usableIds.length ? 'Turn a table on above.' : 'You cannot read incidents, requests, cases, problems or changes with your roles.'}</p>}

      {context.data && (
        <div className="ab-widgets">
          {dash.widgets.map((w, i) => {
            const section = w.type === 'section' ? sectionById(w.section) : null;
            const label = w.type === 'builder' ? w.builder.title || 'custom report' : section?.label || 'section';
            const tools = customize && canEdit && (
              <WidgetTools
                index={i}
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
                {w.type === 'builder' ? <BuilderView widget={w} env={env} /> : section ? <section.View widget={w} env={env} /> : null}
              </div>
            );
          })}
          {!dash.widgets.length && <p className="ab-sub">This dashboard is empty. Press Customize to add sections.</p>}
        </div>
      )}
    </div>
  );
}
