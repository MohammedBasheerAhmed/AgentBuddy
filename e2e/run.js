// End-to-end run: real Chrome + the built extension + a fake ServiceNow (HTTPS) + a fake AI endpoint.
//
//   npm run e2e                   rebuilds dist/ first, then runs every scenario (about two minutes)
//   node e2e/run.js [a,c,g]       run only some scenarios (dist/ must be built already); an id that is not a scenario stops the run
//   node e2e/run.js --headed      show the browser (needs a display)
//
// Needs puppeteer-core, a pinned devDependency (npm ci installs it), and a Chrome to drive (CHROME_PATH).
// The real manifest is never modified: the harness patches a temp COPY (see e2e/harness.js).
//
// Environment: CHROME_PATH (default: Chrome in Program Files), E2E_DIST (test a build in another folder, for example the minified
//   one: node build.js --minify --out .build-tmp-min), AB_E2E_TMP (the folder for the run's files; default a new one per run),
//   E2E_HEADED=1, E2E_SCENARIO_TIMEOUT_MS, E2E_RUN_TIMEOUT_MS, and E2E_MUTATE=write|leak|beacon: breaks a COPY of the extension on
//   purpose to show that the run then fails (a self-check of the harness, see MUTATIONS in e2e/harness.js).
const fs = require('fs');
const path = require('path');

try {
  require.resolve('puppeteer-core');
} catch {
  console.error('puppeteer-core is not installed. Run: npm ci (it is a pinned devDependency in package.json)');
  process.exit(2);
}

const { createContext } = require('./harness.js');
const { Checker } = require('./checker.js');

// Ctrl+C or a stop from CI ends the run through process.exit, so the 'exit' handlers run: puppeteer's closes Chrome, the harness's removes
// the TLS key and the extension copy (a signal alone would end the process without either).
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

// Scenarios are every file in e2e/scenarios/ (a new area adds <letter>-<name>.js; nothing here to edit). Each exports { id, title, run }.
// Order: alphabetical, except e-readonly (it re-checks every request of the whole run) which goes last.
const SCENARIO_FILES = fs.readdirSync(path.join(__dirname, 'scenarios')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
// A scenario file that does not load (a syntax error while someone edits it) fails as that scenario only: the others still run.
function loadScenario(file) {
  try {
    return require(path.join(__dirname, 'scenarios', file));
  } catch (err) {
    const id = file.split('-')[0];
    return {
      id,
      title: `${file} (the file did not load)`,
      run: async (t) => t.check(`scenario file ${file}.js loads`, false, String(err?.message || err).split('\n')[0]),
    };
  }
}
const SCENARIOS = [...SCENARIO_FILES.filter((f) => f !== 'e-readonly'), ...SCENARIO_FILES.filter((f) => f === 'e-readonly')].map(loadScenario);

const SCENARIO_TIMEOUT_MS = Number(process.env.E2E_SCENARIO_TIMEOUT_MS) || 45000; // a normal scenario takes 3 to 15 seconds
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS) || 420000; // a normal run takes under three minutes; the whole run stays under seven minutes even when steps time out

const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

const withTimeout = (promise, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};

// After a scenario failed or timed out: close what it left open so the next one starts clean (each step is time-boxed).
async function tidy(ctx) {
  const boxed = (p) => Promise.race([Promise.resolve(p).catch(() => {}), after(3000)]);
  await boxed(ctx.ext(async () => {
    for (const w of await chrome.windows.getAll()) if (w.type === 'popup') await chrome.windows.remove(w.id);
  }));
  for (const page of await Promise.race([ctx.browser.pages(), after(3000, [])])) if (page !== ctx.ctl) await boxed(page.close());
}

