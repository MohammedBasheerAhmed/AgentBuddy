// SHA-256 of every file in a folder, in the format of `sha256sum` (so `sha256sum -c` can check it on Linux and macOS):
//   <64 hex digits><two spaces><path with forward slashes>
// Lines are sorted by path, so the same folder always gives the same text. Used by scripts/hashes.js and scripts/repro-check.js.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function filesIn(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesIn(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** [{ path, sha256, bytes }] for every file under `dir`, sorted by path. */
function hashFolder(dir) {
  return filesIn(dir)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((rel) => {
      const data = fs.readFileSync(path.join(dir, ...rel.split('/')));
      return { path: rel, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length };
    });
}

const toSha256Sum = (rows) => rows.map((r) => `${r.sha256}  ${r.path}\n`).join('');

/** Differences between two hash lists: files only in one, and files whose hash differs. */
function compareHashes(a, b) {
  const left = new Map(a.map((r) => [r.path, r.sha256]));
  const right = new Map(b.map((r) => [r.path, r.sha256]));
  const onlyLeft = [...left.keys()].filter((p) => !right.has(p));
  const onlyRight = [...right.keys()].filter((p) => !left.has(p));
  const differ = [...left.keys()].filter((p) => right.has(p) && right.get(p) !== left.get(p));
  return { same: !onlyLeft.length && !onlyRight.length && !differ.length, onlyLeft, onlyRight, differ };
}

module.exports = { filesIn, hashFolder, toSha256Sum, compareHashes };
