// The extension's bundles and the esbuild options they are compiled with, in one place. build.js builds them; scripts/check-compile.js
// compiles them without writing; scripts/sbom.js bundles them in memory to see which packages end up inside. All three read this list,
// so a new entry point added here is built, checked and counted in the SBOM alike (they used to find the entries in build.js with a
// regular expression, which a reformatted line would have broken silently).
const fs = require('fs');
const { browserOf } = require('./browsers.js');

/** Each bundle: its entry point (relative to the project folder) and the file it becomes in the build. */
const ENTRIES = [
  { entry: 'src/background/service-worker.js', outfile: 'background.bundle.js' },
  // The content script and the page bridge are registered at run time (service worker), only on enabled instances.
  { entry: 'src/content/index.js', outfile: 'content.bundle.js' },
  { entry: 'src/page/bridge.js', outfile: 'pagebridge.js' },
  { entry: 'src/sidepanel/index.jsx', outfile: 'sidepanel.bundle.js' },
  { entry: 'src/options/index.jsx', outfile: 'options.bundle.js' },
  // The full-page Team dashboard (opened from the Team tab; reads through the ServiceNow tab named in its address).
  { entry: 'src/dashboard/index.jsx', outfile: 'dashboard.bundle.js' },
];

// A stylesheet imported as text (the dock on the ServiceNow page carries theme.css and bar.css inside content.bundle.js) is read with
// Unix line endings. A Windows checkout with CRLF endings would otherwise put "\r\n" into the bundle, and the same source would give a
// different content.bundle.js, and a different SHA-256, on Windows than on Linux or macOS. (.gitattributes keeps checkouts LF; this
// holds even for a file someone saved with CRLF.)
const cssTextWithLf = {
  name: 'agentbuddy-css-lf',
  setup(build) {
    build.onLoad({ filter: /\.css$/, namespace: 'file' }, (args) => ({ contents: fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n'), loader: 'text' }));
  },
};

/**
 * The esbuild options every tool compiles the entries with. Callers add their own (minify, outfile, metafile, more plugins).
 * @param {string} rootDir the project folder: esbuild's path comments are relative to it, so the output does not depend on where the
 *   build is started
 * @param {string} [browser] the browser family (scripts/lib/browsers.js): the code is compiled for that family's oldest supported
 *   version (Chrome and Edge 116, Firefox 128). An unknown one throws.
 */
function bundleOptions(rootDir, browser = 'chromium') {
  const { target } = browserOf(browser);
  return {
    bundle: true,
    loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'text' },
    jsx: 'automatic',
    target: [...target],
    format: 'iife',
    legalComments: 'none', // the licences of the bundled packages ship as files instead (build.js, licenses/)
    absWorkingDir: rootDir,
    // React's production build: smaller, no development warnings.
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [cssTextWithLf],
  };
}

module.exports = { ENTRIES, bundleOptions };
