// Firefox end-to-end run: a real Firefox + the Firefox build of the add-on + the fake ServiceNow (HTTPS) + the fake AI endpoint that
// the Chrome run uses (e2e/run.js). A smoke set: it proves the Firefox build installs, starts, turns a site on, reads a ticket, runs
// one AI action with the personal data masked, keeps to its two destinations, and that its pages load without errors.
//
//   npm run e2e:firefox             rebuilds dist-firefox/ first, then runs (about half a minute)
//   node e2e/firefox/run.js         on a Firefox build that is already there
//   node e2e/firefox/run.js --headed   show the browser
//
// Needs puppeteer-core (a pinned devDependency) and a Firefox 128 or later: FIREFOX_PATH (default: the Firefox 159 in puppeteer's
// cache, ~/.cache/puppeteer/firefox/win64-stable_159.0.1). Nothing is downloaded. How Firefox is driven, and what automation can and
// cannot reach in it, is at the top of e2e/firefox/firefox.js. The real sidebar, the toolbar button and the keyboard shortcuts cannot
// be driven by automation: sidepanel.html is opened in a window of its own instead (as the Chrome run opens it in a popup window).
// Port 443 of this computer must be free: Firefox runs content scripts only on a site with no port in its address, so the fake
// ServiceNow is served at https://localhost (a loopback-only forwarder, see forwardSite in e2e/firefox/firefox.js); two Firefox runs
// at once therefore cannot share a computer.
//
// Environment: FIREFOX_PATH, E2E_FIREFOX_DIST (test a Firefox build in another folder), AB_E2E_TMP (the folder for the run's files),
//   E2E_HEADED=1, E2E_STEP_TIMEOUT_MS, E2E_RUN_TIMEOUT_MS.
// (Some steps hold functions that run inside the add-on's pages in Firefox, where the API is also there as `browser`.)
/* global browser */
try {
  require.resolve('puppeteer-core');
} catch {
  console.error('puppeteer-core is not installed. Run: npm ci (it is a pinned devDependency in package.json)');
  process.exit(2);
}

const { createFirefoxContext, TMP } = require('./firefox.js');
const { Checker } = require('../checker.js');
const { findLeaks } = require('../leaks.js');
const { waitForText, waitForVisible, textOf, buttonShown, clickButton, openHalf, dockDriver } = require('./dom.js');

// Ctrl+C or a stop from CI ends the run through process.exit, so the 'exit' handlers run (puppeteer's closes Firefox, ours removes
// the TLS key and the add-on copy).
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const STEP_TIMEOUT_MS = Number(process.env.E2E_STEP_TIMEOUT_MS) || 60000; // a step takes 1 to 10 seconds
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS) || 300000;
const ARM_MS = 500; // src/content/barLogic.js: how long the dock's actions must be on screen before a click counts
const TOOLBAR_NOTE = 'Click the Agent Buddy button in your browser toolbar. The action starts in the panel.';
const LAUNCH = 'ab:launch';
const SELFTEST = `e2e-selftest-${Date.now().toString(36)}`;

