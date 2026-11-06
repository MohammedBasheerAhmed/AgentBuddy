// What tests/manifest.test.js did not pin yet (security audit 2, AB2-10): the manifest keys that would widen what the extension may
// do, or expose to web pages, without touching `permissions`. A failure here is a decision for the security reviewers, not a typo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

// Keys that add pages, frames, network rules, identities or handlers.
const WIDENING_KEYS = ['sandbox', 'chrome_url_overrides', 'devtools_page', 'oauth2', 'declarative_net_request', 'file_browser_handlers', 'file_system_provider_capabilities', 'input_components', 'protocol_handlers', 'tts_engine', 'chrome_settings_overrides', 'nacl_modules', 'externally_connectable', 'web_accessible_resources', 'content_scripts', 'host_permissions', 'cross_origin_embedder_policy', 'cross_origin_opener_policy'];

test('no optional (non-host) permissions: a feature cannot ask for "tabs", "downloads" and the like later at run time', () => {
  assert.equal(manifest.optional_permissions, undefined);
});

test('no key that adds pages, frames, network rules, identities or handlers', () => {
  for (const key of WIDENING_KEYS) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.deepEqual(Object.keys(manifest.content_security_policy), ['extension_pages'], 'no sandbox CSP');
});

test('the extension pages may connect only to https and to this computer: no ws:, no plain http elsewhere, no wildcard', () => {
  const csp = manifest.content_security_policy.extension_pages;
  const connect = (/connect-src([^;]*)/.exec(csp) || [])[1].trim().split(/\s+/);
  assert.deepEqual(connect.sort(), ['http://127.0.0.1:*', 'http://localhost:*', 'https:'].sort());
  for (const directive of ['object-src', 'frame-src', 'worker-src', 'child-src', 'media-src', 'manifest-src']) {
    assert.ok(!new RegExp(`${directive}\\s+[^;']`).test(csp), `${directive} only through default-src 'none'`);
  }
  assert.match(csp, /form-action 'none'/);
});

test('the browser floor stays at a version with the APIs the safety checks rely on (sidePanel.open, IntersectionObserver v2)', () => {
  assert.ok(Number(manifest.minimum_chrome_version) >= 116, manifest.minimum_chrome_version);
});

test('the service worker is the only background context, and it is the bundled file', () => {
  assert.deepEqual(Object.keys(manifest.background).sort(), ['service_worker']);
  assert.equal(manifest.background.service_worker, 'background.bundle.js');
});

// ---- the Firefox build's manifest (scripts/lib/browsers.js) adds no surface either --------------------------------------------------

const { browserManifest } = require('../scripts/lib/browsers.js');
const firefox = browserManifest(manifest, 'firefox');

test('Firefox: no optional permissions, no key that widens what the add-on may do (Firefox\'s own included)', () => {
  assert.equal(firefox.optional_permissions, undefined);
  for (const key of [...WIDENING_KEYS, 'user_scripts', 'experiment_apis', 'theme_experiment', 'omnibox', 'page_action', 'chrome_settings_overrides']) assert.equal(firefox[key], undefined, key);
  assert.deepEqual(firefox.content_security_policy, manifest.content_security_policy, 'the same CSP, no sandbox one');
});

test('Firefox: the floor is 128 (MAIN-world scripting for the page bridge), the add-on id is fixed, and nothing else is set for Gecko', () => {
  assert.deepEqual(Object.keys(firefox.browser_specific_settings), ['gecko']);
  assert.deepEqual(Object.keys(firefox.browser_specific_settings.gecko).sort(), ['id', 'strict_min_version']);
  assert.ok(Number.parseFloat(firefox.browser_specific_settings.gecko.strict_min_version) >= 128);
  assert.equal(firefox.minimum_chrome_version, undefined);
});

test('Firefox: one background script, the bundled file, and the side panel page as the sidebar', () => {
  assert.deepEqual(firefox.background, { scripts: ['background.bundle.js'] });
  assert.equal(firefox.side_panel, undefined);
  assert.equal(firefox.sidebar_action.default_panel, manifest.side_panel.default_path);
  assert.equal(firefox.sidebar_action.open_at_install, false);
});
