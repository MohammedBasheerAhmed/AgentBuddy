// End-to-end run: real Chrome + the built extension + a fake ServiceNow (HTTPS) + a fake AI endpoint.
//
//   npm run e2e                   rebuilds dist/ first, then runs every scenario (about two minutes)
//   node e2e/run.js [a,c,g]       run only some scenarios (dist/ must be built already)
//   node e2e/run.js --headed      show the browser (needs a display)
//
// Needs puppeteer-core, which is NOT a dependency of the repo:  npm i --no-save puppeteer-core
// The real manifest is never modified: the harness patches a temp COPY (see e2e/harness.js).
//
// Environment: CHROME_PATH (default: Chrome in Program Files), AB_E2E_TMP (temp folder), E2E_HEADED=1,
//   E2E_SCENARIO_TIMEOUT_MS, E2E_RUN_TIMEOUT_MS, and E2E_MUTATE=write|leak|beacon: breaks a COPY of the extension on purpose to
//   show that the run then fails (a self-check of the harness, see MUTATIONS in e2e/harness.js).
const fs = require('fs');
const path = require('path');

try {
  require.resolve('puppeteer-core');
} catch {
  console.error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core');
  process.exit(2);
}

const { createContext } = require('./harness.js');
const { Checker } = require('./checker.js');

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
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS) || 270000; // a normal run takes under two minutes (20 scenarios); the whole run stays under 4.5 minutes even when steps time out

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
    const text = await boxed(page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)), '(no text: the page did not answer)');
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
  for (const e of ctx.errors.slice(-6)) say(`error [${e.from}/${e.kind}] ${String(e.text).slice(0, 200)}`);
  for (const c of ctx.consoleLog.filter((x) => x.from === 'service-worker').slice(-4)) say(`service worker [${c.type}] ${String(c.text).slice(0, 200)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed') || process.env.E2E_HEADED === '1';
  const only = (args.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);
  const started = Date.now();
  const t = new Checker();
  const ctx = await createContext({ headed });
  console.log('Agent Buddy end-to-end run');
  console.log(`  fake instance  ${ctx.origin}  (HTTPS, self-signed, strict CSP)`);
  console.log(`  fake AI        ${ctx.ai.baseUrl}`);
  console.log(`  extension id   ${ctx.extId}`);
  console.log('  note           the shipped dist/manifest.json is NOT modified; a temp copy gets localhost host_permissions');

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
      await withTimeout(s.run(t, ctx), SCENARIO_TIMEOUT_MS, `scenario ${s.id}`);
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
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${t.fail ? 'FAILED' : 'PASSED'}: ${t.pass} passed, ${t.fail} failed, ${t.warn} warnings  (${Math.round((Date.now() - started) / 1000)}s)`);
  if (t.failures.length) console.log(`\nFailures:\n${t.failures.map((f) => `  - ${f}`).join('\n')}`);
  if (t.warnings.length) console.log(`\nWarnings (known limits, not failures):\n${t.warnings.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(t.fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
