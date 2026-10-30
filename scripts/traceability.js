// Writes docs/review-pack/traceability.md: every control of docs/security.md (section 4) and every threat of
// docs/review-pack/stride.md, with the test files that enforce it, and whether those files exist.
//
//   node scripts/traceability.js           write the matrix
//   node scripts/traceability.js --check   write nothing; exit 1 when a named test file is missing (in security.md, deployment.md or
//                                          any review-pack document) or when traceability.md is out of date
const fs = require('fs');
const path = require('path');
const { buildMatrix, renderMatrix, missingRefs } = require('./lib/traceability.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const testFiles = fs.readdirSync(path.join(root, 'tests')).map((f) => `tests/${f}`);
const out = path.join(root, 'docs/review-pack/traceability.md');

const rows = buildMatrix({ security: read('docs/security.md'), stride: read('docs/review-pack/stride.md') }, testFiles);
const text = renderMatrix(rows);

if (process.argv.includes('--check')) {
  const docs = ['docs/security.md', 'docs/deployment.md', ...fs.readdirSync(path.join(root, 'docs/review-pack')).filter((f) => f.endsWith('.md')).map((f) => `docs/review-pack/${f}`)];
  const problems = docs.flatMap((doc) => missingRefs(read(doc), testFiles).map((ref) => `${doc} names ${ref}, which does not exist`));
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== text) problems.push('docs/review-pack/traceability.md is out of date: run node scripts/traceability.js');
  problems.forEach((p) => console.log(`FAIL  ${p}`));
  if (!problems.length) console.log(`ok    ${rows.length} controls and threats; every named test file exists; traceability.md is current.`);
  process.exit(problems.length ? 1 : 0);
}

fs.writeFileSync(out, text);
const missing = rows.filter((r) => r.missing.length);
console.log(`Wrote docs/review-pack/traceability.md: ${rows.length} rows${missing.length ? `, ${missing.length} name a missing test file` : ''}.`);
