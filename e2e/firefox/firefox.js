// Infrastructure for the Firefox end-to-end run: the fake servers (the same ones the Chrome run uses), a patched COPY of the Firefox
// build, a Firefox driven through WebDriver BiDi (puppeteer-core), and two watchers inside Firefox itself.
//
// Why this is not e2e/harness.js: that one is built on the Chrome DevTools protocol (CDP), which Firefox does not have. What Firefox
// 159 lets automation do, found by trying (the run checks each of these again):
//   - The add-on is installed as a temporary add-on through BiDi webExtension.install (puppeteer's browser.installExtension). Its
//     pages live at moz-extension://<uuid>, a random id made at install; the pref extensions.webextensions.uuids fixes it, so the run
//     knows the address of sidepanel.html and options.html in advance.
//   - BiDi refuses to open or touch moz-extension:// pages ("Navigation ... is not allowed in this context") unless Firefox is started
//     with MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1. With it, a tab can be sent to an extension page and scripts can run in it. Firefox still
//     sends no load event and no log entry (console line, error) for an extension page (WebDriver BiDi leaves extension contexts out
//     of its lists, Firefox bug 1755014); its network events do cover an extension page in a tab, but not the background page. So the
//     run waits for document.readyState itself and watches errors and requests from inside the browser (below); the run's first
//     step measures again what BiDi reports.
//   - The same switch lets the run evaluate in the browser window itself (BiDi "moz:scope": "chrome"). There it registers two
//     watchers that see EVERYTHING the browser does, whichever page, frame, content script or background page did it:
//       errors    a console-service listener: every JavaScript error, CSP violation and warning, with its source address
//       requests  an http-on-modify-request observer: every HTTP(S) request the browser makes, with the principal (the page or the
//                 add-on) that asked for it
//     console.error / console.warn calls are not forwarded to that service from the add-on's own process, so they are read from
//     Firefox's standard output instead (devtools.console.stdout.content), where they arrive without the page they came from.
//
// The REAL build is never touched: dist-firefox/ is copied and only the COPY's manifest.json gets host_permissions for localhost (as
// e2e/harness.js does for Chrome), so no permission prompt is needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');
// The folder for the run's files (the TLS key, the patched copy of the add-on, the bundled fixtures). A new one per run unless
// AB_E2E_TMP names one.
const TMP = process.env.AB_E2E_TMP || path.join(os.tmpdir(), `agentbuddy-e2e-firefox-${Date.now().toString(36)}-${process.pid}`);
// The Firefox that puppeteer's own browser download put in its cache (npx @puppeteer/browsers install firefox@stable); any Firefox
// 128 or later can be named instead.
const FIREFOX = process.env.FIREFOX_PATH || path.join(os.homedir(), '.cache', 'puppeteer', 'firefox', 'win64-stable_159.0.1', 'core', 'firefox.exe');
const GECKO_ID = require('../../scripts/lib/browsers.js').GECKO_ID;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Storage keys the extension uses (as in e2e/harness.js). */
const KEYS = { settings: 'agentbuddy_settings', audit: 'agentbuddy_audit', keyFor: (provider) => `agentbuddy_key_${provider}` };

/** The shared fixtures are ES modules; bundle them with esbuild (as e2e/harness.js does) and load the result. */
function loadData() {
  const outfile = path.join(TMP, 'data.cjs');
  esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'data.entry.js')], bundle: true, platform: 'node', format: 'cjs', outfile, loader: { '.js': 'jsx' }, logLevel: 'warning' });
  delete require.cache[outfile];
  return require(outfile);
}

/**
 * A function of the source compiled for Firefox, to run inside a page of the add-on: restrictStorageAccess from src/background/bar.js,
 * so the run reports what the real function returns in Firefox (not a copy of its logic).
 */
async function storageProbeSource() {
  const { bundleOptions } = require('../../scripts/lib/entries.js');
  const out = await esbuild.build({
    ...bundleOptions(ROOT, 'firefox'),
    stdin: { contents: "export { restrictStorageAccess } from './src/background/bar.js';", resolveDir: ROOT, loader: 'js' },
    globalName: '__abStorageProbe',
    write: false,
    logLevel: 'warning',
  });
  return out.outputFiles[0].text;
}

