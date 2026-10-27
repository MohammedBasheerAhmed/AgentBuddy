import ReportsDashboard from '../reports/ReportsDashboard.jsx';

// The "Team" section: reports and dashboards for fulfillers and team leads (F1-F7). Everything is read with the person's own
// session through GET-only Table and Aggregate API reads, so a table or column they cannot read says "not available to you".
// The sections it shows are listed in src/sidepanel/reports/sections.js.
// props (top-level tabs): { page, eff }
export default function ReportsView({ page, eff }) {
  return <ReportsDashboard page={page} eff={eff} layout="panel" />;
}
