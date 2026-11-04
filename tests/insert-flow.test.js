import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGuard, performInsert } from '../src/sidepanel/insertFlow.js';
import { expectForInsert } from '../src/lib/fillable.js';
import { MSG } from '../src/lib/messages.js';
import ResultView from '../src/sidepanel/ResultView.jsx';
import { RewriteResultActions } from '../src/sidepanel/compose/RewritePanel.jsx';
import { featureById } from '../src/features/registry.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const pageOf = (sysId = A, over = {}) => ({ tabId: 5, href: `https://x.service-now.com/incident.do?sys_id=${sysId}`, record: { table: 'incident', sysId, number: 'INC0010001' }, newRecord: null, ...over });

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

// ---- One insert at a time (M1) --------------------------------------------------------------------------------------------------

test('a second click while the first insert is in flight does nothing: the text goes in once', async () => {
  const guard = createGuard();
  const gate = deferred();
  const sent = [];
  const send = async (_tab, message) => {
    sent.push(message);
    await gate.promise;
    return { ok: true, method: 'gform' };
  };
  const click = () => guard.run('comments:0', () => performInsert({ page: pageOf(), spec: { field: 'comments', label: 'Additional comments' }, value: 'Hello', send }));
  const first = click();
  assert.equal(guard.busy, true);
  assert.equal(await click(), null, 'the double click is ignored');
  assert.equal(await guard.run('work_notes:1', () => performInsert({ page: pageOf(), spec: { field: 'work_notes' }, value: 'x', send })), null, 'so is a click on another insert button');
  gate.resolve();
  const outcome = await first;
  assert.equal(outcome.status, 'inserted');
  assert.equal(sent.length, 1, 'one FILL_FIELD message in all');
  assert.equal(guard.busy, false);
});

test('after a successful insert that button stays done until reset; a failed one can be tried again', async () => {
  const guard = createGuard();
  let answers = [{ ok: false, reason: 'no-form' }, { ok: true, method: 'gform' }];
  const send = async () => answers.shift();
  const go = () => guard.run('k', () => performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', send }));
  assert.equal((await go()).status, 'failed');
  assert.equal(guard.isDone('k'), false);
  assert.equal((await go()).status, 'inserted');
  assert.equal(guard.isDone('k'), true);
  answers = [{ ok: true, method: 'gform' }];
  assert.equal(await go(), null, 'inserted already');
  assert.equal(answers.length, 1, 'nothing was sent');
  guard.reset();
  assert.equal((await go()).status, 'inserted', 'Try again / Close starts over');
});

test('a task that throws frees the guard', async () => {
  const guard = createGuard();
  await assert.rejects(() => guard.run('k', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(guard.busy, false);
  assert.equal((await guard.run('k', async () => ({ status: 'inserted' }))).status, 'inserted');
});

// ---- The insert itself -------------------------------------------------------------------------------------------------------------

test('the message carries the field, the plain text, the label, the mode and the record the text was written for', async () => {
  const sent = [];
  const send = async (tab, message) => (sent.push([tab, message]), { ok: true, method: 'gform' });
  const outcome = await performInsert({ page: pageOf(), spec: { field: 'work_notes', label: 'Add to work notes', fieldLabel: 'Work notes' }, value: 'A note', expect: { table: 'incident', sysId: A }, send });
  assert.equal(outcome.status, 'inserted');
  assert.equal(outcome.note, 'Inserted into the form. Review it, then save the record yourself.');
  assert.deepEqual(sent, [[5, { type: MSG.FILL_FIELD, field: 'work_notes', value: 'A note', label: 'Work notes', mode: 'append', expect: { table: 'incident', sysId: A } }]]);
});

test('with no expectation given, the page as it is now is expected; null means any form', async () => {
  const sent = [];
  const send = async (_t, message) => (sent.push(message), { ok: true, method: 'gform' });
  await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', send });
  await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', expect: null, send });
  assert.deepEqual(sent[0].expect, { table: 'incident', sysId: A });
  assert.equal('expect' in sent[1], false);
});

test('a title is replaced, not appended to; the spec can ask for replace; the default is append', async () => {
  const sent = [];
  const send = async (_t, message) => (sent.push(message.mode), { ok: true, method: 'gform' });
  await performInsert({ page: pageOf(), spec: { field: 'short_description' }, value: 'T', send });
  await performInsert({ page: pageOf(), spec: { field: 'short_description', mode: 'append' }, value: 'T', send });
  await performInsert({ page: pageOf(), spec: { field: 'description', mode: 'replace' }, value: 'T', send });
  await performInsert({ page: pageOf(), spec: { field: 'description' }, value: 'T', send });
  assert.deepEqual(sent, ['replace', 'replace', 'replace', 'append']);
});

test('serious findings stop the insert until it is forced; markup and a leftover placeholder are among them', async () => {
  let calls = 0;
  const send = async () => (calls += 1, { ok: true, method: 'gform' });
  const markup = await performInsert({ page: pageOf(), spec: { field: 'text' }, value: '<img src=x onerror=1>', send });
  assert.equal(markup.status, 'findings');
  assert.ok(markup.items.some((f) => f.kind === 'MARKUP'));
  const note = await performInsert({ page: pageOf(), spec: { field: 'work_notes' }, value: '[code]<b>x</b>[/code]', send });
  assert.equal(note.status, 'findings', 'markup is checked in internal fields too');
  const holder = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'Dear [PERSON_1], done', send });
  assert.equal(holder.status, 'findings');
  const secret = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'your password: Summer2024!x', send });
  assert.equal(secret.status, 'findings');
  assert.equal(calls, 0, 'nothing was sent');
  const forced = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'your password: Summer2024!x', force: true, send });
  assert.equal(forced.status, 'inserted');
  assert.equal(calls, 1);
  const plain = await performInsert({ page: pageOf(), spec: { field: 'work_notes' }, value: 'Rebooted the gateway.', send });
  assert.equal(plain.status, 'inserted');
});

