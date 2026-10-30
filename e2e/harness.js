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
  const mutation = process.env.E2E_MUTATE || '';
  if (mutation) applyMutation(dir, mutation);
  return { dir, manifest, realManifestHash, realManifestPath: path.join(dist, 'manifest.json'), mutation };
}

// SELF-CHECK OF THE HARNESS (not part of a normal run): `E2E_MUTATE=<name> node e2e/run.js` breaks the COPY of the extension on
// purpose, to show that the run then FAILS. A test that cannot fail proves nothing. Each mutation must match exactly once.
const MUTATIONS = {
  // the content script sends PATCH instead of GET -> the read-only checks must fail
  write: ['content.bundle.js', 'method: "GET" });', 'method: "PATCH" });'],
  // the first provider adapter adds raw personal data to the request body -> the leak sweep must fail
  leak: ['sidepanel.bundle.js', 'body: JSON.stringify(body)', 'body: JSON.stringify({ ...body, note: "caller Abel Tuter card 4111 1111 1111 1111" })'],
  // the panel phones home -> the network checks must fail
  beacon: ['sidepanel.bundle.js', '(0, import_client.createRoot)(document.getElementById("root"))', '(fetch("https://telemetry.example/ping").catch(() => {}), 0, import_client.createRoot)(document.getElementById("root"))'],
  // the page bridge writes into a portal box silently (no input event): the portal scenario must notice that the page's model is stale
  'portal-silent': ['pagebridge.js', 'setControlValue(el, next);\n          fireEvent(el, "input", true);', 'setControlValue(el, next);\n          ;'],
  // the page bridge presses the portal's Send button after filling the box: the portal scenario must notice
  'portal-click': ['pagebridge.js', 'setControlValue(el, next);\n          fireEvent(el, "input", true);', 'setControlValue(el, next);\n          document.getElementById("send") && document.getElementById("send").click();\n          fireEvent(el, "input", true);'],
};

function applyMutation(dir, name) {
  const m = MUTATIONS[name];
  if (!m) throw new Error(`Unknown E2E_MUTATE "${name}". Known: ${Object.keys(MUTATIONS).join(', ')}`);
  const file = path.join(dir, m[0]);
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(m[1])) throw new Error(`Mutation ${name} does not match the build any more (${m[1].slice(0, 50)}).`);
  fs.writeFileSync(file, text.replace(m[1], () => m[2])); // the first match only
  console.log(`!! MUTATION "${name}" applied to the COPY of the extension (self-check of the harness: failures are expected)`);
}

// ---- Network and error bookkeeping ----------------------------------------------------------------------------------


/**
 * Create the context every scenario shares.
 * @param {{ headed?: boolean, watchWorker?: boolean }} options
 *   watchWorker: attach a DevTools session to the service worker to log its errors and requests (default). An attached session
 *   keeps the worker alive, so a test of the idle shut-down (30 s) must turn it off.
 */
