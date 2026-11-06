// The release package (TRACKER.md R2): build, then zip the build into release/agentbuddy-<version>.zip with its SHA-256 next to it
// (release/agentbuddy-<version>.zip.sha256, in the format `sha256sum -c` reads). The zip is what is uploaded to the Chrome Web Store
// or the Edge Add-ons site, or hosted by the organisation (docs/deployment.md). The Firefox build is zipped the same way into
// release/agentbuddy-<version>-firefox.zip, manifest.json at the root of the zip, for addons.mozilla.org.
//
//   npm run package                        node build.js (into dist/) and node build.js --browser firefox (into dist-firefox/), then
//                                          zip each: release/agentbuddy-<version>.zip and release/agentbuddy-<version>-firefox.zip
//   node scripts/package.js --dist <dir>   zip a build that is already in <dir> (node build.js --out <dir>); nothing is rebuilt. Its
//                                          manifest says which browser it is for, and so which name the zip gets
//   npm run package -- --minify            the release: minified bundles in release/agentbuddy-<version>.zip, and next to it
//                                          release/agentbuddy-<version>-readable.zip, the same source built without minifying, which is
//                                          what a security reviewer reads (the code is the same; `npm run repro -- --minify` rebuilds both).
//                                          The minified build is made in release/unpacked/ and stays there (load it unpacked, run the
//                                          end-to-end tests on it with E2E_DIST=release/unpacked, or pack it with scripts/selfhost.js
//                                          --dist release/unpacked); dist/, the readable build people load while working, is left alone.
//                                          The minified Firefox build is made in release/unpacked-firefox/ and zipped as above.
//   --browser chromium|firefox             build and zip only that browser's release
//   --out <folder>                         write the zips into <folder> instead of release/
//
// The zip is reproducible: entries in a fixed order, every file dated 1980-01-01 (or SOURCE_DATE_EPOCH), no extra fields, so the
// same build gives the same bytes and the same SHA-256 (scripts/repro-check.js does the same for the build itself).
// No dependency: a small ZIP writer on Node's zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { BROWSERS, BROWSER_IDS, browserOfManifest } = require('./lib/browsers.js');

const root = path.join(__dirname, '..');

// ---- ZIP ------------------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time of a moment (ZIP's own format; it cannot go before 1980). */
function dosDateTime(date) {
  const d = new Date(Math.max(date.getTime(), Date.UTC(1980, 0, 1)));
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, day };
}

/** Every file under `dir`, as forward-slash paths relative to it, sorted (the order of the zip). */
function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return listFiles(full, base);
      return e.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
    })
    .sort();
}

/**
 * A ZIP archive of the files under `dir` (deflated, UTF-8 names, one fixed date).
 * @returns {Buffer}
 */
function zipFolder(dir, { date = new Date(Date.UTC(1980, 0, 1)) } = {}) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of listFiles(dir)) {
    const data = fs.readFileSync(path.join(dir, ...name.split('/')));
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6); // the name is UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by: 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // extra, comment, disk, internal and external attributes: 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const entries = centrals.length / 2;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---- the release ----------------------------------------------------------------------------------------------------------------

function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

const USAGE = `Usage: node scripts/package.js [--browser ${BROWSER_IDS.join('|')}] [--minify] [--dist <folder>] [--out <folder>]`;

function parseArgs(argv) {
  const opts = { minify: false, dist: '', browser: '', out: '' };
  const examples = { '--dist': '--dist dist', '--browser': '--browser firefox', '--out': '--out release' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--minify') opts.minify = true;
    else if (Object.prototype.hasOwnProperty.call(examples, arg)) {
      const value = argv[(i += 1)];
      if (!value || value.startsWith('--')) fail(`${arg} needs a value, for example ${examples[arg]}`);
      opts[arg.slice(2)] = value;
    } else fail(`unknown option "${arg}". ${USAGE}`);
  }
  if (opts.browser && !BROWSER_IDS.includes(opts.browser)) fail(`--browser must be one of ${BROWSER_IDS.join(', ')} (got "${opts.browser}").`);
  return opts;
}

/** The release zip's name: agentbuddy-<version>.zip for Chrome and Edge (as it always was), agentbuddy-<version>-<browser>.zip otherwise. */
function zipNameFor(manifest, browser) {
  return browser === 'chromium' ? `agentbuddy-${manifest.version}.zip` : `agentbuddy-${manifest.version}-${browser}.zip`;
}

