import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_INSERT_CHARS, handleFillField } from '../src/content/fill.js';
import { FEATURES, insertsFor } from '../src/features/registry.js';
import { FILLABLE_FIELDS } from '../src/lib/fillable.js';

// The content script's FILL_FIELD handling with a fake page bridge and a fake "what is open now". Nothing here needs a browser.

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

function setup({ record = { table: 'incident', sysId: A }, newRecord = null, href = 'https://x.service-now.com/incident.do', answer = { ok: true, method: 'gform' } } = {}) {
  const calls = [];
  const deps = {
    callPage: async (action, args) => {
      calls.push({ action, args });
      if (typeof answer === 'function') return answer(action, args);
      return answer;
    },
    currentRecord: async () => record,
    currentNewRecord: async () => newRecord,
    href: () => href,
  };
  return { calls, deps, run: (message) => handleFillField(message, deps) };
}

test('only the fields in FILLABLE_FIELDS can be written: a well-formed column name is not enough', async () => {
  const { calls, run } = setup();
  for (const field of ['state', 'assigned_to', 'approval', 'caller_id', 'u_custom', 'sys_id', 'password', '__proto__', 'constructor', 'Comments', '', undefined, 42, 'a-b']) {
    assert.deepEqual(await run({ field, value: 'x', mode: 'append' }), { ok: false, reason: 'bad-field' }, String(field));
  }
  assert.deepEqual(calls, [], 'the page bridge was never asked');
});

test('every field in the list gets through to the page bridge', async () => {
  for (const field of Object.keys(FILLABLE_FIELDS)) {
    const { calls, run } = setup();
    const answer = await run({ field, value: 'some text', label: 'A label', mode: 'append' });
    assert.equal(answer.ok, true, field);
    assert.equal(calls.length, 1, field);
    assert.equal(calls[0].action, 'fillField');
    assert.equal(calls[0].args[0], field);
  }
});

test('every insert in the registry reaches the page bridge (a new feature cannot silently fail)', async () => {
  let n = 0;
  for (const feature of FEATURES) {
    for (const spec of insertsFor(feature)) {
      const { calls, run } = setup();
      const answer = await run({ field: spec.field, value: 'text', label: spec.fieldLabel, mode: 'append' });
      assert.equal(answer.ok, true, `${feature.id} -> ${spec.field}`);
      assert.equal(calls.length, 1);
      n += 1;
    }
  }
  assert.ok(n >= 20);
});

test('inserting <img src=x onerror=1> into the article body: the form gets &lt;img, the page without g_form gets plain text', async () => {
  const { calls, run } = setup();
  const raw = '<img src=x onerror=1>';
  assert.equal((await run({ field: 'text', value: raw, mode: 'append' })).ok, true);
  const [field, plain, label, append, html] = calls[0].args;
  assert.equal(field, 'text');
  assert.equal(plain, raw, 'the plain text is passed for a page that types into its own editor');
  assert.ok(html.includes('&lt;img'), html);
  assert.ok(!html.includes('<img'), 'no live tag in the HTML');
  assert.equal(html, '<p>&lt;img src=x onerror=1&gt;</p>');
  assert.equal(append, true);
  assert.equal(label, '');
});

test('a field that is not HTML gets no HTML text', async () => {
  const { calls, run } = setup();
  await run({ field: 'comments', value: 'a <b> c', mode: 'append' });
  assert.equal(calls[0].args[4], '');
  assert.equal(calls[0].args[1], 'a <b> c');
});

test('a one-line field is replaced, never appended to, and its line breaks become spaces', async () => {
  const { calls, run } = setup();
  await run({ field: 'short_description', value: 'Title\n\nwith   a break', mode: 'append' });
  assert.equal(calls[0].args[1], 'Title with a break');
  assert.equal(calls[0].args[3], false, 'append is off');
  const second = setup();
  await second.run({ field: 'comments', value: 'x', mode: 'append' });
  assert.equal(second.calls[0].args[3], true);
  const third = setup();
  await third.run({ field: 'comments', value: 'x', mode: 'replace' });
  assert.equal(third.calls[0].args[3], false);
  const fourth = setup();
  await fourth.run({ field: 'comments', value: 'x' });
  assert.equal(fourth.calls[0].args[3], false, 'no mode means replace, as before');
});

