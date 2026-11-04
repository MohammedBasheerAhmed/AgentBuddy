// Which sections a dashboard draws, so one number is said once on it. Kept apart from dashboardEnv.js (which knows the section
// registry, and so every view) so the views can use it without an import cycle. Pure.

/** The ready-made sections a dashboard draws, once each, in order (the dashboard passes them to its widgets as env.sections). */
export function drawnSections(widgets) {
  return [...new Set((Array.isArray(widgets) ? widgets : []).filter((w) => w?.type === 'section' && typeof w.section === 'string').map((w) => w.section))];
}

/**
 * Whether another section of the same dashboard already shows a number: Overview's open, unassigned, untouched, resolved-not-closed
 * and SLA counts are not drawn again by Workload and the SLA radar when Overview is on the dashboard too. Only what is drawn changes;
 * every result keeps its numbers, so the export and "Explain this dashboard" get them as before.
 */
export const shownElsewhere = (env, section) => Array.isArray(env?.sections) && env.sections.includes(section);