/**
 * Copy the Firefox build and patch ONLY the copy's manifest.
 * @param {string[]} hosts the host permissions the copy gets
 */
function prepareExtension(hosts) {
  const dist = process.env.E2E_FIREFOX_DIST ? path.resolve(process.env.E2E_FIREFOX_DIST) : path.join(ROOT, 'dist-firefox');
  const realManifestPath = path.join(dist, 'manifest.json');
  if (!fs.existsSync(realManifestPath)) throw new Error(`${path.relative(ROOT, dist) || dist}/ is missing. Run \`node build.js --browser firefox\` first (npm run e2e:firefox does).`);
  const real = JSON.parse(fs.readFileSync(realManifestPath, 'utf8'));
  if (!real.browser_specific_settings?.gecko) throw new Error(`${realManifestPath} is not a Firefox build (no browser_specific_settings.gecko). Build it with: node build.js --browser firefox`);
  const realManifestHash = sha256(realManifestPath);
  const dir = path.join(TMP, 'extension');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(dist, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.host_permissions) throw new Error('The real manifest already has host_permissions; this harness assumes it has none.');
  manifest.host_permissions = hosts;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifest, realManifestPath, realManifestHash, geckoId: real.browser_specific_settings.gecko.id, source: path.relative(ROOT, dist) || dist };
}

// What the run made that is not for a person to look at goes when the run ends, however it ends. A folder this run made and left
// empty goes too.
function removeRunFiles() {
  for (const name of ['tls', 'extension', 'data.cjs']) {
    try {
      fs.rmSync(path.join(TMP, name), { recursive: true, force: true });
    } catch {
      /* Firefox still holds a file of the copy (Windows): it is not secret, and a later run uses its own folder */
    }
  }
  try {
    if (!process.env.AB_E2E_TMP && !fs.readdirSync(TMP).length) fs.rmdirSync(TMP);
  } catch {
    /* already gone */
  }
}

// ---- The fake instance at https://localhost ---------------------------------------------------------------------------------
// Firefox takes a match pattern with a port ("https://localhost:52574/*") without complaint, but it matches no address at all, not
// even one with that very port; "https://localhost/*" matches every port (found by trying: the "Turn on" step below shows it again
// on every run). The add-on asks for exactly its site's origin (instancePattern in src/policy/policy.js), so in Firefox only a site
// with no port in its address can be turned on, which is what ServiceNow's own instances (https://<name>.service-now.com) are. The
// fake instance (e2e/fakeInstance.js, shared with the Chrome run) listens on a random port, so a plain TCP forwarder on the loopback
// interface, port 443, passes the bytes through unchanged (TLS included): Firefox sees https://localhost.
const SITE_PORT = 443;

