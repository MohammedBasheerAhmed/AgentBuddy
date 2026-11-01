const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A snapshot of everything the security team approves. If this test fails because a permission or host was ADDED, that is
// a deliberate decision: update the snapshot, the permission justification in docs/security.md, and tell the reviewers.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

test('permissions are exactly the approved list', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'sidePanel', 'storage']);
});

test('no static host access: every host is optional and granted by the person', () => {
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual([...manifest.optional_host_permissions].sort(), ['http://127.0.0.1/*', 'http://localhost/*', 'https://*/*']);
});

test('nothing is injected statically and nothing is exposed to web pages', () => {
  assert.equal(manifest.content_scripts, undefined, 'content scripts are registered at run time, only on enabled instances');
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
});

test('the only commands are the three keyboard shortcuts (open the panel, summarise, draft a reply): keys are a suggestion the person can change, and a command adds no permission', () => {
  assert.deepEqual(Object.keys(manifest.commands).sort(), ['open-panel', 'reply', 'summarise']);
  assert.ok(!Object.keys(manifest.commands).some((c) => c.startsWith('_')), 'no built-in command such as _execute_action');
});

test('no permission that reads browsing data or intercepts traffic', () => {
  const banned = ['tabs', 'history', 'cookies', 'webRequest', 'webRequestBlocking', 'debugger', 'declarativeNetRequest', 'downloads', 'clipboardRead', 'nativeMessaging', 'management', 'bookmarks', 'topSites', 'identity'];
  banned.forEach((p) => assert.ok(!manifest.permissions.includes(p), p));
});

test('extension-page CSP is locked down', () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!/unsafe-eval|unsafe-inline|wasm-unsafe-eval/.test(csp), 'no eval or inline script');
  assert.ok(!/script-src[^;]*https?:/.test(csp), 'no remote scripts');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /img-src 'self' data:/);
});

test('the normal build connects only to https, or to a model on this computer; the enterprise build narrows it (tests/policy-enterprise.test.js)', () => {
  const csp = manifest.content_security_policy.extension_pages;
  const connect = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
  assert.equal(connect, 'connect-src https: http://localhost:* http://127.0.0.1:*');
  assert.equal(manifest.content_security_policy.sandbox, undefined);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /style-src 'self'(;|$)/);
});

test('the repository manifest is the normal build: no update address, no fixed key, no version name, no static hosts', () => {
  for (const key of ['update_url', 'key', 'version_name', 'host_permissions', 'content_scripts', 'oauth2', 'chrome_url_overrides', 'devtools_page', 'declarative_net_request']) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.equal(manifest.manifest_version, 3);
});

test('managed policy schema is declared and valid JSON', () => {
  assert.equal(manifest.storage.managed_schema, 'managed_schema.json');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'managed_schema.json'), 'utf8'));
  ['allowedInstances', 'piiMode', 'previewMode', 'keyStorage', 'disabledFeatures', 'blockedTables', 'allowHrContent'].forEach((k) => assert.ok(schema.properties[k], k));
});
