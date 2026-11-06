import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  firefox,
  firefoxInstallEntry,
  firefoxPolicyFiles,
  firefoxSampleFiles,
  firefoxUpdateManifest,
  firefoxUpdateUrlCheck,
  inspectXpi,
  readZip,
} from '../scripts/selfhost.js';

const { parseRegText, parsePlist } = require('../scripts/lib/policy-files.js');
const { zipFolder } = require('../scripts/package.js');

// The Firefox half of the self-hosted install (scripts/selfhost.js, docs/deployment.md "Firefox"): the policy files (policies.json, the
// Windows registry, a macOS profile), each with the ExtensionSettings entry that installs Agent Buddy; updates.json; the reading of a
// signed .xpi; and the two steps around the signing a person does on addons.mozilla.org.

const ROOT = path.join(__dirname, '..');
const ID = 'agentbuddy@agentbuddy';
const BASE = 'https://ext.corp.example/ab';
const recommended = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'review-pack', 'policies', 'recommended-policy.json'), 'utf8'));
// Every kind of value the policy takes, and text that needs escaping in a .reg file and in XML.
const policy = { ...recommended, aiEnabled: false, disablePageBar: true, internalPhrases: ['R&D "Blue" <team>', 'C:\\share'], orgSnippets: [{ title: 'Hi', body: 'Line 1\nLine 2' }] };

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-selfhost-firefox-'));

test('the install entry: force-installed from a fixed address, updates from updates.json, the button on the toolbar', () => {
  assert.deepEqual(firefoxInstallEntry(BASE), {
    installation_mode: 'force_installed',
    install_url: `${BASE}/agentbuddy.xpi`,
    update_url: `${BASE}/updates.json`,
    default_area: 'navbar',
  });
});

test('policies.json: the install entry under ExtensionSettings and the policy under 3rdparty, values as they are (real true and false)', () => {
  const { policies } = JSON.parse(firefoxPolicyFiles({ addonId: ID, baseUrl: BASE, policy })['firefox-policies.json']);
  assert.deepEqual(Object.keys(policies).sort(), ['3rdparty', 'ExtensionSettings']);
  assert.deepEqual(policies.ExtensionSettings, { [ID]: firefoxInstallEntry(BASE) });
  assert.deepEqual(policies['3rdparty'], { Extensions: { [ID]: policy } });
  assert.equal(policies['3rdparty'].Extensions[ID].aiEnabled, false);
});

