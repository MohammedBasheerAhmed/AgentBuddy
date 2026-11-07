// A fake ServiceNow instance for the end-to-end test: HTTPS on https://localhost:<port> with a self-signed certificate.
//
//   GET /incident.do?sys_id=<id>              classic form; external script defines g_ck, g_user and a fake g_form
//   GET /nav_to.do?uri=incident.do?sys_id=..  the classic frame: top window + <iframe id="gsft_main"> that holds the form
//   GET /now/sow/record/<table>/<sys_id>      Workspace-style page: shadow-DOM components, NO g_form. Also under /now/cwf/agent/ and
//                                             /now/workspace/agent/ (the routes of the CSM and the agent Workspaces). ?variant=... gives
//                                             the page a composer with a Work notes / customer comments switch, a Save and a Post
//                                             button, a big DOM, an Arabic page, a Notes tab that opens the composer (e2e/site/workspace.js)
//   GET /now/nav/ui/classic/params/target/<form>.do%3F..   the Next Experience shell around a classic form: the form is in an
//                                             <iframe name="gsft_main"> INSIDE a shadow root (e2e/site/shell.js)
//   GET /sp /esc /csm                         portals: an Angular-style single-page app (NO g_form), moving between tickets and a
//                                             list with history.pushState (e2e/site/portal.js). How each one tells who is signed in:
//                                             /sp the NOW object, /esc an Angular root scope, /csm nothing at all (the extension
//                                             then asks the instance who "Me" is: one GET of the person's own sys_user row)
//   GET /<table>_list.do?sysparm_query=...    a classic list: the table and the filter are printed on the page (what a report's drill-down opens)
//   GET /<table>.do?sys_id=-1                 a BLANK classic form (g_form.isNewRecord() is true, empty fields, selects with choice values)
//   GET /email_client.do?...                  the classic email form: a blank sys_email form with recipients, subject and body fields
//   GET /dashboard-source (none)              (the full-page dashboard is an extension page, opened by the extension itself)
//   GET /home                                 a page that is not a record (My Day)
//   GET /api/now/table/<table>                Table API, answered from the sn-* fixtures
//   GET /api/now/stats/<table>                Aggregate API: count, group by one or two columns (also dot-walked ones), average fields
//   GET /api/now/ui/meta/<table>              UI meta service: label and choices of state and priority (the real instance's values)
//
// API rules (they imitate what matters about the real thing):
//   - X-UserToken must equal the page's g_ck, else 401 with the Basic challenge a real instance sends (a browser would pop
//     up a login box for it, which is why the extension never sends a read without the token)
//   - tables listed in behaviour.denied answer 403; tables in behaviour.hidden answer 200 with no rows (an ACL filter)
//   - behaviour.expired: every API call answers 401 with X-Is-Logged-In: false (a timed-out session)
//   - behaviour.deniedWhen: Table API reads whose sysparm_query contains one of these texts answer 403 (e.g. 'caller_id=' denies the caller's
//     earlier tickets without denying the record itself); behaviour.withheld: { table: [columns] } leaves those columns out of every row
//     (a field the person may not read comes back as a missing key, not as an empty value; audit of 2026-11-07, R-14)
//   - ANY method other than GET/HEAD answers 405, on every path
// Every request is recorded ({ method, path, kind, status, tokenOk, headers }) so the test can prove the extension only ever read.
//
// What the pages hold is seeded in e2e/data.entry.js: the shared sn-* fixtures plus the personal data the test hunts for.
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
// `select` fields hold choice VALUES ("2"), like a real choice list; `raw` fields show the stored value instead of the display text.
const LEVELS = [['1', '1 - High'], ['2', '2 - Medium'], ['3', '3 - Low']];
const CLASSIC_FIELDS = [
  { name: 'number', label: 'Number', readonly: true },
  { name: 'short_description', label: 'Short description' },
  { name: 'description', label: 'Description', area: true },
  { name: 'state', label: 'State', readonly: true },
  { name: 'caller_id', label: 'Caller', readonly: true },
  { name: 'impact', label: 'Impact', select: LEVELS },
  { name: 'urgency', label: 'Urgency', select: LEVELS },
  { name: 'contact_type', label: 'Contact type', select: [['phone', 'Phone'], ['self-service', 'Self-service'], ['email', 'Email'], ['walk-in', 'Walk-in']] },
  { name: 'hold_reason', label: 'Hold reason', readonly: true },
  { name: 'close_code', label: 'Close code' },
  { name: 'work_notes', label: 'Work notes', area: true },
  { name: 'comments', label: 'Additional comments (Customer visible)', area: true },
  { name: 'close_notes', label: 'Resolution notes', area: true },
];
// Other forms. A knowledge article has a body; the email client composes a sys_email record (the Write tab's Insert needs "body").
const TABLE_FIELDS = {
  // A problem form has the three text fields the RCA draft fills.
  problem: [
    { name: 'number', label: 'Number', readonly: true },
    { name: 'short_description', label: 'Short description' },
    { name: 'description', label: 'Description', area: true },
    { name: 'state', label: 'State', readonly: true },
    { name: 'cause_notes', label: 'Cause notes', area: true },
    { name: 'workaround', label: 'Workaround', area: true },
    { name: 'fix_notes', label: 'Fix notes', area: true },
    { name: 'work_notes', label: 'Work notes', area: true },
    { name: 'comments', label: 'Additional comments (Customer visible)', area: true },
    { name: 'close_notes', label: 'Resolution notes', area: true },
  ],
  kb_knowledge: [
    { name: 'number', label: 'Number', readonly: true },
    { name: 'short_description', label: 'Short description' },
    { name: 'text', label: 'Article body', area: true },
    { name: 'kb_knowledge_base', label: 'Knowledge base', readonly: true },
    { name: 'workflow_state', label: 'Workflow state', readonly: true },
  ],
  sys_email: [
    { name: 'recipients', label: 'To' },
    { name: 'subject', label: 'Subject' },
    { name: 'body', label: 'Body', area: true },
  ],
};
const TYPED_WORK_NOTES = 'Checking the gateway certificate now.';

