import React from 'react';
import ReportsDashboard from '../reports/ReportsDashboard.jsx';
import { teamShare } from './teamShare.js';

/**
 * The Team screen's Insights half (N15, N16, N17): dashboards, the shift hand-over tables, the report builder, saved dashboards,
 * export and the full page. No AI here; nothing read leaves ServiceNow. What the dashboard loads is shared, in memory only, with the
 * AI Assist half (teamShare.js), so "Explain this dashboard" and the hand-over note work from exactly these numbers.
 * Props: { page, eff, active }.
 */
export default function TeamInsights({ page, eff, active }) {
  return <ReportsDashboard page={page} eff={eff} layout="panel" active={active !== false} share={teamShare(page)} />;
}
