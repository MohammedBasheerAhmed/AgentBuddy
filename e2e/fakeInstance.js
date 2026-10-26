// A fake ServiceNow instance for the end-to-end test: HTTPS on https://localhost:<port> with a self-signed certificate.
//
//   GET /incident.do?sys_id=<id>              classic form; external script defines g_ck, g_user and a fake g_form
//   GET /nav_to.do?uri=incident.do?sys_id=..  the classic frame: top window + <iframe id="gsft_main"> that holds the form
//   GET /now/sow/record/<table>/<sys_id>      Workspace-style page: shadow-DOM components, NO g_form
//   GET /home                                 a page that is not a record (My Day)
//   GET /api/now/table/<table>                Table API, answered from the sn-* fixtures
//   GET /api/now/stats/<table>                Aggregate API (count, group by)
//
// API rules (they imitate what matters about the real thing):
//   - X-UserToken must equal the page's g_ck, else 401 (what an expired session looks like to the extension)
//   - tables listed in behaviour.denied answer 403; tables in behaviour.hidden answer 200 with no rows (an ACL filter)
//   - ANY method other than GET/HEAD answers 405, on every path
// Every request is recorded ({ method, path, kind }) so the test can prove the extension only ever read.
//
// The pages carry a strict Content-Security-Policy and load all scripts from files (no inline code), like a page that
// ships with CSP on: this proves the page bridge can still be injected and that nothing depends on inline script.
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE = path.join(__dirname, 'site');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'";

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rawOf = (c) => (c && typeof c === 'object' ? String(c.value ?? '') : String(c ?? ''));
const dispOf = (c) => (c && typeof c === 'object' ? String(c.display_value ?? c.value ?? '') : String(c ?? ''));

// What the classic form fills its inputs with. work_notes holds text the agent has already typed but not saved.
const CLASSIC_FIELDS = [
  { name: 'number', label: 'Number', readonly: true },
  { name: 'short_description', label: 'Short description' },
  { name: 'description', label: 'Description', area: true },
  { name: 'state', label: 'State', readonly: true },
  { name: 'caller_id', label: 'Caller', readonly: true },
  { name: 'work_notes', label: 'Work notes', area: true },
  { name: 'comments', label: 'Additional comments (Customer visible)', area: true },
  { name: 'close_notes', label: 'Resolution notes', area: true },
];
const TYPED_WORK_NOTES = 'Checking the gateway certificate now.';

/**
 * @param {{ key: string, cert: string }} tls
 * @param {{ tables: object, makeApi: Function, user: object }} options
 *   makeApi(tables, behaviour) -> the fake Table API (tests/fixtures/sn-fakeDeps.js)
 */
