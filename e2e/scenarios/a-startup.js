// a. The extension starts cleanly: the service worker runs, and the settings page and the side panel load without errors.
const fs = require('fs');
const path = require('path');
const { sha256 } = require('../harness.js');

module.exports = {
  id: 'a',
  title: 'Startup: service worker, settings page and side panel without errors',
  async run(t, ctx) {
    t.check('service worker started', ctx.swTarget.url().endsWith('/background.bundle.js'), ctx.swTarget.url());

    // The message names this harness hard-codes must match the source, or every later scenario would be testing nothing.
    const messages = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'messages.js'), 'utf8');
    for (const name of ['ab:page-state', 'ab:enable-instance', 'ab:disable-instance', 'ab:read', 'ab:fill-field']) {
      t.check(`message name ${name} exists in src/lib/messages.js`, messages.includes(`'${name}'`));
    }

    // The tested extension is the real build plus one patched manifest in a COPY. Prove the real manifest stayed as it was.
    const live = await ctx.ext(() => chrome.runtime.getManifest());
    t.check('loaded copy has the patched host_permissions', JSON.stringify(live.host_permissions) === JSON.stringify(['https://localhost/*', 'http://localhost/*', 'http://127.0.0.1/*']), JSON.stringify(live.host_permissions));
    const real = JSON.parse(fs.readFileSync(ctx.extension.realManifestPath, 'utf8'));
    t.check('real dist/manifest.json is unchanged and has no host_permissions', sha256(ctx.extension.realManifestPath) === ctx.extension.realManifestHash && !real.host_permissions);
    t.info('Only the temp COPY of the manifest is patched (localhost host_permissions, so automation needs no permission prompt). The shipped manifest is untouched.');

    // Self-test of the harness' own watchers, so that "no errors" and "no stray requests" below mean something.
    const marker = `e2e-selftest-${Date.now()}`;
    await ctx.ctl.evaluate((m) => {
      console.error(m);
      setTimeout(() => { throw new Error(m); }, 0);
      fetch(`https://selftest.invalid/${m}`).catch(() => {});
    }, marker);
    await ctx.sleep(700);
    const seen = (list) => list.filter((x) => `${x.text || ''} ${x.url || ''}`.includes(marker));
    t.check('harness self-test: a console error, a page error and a network request are all noticed', seen(ctx.errors).some((e) => e.kind === 'console') && seen(ctx.errors).some((e) => e.kind === 'pageerror') && seen(ctx.net).length === 1, `errors=${seen(ctx.errors).length} net=${seen(ctx.net).length}`);
    for (const list of [ctx.errors, ctx.net]) for (const x of seen(list)) list.splice(list.indexOf(x), 1);

    // The settings page is already open (the control page). Give it a moment, then look for errors.
    await ctx.sleep(500);
    const pageErrors = () => ctx.errors.filter((e) => e.url.startsWith(`chrome-extension://${ctx.extId}/`) || e.from === 'service-worker');
    t.check('options.html: no page errors, console errors or CSP violations', pageErrors().length === 0, pageErrors().map((e) => `${e.kind}: ${e.text}`).join(' | '));
    t.check('options.html: renders the settings form', (await ctx.ctl.evaluate(() => document.body.innerText)).includes('Agent Buddy settings'));
    t.check('options.html: no CSP violation events', (await ctx.ctl.evaluate(() => window.__cspViolations || [])).length === 0);

    // The side panel before anything is set up: a plain "not turned on" state, not a crash.
    const panel = await ctx.openPanel();
    await ctx.sleep(1500);
    const text = await panel.text();
    t.check('sidepanel.html: loads and shows the setup state', /Agent Buddy/.test(text) && /Not turned on|Open a ticket|Add an AI key/.test(text), text.replace(/\s+/g, ' ').slice(0, 120));
    t.check('sidepanel.html: no page errors, console errors or CSP violations', pageErrors().length === 0, pageErrors().map((e) => `${e.kind}: ${e.text}`).join(' | '));
    t.check('sidepanel.html: no CSP violation events', (await panel.page.evaluate(() => window.__cspViolations || [])).length === 0);
    await panel.close();
  },
};