test('words copied from an internal note are held back from a customer comment but not from a work note', async () => {
  const send = async () => ({ ok: true, method: 'gform' });
  const notes = ['The finance share for the Q3 restructuring lives on the payroll folder.'];
  const comment = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'Yes, the finance share for the Q3 restructuring is the cause.', review: { internalTexts: notes }, send });
  assert.equal(comment.status, 'findings');
  assert.ok(comment.items.some((f) => f.kind === 'INTERNAL_NOTE'));
  const note = await performInsert({ page: pageOf(), spec: { field: 'work_notes' }, value: 'Yes, the finance share for the Q3 restructuring is the cause.', review: { internalTexts: notes }, send });
  assert.equal(note.status, 'inserted');
});

test('hints do not stop an insert but are returned with the findings', async () => {
  const send = async () => ({ ok: true, method: 'gform' });
  const only = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'Please ask your colleague John Smith.', send });
  assert.equal(only.status, 'inserted', 'a name hint is low severity');
  const both = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'Ask your colleague John Smith. Your password: Summer2024!x', send });
  assert.equal(both.status, 'findings');
  assert.ok(both.hints.some((f) => f.kind === 'OTHER_PERSON'));
});

test('empty text, a missing page answer, a wire error and a throwing send all end as a failed or empty outcome, never as success', async () => {
  const ok = async () => ({ ok: true, method: 'gform' });
  assert.deepEqual(await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: '  \n', send: ok }), { status: 'empty' });
  for (const send of [async () => undefined, async () => null, async () => 'ok', async () => ({ error: { message: 'x' } }), async () => { throw new Error('Could not establish connection.'); }]) {
    const out = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', send });
    assert.equal(out.status, 'failed');
    assert.equal(out.answer.reason, 'no-form');
    assert.equal(out.why, 'Agent Buddy could not reach a form field on this page.');
  }
});

