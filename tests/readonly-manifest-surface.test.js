// What tests/manifest.test.js did not pin yet (security audit 2, AB2-10): the manifest keys that would widen what the extension may
// do, or expose to web pages, without touching `permissions`. A failure here is a decision for the security reviewers, not a typo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

test('no optional (non-host) permissions: a feature cannot ask for "tabs", "downloads" and the like later at run time', () => {
  assert.equal(manifest.optional_permissions, undefined);
});

test('no key that adds pages, frames, network rules, identities or handlers', () => {
  for (const key of ['sandbox', 'chrome_url_overrides', 'devtools_page', 'oauth2', 'declarative_net_request', 'file_browser_handlers', 'file_system_provider_capabilities', 'input_components', 'protocol_handlers', 'tts_engine', 'chrome_settings_overrides', 'nacl_modules', 'externally_connectable', 'web_accessible_resources', 'content_scripts', 'host_permissions', 'cross_origin_embedder_policy', 'cross_origin_opener_policy']) {
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
