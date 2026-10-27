// End-to-end run: real Chrome + the built extension + a fake ServiceNow (HTTPS) + a fake AI endpoint.
//
//   npm run e2e                   rebuilds dist/ first, then runs every scenario (about 40 seconds)
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
const SCENARIOS = [...SCENARIO_FILES.filter((f) => f !== 'e-readonly'), ...SCENARIO_FILES.filter((f) => f === 'e-readonly')].map((f) => require(path.join(__dirname, 'scenarios', f)));

const SCENARIO_TIMEOUT_MS = Number(process.env.E2E_SCENARIO_TIMEOUT_MS) || 45000; // a normal scenario takes 3 to 15 seconds
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS) || 175000; // a normal run takes about 40 seconds; the whole run stays under three minutes even when things fail

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
      for (const page of await Promise.race([ctx.browser.pages(), after(3000, [])])) {
        const url = page.url();
        const file = await ctx.shot(page, `fail-${s.id}-${url.split('/').pop().slice(0, 20)}`);
        if (file) console.log(`        screenshot of ${url.slice(0, 70)} -> ${file}`);
      }
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
