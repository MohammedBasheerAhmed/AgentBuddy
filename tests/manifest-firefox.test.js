// The Firefox build (scripts/lib/browsers.js): its manifest is manifest.json with exactly the changes Firefox needs and nothing that
// widens what the extension may do; each browser compiles for its own floor; build.js writes the Firefox build into its own folder, with
// the same pages, styles, icons and licences as the Chrome and Edge build, and never into another browser's folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enterpriseManifest, validateEnterpriseConfig } from '../src/policy/enterprise.js';
const { BROWSERS, BROWSER_IDS, GECKO_ID, FIREFOX_MIN_VERSION, browserOf, browserManifest, browserOfManifest } = require('../scripts/lib/browsers.js');
const { bundleOptions } = require('../scripts/lib/entries.js');
const { hashFolder } = require('../scripts/lib/hashes.js');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const firefox = browserManifest(manifest, 'firefox');

// ---- the manifest ---------------------------------------------------------------------------------------------------------------------

test('the Firefox manifest is manifest.json with exactly the Firefox changes, and nothing else', () => {
  const { background, sidebar_action: sidebar, permissions, browser_specific_settings: settings, ...restF } = firefox;
  const { background: worker, side_panel: panel, permissions: chromePermissions, minimum_chrome_version: floor, ...restC } = manifest;
  // Everything else is the same, key for key: CSP, optional hosts, commands, settings page, icons, managed storage schema, action...
  assert.deepEqual(restF, restC);
  assert.deepEqual(Object.keys(restF), Object.keys(restC), 'in the same order');
  // ...and the changes are only these.
  assert.deepEqual(background, { scripts: [worker.service_worker] });
  assert.deepEqual(background, { scripts: ['background.bundle.js'] });
  assert.deepEqual(sidebar, { default_panel: panel.default_path, default_title: manifest.action.default_title, default_icon: manifest.action.default_icon, open_at_install: false });
  assert.equal(sidebar.default_panel, 'sidepanel.html');
  assert.deepEqual(permissions, chromePermissions.filter((p) => p !== 'sidePanel'));
  assert.deepEqual(settings, { gecko: { id: 'agentbuddy@agentbuddy', strict_min_version: '128.0' } });
  assert.ok(floor, 'manifest.json has a Chrome floor; the Firefox manifest has none');
  for (const key of ['side_panel', 'minimum_chrome_version', 'update_url']) assert.equal(firefox[key], undefined, key);
  const added = Object.keys(firefox).filter((k) => !(k in manifest)).sort();
  const removed = Object.keys(manifest).filter((k) => !(k in firefox)).sort();
  assert.deepEqual(added, ['browser_specific_settings', 'sidebar_action']);
  assert.deepEqual(removed, ['minimum_chrome_version', 'side_panel']);
});

