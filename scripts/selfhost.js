// The self-hosted install (TRACKER.md R3): turn a build into what an organisation puts on its own web server, and into the policy files
// that make Chrome and Edge install and update Agent Buddy from there.
//
//   node scripts/selfhost.js init   [--key <file>]              make the signing key (once) and print the extension id
//   node scripts/selfhost.js id     [--key <file>]              print the extension id of a key
//   node scripts/selfhost.js pack   --base-url <https address> [--dist <folder>] [--key <file>] [--out <folder>]
//       dist      the build to pack (default: dist-enterprise or dist, whichever holds a build; when both do, --dist must say which;
//                 build it first: npm run build, or npm run package -- --minify for the minified release in release/unpacked)
//       base-url  the https folder the files will be served from, for example https://extensions.corp.example/agentbuddy
//       key       the signing key (default selfhost/agentbuddy-key.pem); the SAME key every time: it is what makes the extension id
//       out       where to write (default selfhost/out)
//   writes  agentbuddy-<version>.crx   the signed package (CRX3)
//           update.xml                 the update manifest the browsers poll (served from <base-url>/update.xml)
//           policies/                  the sample policy files of docs/review-pack with the extension id and the update address filled in
//           SHA256SUMS                 the hashes of the files above
//   node scripts/selfhost.js verify <file.crx>                  check a package: format, signature, extension id
//
// Firefox (docs/deployment.md, "Firefox"): Mozilla signs the package, so the route has a person in the middle (see "Firefox" below).
//   node scripts/selfhost.js firefox --base-url <https address> [--dist <folder>] [--out <folder>]
//       dist      the Firefox build (default: dist-firefox-enterprise or dist-firefox, whichever holds a build)
//   writes  firefox/agentbuddy-<version>-unsigned.zip   the build, for a person to get signed on addons.mozilla.org
//           firefox/README.txt                          the signing steps and what comes next
//   node scripts/selfhost.js firefox --base-url <https address> --xpi <signed .xpi> [--out <folder>]
//   writes  firefox/agentbuddy-<version>.xpi and firefox/agentbuddy.xpi (the same signed file; the policy installs the second),
//           firefox/updates.json (what Firefox polls), firefox/policies/ (policies.json, .reg, .mobileconfig), firefox/SHA256SUMS
//   node scripts/selfhost.js firefox-samples                  rewrite docs/review-pack/policies-firefox/ from recommended-policy.json
//
// The key: whoever holds it can publish an update that every installed copy will accept. Keep it off the web server, back it up, never
// put it in the repository (selfhost/ and *.pem are in .gitignore). Lose it and the extension id changes: everyone must be reinstalled.
//
// No dependency: Node's crypto signs, and the zip comes from scripts/package.js.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { zipFolder } = require('./package.js');
const { GECKO_ID } = require('./lib/browsers.js');

const root = path.join(__dirname, '..');
const DEFAULT_KEY = path.join(root, 'selfhost', 'agentbuddy-key.pem');

// ---- the extension id: the first 16 bytes of the SHA-256 of the public key, each hex digit written as a letter a to p -----------------
function publicKeyDer(privateKeyPem) {
  return crypto.createPublicKey(crypto.createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
}
function extensionId(publicDer) {
  return [...crypto.createHash('sha256').update(publicDer).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15)))
    .join('');
}

// ---- protobuf, just the few fields a CRX3 header has ----------------------------------------------------------------------------------
function varint(n) {
  const out = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
}
const field = (number, bytes) => Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]); // wire type 2: length-delimited

/** The CRX3 package: "Cr24", version 3, the header (public key, signature, signed id), then the zip. */
function buildCrx(zip, privateKeyPem) {
  const pub = publicKeyDer(privateKeyPem);
  const crxId = crypto.createHash('sha256').update(pub).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId); // SignedData { crx_id = 1 }
  const lengthLe = Buffer.alloc(4);
  lengthLe.writeUInt32LE(signedHeaderData.length);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(Buffer.concat([Buffer.from('CRX3 SignedData\0', 'latin1'), lengthLe, signedHeaderData, zip]));
  const signature = signer.sign(crypto.createPrivateKey(privateKeyPem));
  const proof = Buffer.concat([field(1, pub), field(2, signature)]); // AsymmetricKeyProof { public_key = 1, signature = 2 }
  const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)]); // CrxFileHeader { sha256_with_rsa = 2, signed_header_data = 10000 }
  const preamble = Buffer.alloc(12);
  preamble.write('Cr24', 0, 'latin1');
  preamble.writeUInt32LE(3, 4);
  preamble.writeUInt32LE(header.length, 8);
  return Buffer.concat([preamble, header, zip]);
}