// What a failed scenario leaves behind, written so a run on a machine nobody can sit at (CI) still says what the browser looked like:
// every open page (its address, what a person would read on it, a screenshot when the page paints), which window and tab the browser
// calls active and focused (the side panel reads "the active tab of the last focused window"), and the last errors of the run.
async function describeFailure(ctx, id) {
  const boxed = (p, fallback) => Promise.race([Promise.resolve(p).catch(() => fallback), after(3000, fallback)]);
  const say = (line) => console.log(`        ${line}`);
  const pages = await boxed(ctx.browser.pages(), []);
  say(`${pages.length} page(s) open after scenario ${id} failed`);
  for (const page of pages) {
    const url = page.url();
    const text = await boxed(page.evaluate((max) => document.body.innerText.replace(/\s+/g, ' ').slice(0, max), url.startsWith('chrome-extension') ? 1400 : 300),'(no text: the page did not answer)');
    say(`page ${url.slice(0, 90)}  closed=${page.isClosed()}  text: ${text}`);
    const file = await ctx.shot(page, `fail-${id}-${url.split('/').pop().slice(0, 20)}`);
    if (file) say(`  screenshot -> ${file}`);
  }
  const windows = await boxed(
    ctx.ext(async () => {
      const all = await chrome.windows.getAll({ populate: true });
      const last = await chrome.windows.getLastFocused();
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return [`last focused window ${last.id}; the panel would look at tab ${active?.id} ${(active?.url || '').slice(0, 60)}`].concat(all.map((w) => `window ${w.id} ${w.type} focused=${w.focused} state=${w.state} tabs=[${(w.tabs || []).map((tab) => `${tab.id}${tab.active ? '*' : ''}:${(tab.url || '').replace(/^chrome-extension:\/\/[a-z]+\//, 'ext/').slice(0, 40)}`).join(', ')}]`));
    }),
    ['(the control page did not answer)']
  );
  for (const line of windows) say(line);
  // A request from the bar to the panel waits in session storage until the panel takes it (it holds a tab, a record and an action
  // id, no text); one that is still there was not taken. Also whether the browser's clock and ours agree (a request dated after
  // the browser's "now" is not believed).
  const session = await boxed(ctx.ext(async () => ({ at: Date.now(), items: await chrome.storage.session.get(null) })), null);
  if (session) say(`session storage: ${JSON.stringify(Object.fromEntries(Object.entries(session.items).map(([k, v]) => [k, k === 'ab:launch' ? v : '(held)'])))}; browser clock minus ours: ${session.at - Date.now()} ms`);
  const focusLog = await boxed(ctx.ext(() => window.__focusLog || []), []);
  for (const line of focusLog.slice(-40)) say(`focus ${line}`);
  for (const e of ctx.errors.slice(-6)) say(`error [${e.from}/${e.kind}] ${String(e.text).slice(0, 200)}`);
  for (const c of ctx.consoleLog.filter((x) => x.from === 'service-worker').slice(-4)) say(`service worker [${c.type}] ${String(c.text).slice(0, 200)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed') || process.env.E2E_HEADED === '1';
  // "b, d" and "b,d" are the same list (the CI form's input is typed by a person).
  const only = (args.find((a) => !a.startsWith('--')) || '').split(',').map((id) => id.trim()).filter(Boolean);
  // An id that is not a scenario is a typo: running the others and reporting PASSED would hide that the one asked for never ran.
  const known = SCENARIOS.map((s) => s.id);
  const unknown = only.filter((id) => !known.includes(id));
  if (unknown.length) {
    console.error(`No scenario with the id ${unknown.map((id) => `"${id}"`).join(', ')}. The scenarios are: ${known.join(', ')}.`);
    process.exit(2);
  }
  const started = Date.now();
  const t = new Checker();
  const ctx = await createContext({ headed });
  console.log('Agent Buddy end-to-end run');
  console.log(`  fake instance  ${ctx.origin}  (HTTPS, self-signed, strict CSP)`);
  console.log(`  fake AI        ${ctx.ai.baseUrl}`);
  console.log(`  extension id   ${ctx.extId}`);
  console.log(`  build          ${ctx.extension.source}`);
  console.log(`  files          ${ctx.TMP}  (screenshots and notes of the run stay here)`);
  console.log('  note           the build\'s own manifest.json is NOT modified; a temp copy gets localhost host_permissions');

  // Never hang: a hard stop for the whole run, and a time box per scenario.
  const hardStop = setTimeout(async () => {
    console.log(`\nHARD STOP: the run did not finish within ${Math.round(RUN_TIMEOUT_MS / 1000)}s (${t.pass} passed, ${t.fail} failed so far).`);
    await Promise.race([ctx.close(), after(5000)]);
    process.exit(1);
  }, RUN_TIMEOUT_MS);

  for (const s of SCENARIOS) {
    if (only.length && !only.includes(s.id)) continue;
    t.section(`${s.id}. ${s.title}`);
    try {
      await withTimeout(s.run(t, ctx), s.timeoutMs || SCENARIO_TIMEOUT_MS, `scenario ${s.id}`); // a scenario that walks every screen twice says so with timeoutMs
    } catch (err) {
      // The message, then where in OUR files it happened (the lines inside puppeteer say nothing about which step stalled).
      const lines = String(err.stack || err).split('\n');
      const ours = lines.filter((l) => /[\\/]e2e[\\/]/.test(l) && !/[\\/]node_modules[\\/]/.test(l)).slice(0, 2).map((l) => l.trim().replace(/^at /, '').replace(/.*[\\/]e2e[\\/]/, 'e2e/'));
      t.check(`scenario ${s.id} ran to the end`, false, `${lines.slice(0, 2).join(' | ')} | at ${ours.join(' | ') || 'unknown'}`);
      await describeFailure(ctx, s.id);
      await tidy(ctx);
    }
  }

  clearTimeout(hardStop);
  await ctx.close();
  // A run in which no check ran proved nothing (every scenario skipped, or one that returns before its first check): it fails.
  const nothingRan = t.pass + t.fail === 0;
  const failed = t.fail > 0 || nothingRan;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${failed ? 'FAILED' : 'PASSED'}: ${t.pass} passed, ${t.fail} failed, ${t.warn} warnings  (${Math.round((Date.now() - started) / 1000)}s)${nothingRan ? '  - no check ran' : ''}`);
  if (t.failures.length) console.log(`\nFailures:\n${t.failures.map((f) => `  - ${f}`).join('\n')}`);
  if (t.warnings.length) console.log(`\nWarnings (known limits, not failures):\n${t.warnings.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
