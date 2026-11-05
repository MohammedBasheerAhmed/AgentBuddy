import { t } from '../../i18n/index.js';

// The Team screen's AI Assist sections as the side rail lists them (docs/rail-layout.md B), in the page's order. The cards draw their
// title from `label`, so the rail always says what the card says; `icon` is a name of src/sidepanel/ui/iconPaths.js. The coaching
// snapshot is in the rail only when the organisation allows coaching (otherwise the screen shows one line, not a section).
// The Insights half is the dashboard: its sections are the dashboard's widgets, listed by src/sidepanel/reports/railSections.js.
// tests/screens-rail.test.js checks that the ids are unique, the icons can be drawn and every label has its Arabic.
export const TEAM_ASSIST_SECTIONS = Object.freeze({
  handover: { id: 'team-handover', half: 'assist', icon: 'arrowRight', label: () => t('Hand-over note') },
  explain: { id: 'team-explain', half: 'assist', icon: 'help', label: () => t('Explain this dashboard') },
  coaching: { id: 'team-coaching', half: 'assist', icon: 'users', label: () => t('Coaching snapshot') },
});
