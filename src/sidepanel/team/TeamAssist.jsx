import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { activeProfiles } from '../../profiles/profiles.js';
import { isFeatureEnabled } from '../../policy/policy.js';
import { AiBadge, CardFrame } from '../ui/primitives.jsx';
import ErrorNote from '../ErrorNote.jsx';
import { instanceKey } from '../../reports/dashboards.js';
import { createLimiter } from '../../reports/engine/cache.js';
import { HANDOVER_DEFAULT_HOURS } from '../../reports/engine/handover.js';
import { useDashboards, useReportContext } from '../reports/hooks.js';
import { useSection } from '../reports/useSection.js';
import { sectionById } from '../reports/sections.js';
import { widgetParams } from '../reports/dashboardEnv.js';
import { HandoverAi, HoursPicker } from '../reports/HandoverView.jsx';
import { ExplainBody } from '../reports/InsightsView.jsx';
import { CoachingTool, coachingGate, coachingNeeds } from '../reports/CoachingView.jsx';
import { featureState } from '../reports/aiShared.jsx';
import { hrReportsAllowed, scopeChipText } from '../reports/ReportsDashboard.jsx';
import { readLabel } from '../reports/format.js';
import { teamShare } from './teamShare.js';

// Results this half read itself carry ids starting with this, so they never take the place of what the Insights half loaded.
const ASSIST = 'assist:';
const HANDOVER_ID = `${ASSIST}handover`;
const SESSION_TEXT = 'Your ServiceNow session has ended. Sign in again in the ServiceNow tab, then press Try again.';
const AS_OF_REUSE_MS = 9 * 60 * 1000; // the engine ignores an "as of" older than ten minutes

/**
 * The hand-over numbers the note is written from: a hand-over result already loaded for the same period (by the Insights half's
 * dashboard, or by this half reading the dashboard), else null (this half then reads the hand-over itself). Pure.
 */
export function handoverSource(entries, hours) {
  return (Array.isArray(entries) ? entries : []).find((e) => e?.section === 'handover' && e.id !== HANDOVER_ID && e.result?.data?.available !== false && e.result?.data?.hours === hours) || null;
}

/** The results "Explain this dashboard" explains: the dashboard's own (this half's private hand-over read is not on that dashboard). */
export const explainEntries = (entries) => (Array.isArray(entries) ? entries : []).filter((e) => e?.id !== HANDOVER_ID);

/** Reads one section for this half without drawing it; the result goes to the shared store (memory only). */
function Headless({ section, widget, env }) {
  useSection(section, widget, env);
  return null;
}

/**
 * The Team screen's AI Assist half (AI28-AI30): the hand-over note, "Explain this dashboard" and the coaching snapshot. Every AI call
 * goes through useRun (preview, masking, policy); every button and answer carries the AI mark. It works from the numbers the Insights
 * half loaded (teamShare.js). When the Insights half has not been opened in this panel, this half reads the same dashboard itself,
 * through the same GET-only reads, so it never explains numbers nobody looked up.
 * Props: { page, eff, active }.
 */