async function createContext({ headed = false, watchWorker = true } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const puppeteer = require('puppeteer-core');
  const { makeCertificate } = require('./tls.js');
  const { startFakeInstance } = require('./fakeInstance.js');
  const { startFakeAi } = require('./fakeAi.js');

  const data = loadData();
  const tls = await makeCertificate(path.join(TMP, 'tls'));
  const user = { login: data.ME.login, sysId: data.ME.sysId, firstName: data.ME.firstName, lastName: data.ME.lastName, roles: data.ME.roles };
  const inst = await startFakeInstance(tls, { tables: data.buildTables(), makeApi: data.tableApi, user, portal: data.PORTAL });
  const ai = await startFakeAi();
  const ext = prepareExtension();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headed ? false : 'new',
    pipe: true, // required for enableExtensions
    protocolTimeout: 30000, // one stuck DevTools call must not hold the whole run for the default three minutes
    enableExtensions: [ext.dir],
    acceptInsecureCerts: true,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--window-size=1200,900'],
  });

  /** Every network request seen by any page or the service worker: { from, url, method }. */
  const net = [];
  /** Page errors and console errors: { from, kind: 'pageerror'|'console'|'csp', text, url }. */
  const errors = [];
  /** Every console line of every page and the service worker (any level), to prove personal data is never logged. */
  const consoleLog = [];
  /** Every browser target ever created: { type, url }. */
  const targets = [];
  const tracked = new WeakSet();

  const trackPage = (page, label) => {
    if (tracked.has(page)) return;
    tracked.add(page);
    page.on('request', (req) => net.push({ from: label, url: req.url(), method: req.method() }));
    page.on('pageerror', (err) => errors.push({ from: label, kind: 'pageerror', text: String(err?.message || err), url: page.url() }));
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLog.push({ from: label, type: msg.type(), text });
      if (msg.type() !== 'error') return;
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
        consoleLog.push({ from: 'service-worker', type: e.type, text: (e.args || []).map((a) => a.value ?? a.description ?? '').join(' ') });
        if (e.type === 'error') errors.push({ from: 'service-worker', kind: 'console', text: (e.args || []).map((a) => a.value ?? a.description ?? '').join(' '), url: target.url() });
      });
    } catch {
      /* the worker went away before we could attach */
    }
  };

  browser.on('targetcreated', async (target) => {
    targets.push({ type: target.type(), url: target.url() });
    if (target.type() === 'service_worker' && watchWorker) trackWorker(target);
    else if (target.type() === 'page') {
      const page = await target.page().catch(() => null);
      if (page) trackPage(page, `page:${target.url().slice(0, 60) || 'new'}`);
    }
  });

  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.bundle.js'), { timeout: 20000 });
  if (watchWorker) trackWorker(swTarget);
  const extId = new URL(swTarget.url()).host;
  const extUrl = (file) => `chrome-extension://${extId}/${file}`;

  const ctx = {
    TMP, data, inst, ai, extension: ext, browser, extId, extUrl, net, errors, consoleLog, targets, swTarget, sleep, KEYS,
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
        // A page in a background tab can refuse to paint: do not let a debugging aid hang the run.
        await Promise.race([page.screenshot({ path: file }), sleep(4000).then(() => { throw new Error('screenshot timed out'); })]);
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
      // The throw-away TLS key and the extension copy are not needed any more (screenshots of failures stay).
      for (const dir of ['tls', 'extension']) fs.rmSync(path.join(TMP, dir), { recursive: true, force: true });
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

  /** Turn the fake instance on if an earlier scenario has not (so each scenario can also run alone). */
  ctx.ensureEnabled = async () => {
    const scripts = await ctx.ext(() => chrome.scripting.getRegisteredContentScripts());
    if (scripts.length !== 2) await ctx.ext((origin) => chrome.runtime.sendMessage({ type: 'ab:enable-instance', origin }), inst.origin);
  };

  /**
   * The key vault (src/lib/keyStore.js): the IndexedDB database on the extension's origin where "This browser" and "Encrypted"
   * keep the AI key, out of reach of content scripts. `op` is 'get' (returns { slot: value } for the slots that exist) or 'remove'.
   */
  ctx.vault = (op, keys) =>
    ctx.ext(
      (op, keys) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('agentbuddy_vault', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keys');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('keys', op === 'get' ? 'readonly' : 'readwrite');
            const store = tx.objectStore('keys');
            const out = {};
            keys.forEach((k) => {
              if (op !== 'get') return void store.delete(k);
              const r = store.get(k);
              r.onsuccess = () => {
                if (r.result !== undefined) out[k] = r.result;
              };
            });
            tx.oncomplete = () => {
              db.close();
              resolve(out);
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      op,
      keys
    );
  /** Every entry in the vault, as { slot: value } (for the "nothing about a record is stored" sweep). */
  ctx.vaultAll = () =>
    ctx.ext(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('agentbuddy_vault', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('keys');
          open.onerror = () => resolve({});
          open.onsuccess = () => {
            const db = open.result;
            const store = db.transaction('keys', 'readonly').objectStore('keys');
            const out = {};
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const c = cursor.result;
              if (c) {
                out[String(c.key)] = c.value;
                c.continue();
              } else {
                db.close();
                resolve(out);
              }
            };
            cursor.onerror = () => resolve(out);
          };
        })
    );

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
    // Sections that are not on screen stay mounted (hidden): scenarios that look at the page use this to see only what a person sees.
    const installVisible = () => {
      window.__vis = (list) => [...list].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
    };
    await page.evaluateOnNewDocument(installVisible);
    await page.evaluate(installVisible);
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
