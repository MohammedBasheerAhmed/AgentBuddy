// e. Read-only proof and network proof, over EVERYTHING the earlier scenarios did:
//    - the instance saw only GETs, only to /api/now/table or /api/now/stats, always with the session token
//    - the AI server saw only chat completions, sent from the extension's own page, never containing raw personal data
//    - nothing else was contacted by any page, content script or the service worker
//    - no unexpected errors, no unexpected tabs, the shipped manifest untouched
const https = require('https');
const fs = require('fs');
const { findLeaks } = require('../leaks.js');
const { sha256 } = require('../harness.js');

const probe = (port, method, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = https.request({ host: 'localhost', port, path, method, rejectUnauthorized: false, headers: { 'x-e2e-probe': '1', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });

// Matches every API read the instance recorded against the browser-side log, address by address.
//   missing: reads the instance saw that the browser log did not (the claim "the log covers the content scripts" fails on any)
//   extra:   browser-log requests the instance never recorded (a read the page cancelled before it arrived, e.g. a poll cut off
//            when a panel closed; harmless, the instance saw nothing, but worth showing)
function matchBrowserLog(ctx, inst, api) {
  const seen = new Map();
  for (const n of ctx.net) if (n.url.startsWith(`${inst.origin}/api/now/`)) seen.set(n.url, (seen.get(n.url) || 0) + 1);
  const missing = [];
  for (const r of api) {
    const url = `${inst.origin}${r.path}${r.search}`;
    if (seen.get(url) > 0) seen.set(url, seen.get(url) - 1);
    else missing.push(`${r.path}${r.search}`.slice(0, 140));
  }
  const extra = [];
  for (const [url, count] of seen) for (let i = 0; i < count; i += 1) extra.push(url.slice(inst.origin.length).slice(0, 140));
  return { missing, extra };
}

module.exports = {
  id: 'e',
  title: 'Read-only and network proof over the whole run',
  async run(t, ctx) {
    const { inst, ai, data } = ctx;

    // The leak detector must really detect, or the sweeps below would pass for the wrong reason.
    const canary = findLeaks(`label table Abel Tuter wrote: card ${data.SEED.card}, password: ${data.SEED.password}, mail ${data.SEED.callerEmail}, tel +1 555-0134`, data);
    t.check('self-test: the leak detector finds a name, card, password, email and phone, and does not trip on words like "label"', canary.critical.length >= 5 && !findLeaks('label table cable stable', data).critical.length, canary.critical.join(' | '));

    // The fake instance must itself refuse writes, or "no write was recorded" would prove nothing.
    const statuses = [];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) statuses.push(await probe(inst.port, method, '/api/now/table/incident'));
    t.check('self-test: the fake instance answers 405 to POST, PUT, PATCH and DELETE', statuses.every((s) => s === 405), statuses.join(','));
    t.check('self-test: the fake instance answers 401 to a read without the session token', (await probe(inst.port, 'GET', '/api/now/table/incident?sysparm_limit=1')) === 401);
    t.check('self-test: the fake instance answers 200 to a read with the token', (await probe(inst.port, 'GET', '/api/now/table/incident?sysparm_limit=1', { 'x-usertoken': inst.gck })) === 200);

    // ---- The instance -------------------------------------------------------------------------------------------------
    const reqs = inst.browserRequests();
    const api = reqs.filter((r) => r.kind === 'api');
    const tables = {};
    for (const r of api) tables[r.path.split('/').pop()] = (tables[r.path.split('/').pop()] || 0) + 1;
    t.check('the instance recorded requests from the browser', reqs.length > 20 && api.length > 10, `${reqs.length} requests, ${api.length} API reads`);
    t.check('EVERY request the instance saw was a GET', reqs.every((r) => r.method === 'GET'), [...new Set(reqs.map((r) => r.method))].join(','));
    t.check('no request was refused as a write (no 405 in the log)', reqs.every((r) => r.status !== 405));
    t.check('the only API paths used are /api/now/table/<t> and /api/now/stats/<t>', api.every((r) => /^\/api\/now\/(table|stats)\/[a-z0-9_]+$/.test(r.path)), [...new Set(api.map((r) => r.path.replace(/[^/]+$/, '*')))].join(' '));
    t.check('every API read carried the session token (never an unauthenticated call)', api.every((r) => r.tokenOk));
    t.check('every API read was a same-origin fetch from the page itself (content script)', api.every((r) => r.site === 'same-origin'), [...new Set(api.map((r) => r.site))].join(','));
    t.check('no script, ajax or processor endpoint was touched', reqs.every((r) => !/sys\.scripts|xmlhttp|processor|sys_script|angular/.test(r.path)));
    t.info(`tables read (${api.length} reads): ${Object.entries(tables).map(([k, v]) => `${k}x${v}`).join(' ')}`);

    // ---- The AI server ------------------------------------------------------------------------------------------------
    t.check('the AI server saw requests (the scenarios used it)', ai.all.length >= 4, String(ai.all.length));
    t.check('the AI server saw only POST /v1/chat/completions', ai.all.every((r) => r.method === 'POST' && r.path === '/v1/chat/completions') && ai.other.length === 0, JSON.stringify(ai.other));
    // "Load models" asks the same server for its list: a GET with only the key, from the extension's own page, no body, nothing from a ticket.
    t.check('every "list the models" request was a body-less GET /v1/models with the key, and never from the web page (no instance Origin on it)',ai.listings.every((r) => r.method === 'GET' && r.path === '/v1/models' && r.bodyLength === 0 && r.auth === `Bearer ${ai.key}` && (r.origin === '' || r.origin === `chrome-extension://${ctx.extId}`)), JSON.stringify(ai.listings.map((r) => [r.method, r.path, r.bodyLength, r.origin])));
    t.check('every AI request came from the extension\'s own page, not from the web page or a content script', ai.all.every((r) => r.origin === `chrome-extension://${ctx.extId}`), [...new Set(ai.all.map((r) => r.origin))].join(','));
    t.check('no AI request contained a tool or function definition', ai.all.every((r) => !r.body?.tools && !r.body?.functions));
    const sweep = ai.all.map((r) => findLeaks(r.raw, data));
    t.check(`FINAL SWEEP of all ${ai.all.length} AI request bodies of the run: no raw caller name, email, phone, card, password or agent name`, sweep.every((s) => s.critical.length === 0), [...new Set(sweep.flatMap((s) => s.critical))].join(' | '));
    for (const g of new Map(sweep.flatMap((s) => s.gaps).map((g) => [g.value, g])).values()) t.warning(`AI server received "${g.value}" unmasked`, g.why);
    t.check('no AI request body contained a sys_id, the session token or the instance address', ai.all.every((r) => !/\b[0-9a-f]{32}\b/.test(r.raw) && !r.raw.includes(inst.gck) && !r.raw.includes(inst.origin)));

    // ---- Everything the browser did -------------------------------------------------------------------------------------
    const allowed = [inst.origin, `http://localhost:${ai.port}`, `https://127.0.0.1:${inst.port}`]; // the last: the harness' own "not enabled" page
    const internal = /^(chrome-extension|data|blob|about|chrome):/i;
    const outside = ctx.net.filter((n) => !internal.test(n.url) && !allowed.some((o) => n.url === o || n.url.startsWith(`${o}/`)));
    t.check(`network log of every page, content script and the service worker (${ctx.net.length} requests): nothing outside the fake instance and the fake AI`, outside.length === 0, outside.map((n) => `${n.method} ${n.url}`).slice(0, 5).join(' | '));
    // The log must really cover the content scripts and the panel, or "nothing outside" would be an empty promise.
    const netApi = ctx.net.filter((n) => n.url.startsWith(`${inst.origin}/api/now/`)).length;
    const netAi = ctx.net.filter((n) => n.url.startsWith(`http://localhost:${ai.port}/`) && n.method === 'POST').length;
    const matched = matchBrowserLog(ctx, inst, api);
    // A read the instance logged but never answered is the mark of a read Chrome sent again on a new connection without telling anyone
    // (the fake instance keeps its connections open to prevent that: e2e/fakeInstance.js keepAliveTimeout). Said with the result below.
    const unanswered = api.filter((r) => !r.status).length;
    // No read may be missing: not one from a NEW tab (a record link the panel opens), nor one a page makes as it is closed or navigates
    // away. The harness logs every page through its own DevTools session: Network on from the page's start, and every request of a
    // page held in the browser until the harness has seen it (e2e/harness.js, the network log). TRACKER R7 removed the earlier
    // allowance of up to 5 missing reads.
    t.check(
      'coverage: the browser-side log saw every API read the instance saw (so it covers the content scripts, new tabs and closing tabs included)',
      matched.missing.length === 0 && netApi >= api.length,
      `browser log ${netApi}, instance log ${api.length}, logged but never answered ${unanswered}${matched.missing.length ? `; ${matched.missing.length} not seen by the browser log: ${matched.missing.slice(0, 3).join(' | ')}` : ''}`,
    );
    // Every page the browser reported was in that log (one that was not would be a blind spot for "nothing outside" above).
    const unwatched = ctx.targets.filter((x) => x.type === 'page' && !ctx.watchedPages.has(x.id));
    t.check('coverage: the network log watched every page the browser opened', unwatched.length === 0, unwatched.map((x) => x.url || '(no address)').slice(0, 3).join(' | '));
    const paused = [...ctx.watchedPages.values()].filter(Boolean).length;
    t.info(`network log: ${ctx.watchedPages.size} pages watched, ${paused} of them paused by Chrome at their start until the log was on (the others were already open, or tabs the browser made itself, joined as they were created); ${ctx.notelessRequests()} request(s) known only from the browser side, their page's own note lost as it closed or navigated; ${ctx.idsUsedAgain()} request id(s) Chrome used again for a new request (logged as new)`);
    // A request the browser sent that never reached the instance (cancelled in flight). Not a failure, but the log should say so.
    if (matched.extra.length) t.info(`${matched.extra.length} request(s) the browser sent never reached the instance (cancelled in flight): ${matched.extra.slice(0, 3).join(' | ')}`);
    t.check('coverage: the browser-side log saw every request the AI server saw (so it covers the panel)', netAi === ai.all.length, `browser log ${netAi}, AI log ${ai.all.length}`);
    t.check('nothing contacted evil.example (the injected image and link)', !ctx.net.some((n) => /evil\.example/.test(n.url)));
    t.check('the service worker itself made no network request at all', !ctx.net.some((n) => n.from === 'service-worker'), ctx.net.filter((n) => n.from === 'service-worker').map((n) => n.url).join(' '));
    const pageTargets = ctx.targets.filter((x) => x.type === 'page').map((x) => x.url);
    const odd = pageTargets.filter((u) => u && u !== 'about:blank' && !u.startsWith(`chrome-extension://${ctx.extId}/`) && !u.startsWith(inst.origin) && !u.startsWith(`https://127.0.0.1:${inst.port}/`));
    t.check('the extension opened no tab or window of its own beyond the settings and panel pages we opened', odd.length === 0, odd.join(' | '));

    // ---- The AI key stays with the AI --------------------------------------------------------------------------------------
    const keyed = reqs.filter((r) => 'authorization' in r.headers || `${r.path}${r.search}${JSON.stringify(r.headers)}`.includes(ai.key));
    t.check('the AI key was never sent to the instance (no Authorization header, not in any URL or header)', keyed.length === 0, keyed.map((r) => r.path).join(' '));

    // ---- Nothing about a record is left behind or logged -------------------------------------------------------------------
    const everythingStored = await ctx.ext(async () => JSON.stringify({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null), sync: await chrome.storage.sync.get(null) }));
    // Round 4: the one named exception to build rule 7, the last-viewed list (sys_id, table and time of each ticket opened), is checked
    // on its own below; everything else must hold no ticket data at all, not even a record id.
    const allStored = JSON.parse(everythingStored);
    const { agentbuddy_last_viewed: lastViewed, ...localRest } = allStored.local;
    const withoutLastViewed = JSON.stringify({ ...allStored, local: localRest });
    const stored = findLeaks(withoutLastViewed, data);
    t.check('chrome.storage (local, session, sync) holds no ticket data: no names, emails, phones, cards, passwords or ticket text', stored.critical.length === 0 && stored.gaps.length === 0 && !/disconnecting|Printer offline|Issue:|recurring VPN|Ignore all previous/.test(withoutLastViewed) && !withoutLastViewed.includes(data.INCIDENT_ID), [...stored.critical, ...stored.gaps.map((g) => g.value)].join(' | '));
    const lastViewedShape = (lv) => !lv || (lv.v === 1 && Object.keys(lv).sort().join() === 'instances,v' && Object.entries(lv.instances || {}).every(([origin, map]) => /^https?:\/\/[^/\s]+$/.test(origin) && Object.entries(map || {}).every(([id, e]) => /^[0-9a-f]{32}$/.test(id) && Object.keys(e || {}).sort().join() === 'at,table' && /^[a-z0-9_]+$/.test(e.table) && !Number.isNaN(Date.parse(e.at)))));
    const lvLeaks = findLeaks(JSON.stringify(lastViewed || {}), data);
    t.check('the last-viewed list (build rule 7 exception) holds only sys_ids, table names and times: no number, title, text or names', lastViewedShape(lastViewed) && lvLeaks.critical.length === 0 && lvLeaks.gaps.length === 0, JSON.stringify(lastViewed || {}).slice(0, 240));
    t.info(`storage keys: ${Object.keys(JSON.parse(everythingStored).local).join(', ')}`);
    // The one IndexedDB database allowed is the key vault, and it may hold AI keys (plain or encrypted) and nothing else.
    const webStorage = await ctx.ext(async () => ({ local: localStorage.length, session: sessionStorage.length, idb: (await indexedDB.databases()).filter((d) => d.name !== 'agentbuddy_vault').length, caches: (await caches.keys()).length }));
    t.check('no localStorage, sessionStorage, Cache API data or IndexedDB database other than the key vault in the extension', Object.values(webStorage).every((n) => n === 0), JSON.stringify(webStorage));
    const vault = await ctx.vaultAll();
    const vaultText = JSON.stringify(vault);
    const vaultLeaks = findLeaks(vaultText, data);
    t.check('the key vault holds AI keys only: every entry is a key slot, and no ticket data', Object.keys(vault).every((k) => /^agentbuddy_key(enc)?_[a-z0-9_]+$/.test(k)) && vaultLeaks.critical.length === 0 && vaultLeaks.gaps.length === 0 && !vaultText.includes(data.INCIDENT_ID), Object.keys(vault).join(', '));
    t.check('no AI key is left in chrome.storage.local (content scripts can read that area)', !Object.keys(JSON.parse(everythingStored).local).some((k) => /^agentbuddy_key(enc)?_/.test(k)), Object.keys(JSON.parse(everythingStored).local).join(', '));
    const logged = findLeaks(ctx.consoleLog.map((l) => l.text).join('\n'), data);
    t.check(`no personal data in any console line of any page or the service worker (${ctx.consoleLog.length} lines)`, logged.critical.length === 0 && logged.gaps.length === 0, [...logged.critical, ...logged.gaps.map((g) => g.value)].join(' | '));

    // ---- Errors ---------------------------------------------------------------------------------------------------------
    // The 401/403 answers the failure scenarios caused on purpose show up in the console as "Failed to load resource".
    const unexpected = ctx.errors.filter((e) => !(e.kind === 'console' && /Failed to load resource: the server responded with a status of (401|403)/.test(e.text)));
    t.check('no unexpected page errors, console errors or CSP violations anywhere during the run', unexpected.length === 0, unexpected.slice(0, 4).map((e) => `${e.from}/${e.kind}: ${e.text.slice(0, 120)} (${String(e.url || '').slice(0, 80)})`).join(' | '));

    // ---- The shipped build -----------------------------------------------------------------------------------------------
    t.check('the real dist/manifest.json is still byte-for-byte what the build produced (not patched)', sha256(ctx.extension.realManifestPath) === ctx.extension.realManifestHash && !JSON.parse(fs.readFileSync(ctx.extension.realManifestPath, 'utf8')).host_permissions);
  },
};