function readVarint(buf, at) {
  let result = 0;
  let shift = 0;
  let i = at;
  for (;;) {
    const b = buf[i++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, i];
    shift += 7;
  }
}
function readFields(buf) {
  const out = [];
  for (let i = 0; i < buf.length; ) {
    const [tag, afterTag] = readVarint(buf, i);
    const [len, afterLen] = readVarint(buf, afterTag);
    out.push({ number: Math.floor(tag / 8), bytes: buf.subarray(afterLen, afterLen + len) });
    i = afterLen + len;
  }
  return out;
}

/** Read a CRX3 package back and check it: { id, version, zip, signatureOk }. */
function parseCrx(crx) {
  if (crx.subarray(0, 4).toString('latin1') !== 'Cr24') throw new Error('Not a CRX package (no "Cr24" at the start).');
  const version = crx.readUInt32LE(4);
  if (version !== 3) throw new Error(`CRX version ${version}: only version 3 is supported.`);
  const headerLength = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLength);
  const zip = crx.subarray(12 + headerLength);
  const fields = readFields(header);
  const proof = fields.find((f) => f.number === 2);
  const signedHeaderData = fields.find((f) => f.number === 10000)?.bytes || Buffer.alloc(0);
  if (!proof) throw new Error('The package has no RSA signature.');
  const parts = readFields(proof.bytes);
  const pub = parts.find((f) => f.number === 1)?.bytes;
  const signature = parts.find((f) => f.number === 2)?.bytes;
  const lengthLe = Buffer.alloc(4);
  lengthLe.writeUInt32LE(signedHeaderData.length);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(Buffer.concat([Buffer.from('CRX3 SignedData\0', 'latin1'), lengthLe, signedHeaderData, zip]));
  const signatureOk = verifier.verify(crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }), signature);
  const crxId = readFields(signedHeaderData).find((f) => f.number === 1)?.bytes;
  const idMatchesKey = Boolean(crxId) && crxId.equals(crypto.createHash('sha256').update(pub).digest().subarray(0, 16));
  return { id: extensionId(pub), signatureOk: signatureOk && idMatchesKey, zip };
}

// ---- files ---------------------------------------------------------------------------------------------------------------------------------
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function updateManifest({ id, version, crxUrl, sha256 }) {
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${id}'>
    <updatecheck codebase='${escapeXml(crxUrl)}' version='${escapeXml(version)}' hash_sha256='${sha256}' />
  </app>
</gupdate>
`;
}

// An option given without its value (`--dist` at the end, or followed by another option) is a mistake: it used to fall back to the
// default silently, which for --key or --dist means signing or packing something other than what was asked for.
function arg(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value.`);
  return value;
}

// The build to pack when --dist is not given. dist-enterprise/ and dist/ can both be on disk, and either can be older than the source:
// preferring one silently because it exists could pack the wrong or a stale build. So the one that exists is packed, and when both do,
// the person says which. Firefox: the same with dist-firefox-enterprise/ and dist-firefox/.
function defaultDist(folders = ['dist-enterprise', 'dist']) {
  const built = folders.filter((d) => fs.existsSync(path.join(root, d, 'manifest.json')));
  if (built.length > 1) throw new Error(`Both ${folders.map((d) => `${d}/`).join(' and ')} hold a build. Say which one to pack: ${folders.map((d) => `--dist ${d}`).join(' or ')}.`);
  return path.join(root, built[0] || folders[folders.length - 1]);
}

function baseUrlOf(args) {
  const baseUrl = String(arg(args, 'base-url', '')).replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+/.test(baseUrl)) throw new Error('--base-url must be the https address the files will be served from, for example https://extensions.corp.example/agentbuddy');
  return baseUrl;
}