const shown = (p) => path.relative(root, p).split(path.sep).join('/') || p;

/**
 * Zips one build into outDir as the release of the browser its manifest is for, with the SHA-256 next to it. Every file is zipped
 * relative to the build folder, so manifest.json is at the root of the zip, as the stores (addons.mozilla.org too) require.
 */
function packageBuild(dist, { outDir, date, expect = '' }) {
  const manifestPath = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`${shown(dist)} has no manifest.json. Build first (node build.js${expect && expect !== 'chromium' ? ` --browser ${expect}` : ''}).`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) fail(`the build is version ${manifest.version} but package.json says ${pkg.version}. Build again.`);
  // The store package is the normal build. An enterprise build has the organisation's sites fixed in it and is deployed on its own.
  if (manifest.host_permissions) fail('this is an enterprise build (it has host_permissions). Package the normal build.');
  const browser = browserOfManifest(manifest);
  if (expect && browser !== expect) fail(`${shown(dist)} holds the ${BROWSERS[browser].name} build, not the ${BROWSERS[expect].name} one.`);

  const zip = zipFolder(dist, date ? { date } : {});
  fs.mkdirSync(outDir, { recursive: true });
  const name = zipNameFor(manifest, browser);
  fs.writeFileSync(path.join(outDir, name), zip);
  const hash = crypto.createHash('sha256').update(zip).digest('hex');
  fs.writeFileSync(path.join(outDir, `${name}.sha256`), `${hash}  ${name}\n`);
  console.log(`Wrote ${shown(path.join(outDir, name))} (${BROWSERS[browser].name}, ${listFiles(dist).length} files, ${zip.length} bytes) from ${shown(dist)}/`);
  console.log(`SHA-256 ${hash}  (${shown(path.join(outDir, name))}.sha256)`);
  return { manifest, browser, name };
}

// npm run package builds and zips every browser family (scripts/lib/browsers.js): release/agentbuddy-<version>.zip for the Chrome Web
// Store and Edge Add-ons, release/agentbuddy-<version>-firefox.zip for addons.mozilla.org. --browser makes only one; --dist zips one
// build that is already there (its manifest says which browser it is for); --out puts the zips in another folder than release/.
function main(argv) {
  const opts = parseArgs(argv);
  const { minify } = opts;
  const outDir = opts.out ? path.resolve(opts.out) : path.join(root, 'release');
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  const date = Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : null;

  if (opts.dist) {
    packageBuild(path.resolve(opts.dist), { outDir, date, expect: opts.browser });
    return;
  }

  const browsers = opts.browser ? [opts.browser] : BROWSER_IDS;
  let chromium = null;
  for (const browser of browsers) {
    // The minified release is built in its own folder (release/unpacked/, release/unpacked-firefox/); the readable build people load
    // while working (dist/, dist-firefox/) is left alone.
    const b = BROWSERS[browser];
    const dist = path.join(root, ...(minify ? b.releaseOut : b.out).split('/'));
    execFileSync(process.execPath, [path.join(root, 'build.js'), '--browser', browser, ...(minify ? ['--minify', '--out', dist] : [])], { cwd: root, stdio: 'inherit' });
    const result = packageBuild(dist, { outDir, date, expect: browser });
    if (browser === 'chromium') chromium = result;
  }

  if (minify && chromium) {
    // The copy for the security review: the same source, bundles not minified, in its own zip.
    const { manifest } = chromium;
    const readableDir = path.join(root, '.build-tmp-readable');
    fs.rmSync(readableDir, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(root, 'build.js'), '--out', readableDir], { cwd: root, stdio: 'inherit' });
    const readableZip = zipFolder(readableDir, date ? { date } : {});
    fs.rmSync(readableDir, { recursive: true, force: true });
    const readableName = `agentbuddy-${manifest.version}-readable.zip`;
    fs.writeFileSync(path.join(outDir, readableName), readableZip);
    const readableHash = crypto.createHash('sha256').update(readableZip).digest('hex');
    fs.writeFileSync(path.join(outDir, `${readableName}.sha256`), `${readableHash}  ${readableName}
`);
    console.log(`Wrote ${shown(path.join(outDir, readableName))} (for the security review, not minified, ${readableZip.length} bytes)`);
    console.log(`SHA-256 ${readableHash}  (${shown(path.join(outDir, readableName))}.sha256)`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { crc32, zipFolder, listFiles, dosDateTime, zipNameFor };