const after = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const withTimeout = (promise, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};
const oneLine = (s, max = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---- What the watchers saw, sorted -------------------------------------------------------------------------------------------

/** Errors (not warnings) that come from the add-on: its pages, its background page, its content scripts and its page bridge. */
function addonErrors(ctx, seen) {
  const ours = (e) => e.source.startsWith(ctx.extOrigin) || e.page.startsWith(ctx.extOrigin) || e.text.includes(ctx.extOrigin) || (e.plain && e.text.includes(ctx.extension.geckoId));
  return seen.errors.filter((e) => !e.warning && ours(e));
}
/** CSP reports (errors or warnings) about the add-on's pages. */
const cspReports = (ctx, seen) => seen.errors.filter((e) => /csp/i.test(e.category) && (e.source.startsWith(ctx.extOrigin) || e.page.startsWith(ctx.extOrigin) || e.text.includes(ctx.extOrigin) || !e.page));
const describe = (list) => list.slice(0, 3).map((e) => oneLine(`${e.category || e.level || ''} ${e.text} ${e.source || ''}`, 200)).join(' | ');
// The self-test's own lines (they are made on purpose, below) are not errors of the add-on.
const notSelfTest = (seen) => ({ ...seen, errors: seen.errors.filter((e) => !`${e.text} ${e.source}`.includes(SELFTEST) && !`${e.text}`.includes('selftest.invalid')), console: seen.console.filter((c) => !c.text.includes(SELFTEST)) });

/** Errors a web page reported through BiDi (the ServiceNow tab): { kind, text }. */
function trackWebPage(page, sink) {
  page.on('pageerror', (err) => sink.push({ kind: 'pageerror', text: String(err?.message || err) }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push({ kind: 'console', text: msg.text() });
  });
}

// ---- The steps -------------------------------------------------------------------------------------------------------------

const STEPS = [
  {
    title: 'Install: the add-on installs and its background starts without errors',
    async run(t, ctx) {
      t.check('the add-on installs as a temporary add-on (BiDi webExtension.install), under its gecko id', ctx.extensionId === ctx.extension.geckoId, ctx.extensionId);
      const live = await ctx.ext(() => ({ url: chrome.runtime.getURL(''), id: chrome.runtime.id, hosts: chrome.runtime.getManifest().host_permissions }));
      t.check('its pages live at the address the run chose (pref extensions.webextensions.uuids); runtime.id is the gecko id, not that address', live.url === `${ctx.extOrigin}/` && live.id === ctx.extension.geckoId, JSON.stringify(live));
      t.check('the loaded copy has the patched host_permissions', JSON.stringify(live.hosts) === JSON.stringify(ctx.extension.manifest.host_permissions), JSON.stringify(live.hosts));
      const fs = require('fs');
      const real = JSON.parse(fs.readFileSync(ctx.extension.realManifestPath, 'utf8'));
      t.check(`the real ${ctx.extension.source}/manifest.json is unchanged and has no host_permissions`, ctx.sha256(ctx.extension.realManifestPath) === ctx.extension.realManifestHash && !real.host_permissions);

      // The background runs as an event page in Firefox (manifest background.scripts).
      const bg = await ctx.ext(async () => {
        const w = await browser.runtime.getBackgroundPage();
        return { href: w ? w.location.href : '', scripts: w ? [...w.document.scripts].map((s) => s.src) : [] };
      });
      t.check('the background page runs background.bundle.js (an event page, not a service worker)', bg.scripts.some((s) => s === ctx.extUrl('background.bundle.js')), JSON.stringify(bg));
      const answer = await ctx.ext(() => chrome.runtime.sendMessage({ type: 'ab:list-instances' }));
      t.check('the background answers the Settings page: LIST_INSTANCES from moz-extension:// passes its sender check', Array.isArray(answer?.instances) && !answer.error, JSON.stringify(answer));

      // Nothing went wrong from the install until now (the Settings page is open as the control page).
      await ctx.sleep(500);
      const seen = await ctx.watched();
      const errors = addonErrors(ctx, seen);
      t.check('no JavaScript error from the add-on since it was installed (background page, Settings page)', errors.length === 0, describe(errors));
      t.check('no console.error printed by any page or the add-on since the start', seen.console.filter((c) => c.level === 'error').length === 0, seen.console.map((c) => c.text).join(' | '));
      const manifestNotes = seen.errors.filter((e) => e.plain && e.text.includes(ctx.extension.geckoId) && /Reading manifest/.test(e.text)).map((e) => e.text.replace(/^.*Reading manifest:\s*/, ''));
      for (const note of [...new Set(manifestNotes)]) t.info(`Firefox says while loading the manifest: ${note} (expected: storage.managed_schema is kept for Chrome, see scripts/lib/browsers.js)`);

      // Self-test of the watchers, so that "no errors" and "no stray requests" mean something: a console.error, a thrown error and a
      // request from the Settings page must all be seen.
      await ctx.ext((m) => {
        console.error(m);
        setTimeout(() => {
          throw new Error(m);
        }, 0);
        fetch(`https://selftest.invalid/${m}`).catch(() => {});
      }, SELFTEST);
      const test = await ctx
        .waitUntil('the self-test to be seen', async () => {
          const s = await ctx.watched();
          const thrown = s.errors.some((e) => e.text.includes(SELFTEST) && e.source.startsWith(ctx.extOrigin));
          const logged = s.console.some((c) => c.level === 'error' && c.text.includes(SELFTEST));
          const request = s.net.some((n) => n.url.includes(SELFTEST) && n.by === ctx.extOrigin);
          return thrown && logged && request ? { thrown, logged, request } : null;
        }, { timeout: 10000 })
        .catch(() => null);
      t.check('harness self-test: a thrown error, a console.error and a request of an extension page are all seen (with the add-on as the requester)', Boolean(test));
      // The failed request's own CORS line comes when the name lookup gives up: wait for it, so it does not land in a later window.
      await ctx.waitUntil('the self-test request to fail', async () => (await ctx.watched()).errors.some((e) => e.text.includes('selftest.invalid')), { timeout: 10000 }).catch(() => {});
      // For the record: what WebDriver BiDi itself reported of the same three things on an extension page.
      const bidiLogged = ctx.bidiLog.filter((e) => e.text.includes(SELFTEST)).length;
      const bidiRequest = ctx.bidiNet.filter((n) => n.url.includes(SELFTEST)).length;
      t.info(`WebDriver BiDi on an extension page: ${bidiLogged} log entries and ${bidiRequest} network events of the self-test's 2 log lines and 1 request (no load event either: the run waits for document.readyState)`);
    },
  },

  {
    title: 'Turn on: the site is turned on for the fake instance',
    async run(t, ctx) {
      const { origin } = ctx;
      const granted = await ctx.ext((p) => chrome.permissions.contains({ origins: [p] }), `${origin}/*`);
      t.check('Firefox granted the host permission of the copy (a temporary add-on: no prompt, no extra pref)', granted === true, String(granted));
      const enabled = await ctx.ext((o) => chrome.runtime.sendMessage({ type: 'ab:enable-instance', origin: o }), origin);
      t.check('ENABLE_INSTANCE answers with the instance', JSON.stringify(enabled?.instances) === JSON.stringify([origin]), JSON.stringify(enabled));
      const scripts = await ctx.ext(() => chrome.scripting.getRegisteredContentScripts());
      const bridge = scripts.find((s) => s.id === 'ab-bridge');
      const content = scripts.find((s) => s.id === 'ab-content');
      t.check('page bridge registered: MAIN world, document_start, this instance only', bridge?.world === 'MAIN' && bridge.runAt === 'document_start' && JSON.stringify(bridge.matches) === JSON.stringify([`${origin}/*`]), JSON.stringify(bridge));
      t.check('content script registered: ISOLATED world, document_idle, this instance only, top frame only', content?.world === 'ISOLATED' && content.runAt === 'document_idle' && JSON.stringify(content.matches) === JSON.stringify([`${origin}/*`]) && content.allFrames === false, JSON.stringify(content));
      t.check('exactly two scripts registered, no all-sites match', scripts.length === 2 && scripts.every((s) => s.matches.every((m) => m === `${origin}/*`)), JSON.stringify(scripts.map((s) => s.matches)));
      const settings = await ctx.settings();
      // Why the fake instance is at https://localhost and not at its own port (see forwardSite in e2e/firefox/firefox.js): measured
      // here with Firefox's own MatchPattern, on every run.
      const page = `${ctx.inst.origin}/incident.do`;
      const withPort = await ctx.matchPattern(`${ctx.inst.origin}/*`, page);
      const withoutPort = await ctx.matchPattern('https://localhost/*', page);
      if (withPort !== true) t.warning('in Firefox a site with a port in its address cannot be turned on: a match pattern with a port matches nothing, so the content scripts would never run there', `${ctx.inst.origin}/* matches ${page}: ${withPort}; https://localhost/* matches it: ${withoutPort}. ServiceNow's instances have no port; this run serves the fake instance at https://localhost`);
      t.check('settings.instances holds exactly the instance', JSON.stringify(settings.instances) === JSON.stringify([origin]), JSON.stringify(settings.instances));
    },
  },

  {
    title: 'Ticket page: the registered content scripts run, the page bridge in the page\'s MAIN world',
    async run(t, ctx) {
      const { data, origin } = ctx;
      const path = `/incident.do?sys_id=${data.INCIDENT_ID}`;
      const mark = await ctx.mark();
      ctx.ticket = await ctx.browser.newPage();
      trackWebPage(ctx.ticket, ctx.webErrors);
      await ctx.ticket.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 15000 });
      ctx.ticketPath = path;
      const version = await ctx.waitUntil('the page bridge', () => ctx.ticket.evaluate(() => window.__abBridge?.version), { timeout: 10000 }).catch(() => null);
      t.check('the page bridge ran in the page\'s own (MAIN) world: the page\'s scripts see window.__abBridge', typeof version === 'number', String(version));

      ctx.tabId = await ctx.ext(async (p) => (await chrome.tabs.query({})).find((x) => (x.url || '').includes(p))?.id ?? null, path);
      t.check('the extension sees the ticket tab (tabs.query with the host permission)', Number.isInteger(ctx.tabId), String(ctx.tabId));
      const ask = () =>
        ctx.ext(async (tabId) => {
          try {
            return await chrome.tabs.sendMessage(tabId, { type: 'ab:page-state' });
          } catch (err) {
            return { sendError: String(err.message || err) };
          }
        }, ctx.tabId);
      const state = await ctx.waitUntil('the content script to answer', async () => {
        const s = await ask();
        return s?.record ? s : null;
      }, { timeout: 12000 }).catch(async () => ask());
      t.check('the content script answers an extension page (PAGE_STATE from moz-extension:// passes the content script\'s sender check)', Boolean(state?.record) && !state.sendError, oneLine(JSON.stringify(state)));
      t.check('classic form: the record comes from g_form, read by the bridge (table, sys_id, number, kind)', JSON.stringify(state?.record) === JSON.stringify({ table: 'incident', sysId: data.INCIDENT_ID, number: data.INCIDENT_NUMBER, kind: 'incident' }), JSON.stringify(state?.record));
      t.check('classic form: the signed-in person comes from g_user, read by the bridge (Beth Anglin, roles ["itil"])', state?.user?.name === 'Beth Anglin' && JSON.stringify(state.user.roles) === '["itil"]', JSON.stringify(state?.user));

      // The other way round: a content-script context may not ask the background for what only the add-on's pages may ask.
      const refused = await ctx.ext(async (tabId) => {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            try {
              return JSON.stringify(await chrome.runtime.sendMessage({ type: 'ab:list-instances' }));
            } catch (err) {
              return `threw ${err.message}`;
            }
          },
        });
        return r?.result ?? '';
      }, ctx.tabId);
      t.check('a content-script context asking the background for LIST_INSTANCES is refused (the sender check holds in Firefox)', /only allowed from Agent Buddy's own pages/.test(refused), refused);

      await ctx.sleep(300);
      const seen = notSelfTest(await ctx.watched(mark));
      const errors = addonErrors(ctx, seen);
      t.check('no error from the content script, the page bridge or the background while the ticket loaded', errors.length === 0 && seen.console.filter((c) => c.level === 'error').length === 0 && ctx.webErrors.length === 0, describe(errors) || seen.console.map((c) => c.text).join(' | ') || ctx.webErrors.map((e) => e.text).join(' | '));
    },
  },

  {
    title: 'The panel: sidepanel.html in a window of its own shows the open ticket',
    async run(t, ctx) {
      const { ai, data, origin } = ctx;
      // As e2e/common.js prepare(): the "custom" provider pointing at the fake AI, the key, the preview on, a set-up IT agent.
      await ctx.configure(
        { provider: 'custom', models: { custom: 'test-model' }, baseUrls: { custom: ai.baseUrl }, keyStorage: 'local', piiMode: 'standard', previewMode: 'always', previewSeen: [], instances: [origin], profiles: ['it'], profilesConfirmed: true, showEverything: false, aiSkipped: false, halves: {}, language: 'en', answerLanguage: 'ticket' },
        { key: { provider: 'custom', value: ai.key } }
      );
      const mark = await ctx.mark();
      // The real sidebar cannot be driven by automation: the panel is opened in a window of its own, and the ticket tab stays the
      // active tab of the main window, which is what the panel reads (the active tab of the last focused window).
      ctx.panel = await ctx.openExtensionPage('sidepanel.html', { window: true, ready: () => Boolean(document.querySelector('.ab-app')) });
      await ctx.ticket.bringToFront();
      const active = await ctx.ext(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return tab ? { id: tab.id, url: tab.url } : null;
      });
      t.check('the ticket tab is the active tab of the last focused window (what the panel looks at)', active?.id === ctx.tabId, JSON.stringify(active));
      const shown = await waitForText(ctx.panel, data.INCIDENT_NUMBER, { timeout: 20000 })
        .then(() => waitForText(ctx.panel, 'VPN keeps disconnecting', { timeout: 10000 }))
        .then(() => true)
        .catch((err) => err.message);
      t.check('the panel shows the open ticket: its number and title (panel -> content script under moz-extension://)', shown === true, shown === true ? '' : shown);
      const text = await ctx.panel.evaluate(() => document.body.innerText);
      t.check('the panel is ready to use AI (the key store found the key)', !/Add an AI key|Your AI key is locked/.test(text), oneLine(text, 200));
      const fromPanel = await ctx.panel.evaluate(() => chrome.runtime.sendMessage({ type: 'ab:list-instances' }));
      t.check('the panel\'s own request to the background passes the sender check (LIST_INSTANCES)', JSON.stringify(fromPanel?.instances) === JSON.stringify([origin]), JSON.stringify(fromPanel));
      const seen = notSelfTest(await ctx.watched(mark));
      const errors = addonErrors(ctx, seen);
      t.check('sidepanel.html: no JavaScript error, CSP report or console.error', errors.length === 0 && cspReports(ctx, seen).length === 0 && seen.console.filter((c) => c.level === 'error').length === 0, describe([...errors, ...cspReports(ctx, seen)]) || seen.console.map((c) => c.text).join(' | '));
    },
  },

  {
    title: 'Summarise with the fake AI: an answer, and the request has the record\'s people masked',
    async run(t, ctx) {
      const { ai, data } = ctx;
      const p = ctx.panel;
      ai.reset();
      await openHalf(p, 'assist');
      await clickButton(p, /^Summarise this ticket/);
      await waitForVisible(p, '.ab-dialog', { timeout: 15000 });
      t.check('the check before sending opens first, and nothing has been sent yet', ai.requests.length === 0, String(ai.requests.length));
      if (await buttonShown(p, /^Show the exact text/)) await clickButton(p, /^Show the exact text/);
      const preview = (await textOf(p, '.ab-preview')) || '';
      await clickButton(p, /^Send to AI/);
      await waitForVisible(p, '.ab-output, .ab-note-danger[role="alert"]', { timeout: 20000 });
      const result = await textOf(p, '.ab-output');
      const error = await textOf(p, '.ab-note-danger[role="alert"]');
      t.check('Summarise: an answer is shown (no error)', result !== null, error || '');
      t.check('Summarise: the answer shows the real caller name (put back locally, in the panel)', Boolean(result) && result.includes(data.SEED.callerName), oneLine(result));
      t.check('Summarise: exactly one request reached the fake AI', ai.requests.length === 1, String(ai.requests.length));
      const req = ai.requests[0];
      if (!req) return;
      t.check('Summarise: POST /v1/chat/completions with the saved key, one system and one user message, no tools', req.method === 'POST' && req.path === '/v1/chat/completions' && req.auth === `Bearer ${ai.key}` && JSON.stringify((req.body?.messages || []).map((m) => m.role)) === '["system","user"]' && !req.body?.tools);
      const leaks = findLeaks(req.raw, data);
      t.check('Summarise: the request the fake AI received has no real name, email, phone, card or password from the test data', leaks.critical.length === 0, leaks.critical.join(' | '));
      for (const g of leaks.gaps) t.warning(`AI server received "${g.value}" unmasked`, g.why);
      t.check('Summarise: the people and contacts are placeholders in the request ([PERSON_1], [EMAIL_1])', /\[PERSON_1\]/.test(req.raw) && /\[EMAIL_1\]/.test(req.raw));
      t.check('Summarise: no sys_id, session token or instance address in the request', !/\b[0-9a-f]{32}\b/.test(req.raw) && !req.raw.includes(ctx.inst.gck) && !req.raw.includes(ctx.origin));
      const sent = (req.body?.messages || []).map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
      t.check('Summarise: the preview was exactly the text that was sent', sent.trim() === preview.replace(/\r\n/g, '\n').trim(), preview ? '' : 'no preview text');
      t.info(`the request's Origin header: ${req.origin || '(none)'}`);
    },
  },

  {
    title: 'The dock on the ticket page: a click with no sidebar open shows the toolbar note',
    async run(t, ctx) {
      const { ai, data } = ctx;
      // No panel is open, as for a person with the sidebar closed (the test's panel window would otherwise pick the request up).
      await ctx.closePage(ctx.panel);
      ctx.panel = null;
      const sidebarOpen = await ctx.ext(() => browser.sidebarAction.isOpen({}));
      t.check('the sidebar is closed', sidebarOpen === false, String(sidebarOpen));
      ai.reset();
      await ctx.ext((k) => chrome.storage.session.remove(k), LAUNCH);
      await ctx.configure({ pageBar: true });

      const ticket = ctx.ticket;
      await ticket.bringToFront();
      await ticket.evaluate(() => localStorage.setItem('agentbuddy-bar', JSON.stringify({ open: true })));
      await ticket.reload({ waitUntil: 'load', timeout: 15000 });
      const dock = dockDriver(ticket, ctx.conn);
      const view = await ctx.waitUntil('the open dock with its actions', async () => {
        const v = await dock.view();
        return v.present && v.open && v.actions.some((a) => a.at) ? v : null;
      }, { timeout: 15000 }).catch(() => dock.view());
      t.check('the dock appears on the ticket page, in a closed shadow root, open, with its actions', view.present && view.mode === 'closed' && view.visible && view.open && view.actions.some((a) => a.label === 'Summarise'), oneLine(JSON.stringify({ ...view, actions: view.actions?.map((a) => a.label) })));

      await ctx.ext(() => {
        window.__launchLog = [];
        chrome.storage.onChanged.addListener((changes, area) => area === 'session' && changes['ab:launch'] && window.__launchLog.push(changes['ab:launch'].newValue ?? null));
      });
      const mark = await ctx.mark();
      const webBefore = ctx.webErrors.length;
      await ctx.sleep(ARM_MS + 400); // a click counts only once the actions have been on screen for half a second
      await dock.press('Summarise');
      const notice = await ctx.waitUntil('the note on the dock', async () => (await dock.view()).notice, { timeout: 8000 }).catch(() => '');
      t.check('the click shows the toolbar note (Firefox opens the sidebar only from the toolbar or a shortcut)', notice === TOOLBAR_NOTE, notice || '(no note)');
      const left = (await ctx.ext(() => window.__launchLog)).find(Boolean) || null;
      t.check('the click left one request for the panel in storage.session: this tab, this record, this action', Boolean(left) && left.tabId === ctx.tabId && left.table === 'incident' && left.sysId === data.INCIDENT_ID && left.featureId === 'record-summary', JSON.stringify(left));
      await ctx.sleep(300);
      const seen = notSelfTest(await ctx.watched(mark));
      const errors = addonErrors(ctx, seen);
      const web = ctx.webErrors.slice(webBefore);
      t.check('the click threw nothing: no error from the dock, the content script or the background', errors.length === 0 && seen.console.filter((c) => c.level === 'error').length === 0 && web.length === 0, describe(errors) || seen.console.map((c) => c.text).join(' | ') || web.map((e) => e.text).join(' | '));
      t.check('nothing was sent to the AI by the dock or the background', ai.requests.length === 0, String(ai.requests.length));
      // The request would start the action in a panel opened within 30 s: it goes, so nothing later picks it up.
      await ctx.ext((k) => chrome.storage.session.remove(k), LAUNCH);
    },
  },

  {
    title: 'Settings: options.html loads with no CSP errors',
    async run(t, ctx) {
      const mark = await ctx.mark();
      const page = await ctx.openExtensionPage('options.html', { ready: () => /Agent Buddy settings/.test(document.body.innerText) });
      await ctx.sleep(1000);
      const text = await page.evaluate(() => document.body.innerText);
      t.check('options.html renders the settings', /Agent Buddy settings/.test(text) && /Where Agent Buddy works/.test(text), oneLine(text, 120));
      const seen = notSelfTest(await ctx.watched(mark));
      const csp = cspReports(ctx, seen);
      t.check('options.html: no CSP report', csp.length === 0, describe(csp));
      const errors = addonErrors(ctx, seen);
      t.check('options.html: no JavaScript error or console.error', errors.length === 0 && seen.console.filter((c) => c.level === 'error').length === 0, describe(errors) || seen.console.map((c) => c.text).join(' | '));
      // Self-test: a style attribute breaks the page's CSP (style-src 'self'); that report must be seen, or "no CSP report" means nothing.
      const before = await ctx.mark();
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.setAttribute('style', 'color: red');
        document.body.append(probe);
      });
      const noticed = await ctx.waitUntil('the CSP report', async () => cspReports(ctx, await ctx.watched(before)).length > 0, { timeout: 5000 }).catch(() => false);
      t.check('harness self-test: a CSP violation on an extension page is seen', Boolean(noticed));
      await ctx.closePage(page);
    },
  },

  {
    title: 'Storage: setAccessLevel and restrictStorageAccess in Firefox',
    async run(t, ctx) {
      const has = await ctx.ext(async () => {
        const w = await browser.runtime.getBackgroundPage();
        const kinds = (api) => ({ local: typeof api.storage.local.setAccessLevel, session: typeof api.storage.session.setAccessLevel, sync: typeof api.storage.sync?.setAccessLevel });
        return { page: kinds(chrome), background: kinds(w.chrome), backgroundBrowser: kinds(w.browser) };
      });
      t.info(`setAccessLevel in Firefox ${ctx.firefoxVersion}: background chrome.storage.local ${has.background.local}, chrome.storage.session ${has.background.session}, chrome.storage.sync ${has.background.sync}; browser.storage.* ${JSON.stringify(has.backgroundBrowser)}; an extension page ${JSON.stringify(has.page)}`);
      // The real restrictStorageAccess (src/background/bar.js, compiled for Firefox) on the background page's storage. It changes nothing
      // where setAccessLevel is missing, and closes an area where it is there (what the background page does at every start).
      const restricted = await ctx.ctl.evaluate(`${await ctx.storageProbeSource()}
;(async () => {
  const w = await browser.runtime.getBackgroundPage();
  return JSON.stringify(await __abStorageProbe.restrictStorageAccess(w.chrome.storage));
})()`);
      t.check('restrictStorageAccess runs in Firefox without throwing and says what it did for each area', /"session":"(unchanged|closed)".*"local":"(unchanged|closed)".*"sync":"(unchanged|closed)"/.test(String(restricted)), String(restricted));
      t.info(`restrictStorageAccess returns ${restricted} in Firefox ${ctx.firefoxVersion}`);

      // What a content script (the add-on's code in the ServiceNow page, ISOLATED world) can reach. Only counts and key names, never values.
      const seen = await ctx.ext(async (tabId) => {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            const out = {};
            for (const name of ['local', 'session']) {
              const area = chrome.storage && chrome.storage[name];
              if (!area) {
                out[name] = { access: 'absent' };
                continue;
              }
              try {
                const all = await area.get(null);
                out[name] = { access: 'readable', keys: Object.keys(all) };
              } catch (err) {
                out[name] = { access: 'refused', why: String(err.message || err).slice(0, 120) };
              }
            }
            return out;
          },
        });
        return r?.result ?? null;
      }, ctx.tabId);
      t.check('a content script cannot read storage.session in Firefox (absent or refused)', Boolean(seen) && seen.session.access !== 'readable', JSON.stringify(seen?.session));
      t.info(`a content script and storage.local in Firefox: ${seen?.local?.access}${seen?.local?.keys ? ` (keys: ${seen.local.keys.join(', ')})` : ''}`);
      if (seen?.local?.access === 'readable') t.warning('in Firefox a content script can read chrome.storage.local: setAccessLevel is not there to close it', `keys it sees: ${seen.local.keys.join(', ') || '(none)'}`);
      t.check('no AI key is left in storage.local where a content script could read it (the key store moved it to the vault)', Boolean(seen) && !(seen.local?.keys || []).some((k) => k.startsWith('agentbuddy_key_')), (seen?.local?.keys || []).join(', '));
    },
  },

  {
    title: 'Network: only GET to the fake ServiceNow, and nothing anywhere but the fake instance and the fake AI',
    async run(t, ctx) {
      const { inst, ai } = ctx;
      const aiOrigin = new URL(ai.baseUrl).origin;
      const notGet = inst.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
      t.check('the fake ServiceNow received only GET requests (its own log)', inst.requests.length > 0 && notGet.length === 0, `${inst.requests.length} requests; ${notGet.map((r) => `${r.method} ${r.path}`).join(', ')}`);
      t.check('the fake AI received only chat requests (its own log: no other route was asked)', ai.other.length === 0 && ai.all.length >= 1, `${ai.all.length} chat, ${ai.other.length} other`);

      // Every HTTP(S) request Firefox made during the run, from the watcher inside the browser (it sees pages, frames, content scripts
      // and the background page alike), with the principal that asked for it: the add-on's own pages and background carry the add-on's
      // (moz-extension://...); a ServiceNow page and the content scripts' reads carry the page's (in Manifest V3 a content script
      // fetches as the page); Firefox's own housekeeping and the run's own navigations carry the system principal.
      const seen = await ctx.watched();
      const all = seen.net.filter((n) => !n.url.includes(SELFTEST));
      const originOf = (u) => {
        try {
          return new URL(u).origin;
        } catch {
          return '';
        }
      };
      const hostOf = (u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return '';
        }
      };
      const ours = (n) => [ctx.origin, aiOrigin].includes(originOf(n.url));
      const byAddon = all.filter((n) => n.by.includes(ctx.extOrigin) || n.loading.includes(ctx.extOrigin));
      const byPages = all.filter((n) => !byAddon.includes(n) && [n.by, n.loading].some((p) => p.startsWith('https://localhost') || p.includes('127.0.0.1')));
      // Firefox's own traffic: the system principal, and only to Mozilla's services. A system-principal request anywhere else counts as stray.
      const mozilla = (n) => /(^|\.)(mozilla\.(com|net|org)|firefox\.com|mozaws\.net)$/.test(hostOf(n.url));
      const browserOwn = all.filter((n) => !ours(n) && n.by === 'system' && ['', 'system'].includes(n.loading) && mozilla(n));
      const stray = all.filter((n) => !ours(n) && !browserOwn.includes(n));
      t.check("the add-on's pages and background (moz-extension:// principal) sent requests only to the fake instance and the fake AI", byAddon.length > 0 && byAddon.every(ours), byAddon.filter((n) => !ours(n)).map((n) => `${n.method} ${n.url}`).slice(0, 3).join(' | ') || `${byAddon.length} request(s), to ${[...new Set(byAddon.map((n) => originOf(n.url)))].join(', ')}`);
      t.check("the ServiceNow page and the content scripts (the page's principal) sent requests only to the fake instance", byPages.length > 0 && byPages.every((n) => originOf(n.url) === ctx.origin), byPages.filter((n) => originOf(n.url) !== ctx.origin).map((n) => n.url).slice(0, 3).join(' | ') || `${byPages.length} request(s)`);
      t.check("nothing went anywhere except the fake instance and the fake AI (every request Firefox made; only Firefox's own requests to Mozilla services aside)", stray.length === 0, stray.map((n) => `${n.method} ${n.url} by ${n.by}`).slice(0, 3).join(' | '));
      t.info(`Firefox's own requests (system principal): ${browserOwn.length}, to ${[...new Set(browserOwn.map((n) => hostOf(n.url)))].join(', ') || 'nowhere'}`);

      // Every request the fake instance logged was seen by the watcher too (so the watcher is complete).
      const key = (method, url) => `${method} ${url}`;
      const watched = new Map();
      for (const n of all.filter((x) => originOf(x.url) === ctx.origin)) {
        const u = new URL(n.url);
        const k = key(n.method, u.pathname + u.search);
        watched.set(k, (watched.get(k) || 0) + 1);
      }
      const missing = [];
      for (const r of inst.requests) {
        const k = key(r.method, r.path + r.search);
        if (watched.get(k)) watched.set(k, watched.get(k) - 1);
        else missing.push(k);
      }
      t.check("every request the fake instance logged is in the browser watcher's log too (the watcher misses nothing)", missing.length === 0, missing.slice(0, 3).join(' | '));

      // WebDriver BiDi's own network events, as a second view: they cover the tabs (extension pages in a tab included), not the
      // background page and not Firefox's own traffic.
      const bidiStray = ctx.bidiNet.filter((n) => /^https?:/.test(n.url) && !n.url.includes(SELFTEST) && ![ctx.origin, aiOrigin].includes(originOf(n.url)));
      t.check('BiDi network events: every request they reported went to the fake instance or the fake AI', bidiStray.length === 0, bidiStray.map((n) => n.url).slice(0, 3).join(' | '));
      const bidiAi = ctx.bidiNet.filter((n) => originOf(n.url) === aiOrigin).length;
      const bidiInst = ctx.bidiNet.filter((n) => originOf(n.url) === ctx.origin).length;
      t.info(`network sources: Firefox's own http-on-modify-request observer (${all.length} requests in all), the two servers' logs, and BiDi network events (they saw ${bidiInst} requests to the instance, which logged ${inst.requests.length}, and ${bidiAi} to the fake AI, which logged ${ai.all.length + ai.listings.length})`);
    },
  },
];

