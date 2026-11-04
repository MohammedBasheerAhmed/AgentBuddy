// Compiles every entry point of the build (scripts/lib/entries.js, the list build.js uses) WITHOUT writing anything, so it is safe to
// run while someone else builds dist/. Use it after UI or content-script changes:  node scripts/check-compile.js
//
// A warning fails the check too: esbuild warns about code that compiles but is very likely wrong (a duplicate key in an object, a
// comparison with -0 or NaN, an import that does not exist, `typeof x == "undefiend"`), and the normal build prints its warnings
// among many lines where they are easy to miss.
const esbuild = require('esbuild');
const path = require('path');
const { ENTRIES, bundleOptions } = require('./lib/entries.js');

const root = path.join(__dirname, '..');
const where = (m) => (m.location ? `${m.location.file}:${m.location.line} ` : '');

(async () => {
  let failed = 0;
  for (const { entry } of ENTRIES) {
    try {
      const result = await esbuild.build({ ...bundleOptions(root), entryPoints: [path.join(root, entry)], write: false, logLevel: 'silent' });
      if (result.warnings.length) {
        failed += 1;
        console.log(`WARN  ${entry}\n${result.warnings.map((w) => `      ${where(w)}${w.text}`).join('\n')}`);
      } else console.log(`ok    ${entry}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${entry}\n${(err.errors || []).map((e) => `      ${where(e)}${e.text}`).join('\n') || err.message}`);
    }
  }
  if (failed) console.log(`\n${failed} of ${ENTRIES.length} entries have errors or warnings.`);
  process.exit(failed ? 1 : 0);
})();