test('the .reg file: both values are JSON text under HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox and read back exactly, with CRLF lines', () => {
  const text = firefoxPolicyFiles({ addonId: ID, baseUrl: BASE, policy })['firefox-windows.reg'];
  assert.ok(text.startsWith('Windows Registry Editor Version 5.00\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'every line ends with CRLF, as regedit expects');
  const keys = parseRegText(text);
  assert.deepEqual(Object.keys(keys).sort(), ['hkey_local_machine\\software\\policies\\mozilla\\firefox', 'hkey_local_machine\\software\\policies\\mozilla\\firefox\\3rdparty\\extensions']);
  const top = keys['hkey_local_machine\\software\\policies\\mozilla\\firefox'].values;
  assert.equal(top.ExtensionSettings.type, 'sz');
  assert.deepEqual(JSON.parse(top.ExtensionSettings.value), { [ID]: firefoxInstallEntry(BASE) });
  const ext = keys['hkey_local_machine\\software\\policies\\mozilla\\firefox\\3rdparty\\extensions'].values;
  assert.deepEqual(Object.keys(ext), [ID]);
  assert.equal(ext[ID].type, 'sz', 'no REG_DWORD: Firefox would pass true and false on as 1 and 0');
  assert.deepEqual(JSON.parse(ext[ID].value), policy, 'quotes, backslashes and new lines survive');
  assert.ok(!/dword:/i.test(text));
});

test('the macOS profile: org.mozilla.firefox in mcx_preference_settings, policies enabled, the policy one JSON string that reads back exactly', () => {
  const text = firefoxPolicyFiles({ addonId: ID, baseUrl: BASE, policy })['firefox-macos.mobileconfig'];
  const comment = /<!--([\s\S]*?)-->/.exec(text)[1];
  assert.ok(!comment.includes('--'), 'XML allows no "--" inside a comment');
  const profile = parsePlist(text);
  assert.equal(profile.PayloadType, 'Configuration');
  assert.equal(profile.PayloadContent.length, 1);
  const [payload] = profile.PayloadContent;
  assert.equal(payload.PayloadType, 'com.apple.ManagedClient.preferences');
  assert.notEqual(payload.PayloadUUID, profile.PayloadUUID);
  const settings = payload.PayloadContent['org.mozilla.firefox'].Forced[0].mcx_preference_settings;
  assert.equal(settings.EnterprisePoliciesEnabled, true, 'Firefox on macOS reads no policy without it');
  assert.deepEqual(settings.ExtensionSettings, { [ID]: firefoxInstallEntry(BASE) });
  assert.equal(typeof settings['3rdparty'].Extensions[ID], 'string', 'a string, not a dict: Firefox would pass <true/> on as 1');
  assert.deepEqual(JSON.parse(settings['3rdparty'].Extensions[ID]), policy, '& < > are escaped and read back');
});

test('an address with & is escaped in the profile and the .reg file and read back as it was', () => {
  const base = 'https://ext.corp.example/a&b';
  const files = firefoxPolicyFiles({ addonId: ID, baseUrl: base, policy: recommended });
  const settings = parsePlist(files['firefox-macos.mobileconfig']).PayloadContent[0].PayloadContent['org.mozilla.firefox'].Forced[0].mcx_preference_settings;
  assert.equal(settings.ExtensionSettings[ID].install_url, `${base}/agentbuddy.xpi`);
  const top = parseRegText(files['firefox-windows.reg'])['hkey_local_machine\\software\\policies\\mozilla\\firefox'].values;
  assert.equal(JSON.parse(top.ExtensionSettings.value)[ID].install_url, `${base}/agentbuddy.xpi`);
});

test('the samples in docs/review-pack/policies-firefox are exactly what selfhost.js makes from recommended-policy.json', () => {
  const dir = path.join(ROOT, 'docs', 'review-pack', 'policies-firefox');
  const expected = firefoxSampleFiles();
  assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(expected).sort());
  const lf = (s) => s.replace(/\r\n/g, '\n');
  for (const [name, text] of Object.entries(expected)) {
    assert.equal(lf(fs.readFileSync(path.join(dir, name), 'utf8')), lf(text), `${name} is out of date: run node scripts/selfhost.js firefox-samples`);
  }
  const { policies } = JSON.parse(expected['firefox-policies.json']);
  assert.deepEqual(policies['3rdparty'].Extensions[ID], recommended, 'the recommended policy, for the add-on id of the Firefox build');
  assert.equal(policies.ExtensionSettings[ID].install_url, 'https://extensions.corp.example/agentbuddy/agentbuddy.xpi');
});

test('updates.json names the add-on, the version, the package address, its SHA-256 and the oldest Firefox', () => {
  const sha = 'a'.repeat(64);
  const data = JSON.parse(firefoxUpdateManifest({ addonId: ID, version: '1.2.3', xpiUrl: `${BASE}/agentbuddy-1.2.3.xpi`, sha256: sha, minVersion: '128.0' }));
  assert.deepEqual(data, {
    addons: { [ID]: { updates: [{ version: '1.2.3', update_link: `${BASE}/agentbuddy-1.2.3.xpi`, update_hash: `sha256:${sha}`, applications: { gecko: { strict_min_version: '128.0' } } }] } },
  });
  const plain = JSON.parse(firefoxUpdateManifest({ addonId: ID, version: '1.2.3', xpiUrl: `${BASE}/x.xpi`, sha256: sha, minVersion: '' }));
  assert.equal(plain.addons[ID].updates[0].applications, undefined);
});

test('the build\'s update address: the right one passes, none is a note about Firefox 128 to 150, another one stops the release', () => {
  assert.deepEqual(firefoxUpdateUrlCheck(`${BASE}/updates.json`, BASE), {});
  assert.deepEqual(firefoxUpdateUrlCheck('https://EXT.corp.example:443/ab/updates.json', BASE), {}, 'compared as addresses');
  assert.match(firefoxUpdateUrlCheck('', BASE).note, /Firefox 151 and later .* Firefox 128 to 150 would never update/);
  assert.match(firefoxUpdateUrlCheck('https://other.example/updates.json', BASE).error, /looks for updates at https:\/\/other\.example/);
});

// A ZIP with stored (not deflated) entries, the other method a package can use.
function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function writeBuild(dir, manifest, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'background.bundle.js'), '// the background');
  for (const [name, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

const firefoxManifest = (updateUrl) => ({ manifest_version: 3, name: 'Agent Buddy', version: '1.4.0', browser_specific_settings: { gecko: { id: ID, strict_min_version: '128.0', ...(updateUrl ? { update_url: updateUrl } : {}) } } });

test('reading a package: its manifest from a deflated or a stored ZIP, and whether it carries the files of a Mozilla signature', () => {
  const dir = tempDir();
  try {
    writeBuild(path.join(dir, 'signed'), firefoxManifest(`${BASE}/updates.json`), { 'META-INF/cose.sig': 'sig', 'META-INF/cose.manifest': 'm', 'META-INF/mozilla.rsa': 'rsa' });
    const signed = zipFolder(path.join(dir, 'signed'));
    assert.ok(readZip(signed).names.includes('META-INF/cose.sig'));
    assert.deepEqual(inspectXpi(signed), { id: ID, version: '1.4.0', updateUrl: `${BASE}/updates.json`, minVersion: '128.0', signed: true });
    writeBuild(path.join(dir, 'plain'), firefoxManifest(''));
    assert.equal(inspectXpi(zipFolder(path.join(dir, 'plain'))).signed, false);
    const stored = storedZip({ 'manifest.json': JSON.stringify(firefoxManifest('')), 'META-INF/mozilla.rsa': 'rsa' });
    assert.equal(readZip(stored).read('manifest.json').toString(), JSON.stringify(firefoxManifest('')));
    assert.deepEqual(inspectXpi(stored), { id: ID, version: '1.4.0', updateUrl: '', minVersion: '128.0', signed: true });
    assert.throws(() => inspectXpi(Buffer.from('not a zip at all, just some text that is long enough to scan')), /Not a package Firefox can install: it is not a ZIP/);
    assert.throws(() => inspectXpi(storedZip({ 'readme.txt': 'x' })), /no manifest\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('firefox, step 1: the Firefox build zipped for signing and README.txt with the steps; step 3: the signed package, updates.json, the policies', () => {
  const dir = tempDir();
  try {
    const dist = path.join(dir, 'dist-firefox');
    const out = path.join(dir, 'out');
    writeBuild(dist, firefoxManifest(`${BASE}/updates.json`));
    const script = path.join(ROOT, 'scripts', 'selfhost.js');
    const step1 = spawnSync(process.execPath, [script, 'firefox', '--base-url', `${BASE}/`, '--dist', dist, '--out', out], { encoding: 'utf8' });
    assert.equal(step1.status, 0, step1.stderr);
    assert.deepEqual(fs.readdirSync(path.join(out, 'firefox')).sort(), ['README.txt', 'agentbuddy-1.4.0-unsigned.zip']);
    assert.ok(readZip(fs.readFileSync(path.join(out, 'firefox', 'agentbuddy-1.4.0-unsigned.zip'))).names.includes('manifest.json'));
    const readme = fs.readFileSync(path.join(out, 'firefox', 'README.txt'), 'utf8');
    for (const words of ['https://addons.mozilla.org/developers/', '"On your own"', 'never asks for or keeps an AMO login or API key', `--base-url ${BASE} --xpi`, `${BASE}/`]) assert.ok(readme.includes(words), words);

    // What addons.mozilla.org gives back: the same build with the signature files added.
    writeBuild(path.join(dir, 'signed'), firefoxManifest(`${BASE}/updates.json`), { 'META-INF/cose.sig': 'sig', 'META-INF/mozilla.rsa': 'rsa' });
    const xpiFile = path.join(dir, 'agentbuddy-signed.xpi');
    fs.writeFileSync(xpiFile, zipFolder(path.join(dir, 'signed')));
    const step3 = spawnSync(process.execPath, [script, 'firefox', '--base-url', BASE, '--xpi', xpiFile, '--out', out], { encoding: 'utf8' });
    assert.equal(step3.status, 0, step3.stderr);
    const f = (...p) => path.join(out, 'firefox', ...p);
    const xpi = fs.readFileSync(xpiFile);
    assert.ok(fs.readFileSync(f('agentbuddy-1.4.0.xpi')).equals(xpi));
    assert.ok(fs.readFileSync(f('agentbuddy.xpi')).equals(xpi), 'the fixed name the policy installs from');
    const sha = crypto.createHash('sha256').update(xpi).digest('hex');
    assert.deepEqual(JSON.parse(fs.readFileSync(f('updates.json'), 'utf8')).addons[ID].updates, [{ version: '1.4.0', update_link: `${BASE}/agentbuddy-1.4.0.xpi`, update_hash: `sha256:${sha}`, applications: { gecko: { strict_min_version: '128.0' } } }]);
    assert.deepEqual(fs.readdirSync(f('policies')).sort(), ['firefox-macos.mobileconfig', 'firefox-policies.json', 'firefox-windows.reg']);
    const { policies } = JSON.parse(fs.readFileSync(f('policies', 'firefox-policies.json'), 'utf8'));
    assert.deepEqual(policies.ExtensionSettings, { [ID]: firefoxInstallEntry(BASE) });
    assert.deepEqual(policies['3rdparty'].Extensions[ID], recommended);
    const sums = fs.readFileSync(f('SHA256SUMS'), 'utf8');
    assert.ok(sums.includes(`${sha}  agentbuddy-1.4.0.xpi\n`) && sums.includes(`${sha}  agentbuddy.xpi\n`));
    for (const name of ['updates.json', 'policies/firefox-policies.json', 'policies/firefox-windows.reg', 'policies/firefox-macos.mobileconfig']) assert.ok(sums.includes(`  ${name}\n`), name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('firefox refuses a Chrome build, a build or package for another update address, and a package without a signature', () => {
  const dir = tempDir();
  try {
    const out = path.join(dir, 'out');
    writeBuild(path.join(dir, 'chrome'), { manifest_version: 3, name: 'Agent Buddy', version: '1.4.0', background: { service_worker: 'background.bundle.js' } });
    assert.throws(() => firefox(['--base-url', BASE, '--dist', path.join(dir, 'chrome'), '--out', out]), /not a Firefox build/);
    writeBuild(path.join(dir, 'elsewhere'), firefoxManifest('https://other.example/updates.json'));
    assert.throws(() => firefox(['--base-url', BASE, '--dist', path.join(dir, 'elsewhere'), '--out', out]), /looks for updates at https:\/\/other\.example/);
    writeBuild(path.join(dir, 'unsigned'), firefoxManifest(`${BASE}/updates.json`));
    fs.writeFileSync(path.join(dir, 'unsigned.xpi'), zipFolder(path.join(dir, 'unsigned')));
    assert.throws(() => firefox(['--base-url', BASE, '--xpi', path.join(dir, 'unsigned.xpi'), '--out', out]), /carries no Mozilla signature/);
    writeBuild(path.join(dir, 'signed-elsewhere'), firefoxManifest('https://other.example/updates.json'), { 'META-INF/cose.sig': 'sig' });
    fs.writeFileSync(path.join(dir, 'signed-elsewhere.xpi'), zipFolder(path.join(dir, 'signed-elsewhere')));
    assert.throws(() => firefox(['--base-url', BASE, '--xpi', path.join(dir, 'signed-elsewhere.xpi'), '--out', out]), /looks for updates at/);
    assert.throws(() => firefox(['--base-url', 'http://ext.corp.example', '--out', out]), /--base-url must be the https address/);
    assert.ok(!fs.existsSync(path.join(out, 'firefox', 'updates.json')), 'nothing was published');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Chrome and Edge pack refuses a Firefox build', () => {
  const dir = tempDir();
  try {
    writeBuild(path.join(dir, 'dist-firefox'), firefoxManifest(''));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'selfhost.js'), 'pack', '--base-url', BASE, '--dist', path.join(dir, 'dist-firefox'), '--key', path.join(dir, 'no-key.pem')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is a Firefox build/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selfhost.js makes no network request and holds no addons.mozilla.org credential: a person signs', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'selfhost.js'), 'utf8');
  assert.ok(!/require\(['"](node:)?(https?|net|tls|http2)['"]\)|\bfetch\(|web-ext|api[_-]?(key|secret)\s*[:=]|jwt/i.test(source));
});
