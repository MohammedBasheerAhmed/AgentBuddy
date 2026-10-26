// End-to-end run: real Chrome + the built extension + a fake ServiceNow (HTTPS) + a fake AI endpoint.
//
//   npm run e2e                   rebuilds dist/ first, then runs every scenario
//   node e2e/run.js [a,c,g]       run only some scenarios (dist/ must be built already)
//   node e2e/run.js --headed      show the browser (needs a display)
//
// Needs puppeteer-core, which is NOT a dependency of the repo:  npm i --no-save puppeteer-core
// The real manifest is never modified: the harness patches a temp COPY (see e2e/harness.js).
const path = require('path');

try {
  require.resolve('puppeteer-core');
} catch {
  console.error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core');
  process.exit(2);
}

const { createContext } = require('./harness.js');
const { Checker } = require('./checker.js');

const SCENARIOS = ['a-startup', 'b-enable', 'c-ai-path', 'd-insert', 'f-failures', 'g-myday', 'h-settings-ui', 'e-readonly'].map((f) => {
  try {
    return require(path.join(__dirname, 'scenarios', f));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && String(err.message).includes(f)) return null;
    throw err;
  }
}).filter(Boolean);

async function main() {
  const args = process.argv.slice(2);
  const headed = args.includes('--headed') || process.env.E2E_HEADED === '1';
  const only = (args.find((a) => !a.startsWith('--')) || '').split(',').filter(Boolean);
  const started = Date.now();
  const t = new Checker();
  const ctx = await createContext({ headed });
  console.log(`Agent Buddy end-to-end run`);
  console.log(`  fake instance  ${ctx.origin}  (HTTPS, self-signed, strict CSP)`);
  console.log(`  fake AI        ${ctx.ai.baseUrl}`);
  console.log(`  extension id   ${ctx.extId}`);
  console.log(`  note           the shipped dist/manifest.json is NOT modified; a temp copy gets localhost host_permissions`);

  for (const s of SCENARIOS) {
    if (only.length && !only.includes(s.id)) continue;
    t.section(`${s.id}. ${s.title}`);
    try {
      await s.run(t, ctx);
    } catch (err) {
      t.check(`scenario ${s.id} ran to the end`, false, String(err.stack || err).split('\n').slice(0, 4).join(' | '));
      for (const page of await ctx.browser.pages()) {
        const url = page.url();
        const file = await ctx.shot(page, `fail-${s.id}-${url.split('/').pop().slice(0, 20)}`);
        if (file) console.log(`        screenshot of ${url.slice(0, 70)} -> ${file}`);
      }
    }
  }

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