function startFakeInstance(tls, { tables, makeApi, user }) {
  const gck = crypto.randomBytes(24).toString('hex'); // the session token; also what g_ck holds
  const state = {
    tables,
    behaviour: { denied: [], hidden: [] },
  };
  /** Every request the browser made, in order. `kind` is 'api' for /api/now/*, else 'page'. */
  const requests = [];

  const record = (tableName, sysId) => {
    const row = (state.tables[tableName] || []).find((r) => rawOf(r.sys_id) === sysId);
    return row || null;
  };

  function classicHtml(tableName, sysId) {
    const row = record(tableName, sysId) || {};
    const values = {};
    for (const f of CLASSIC_FIELDS) values[f.name] = f.name === 'work_notes' ? TYPED_WORK_NOTES : f.name === 'comments' ? '' : dispOf(row[f.name]);
    const data = {
      table: tableName,
      sysId,
      values,
      editable: CLASSIC_FIELDS.filter((f) => !f.readonly).map((f) => f.name),
      types: { work_notes: 'journal_input', comments: 'journal_input', description: 'string' },
    };
    const inputs = CLASSIC_FIELDS.map((f) => {
      const id = `${tableName}.${f.name}`;
      const control = f.area
        ? `<textarea id="${id}" name="${id}"${f.readonly ? ' readonly' : ''}></textarea>`
        : `<input id="${id}" name="${id}" type="text"${f.readonly ? ' readonly' : ''}>`;
      return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label>${control}</div>`;
    }).join('\n');
    return page(`${dispOf(row.number) || tableName} | ServiceNow (fake)`, `
<div class="banner">Fake ServiceNow - classic form</div>
<h1>${escapeHtml(tableName)} ${escapeHtml(dispOf(row.number))}</h1>
<form id="${tableName}.form" action="#">${inputs}</form>
<script type="application/json" id="e2e-record">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script src="/scripts/session.js"></script>
<script src="/scripts/classic-form.js"></script>`);
  }

  function page(title, body) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="/assets/sn.css"></head><body>${body}</body></html>`;
  }

  // The session script is generated, because g_ck is random per run.
  const sessionScript = () => `window.g_ck = ${JSON.stringify(gck)};
window.g_user = { userName: ${JSON.stringify(user.login)}, userID: ${JSON.stringify(user.sysId)}, firstName: ${JSON.stringify(user.firstName)}, lastName: ${JSON.stringify(user.lastName)}, roles: ${JSON.stringify(user.roles)}, hasRole: function (r) { return this.roles.indexOf(r) !== -1; } };
`;

  function sendJson(res, status, body, extra = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store', 'x-is-logged-in': 'true', ...extra });
    res.end(text);
  }

  async function handleApi(req, res, url, entry) {
    const m = /^\/api\/now\/(table|stats)\/([a-z][a-z0-9_]*)$/.exec(url.pathname);
    if (!m) return sendJson(res, 404, { error: { message: 'Requested URI does not represent any resource', detail: null }, status: 'failure' });
    if (req.headers['x-usertoken'] !== gck) {
      entry.note = 'no/wrong X-UserToken';
      return sendJson(res, 401, { error: { message: 'User Not Authenticated', detail: 'Required to provide Auth information' }, status: 'failure' }, { 'WWW-Authenticate': 'Basic realm="Service-Now"' });
    }
    const [, api, tableName] = m;
    const q = url.searchParams;
    const query = q.get('sysparm_query') || '';
    const fields = (q.get('sysparm_fields') || '').split(',').filter(Boolean);
    const limit = Math.max(0, Number(q.get('sysparm_limit') || 10000));
    const offset = Math.max(0, Number(q.get('sysparm_offset') || 0));
    const dv = q.get('sysparm_display_value') || 'false';
    const deps = makeApi(state.tables, state.behaviour);
    try {
      if (api === 'table') {
        const rows = await deps.queryTable(tableName, query, fields, { limit, offset, displayValue: dv === 'all' || dv === 'true' });
        // 'true' = display strings only, 'all' = { value, display_value }, 'false' = raw strings
        const out = dv === 'true' ? rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, c]) => [k, dispOf(c)]))) : rows;
        return sendJson(res, 200, { result: out });
      }
      const groupBy = q.get('sysparm_group_by');
      if (!groupBy) return sendJson(res, 200, { result: { stats: { count: String(await deps.countRecords(tableName, query)) } } });
      const rows = await deps.queryTable(tableName, query, [groupBy], { limit: 100000, displayValue: true });
      const groups = new Map();
      for (const r of rows) {
        const key = rawOf(r[groupBy]);
        const g = groups.get(key) || { stats: { count: '0' }, groupby_fields: [{ field: groupBy, value: key, display_value: dispOf(r[groupBy]) }] };
        g.stats.count = String(Number(g.stats.count) + 1);
        groups.set(key, g);
      }
      return sendJson(res, 200, { result: [...groups.values()] });
    } catch (err) {
      if (err.code === 'ACCESS_DENIED') {
        entry.note = `denied: ${tableName}`;
        return sendJson(res, 403, { error: { message: 'User Not Authorized', detail: 'Insufficient rights to query records' }, status: 'failure' });
      }
      return sendJson(res, 500, { error: { message: String(err.message || err), detail: null }, status: 'failure' });
    }
  }

  function handlePage(req, res, url) {
    const html = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=UTF-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    const p = url.pathname;

    if (p === '/scripts/session.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      return res.end(sessionScript());
    }
    const staticFile = /^\/(scripts|assets)\/([a-z0-9-]+\.(?:js|css))$/.exec(p);
    if (staticFile) {
      const file = path.join(SITE, staticFile[2]);
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': staticFile[2].endsWith('.css') ? 'text/css' : 'application/javascript', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(file));
      }
    }
    if (p === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    const classic = /^\/([a-z][a-z0-9_]*)\.do$/.exec(p);
    if (classic && classic[1] !== 'nav_to') return html(classicHtml(classic[1], url.searchParams.get('sys_id') || ''));

    if (p === '/nav_to.do') {
      // The classic UI frame: the top window has the session, the record form lives in <iframe id="gsft_main">.
      const uri = url.searchParams.get('uri') || 'home';
      const src = uri.startsWith('/') ? uri : `/${uri}`;
      return html(page('ServiceNow (fake) - classic frame', `<div class="banner">Fake ServiceNow - classic frame (nav_to.do)</div><iframe id="gsft_main" name="gsft_main" src="${escapeHtml(src)}" style="width:100%;height:560px;border:0"></iframe><script src="/scripts/session.js"></script>`));
    }

    const workspace = /^\/now\/[a-z-]+\/record\/([a-z][a-z0-9_]*)\/([0-9a-f]{32})/i.exec(p);
    if (workspace) {
      const row = record(workspace[1], workspace[2].toLowerCase()) || {};
      return html(page(`${dispOf(row.number) || workspace[1]} | Workspace (fake)`, `<div class="banner">Fake ServiceNow - workspace record (no g_form)</div><now-record-form heading="${escapeHtml(dispOf(row.number) || workspace[1])}"></now-record-form><script src="/scripts/session.js"></script><script src="/scripts/workspace.js"></script>`));
    }

    if (p === '/home' || p === '/') {
      return html(page('Home | ServiceNow (fake)', '<div class="banner">Fake ServiceNow - home</div><h1>Home</h1><p class="ws-note">Not a record page.</p><script src="/scripts/session.js"></script>'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }

  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    const entry = { method: req.method, path: url.pathname, search: url.search, kind: url.pathname.startsWith('/api/') ? 'api' : 'page', probe: Boolean(req.headers['x-e2e-probe']), status: 0 };
    requests.push(entry);
    res.on('finish', () => {
      entry.status = res.statusCode;
    });
    // Imitates an instance that would refuse (or at least not take) a write: the test then proves none was attempted.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Method Not Allowed (the fake instance is read-only)' }, status: 'failure' }));
    }
    if (entry.kind === 'api') return void handleApi(req, res, url, entry);
    return handlePage(req, res, url);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        port,
        origin: `https://localhost:${port}`,
        gck,
        user,
        requests,
        state,
        /** Change which tables answer 403 / 200-empty. Resets everything else to defaults when called with nothing. */
        setBehaviour: ({ denied = [], hidden = [] } = {}) => {
          state.behaviour = { denied, hidden };
        },
        /** Requests the browser made (the harness' own probes excluded). */
        browserRequests: () => requests.filter((r) => !r.probe),
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}

module.exports = { startFakeInstance, TYPED_WORK_NOTES };
