const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const rootDir = __dirname;
const outdir = path.join(rootDir, 'dist');

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const common = {
  bundle: true,
  minify: false,
  sourcemap: false, // no source maps in the shipped build: the review pack ships the source instead
  logLevel: 'info',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  jsx: 'automatic',
  target: ['chrome116', 'edge116'],
  format: 'iife',
  legalComments: 'none',
};

const builds = [
  { entryPoints: ['src/background/service-worker.js'], outfile: 'background.bundle.js' },
  // The content script and the page bridge are registered at run time (service worker), only on enabled instances.
  { entryPoints: ['src/content/index.js'], outfile: 'content.bundle.js' },
  { entryPoints: ['src/page/bridge.js'], outfile: 'pagebridge.js' },
  { entryPoints: ['src/sidepanel/index.jsx'], outfile: 'sidepanel.bundle.js' },
  { entryPoints: ['src/options/index.jsx'], outfile: 'options.bundle.js' },
].map((b) => ({
  ...common,
  entryPoints: b.entryPoints.map((e) => path.join(rootDir, e)),
  outfile: path.join(outdir, b.outfile),
}));

function copyStatic() {
  const copy = (from, to = path.basename(from)) => fs.copyFileSync(path.join(rootDir, from), path.join(outdir, to));
  copy('manifest.json');
  copy('managed_schema.json');
  copy('src/sidepanel/sidepanel.html');
  copy('src/options/options.html');
  fs.mkdirSync(path.join(outdir, 'icons'), { recursive: true });
  fs.readdirSync(path.join(rootDir, 'assets/icons')).forEach((f) => fs.copyFileSync(path.join(rootDir, 'assets/icons', f), path.join(outdir, 'icons', f)));
  // One stylesheet shared by the side panel and the settings page.
  const css = ['theme.css', 'ui.css']
    .map((f) => fs.readFileSync(path.join(rootDir, 'src/ui', f), 'utf8'))
    .join('\n');
  fs.writeFileSync(path.join(outdir, 'agentbuddy.css'), css);
}

async function main() {
  copyStatic();
  if (isWatch) {
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('Watching for changes. Static files (manifest, html, css) are copied once; rebuild to refresh them.');
    return;
  }
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log('Built dist/. Load it as an unpacked extension.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