test('a wrong record says which record the text was written for; a Workspace box is named', async () => {
  const wrong = await performInsert({ page: pageOf(B), spec: { field: 'comments' }, value: 'x', expect: { table: 'incident', sysId: A }, number: 'INC0010001', send: async () => ({ ok: false, reason: 'wrong-record' }) });
  assert.equal(wrong.status, 'failed');
  assert.equal(wrong.why, 'This was written for INC0010001. Open that ticket again, or use Copy.');
  const dom = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', send: async () => ({ ok: true, method: 'dom', label: 'Additional comments' }) });
  assert.match(dom.note, /box labelled "Additional comments"/);
  const reasons = { 'read-only': /read-only/, 'no-such-field': /not on this form/, 'too-long': /too long/, 'set-failed': /did not accept/, 'bad-field': /cannot be filled/ };
  for (const [reason, re] of Object.entries(reasons)) {
    const out = await performInsert({ page: pageOf(), spec: { field: 'comments' }, value: 'x', send: async () => ({ ok: false, reason }) });
    assert.match(out.why, re, reason);
  }
});

test('which form an insert lands in', () => {
  const page = pageOf();
  const source = { expect: { table: 'incident', sysId: B }, number: 'INC2' };
  assert.deepEqual(expectForInsert({ spec: { field: 'comments' }, source, page }), { table: 'incident', sysId: B }, 'the record the answer was written for');
  assert.deepEqual(expectForInsert({ spec: { field: 'comments' }, source: null, page }), { table: 'incident', sysId: A }, 'no source: the page as it is');
  assert.deepEqual(expectForInsert({ spec: { field: 'text', table: 'kb_knowledge' }, source, page }), { table: 'incident', sysId: A }, 'an insert for another kind of form goes to the form that is open');
  assert.deepEqual(expectForInsert({ spec: { field: 'text', table: 'kb_knowledge' }, source, target: { table: 'kb_knowledge', newRecord: true }, page }), { table: 'kb_knowledge', newRecord: true }, 'a draft on a blank form');
  assert.equal(expectForInsert({ spec: { field: 'comments' }, source, target: null, page }), null, 'any form');
});

// ---- What the cards show (first render) ---------------------------------------------------------------------------------------

const noop = () => {};
const card = (props) => renderToStaticMarkup(React.createElement(ResultView, { text: 'We restarted the gateway. Please try again.', onClose: noop, audit: noop, ...props }));
const buttonTag = (markup, label) => new RegExp(`<button[^>]*>${label}</button>`).exec(markup)?.[0] || '';

test('the result card: Insert is on, the first one is the main button, Copy and Close are there', () => {
  const markup = card({ feature: featureById('reply-draft'), page: pageOf(), source: { expect: { table: 'incident', sysId: A }, number: 'INC0010001' }, people: [], scan: null });
  const insert = buttonTag(markup, 'Insert as customer comment');
  assert.ok(insert && !insert.includes('disabled'), insert);
  assert.match(insert, /ab-btn-primary/);
  assert.ok(buttonTag(markup, 'Copy'));
  assert.ok(buttonTag(markup, 'Close'));
  assert.ok(!markup.includes('This was written for'));
});

test('when another record is open the Insert buttons are off and the card names the record the text was written for', () => {
  const markup = card({ feature: featureById('reply-draft'), page: pageOf(B), source: { expect: { table: 'incident', sysId: A }, number: 'INC0010001' }, people: [], scan: null });
  assert.match(buttonTag(markup, 'Insert as customer comment'), /disabled/);
  assert.match(markup, /This was written for INC0010001\. Open that ticket again, or use Copy\./);
  assert.ok(!/<button[^>]*disabled[^>]*>Copy</.test(markup), 'Copy still works');
  // a result with no source (nothing known about the record) is not blocked
  assert.ok(!buttonTag(card({ feature: featureById('reply-draft'), page: pageOf(B), people: [], scan: null }), 'Insert as customer comment').includes('disabled'));
});

test('a draft on a blank form is bound to that form, not to the record it was written on', () => {
  const feature = featureById('kb-article-draft');
  const blank = { tabId: 5, href: 'https://x.service-now.com/kb_knowledge.do?sys_id=-1', record: null, newRecord: { table: 'kb_knowledge', kind: 'knowledge' } };
  const markup = card({ feature, page: blank, text: 'Title: How to reset\nSymptoms: It fails.', target: { table: 'kb_knowledge', newRecord: true }, source: { expect: { table: 'incident', sysId: A }, number: 'INC1' } });
  assert.ok(!buttonTag(markup, 'Insert body into the article form').includes('disabled'));
  assert.ok(!markup.includes('This was written for'));
  assert.match(markup, /A one-line field such as a title is replaced, not added to\./);
});

