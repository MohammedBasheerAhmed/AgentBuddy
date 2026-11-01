// Which parts of the panel exist, which one shows, and what they are given: App's routing as a pure function, so the rules that
// keep a person's typed text alive (tests/panel-sections.test.js) are tested without a browser.
//
// The rules:
//   - A section the person has opened ("visited") stays mounted, hidden when another one shows, so what was typed or found in it
//     survives. It is never removed because the active tab stopped being a ServiceNow page or is reloading.
//   - While the active tab is not an enabled ServiceNow page the sections keep the last page that did answer (lastGood) and a
//     one-line banner says so. the Ticket screen shows the setup help for the tab that is open now.
//   - With no page at all to work on (the very first look, or the last ServiceNow tab was closed) there is no section bar: only
//     the setup help shows. Visited sections stay mounted (hidden) on the last page seen, so a new ServiceNow tab picks them up.

import { isEnabledPage } from './pageState.js';
import { tm, t as tr } from '../i18n/index.js';

// What the sections work on meanwhile is said too: an Insert from a section goes to that last ServiceNow tab, not to the one on show.
export const BANNER_NOT_SERVICENOW = tm('This tab is not a ServiceNow page. Agent Buddy keeps working with your last ServiceNow tab.');
export const BANNER_NOT_ON = tm('Agent Buddy is not turned on for this tab. It keeps working with your last ServiceNow tab.');

/**
 * @param {{ ids: string[], active: string, visited: Set<string>, page: object, lastGood: object|null, lastSeen: object|null }} input
 *   ids: the screen ids ('ticket' is the one about the open tab). active: the chosen one. visited: the ones opened so far.
 * @returns {{
 *   enabled: boolean,            the active tab is an enabled ServiceNow page (a held answer counts)
 *   base: object|null,           the page every section works on while it shows; null when there is none
 *   mountPage: object|null,      the page a mounted section is given (base, else the last one seen)
 *   banner: string,              one line for the top of the panel; '' when none is needed
 *   showNav: boolean,
 *   visible: string,             the id of the section on show (the section bar is hidden when there is no page to work on)
 *   recordPage: object|null,     the page the record view works on; null when no record view should exist
 *   showSetup: boolean,          the Ticket screen shows the setup help (not enabled, or an enabled page that is not a record)
 *   panes: { id: string, selected: boolean, mounted: boolean }[]
 * }}
 */
export function planPanel({ ids, active, visited, page, lastGood, lastSeen }) {
  const enabled = isEnabledPage(page);
  const base = enabled ? page : lastGood || null;
  const mountPage = base || lastSeen || null;
  const showNav = Boolean(base);
  const visible = showNav ? active : 'ticket';
  const panes = ids.map((id) => ({
    id,
    selected: id === visible,
    // The Ticket screen always has something to say when it shows (the setup help); the others need a page to work on.
    mounted: id === 'ticket' ? id === visible || visited.has(id) : Boolean(mountPage) && visited.has(id),
  }));
  const pageMounted = panes.find((p) => p.id === 'ticket')?.mounted;
  const record = page?.status === 'record' ? page : !enabled && lastGood?.status === 'record' ? lastGood : null;
  return {
    enabled,
    base,
    mountPage,
    banner: !enabled && base ? tr(page.origin ? BANNER_NOT_ON : BANNER_NOT_SERVICENOW) : '',
    showNav,
    visible,
    recordPage: pageMounted ? record : null,
    showSetup: !enabled || page.status !== 'record',
    panes,
  };
}

/** Add a section to the visited set (a new Set, so React sees the change). */
export const withVisited = (visited, id) => (visited.has(id) ? visited : new Set([...visited, id]));