test('the Firefox manifest widens nothing: the same CSP, the same permissions minus sidePanel, no host it did not ask for before', () => {
  assert.equal(firefox.content_security_policy.extension_pages, manifest.content_security_policy.extension_pages);
  assert.deepEqual(firefox.content_security_policy, manifest.content_security_policy);
  assert.deepEqual([...firefox.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  assert.ok(firefox.permissions.every((p) => manifest.permissions.includes(p)), 'no new permission');
  assert.equal(firefox.host_permissions, undefined, 'no static host access');
  assert.deepEqual(firefox.optional_host_permissions, manifest.optional_host_permissions);
  assert.equal(firefox.optional_permissions, undefined);
  for (const key of ['content_scripts', 'web_accessible_resources', 'externally_connectable', 'key', 'update_url']) assert.equal(firefox[key], undefined, key);
  assert.deepEqual(firefox.commands, manifest.commands);
  assert.deepEqual(firefox.storage, { managed_schema: 'managed_schema.json' }, 'kept: Firefox loads the add-on with a warning for this key');
});

test('Chrome and Edge get manifest.json unchanged, and the input is never changed', () => {
  const before = JSON.stringify(manifest);
  assert.deepEqual(browserManifest(manifest, 'chromium'), manifest);
  assert.notEqual(browserManifest(manifest, 'chromium'), manifest, 'a copy');
  browserManifest(manifest, 'firefox');
  assert.equal(JSON.stringify(manifest), before);
  firefox.permissions.push('tabs');
  assert.ok(!manifest.permissions.includes('tabs'), 'the Firefox manifest shares nothing with its input');
  firefox.permissions.pop();
});

test('the gecko id lives in one place (scripts/lib/browsers.js) and a branded copy can set its own', () => {
  assert.equal(GECKO_ID, 'agentbuddy@agentbuddy');
  assert.match(GECKO_ID, /^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/, 'the form Firefox accepts');
  const branded = browserManifest(manifest, 'firefox', { geckoId: 'buddy@brand.example' });
  assert.deepEqual(branded.browser_specific_settings, { gecko: { id: 'buddy@brand.example', strict_min_version: FIREFOX_MIN_VERSION } });
});

test('Firefox 128 is the floor: the first with MAIN-world scripting (the page bridge) and optional_host_permissions', () => {
  assert.ok(Number.parseFloat(firefox.browser_specific_settings.gecko.strict_min_version) >= 128);
  assert.deepEqual(BROWSERS.firefox.target, ['firefox128']);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, `${BROWSERS.firefox.target[0].replace('firefox', '')}.0`, 'the manifest and the esbuild target say the same version');
});

test('the enterprise changes apply to the Firefox manifest too, the update address where Firefox reads it', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'enterprise', 'example.json'), 'utf8'));
  const { plan } = validateEnterpriseConfig({ ...example, updateUrl: 'https://ext.example.com/agentbuddy/updates.json' });
  const chrome = enterpriseManifest(manifest, plan);
  const m = browserManifest(chrome, 'firefox');
  assert.deepEqual(m.host_permissions, plan.hostPermissions);
  assert.equal(m.optional_host_permissions, undefined);
  assert.equal(m.content_security_policy.extension_pages, chrome.content_security_policy.extension_pages);
  assert.match(m.content_security_policy.extension_pages, /connect-src https:\/\/ai-gateway\.example\.com;/);
  assert.equal(m.version_name, '0.1.0 Example Corp');
  assert.equal(m.update_url, undefined, 'not at the top: Firefox does not read it there');
  assert.deepEqual(m.browser_specific_settings, { gecko: { id: GECKO_ID, strict_min_version: FIREFOX_MIN_VERSION, update_url: 'https://ext.example.com/agentbuddy/updates.json' } });
  // Apart from the enterprise keys it is the normal Firefox manifest.
  const { host_permissions: hp, version_name: vn, content_security_policy: c1, browser_specific_settings: s1, ...restE } = m;
  const { optional_host_permissions: ohp, content_security_policy: c2, browser_specific_settings: s2, ...restN } = firefox;
  assert.deepEqual(restE, restN);
  // Without updateUrl there is no update address at all.
  assert.equal(browserManifest(enterpriseManifest(manifest, validateEnterpriseConfig(example).plan), 'firefox').browser_specific_settings.gecko.update_url, undefined);
});

test('which browser a built manifest is for', () => {
  assert.equal(browserOfManifest(manifest), 'chromium');
  assert.equal(browserOfManifest(firefox), 'firefox');
  assert.equal(browserOfManifest(enterpriseManifest(manifest, validateEnterpriseConfig({ allowedInstances: ['https://acme.service-now.com'], aiProvider: 'openai' }).plan)), 'chromium');
});

// ---- the table and the compile target ------------------------------------------------------------------------------------------------

test('each browser compiles for its own floor; Chrome and Edge as before', () => {
  assert.deepEqual(BROWSER_IDS, ['chromium', 'firefox']);
  assert.deepEqual(bundleOptions(ROOT).target, ['chrome116', 'edge116'], 'the default is Chrome and Edge');
  assert.deepEqual(bundleOptions(ROOT, 'chromium').target, ['chrome116', 'edge116']);
  assert.deepEqual(bundleOptions(ROOT, 'firefox').target, ['firefox128']);
  const { target: t1, ...chromeRest } = bundleOptions(ROOT, 'chromium');
  const { target: t2, ...firefoxRest } = bundleOptions(ROOT, 'firefox');
  assert.deepEqual(Object.keys(chromeRest), Object.keys(firefoxRest), 'only the target differs');
  assert.deepEqual({ ...chromeRest, plugins: chromeRest.plugins.length }, { ...firefoxRest, plugins: firefoxRest.plugins.length });
});

test('an unknown browser is refused everywhere', () => {
  assert.throws(() => browserOf('safari'), /unknown browser "safari"\. Browsers: chromium, firefox\./);
  assert.throws(() => browserManifest(manifest, 'safari'), /unknown browser/);
  assert.throws(() => bundleOptions(ROOT, 'edge'), /unknown browser/);
  assert.throws(() => browserOf('toString'), /unknown browser/, 'not a property of every object');
  assert.throws(() => browserManifest({ ...manifest, background: {} }, 'firefox'), /no background\.service_worker/);
});

