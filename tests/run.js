// Bundles each tests/*.test.js with esbuild (so tests import src/ ES modules as-is)
// and runs them with the built-in Node test runner.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
// Per process, so two test runs at once do not delete each other's bundles.
// Kept one level below the root: some tests read source files relative to their bundle.
const outdir = path.join(root, `.test-dist-${process.pid}`);
const cleanUp = () => fs.rmSync(outdir, { recursive: true, force: true });
cleanUp();
// The bundles are removed however the run ends: a failed build, a crash, or Ctrl+C while the tests run (a signal ends the process
// without running `finally`, so it is turned into an ordinary exit, which runs the 'exit' handler).
process.on('exit', cleanUp);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

// `node tests/run.js notify` runs only the test files whose name contains "notify" (several parallel workers share the tree).
const only = process.argv[2];
const entries = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js') && (!only || f.includes(only)))
  .map((f) => path.join(__dirname, f));
// A filter that matches nothing is a mistake (a typo, a renamed file), not a pass: with no files, `node --test` would search the
// folder by itself and could report success without running what was meant.
if (!entries.length) {
  console.error(only ? `tests/run.js: no test file name contains "${only}". Nothing was run.` : 'tests/run.js: no *.test.js files in tests/.');
  process.exit(1);
}

esbuild
  .build({
    entryPoints: entries,
    outdir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning',
    loader: { '.js': 'jsx' },
    // The same JSX runtime as build.js: the views do not import React for their JSX, and the tests see the code as it is shipped.
    jsx: 'automatic',
  })
  .then(
    () => {
      const files = entries.map((f) => path.join(outdir, path.basename(f)));
      const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
      if (result.error) console.error(`tests/run.js: could not start the test runner: ${result.error.message}`);
      process.exit(result.status ?? 1);
    },
    (err) => {
      // esbuild has printed the errors (logLevel 'warning'); say what failed in case it did not (an error before bundling started).
      console.error(`tests/run.js: the test bundles could not be built: ${err?.errors?.length ? `${err.errors.length} error(s), see above` : err?.stack || err}`);
      process.exit(1);
    }
  );
