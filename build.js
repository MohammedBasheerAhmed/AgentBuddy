// Builds the extension.
//
//   node build.js                                   dist/, the normal build (load it unpacked, or pack it)
//   node build.js --out <folder>                    the same build into another folder (reviewers, scripts/repro-check.js)
//   node build.js --enterprise <config.json>        an enterprise build into dist-enterprise/ (or --out <folder>): the instances,
//                                                   the AI endpoint and the policy in the config are compiled in (docs/deployment.md)
//   node build.js --watch                           rebuild on change (static files are copied once)
//
// The normal build is unaffected by the enterprise options: same manifest, same bundles, src/policy/baked.js left as it is (null).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;

function fail(message) {
  console.error(`build.js: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { watch: false, out: '', enterprise: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === '--watch' && eq < 0) opts.watch = true;
    else if (flag === '--out' || flag === '--enterprise') {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
      if (!value || value.startsWith('--')) fail(`${flag} needs a value, for example ${flag === '--out' ? '--out build-check' : '--enterprise enterprise/example.json'}.`);
      opts[flag.slice(2)] = value;
    } else fail(`unknown option "${arg}". Options: --out <folder>, --enterprise <config.json>, --watch.`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const isWatch = opts.watch;
const defaultOut = path.join(rootDir, 'dist');
const outdir = opts.out ? path.resolve(process.cwd(), opts.out) : opts.enterprise ? path.join(rootDir, 'dist-enterprise') : defaultOut;

// Folders of the project a build must never delete or write into.
const PROTECTED = new Set(['src', 'assets', 'docs', 'tests', 'scripts', 'e2e', 'enterprise', 'node_modules', '.git']);
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const realOrSelf = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

// The output folder is emptied before building, so it must be one that is safe to empty.
function checkOutDir(dir) {
  const real = realOrSelf(dir);
  const root = realOrSelf(rootDir);
  if (path.parse(real).root.toLowerCase() === real.toLowerCase()) fail('the output folder cannot be the root of a drive.');
  const down = path.relative(root.toLowerCase(), real.toLowerCase());
  const up = path.relative(real.toLowerCase(), root.toLowerCase());
  if (!down) fail('the output folder cannot be the project folder itself.');
  if (!up.startsWith('..') && !path.isAbsolute(up)) fail('the output folder cannot contain the project folder.');
  const inside = !down.startsWith('..') && !path.isAbsolute(down);
  if (inside && PROTECTED.has(down.split(path.sep)[0])) fail(`the output folder cannot be inside ${down.split(path.sep)[0]}/.`);
  if (opts.enterprise && same(dir, defaultOut)) fail('an enterprise build never goes into dist/ (that is the normal build). Use --out with another folder.');
  if (same(dir, defaultOut)) return; // the normal build replaces dist/ as it always has
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) fail(`${dir} is a file, not a folder.`);
    const entries = fs.readdirSync(dir);
    if (entries.length && !entries.includes('manifest.json')) fail(`${dir} is not empty and does not look like an earlier build (no manifest.json), so it is left alone.`);
  }
}

// ---- enterprise config --------------------------------------------------------------------------------------------------------

let enterprise = null; // { plan, source, configPath }
if (opts.enterprise) {
  const configPath = path.resolve(process.cwd(), opts.enterprise);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    fail(`cannot read the enterprise config ${configPath}: ${err.message}`);
  }
  // The checks are the extension's own code (src/policy/enterprise.js), bundled for Node.
  const { loadEsm } = require('./scripts/lib/load-esm.js');
  const tools = loadEsm(rootDir, 'src/policy/enterprise.js');
  const checked = tools.validateEnterpriseConfig(raw);
  if (!checked.ok) fail(`the enterprise config ${path.relative(process.cwd(), configPath) || configPath} has problems; nothing was built:\n  - ${checked.errors.join('\n  - ')}`);
  enterprise = { plan: checked.plan, tools, configPath, source: tools.bakedModuleSource(checked.plan.policy, checked.plan.label) };
}

checkOutDir(outdir);
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

// ---- bundles ------------------------------------------------------------------------------------------------------------------

// Replaces src/policy/baked.js with the config's policy, in the enterprise build only.
const bakedPlugins = () => {
  const { bakedPolicyPlugin } = require('./scripts/lib/baked-plugin.js');
  return [bakedPolicyPlugin(enterprise.source, enterprise.tools.BAKED_MODULE_FILTER)];
};

const common = {
  bundle: true,
  minify: false,
  sourcemap: false, // no source maps in the shipped build: the review pack ships the source instead
  logLevel: 'info',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'text' },
  jsx: 'automatic',
  target: ['chrome116', 'edge116'],
  format: 'iife',
  legalComments: 'none',
  // The path comments esbuild writes are relative to this folder, so the output does not depend on where the build is started.
  absWorkingDir: rootDir,
  // React's production build: smaller, no development warnings. Not minified, so the bundle stays readable for review.
  define: { 'process.env.NODE_ENV': '"production"' },
  ...(enterprise ? { plugins: bakedPlugins() } : {}),
};

const builds = [
  { entryPoints: ['src/background/service-worker.js'], outfile: 'background.bundle.js' },
  // The content script and the page bridge are registered at run time (service worker), only on enabled instances.
  { entryPoints: ['src/content/index.js'], outfile: 'content.bundle.js' },
  { entryPoints: ['src/page/bridge.js'], outfile: 'pagebridge.js' },
  { entryPoints: ['src/sidepanel/index.jsx'], outfile: 'sidepanel.bundle.js' },
  { entryPoints: ['src/options/index.jsx'], outfile: 'options.bundle.js' },
  // The full-page Team dashboard (opened from the Team tab; reads through the ServiceNow tab named in its address).
  { entryPoints: ['src/dashboard/index.jsx'], outfile: 'dashboard.bundle.js' },
].map((b) => ({
  ...common,
  entryPoints: b.entryPoints.map((e) => path.join(rootDir, e)),
  outfile: path.join(outdir, b.outfile),
}));

// Text files are copied with Unix line endings, so a checkout on Windows (git autocrlf) builds the same bytes as one on Linux or macOS.
const readText = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8').replace(/\r\n/g, '\n');

function copyStatic() {
  const copyText = (from, to = path.basename(from)) => fs.writeFileSync(path.join(outdir, to), readText(from));
  if (enterprise) {
    const manifest = enterprise.tools.enterpriseManifest(JSON.parse(readText('manifest.json')), enterprise.plan);
    fs.writeFileSync(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    copyText('manifest.json');
  }
  copyText('managed_schema.json');
  copyText('src/sidepanel/sidepanel.html');
  copyText('src/options/options.html');
  copyText('src/dashboard/dashboard.html');
  fs.mkdirSync(path.join(outdir, 'icons'), { recursive: true });
  fs.readdirSync(path.join(rootDir, 'assets/icons')).forEach((f) => fs.copyFileSync(path.join(rootDir, 'assets/icons', f), path.join(outdir, 'icons', f)));
  // One stylesheet shared by the side panel, the settings page and the dashboard page: theme.css, ui.css, then one file per area
  // (src/ui/areas/*.css, alphabetical) so the areas do not edit the same file.
  const areaDir = path.join(rootDir, 'src/ui/areas');
  const areas = fs.existsSync(areaDir) ? fs.readdirSync(areaDir).filter((f) => f.endsWith('.css')).sort().map((f) => path.join('areas', f)) : [];
  const css = ['theme.css', 'ui.css', ...areas].map((f) => readText(path.join('src/ui', f))).join('\n');
  fs.writeFileSync(path.join(outdir, 'agentbuddy.css'), css);
}

// In an enterprise build every bundle that reads the policy must carry the config's policy, never the empty one.
function checkBaked() {
  const bundles = fs.readdirSync(outdir).filter((f) => f.endsWith('.js'));
  const carrying = bundles.filter((f) => fs.readFileSync(path.join(outdir, f), 'utf8').includes('src/policy/baked.js'));
  const empty = carrying.filter((f) => /BAKED_POLICY\d*\s*=\s*null/.test(fs.readFileSync(path.join(outdir, f), 'utf8')));
  if (!carrying.includes('sidepanel.bundle.js') || empty.length) fail(`the policy was not compiled into ${empty.join(', ') || 'the side panel'}; the build in ${outdir} is not usable.`);
}

const shownOut = (path.relative(rootDir, outdir) || outdir).split(path.sep).join('/');

async function main() {
  copyStatic();
  if (isWatch) {
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('Watching for changes. Static files (manifest, html, css) are copied once; rebuild to refresh them.');
    return;
  }
  await Promise.all(builds.map((b) => esbuild.build(b)));
  if (enterprise) {
    checkBaked();
    const { plan } = enterprise;
    console.log(
      [
        `Built the enterprise build${plan.label ? ` "${plan.label}"` : ''} in ${shownOut}/ from ${path.relative(rootDir, enterprise.configPath).split(path.sep).join('/')}.`,
        `  instances:        ${plan.instances.join(', ')}`,
        `  AI endpoint:      ${plan.ai.provider} at ${plan.ai.baseUrl}`,
        `  host_permissions: ${plan.hostPermissions.join(', ')}`,
        `  connect-src:      ${plan.connectSrc.join(' ')}`,
        '  The compiled-in policy is a floor: the browser\'s managed policy can only make it stricter.',
      ].join('\n')
    );
    return;
  }
  console.log(same(outdir, defaultOut) ? 'Built dist/. Load it as an unpacked extension.' : `Built ${shownOut}/. Load it as an unpacked extension.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
