import { t } from '../../i18n/index.js';
import { shown } from '../../reports/shown.js';

// The Team screen's Insights half is the dashboard; the side rail lists its sections (docs/rail-layout.md B): one item per widget on
// show, in the dashboard's order, named by the heading the widget draws. This table holds that heading and an icon per kind of section
// (the ids of sections.js, and 'builder' for a custom report); `icon` is a name of src/sidepanel/ui/iconPaths.js. 'insights' and
// 'coaching' are AI sections: the dashboard draws them only in Customize, as a place-holder under their own name (sections.js).
// The full-page dashboard has no rail: there the widgets register nowhere (useRailSection does nothing outside a screen's half).
// tests/screens-rail.test.js checks that every section has an entry, the icons can be drawn and every label has its Arabic.
export const DASHBOARD_SECTIONS = Object.freeze({
  attention: { icon: 'alert', label: () => t('Needs attention now') },
  overview: { icon: 'monitor', label: () => t('Overview') },
  workload: { icon: 'inbox', label: () => t('Workload and ageing') },
  sla: { icon: 'clock', label: () => t('SLA risk radar') },
  quality: { icon: 'checkCircle', label: () => t('Quality and trend') },
  fulfilment: { icon: 'clipboard', label: () => t('Request fulfilment') },
  handover: { icon: 'arrowRight', label: () => t('Shift handover') },
  insights: { icon: 'help', label: () => t('Explain this dashboard') },
  coaching: { icon: 'users', label: () => t('Coaching snapshot (opt-in)') },
  builder: { icon: 'file', label: () => t('Custom report') },
});

/**
 * The rail entry ({ id, label, icon }) of one widget of a dashboard, or null for one the dashboard does not draw (an unknown section).
 * `result`: what the widget loaded, if anything: a custom report's heading is the title its result carries (BuilderView.jsx draws the
 * same: that title, else the person's own, else "Custom report"). Pure.
 */
export function widgetRail(widget, result = null) {
  if (!widget?.id) return null;
  if (widget.type === 'builder') {
    return { id: widget.id, label: shown(result?.title) || widget.builder?.title || DASHBOARD_SECTIONS.builder.label(), icon: DASHBOARD_SECTIONS.builder.icon };
  }
  const entry = widget.type === 'section' && Object.hasOwn(DASHBOARD_SECTIONS, widget.section) && widget.section !== 'builder' ? DASHBOARD_SECTIONS[widget.section] : null;
  return entry ? { id: widget.id, label: entry.label(), icon: entry.icon } : null;
}
