// Compiles every entry point listed in build.js WITHOUT writing anything (so it is safe to run while someone else builds
// dist/). Use it after UI or content-script changes:  node scripts/check-compile.js
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'build.js'), 'utf8');
const entries = [...source.matchAll(/entryPoints:\s*\['([^']+)'\]/g)].map((m) => m[1]);
if (!entries.length) {
  console.error('No entry points found in build.js');
  process.exit(1);
}

(async () => {
  let failed = 0;
  for (const entry of entries) {
    try {
      await esbuild.build({
        entryPoints: [path.join(root, entry)],
        bundle: true,
        write: false,
        logLevel: 'silent',
        loader: { '.js': 'jsx', '.jsx': 'jsx' },
        jsx: 'automatic',
        target: ['chrome116'],
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"production"' },
      });
      console.log(`ok    ${entry}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${entry}\n${(err.errors || []).map((e) => `      ${e.location ? `${e.location.file}:${e.location.line} ` : ''}${e.text}`).join('\n') || err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
