// The dashboard layout file: what the Team screen's "Save layout as a file" writes for one dashboard, and what an organisation puts in
// its policy as its own dashboard for everyone (policy key `defaultDashboard`, N17):
//
//   { "kind": "agentbuddy-dashboard-layout", "version": 1, "dashboard": { "name", "scope", "tables", "widgets" } }
//
// Only the envelope is checked here, and this file imports nothing, so the policy reader (src/policy/policy.js, which the service
// worker and the content script load too) can check a policy value without carrying the reports engine. The dashboard inside is
// cleaned by src/reports/dashboards.js (sanitizeDashboard), exactly like a file a person loads.

export const LAYOUT_KIND = 'agentbuddy-dashboard-layout';
export const LAYOUT_VERSION = 1;
/** The longest layout, as JSON text: a file a person loads, or the organisation's dashboard written out. */
export const LAYOUT_MAX_CHARS = 60000;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * What is wrong with a parsed layout's envelope: '' (nothing), 'newer' (saved by a newer version of Agent Buddy) or 'not-layout'
 * (anything else: another kind of file, another version, no dashboard object).
 */
export function layoutEnvelopeProblem(parsed) {
  if (!isPlainObject(parsed) || parsed.kind !== LAYOUT_KIND) return 'not-layout';
  if (Number(parsed.version) > LAYOUT_VERSION) return 'newer';
  if (Number(parsed.version) !== LAYOUT_VERSION || !isPlainObject(parsed.dashboard)) return 'not-layout';
  return '';
}