export default function TeamAssist({ page, eff, active }) {
  const share = teamShare(page);
  useSyncExternalStore(share.subscribe, share.version, share.version);
  const entries = useSyncExternalStore(share.loaded.subscribe, share.loaded.snapshot, share.loaded.snapshot);
  const policy = eff?.policy;
  const blocked = useMemo(() => policy?.blockedTables || [], [policy]);
  const lead = activeProfiles(eff).includes('lead');
  const hrOk = hrReportsAllowed(eff);
  const { ready, state } = useDashboards({ instance: instanceKey(page?.href), lead });
  // Nothing is read until this half is first shown; it stays loaded afterwards.
  const [woke, setWoke] = useState(active !== false);
  useEffect(() => {
    if (active !== false) setWoke(true);
  }, [active]);
  const [ownRefresh, setOwnRefresh] = useState(0);
  const refreshKey = share.refreshKey + ownRefresh;
  const context = useReportContext({ tabId: page.tabId, blocked, refreshKey, allowSensitive: hrOk });
  const [sessionLost, setSessionLost] = useState(false);
  const onSessionLost = useCallback(() => setSessionLost(true), []);
  const limiter = useMemo(() => createLimiter(2), []);
  const [hoursChosen, setHours] = useState(null); // null: the period the Insights half's hand-over uses, else 12

  const dash = ready ? state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0] : null;
  const usable = (context.data?.tables || []).filter((t) => t.usable).map((t) => t.table);
  const tables = dash ? (dash.tables ? dash.tables.filter((t) => usable.includes(t)) : usable) : [];

  // The same "as of" as the dashboard's current load, so a read here asks the same questions (answered from the page's cache).
  const asOfRef = useRef({ key: null, at: 0 });
  const asOfKey = `${refreshKey}|${dash?.id || ''}`;
  if (asOfRef.current.key !== asOfKey) asOfRef.current = { key: asOfKey, at: share.asOf && Date.now() - share.asOf < AS_OF_REUSE_MS ? share.asOf : Date.now() };
  const asOf = asOfRef.current.at;

  const tablesJson = JSON.stringify(woke ? tables : []);
  const scopeJson = JSON.stringify(dash?.scope || null);
  const groupsJson = JSON.stringify(context.data?.groups || []);
  const env = useMemo(
    () => ({
      page,
      scope: dash?.scope,
      scopeKind: dash?.scope?.kind,
      tables: JSON.parse(tablesJson),
      blocked,
      allowSensitive: hrOk,
      refreshKey,
      limiter,
      widgetParams: (widget) => widgetParams(widget, asOf),
      loaded: share.loaded,
      noteRead: () => {},
      onSessionLost,
      myGroups: JSON.parse(groupsJson),
      groupsNote: context.data?.groupsNote || '',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compared by value: a re-render must not restart the reads
    [page.tabId, page.href, scopeJson, tablesJson, blocked, hrOk, refreshKey, limiter, asOf, share.loaded, onSessionLost, groupsJson, context.data?.groupsNote]
  );

  // The hand-over the note is written from.
  const insightsHours = entries.find((e) => e.section === 'handover' && e.id !== HANDOVER_ID && Number.isFinite(e.result?.data?.hours))?.result.data.hours;
  const hours = hoursChosen || insightsHours || HANDOVER_DEFAULT_HOURS;
  const shared = handoverSource(entries, hours);
  const own = useSection('handover', { id: HANDOVER_ID, type: 'section', section: 'handover', params: { hours } }, shared ? { ...env, tables: [] } : env);
  const handover = shared?.result || own.result || null;
  useEffect(() => {
    if (own.phase === 'error' && own.code === 'SESSION_EXPIRED') setSessionLost(true);
  }, [own.phase, own.code]);
  useEffect(() => {
    if (context.code === 'SESSION_EXPIRED') setSessionLost(true);
  }, [context.code]);

  if (policy && !isFeatureEnabled('reports', policy)) {
    return <p className="ab-note">Your organisation has turned reports off.</p>;
  }
  if (!ready || !dash) return <p className="ab-sub" role="status">Loading your dashboards…</p>;

  // The dashboard's sections, read here only while no Insights dashboard is on screen for this tab (otherwise those widgets load them).
  const headless = woke && share.live === 0 ? dash.widgets.filter((w) => w.type === 'section' && sectionById(w.section) && !sectionById(w.section).ai) : [];
  const handoverOn = featureState('shift-handover', policy).available;
  const gate = coachingGate(eff);
  const scopeText = scopeChipText(dash.scope, context.data);
  const handoverRead = handover?.readAt ? `From the hand-over numbers for ${scopeText}, read at ${readLabel(handover.readAt)}.` : '';
  const retry = () => {
    setSessionLost(false);
    setOwnRefresh((k) => k + 1);
  };

  return (
    <div className="ab-team-assist">
      {headless.map((w) => (
        <Headless key={w.id} section={w.section} widget={{ ...w, id: `${ASSIST}${w.id}` }} env={env} />
      ))}
      {sessionLost && (
        <div className="ab-note ab-note-warn ab-dash-session" role="alert">
          <p>{SESSION_TEXT}</p>
          <button type="button" className="ab-btn ab-btn-sm" onClick={retry}>Try again</button>
        </div>
      )}

      <CardFrame id="team-handover" title="Hand-over note" summary={`Last ${hours} hours · ${scopeText}`} actions={<AiBadge />}>
        <HoursPicker hours={hours} onChange={setHours} label="Period of the hand-over" />
        {handover ? (
          handover.data?.available === false ? (
            <p className="ab-note">{handover.data.reason || 'There is nothing to hand over.'}</p>
          ) : (
            <p className="ab-hint">{handoverRead}</p>
          )
        ) : own.phase === 'error' && own.code !== 'SESSION_EXPIRED' ? (
          <ErrorNote error={own.error} onRetry={own.reload} />
        ) : !sessionLost && woke && tables.length ? (
          <p className="ab-note" role="status">Reading the hand-over numbers…</p>
        ) : context.data && !tables.length ? (
          <p className="ab-note">No ticket table is available, so there is nothing to hand over.</p>
        ) : null}
        <HandoverAi result={handover?.data?.available === false ? null : handover} page={page} eff={eff} hours={hours} primary={handoverOn} />
      </CardFrame>

      <CardFrame id="team-explain" title="Explain this dashboard" summary={`${dash.name} · ${scopeText}`} actions={<AiBadge />}>
        <ExplainBody entries={explainEntries(entries)} page={page} eff={eff} primary={!handoverOn} />
      </CardFrame>

      {gate ? (
        <p className="ab-hint ab-team-coach-off">
          Coaching snapshot: {gate === 'off' ? 'turned off by your organisation.' : 'off until your organisation switches coaching on.'}
        </p>
      ) : (
        <CardFrame id="team-coaching" title="Coaching snapshot" summary="One group, a sample of resolved tickets" actions={<AiBadge />} defaultOpen={false}>
          <CoachingTool env={{ page, tables, blocked, myGroups: context.data?.groups || [], groupsNote: context.data?.groupsNote || '' }} eff={eff} needs={coachingNeeds(eff)} bare />
        </CardFrame>
      )}
    </div>
  );
}
