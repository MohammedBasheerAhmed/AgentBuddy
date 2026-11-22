import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activeProfiles } from '../../profiles/profiles.js';
import { read } from '../ask.js';
import { instanceKey, setDashboardSetup } from '../../reports/dashboards.js';
import { createLimiter } from '../../reports/engine/cache.js';
import { reasonLabel } from '../../reports/engine/attention.js';
import { placeholderName, shown } from '../../reports/shown.js';
import { Icon } from '../ui/icons.jsx';
import RecordLink from '../RecordLink.jsx';
import ScopeBar from '../reports/ScopeBar.jsx';
import Summary from '../reports/Summary.jsx';
import { attentionFacts } from '../reports/AttentionView.jsx';
import { dashboardNotes } from '../reports/SectionShell.jsx';
import { hrReportsAllowed, scopeChipText } from '../reports/ReportsDashboard.jsx';
import { useDashboards, useMinuteClock, useReportContext } from '../reports/hooks.js';
import { useSection } from '../reports/useSection.js';
import { widgetParams } from '../reports/dashboardEnv.js';
import { clock } from '../reports/format.js';
import { FiveRow } from '../mywork/FiveRow.jsx';
import { attentionRow, ageingRow, closedRow, comingBackRow, loadRow, sectionState, teamSummary } from './rows.js';
import { t, tn } from '../../i18n/index.js';

// Team's first screen (round 5, board C, docs/round5.md): "Team", whose tickets (the scope chip), when it was read, a button to the
// weekly report, then FIVE rows: Needs attention now, Getting old, Who is carrying the load, Coming back again, How well tickets are
// closed (rows.js works each out from three sections the Team overview reads: attention, workload, quality; the same engine, the same
// numbers). One finding on each row; the first opens with its tickets. Names of people show only inside an opened row, never on a
// collapsed one. Under them: "All team charts and tables", today's full Team overview (src/sidepanel/reports/ReportsDashboard.jsx), which
// stays complete (hand-over, report builder, saved dashboards, export, full page).
//
// The scope is the active dashboard's (saved with it, as the dashboard's chip does), so the rows and the full overview always agree.
// Nothing here is stored but that; nothing read leaves ServiceNow.

const STALE_MS = 5 * 60 * 1000;
// The three sections read here, as widgets of this screen (ids that cannot meet a saved dashboard's). Their requests are the sections'
// own, with the dashboard's "as of" instant, so the full overview that opens next is answered from the page's cache.
const W = {
  attention: { id: 'rows:attention', type: 'section', section: 'attention', params: {} },
  workload: { id: 'rows:workload', type: 'section', section: 'workload', params: {} },
  quality: { id: 'rows:quality', type: 'section', section: 'quality', params: {} },
};
const TONE = { breached: 'danger', closest: 'warn', approval: 'neutral', reassigned: 'warn', oldest: 'neutral', customer: 'neutral' };
const RAIL = {
  needs: { id: 'team-row-needs', icon: 'alert' },
  old: { id: 'team-row-old', icon: 'clock' },
  load: { id: 'team-row-load', icon: 'users' },
  back: { id: 'team-row-back', icon: 'refresh' },
  closed: { id: 'team-row-closed', icon: 'checkCircle' },
};

/** One ticket of "Needs attention now" (or "Oldest open"): its number as a link, its title, its reason and the facts after it. */
function TicketLine({ page, row, now, reason }) {
  return (
    <li className="ab-tlist-row ab-fr-ticket">
      <span className="ab-tlist-line">
        <RecordLink page={page} item={{ table: row.table, sysId: row.sysId, number: row.number }} className="ab-chart-link ab-tlist-number">
          {row.number}
        </RecordLink>
        {row.title ? ' ' : null}
        {row.title ? <span className="ab-tlist-title">{row.title}</span> : null}
      </span>
      <span className="ab-tlist-meta">
        <span className={`ab-chip ab-chip-${TONE[reason] || 'neutral'}`}>{reasonLabel(reason, row.facts?.[reason])}</span> {attentionFacts({ ...row, reason }, now).join(' · ')}
      </span>
    </li>
  );
}

