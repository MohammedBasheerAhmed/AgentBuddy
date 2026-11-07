// End-to-end run in Microsoft Edge: the same harness and the same scenarios as the Chrome run (e2e/run.js), with Edge as the browser.
// Edge is Chromium: puppeteer-core loads the unpacked extension into it the same way (the extension build is the one Chrome uses,
// dist/). Audit of 2026-11-07, S17 and S18: Edge had no automated run; the first run on Edge 156 passed scenario a, and the full suite is
// in the CHANGELOG.
//
//   npm run e2e:edge                  rebuilds dist/ first, then runs every scenario in Edge
//   node e2e/edge.js [a,c,g]          only some scenarios (dist/ must be built already)
//   node e2e/edge.js --headed         show the browser (needs a display)
//
// EDGE_PATH names the Edge to drive; without it the usual places are tried (Windows, macOS, Linux). Nothing is downloaded. As in the
// Chrome run, the real side panel, the toolbar button and the keyboard shortcuts cannot be driven by automation: the panel's page is
// opened in a window of its own. The panel-only-on-added-sites rule (docs/panel-scope.md) is therefore not covered here either.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/opt/microsoft/msedge/msedge',
].filter(Boolean);

const edge = CANDIDATES.find((candidate) => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
});

if (!edge) {
  console.error('Microsoft Edge was not found. Set EDGE_PATH to its program (msedge.exe on Windows). Tried:\n  ' + CANDIDATES.join('\n  '));
  process.exit(2);
}

console.log(`Edge: ${edge}`);
const run = spawnSync(process.execPath, [path.join(__dirname, 'run.js'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CHROME_PATH: edge },
});
process.exit(run.status === null ? 1 : run.status);