test('every browser has its own folders, and no two share one', () => {
  const folders = Object.values(BROWSERS).flatMap((b) => [b.out, b.enterpriseOut, b.releaseOut]);
  assert.equal(new Set(folders).size, folders.length);
  assert.deepEqual([BROWSERS.chromium.out, BROWSERS.chromium.enterpriseOut, BROWSERS.chromium.releaseOut], ['dist', 'dist-enterprise', 'release/unpacked'], 'as they always were');
  assert.deepEqual([BROWSERS.firefox.out, BROWSERS.firefox.enterpriseOut, BROWSERS.firefox.releaseOut], ['dist-firefox', 'dist-firefox-enterprise', 'release/unpacked-firefox']);
  const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const b of Object.values(BROWSERS)) for (const f of [b.out, b.enterpriseOut]) assert.ok(ignored.includes(`${f}/`), `${f}/ is in .gitignore`);
});

// ---- the build itself ------------------------------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-firefox-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const build = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'build.js'), ...args], { cwd: ROOT, encoding: 'utf8' });

test('node build.js --browser firefox writes the Firefox manifest and the same pages, styles, icons and licences as the Chrome build', () => {
  const chrome = path.join(tmp, 'chrome');
  const fx = path.join(tmp, 'firefox');
  const r1 = build('--out', chrome);
  assert.equal(r1.status, 0, r1.stderr + r1.stdout);
  const r2 = build('--browser', 'firefox', '--out', fx);
  assert.equal(r2.status, 0, r2.stderr + r2.stdout);
  assert.match(r2.stdout, /about:debugging/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fx, 'manifest.json'), 'utf8')), browserManifest(manifest, 'firefox'));
  assert.equal(fs.readFileSync(path.join(chrome, 'manifest.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8').replace(/\r\n/g, '\n'), 'the Chrome build copies manifest.json as it is');
  const bundles = /(\.bundle\.js|^pagebridge\.js)$/;
  const [a, b] = [hashFolder(chrome), hashFolder(fx)];
  assert.deepEqual(b.map((f) => f.path), a.map((f) => f.path), 'the same files');
  const statics = (rows) => rows.filter((f) => f.path !== 'manifest.json' && !bundles.test(f.path)).map((f) => `${f.sha256} ${f.path}`);
  assert.ok(statics(a).length >= 8, 'html, css, icons, schema, licences');
  assert.deepEqual(statics(b), statics(a), 'every file but the manifest and the bundles is byte for byte the same');
});

test('a build never goes into another browser\'s folder, and nothing is touched when it is refused', () => {
  const marker = (rel) => fs.existsSync(path.join(ROOT, ...rel.split('/'), 'manifest.json'));
  const before = ['dist', 'dist-firefox', 'release/unpacked'].map(marker);
  const cases = [
    [['--browser', 'firefox', '--out', 'dist'], /dist\/ is where the Chrome and Edge build goes, not the Firefox one/],
    [['--browser=firefox', '--out', 'DIST'], /where the Chrome and Edge build goes/],
    [['--browser', 'firefox', '--out', 'dist-enterprise'], /where the Chrome and Edge build goes/],
    [['--browser', 'firefox', '--out', 'release/unpacked'], /where the Chrome and Edge build goes/],
    [['--browser', 'firefox', '--out', 'dist/inner'], /where the Chrome and Edge build goes/],
    [['--out', 'dist-firefox'], /dist-firefox\/ is where the Firefox build goes, not the Chrome and Edge one/],
    [['--browser', 'chromium', '--out', 'dist-firefox-enterprise'], /where the Firefox build goes/],
    [['--out', 'release/unpacked-firefox'], /where the Firefox build goes/],
    [['--browser', 'firefox', '--enterprise', 'enterprise/example.json', '--out', 'dist-firefox'], /never goes into dist-firefox\//],
    [['--browser', 'firefox', '--out', 'src'], /cannot be inside src/],
    [['--browser', 'safari'], /--browser must be one of chromium, firefox \(got "safari"\)/],
    [['--browser'], /--browser needs a value/],
    [['--browser', '--minify'], /--browser needs a value/],
  ];
  for (const [args, re] of cases) {
    const r = build(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
  }
  assert.deepEqual(['dist', 'dist-firefox', 'release/unpacked'].map(marker), before, 'no build folder was emptied');
  assert.ok(!fs.existsSync(path.join(ROOT, 'dist', 'inner')));
});
