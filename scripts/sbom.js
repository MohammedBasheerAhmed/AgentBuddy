// Software bill of materials (CycloneDX 1.5 JSON) from package-lock.json. No network.
//
//   node scripts/sbom.js                     print it
//   node scripts/sbom.js --out <file>        write it (docs/review-pack/sbom.cdx.json is kept this way; a test checks it is current)
//
// Which packages are really inside the extension comes from esbuild itself: the entry points of the build (scripts/lib/entries.js) are
// bundled in memory with the build's options (nothing is written) and the node_modules files esbuild read are the shipped ones.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { buildSbom, bundledKeys } = require('./lib/sbom.js');
const { ENTRIES, bundleOptions } = require('./lib/entries.js');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const out = argv[0] === '--out' ? argv[1] : '';
if (argv.length && !out) {
  console.error('Usage: node scripts/sbom.js [--out <file>]');
  process.exit(1);
}

(async () => {
  const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8').replace(/\r\n/g, '\n');
  const lock = JSON.parse(lockText);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const inputs = new Set();
  for (const { entry } of ENTRIES) {
    // eslint-disable-next-line no-await-in-loop
    const result = await esbuild.build({ ...bundleOptions(root), entryPoints: [path.join(root, entry)], write: false, metafile: true, logLevel: 'silent' });
    Object.keys(result.metafile.inputs).forEach((p) => inputs.add(p));
  }
  const sbom = buildSbom({ lock, pkg, bundled: bundledKeys([...inputs]), lockText });
  const text = `${JSON.stringify(sbom, null, 2)}\n`;
  if (out) {
    fs.writeFileSync(out, text);
    const shipped = sbom.components.filter((c) => c.properties.some((p) => p.name === 'agentbuddy:bundled' && p.value === 'true'));
    console.log(`Wrote ${out}: ${sbom.components.length} packages, ${shipped.length} inside the extension (${shipped.map((c) => `${c.name}@${c.version}`).join(', ')}).`);
  } else process.stdout.write(text);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
