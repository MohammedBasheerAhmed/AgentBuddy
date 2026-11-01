import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ops, { readFormValues } from '../src/content/ops/compose.js';
import { OPS } from '../src/content/ops/index.js';
import { FORM_FIELD_NAMES, MAX_FORM_TEXT } from '../src/compose/formFields.js';

// A stand-in for the page bridge that records what it was asked.
function fakePage(answer) {
  const calls = [];
  const call = async (action, args) => {
    calls.push({ action, args });
    return typeof answer === 'function' ? answer(args) : answer;
  };
  return { call, calls };
}

test('the operation is registered with the others', () => {
  assert.equal(typeof ops.formValues, 'function');
  assert.equal(OPS.formValues, ops.formValues);
});

test('it asks the page for exactly the whitelisted names it was given', async () => {
  const page = fakePage({ comments: 'Hello', work_notes: 'Note' });
  const out = await readFormValues({ names: ['comments', 'work_notes'] }, page.call);
  assert.deepEqual(page.calls, [{ action: 'getFormValues', args: [['comments', 'work_notes']] }]);
  assert.deepEqual(out, { available: true, values: { comments: 'Hello', work_notes: 'Note' } });
});

test('all five whitelisted names are allowed, and a repeated name is asked once', async () => {
  const page = fakePage({});
  await readFormValues({ names: [...FORM_FIELD_NAMES, 'comments', 'comments'] }, page.call);
  assert.deepEqual(page.calls[0].args[0], FORM_FIELD_NAMES);
});

test('a name outside the whitelist is refused before the page is contacted', async () => {
  const refused = [
    ['comments', 'assigned_to'],
    ['password'],
    ['u_secret_field'],
    ['sys_id'],
    ['caller_id'],
    ['Comments'],
    ['comments '],
    ['__proto__'],
    ['constructor'],
    ['comments', 7],
    ['comments', null],
    ['comments', { toString: () => 'comments' }],
    [['comments']],
  ];
  for (const names of refused) {
    const page = fakePage({ comments: 'x' });
    await assert.rejects(() => readFormValues({ names }, page.call), /cannot be read/, JSON.stringify(names));
    assert.equal(page.calls.length, 0, `the page was contacted for ${JSON.stringify(names)}`);
  }
});

test('missing, empty, non-list or oversized requests are refused', async () => {
  for (const args of [undefined, null, {}, { names: [] }, { names: 'comments' }, { names: {} }, { names: Array.from({ length: 21 }, () => 'comments') }]) {
    const page = fakePage({});
    await assert.rejects(() => readFormValues(args, page.call), /Say which form fields/, JSON.stringify(args));
    assert.equal(page.calls.length, 0);
  }
});

test('long text is cut to the limit', async () => {
  const page = fakePage({ comments: 'a'.repeat(MAX_FORM_TEXT + 5000), description: 'short' });
  const out = await readFormValues({ names: ['comments', 'description'] }, page.call);
  assert.equal(out.values.comments.length, MAX_FORM_TEXT);
  assert.equal(out.values.description, 'short');
  assert.equal(MAX_FORM_TEXT, 20000);
});

test('the page\'s answer is untrusted: extra names, non-strings and inherited values are dropped', async () => {
  const inherited = Object.create({ close_notes: 'from the prototype' });
  Object.assign(inherited, { comments: 'ok', work_notes: 42, description: { text: 'nested' }, short_description: null, password: 'hunter2', caller_id: 'abel', u_x: 'y' });
  const page = fakePage(inherited);
  const out = await readFormValues({ names: ['comments', 'work_notes', 'description', 'short_description', 'close_notes'] }, page.call);
  assert.deepEqual(out, { available: true, values: { comments: 'ok' } });
  assert.ok(!JSON.stringify(out).includes('hunter2'));
});

test('a page with no readable form is reported, not guessed', async () => {
  for (const answer of [null, undefined, 'text', 7, ['comments'], true]) {
    const out = await readFormValues({ names: ['comments'] }, fakePage(answer).call);
    assert.deepEqual(out, { available: false, values: {} }, JSON.stringify(answer));
  }
});

test('an empty form field comes back as an empty string, so the panel can say it is empty', async () => {
  const out = await readFormValues({ names: ['comments'] }, fakePage({ comments: '' }).call);
  assert.deepEqual(out, { available: true, values: { comments: '' } });
});

test('through the page bridge: the real default path asks for getFormValues and validates the answer', async () => {
  const listeners = [];
  const asked = [];
  globalThis.document = {
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    dispatchEvent: (event) => {
      asked.push(event.detail);
      const result = { comments: 'typed in the form', password: 'never', work_notes: 'x'.repeat(30000) };
      listeners.filter((l) => l.type === 'ab-page-response').forEach((l) => l.fn({ detail: { id: event.detail.id, ok: true, result } }));
      return true;
    },
  };
  try {
    const out = await ops.formValues({ names: ['comments', 'work_notes'] });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].action, 'getFormValues');
    assert.deepEqual(asked[0].args, [['comments', 'work_notes']]);
    assert.equal(out.available, true);
    assert.equal(out.values.comments, 'typed in the form');
    assert.equal(out.values.work_notes.length, MAX_FORM_TEXT);
    assert.ok(!('password' in out.values));
    // and a name outside the list never reaches the page at all
    await assert.rejects(() => ops.formValues({ names: ['password'] }), /cannot be read/);
    assert.equal(asked.length, 1);
  } finally {
    delete globalThis.document;
  }
});

test('the operations make no network call of their own and no write: the form read only asks the page bridge, the hints read through the guarded deps', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'ops', 'compose.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bfetch\s*\(|queryTable|fetchRecord|XMLHttpRequest|fillField|setValue|method\s*:/.test(source));
  assert.deepEqual([...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]), ['../pageBridge.js', '../../compose/formFields.js', '../../compose/notesHints.js']);
  // Round 3: notesHints (src/compose/notesHints.js) reads with the deps it is handed (GET-only, policy-guarded), nothing else.
  const hints = fs.readFileSync(path.join(__dirname, '..', 'src', 'compose', 'notesHints.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|fillField|setValue|method\s*:|chrome\./.test(hints));
});

// ---- Round 3: the form read can be bound to a record ("Check my comment") ----------------------------------------------

test('with `expect`, the form must be that record: another one answers wrongForm and nothing is read', async () => {
  const A = 'a'.repeat(32);
  const page = fakePage((args) => args);
  const call = async (action, args) => {
    page.calls.push({ action, args });
    if (action === 'getFormMeta') return { table: 'incident', sysId: 'b'.repeat(32) };
    return { comments: 'typed' };
  };
  assert.deepEqual(await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: A } }, call), { available: false, values: {}, wrongForm: true });
  assert.deepEqual(page.calls.map((c) => c.action), ['getFormMeta'], 'the values were never asked for');
  const same = async (action) => (action === 'getFormMeta' ? { table: 'incident', sysId: A.toUpperCase() } : { comments: 'typed' });
  assert.deepEqual(await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: A } }, same), { available: true, values: { comments: 'typed' } });
  const noForm = async (action) => (action === 'getFormMeta' ? null : { comments: 'typed' });
  assert.deepEqual(await readFormValues({ names: ['comments'], expect: { table: 'incident', sysId: A } }, noForm), { available: false, values: {} }, 'a Workspace page has no form to read');
  for (const expect of [{ table: 'inc^ident', sysId: A }, { table: 'incident', sysId: 'x' }, 'incident', 7]) {
    await assert.rejects(() => readFormValues({ names: ['comments'], expect }, same), /not a valid record/, JSON.stringify(expect));
  }
});