function loadKey(file) {
  if (!fs.existsSync(file)) throw new Error(`No signing key at ${file}. Make one once with: node scripts/selfhost.js init`);
  return fs.readFileSync(file, 'utf8');
}

function init(args) {
  const file = path.resolve(arg(args, 'key', DEFAULT_KEY));
  if (fs.existsSync(file)) throw new Error(`${file} already exists. A new key means a new extension id; delete it by hand if that is what you want.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Signing key written to ${file}`);
  console.log(`Extension id: ${extensionId(publicKeyDer(fs.readFileSync(file, 'utf8')))}`);
  console.log('Back this file up somewhere safe and private. Never put it on the web server or in the repository.');
}

function pack(args) {
  const baseUrl = baseUrlOf(args);
  const dist = path.resolve(arg(args, 'dist', '') || defaultDist());
  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`${dist} has no manifest.json. Build first: npm run build (or npm run build:enterprise -- enterprise/<name>.json).`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.browser_specific_settings?.gecko) throw new Error(`${dist} is a Firefox build. Chrome and Edge need their own (npm run build); for Firefox use: node scripts/selfhost.js firefox`);
  // Say which build is packed and when it was made, so a stale one is noticed before it is uploaded.
  console.log(`Packing ${path.relative(root, dist) || dist}: version ${manifest.version}, ${manifest.host_permissions ? 'an enterprise build' : 'the normal build'}, built ${fs.statSync(manifestFile).mtime.toLocaleString()}.`);
  const keyPem = loadKey(path.resolve(arg(args, 'key', DEFAULT_KEY)));
  const out = path.resolve(arg(args, 'out', path.join(root, 'selfhost', 'out')));
  fs.mkdirSync(path.join(out, 'policies'), { recursive: true });

  const zip = zipFolder(dist);
  const crx = buildCrx(zip, keyPem);
  const check = parseCrx(crx);
  if (!check.signatureOk) throw new Error('The package did not verify after it was built. Nothing was written.');
  const id = check.id;
  const crxName = `agentbuddy-${manifest.version}.crx`;
  fs.writeFileSync(path.join(out, crxName), crx);
  const sha256 = crypto.createHash('sha256').update(crx).digest('hex');
  fs.writeFileSync(path.join(out, 'update.xml'), updateManifest({ id, version: manifest.version, crxUrl: `${baseUrl}/${crxName}`, sha256 }));

  // The sample policy files, with this extension's id and the address of its update manifest.
  const samples = path.join(root, 'docs', 'review-pack', 'policies');
  const written = [];
  for (const name of fs.readdirSync(samples)) {
    const text = fs.readFileSync(path.join(samples, name), 'utf8').split('EXTENSION_ID').join(id).split('https://extensions.corp.example/agentbuddy/update.xml').join(`${baseUrl}/update.xml`);
    fs.writeFileSync(path.join(out, 'policies', name), text);
    written.push(`policies/${name}`);
  }
  const files = [crxName, 'update.xml', ...written];
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, f))).digest('hex')}  ${f}`).join('\n')}\n`);

  console.log(`Agent Buddy ${manifest.version}  extension id ${id}`);
  console.log(`Written to ${out}:`);
  for (const f of [...files, 'SHA256SUMS']) console.log(`  ${f}`);
  console.log(`\nUpload ${crxName} and update.xml to ${baseUrl}/ (https, reachable from every browser, served as-is).`);
  console.log('Deploy the policy file for each platform (docs/deployment.md, "Self-hosted install"); the browser installs and updates by itself.');
  return { id, crxName };
}

