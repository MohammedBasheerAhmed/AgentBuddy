// Infrastructure for the end-to-end run: build the fixture data, start the fake servers, copy and patch the extension,
// launch Chrome with it, and give the scenarios a few helpers (pages, panel, storage, network log).
//
// The REAL manifest is never touched. The harness copies dist/ to a temp folder and patches only that copy's manifest.json
// to add "host_permissions" for localhost, so no browser permission prompt is needed in automation. Everything else about
// the extension (code, CSP, permissions, optional host permissions) is exactly what dist/ contains.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const TMP = process.env.AB_E2E_TMP || path.join(os.tmpdir(), 'agentbuddy-e2e');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Storage keys the extension uses (src/lib/storage.js, src/audit/auditLog.js, src/lib/keyStore.js). */
const KEYS = { settings: 'agentbuddy_settings', audit: 'agentbuddy_audit', keyFor: (provider) => `agentbuddy_key_${provider}` };

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The shared fixtures are ES modules; bundle them with esbuild (as tests/run.js does) and load the result. */
function loadData() {
  const outfile = path.join(TMP, 'data.cjs');
  esbuild.buildSync({ entryPoints: [path.join(__dirname, 'data.entry.js')], bundle: true, platform: 'node', format: 'cjs', outfile, loader: { '.js': 'jsx' }, logLevel: 'warning' });
  delete require.cache[outfile];
  return require(outfile);
}

