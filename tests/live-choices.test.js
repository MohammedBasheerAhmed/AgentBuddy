import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clearTableMeta, readTableMeta, reduceTableMeta } from '../src/content/tableApi.js';
import { readChoiceLabels } from '../src/context/choices.js';
import { STATUS, READ_REASON } from '../src/context/access.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { INCIDENT_META, withMeta } from './live-fixtures.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

// Wave 4, live checks of 2026-11-07 (docs/live-checks-2026-11-07.md): a plain agent cannot read the choice table (403 in every query
// shape), but GET /api/now/ui/meta/<table> answers for an agent and for a person with no role, with each column's label and choices in the
// person's own language. That is the ONE extra address the read layer asks for. No network here: fetch and the page are fakes.

const SESSION_USER = 'a'.repeat(32);

/** A page whose bridge answers the token and who is signed in; `fetch` answers from `replies` (a function of the path). */
function setup({ userId = SESSION_USER } = {}) {
  const listeners = [];
  const page = { token: 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBB', userId };
  globalThis.document = {
    querySelector: () => null,
    scripts: [],
    getElementById: () => null,
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    dispatchEvent: (event) => {
      const { id, action } = event.detail;
      const result = action === 'getSessionInfo' ? (page.userId ? { userId: page.userId, userName: 'beth.anglin' } : {}) : page.token;
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id, ok: true, result } }));
      return true;
    },
  };
  globalThis.window = { frames: {} };
  const sent = [];
  const state = { reply: () => response(200, INCIDENT_META) };
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return state.reply(String(url));
  };
  clearTableMeta();
  return { page, sent, state };
}

function response(status, body = '', { headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, redirected: false, url: 'https://dev364920.service-now.com/api/now/ui/meta/incident', headers: { get: (name) => lower[String(name).toLowerCase()] ?? null }, text: async () => text };
}
const snError = (message, detail = null) => ({ error: { message, detail }, status: 'failure' });

// ---- the address -----------------------------------------------------------------------------------------------------------------------