test('low-severity findings are shown on the card as "Worth a look", and serious text does not hide them', () => {
  const markup = card({ feature: featureById('reply-draft'), page: pageOf(), text: 'Please ask your colleague John Smith about 10.1.2.3.', source: null, people: [], scan: null });
  assert.match(markup, /Worth a look/);
  assert.match(markup, /someone who is not on this record/);
  assert.match(markup, /IP address/);
  // an internal-only insert has nothing to warn the customer about
  assert.ok(!card({ feature: featureById('thread-summary'), page: pageOf(), text: 'Please ask your colleague John Smith about 10.1.2.3.', people: [], scan: null }).includes('Worth a look'));
});

test('the rewrite buttons: "Add below" is the main button, Replace is not and says what it does', () => {
  const field = { name: 'comments', label: 'Customer comment', fieldLabel: 'Additional comments', customerVisible: true, singleLine: false };
  const fill = { busy: false, inserted: {}, note: null, findings: null };
  const markup = renderToStaticMarkup(React.createElement(RewriteResultActions, { field, fill, made: null, wrongRecord: false, hints: [], onPut: noop, onUseAsText: noop }));
  assert.match(buttonTag(markup, 'Add below'), /ab-btn-primary/);
  assert.ok(!/ab-btn-primary[^>]*>Replace what is in the form/.test(markup));
  assert.ok(!buttonTag(markup, 'Replace what is in the form').includes('ab-btn-primary'));
  assert.match(markup, /Replace overwrites|replaces what is in the form if you choose Replace/);
  assert.ok(markup.indexOf('Add below') < markup.indexOf('Replace what is in the form'), 'Add below comes first');
});

test('a one-line target has only Replace, and says it replaces', () => {
  const field = { name: 'short_description', label: 'Short description', fieldLabel: 'Short description', customerVisible: true, singleLine: true };
  const fill = { busy: false, inserted: {}, note: null, findings: null };
  const markup = renderToStaticMarkup(React.createElement(RewriteResultActions, { field, fill, made: null, wrongRecord: false, hints: [], onPut: noop, onUseAsText: noop }));
  assert.ok(!markup.includes('Add below'));
  assert.ok(buttonTag(markup, 'Replace what is in the form'));
  assert.match(markup, /This replaces what is in the form: it is a one-line field\./);
});

test('the rewrite buttons are off while an insert is in flight, say "Inserted" afterwards, and are off for another record', () => {
  const field = { name: 'comments', label: 'Customer comment', fieldLabel: 'Additional comments', customerVisible: true, singleLine: false };
  const render = (fill, extra = {}) => renderToStaticMarkup(React.createElement(RewriteResultActions, { field, fill: { note: null, findings: null, ...fill }, made: null, wrongRecord: false, hints: [], onPut: noop, onUseAsText: noop, ...extra }));
  const busy = render({ busy: true, inserted: {} });
  assert.match(buttonTag(busy, 'Add below'), /disabled/);
  assert.match(buttonTag(busy, 'Replace what is in the form'), /disabled/);
  const done = render({ busy: false, inserted: { 'comments:append': true } });
  assert.match(buttonTag(done, 'Inserted'), /disabled/);
  assert.ok(!buttonTag(done, 'Replace what is in the form').includes('disabled'), 'the other button is still available');
  // an insert into another field does not mark this one
  assert.ok(!render({ busy: false, inserted: { 'work_notes:append': true } }).includes('>Inserted<'));
  const wrong = render({ busy: false, inserted: {} }, { wrongRecord: true, made: { expect: { table: 'incident', sysId: A }, number: 'INC0010001' } });
  assert.match(buttonTag(wrong, 'Add below'), /disabled/);
  assert.match(buttonTag(wrong, 'Replace what is in the form'), /disabled/);
  assert.match(wrong, /This was written for INC0010001\. Open that ticket again, or use Copy\./);
});