// How each fake portal lets a page script find out who is signed in (the extension must cope with all three).
const PORTAL_FLAVOUR = { sp: 'now', esc: 'scope', csm: 'none' };
// The dynamic filter "Me" that ships with every instance. A query on it is answered with the signed-in person's own row.
const ME_QUERY = /^sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe$/;

/**
 * @param {{ key: string, cert: string }} tls
 * @param {{ tables: object, makeApi: Function, user: object, portal?: object }} options
 *   makeApi(tables, behaviour) -> the fake Table API (tests/fixtures/sn-fakeDeps.js)
 *   portal: the tickets the fake portals show (data.PORTAL in e2e/data.entry.js)
 */
function startFakeInstance(tls, { tables, makeApi, user, portal }) {
  const gck = crypto.randomBytes(24).toString('hex'); // the session token; also what g_ck holds
  const state = {
    tables,
    behaviour: { denied: [], hidden: [], expired: false, deniedWhen: [], withheld: {} },
  };
  /** Every request the browser made, in order. `kind` is 'api' for /api/now/*, else 'page'. */
  const requests = [];

  const record = (tableName, sysId) => {
    const row = (state.tables[tableName] || []).find((r) => rawOf(r.sys_id) === sysId);
    return row || null;
  };

  // A classic form. sys_id=-1 is a BLANK form of that table (g_form.isNewRecord() is true, every field empty). `formTable` is what
  // g_form.getTableName() answers (the email client composes a sys_email record).
  function classicHtml(tableName, sysId, { formTable = tableName, fields } = {}) {
    const isNew = sysId === '-1' || !sysId;
    const row = (!isNew && record(tableName, sysId)) || {};
    const layout = fields || TABLE_FIELDS[tableName] || CLASSIC_FIELDS;
    const values = {};
    for (const f of layout) {
      if (isNew) values[f.name] = '';
      else if (f.name === 'work_notes') values[f.name] = TYPED_WORK_NOTES;
      else if (f.name === 'comments') values[f.name] = '';
      else values[f.name] = f.select ? rawOf(row[f.name]) : dispOf(row[f.name]);
    }
    const data = {
      table: formTable,
      sysId: isNew ? crypto.randomBytes(16).toString('hex') : sysId,
      isNew,
      values,
      editable: layout.filter((f) => !f.readonly).map((f) => f.name),
      // (A knowledge article body is an HTML field on a real instance: the page bridge then fills it with escaped HTML.)
      types: { work_notes: 'journal_input', comments: 'journal_input', description: 'string', ...(tableName === 'kb_knowledge' ? { text: 'html' } : {}) },
    };
    const inputs = layout.map((f) => {
      const id = `${formTable}.${f.name}`;
      const ro = f.readonly ? ' readonly' : '';
      let control;
      if (f.area) control = `<textarea id="${id}" name="${id}"${ro}></textarea>`;
      else if (f.select) control = `<select id="${id}" name="${id}"><option value="">-- None --</option>${f.select.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}</select>`;
      else control = `<input id="${id}" name="${id}" type="text"${ro}>`;
      return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label>${control}</div>`;
    }).join('\n');
    const heading = isNew ? 'New record' : dispOf(row.number);
    return page(`${heading || formTable} | ServiceNow (fake)`, `
<div class="banner">Fake ServiceNow - classic form${isNew ? ' (new record)' : ''}</div>
<h1>${escapeHtml(formTable)} ${escapeHtml(heading)}</h1>
<form id="${formTable}.form" action="#">${inputs}</form>
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

  // Portals have no g_form. g_ck is always there; the user is exposed the way the flavour says (and not as g_user).
  const portalSessionScript = (flavour) => {
    const lines = [`window.g_ck = ${JSON.stringify(gck)};`];
    const display = `${user.firstName} ${user.lastName}`;
    if (flavour === 'now') lines.push(`window.NOW = { user_id: ${JSON.stringify(user.sysId)}, user_name: ${JSON.stringify(user.login)}, user_display_name: ${JSON.stringify(display)}, sys_id: 'ffffffffffffffffffffffffffffffff' };`);
    if (flavour === 'scope') {
      lines.push(`var rootScope = { user: { sys_id: ${JSON.stringify(user.sysId)}, user_name: ${JSON.stringify(user.login)}, name: ${JSON.stringify(display)} } };`);
      lines.push("window.angular = { element: function () { return { injector: function () { return { has: function (n) { return n === '$rootScope'; }, get: function () { return rootScope; } }; } }; } };");
    }
    return `${lines.join('\n')}\n`;
  };

  function portalHtml(suffix) {
    const data = { suffix, tickets: portal?.tickets || [] };
    return page(`Portal ${suffix} | ServiceNow (fake)`, `
<div class="banner">Fake ServiceNow - portal /${suffix} (single-page app, no g_form)</div>
<div id="portal-app" ng-app="fakePortal" data-suffix="${suffix}"></div>
<script type="application/json" id="e2e-portal-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script src="/scripts/portal-session.js?flavour=${PORTAL_FLAVOUR[suffix]}"></script>
<script src="/scripts/portal.js"></script>`);
  }

  function sendJson(res, status, body, extra = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store', 'x-is-logged-in': 'true', ...extra });
    res.end(text);
  }

  // The choices a real instance answers for state and priority (measured on dev364920, docs/live-checks-2026-11-07.md). The task family
  // (task, sc_task, sc_req_item, incident_task) shares one list; change_task and problem_task have their own.
  const PRIORITY = [['1', '1 - Critical'], ['2', '2 - High'], ['3', '3 - Moderate'], ['4', '4 - Low'], ['5', '5 - Planning']];
  const TASK_STATES = [['-5', 'Pending'], ['1', 'Open'], ['2', 'Work in Progress'], ['3', 'Closed Complete'], ['4', 'Closed Incomplete'], ['7', 'Closed Skipped']];
  const STATES = {
    incident: [['1', 'New'], ['2', 'In Progress'], ['3', 'On Hold'], ['6', 'Resolved'], ['7', 'Closed'], ['8', 'Canceled']],
    problem: [['101', 'New'], ['102', 'Assess'], ['103', 'Root Cause Analysis'], ['104', 'Fix in Progress'], ['106', 'Resolved'], ['107', 'Closed']],
    change_request: [['-5', 'New'], ['-4', 'Assess'], ['-3', 'Authorize'], ['-2', 'Scheduled'], ['-1', 'Implement'], ['0', 'Review'], ['3', 'Closed'], ['4', 'Canceled']],
    change_task: [['-5', 'Pending'], ['1', 'Open'], ['2', 'In Progress'], ['3', 'Closed'], ['4', 'Canceled']],
    problem_task: [['151', 'New'], ['152', 'Assess'], ['154', 'Work in Progress'], ['157', 'Closed']],
  };
  const choicesOf = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  function metaColumns(table) {
    return {
      state: { label: 'State', choices: choicesOf(STATES[table] || TASK_STATES) },
      priority: { label: 'Priority', choices: choicesOf(PRIORITY) },
      short_description: { label: 'Short description', choices: [] },
    };
  }

  async function handleApi(req, res, url, entry) {
    const m = /^\/api\/now\/(table|stats)\/([a-z][a-z0-9_]*)$/.exec(url.pathname);
    const meta = /^\/api\/now\/ui\/meta\/([a-z][a-z0-9_]*)$/.exec(url.pathname);
    if (!m && !meta) return sendJson(res, 404, { error: { message: 'Requested URI does not represent any resource', detail: null }, status: 'failure' });
    entry.tokenOk = req.headers['x-usertoken'] === gck;
    if (state.behaviour.expired || !entry.tokenOk) {
      entry.note = state.behaviour.expired ? 'session expired (simulated)' : 'no/wrong X-UserToken';
      // A timed-out session is signalled with X-Is-Logged-In: false. A request without the right token gets the Basic challenge
      // a real instance sends, which makes a browser pop up a login box; the extension never sends one without a token.
      const headers = state.behaviour.expired ? { 'x-is-logged-in': 'false' } : { 'WWW-Authenticate': 'Basic realm="Service-Now"' };
      return sendJson(res, 401, { error: { message: 'User Not Authenticated', detail: 'Required to provide Auth information' }, status: 'failure' }, headers);
    }
    // The UI meta service: the words of a table's columns and their choices (what a plain agent can read where the choice table is closed).
    if (meta) {
      entry.note = `ui meta: ${meta[1]}`;
      return sendJson(res, 200, { result: { columns: metaColumns(meta[1]) } });
    }
    const [, api, tableName] = m;
    const q = url.searchParams;
    const query = q.get('sysparm_query') || '';
    const fields = (q.get('sysparm_fields') || '').split(',').filter(Boolean);
    // "Who am I" without any page global: the dynamic filter Me answers with the signed-in person's own sys_user row.
    if (api === 'table' && tableName === 'sys_user' && ME_QUERY.test(query)) {
      entry.note = 'dynamic filter Me';
      const row = (state.tables.sys_user || []).find((r) => rawOf(r.sys_id) === user.sysId);
      const out = row ? [Object.fromEntries((fields.length ? fields : Object.keys(row)).map((f) => [f, rawOf(row[f])]))] : [];
      return sendJson(res, 200, { result: out });
    }
    const limit = Math.max(0, Number(q.get('sysparm_limit') || 10000));
    const offset = Math.max(0, Number(q.get('sysparm_offset') || 0));
    const dv = q.get('sysparm_display_value') || 'false';
    const deps = makeApi(state.tables, { denied: state.behaviour.denied, hidden: state.behaviour.hidden });
    if (api === 'table' && state.behaviour.deniedWhen.some((text) => query.includes(text))) {
      entry.note = `denied: ${tableName} (query)`;
      return sendJson(res, 403, { error: { message: 'User Not Authorized', detail: 'Insufficient rights to query records' }, status: 'failure' });
    }
    try {
      if (api === 'table') {
        const withheld = state.behaviour.withheld[tableName] || [];
        const rows = (await deps.queryTable(tableName, query, fields, { limit, offset, displayValue: dv === 'all' || dv === 'true' })).map((r) => (withheld.length ? Object.fromEntries(Object.entries(r).filter(([key]) => !withheld.includes(key))) : r));
        // 'true' = display strings only, 'all' = { value, display_value }, 'false' = raw strings
        const out = dv === 'true' ? rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, c]) => [k, dispOf(c)]))) : rows;
        return sendJson(res, 200, { result: out });
      }
      // The Aggregate API: a count, optionally per value of one or two columns (dot-walked ones too), with the average of numeric columns.
      const groupBy = (q.get('sysparm_group_by') || '').split(',').filter(Boolean);
      const avgFields = (q.get('sysparm_avg_fields') || '').split(',').filter(Boolean);
      const avgOf = (rows) =>
        Object.fromEntries(
          avgFields.map((f) => {
            const nums = rows.map((r) => rawOf(r[f])).filter((t) => t !== '').map(Number).filter((n) => Number.isFinite(n));
            return [f, nums.length ? String(Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100) : ''];
          })
        );
      const stats = (rows) => ({ count: String(rows.length), ...(avgFields.length ? { avg: avgOf(rows) } : {}) });
      if (!groupBy.length && !avgFields.length) return sendJson(res, 200, { result: { stats: { count: String(await deps.countRecords(tableName, query)) } } });
      const rows = await deps.queryTable(tableName, query, [...groupBy, ...avgFields], { limit: 100000, displayValue: true });
      if (!groupBy.length) return sendJson(res, 200, { result: { stats: stats(rows) } });
      const groups = new Map();
      for (const r of rows) {
        const key = groupBy.map((f) => rawOf(r[f])).join('');
        const g = groups.get(key) || { rows: [], keys: groupBy.map((f) => ({ field: f, value: rawOf(r[f]), display_value: dispOf(r[f]) })) };
        g.rows.push(r);
        groups.set(key, g);
      }
      return sendJson(res, 200, { result: [...groups.values()].map((g) => ({ stats: stats(g.rows), groupby_fields: g.keys })) });
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
    if (p === '/scripts/portal-session.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      return res.end(portalSessionScript(url.searchParams.get('flavour') || 'none'));
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

    // A classic LIST (what a report opens when a number is clicked): the table and the filter are written on the page, so a test can read them.
    const listPage = /^\/([a-z][a-z0-9_]*)_list\.do$/.exec(p);
    if (listPage) return html(page(`${listPage[1]} list | ServiceNow (fake)`, `<div class="banner">Fake ServiceNow - list</div><h1 id="list-table">${escapeHtml(listPage[1])}</h1><p id="list-query">${escapeHtml(url.searchParams.get('sysparm_query') || '')}</p><script src="/scripts/session.js"></script>`));

    // The classic email form of a record: a blank sys_email form (the Write tab fills its body).
    if (p === '/email_client.do') return html(classicHtml('email_client', '-1', { formTable: 'sys_email', fields: TABLE_FIELDS.sys_email }));

    const classic = /^\/([a-z][a-z0-9_]*)\.do$/.exec(p);
    if (classic && classic[1] !== 'nav_to') return html(classicHtml(classic[1], url.searchParams.get('sys_id') || ''));

    if (p === '/nav_to.do') {
      // The classic UI frame: the top window has the session, the record form lives in <iframe id="gsft_main">.
      const uri = url.searchParams.get('uri') || 'home';
      const src = uri.startsWith('/') ? uri : `/${uri}`;
      return html(page('ServiceNow (fake) - classic frame', `<div class="banner">Fake ServiceNow - classic frame (nav_to.do)</div><iframe id="gsft_main" name="gsft_main" src="${escapeHtml(src)}" style="width:100%;height:560px;border:0"></iframe><script src="/scripts/session.js"></script>`));
    }

    // The Next Experience shell around a classic form: the target is encoded in the path, the form sits in a frame inside a shadow root.
    const shell = /^\/now\/nav\/ui\/classic\/params\/target\/([^/]+)$/.exec(p);
    if (shell) {
      let target;
      try {
        target = decodeURIComponent(shell[1]);
      } catch {
        target = '';
      }
      if (!/^[a-z][a-z0-9_]*\.do(\?[A-Za-z0-9_=&.%-]*)?$/.test(target)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found');
      }
      return html(page('ServiceNow (fake) - Next Experience shell', `<div class="banner">Fake ServiceNow - Next Experience shell (the form is in a frame inside a shadow root)</div><now-classic-frame src="/${escapeHtml(target)}"></now-classic-frame><script src="/scripts/session.js"></script><script src="/scripts/shell.js"></script>`));
    }

    const workspace = /^\/now\/(?:[a-z-]+\/)+record\/([a-z][a-z0-9_]*)\/([0-9a-f]{32})/i.exec(p);
    if (workspace) {
      const row = record(workspace[1], workspace[2].toLowerCase()) || {};
      const variant = /^[a-z-]{1,20}$/.test(url.searchParams.get('variant') || '') ? url.searchParams.get('variant') : '';
      return html(page(`${dispOf(row.number) || workspace[1]} | Workspace (fake)`, `<div class="banner">Fake ServiceNow - workspace record (no g_form)</div><now-record-form heading="${escapeHtml(dispOf(row.number) || workspace[1])}" close-notes="${escapeHtml(dispOf(row.close_notes))}"${variant ? ` variant="${variant}"` : ''}></now-record-form><script src="/scripts/session.js"></script><script src="/scripts/workspace.js"></script>`));
    }

    const portalSuffix = /^\/(sp|esc|csm)$/.exec(p);
    if (portalSuffix) return html(portalHtml(portalSuffix[1]));

    if (p === '/home' || p === '/') {
      return html(page('Home | ServiceNow (fake)', '<div class="banner">Fake ServiceNow - home</div><h1>Home</h1><p class="ws-note">Not a record page.</p><script src="/scripts/session.js"></script>'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }

  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    const entry = { method: req.method, path: url.pathname, search: url.search, kind: url.pathname.startsWith('/api/') ? 'api' : 'page', probe: Boolean(req.headers['x-e2e-probe']), headers: req.headers, status: 0, site: req.headers['sec-fetch-site'] || '', mode: req.headers['sec-fetch-mode'] || '' };
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
  // The server never closes an idle connection itself during a run (Node's default is after 5 s). Otherwise a read Chrome sends on a
  // connection at the moment the server closes it reaches the server (and this log) but gets no answer, and Chrome sends it again on a
  // new connection, without the page or DevTools seeing a second request: the instance then logs one read more than the browser made,
  // and the coverage check of scenario e fails now and then. Chrome closes its own idle connections.
  server.keepAliveTimeout = 0;

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
        /** Change which tables answer 403 / 200-empty, or make every API call answer 401 (expired). No argument = back to normal. */
        setBehaviour: ({ denied = [], hidden = [], expired = false, deniedWhen = [], withheld = {} } = {}) => {
          state.behaviour = { denied, hidden, expired, deniedWhen, withheld };
        },
        /** Requests the browser made (the harness' own probes excluded). */
        browserRequests: () => requests.filter((r) => !r.probe),
        close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
      });
    });
  });
}

module.exports = { startFakeInstance, TYPED_WORK_NOTES };
