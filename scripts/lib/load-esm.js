// Loads one of the extension's ES modules (src/**) into a Node script. esbuild bundles it to CommonJS in a fresh temporary folder,
// which is required and then removed. Used by build.js (--enterprise) and scripts/check-policy.js, so the build tools check configs
// and policies with exactly the code the extension runs. Nothing is evaluated from a string.
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadEsm(rootDir, entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-esm-'));
  const outfile = path.join(dir, 'module.cjs');
  try {
    esbuild.buildSync({
      entryPoints: [path.join(rootDir, entry)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
      loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'text' },
      jsx: 'automatic',
      absWorkingDir: rootDir,
    });
    return require(outfile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { loadEsm };