/** A short list of "name: number" facts (the age buckets, the people, the configuration items), numbers right-aligned. */
function Facts({ rows, label }) {
  if (!rows.length) return null;
  return (
    <ul className="ab-fr-facts" aria-label={label}>
      {rows.map((r, i) => (
        <li key={`${r.label}:${i}`}>
          <span className="ab-fr-fact-label">{r.label}</span>
          <span className="ab-fr-fact-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

const Calm = ({ children }) => <p className="ab-fr-empty">{children}</p>;

/** What an opened row shows when its section could not be read or is still being read: the plain line, and a way to try again. */
function NotReady({ state, line, onRetry }) {
  return (
    <div className="ab-fr-notready">
      <p className="ab-fr-empty" role={state.status === 'loading' ? 'status' : undefined}>{line}</p>
      {state.status === 'error' && onRetry && (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fr-more" onClick={onRetry}>
          {t('Try again')}
        </button>
      )}
    </div>
  );
}

export default function TeamRows({ page, eff, active, onAll, onWeekly, weeklyRef, allRef }) {
  const policy = eff?.policy;
  const blocked = useMemo(() => policy?.blockedTables || [], [policy]);
  const lead = activeProfiles(eff).includes('lead');
  const hrOk = hrReportsAllowed(eff);
  const instance = instanceKey(page?.href);
  const org = policy?.defaultDashboard || null;
  const { ready, state, status, update } = useDashboards({ instance, lead, org });
  const [refreshKey, setRefreshKey] = useState(0);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [open, setOpen] = useState({}); // row id -> true / false (unset: the first row opens when it has tickets)
  const [more, setMore] = useState(false); // "Show the other N" of the first row
  const [sessionLost, setSessionLost] = useState(false);
  const context = useReportContext({ tabId: page.tabId, blocked, refreshKey, allowSensitive: hrOk });
  const now = useMinuteClock(active !== false);

  const dash = ready ? state.dashboards.find((d) => d.id === state.activeId) || state.dashboards[0] : null;
  const canEdit = ready && status !== 'newer';
  const tableList = context.data?.tables || [];
  const usableIds = tableList.filter((x) => x.usable).map((x) => x.table);
  const selected = dash ? (dash.tables ? dash.tables.filter((id) => usableIds.includes(id)) : usableIds) : [];
  const setup = (patch) => update((s) => setDashboardSetup(s, dash.id, patch));
  const onTables = (list) => setup({ tables: list.length === usableIds.length && usableIds.every((id) => list.includes(id)) ? null : list });

  const refresh = useCallback(async () => {
    setSessionLost(false);
    try {
      await read(page.tabId, 'reportClear');
    } catch {
      /* the next read will say what is wrong */
    }
    setRefreshKey((k) => k + 1);
  }, [page.tabId]);

  // One "now" for the three sections of one load (they ask the same questions, so the full overview that opens next is answered from the
  // page's cache); a new load (Refresh, another scope or ticket types) takes a new instant.
  const limiter = useMemo(() => createLimiter(2), []);
  const scopeJson = dash ? JSON.stringify(dash.scope) : '';
  const selectedJson = JSON.stringify(selected);
  const loadKey = `${refreshKey}|${dash?.id || ''}|${scopeJson}|${selectedJson}`;
  const asOfRef = useRef({ key: null, at: 0 });
  if (asOfRef.current.key !== loadKey) asOfRef.current = { key: loadKey, at: Date.now() };
  const asOf = asOfRef.current.at;
  const groupsJson = JSON.stringify(context.data?.groups || []);
  const onSessionLost = useCallback(() => setSessionLost(true), []);
  const env = useMemo(
    () => ({
      page,
      scope: dash?.scope,
      scopeKind: dash?.scope?.kind,
      tables: JSON.parse(selectedJson),
      blocked,
      allowSensitive: hrOk,
      refreshKey,
      limiter,
      widgetParams: (widget) => widgetParams(widget, asOf),
      noteRead: () => {},
      onSessionLost,
      myGroups: JSON.parse(groupsJson),
    }),
    // The scope and the tables are compared by value so a re-render does not restart the reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.tabId, page.href, scopeJson, selectedJson, blocked, hrOk, refreshKey, limiter, asOf, onSessionLost, groupsJson]
  );
  const attention = useSection('attention', W.attention, env);
  const workload = useSection('workload', W.workload, env);
  const quality = useSection('quality', W.quality, env);

  const expired = [attention, workload, quality].some((s) => s.phase === 'error' && s.code === 'SESSION_EXPIRED');
  useEffect(() => {
    if (context.code === 'SESSION_EXPIRED' || expired) setSessionLost(true);
  }, [context.code, expired]);

  // Shown again after a while: read again, so what is on screen is not old news (as the full overview does).
  const times = [attention, workload, quality].map((s) => s.result?.readAt).filter(Number.isFinite);
  const oldest = times.length ? Math.min(...times) : null;
  const onScreen = active !== false;
  const wasShown = useRef(onScreen);
  useEffect(() => {
    if (onScreen && !wasShown.current && oldest && Date.now() - oldest > STALE_MS) refresh();
    wasShown.current = onScreen;
  }, [onScreen, oldest, refresh]);

  if (!ready || !dash) return <p className="ab-sub" role="status">{t('Loading your dashboards…')}</p>;

  // No ticket type can be read: the engine is not asked, and every row says why.
  const none = context.data && !selected.length ? (usableIds.length ? t('No ticket type is turned on for this view.') : t('No ticket type is available to you.')) : '';
  const sAttention = sectionState(attention, { none });
  const sWorkload = sectionState(workload, { none });
  const sQuality = sectionState(quality, { none });
  const needs = attentionRow(sAttention);
  const old = ageingRow(sWorkload, sAttention);
  const load = loadRow(sWorkload);
  const back = comingBackRow(sQuality);
  const closed = closedRow(sQuality);
  const summary = teamSummary(sWorkload, needs);
  const notes = [
    ...(context.data?.zone?.source === 'browser' && context.data.zone.note ? [context.data.zone.note] : []),
    ...(dash.scope.kind === 'groups' && context.data?.groupsNote ? [context.data.groupsNote] : []),
    ...dashboardNotes([attention, workload, quality].map((s, i) => ({ id: i, result: s.result }))),
  ]
    .filter((n, i, all) => n && all.indexOf(n) === i)
    .map(shown);

  // The rows are items of the side rail only while they are what the screen shows (not behind the full overview or the weekly report).
  const railOf = (id) => (onScreen ? RAIL[id] : null);
  const isOpen = (id, byDefault = false) => open[id] ?? byDefault;
  const toggle = (id) => (v) => setOpen((o) => ({ ...o, [id]: v }));
  const named = (name) => placeholderName(name);

  // The first row's tickets: the first two, then "Show the other N".
  const first = needs.items || [];
  const shownFirst = more ? first : first.slice(0, 2);

  return (
    <div className="ab-mywork ab-fr-screen ab-fr-team" data-view="rows">
      {sessionLost && (
        <div className="ab-note ab-note-warn ab-dash-session" role="alert">
          <p>{t('You are signed out of ServiceNow. Sign in again, then try again.')}</p>
          <button type="button" className="ab-btn ab-btn-sm" onClick={refresh}>
            {t('Try again')}
          </button>
        </div>
      )}
      <div className="ab-fr-top">
        <h2 className="ab-fr-title">{t('Team')}</h2>
        <button type="button" className="ab-chip ab-scope-chip" aria-expanded={scopeOpen} aria-controls="ab-fr-scope" onClick={() => setScopeOpen((o) => !o)} title={t('Whose tickets, and which ticket types')}>
          <span className="ab-scope-chip-text">{scopeChipText(dash.scope, context.data)}</span>
          <Icon name="chevronDown" size={14} className="ab-chevron" />
        </button>
      </div>
      <p className="ab-fr-sub">
        {summary ? `${summary} ` : ''}
        <span className="ab-fr-read" role="status">
          {oldest ? t('Read at {time}', { time: clock(oldest) }) : t('Reading the numbers…')}
        </span>
        <span aria-hidden="true"> · </span>
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fr-refresh" onClick={refresh}>
          {t('Refresh')}
        </button>
      </p>
      {scopeOpen && (
        <div id="ab-fr-scope" className="ab-fr-scope">
          <ScopeBar scope={dash.scope} tables={tableList} selected={selected} context={context.data} tabId={page.tabId} blocked={blocked} onScope={(scope) => setup({ scope })} onTables={onTables} canEdit={canEdit} />
        </div>
      )}

      <button type="button" ref={weeklyRef} className="ab-btn ab-btn-primary ab-fr-weekly" onClick={onWeekly}>
        <Icon name="clipboard" size={20} />
        <span className="ab-fr-weekly-text">
          <span className="ab-fr-weekly-title">{t('Weekly report')}</span>
          <span className="ab-fr-weekly-sub">{t('One click. Ready to send to your manager.')}</span>
        </span>
        <Icon name="chevronRight" size={16} className="ab-flip" />
      </button>

      <ul className="ab-rows ab-fr-rows" aria-label={t('Team')}>
        <FiveRow rowId="needs" rail={railOf('needs')} icon="alert" title={t('Needs attention now')} line={needs.line} count={needs.count} level={needs.level} open={isOpen('needs', first.length > 0)} onToggle={toggle('needs')}>
          {sAttention.status !== 'ready' ? (
            <NotReady state={sAttention} line={needs.line} onRetry={attention.reload} />
          ) : first.length ? (
            <>
              <ul className="ab-tlist ab-fr-tlist" aria-label={t('Needs attention now')}>
                {shownFirst.map((row) => (
                  <TicketLine key={row.sysId} page={page} row={row} now={now} reason={row.reason} />
                ))}
              </ul>
              {first.length > 2 && (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-fr-more" aria-expanded={more} onClick={() => setMore(!more)}>
                  {more ? t('Show fewer') : tn(first.length - 2, 'Show the other {n}', 'Show the other {n}')}
                </button>
              )}
              {needs.hint && <p className="ab-hint ab-fr-hint">{needs.hint}</p>}
            </>
          ) : (
            <Calm>{needs.line}</Calm>
          )}
        </FiveRow>

        <FiveRow rowId="old" rail={railOf('old')} icon="clock" title={t('Getting old')} line={old.line} count={old.count} level={old.level} open={isOpen('old')} onToggle={toggle('old')}>
          {sWorkload.status !== 'ready' ? (
            <NotReady state={sWorkload} line={old.line} onRetry={workload.reload} />
          ) : (
            <>
              <Facts label={t('Open tickets by age')} rows={(old.buckets || []).map((b) => ({ label: shown(b.label), value: b.count }))} />
              {old.stale !== null && old.stale !== undefined && <p className="ab-hint ab-fr-hint">{t('No update in {days}+ days', { days: old.staleDays })}: {old.stale}</p>}
              {old.oldest?.length > 0 && (
                <ul className="ab-tlist ab-fr-tlist" aria-label={t('Oldest open')}>
                  {old.oldest.map((row) => (
                    <TicketLine key={row.sysId} page={page} row={row} now={now} reason="oldest" />
                  ))}
                </ul>
              )}
            </>
          )}
        </FiveRow>

        <FiveRow rowId="load" rail={railOf('load')} icon="users" title={t('Who is carrying the load')} line={load.line} count={load.count} level={load.level} open={isOpen('load')} onToggle={toggle('load')}>
          {sWorkload.status !== 'ready' ? (
            <NotReady state={sWorkload} line={load.line} onRetry={workload.reload} />
          ) : load.people.length ? (
            <>
              <Facts label={t('Open tickets by person')} rows={load.people.slice(0, 5).map((p) => ({ label: named(p.name), value: p.count }))} />
              {load.people.length > 5 && <p className="ab-hint ab-fr-hint">{tn(load.people.length - 5, '{n} more person in All team charts and tables.', '{n} more people in All team charts and tables.')}</p>}
              {load.unassigned > 0 && <p className="ab-hint ab-fr-hint">{tn(load.unassigned, '{n} ticket has nobody assigned.', '{n} tickets have nobody assigned.')}</p>}
            </>
          ) : (
            <Calm>{load.line}</Calm>
          )}
        </FiveRow>

        <FiveRow rowId="back" rail={railOf('back')} icon="refresh" title={t('Coming back again')} line={back.line} count={back.count} level={back.level} open={isOpen('back')} onToggle={toggle('back')}>
          {sQuality.status !== 'ready' ? (
            <NotReady state={sQuality} line={back.line} onRetry={quality.reload} />
          ) : back.cis.length || back.callers.length ? (
            <>
              <Facts label={t('Configuration items with the most tickets')} rows={back.cis.slice(0, 5).map((c) => ({ label: named(c.name), value: c.count }))} />
              {back.callers.length > 0 && (
                <>
                  <p className="ab-fr-subhead">{t('Callers with {min} or more tickets', { min: sQuality.d.repeatCallers.min })}</p>
                  <Facts label={t('Callers')} rows={back.callers.slice(0, 5).map((c) => ({ label: named(c.name), value: c.count }))} />
                </>
              )}
            </>
          ) : (
            <Calm>{back.line}</Calm>
          )}
        </FiveRow>

        <FiveRow rowId="closed" rail={railOf('closed')} icon="checkCircle" title={t('How well tickets are closed')} line={closed.line} count={closed.count} level={closed.level} open={isOpen('closed')} onToggle={toggle('closed')}>
          {sQuality.status !== 'ready' ? (
            <NotReady state={sQuality} line={closed.line} onRetry={quality.reload} />
          ) : (
            <>
              <Facts label={t('How well tickets are closed')} rows={closed.facts} />
              {!closed.fixNotes && <p className="ab-hint ab-fr-hint">{t('Closing without a fix note is not counted here yet.')}</p>}
            </>
          )}
        </FiveRow>

        <li className="ab-more-row ab-fr-quiet">
          <button type="button" ref={allRef} className="ab-row ab-more-tools" onClick={onAll}>
            <Icon name="grid" size={16} className="ab-more-tools-icon" />
            <span className="ab-row-main">
              <span className="ab-more-tools-text">{t('All team charts and tables')}</span>
            </span>
            <Icon name="chevronRight" size={16} className="ab-more-tools-chevron ab-flip" />
          </button>
        </li>
      </ul>

      {notes.length > 0 && (
        <details className="ab-details ab-dash-notes ab-fr-notes">
          <Summary>{tn(notes.length, '{n} note about these numbers', '{n} notes about these numbers')}</Summary>
          <ul className="ab-dash-notes-list">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
