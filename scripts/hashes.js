// Print the SHA-256 of every file of a build, in `sha256sum` format, so a reviewer can compare a build they made from source with the
// one that is distributed:
//
//   node scripts/hashes.js dist                 print the list
//   node scripts/hashes.js dist --out SHA256SUMS write it to a file instead
//   node scripts/hashes.js dist --check SHA256SUMS   compare the folder with a list; exit 1 on any difference
const fs = require('fs');
const path = require('path');
const { hashFolder, toSha256Sum, compareHashes } = require('./lib/hashes.js');

const USAGE = 'Usage: node scripts/hashes.js <build folder> [--out <file>] [--check <file>]';
const opts = { dir: '', out: '', check: '' };
const argv = process.argv.slice(2);
const stop = (message) => {
  console.error(`${message} ${USAGE}`);
  process.exit(1);
};
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--out' || argv[i] === '--check') {
    // `--check` without a file used to print the hashes and exit 0, as if the check had passed.
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) stop(`${argv[i]} needs a file.`);
    opts[argv[i].slice(2)] = value;
    i += 1;
  } else if (argv[i].startsWith('--')) stop(`Unknown option ${argv[i]}.`);
  else if (!opts.dir) opts.dir = argv[i];
  else stop(`One build folder only (got ${opts.dir} and ${argv[i]}).`);
}
const { dir } = opts;
const valueOf = (flag) => opts[flag.slice(2)];

if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) stop(dir ? `${dir} is not a folder.` : 'Name the build folder.');

const rows = hashFolder(path.resolve(dir));
const check = valueOf('--check');
if (check) {
  const expected = fs
    .readFileSync(check, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => ({ path: m[2], sha256: m[1] }));
  const diff = compareHashes(expected, rows);
  if (diff.same) {
    console.log(`OK: all ${rows.length} files of ${dir} match ${check}.`);
    process.exit(0);
  }
  for (const p of diff.differ) console.log(`DIFFERENT  ${p}`);
  for (const p of diff.onlyLeft) console.log(`MISSING    ${p}`);
  for (const p of diff.onlyRight) console.log(`EXTRA      ${p}`);
  process.exit(1);
}
const text = toSha256Sum(rows);
const out = valueOf('--out');
if (out) {
  fs.writeFileSync(out, text);
  console.log(`Wrote ${rows.length} hashes to ${out}.`);
} else process.stdout.write(text);
