// Builds the extension.
//
//   node build.js                                   dist/, the normal build (load it unpacked, or pack it)
//   node build.js --out <folder>                    the same build into another folder (reviewers, scripts/repro-check.js)
//   node build.js --enterprise <config.json>        an enterprise build into dist-enterprise/ (or --out <folder>): the instances,
//                                                   the AI endpoint and the policy in the config are compiled in (docs/deployment.md)
//   node build.js --minify                          the same build with the bundles minified (what is shipped: smaller, faster to
//                                                   load; the unminified build of the same source is the one a reviewer reads)
//   node build.js --watch                           rebuild on change (the static files are copied again when they change)
//
// The normal build is unaffected by the enterprise options: same manifest, same bundles, src/policy/baked.js left as it is (null).
// The entry points and the esbuild options are in scripts/lib/entries.js (shared with scripts/check-compile.js and scripts/sbom.js).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { collect, loadCatalogue } = require('./scripts/lib/i18nCheck.js');
const { ENTRIES, bundleOptions } = require('./scripts/lib/entries.js');
const { bundledKeys } = require('./scripts/lib/sbom.js');

const rootDir = __dirname;

function fail(message) {
  console.error(`build.js: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { watch: false, minify: false, out: '', enterprise: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (flag === '--watch' && eq < 0) opts.watch = true;
    else if (flag === '--minify' && eq < 0) opts.minify = true;
    else if (flag === '--out' || flag === '--enterprise') {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
      // (.build-tmp-* is in .gitignore, so the example does not leave a folder git would want to add)
      if (!value || value.startsWith('--')) fail(`${flag} needs a value, for example ${flag === '--out' ? '--out .build-tmp-check' : '--enterprise enterprise/example.json'}.`);
      opts[flag.slice(2)] = value;
    } else fail(`unknown option "${arg}". Options: --out <folder>, --enterprise <config.json>, --minify, --watch.`);
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
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
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

const shared = bundleOptions(rootDir); // loader, JSX, target, format, the production define, CSS read with LF endings
const common = {
  ...shared,
  minify: opts.minify, // whitespace, names and syntax; the code is the same, so the tests of the unminified build hold (npm run repro -- --minify)
  sourcemap: false, // no source maps in the shipped build: the review pack ships the source instead
  logLevel: 'info',
  plugins: [...shared.plugins, ...(enterprise ? bakedPlugins() : [])],
};

const builds = ENTRIES.map((b) => ({
  ...common,
  entryPoints: [path.join(rootDir, b.entry)],
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

// The packages bundled into the extension (React, React DOM, scheduler) are MIT licensed, and the MIT licence asks for its notice to go
// with every copy. The bundles keep no comments (legalComments: 'none'), so each bundled package's own licence file is copied to
// licenses/<package>/ in the build. Which packages are inside comes from the files esbuild read, as in scripts/sbom.js; a bundled
// package without a licence file stops the build rather than ship without its notice.
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i;
function copyLicences(inputs) {
  for (const key of bundledKeys(inputs)) {
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const files = fs.readdirSync(path.join(rootDir, key)).filter((f) => LICENCE_FILE.test(f)).sort();
    if (!files.length) fail(`${name} is bundled into the extension but ${key}/ has no licence file to ship with it.`);
    const to = path.join(outdir, 'licenses', ...name.split('/'));
    fs.mkdirSync(to, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(to, f), readText(path.join(key, f)));
  }
}

// --watch: esbuild watches the code; the static files are not in its graph, so they are watched here and copied again, once per burst
// of changes (one save in an editor can fire several events, a branch switch many).
function watchStatic() {
  let timer = null;
  const recopy = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        copyStatic();
        console.log(`Copied the static files again (${new Date().toLocaleTimeString()}).`);
      } catch (err) {
        console.error(`Could not copy the static files: ${err.message}`); // (a file half-written by the editor: the next save copies it)
      }
    }, 200);
  };
  const watchDir = (rel, wanted) => {
    try {
      fs.watch(path.join(rootDir, rel), (event, name) => {
        if (!name || wanted(String(name))) recopy();
      });
    } catch (err) {
      console.error(`Not watching ${rel}: ${err.message}`);
    }
  };
  watchDir('.', (name) => name === 'manifest.json' || name === 'managed_schema.json');
  for (const dir of ['src/sidepanel', 'src/options', 'src/dashboard']) watchDir(dir, (name) => name.endsWith('.html'));
  watchDir('src/ui', (name) => name.endsWith('.css'));
  if (fs.existsSync(path.join(rootDir, 'src/ui/areas'))) watchDir('src/ui/areas', (name) => name.endsWith('.css'));
  watchDir('assets/icons', () => true);
}

// In an enterprise build every bundle that reads the policy must carry the config's policy, never the empty one.
function checkBaked() {
  const bundles = fs.readdirSync(outdir).filter((f) => f.endsWith('.js'));
  const carrying = bundles.filter((f) => fs.readFileSync(path.join(outdir, f), 'utf8').includes('src/policy/baked.js'));
  const empty = carrying.filter((f) => /BAKED_POLICY\d*\s*=\s*null/.test(fs.readFileSync(path.join(outdir, f), 'utf8')));
  if (!carrying.includes('sidepanel.bundle.js') || empty.length) fail(`the policy was not compiled into ${empty.join(', ') || 'the side panel'}; the build in ${outdir} is not usable.`);
}

// Each bundle carries only the Arabic texts its own code can ask for (the texts written as t('...'), tn(), tm(), tx() in the files that
// end up in it), not the whole catalogue: the script that runs on every ServiceNow page would otherwise grow by about 700 KB. The files
// that end up in a bundle are found with a first, throw-away build; the catalogue module is then replaced by that subset.
const AR_INDEX = /(^|[\\/])i18n[\\/]ar[\\/]index\.js$|^\.\/ar\/index\.js$/;
const catalogueModule = (table) => ({
  name: 'ab-i18n-catalogue',
  setup(b) {
    b.onResolve({ filter: /ar[\\/]index\.js$/ }, (a) => (AR_INDEX.test(a.path) && /i18n/.test(a.importer) ? { path: 'ar-catalogue', namespace: 'ab-i18n' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'ab-i18n' }, () => ({ contents: `export const AR = Object.freeze(${JSON.stringify(table)});`, loader: 'js' }));
  },
});
let fullCatalogue = null;
async function buildOne(b) {
  if (isWatch) return esbuild.build(b); // (watching builds with the whole catalogue: the subset is for what is shipped)
  fullCatalogue = fullCatalogue || loadCatalogue('ar');
  const probe = await esbuild.build({ ...b, write: false, metafile: true, logLevel: 'silent', plugins: [...(b.plugins || []), catalogueModule({})] });
  const files = Object.keys(probe.metafile.inputs).map((p) => path.join(rootDir, p)).filter((p) => /[\\/]src[\\/].*\.(js|jsx)$/.test(p));
  const { keys } = collect(files);
  const subset = {};
  for (const key of [...keys.keys()].sort()) if (fullCatalogue[key] !== undefined) subset[key] = fullCatalogue[key];
  // (the metafile names the files that went into the bundle: copyLicences reads it)
  return esbuild.build({ ...b, metafile: true, plugins: [...(b.plugins || []), catalogueModule(subset)] });
}

const shownOut = (path.relative(rootDir, outdir) || outdir).split(path.sep).join('/');

async function main() {
  copyStatic();
  if (isWatch) {
    // (a watch build is for development and carries no licence files; a normal build copies them)
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(contexts.map((c) => c.watch()));
    watchStatic();
    console.log('Watching for changes. The static files (manifest, html, css, icons) are copied again when they change.');
    return;
  }
  const results = await Promise.all(builds.map((b) => buildOne(b)));
  copyLicences(results.flatMap((r) => Object.keys(r.metafile.inputs)));
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