test('the labels are one GET to /api/now/ui/meta/<table>: no query string, the session\'s own headers, same origin', async () => {
  const { sent } = setup();
  const meta = await readTableMeta('incident', ['state', 'priority']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/now/ui/meta/incident', 'a relative address (the instance the page is on), nothing after the table');
  assert.equal(sent[0].init.method, 'GET');
  assert.equal(sent[0].init.credentials, 'same-origin');
  assert.equal(sent[0].init.headers['X-UserToken'], 'tokenBBBBBBBBBBBBBBBBBBBBBBBBBB');
  assert.equal(sent[0].init.headers.Accept, 'application/json');
  assert.equal(sent[0].init.body, undefined);
  assert.deepEqual(Object.keys(meta).sort(), ['priority', 'state']);
  assert.deepEqual(meta.state.choices.map((c) => [c.value, c.label]), [['1', 'New'], ['2', 'In Progress'], ['3', 'On Hold'], ['6', 'Resolved'], ['7', 'Closed'], ['8', 'Canceled']]);
  assert.equal(meta.state.label, 'State');
});

test('the table is checked as an identifier before it becomes part of the address; so are the columns', async () => {
  const { sent } = setup();
  for (const table of ['a/../b', '../table/incident', 'incident?x=1', 'Incident', '', null, undefined, 5, 'x'.repeat(81), 'incident/../../ui/user']) {
    await assert.rejects(() => readTableMeta(table, ['state']), (err) => err.code === 'INVALID_READ' && /valid table/.test(err.detail), String(table));
  }
  for (const columns of [[], null, 'state', ['State'], ['state;drop'], ['a.b'], [''], [5], Array.from({ length: 13 }, (_, i) => `c${i}`)]) {
    await assert.rejects(() => readTableMeta('incident', columns), (err) => err.code === 'INVALID_READ', JSON.stringify(columns));
  }
  assert.equal(sent.length, 0, 'nothing was sent for any of them');
});

// ---- what is kept of the answer ------------------------------------------------------------------------------------------------------

test('only the label and the choices of the wanted columns are kept; everything else the service says is dropped', () => {
  const answer = {
    result: {
      sys_id: 'secret-looking',
      columns: {
        state: { label: 'State', type: 'integer', mandatory: true, read_only: false, internal_type: 'integer', reference: '', choices: [{ value: 1, label: 'New', hint: 'x', dependent_value: '' }, { value: '2', label: 'In Progress' }, { value: '', label: '-- None --' }, { value: '9' }, { label: 'No value' }, null, 'junk'] },
        short_description: { label: 'Short description', choices: [] },
        caller_id: { label: 'Caller', reference: 'sys_user' },
      },
      // other things a table's description holds
      sys_class_name: 'incident',
      related: [{ table: 'task_sla' }],
    },
  };
  const out = reduceTableMeta(answer, ['state', 'priority']);
  assert.deepEqual(out, { state: { label: 'State', choices: [{ value: '1', label: 'New' }, { value: '2', label: 'In Progress' }] } });
  assert.ok(!JSON.stringify(out).match(/secret|mandatory|reference|hint|caller|related/));
});

test('a column that is not there, a prototype name and a malformed answer give nothing, and never throw', () => {
  for (const answer of [null, undefined, 'text', 5, [], {}, { result: null }, { result: 'x' }, { result: { columns: null } }, { result: { columns: { state: null } } }, { result: { columns: { state: 'New' } } }]) {
    assert.deepEqual(reduceTableMeta(answer, ['state']), {}, JSON.stringify(answer));
  }
  assert.deepEqual(reduceTableMeta({ result: { columns: {} } }, ['constructor', 'toString']), {});
  assert.deepEqual(reduceTableMeta({ result: { columns: { state: { label: 5, choices: 'many' } } } }, ['state']), { state: { label: '', choices: [] } });
});

test('a long list is cut, and a label is one clean line', () => {
  const choices = Array.from({ length: 500 }, (_, i) => ({ value: String(i + 1), label: `Choice ${i + 1}` }));
  assert.equal(reduceTableMeta({ result: { columns: { state: { label: 'State', choices } } } }, ['state']).state.choices.length, 200);
  const one = reduceTableMeta({ result: { columns: { state: { label: ' State\n\tof it ', choices: [{ value: '1', label: `New${' very'.repeat(60)}\nline` }] } } } }, ['state']).state;
  assert.equal(one.label, 'State of it');
  assert.ok(one.choices[0].label.length <= 80 && !/\n/.test(one.choices[0].label));
});

// ---- the memory ------------------------------------------------------------------------------------------------------------------------

test('the answer is kept in memory for the signed-in person and the table, not asked again, and not shared with another person', async () => {
  const { sent, page } = setup();
  await readTableMeta('incident', ['state', 'priority']);
  await readTableMeta('incident', ['priority', 'state']); // (the same columns in another order)
  assert.equal(sent.length, 1, 'kept');
  await readTableMeta('incident', ['state']);
  assert.equal(sent.length, 2, 'other columns, another read');
  await readTableMeta('problem', ['state']);
  assert.equal(sent.length, 3, 'another table, another read');
  // another person on the same page (the page says who is signed in; the answer was read for the first one)
  page.userId = 'b'.repeat(32);
  await readTableMeta('incident', ['state', 'priority']);
  assert.equal(sent.length, 4, 'another person, another read');
  page.userId = SESSION_USER;
  await readTableMeta('incident', ['state', 'priority']);
  assert.equal(sent.length, 4, 'the first person\'s answer is still theirs');
});

test('with nobody identified nothing is kept, and nothing else is read to find out who; an explicit person is used as given', async () => {
  const { sent, page } = setup({ userId: '' });
  await readTableMeta('incident', ['state']);
  await readTableMeta('incident', ['state']);
  assert.equal(sent.length, 2, 'asked again: there was no one to keep it for');
  assert.ok(sent.every((s) => s.url === '/api/now/ui/meta/incident'), 'no "who am I" read of a table was made to find out');
  assert.equal(page.userId, '');
  clearTableMeta();
  const before = sent.length;
  await readTableMeta('incident', ['state'], { userKey: 'abel' });
  await readTableMeta('incident', ['state'], { userKey: 'abel' });
  assert.equal(sent.length - before, 1);
});

test('it is kept for ten minutes, then asked again', async () => {
  const { sent } = setup();
  const realNow = Date.now;
  let clock = realNow.call(Date);
  Date.now = () => clock;
  try {
    await readTableMeta('incident', ['state'], { userKey: 'beth' });
    clock += 9 * 60 * 1000;
    await readTableMeta('incident', ['state'], { userKey: 'beth' });
    assert.equal(sent.length, 1);
    clock += 2 * 60 * 1000;
    await readTableMeta('incident', ['state'], { userKey: 'beth' });
    assert.equal(sent.length, 2);
  } finally {
    Date.now = realNow;
  }
});

test('two readers asking at the same moment share one request; a refusal is not kept', async () => {
  const { sent, state } = setup();
  const [a, b] = await Promise.all([readTableMeta('incident', ['state'], { userKey: 'beth' }), readTableMeta('incident', ['state'], { userKey: 'beth' })]);
  assert.equal(sent.length, 1);
  assert.deepEqual(a, b);
  clearTableMeta();
  sent.length = 0;
  state.reply = () => response(403, snError('User Not Authorized', 'User is unauthorized to access table: incident'));
  await assert.rejects(() => readTableMeta('incident', ['state'], { userKey: 'beth' }), (err) => err.code === 'ACCESS_DENIED');
  state.reply = () => response(200, INCIDENT_META);
  assert.deepEqual(Object.keys(await readTableMeta('incident', ['state'], { userKey: 'beth' })), ['state'], 'asked again, and now it works');
  assert.equal(sent.length, 2);
});

test('a sign-in that ends takes the kept labels with it', async () => {
  const { sent, state } = setup();
  await readTableMeta('incident', ['state'], { userKey: 'beth' });
  assert.equal(sent.length, 1);
  // some other read learns the sign-in ended (a 401): the labels kept for the person who was signed in go with it
  state.reply = () => response(401, '');
  const { queryTable } = await import('../src/content/tableApi.js');
  await assert.rejects(() => queryTable('incident', '', ['number']), (err) => err.code === 'SESSION_EXPIRED');
  state.reply = () => response(200, INCIDENT_META);
  await readTableMeta('incident', ['state'], { userKey: 'beth' });
  assert.equal(sent.filter((s) => s.url.includes('/ui/meta/')).length, 2, 'read again');
  // a 401 on the labels themselves is the same: signed out, and nothing kept
  state.reply = () => response(401, '');
  await assert.rejects(() => readTableMeta('problem', ['state'], { userKey: 'beth' }), (err) => err.code === 'SESSION_EXPIRED' && err.reason === 'session');
});

// ---- the refusals are sorted as everywhere else ----------------------------------------------------------------------------------------

test('a refusal of the labels says why, like every read: a role rule is an ACL, a missing table is left out quietly', async () => {
  const { state } = setup();
  const fail = async (reply) => {
    state.reply = () => reply;
    clearTableMeta();
    try {
      await readTableMeta('incident', ['state'], { userKey: 'x' });
    } catch (err) {
      return err;
    }
    throw new Error('did not fail');
  };
  const denied = await fail(response(403, snError('User Not Authorized', 'User is unauthorized to access table: incident')));
  assert.equal(denied.code, 'ACCESS_DENIED');
  assert.equal(denied.reason, READ_REASON.ACL);
  assert.equal(denied.message, 'Not available to you with your role.');
  assert.match(denied.detail, /Labels of "incident" failed \(403\)/);
  assert.equal((await fail(response(404, ''))).reason, READ_REASON.MISSING);
  assert.equal((await fail(response(200, '<html><body>Maintenance</body></html>'))).code, 'SN_NOT_DATA');
});

// ---- the context side: the policy first, the failure as an entry -------------------------------------------------------------------------

test('readChoiceLabels turns the answer into labels by "column:value", and a refusal into the usual failure', async () => {
  const deps = withMeta(fakeDeps({}), { incident: INCIDENT_META });
  const got = await readChoiceLabels(deps, 'incident', ['state', 'priority']);
  assert.equal(got.failure, null);
  assert.equal(got.labels.get('state:3'), 'On Hold');
  assert.equal(got.labels.get('priority:1'), '1 - Critical');
  assert.equal(got.columnLabels.get('state'), 'State');
  assert.equal(got.labels.has('state:10'), false);
  const refused = await readChoiceLabels(withMeta(fakeDeps({}), {}, { denied: ['incident'] }), 'incident', ['state']);
  assert.equal(refused.labels.size, 0);
  assert.deepEqual([refused.failure.status, refused.failure.reason], [STATUS.DENIED, READ_REASON.ACL]);
  const missing = await readChoiceLabels(withMeta(fakeDeps({}), {}), 'u_nothing', ['state']);
  assert.deepEqual([missing.failure.status, missing.failure.reason], [STATUS.SKIPPED, READ_REASON.MISSING]);
  // a reader without the service (older deps, a test) has no words and no failure
  const bare = await readChoiceLabels(fakeDeps({}), 'incident', ['state']);
  assert.deepEqual([bare.labels.size, bare.failure], [0, null]);
});

test('a lost sign-in and a cancelled read are thrown, not turned into "no labels"', async () => {
  const lost = Object.assign(new Error('You are signed out of ServiceNow. Sign in again, then try again.'), { code: 'SESSION_EXPIRED' });
  await assert.rejects(() => readChoiceLabels(withMeta(fakeDeps({}), {}, { failWith: lost }), 'incident', ['state']), (err) => err === lost);
  const aborted = Object.assign(new Error('x'), { name: 'AbortError' });
  await assert.rejects(() => readChoiceLabels(withMeta(fakeDeps({}), {}, { failWith: aborted }), 'incident', ['state']), (err) => err === aborted);
});

test('a table the organisation blocks is never asked for, through the real policy guard', async () => {
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['incident', 'sn_hr_core_case'] } }) });
  const base = withMeta(fakeDeps({}), { incident: INCIDENT_META, problem: INCIDENT_META, sc_task: INCIDENT_META });
  const guarded = await guard.deps(base);
  assert.equal(typeof guarded.readTableMeta, 'function', 'the guard keeps the dep');
  for (const table of ['incident', 'INCIDENT', 'sn_hr_core_case']) {
    const blocked = await readChoiceLabels(guarded, table, ['state']);
    assert.deepEqual([blocked.failure?.status, blocked.failure?.reason], [STATUS.BLOCKED, READ_REASON.BLOCKED], table);
    assert.equal(blocked.labels.size, 0);
  }
  assert.deepEqual(base.metaCalls, [], 'no request for a blocked table, not even a try');
  const open = await readChoiceLabels(guarded, 'problem', ['state']);
  assert.equal(open.failure, null);
  assert.deepEqual(base.metaCalls, [{ table: 'problem', columns: ['state'] }]);
  // deps that only say "blocked" (no checkRead) are honoured too
  const only = { isBlocked: (t) => t === 'incident', readTableMeta: base.readTableMeta };
  assert.equal((await readChoiceLabels(only, 'incident', ['state'])).failure.status, STATUS.BLOCKED);
});

