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
  // E2E_DIST: a build in another folder (node build.js --out <folder>), so several people can run the e2e run at once.
  const dist = process.env.E2E_DIST ? path.resolve(process.env.E2E_DIST) : path.join(ROOT, 'dist');
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

  /** Every network request of any page (with its frames and workers) or the service worker: { from, url, method }. */
  const net = [];
  /** Page errors and console errors: { from, kind: 'pageerror'|'console'|'csp', text, url }. */
  const errors = [];
  /** Every console line of every page and the service worker (any level), to prove personal data is never logged. */
  const consoleLog = [];
  /** Every browser target ever created: { type, url, id }. */
  const targets = [];
  const tracked = new WeakSet();

  /** Errors and console lines of a page (its network requests are logged by watchNetwork below, from the page's start). */
  const trackPage = (page, label) => {
    if (tracked.has(page)) return;
    tracked.add(page);
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

  // ---- The network log of every page, from its first request to its last (TRACKER R7) ----
  // Not puppeteer's page.on('request'), which missed reads at both ends of a page's life:
  //  - at the START: puppeteer attaches to a new tab paused but resumes it at once, and switches the tab's Network domain on only
  //    when its Page object is built, after 'targetcreated', many round trips later.
  //  - at the END: Network.requestWillBeSent comes from the page's renderer, which sends these notes in batches. A read the page makes
  //    in its last moments (the tab is closed, or it navigates and a new document takes the frame over) reaches the instance, but its
  //    note is dropped with the old document. This is what the runs actually lost (a few reads per run, from the My work and
  //    Insights polls of a tab that was just being closed or navigated).
  // So the harness keeps its own log, through its own browser-level DevTools session:
  //  1. Network on every page from its start: the session auto-attaches to pages with waitForDebuggerOnStart, and on each sends
  //     Network.enable, then the same auto-attach for the page's frames in another process and its workers, then
  //     Runtime.runIfWaitingForDebugger, back to back without waiting for answers. Chrome runs one session's commands in order, so a
  //     target Chrome paused at start (a link opened in a new tab, a frame in another process, a worker) runs only with Network on;
  //     every session that paused a target must release it, so puppeteer releasing it first changes nothing. A tab the browser makes
  //     itself (chrome.tabs.create) is not paused, but this session hears of it as it is created and Network is on one round trip
  //     later, before the document is in. These notes give each request its page (the label).
  //  2. Fetch, browser-wide, as the backstop: every http(s) request of every page and frame is held in the BROWSER (not the page)
  //     until this session lets it go on, which it does at once. A request cannot reach a server without this session having seen
  //     it, whatever happens to the page afterwards. One request is logged once: Fetch names the Network note of the same request
  //     (networkId), and a request without one never had a note.
  // Puppeteer's own auto-attach (tab targets, then their pages) is not touched, and its Page objects still report errors and console
  // lines (trackPage). The service worker is left out of both: an attached session would keep it alive (see watchWorker), so it has
  // its own session (trackWorker), and requests without a frame (workers, the browser itself) are not logged from Fetch.
  /** targetId -> true when Chrome had paused the page at its start, false when it was already running (an existing or browser-made page). */
  const watchedPages = new Map();
  /** frameId -> label of the page it belongs to (a page's main frame has the page's target id). */
  const frameLabels = new Map();
  /** `${requestId} ${url}` -> which source told first ('network', 'fetch'), or 'both' once the note followed a Fetch report. */
  const toldBy = new Map();
  let fetchOnlyWithoutId = 0;
  const logRequest = (source, key, entry) => {
    if (!key) fetchOnlyWithoutId += 1;
    else if (toldBy.has(key)) {
      if (toldBy.get(key) === 'fetch' && source === 'network') toldBy.set(key, 'both');
      return; // the other source told first
    } else toldBy.set(key, source);
    net.push(entry);
  };
  /** Requests known only from the browser side (Fetch): the page's own note never came, as it closed or navigated. */
  const notelessRequests = () => fetchOnlyWithoutId + [...toldBy.values()].filter((v) => v === 'fetch').length;
  const watchNetwork = (session, info, label) => {
    let url = info.url;
    const from = label || (() => `page:${url.slice(0, 60) || 'new'}`);
    if (info.type === 'page') {
      watchedPages.set(info.targetId, Boolean(info.waitingForDebugger));
      frameLabels.set(info.targetId, from);
    }
    session.on('Network.requestWillBeSent', (e) => {
      if (!url) url = e.documentURL || e.request.url; // a page opened by a link starts without an address
      if (e.frameId && !frameLabels.has(e.frameId)) frameLabels.set(e.frameId, from);
      logRequest('network', `${e.requestId} ${e.request.url}`, { from: from(), url: e.request.url, method: e.request.method });
    });
    session.on('Target.attachedToTarget', (child) => {
      const s = session.connection()?.session(child.sessionId);
      if (s) watchNetwork(s, { ...child.targetInfo, waitingForDebugger: child.waitingForDebugger }, from);
    });
    // In this order, not awaited in between (see above). Errors: the target went away.
    session.send('Network.enable').catch(() => {});
    if (info.type !== 'worker') session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe' }, { type: 'worker' }] }).catch(() => {});
    session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  };
  const pageWatcher = await browser.target().createCDPSession();
  pageWatcher.on('Target.attachedToTarget', (e) => {
    const s = pageWatcher.connection()?.session(e.sessionId);
    if (s) watchNetwork(s, { ...e.targetInfo, waitingForDebugger: e.waitingForDebugger });
  });
  pageWatcher.on('Fetch.requestPaused', (e) => {
    pageWatcher.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {}); // (an error: the request was cancelled meanwhile)
    if (!e.frameId) return;
    const label = frameLabels.get(e.frameId);
    logRequest('fetch', e.networkId ? `${e.networkId} ${e.request.url}` : '', { from: label ? label() : `frame:${e.frameId.slice(0, 8)}`, url: e.request.url, method: e.request.method });
  });
  await pageWatcher.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await pageWatcher.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });

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
    targets.push({ type: target.type(), url: target.url(), id: target._targetId });
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
    TMP, data, inst, ai, extension: ext, browser, extId, extUrl, net, errors, consoleLog, targets, watchedPages, notelessRequests, swTarget, sleep, KEYS,
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

  // Which window and tab the browser calls focused and active, over time. The panel is a small popup window here (see openPanel) and
  // reads "the active tab of the last focused window"; on Linux (CI) it was found looking at itself. The log (with the time of each
  // change) is printed when a scenario fails, to be read next to the run's own timestamps.
  await ctx.ctl
    .evaluate(() => {
      window.__focusLog = [];
      const note = (what) => window.__focusLog.push(`${new Date().toISOString().slice(11, 23)} ${what}`);
      let last = null;
      setInterval(async () => {
        try {
          const w = await chrome.windows.getLastFocused();
          if (w.id !== last) note(`last focused window is now ${w.id} (${w.type})`);
          last = w.id;
        } catch {
          /* the browser is closing */
        }
      }, 50);
      chrome.windows.onFocusChanged.addListener((id) => note(`onFocusChanged ${id}`));
      chrome.windows.onCreated.addListener((w) => note(`window ${w.id} created (${w.type}, focused=${w.focused})`));
      chrome.tabs.onActivated.addListener((a) => note(`tab ${a.tabId} active in window ${a.windowId}`));
    })
    .catch(() => {});

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
