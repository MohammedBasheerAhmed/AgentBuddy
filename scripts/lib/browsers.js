// The browsers Agent Buddy is built for: one source, one build per browser family, each in its own folder.
//
//   chromium   Chrome and Edge: manifest.json as it is, the bundles compiled for Chrome and Edge 116.     dist/
//   firefox    Firefox 128 and later: the same bundles compiled for Firefox 128, and a manifest made from   dist-firefox/
//              manifest.json by firefoxManifest() below.
//
// build.js (the folders and the manifest), scripts/lib/entries.js (the esbuild target), scripts/check-compile.js, scripts/repro-check.js
// and scripts/package.js (the release zips) all read this table, so another browser family is one entry here plus, when its manifest
// differs, one function like firefoxManifest(). Pure: nothing is read or written here (tests/manifest-firefox.test.js).

/**
 * The Firefox add-on id (browser_specific_settings.gecko.id). Firefox knows the add-on by it: the same id keeps the person's settings
 * and receives the updates, and addons.mozilla.org ties the listing to it, so it never changes once published. A branded copy sets its
 * own here (or passes { geckoId } to browserManifest).
 */
const GECKO_ID = 'agentbuddy@agentbuddy';

/**
 * The oldest Firefox the build supports (browser_specific_settings.gecko.strict_min_version). 128 is the first that runs scripts in the
 * page's MAIN world through the scripting API, which the page bridge needs, and the first with optional_host_permissions.
 */
const FIREFOX_MIN_VERSION = '128.0';

/**
 * Each browser family: its esbuild target and its folders (relative to the project folder, forward slashes). A build only ever goes into
 * its own browser's folders (build.js refuses the others): out for the normal build, enterpriseOut for `--enterprise`, releaseOut for the
 * minified release that scripts/package.js builds.
 */
const BROWSERS = Object.freeze({
  chromium: Object.freeze({
    id: 'chromium',
    name: 'Chrome and Edge',
    target: Object.freeze(['chrome116', 'edge116']),
    out: 'dist',
    enterpriseOut: 'dist-enterprise',
    releaseOut: 'release/unpacked',
  }),
  firefox: Object.freeze({
    id: 'firefox',
    name: 'Firefox',
    target: Object.freeze(['firefox128']),
    out: 'dist-firefox',
    enterpriseOut: 'dist-firefox-enterprise',
    releaseOut: 'release/unpacked-firefox',
  }),
});

const BROWSER_IDS = Object.freeze(Object.keys(BROWSERS));

/** The table entry of a browser id; an id that is not in the table throws, naming the ones that are. */
function browserOf(id) {
  if (!Object.prototype.hasOwnProperty.call(BROWSERS, id)) throw new Error(`unknown browser "${id}". Browsers: ${BROWSER_IDS.join(', ')}.`);
  return BROWSERS[id];
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * The Firefox manifest from the Chrome one. Only what Firefox needs changes; everything else (the CSP, the permissions, the optional
 * hosts, the commands, the settings page, the icons, storage.managed_schema) is kept as it is:
 *   - background.service_worker becomes background.scripts: Firefox runs the background as an event page, not a service worker;
 *   - side_panel becomes sidebar_action (the same page, with the toolbar button's title and icons), and the sidePanel permission goes;
 *   - minimum_chrome_version goes, and browser_specific_settings.gecko names the add-on id and the oldest Firefox;
 *   - an update_url (an enterprise build with updateUrl) moves to browser_specific_settings.gecko.update_url, where Firefox reads it.
 * storage.managed_schema stays: Firefox does not know the key and loads the add-on with a warning (it reads a managed policy from
 * the enterprise policies instead, without a schema).
 * @param {object} base the manifest for Chrome and Edge (manifest.json, or the enterprise manifest made from it); it is not changed
 * @param {{ geckoId?: string }} [options]
 */
function firefoxManifest(base, { geckoId = GECKO_ID } = {}) {
  if (!base || !base.background || typeof base.background.service_worker !== 'string') {
    throw new Error('The manifest has no background.service_worker to run as the Firefox background script.');
  }
  const action = base.action || {};
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === 'minimum_chrome_version' || key === 'update_url' || key === 'browser_specific_settings') continue;
    if (key === 'background') {
      const { service_worker: worker, ...rest } = value;
      out.background = { scripts: [worker], ...clone(rest) };
    } else if (key === 'side_panel') {
      out.sidebar_action = { default_panel: value.default_path };
      if (action.default_title !== undefined) out.sidebar_action.default_title = action.default_title;
      if (action.default_icon !== undefined) out.sidebar_action.default_icon = clone(action.default_icon);
      out.sidebar_action.open_at_install = false; // opened by the toolbar button or the shortcut, like the side panel in Chrome
    } else if (key === 'permissions') {
      out.permissions = value.filter((p) => p !== 'sidePanel');
    } else out[key] = clone(value);
  }
  const given = base.browser_specific_settings ? clone(base.browser_specific_settings) : {};
  const gecko = { ...(given.gecko || {}), id: geckoId, strict_min_version: FIREFOX_MIN_VERSION };
  if (base.update_url) gecko.update_url = base.update_url;
  out.browser_specific_settings = { ...given, gecko };
  return out;
}

/**
 * The manifest of one browser's build, from manifest.json (or the enterprise manifest made from it). Chrome and Edge get it unchanged
 * (a copy); the input is never changed.
 * @param {object} base
 * @param {string} browser an id of BROWSERS
 * @param {{ geckoId?: string }} [options] Firefox only
 */
function browserManifest(base, browser, options = {}) {
  const { id } = browserOf(browser);
  return id === 'firefox' ? firefoxManifest(base, options) : clone(base);
}

/** Which browser a built manifest is for: a Firefox build names its gecko id, a Chrome and Edge build does not. */
function browserOfManifest(manifest) {
  return manifest && manifest.browser_specific_settings && manifest.browser_specific_settings.gecko ? 'firefox' : 'chromium';
}

module.exports = { GECKO_ID, FIREFOX_MIN_VERSION, BROWSERS, BROWSER_IDS, browserOf, browserManifest, firefoxManifest, browserOfManifest };