test('lengths: empty is refused, too long is refused, the HTML of an HTML field counts too', async () => {
  const { calls, run } = setup();
  assert.deepEqual(await run({ field: 'comments', value: '' }), { ok: false, reason: 'bad-field' });
  assert.deepEqual(await run({ field: 'comments', value: '   \n ' }), { ok: false, reason: 'bad-field' });
  assert.deepEqual(await run({ field: 'comments', value: 'x'.repeat(MAX_INSERT_CHARS + 1) }), { ok: false, reason: 'too-long' });
  // 5000 ampersands are 5000 characters of text and 25000 of HTML
  assert.deepEqual(await run({ field: 'text', value: '&'.repeat(5000) }), { ok: false, reason: 'too-long' });
  assert.deepEqual(calls, []);
});

// ---- The record the text was written for ----------------------------------------------------------------------------------

test('a mismatch is refused before the page is touched: another record, another table, a blank form instead of a record', async () => {
  const other = setup({ record: { table: 'incident', sysId: B } });
  assert.deepEqual(await other.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } }), { ok: false, reason: 'wrong-record' });
  assert.deepEqual(other.calls, []);
  const table = setup({ record: { table: 'problem', sysId: A } });
  assert.equal((await table.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } })).reason, 'wrong-record');
  const blank = setup({ record: null, newRecord: { table: 'incident' } });
  assert.equal((await blank.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } })).reason, 'wrong-record');
  const nothing = setup({ record: null, newRecord: null });
  assert.equal((await nothing.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } })).reason, 'wrong-record');
  assert.deepEqual([blank.calls, nothing.calls, table.calls], [[], [], []]);
});

test('the right record is filled; sys_ids compare without regard to case', async () => {
  const right = setup();
  assert.equal((await right.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } })).ok, true);
  assert.equal(right.calls.length, 1);
  const upper = setup({ record: { table: 'incident', sysId: A.toUpperCase() } });
  assert.equal((await upper.run({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } })).ok, true);
});

test('a blank form of the named table: matches only a blank form of that table', async () => {
  const blank = setup({ record: null, newRecord: { table: 'kb_knowledge' } });
  assert.equal((await blank.run({ field: 'text', value: 'x', expect: { table: 'kb_knowledge', newRecord: true } })).ok, true);
  const wrongBlank = setup({ record: null, newRecord: { table: 'incident' } });
  assert.equal((await wrongBlank.run({ field: 'text', value: 'x', expect: { table: 'kb_knowledge', newRecord: true } })).reason, 'wrong-record');
  const saved = setup({ record: { table: 'kb_knowledge', sysId: A } });
  assert.equal((await saved.run({ field: 'text', value: 'x', expect: { table: 'kb_knowledge', newRecord: true } })).reason, 'wrong-record', 'an existing article is not the blank form the draft was carried to');
});

test('the email client: the address must name the record the draft is for', async () => {
  const href = `https://x.service-now.com/email_client.do?sysparm_table=incident&sysparm_sys_id=${A}`;
  const ok = setup({ record: null, newRecord: { table: 'sys_email' }, href });
  assert.equal((await ok.run({ field: 'body', value: 'x', expect: { email: true, table: 'incident', sysId: A } })).ok, true);
  const other = setup({ record: null, newRecord: { table: 'sys_email' }, href: href.replace(A, B) });
  assert.equal((await other.run({ field: 'body', value: 'x', expect: { email: true, table: 'incident', sysId: A } })).reason, 'wrong-record');
  // not an email form at all: the field is simply not on this page (and nothing is written)
  const notEmail = setup();
  assert.deepEqual(await notEmail.run({ field: 'body', value: 'x', expect: { email: true, table: 'incident', sysId: A } }), { ok: false, reason: 'no-such-field' });
  assert.deepEqual(notEmail.calls, []);
});