// ---- Firefox -------------------------------------------------------------------------------------------------------------------------
// Firefox has no CRX and no key of ours: Mozilla signs the package on addons.mozilla.org (AMO), and the add-on id is the one written in
// the build (browser_specific_settings.gecko.id). So the route has a person in the middle:
//   1. `firefox` without --xpi zips the build for AMO and writes README.txt with the signing steps;
//   2. a person signs it on AMO with the organisation's own account ("On your own": signed, not listed) and downloads the .xpi;
//   3. `firefox --xpi <signed.xpi>` checks that file and writes what is served and deployed.
// Nothing here signs in to AMO or holds an AMO login or API key, on purpose.
//
// What Mozilla documents and the policy files below follow (firefox-admin-docs.mozilla.org, "3rdparty" and "ExtensionSettings"):
//   - Agent Buddy's policy is the extension's entry under 3rdparty > Extensions > <add-on id>. Firefox checks nothing in it against
//     managed_schema.json (it does not support that key) and passes registry and plist values as they are: a REG_DWORD or <true/>
//     arrives as 1 or 0, which Agent Buddy does not read as true or false. So the .reg and the profile carry the policy as one JSON
//     text, as Mozilla recommends; policies.json carries real true and false.
//   - The install is Firefox's ExtensionSettings policy: one policy for every add-on, so an organisation that already sets it adds
//     Agent Buddy's entry to its own (the files say so).

const FIREFOX_EXAMPLE_BASE = 'https://extensions.corp.example/agentbuddy';
// The address the policy installs from. Firefox downloads install_url again at each start when the installed copy came from another
// address (an update does), and Firefox 128 installs whatever version it finds there, an older one included (installAddonFromURL in
// Firefox's Policies.sys.mjs; later versions refuse a downgrade). One fixed name that always holds the newest package is safe on all.
const FIREFOX_FIXED_XPI = 'agentbuddy.xpi';
const FIREFOX_SAMPLES = path.join(root, 'docs', 'review-pack', 'policies-firefox');

/** The ExtensionSettings entry (Firefox's own policy) that installs Agent Buddy for everyone from <base>/agentbuddy.xpi. */
function firefoxInstallEntry(baseUrl) {
  return {
    installation_mode: 'force_installed', // installed for everyone; people cannot remove or disable it
    install_url: `${baseUrl}/${FIREFOX_FIXED_XPI}`,
    // Firefox 151 and later look for updates here, over the build's own gecko.update_url. Older versions drop the key (a policy's
    // unknown keys are ignored, not refused) and use the build's address.
    update_url: `${baseUrl}/updates.json`,
    // Firefox 113 and later: the button on the toolbar, not in the extensions menu. In Firefox the toolbar button (or the shortcut) is
    // how the sidebar opens; a click on the page cannot open it.
    default_area: 'navbar',
  };
}

const regSz = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; // a REG_SZ value as a .reg file writes it
const xmlText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function firefoxPoliciesJson(addonId, install, policy) {
  return `${JSON.stringify({ policies: { ExtensionSettings: install, '3rdparty': { Extensions: { [addonId]: policy } } } }, null, 2)}\n`;
}

function firefoxReg(addonId, install, policy) {
  return [
    'Windows Registry Editor Version 5.00',
    '',
    '; Agent Buddy for Firefox on Windows: installs it for everyone and sets the recommended locked-down policy.',
    '; 1. Replace the example instances, AI address, model and HR table prefix in the policy with your own.',
    '; 2. ExtensionSettings is ONE policy for every add-on. If you already set it (for example with the Firefox ADMX templates), do not',
    `;    import that value: it would replace yours. Add the "${addonId}" entry to your own instead.`,
    '; 3. Deploy through Group Policy Preferences, Intune or your usual tool, restart Firefox, open about:policies and check that',
    ';    ExtensionSettings and 3rdparty are under Active policies.',
    '; Both values are JSON text (REG_SZ), as Mozilla documents for extension policy: as REG_DWORD values or subkeys, true and false',
    '; would reach Agent Buddy as 1 and 0, which it does not read as true and false.',
    '',
    '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Mozilla\\Firefox]',
    `"ExtensionSettings"=${regSz(JSON.stringify(install))}`,
    '',
    '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Mozilla\\Firefox\\3rdparty\\Extensions]',
    `${regSz(addonId)}=${regSz(JSON.stringify(policy))}`,
    '',
  ].join('\r\n'); // regedit expects CRLF (.gitattributes keeps the samples that way)
}

