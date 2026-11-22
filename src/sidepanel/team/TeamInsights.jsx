import { useEffect, useRef, useState } from 'react';
import { isFeatureEnabled } from '../../policy/policy.js';
import ReportsDashboard from '../reports/ReportsDashboard.jsx';
import { BackButton } from '../mywork/FiveRow.jsx';
import { teamShare } from './teamShare.js';
import TeamRows from './TeamRows.jsx';
import WeeklyReport from './WeeklyReport.jsx';
import { t } from '../../i18n/index.js';

/**
 * The Team screen's Insights half (N15, N16, N17). Round 5 (docs/round5.md, board C): the first screen is five rows and a "Weekly
 * report" button (TeamRows.jsx); "All team charts and tables" opens today's Team overview unchanged (ReportsDashboard.jsx: the sections,
 * the shift hand-over tables, the report builder, saved dashboards, export and the full page), and the button opens the weekly report
 * (WeeklyReport.jsx, the reports agent's). No AI here; nothing read leaves ServiceNow. What the overview loads is shared, in memory
 * only, with the AI Assist half (teamShare.js), so "Explain this dashboard" and the hand-over note work from exactly these numbers; while
 * only the five rows are on screen the AI half reads the dashboard's sections itself (TeamAssist.jsx).
 * Props: { page, eff, active }.
 */
export default function TeamInsights({ page, eff, active }) {
  const [view, setView] = useState('rows'); // 'rows' | 'all' | 'weekly'
  const policy = eff?.policy;
  const disabled = Boolean(policy) && !isFeatureEnabled('reports', policy);

  // Going to a view and back: the focus goes to the first control of the view that opened, and back to what opened it.
  const back = useRef(null);
  const allRow = useRef(null);
  const weekly = useRef(null);
  const went = useRef('');
  useEffect(() => {
    if (went.current === view) return;
    const from = went.current;
    went.current = view;
    if (!from && view === 'rows') return; // the first draw
    if (view === 'rows') (from === 'weekly' ? weekly : allRow).current?.focus?.({ preventScroll: true });
    else back.current?.focus?.({ preventScroll: true });
  }, [view]);

  if (disabled) {
    return (
      <section className="ab-card">
        <h2 className="ab-h">{t('Team and queue')}</h2>
        <p className="ab-sub">{t('Your organisation has turned reports off.')}</p>
      </section>
    );
  }
  // The five rows stay mounted (hidden) behind the other two views: their numbers, the rows the person opened and the scope are still there
  // on Back, with nothing read again and no "Loading" in between. Only the view on screen is active (reads of a stale screen start then).
  return (
    <>
      <div hidden={view !== 'rows'}>
        <TeamRows page={page} eff={eff} active={active !== false && view === 'rows'} onAll={() => setView('all')} onWeekly={() => setView('weekly')} weeklyRef={weekly} allRef={allRow} />
      </div>
      {view === 'weekly' && (
        <div className="ab-fr-view" data-view="weekly">
          <WeeklyReport page={page} eff={eff} onBack={() => setView('rows')} />
        </div>
      )}
      {view === 'all' && (
        <div className="ab-fr-view" data-view="all">
          <BackButton onBack={() => setView('rows')} innerRef={back} />
          <ReportsDashboard page={page} eff={eff} layout="panel" active={active !== false} share={teamShare(page)} />
        </div>
      )}
    </>
  );
}