test('an expectation that is present but malformed is a mismatch (fail closed); none at all means any form', async () => {
  for (const expect of ['incident', 7, [], {}, { table: 'incident' }, { table: 'incident', sysId: 'x' }, { table: 'a b', newRecord: true }]) {
    const { calls, run } = setup();
    assert.equal((await run({ field: 'comments', value: 'x', expect })).reason, 'wrong-record', JSON.stringify(expect));
    assert.deepEqual(calls, []);
  }
  for (const expect of [undefined, null]) {
    const { run } = setup();
    assert.equal((await run({ field: 'comments', value: 'x', expect })).ok, true);
  }
});

test('when the record cannot be determined, an expectation is not met', async () => {
  const deps = { callPage: async () => ({ ok: true, method: 'gform' }), currentRecord: async () => { throw new Error('lookup failed'); }, currentNewRecord: async () => { throw new Error('boom'); }, href: () => 'https://x/' };
  assert.equal((await handleFillField({ field: 'comments', value: 'x', expect: { table: 'incident', sysId: A } }, deps)).reason, 'wrong-record');
});

// ---- What comes back ----------------------------------------------------------------------------------------------------------

test('the answer from the page is data: only known shapes go back, and a page cannot claim wrong-record', async () => {
  const forged = setup({ answer: { ok: true, method: 'eval', extra: '<script>', label: '  Additional\u0000 comments\n(internal)  ' } });
  assert.deepEqual(await forged.run({ field: 'comments', value: 'x' }), { ok: true, method: 'dom', label: 'Additional comments (internal)' });
  const gform = setup({ answer: { ok: true, method: 'gform' } });
  assert.deepEqual(await gform.run({ field: 'comments', value: 'x' }), { ok: true, method: 'gform' });
  const long = setup({ answer: { ok: true, method: 'dom', label: 'L'.repeat(500) } });
  assert.equal((await long.run({ field: 'comments', value: 'x' })).label.length, 80);
  const notLabel = setup({ answer: { ok: true, method: 'dom', label: { toString: () => 'x' } } });
  assert.deepEqual(await notLabel.run({ field: 'comments', value: 'x' }), { ok: true, method: 'dom' });
  const odd = setup({ answer: { ok: false, reason: 'drop table' } });
  assert.deepEqual(await odd.run({ field: 'comments', value: 'x' }), { ok: false, reason: 'no-form' });
  const claim = setup({ answer: { ok: false, reason: 'wrong-record' } });
  assert.deepEqual(await claim.run({ field: 'comments', value: 'x' }), { ok: false, reason: 'no-form' });
  const truthy = setup({ answer: { ok: 'yes' } });
  assert.deepEqual(await truthy.run({ field: 'comments', value: 'x' }), { ok: false, reason: 'no-form' });
  for (const reason of ['no-form', 'no-such-field', 'read-only', 'too-long', 'set-failed', 'bad-field']) {
    assert.deepEqual(await setup({ answer: { ok: false, reason } }).run({ field: 'comments', value: 'x' }), { ok: false, reason }, reason);
  }
  const throwing = setup({ answer: () => { throw new Error('page did not answer'); } });
  assert.deepEqual(await throwing.run({ field: 'comments', value: 'x' }), { ok: false, reason: 'no-form' });
  const nothing = setup({ answer: null });
  assert.deepEqual(await nothing.run({ field: 'comments', value: 'x' }), { ok: false, reason: 'no-form' });
});

test('the label from the panel is cut to 100 characters and a non-string is dropped', async () => {
  const { calls, run } = setup();
  await run({ field: 'comments', value: 'x', label: 'L'.repeat(300) });
  await run({ field: 'comments', value: 'x', label: { a: 1 } });
  assert.equal(calls[0].args[2].length, 100);
  assert.equal(calls[1].args[2], '');
});