// ---- the one extra address, kept to one ------------------------------------------------------------------------------------------------------

test('the read layer names exactly one address besides the table and the aggregate ones: the UI meta service, in tableApi.js only', () => {
  const root = path.join(__dirname, '..', 'src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const found = [];
  for (const file of walk(root).filter((f) => /\.(js|jsx)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\/api\/now\/([a-z_]+)(?:\/([a-z_]+))?/g)) found.push([path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/'), m[1] === 'ui' ? `ui/${m[2]}` : m[1]]);
  }
  const outside = found.filter(([file, api]) => !['table', 'stats'].includes(api) && !(file === 'src/content/tableApi.js' && api === 'ui/meta'));
  assert.deepEqual(outside, [], 'a new address in the read layer needs the security review (docs/security.md)');
  assert.ok(found.some(([file, api]) => file === 'src/content/tableApi.js' && api === 'ui/meta'));
  // and it is asked with the same GET-only client as the others
  const api = fs.readFileSync(path.join(root, 'content', 'tableApi.js'), 'utf8');
  const meta = api.slice(api.indexOf('export async function readTableMeta'));
  assert.match(meta, /readWithLimit\(\s*`\/api\/now\/ui\/meta\/\$\{encodeURIComponent\(table\)\}`/);
  assert.match(meta, /checkTable\(table\)/);
  assert.ok(!/\bfetch\(|method:\s*'(?:POST|PUT|PATCH|DELETE)'/.test(meta));
});

test('no code reads the choice table any more', () => {
  const root = path.join(__dirname, '..', 'src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const readers = walk(root)
    .filter((f) => /\.(js|jsx)$/.test(f))
    .filter((f) => /['"`]sys_choice['"`]/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/'));
  assert.deepEqual(readers, []);
});