/** Copy dist/ and patch ONLY the copy's manifest. Returns { dir, manifest, realManifestHash }. */
function prepareExtension() {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/ is missing. Run `node build.js` first (npm run e2e does).');
  const realManifestHash = sha256(path.join(dist, 'manifest.json'));
  const dir = path.join(TMP, 'extension');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(dist, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.host_permissions) throw new Error('The real manifest already has host_permissions; this harness assumes it has none.');
  manifest.host_permissions = ['https://localhost/*', 'http://localhost/*', 'http://127.0.0.1/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifest, realManifestHash, realManifestPath: path.join(dist, 'manifest.json') };
}

// ---- Network and error bookkeeping ----------------------------------------------------------------------------------

const INTERNAL_SCHEMES = /^(chrome-extension|data|blob|about|chrome|devtools):/i;

/**
 * Create the context every scenario shares.
 * @param {{ headed?: boolean, log?: Function }} options
 */
async function createContext({ headed = false } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const puppeteer = require('puppeteer-core');
  const { makeCertificate } = require('./tls.js');
  const { startFakeInstance } = require('./fakeInstance.js');
  const { startFakeAi } = require('./fakeAi.js');

  const data = loadData();
  const tls = await makeCertificate(path.join(TMP, 'tls'));
  const user = { login: data.ME.login, sysId: data.ME.sysId, firstName: data.ME.firstName, lastName: data.ME.lastName, roles: data.ME.roles };
  const inst = await startFakeInstance(tls, { tables: data.buildTables(), makeApi: data.tableApi, user });
  const ai = await startFakeAi();
  const ext = prepareExtension();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headed ? false : 'new',
    pipe: true, // required for enableExtensions
    enableExtensions: [ext.dir],
    acceptInsecureCerts: true,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--window-size=1200,900'],
  });

  /** Every network request seen by any page or the service worker: { from, url, method }. */
  const net = [];
  /** Page errors and console errors: { from, kind: 'pageerror'|'console'|'csp', text, url }. */
  const errors = [];
  /** Every browser target ever created: { type, url }. */
  const targets = [];
  const tracked = new WeakSet();

  const trackPage = (page, label) => {
    if (tracked.has(page)) return;
    tracked.add(page);
    page.on('request', (req) => net.push({ from: label, url: req.url(), method: req.method() }));
    page.on('pageerror', (err) => errors.push({ from: label, kind: 'pageerror', text: String(err?.message || err), url: page.url() }));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      errors.push({ from: label, kind: /content security policy|refused to/i.test(text) ? 'csp' : 'console', text, url: msg.location()?.url || page.url() });
    });
    // CSP violations are also reported as DOM events; collect them even if the console line was missed.
    page.evaluateOnNewDocument(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    }).catch(() => {});
  };

  // The service worker is not a Page: watch it through its own DevTools session.
  const trackWorker = async (target) => {
    try {
      const session = await target.createCDPSession();
      await session.send('Network.enable');
      await session.send('Runtime.enable');
      session.on('Network.requestWillBeSent', (e) => net.push({ from: 'service-worker', url: e.request.url, method: e.request.method }));
      session.on('Runtime.exceptionThrown', (e) => errors.push({ from: 'service-worker', kind: 'pageerror', text: e.exceptionDetails?.exception?.description || e.exceptionDetails?.text || 'exception', url: target.url() }));
      session.on('Runtime.consoleAPICalled', (e) => {
        if (e.type === 'error') errors.push({ from: 'service-worker', kind: 'console', text: (e.args || []).map((a) => a.value ?? a.description ?? '').join(' '), url: target.url() });
      });
    } catch {
      /* the worker went away before we could attach */
    }
  };

  browser.on('targetcreated', async (target) => {
    targets.push({ type: target.type(), url: target.url() });
    if (target.type() === 'service_worker') trackWorker(target);
    else if (target.type() === 'page') {
      const page = await target.page().catch(() => null);
      if (page) trackPage(page, `page:${target.url().slice(0, 60) || 'new'}`);
    }
  });

  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.bundle.js'), { timeout: 20000 });
  trackWorker(swTarget);
  const extId = new URL(swTarget.url()).host;
  const extUrl = (file) => `chrome-extension://${extId}/${file}`;

  const ctx = {
    TMP, data, inst, ai, extension: ext, browser, extId, extUrl, net, errors, targets, swTarget, sleep, KEYS,
    origin: inst.origin,
    shots: [],

    /** A new tab, tracked for errors and network. */
    async newPage(label) {
      const page = await browser.newPage();
      trackPage(page, label);
      return page;
    },

    /** Poll until fn() is truthy (or throw with `what`). */
    async waitUntil(what, fn, { timeout = 15000, every = 150 } = {}) {
      const end = Date.now() + timeout;
      let last;
      for (;;) {
        try {
          last = await fn();
          if (last) return last;
        } catch (err) {
          last = err;
        }
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ''}`);
        await sleep(every);
      }
    },

    /** Save a screenshot for debugging; returns the path. */
    async shot(page, name) {
      const file = path.join(TMP, `${name.replace(/[^a-z0-9-]+/gi, '_')}.png`);
      try {
        await page.screenshot({ path: file });
        ctx.shots.push(file);
        return file;
      } catch {
        return '';
      }
    },

    async close() {
      await browser.close().catch(() => {});
      await inst.close().catch(() => {});
      await ai.close().catch(() => {});
    },
  };

  // The control page: an extension page we call chrome.* APIs from. It is also the options page under test.
  ctx.ctl = await ctx.newPage('options.html');
  await ctx.ctl.goto(extUrl('options.html'), { waitUntil: 'load' });

  /** Run a function inside the control page (an extension page, so chrome.runtime/storage/scripting/tabs are there). */
  ctx.ext = (fn, ...args) => ctx.ctl.evaluate(fn, ...args);

  /** Merge a patch into the extension settings (the way saveSettings does) and optionally store the AI key (key store mode 'local'). */
  ctx.configure = async (patch, { key } = {}) => {
    await ctx.ext(async (settingsKey, patch, keyArg) => {
      const cur = (await chrome.storage.local.get(settingsKey))[settingsKey] || {};
      await chrome.storage.local.set({ [settingsKey]: { ...cur, ...patch } });
      if (keyArg) await chrome.storage.local.set({ [keyArg.slot]: keyArg.value });
    }, KEYS.settings, patch, key ? { slot: KEYS.keyFor(key.provider), value: key.value } : null);
  };

  ctx.settings = () => ctx.ext(async (k) => (await chrome.storage.local.get(k))[k] || {}, KEYS.settings);
  ctx.audit = () => ctx.ext(async (k) => (await chrome.storage.local.get(k))[k] || [], KEYS.audit);

  /** A ticket (or any instance) page, brought to the front so the side panel sees it as the active tab. */
  ctx.openInstancePage = async (pathAndQuery, label = 'instance') => {
    const page = await ctx.newPage(label);
    await page.goto(`${inst.origin}${pathAndQuery}`, { waitUntil: 'load' });
    await page.bringToFront();
    return page;
  };

  /**
   * The real side panel UI. Chrome's own side-panel chrome cannot be driven by automation, so sidepanel.html is opened in a
   * small separate popup window; the instance tab stays the active tab of the main window, which is what the panel reads.
   */
  ctx.openPanel = async () => {
    const url = extUrl('sidepanel.html');
    const before = new Set(browser.targets());
    const windowId = await ctx.ext(async (u) => (await chrome.windows.create({ url: u, type: 'popup', width: 440, height: 820, focused: false })).id, url);
    const target = await browser.waitForTarget((t) => !before.has(t) && t.url() === url, { timeout: 8000 });
    const page = await target.page();
    trackPage(page, 'sidepanel.html');
    await page.waitForSelector('.ab-app', { timeout: 8000 });
    return {
      page,
      windowId,
      text: () => page.evaluate(() => document.body.innerText),
      async close() {
        await ctx.ext((id) => chrome.windows.remove(id), windowId).catch(() => {});
      },
    };
  };

  return ctx;
}

module.exports = { createContext, sleep, sha256, KEYS, TMP };