function firefoxMobileconfig(addonId, install, policy) {
  const entry = Object.entries(install[addonId])
    .map(([key, value]) => `                    <key>${xmlText(key)}</key>\n                    <string>${xmlText(value)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  Agent Buddy: installs it in Firefox on macOS and sets the recommended locked-down policy (a configuration profile for your MDM).
  1. Replace the example instances, AI address, model and HR table prefix in the policy string with your own.
  2. Give the two PayloadUUID values new UUIDs (uuidgen) and PayloadIdentifier your own reverse-DNS prefix.
  3. ExtensionSettings is ONE policy for every add-on: if your profiles already set it, add the ${xmlText(addonId)} entry there instead.
  4. After installing, restart Firefox, open about:policies and check that ExtensionSettings and 3rdparty are under Active policies.
  The settings are nested in mcx_preference_settings for the domain org.mozilla.firefox, as Mozilla documents for profiles, and
  EnterprisePoliciesEnabled is set: Firefox on macOS reads no policy without it. The Agent Buddy policy is one JSON string, as Mozilla
  documents for extension policy: written as a dict, true and false would reach Agent Buddy as 1 and 0.
-->
<plist version="1.0">
<dict>
  <key>PayloadDisplayName</key>
  <string>Agent Buddy (Firefox)</string>
  <key>PayloadIdentifier</key>
  <string>example.corp.agentbuddy.firefox</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadScope</key>
  <string>System</string>
  <key>PayloadUUID</key>
  <string>3D5A9C17-8E42-4B6F-A1D3-5C7E9F2B4A01</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadDisplayName</key>
      <string>Install Agent Buddy and its policy (Firefox)</string>
      <key>PayloadIdentifier</key>
      <string>example.corp.agentbuddy.firefox.policy</string>
      <key>PayloadType</key>
      <string>com.apple.ManagedClient.preferences</string>
      <key>PayloadUUID</key>
      <string>3D5A9C17-8E42-4B6F-A1D3-5C7E9F2B4A02</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadContent</key>
      <dict>
        <key>org.mozilla.firefox</key>
        <dict>
          <key>Forced</key>
          <array>
            <dict>
              <key>mcx_preference_settings</key>
              <dict>
                <key>EnterprisePoliciesEnabled</key>
                <true/>
                <key>ExtensionSettings</key>
                <dict>
                  <key>${xmlText(addonId)}</key>
                  <dict>
${entry}
                  </dict>
                </dict>
                <key>3rdparty</key>
                <dict>
                  <key>Extensions</key>
                  <dict>
                    <key>${xmlText(addonId)}</key>
                    <string>${xmlText(JSON.stringify(policy))}</string>
                  </dict>
                </dict>
              </dict>
            </dict>
          </array>
        </dict>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

/**
 * Agent Buddy's Firefox policy files, each with the ExtensionSettings entry that installs it and the Agent Buddy policy:
 * { 'firefox-policies.json', 'firefox-windows.reg', 'firefox-macos.mobileconfig': text }.
 */
function firefoxPolicyFiles({ addonId, baseUrl, policy }) {
  const install = { [addonId]: firefoxInstallEntry(baseUrl) };
  return {
    'firefox-policies.json': firefoxPoliciesJson(addonId, install, policy),
    'firefox-windows.reg': firefoxReg(addonId, install, policy),
    'firefox-macos.mobileconfig': firefoxMobileconfig(addonId, install, policy),
  };
}

/** updates.json, the update manifest Firefox polls at the build's gecko.update_url (extensionworkshop.com, "Updating your extension"). */
function firefoxUpdateManifest({ addonId, version, xpiUrl, sha256, minVersion }) {
  const update = { version, update_link: xpiUrl, update_hash: `sha256:${sha256}` };
  if (minVersion) update.applications = { gecko: { strict_min_version: minVersion } };
  return `${JSON.stringify({ addons: { [addonId]: { updates: [update] } } }, null, 2)}\n`;
}

/** The files of a ZIP archive (an .xpi is one): { names, read(name) -> Buffer | null }. Stored and deflated entries; no ZIP64. */
function readZip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('it is not a ZIP archive.');
  const entries = new Map();
  let at = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n -= 1) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('its list of files is damaged.');
    const nameLength = buf.readUInt16LE(at + 28);
    entries.set(buf.subarray(at + 46, at + 46 + nameLength).toString('utf8'), { method: buf.readUInt16LE(at + 10), size: buf.readUInt32LE(at + 20), local: buf.readUInt32LE(at + 42) });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`${name} is damaged.`);
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.size);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error(`${name} uses a compression this script does not read (method ${e.method}).`);
    },
  };
}

/**
 * What the release needs to know about a package: { id, version, updateUrl, minVersion, signed }. `signed` says the package carries the
 * files of a Mozilla signature (META-INF/cose.sig, META-INF/<name>.rsa: the names Firefox looks for); Firefox checks the signature itself.
 */
function inspectXpi(buf) {
  let zip;
  let manifest;
  try {
    zip = readZip(buf);
    const text = zip.read('manifest.json');
    if (!text) throw new Error('it has no manifest.json.');
    manifest = JSON.parse(text.toString('utf8').trimStart()); // trimStart also drops a byte order mark
  } catch (err) {
    throw new Error(`Not a package Firefox can install: ${err.message}`, { cause: err });
  }
  const gecko = manifest.browser_specific_settings?.gecko || {};
  return {
    id: typeof gecko.id === 'string' ? gecko.id : '',
    version: typeof manifest.version === 'string' ? manifest.version : '',
    updateUrl: typeof gecko.update_url === 'string' ? gecko.update_url : '',
    minVersion: typeof gecko.strict_min_version === 'string' ? gecko.strict_min_version : '',
    signed: zip.names.some((n) => /^META-INF\/(cose\.sig|[^/]+\.rsa)$/i.test(n)),
  };
}

const sameUrl = (a, b) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

/** The build's own update address against the base address: { error } when it points elsewhere, { note } when there is none. */
function firefoxUpdateUrlCheck(updateUrl, baseUrl) {
  const expected = `${baseUrl}/updates.json`;
  if (!updateUrl) {
    return {
      note:
        `This build has no update address of its own (browser_specific_settings.gecko.update_url). Firefox 151 and later take ${expected} ` +
        'from the policy files; Firefox 128 to 150 would never update it. To cover them, build with ' +
        `"updateUrl": "${expected}" in your enterprise config: node build.js --browser firefox --enterprise enterprise/<name>.json`,
    };
  }
  if (!sameUrl(updateUrl, expected)) return { error: `This build looks for updates at ${updateUrl}, not at ${expected}. Give the --base-url it was built for, or build it again with "updateUrl": "${expected}" in the enterprise config.` };
  return {};
}

function firefoxReadme({ baseUrl, addonId, version, unsignedName }) {
  return `Agent Buddy ${version} for Firefox: the self-hosted install (written by scripts/selfhost.js; see docs/deployment.md, "Firefox")

Release Firefox installs only add-ons signed by Mozilla, and Mozilla signs on addons.mozilla.org (AMO). selfhost.js never signs in
there and never asks for or keeps an AMO login or API key: a person with the organisation's own AMO account does step 1 by hand.

1. Get ${unsignedName} signed
   a. Sign in at https://addons.mozilla.org/developers/ with the organisation's account.
   b. The first time: "Submit a New Add-on", then "On your own" (self-distribution: signed by Mozilla, not listed on AMO).
      Later versions: open Agent Buddy under "My Add-ons" and upload the new version there, so AMO keeps it as the same add-on.
      AMO accepts the add-on id ${addonId} from one account only: the first one that submits it.
   c. Upload ${unsignedName}. An error from the validator stops the upload: fix the build and start again. Warnings do not stop it.
   d. Source code: the build bundles its files with esbuild, and Mozilla asks for the source of bundled code. Answer Yes and upload
      the source of this version (with package-lock.json) and how to build it (docs/review-pack/README.md, section 1).
      What you upload is read by Mozilla's reviewers. An enterprise build carries your instance addresses, AI address and policy.
   e. Wait for the email that says the version is signed: up to 24 hours, longer if Mozilla reviews it by hand.
   f. Open the version (under the latest version, "View All", then this version), right-click the file link and save the .xpi.

2. Run:  node scripts/selfhost.js firefox --base-url ${baseUrl} --xpi <the signed .xpi>
   It checks that the file carries Mozilla's signature, this add-on's id and the right update address, and writes here:
     agentbuddy-<version>.xpi   the signed package
     agentbuddy.xpi             the same file under a fixed name: the policy installs from it
     updates.json               what Firefox checks for new versions (about once a day)
     policies/                  the policy files: firefox-windows.reg, firefox-macos.mobileconfig, firefox-policies.json
     SHA256SUMS                 the hashes of the files above

3. Upload agentbuddy-<version>.xpi, agentbuddy.xpi and updates.json to ${baseUrl}/ (https, with a certificate the computers
   trust). Replace agentbuddy.xpi at every release; keep the older versioned files there for a while.

4. The first time only: deploy ONE of the policy files (docs/deployment.md, "Policy files for Firefox"). Firefox reads policy when it
   starts: a new or changed policy applies after a restart.

5. Check on one computer: restart Firefox; about:policies lists ExtensionSettings and 3rdparty under Active policies and nothing under
   Errors; about:addons shows Agent Buddy, which cannot be removed.
`;
}

const recommendedPolicy = () => JSON.parse(fs.readFileSync(path.join(root, 'docs', 'review-pack', 'policies', 'recommended-policy.json'), 'utf8'));
const sha256Of = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function firefox(args) {
  const baseUrl = baseUrlOf(args);
  const out = path.join(path.resolve(arg(args, 'out', path.join(root, 'selfhost', 'out'))), 'firefox');
  const xpiFile = arg(args, 'xpi', '');
  return xpiFile ? firefoxPublish(baseUrl, path.resolve(xpiFile), out) : firefoxPrepare(baseUrl, path.resolve(arg(args, 'dist', '') || defaultDist(['dist-firefox-enterprise', 'dist-firefox'])), out);
}

// Step 1: the build, zipped for AMO, and the steps.
function firefoxPrepare(baseUrl, dist, out) {
  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`${dist} has no manifest.json. Build first: node build.js --browser firefox (or --browser firefox --enterprise enterprise/<name>.json).`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const gecko = manifest.browser_specific_settings?.gecko;
  if (!gecko?.id) throw new Error(`${dist} is not a Firefox build (no browser_specific_settings.gecko.id). Build one: node build.js --browser firefox`);
  const check = firefoxUpdateUrlCheck(gecko.update_url, baseUrl);
  if (check.error) throw new Error(check.error);
  console.log(`Packing ${path.relative(root, dist) || dist} for Firefox: ${gecko.id} version ${manifest.version}, built ${fs.statSync(manifestFile).mtime.toLocaleString()}.`);
  fs.mkdirSync(out, { recursive: true });
  const unsignedName = `agentbuddy-${manifest.version}-unsigned.zip`;
  fs.writeFileSync(path.join(out, unsignedName), zipFolder(dist));
  fs.writeFileSync(path.join(out, 'README.txt'), firefoxReadme({ baseUrl, addonId: gecko.id, version: manifest.version, unsignedName }));
  console.log(`Written to ${out}:\n  ${unsignedName}\n  README.txt`);
  if (check.note) console.log(`\nNote: ${check.note}`);
  console.log(`\nNext: get ${unsignedName} signed on addons.mozilla.org (README.txt, step 1), then run this again with --xpi <the signed .xpi>.`);
  return { unsignedName };
}

// Step 3: the signed package, the update manifest and the policy files.
function firefoxPublish(baseUrl, xpiFile, out) {
  const xpi = fs.readFileSync(xpiFile);
  const info = inspectXpi(xpi);
  if (!info.signed) throw new Error(`${xpiFile} carries no Mozilla signature (no META-INF/cose.sig). Use the .xpi that addons.mozilla.org gives back after signing (README.txt, step 1).`);
  if (!info.id) throw new Error(`${xpiFile} names no add-on id (browser_specific_settings.gecko.id). It is not a Firefox build of Agent Buddy.`);
  if (!/^\d+(\.\d+){0,3}$/.test(info.version)) throw new Error(`${xpiFile} has the version "${info.version}", which is not one Firefox accepts.`);
  const check = firefoxUpdateUrlCheck(info.updateUrl, baseUrl);
  if (check.error) throw new Error(check.error);
  fs.mkdirSync(path.join(out, 'policies'), { recursive: true });

  const xpiName = `agentbuddy-${info.version}.xpi`;
  fs.writeFileSync(path.join(out, xpiName), xpi);
  fs.writeFileSync(path.join(out, FIREFOX_FIXED_XPI), xpi);
  fs.writeFileSync(path.join(out, 'updates.json'), firefoxUpdateManifest({ addonId: info.id, version: info.version, xpiUrl: `${baseUrl}/${xpiName}`, sha256: sha256Of(xpi), minVersion: info.minVersion }));
  const written = [];
  for (const [name, text] of Object.entries(firefoxPolicyFiles({ addonId: info.id, baseUrl, policy: recommendedPolicy() }))) {
    fs.writeFileSync(path.join(out, 'policies', name), text);
    written.push(`policies/${name}`);
  }
  fs.writeFileSync(path.join(out, 'README.txt'), firefoxReadme({ baseUrl, addonId: info.id, version: info.version, unsignedName: `agentbuddy-${info.version}-unsigned.zip` }));
  const files = [xpiName, FIREFOX_FIXED_XPI, 'updates.json', ...written];
  fs.writeFileSync(path.join(out, 'SHA256SUMS'), `${files.map((f) => `${sha256Of(fs.readFileSync(path.join(out, f)))}  ${f}`).join('\n')}\n`);

  console.log(`Agent Buddy ${info.version} for Firefox  add-on id ${info.id}`);
  console.log(`Written to ${out}:`);
  for (const f of [...files, 'README.txt', 'SHA256SUMS']) console.log(`  ${f}`);
  if (check.note) console.log(`\nNote: ${check.note}`);
  console.log(`\nUpload ${xpiName}, ${FIREFOX_FIXED_XPI} and updates.json to ${baseUrl}/ (https, reachable from every computer).`);
  console.log('The first time, deploy one policy file (docs/deployment.md, "Policy files for Firefox"); Firefox installs and updates it by itself.');
  return { id: info.id, xpiName };
}

// The samples in docs/review-pack/policies-firefox/: the same files with the example address and the recommended policy.
function firefoxSampleFiles() {
  return firefoxPolicyFiles({ addonId: GECKO_ID, baseUrl: FIREFOX_EXAMPLE_BASE, policy: recommendedPolicy() });
}

function firefoxSamples() {
  fs.mkdirSync(FIREFOX_SAMPLES, { recursive: true });
  for (const [name, text] of Object.entries(firefoxSampleFiles())) fs.writeFileSync(path.join(FIREFOX_SAMPLES, name), text);
  console.log(`Written to ${FIREFOX_SAMPLES}: ${Object.keys(firefoxSampleFiles()).join(', ')}`);
}

function verify(args) {
  const file = args[0];
  if (!file) throw new Error('usage: node scripts/selfhost.js verify <file.crx>');
  const r = parseCrx(fs.readFileSync(file));
  console.log(`${r.signatureOk ? 'OK' : 'BAD SIGNATURE'}  extension id ${r.id}`);
  if (!r.signatureOk) process.exitCode = 1;
}

function main(argv) {
  const [command, ...args] = argv;
  try {
    if (command === 'init') init(args);
    else if (command === 'id') console.log(extensionId(publicKeyDer(loadKey(path.resolve(arg(args, 'key', DEFAULT_KEY))))));
    else if (command === 'pack') pack(args);
    else if (command === 'verify') verify(args);
    else if (command === 'firefox') firefox(args);
    else if (command === 'firefox-samples') firefoxSamples();
    else {
      console.log('usage: node scripts/selfhost.js init | id | pack --base-url <https://...> | verify <file.crx> | firefox --base-url <https://...> [--xpi <signed.xpi>] | firefox-samples   (see the top of this file)');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  buildCrx,
  parseCrx,
  extensionId,
  publicKeyDer,
  updateManifest,
  firefox,
  firefoxInstallEntry,
  firefoxPolicyFiles,
  firefoxSampleFiles,
  firefoxUpdateManifest,
  firefoxUpdateUrlCheck,
  inspectXpi,
  readZip,
};
