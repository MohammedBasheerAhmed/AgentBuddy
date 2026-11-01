// Reproducible-build check: builds the extension twice, from the same source, into two fresh temporary folders, and compares the
// SHA-256 of every file. Prints the list of hashes (sha256sum format) for the review pack.
//
//   node scripts/repro-check.js                                       the normal build
//   node scripts/repro-check.js --enterprise enterprise/example.json  an enterprise build
//   node scripts/repro-check.js --write SHA256SUMS                    also write the list to a file
//
// Exit code 0 when both builds are identical, 1 when they differ (each differing file is named). The temporary folders are removed.
// Run it on a quiet tree: a source file that changes between the two builds is reported as a difference.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashFolder, toSha256Sum, compareHashes } = require('./lib/hashes.js');

const root = path.join(__dirname, '..');
const argv = process.argv.slice(2);
let enterprise = '';
let minify = false;
let write = '';
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--enterprise') enterprise = argv[(i += 1)] || '';
  else if (argv[i] === '--minify') minify = true;
  else if (argv[i] === '--write') write = argv[(i += 1)] || '';
  else {
    console.error(`Unknown option ${argv[i]}. Usage: node scripts/repro-check.js [--enterprise <config.json>] [--minify] [--write <file>]`);
    process.exit(1);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-repro-'));
const build = (name) => {
  const out = path.join(work, name);
  const args = [path.join(root, 'build.js'), '--out', out, ...(enterprise ? ['--enterprise', path.resolve(enterprise)] : []), ...(minify ? ['--minify'] : [])];
  // Started from another folder on purpose: the output must not depend on where the build runs.
  const result = spawnSync(process.execPath, args, { cwd: name === 'a' ? root : work, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Build ${name} failed:\n${result.stdout}\n${result.stderr}`);
    fs.rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
  return hashFolder(out);
};

try {
  const first = build('a');
  const second = build('b');
  const diff = compareHashes(first, second);
  const list = toSha256Sum(first);
  if (write) fs.writeFileSync(write, list);
  process.stdout.write(list);
  if (!diff.same) {
    for (const p of diff.differ) console.error(`DIFFERENT  ${p}`);
    for (const p of [...diff.onlyLeft, ...diff.onlyRight]) console.error(`ONLY IN ONE BUILD  ${p}`);
    console.error('The two builds differ: the build is not reproducible (or the source changed while it ran).');
    process.exitCode = 1;
  } else {
    console.error(`Reproducible: two ${enterprise ? 'enterprise ' : ''}builds gave the same ${first.length} files, byte for byte.${write ? ` Hashes written to ${write}.` : ''}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
