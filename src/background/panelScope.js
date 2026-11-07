// Where the panel may show: only on the ServiceNow sites the person added (Settings > ServiceNow sites, a granted browser permission, or
// a site the organisation lists). On every other page the panel is switched off for that tab, so it takes no width there. Pure: the
// worker (panelScopeWire.js) passes in the tab and the active sites, so every rule is unit-tested (tests/panel-scope-rules.test.js)
// without chrome.*.
//
// "An added site" is an ORIGIN: https, the exact host, the port as written (the same rule as instancePattern in src/policy/policy.js).
// The portals of the site are pages of the same origin, so they count too. Without the `tabs` permission the browser shows a tab's
// address only for the sites the extension has access to (the added ones) and, for a moment after a click on the toolbar button, the
// tab that was clicked (activeTab). A tab whose address is not visible is "not an added site": that is correct and intended.
import { normalizeInstance } from '../policy/policy.js';

// ServiceNow's own hosting: commercial (service-now.com) and the government cloud (servicenowservices.com). A site on its own web
// address is not recognised by its name; the person adds it in Settings.
const SERVICENOW_SUFFIXES = Object.freeze(['.service-now.com', '.servicenowservices.com']);

// The address as an https URL with no user name or password, or null (not an address, another scheme, "https://x@y").
function httpsUrl(url) {
  if (typeof url !== 'string' || !url || url.length > 4096) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  return parsed;
}

/**
 * The origin of an https address in the form instances are kept in ('https://acme.service-now.com', 'https://localhost:8443': lower
 * case, the default port dropped), or '' for anything else: no address, http, chrome:, file:, an extension page, a host that could not
 * be an instance.
 * @param {string} url
 */
export function siteOrigin(url) {
  const parsed = httpsUrl(url);
  return parsed ? normalizeInstance(parsed.origin) : '';
}

/**
 * Is this address a page of one of the active sites (the sites that are turned on and that the browser granted)? Exact origin: a
 * look-alike ('https://acme.service-now.com.evil.example'), another port, a sub-domain and plain http are all other sites.
 * @param {string|undefined} url the tab's address (undefined when the browser does not show it)
 * @param {string[]} activeOrigins canonical origins (activeInstances() in the worker)
 */
export function isAddedSite(url, activeOrigins) {
  const origin = siteOrigin(url);
  if (!origin || !Array.isArray(activeOrigins)) return false;
  return activeOrigins.some((o) => typeof o === 'string' && normalizeInstance(o) === origin);
}

/**
 * Does the address look like a ServiceNow site (host ends with .service-now.com or .servicenowservices.com), added or not? Used only
 * to let a click on the toolbar button open the panel on a ServiceNow page that is not added yet, so "Turn on for this site" can be
 * used. It never decides where the panel stays.
 * @param {string|undefined} url
 */
export function looksLikeServiceNow(url) {
  const parsed = httpsUrl(url);
  if (!parsed || !normalizeInstance(parsed.origin)) return false;
  const host = parsed.hostname; // (lower case; an international name in its xn-- form)
  return SERVICENOW_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix));
}

/**
 * What the panel does on this tab. `kind`: 'added' (a page of an active site: the panel is on), 'servicenow' (looks like ServiceNow,
 * not added: off, but a click on the toolbar button turns it on for the click), 'other' (any other page), 'unseen' (the browser does
 * not show the tab's address: it is not one of the added sites).
 * @param {{ url?: string }|undefined} tab
 * @param {string[]} activeOrigins
 * @returns {{ enabled: boolean, kind: 'added'|'servicenow'|'other'|'unseen' }}
 */
export function scopeFor(tab, activeOrigins) {
  const url = tab?.url;
  if (typeof url !== 'string' || !url) return { enabled: false, kind: 'unseen' };
  if (isAddedSite(url, activeOrigins)) return { enabled: true, kind: 'added' };
  return { enabled: false, kind: looksLikeServiceNow(url) ? 'servicenow' : 'other' };
}

/**
 * What a click on the toolbar button, or a keyboard shortcut, asks of the browser before anything is awaited (the browser opens a
 * panel only while the click is being handled, and that ends at the first await). A page that looks like ServiceNow: switch the panel
 * on for this tab and open it (an added site has it on already, so this changes nothing there; a site that is not added gets the
 * panel with "Turn on for this site"). Any other page: only open; the browser refuses when the panel is off for the tab.
 * @param {{ url?: string }|undefined} tab the tab as the browser hands it over with the click or key press
 * @returns {{ enable: boolean }}
 */
export function clickPlan(tab) {
  return { enable: looksLikeServiceNow(tab?.url) };
}

/**
 * The panel could not be opened for a click. 'settings': the page is not ServiceNow and not an added site, so take the person to
 * Settings > ServiceNow sites to add one. 'nothing': an added site (the refusal has another cause: the panel does not open from a
 * click that is already over) or a ServiceNow page that was switched on for the click; do not take the person anywhere.
 * @param {{ url?: string }|undefined} tab
 * @param {string[]} activeOrigins
 * @returns {'settings'|'nothing'}
 */
export function afterRefusal(tab, activeOrigins) {
  if (looksLikeServiceNow(tab?.url) || isAddedSite(tab?.url, activeOrigins)) return 'nothing';
  return 'settings';
}

/**
 * Can a storage change (`changes` of area `areaName`) change which sites are active? The organisation's policy: any change. The
 * person's settings: only when the list of sites changed (typing in another box must not touch every tab).
 * @param {object} changes what the browser's storage-changed event passes (key -> { oldValue, newValue })
 * @param {string} areaName
 * @param {string} settingsKey the key the settings are kept under
 */
export function scopeChangeMatters(changes, areaName, settingsKey) {
  if (areaName === 'managed') return true;
  if (areaName !== 'local') return false;
  const change = changes && typeof changes === 'object' ? changes[settingsKey] : null;
  if (!change) return false;
  const list = (value) => JSON.stringify(Array.isArray(value?.instances) ? value.instances : []);
  return list(change.oldValue) !== list(change.newValue);
}

/** Does the browser's tab-changed event matter? A new address or a new load state; the title, the sound and the icon do not. */
export function tabChangeMatters(changeInfo) {
  return Boolean(changeInfo) && (changeInfo.url !== undefined || changeInfo.status !== undefined);
}
