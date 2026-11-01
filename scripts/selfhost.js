// The self-hosted install (TRACKER.md R3): turn a build into what an organisation puts on its own web server, and into the policy files
// that make Chrome and Edge install and update Agent Buddy from there.
//
//   node scripts/selfhost.js init   [--key <file>]              make the signing key (once) and print the extension id
//   node scripts/selfhost.js id     [--key <file>]              print the extension id of a key
//   node scripts/selfhost.js pack   --base-url <https address> [--dist <folder>] [--key <file>] [--out <folder>]
//       dist      the build to pack (default dist-enterprise if it exists, else dist; build it first: npm run build)
//       base-url  the https folder the files will be served from, for example https://extensions.corp.example/agentbuddy
//       key       the signing key (default selfhost/agentbuddy-key.pem); the SAME key every time: it is what makes the extension id
//       out       where to write (default selfhost/out)
//   writes  agentbuddy-<version>.crx   the signed package (CRX3)
//           update.xml                 the update manifest the browsers poll (served from <base-url>/update.xml)
//           policies/                  the sample policy files of docs/review-pack with the extension id and the update address filled in
//           SHA256SUMS                 the hashes of the files above
//   node scripts/selfhost.js verify <file.crx>                  check a package: format, signature, extension id
//
// The key: whoever holds it can publish an update that every installed copy will accept. Keep it off the web server, back it up, never
// put it in the repository (selfhost/ and *.pem are in .gitignore). Lose it and the extension id changes: everyone must be reinstalled.
//
// No dependency: Node's crypto signs, and the zip comes from scripts/package.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { zipFolder } = require('./package.js');

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

function arg(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
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
  const baseUrl = String(arg(args, 'base-url', '')).replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+/.test(baseUrl)) throw new Error('--base-url must be the https address the files will be served from, for example https://extensions.corp.example/agentbuddy');
  const enterprise = path.join(root, 'dist-enterprise');
  const dist = path.resolve(arg(args, 'dist', fs.existsSync(enterprise) ? enterprise : path.join(root, 'dist')));
  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`${dist} has no manifest.json. Build first: npm run build (or npm run build:enterprise -- enterprise/<name>.json).`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
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
    else {
      console.log('usage: node scripts/selfhost.js init | id | pack --base-url <https://...> | verify <file.crx>   (see the top of this file)');
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { buildCrx, parseCrx, extensionId, publicKeyDer, updateManifest };