async function main() {
  const headed = process.argv.includes('--headed') || process.env.E2E_HEADED === '1';
  const started = Date.now();
  const t = new Checker();
  let ctx;
  try {
    ctx = await withTimeout(createFirefoxContext({ headed }), 90000, 'starting Firefox with the add-on');
  } catch (err) {
    console.error(`Could not start the Firefox run: ${String(err.message || err).split('\n')[0]}`);
    process.exit(err.setup ? 2 : 1);
  }
  ctx.webErrors = [];
  console.log('Agent Buddy end-to-end run in Firefox');
  console.log(`  Firefox        ${ctx.firefoxVersion}  (${require('./firefox.js').FIREFOX})`);
  console.log(`  fake instance  ${ctx.origin}  (HTTPS, self-signed, strict CSP)`);
  console.log(`  fake AI        ${ctx.ai.baseUrl}`);
  console.log(`  add-on         ${ctx.extensionId}  at ${ctx.extOrigin}`);
  console.log(`  build          ${ctx.extension.source}`);
  console.log(`  files          ${TMP}`);
  console.log("  note           the build's own manifest.json is NOT modified; a temp copy gets localhost host_permissions");

  // Never hang: a hard stop for the whole run, and a time box per step.
  const hardStop = setTimeout(async () => {
    console.log(`\nHARD STOP: the run did not finish within ${Math.round(RUN_TIMEOUT_MS / 1000)}s (${t.pass} passed, ${t.fail} failed so far).`);
    await Promise.race([ctx.close(), after(10000)]);
    process.exit(1);
  }, RUN_TIMEOUT_MS);

  for (const [i, step] of STEPS.entries()) {
    t.section(`${i + 1}. ${step.title}`);
    try {
      await withTimeout(step.run(t, ctx), STEP_TIMEOUT_MS, `step ${i + 1}`);
    } catch (err) {
      const lines = String(err.stack || err).split('\n');
      const ours = lines.filter((l) => /[\\/]e2e[\\/]/.test(l) && !/[\\/]node_modules[\\/]/.test(l)).slice(0, 2).map((l) => l.trim().replace(/^at /, '').replace(/.*[\\/]e2e[\\/]/, 'e2e/'));
      t.check(`step ${i + 1} ran to the end`, false, `${lines[0]} | at ${ours.join(' | ') || 'unknown'}`);
    }
  }

  clearTimeout(hardStop);
  await ctx.close();
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