async function forwardSite(port, targetPort) {
  const net = require('net');
  const sockets = new Set();
  const servers = [];
  const make = () =>
    net.createServer((client) => {
      const upstream = net.connect(targetPort, '127.0.0.1');
      sockets.add(client);
      sockets.add(upstream);
      const done = () => {
        client.destroy();
        upstream.destroy();
        sockets.delete(client);
        sockets.delete(upstream);
      };
      client.on('error', done).on('close', done);
      upstream.on('error', done).on('close', done);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  // Loopback only (IPv4, and IPv6 where the computer has it): nothing outside this computer can reach the fake instance through here.
  for (const host of ['127.0.0.1', '::1']) {
    const server = make();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      servers.push(server);
    } catch (err) {
      if (host === '127.0.0.1') throw err;
    }
  }
  return {
    close: () =>
      Promise.all(
        servers.map(
          (s) =>
            new Promise((resolve) => {
              for (const socket of sockets) socket.destroy();
              s.close(() => resolve());
            })
        )
      ),
  };
}

/** Does Firefox's own MatchPattern match `url` with `pattern`? (run in the browser window) */
const matchPatternProbe = (pattern, url) => `JSON.stringify((() => { try { return new MatchPattern(${JSON.stringify(pattern)}).matches(Services.io.newURI(${JSON.stringify(url)})); } catch (e) { return 'threw ' + e.message; } })())`;

// ---- The watchers inside Firefox (run in the browser window, with the browser's own privileges) -----------------------------
// Installed once, before the add-on, so its first moments are seen. Each entry has a sequence number: a check looks only at what
// happened since a mark. (This text runs inside Firefox, not in Node.)
const WATCHERS = `(() => {
  if (window.__abE2E) return 'already';
  const log = (window.__abE2E = { seq: 0, errors: [], net: [] });
  const who = (p) => {
    try {
      if (!p) return '';
      if (p.isSystemPrincipal) return 'system';
      if (p.isNullPrincipal) return 'null';
      if (p.isExpandedPrincipal) return 'expanded:' + p.QueryInterface(Ci.nsIExpandedPrincipal).allowlist.map((x) => x.origin).join('|');
      return p.origin;
    } catch (e) {
      return '?';
    }
  };
  log.listener = {
    observe(message) {
      const seq = ++log.seq;
      try {
        const e = message.QueryInterface(Ci.nsIScriptError);
        let page = '';
        try {
          page = e.innerWindowID ? WindowGlobalParent.getByInnerWindowId(e.innerWindowID)?.documentURI?.spec || '' : '';
        } catch (err) {}
        log.errors.push({ seq, text: e.errorMessage, source: e.sourceName || '', line: e.lineNumber, category: e.category || '', warning: Boolean(e.flags & 1) || Boolean(e.flags & 8), page, plain: false });
      } catch (err) {
        log.errors.push({ seq, text: String(message.message || ''), source: '', category: 'log', warning: /\\tWARN\\t|\\tINFO\\t|\\tDEBUG\\t/.test(String(message.message || '')), page: '', plain: true });
      }
    },
  };
  Services.console.registerListener(log.listener);
  log.observer = {
    observe(subject) {
      try {
        const ch = subject.QueryInterface(Ci.nsIHttpChannel);
        const li = ch.loadInfo;
        log.net.push({ seq: ++log.seq, method: ch.requestMethod, url: ch.URI.spec, by: who(li && li.triggeringPrincipal), loading: who(li && li.loadingPrincipal), type: li ? li.externalContentPolicyType : 0 });
      } catch (err) {}
    },
  };
  Services.obs.addObserver(log.observer, 'http-on-modify-request');
  return 'installed';
})()`;

/**
 * Start everything and return the context the run's checks share.
 * @param {{ headed?: boolean }} options
 */
async function createFirefoxContext({ headed = false } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  process.on('exit', removeRunFiles);
  const puppeteer = require('puppeteer-core');
  const { makeCertificate } = require('../tls.js');
  const { startFakeInstance } = require('../fakeInstance.js');
  const { startFakeAi } = require('../fakeAi.js');

  if (!fs.existsSync(FIREFOX)) throw Object.assign(new Error(`No Firefox at ${FIREFOX}. Set FIREFOX_PATH to a Firefox 128 or later.`), { setup: true });
  const data = loadData();
  const tls = await makeCertificate(path.join(TMP, 'tls'));
  const user = { login: data.ME.login, sysId: data.ME.sysId, firstName: data.ME.firstName, lastName: data.ME.lastName, roles: data.ME.roles };
  const inst = await startFakeInstance(tls, { tables: data.buildTables(), makeApi: data.tableApi, user, portal: data.PORTAL });
  const ai = await startFakeAi();
  // The fake instance as Firefox sees it: https://localhost, with no port (see forwardSite).
  let site;
  try {
    site = await forwardSite(SITE_PORT, inst.port);
  } catch (err) {
    await inst.close().catch(() => {});
    await ai.close().catch(() => {});
    throw Object.assign(new Error(`Could not listen on port ${SITE_PORT} of this computer (${err.code || err.message}). In Firefox a site turned on must have no port in its address (a match pattern with a port matches nothing), so the fake ServiceNow is served at https://localhost through port ${SITE_PORT}. Free the port (or, on Linux, allow it: sysctl net.ipv4.ip_unprivileged_port_start=443).`), { setup: true });
  }
  const origin = 'https://localhost';
  const extension = prepareExtension(['https://localhost/*', 'http://localhost/*', 'http://127.0.0.1/*']);
  const uuid = crypto.randomUUID();
  const extOrigin = `moz-extension://${uuid}`;
  const extUrl = (file) => `${extOrigin}/${file}`;

  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: FIREFOX,
    headless: !headed,
    acceptInsecureCerts: true, // the fake instance's certificate is self-signed
    protocolTimeout: 30000, // one stuck call must not hold the whole run
    // Lets BiDi open and script the add-on's own pages, and evaluate in the browser window for the watchers (see the top of this file).
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: {
      // The add-on's pages get this address (moz-extension://<uuid>), so the run can open sidepanel.html and options.html in a tab.
      'extensions.webextensions.uuids': JSON.stringify({ [extension.geckoId]: uuid }),
      // console.error / console.warn of pages and of the add-on's own process are printed to Firefox's standard output.
      'devtools.console.stdout.content': true,
    },
    args: ['--width=1200', '--height=900'],
  });
  // From now on the run's files are removed after puppeteer's own 'exit' handler has ended Firefox (Windows holds open files).
  process.removeListener('exit', removeRunFiles);
  process.on('exit', removeRunFiles);

  /** console.error / console.warn lines Firefox printed: { seq, level, text } (no page is named). */
  const consoleLines = [];
  let stdoutSeq = 0;
  // (one unfinished line per stream: a line can arrive in two pieces)
  const reader = () => {
    let partial = '';
    return (chunk) => {
      const lines = (partial + String(chunk)).split(/\r?\n/);
      partial = lines.pop();
      for (const line of lines) {
        const m = /^console\.(error|warn):\s?(.*)$/.exec(line);
        if (m) consoleLines.push({ seq: ++stdoutSeq, level: m[1], text: m[2] });
      }
    };
  };
  browser.process()?.stdout?.on('data', reader());
  browser.process()?.stderr?.on('data', reader());

  const conn = browser.connection;
  /** BiDi network events and log entries (puppeteer subscribes to every module): what WebDriver BiDi itself reports. */
  const bidiNet = [];
  const bidiLog = [];
  conn.on('network.beforeRequestSent', (e) => bidiNet.push({ context: e.context, url: e.request?.url || '', method: e.request?.method || '' }));
  conn.on('log.entryAdded', (e) => bidiLog.push({ level: e.level, text: String(e.text || ''), context: e.source?.context || '' }));

  // The browser window, for the watchers.
  const tree = await conn.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
  const chromeWindow = (tree.result.contexts || []).find((c) => c.url === 'chrome://browser/content/browser.xhtml') || tree.result.contexts[0];
  if (!chromeWindow) throw new Error('No browser window to watch from (BiDi "moz:scope": "chrome" listed none).');
  /** Evaluate an expression in the browser window (privileged). It must return a string or a number. */
  const inChrome = async (expression) => {
    const { result } = await conn.send('script.evaluate', { expression, target: { context: chromeWindow.context }, awaitPromise: true, resultOwnership: 'none' });
    if (result.type === 'exception') throw new Error(`in the browser window: ${result.exceptionDetails?.text || 'exception'}`);
    return result.result?.value;
  };
  const watchers = await inChrome(WATCHERS);
  const firefoxVersion = await inChrome('Services.appinfo.version');

  const extensionId = await browser.installExtension(extension.dir);

  /** Everything the watchers saw since `mark` (a mark is { seq, out }: the browser's sequence number and the standard output's). */
  const watched = async (mark = { seq: 0, out: 0 }) => {
    const all = JSON.parse(await inChrome(`JSON.stringify({ seq: window.__abE2E.seq, errors: window.__abE2E.errors.filter((e) => e.seq > ${Number(mark.seq) || 0}), net: window.__abE2E.net.filter((e) => e.seq > ${Number(mark.seq) || 0}) })`));
    return { ...all, console: consoleLines.filter((c) => c.seq > (mark.out || 0)) };
  };
  const mark = async () => ({ seq: Number(await inChrome('window.__abE2E.seq')), out: stdoutSeq });

  const ctx = {
    TMP, ROOT, data, inst, ai, extension, browser, conn, extensionId, uuid, extOrigin, extUrl, firefoxVersion, watchers, bidiNet, bidiLog, KEYS, sleep, sha256,
    // The fake instance as Firefox sees it (https://localhost, through the forwarder); inst.origin is its own address with the port.
    origin,
    /** Does Firefox's own MatchPattern match `url` with `pattern`? */
    matchPattern: async (pattern, url) => JSON.parse(await inChrome(matchPatternProbe(pattern, url))),
    inChrome,
    watched,
    mark,
    storageProbeSource,

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
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${last instanceof Error ? ` (${last.message.split('\n')[0]})` : ''}`);
        await sleep(every);
      }
    },

    /**
     * One of the add-on's pages in a new tab (or a new window). BiDi sends no load event for an extension page, so this waits for the
     * document itself. `wait` is a function run in the page that says when it is ready (default: document.readyState is complete).
     */
    async openExtensionPage(file, { window: inWindow = false, ready = null, timeout = 15000 } = {}) {
      const page = await browser.newPage(inWindow ? { type: 'window', background: true } : undefined);
      const url = extUrl(file);
      await conn.send('browsingContext.navigate', { context: page.mainFrame()._id, url, wait: 'none' });
      await ctx.waitUntil(`${file} to load`, () => page.evaluate((u) => location.href === u && document.readyState === 'complete', url), { timeout });
      if (ready) await ctx.waitUntil(`${file} to be ready`, () => page.evaluate(ready), { timeout });
      return page;
    },

    /**
     * Close a page. BiDi may not close an extension page itself ("does not support browsing contexts in privileged scope"), so it is
     * sent to about:blank first.
     */
    async closePage(page) {
      if (!page || page.isClosed()) return;
      await conn.send('browsingContext.navigate', { context: page.mainFrame()._id, url: 'about:blank', wait: 'complete' }).catch(() => {});
      await page.close().catch(() => {});
    },

    async close() {
      await Promise.race([browser.close().catch(() => {}), sleep(10000)]);
      await site.close().catch(() => {});
      await inst.close().catch(() => {});
      await ai.close().catch(() => {});
      removeRunFiles();
    },
  };

  // The control page: an extension page the run calls the add-on's APIs from. It is also the Settings page under test.
  ctx.ctl = await ctx.openExtensionPage('options.html', { ready: () => /Agent Buddy settings/.test(document.body.innerText) });
  /** Run a function inside the control page (an extension page: chrome.runtime, storage, scripting and tabs are there). */
  ctx.ext = (fn, ...args) => ctx.ctl.evaluate(fn, ...args);

  /** Merge a patch into the extension settings (the way saveSettings does) and optionally store the AI key (as e2e/harness.js does). */
  ctx.configure = async (patch, { key } = {}) => {
    await ctx.ext(
      async (settingsKey, p, keyArg) => {
        const cur = (await chrome.storage.local.get(settingsKey))[settingsKey] || {};
        await chrome.storage.local.set({ [settingsKey]: { ...cur, ...p } });
        if (keyArg) await chrome.storage.local.set({ [keyArg.slot]: keyArg.value });
      },
      KEYS.settings,
      patch,
      key ? { slot: KEYS.keyFor(key.provider), value: key.value } : null
    );
  };
  ctx.settings = () => ctx.ext(async (k) => (await chrome.storage.local.get(k))[k] || {}, KEYS.settings);

  return ctx;
}

module.exports = { createFirefoxContext, removeRunFiles, TMP, FIREFOX, GECKO_ID };
