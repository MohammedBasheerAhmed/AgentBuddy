import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { featureById } from '../src/features/registry.js';
import { checkInsertTargets, handleFillField } from '../src/content/fill.js';
import { buildFillMessage, describeInsert, insertedNote } from '../src/lib/fillable.js';
import { OVERLAP_HINT, applyFieldStates, choicesOf, forgetInserts, insertTargets, insertText, insertsForKind, primaryOf, readFieldStates, reviewInsert } from '../src/sidepanel/insertFlow.js';
import { NO_NOTES_TO_IMPROVE } from '../src/features/packs/checks.js';

// F5, Insert done right: replace or append (and no second copy after Try again), the right box per kind, a check before the click
// that the box is on the form, and where the text lands with the next step. Every old guard still holds (tests/insert-*.test.js).

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

/** The page bridge in a vm with a fake g_form whose values change as the bridge writes them. */
function classicForm({ table = 'incident', sysId = A, values = {}, fields = ['comments', 'work_notes', 'close_notes'], editable = null } = {}) {
  const state = { ...values };
  const g_form = {
    hasField: (name) => fields.includes(name),
    getValue: (name) => state[name] ?? '',
    setValue: (name, value) => {
      state[name] = value;
    },
    getEditableFields: () => editable || fields,
    isReadOnly: () => true,
    getTableName: () => table,
    getUniqueValue: () => sysId,
  };
  const listeners = {};
  const responses = [];
  const sandbox = {
    document: { addEventListener: (t, fn) => (listeners[t] = fn), dispatchEvent: (e) => (responses.push(e), true), querySelector: () => null, querySelectorAll: () => [] },
    location: { pathname: `/${table}.do`, search: '', hash: '' },
    frames: [],
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    g_form,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE, sandbox);
  let n = 0;
  const callPage = async (action, args) => {
    responses.length = 0;
    listeners['ab-page-request']({ detail: { id: `t${(n += 1)}`, action, args } });
    const d = responses[0].detail;
    if (!d.ok) throw new Error(d.error);
    return d.result === undefined ? undefined : JSON.parse(JSON.stringify(d.result));
  };
  const record = { table, sysId };
  const send = (_tab, message) => handleFillField(message, { callPage, currentRecord: async () => record, currentNewRecord: async () => null, href: () => `https://x.service-now.com/${table}.do` });
  const page = { tabId: 3, href: `https://x.service-now.com/${table}.do?sys_id=${sysId}`, surface: 'classic', record: { ...record, kind: table === 'problem' ? 'problem' : 'incident', number: 'INC0010001' } };
  return { state, callPage, send, page };
}

const source = { expect: { table: 'incident', sysId: A }, number: 'INC0010001' };

// ---- the boxes per record ---------------------------------------------------------------------------------------------------

test('insertTargets: the boxes of THIS kind of record, with their mode, the modes allowed, where the text lands and the next step', () => {
  const notes = featureById('resolution-notes');
  const inc = insertTargets(notes, { record: { kind: 'incident' }, page: { surface: 'classic' } });
  assert.equal(inc.length, 1);
  assert.equal(inc[0].field, 'close_notes');
  assert.equal(inc[0].mode, 'replace');
  assert.deepEqual(inc[0].modes, ['replace', 'append']);
  assert.equal(inc[0].where, 'Replaces what is in Resolution notes, which the customer can often read.');
  assert.equal(inc[0].next, 'Then press Save.');
  const prb = insertTargets(notes, { record: { kind: 'problem' } }).map((t) => t.field);
  assert.deepEqual(prb, ['fix_notes', 'cause_notes'], 'a problem has no resolution-notes box (packs/core.js used to send close_notes)');
  const ritm = insertTargets(notes, { record: { kind: 'requested_item' } });
  assert.equal(ritm[0].fieldLabel, 'Close notes');
  assert.deepEqual(insertsForKind(notes, 'change'), [], 'not a kind it is for: nothing to insert');
});

test('where the text lands: a comment reaches the customer when saved; a Workspace composer has one box for both; a portal has its own Send', () => {
  const reply = featureById('reply-draft');
  const classic = insertTargets(reply, { record: { kind: 'incident' }, page: { surface: 'classic' } })[0];
  assert.equal(classic.where, 'Goes below what is in Additional comments, which the customer sees.');
  assert.equal(classic.next, 'Then press Save. Saving sends the comment to the customer.');
  assert.equal(classic.caution, '');
  const ws = insertTargets(reply, { record: { kind: 'incident' }, page: { surface: 'workspace' } })[0];
  assert.equal(ws.next, 'Then press Post.');
  assert.match(ws.caution, /one box can hold both comments and work notes: check it is set to Additional comments/);
  const notesWs = insertTargets(featureById('handoff-brief'), { record: { kind: 'incident' }, page: { surface: 'workspace' } })[0];
  assert.match(notesWs.caution, /set to Work notes/);
  assert.equal(notesWs.where, 'Goes below what is in Work notes, which only your colleagues see.');
  assert.equal(insertTargets(reply, { record: { kind: 'incident' }, page: { surface: 'portal' } })[0].next, "Then press the page's own Send.");
  assert.match(insertTargets(reply, { record: { kind: 'catalog_task' }, page: { surface: 'classic' } })[0].caution, /requester does not see comments on a catalog task/);
  assert.equal(describeInsert({ field: 'text', fieldLabel: 'Article body', mode: 'append', table: 'kb_knowledge' }).next, 'Then save the article.');
  assert.equal(describeInsert({ field: 'short_description', mode: 'append' }).where.startsWith('Replaces'), true, 'a one-line field always replaces');
});

test('the note after an insert names the next step for that box (and the old note stands for the old callers)', () => {
  assert.equal(insertedNote({ ok: true, method: 'gform' }), 'Inserted into the form. Review it, then save the record yourself.');
  assert.equal(insertedNote({ ok: true, method: 'gform' }, { field: 'comments', surface: 'classic' }), 'Inserted. Review it. Then press Save. Saving sends the comment to the customer.');
  assert.equal(insertedNote({ ok: true, method: 'dom', label: 'Work notes' }, { field: 'work_notes', surface: 'workspace' }), 'Inserted. Review it. Then press Post. It went into the box labelled "Work notes".');
});

test('primaryOf: copy for notes to self, insert where the text belongs on the form; nothing to insert is copy', () => {
  assert.equal(primaryOf(featureById('record-summary'), 'incident'), 'copy');
  assert.equal(primaryOf(featureById('reply-draft'), 'incident'), 'insert');
  assert.equal(primaryOf(featureById('sentiment-risk'), 'incident'), 'copy');
  assert.equal(primaryOf(featureById('resolution-notes'), 'change'), 'copy', 'no box on this kind');
  assert.equal(primaryOf(featureById('resolution-notes')), 'insert');
  assert.deepEqual(choicesOf(featureById('reply-draft'), '1. a\n2. b'), [], 'only a feature with choices splits');
  assert.deepEqual(choicesOf({ choices: () => { throw new Error('x'); } }, 'x'), []);
});

// ---- no second copy ---------------------------------------------------------------------------------------------------------

test('append, Try again, Insert again: the first answer is swapped for the second, what the agent typed stays', async () => {
  forgetInserts();
  const form = classicForm({ values: { work_notes: 'Called the user.' } });
  const target = insertTargets(featureById('handoff-brief'), { record: { kind: 'incident' }, page: form.page })[0];
  const first = await insertText({ page: form.page, target, text: 'Brief one', source, send: form.send });
  assert.equal(first.status, 'inserted');
  assert.equal(form.state.work_notes, 'Called the user.\n\nBrief one');
  const second = await insertText({ page: form.page, target, text: 'Brief two', source, send: form.send });
  assert.equal(second.status, 'inserted');
  assert.equal(form.state.work_notes, 'Called the user.\n\nBrief two', 'no duplicate');
  // the agent edited the inserted text: it is theirs now, the next one goes below it
  form.state.work_notes = 'Called the user.\n\nBrief two, and I checked the VPN.';
  await insertText({ page: form.page, target, text: 'Brief three', source, send: form.send });
  assert.equal(form.state.work_notes, 'Called the user.\n\nBrief two, and I checked the VPN.\n\nBrief three');
});

test('resolution notes replace what is in the box by default; the person can choose Add below', async () => {
  forgetInserts();
  const form = classicForm({ values: { close_notes: 'fixed' } });
  const target = insertTargets(featureById('resolution-notes'), { record: { kind: 'incident' }, page: form.page })[0];
  await insertText({ page: form.page, target, text: 'Cause: x\nFix: y', source, send: form.send });
  assert.equal(form.state.close_notes, 'Cause: x\nFix: y');
  await insertText({ page: form.page, target, text: 'Cause: x\nFix: z', source, send: form.send });
  assert.equal(form.state.close_notes, 'Cause: x\nFix: z', 'Try again + Insert: replaced, not doubled');
  await insertText({ page: form.page, target, text: 'Checked with the customer.', mode: 'append', source, send: form.send });
  assert.equal(form.state.close_notes, 'Cause: x\nFix: z\n\nChecked with the customer.');
});

test('the earlier text only travels with an append, never with replace, an HTML field or a one-line field', () => {
  assert.equal(buildFillMessage({ field: 'work_notes', value: 'b', mode: 'append', expect: null, replacing: 'a' }).replacing, 'a');
  assert.equal(buildFillMessage({ field: 'work_notes', value: 'b', mode: 'replace', expect: null, replacing: 'a' }).replacing, undefined);
  assert.equal(buildFillMessage({ field: 'text', value: 'b', mode: 'append', expect: null, replacing: 'a' }).replacing, undefined);
  assert.equal(buildFillMessage({ field: 'short_description', value: 'b', mode: 'append', expect: null, replacing: 'a' }).replacing, undefined);
  assert.equal(buildFillMessage({ field: 'work_notes', value: 'b', expect: null, replacing: 'x'.repeat(20001) }).replacing, undefined);
});

test('every old guard still holds through insertText: another record is refused and nothing is written', async () => {
  forgetInserts();
  const form = classicForm({ sysId: B });
  const target = insertTargets(featureById('reply-draft'), { record: { kind: 'incident' }, page: form.page })[0];
  const out = await insertText({ page: form.page, target, text: 'Hello', source, send: form.send });
  assert.equal(out.status, 'failed');
  assert.equal(out.answer.reason, 'wrong-record');
  assert.equal(form.state.comments, undefined);
  // a field not on the list is refused by the content script, whatever the panel asks
  const bad = await insertText({ page: form.page, target: { ...target, field: 'assigned_to', spec: { field: 'assigned_to' } }, text: 'x', source: null, send: form.send });
  assert.equal(bad.status, 'failed');
  // an article insert on a ticket form is not even sent
  const article = insertTargets(featureById('kb-article-draft'), { record: { kind: 'incident' }, page: form.page })[0];
  const sent = [];
  assert.equal((await insertText({ page: form.page, target: article, text: 'Title', source, send: async (t, m) => sent.push(m) })).status, 'blocked');
  assert.deepEqual(sent, []);
});

// ---- the check before the click ---------------------------------------------------------------------------------------------

test('the content script asks the form which boxes it has: on the form, read-only, missing; another record is no answer', async () => {
  const form = classicForm({ fields: ['comments', 'work_notes', 'close_notes'], editable: ['comments', 'work_notes'] });
  const out = await checkInsertTargets({ fields: [{ name: 'comments' }, { name: 'close_notes' }, { name: 'fix_notes' }], expect: { table: 'incident', sysId: A } }, { callPage: form.callPage });
  assert.deepEqual(out, { form: 'gform', match: true, fields: { comments: { state: 'editable' }, close_notes: { state: 'read-only' }, fix_notes: { state: 'missing' } } });
  const other = await checkInsertTargets({ fields: [{ name: 'comments' }], expect: { table: 'incident', sysId: B } }, { callPage: form.callPage });
  assert.equal(other.match, false);
  assert.deepEqual(other.fields, { comments: { state: 'unknown' } });
});

test('the check refuses odd questions and treats the page\'s answer as data', async () => {
  const call = async () => ({ form: 'workspace', fields: { comments: 'missing', work_notes: 'banana' }, boxes: { comments: 'Additional comments‮ (Customer visible)' } });
  await assert.rejects(checkInsertTargets({ fields: [{ name: 'assigned_to' }] }, { callPage: call }), /cannot be filled/);
  await assert.rejects(checkInsertTargets({ fields: [] }, { callPage: call }), /Say which fields/);
  await assert.rejects(checkInsertTargets({ fields: Array.from({ length: 9 }, () => ({ name: 'comments' })) }, { callPage: call }), /Say which fields/);
  await assert.rejects(checkInsertTargets({ fields: [{ name: 'comments' }], expect: { table: 'x y' } }, { callPage: call }), /not a valid record/);
  const out = await checkInsertTargets({ fields: [{ name: 'comments' }, { name: 'work_notes' }] }, { callPage: call });
  // a page searched by its boxes cannot know a field is missing; an unknown state is unknown; a label is cleaned
  assert.deepEqual(out.fields, { comments: { state: 'unknown', label: 'Additional comments (Customer visible)' }, work_notes: { state: 'unknown' } });
  assert.deepEqual((await checkInsertTargets({ fields: [{ name: 'comments' }] }, { callPage: async () => null })).fields, { comments: { state: 'unknown' } });
  assert.deepEqual((await checkInsertTargets({ fields: [{ name: 'comments' }] }, { callPage: async () => { throw new Error('x'); } })).form, 'none');
});

test('readFieldStates and applyFieldStates: an impossible insert says why before the click; anything unknown blocks nothing', async () => {
  const targets = insertTargets(featureById('resolution-notes'), { record: { kind: 'incident' }, page: { surface: 'classic' } });
  const asked = [];
  const read = async (tabId, op, args) => {
    asked.push([tabId, op, args]);
    return { form: 'gform', match: true, fields: { close_notes: { state: 'read-only' } } };
  };
  const states = await readFieldStates({ tabId: 4 }, targets, read, { table: 'incident', sysId: A });
  assert.deepEqual(asked, [[4, 'insertTargets', { fields: [{ name: 'close_notes', label: 'Resolution notes' }], expect: { table: 'incident', sysId: A } }]]);
  const applied = applyFieldStates(targets, states);
  assert.match(applied[0].blocked, /Resolution notes cannot be changed on this form right now\. Use Copy\./);
  const out = await insertText({ page: { tabId: 4 }, target: applied[0], text: 'x', send: async () => assert.fail('nothing is sent') });
  assert.equal(out.status, 'blocked');
  assert.match(applyFieldStates(targets, { known: true, fields: { close_notes: { state: 'missing' } } })[0].blocked, /not on this form/);
  // fail-soft: an old content script without the op, a page that does not answer, another record
  for (const r of [async () => { throw new Error('Unknown operation'); }, async () => null, async () => ({ match: false })]) {
    const s = await readFieldStates({ tabId: 4 }, targets, r);
    assert.equal(s.known, false);
    assert.equal(applyFieldStates(targets, s)[0].blocked, '');
  }
  // the box a Workspace insert will use is named in advance
  assert.equal(applyFieldStates(targets, { known: true, fields: { close_notes: { state: 'editable', label: 'Resolution notes' } } })[0].box, 'Resolution notes');
});

test('the bridge answers the check without writing anything', async () => {
  const form = classicForm({ values: { comments: 'typed' }, fields: ['comments', 'work_notes'], editable: ['comments'] });
  const out = await form.callPage('getFieldStates', [['comments', 'work_notes', 'close_notes', 'password', 'Bad Name'], []]);
  assert.deepEqual(out, { form: 'gform', table: 'incident', sysId: A, fields: { comments: 'editable', work_notes: 'read-only', close_notes: 'missing' } });
  assert.deepEqual(form.state, { comments: 'typed' });
});

// ---- the review: resolution notes come from the work notes ------------------------------------------------------------------

test('words shared with a work note are a hint in resolution notes, and still stop a customer comment', () => {
  const internalTexts = ['Restarted the VPN concentrator in the London data centre after the certificate expired'];
  const text = 'Fix: Restarted the VPN concentrator in the London data centre after the certificate expired.';
  const close = reviewInsert('close_notes', text, { internalTexts });
  assert.equal(close.serious.length, 0);
  assert.ok(close.hints.some((h) => h.kind === 'INTERNAL_NOTE' && h.advice === OVERLAP_HINT));
  const comment = reviewInsert('comments', text, { internalTexts });
  assert.ok(comment.serious.some((f) => f.kind === 'INTERNAL_NOTE'));
  // a password is still serious in resolution notes
  assert.ok(reviewInsert('close_notes', 'Fix: reset, the password is Hunter2!x9', { internalTexts }).serious.length > 0);
});

// ---- the packs of the old record tabs, however the action is started ---------------------------------------------------------

const readerFor = (answers) => {
  const calls = [];
  const read = async (op, args) => {
    calls.push([op, args]);
    const a = answers[op];
    if (a instanceof Error) throw a;
    return typeof a === 'function' ? a(args) : a;
  };
  return { read, calls };
};

test('request-explain on a catalog task reads the requested item it belongs to; on the item itself nothing more is read', async () => {
  const f = featureById('request-explain');
  const task = { table: 'sc_task', sysId: A, kind: 'catalog_task', fields: {}, people: [], journal: [], related: {}, access: [] };
  const item = { table: 'sc_req_item', sysId: B, kind: 'requested_item', fields: { number: 'RITM1' }, people: [], journal: [], related: {}, access: [] };
  const { read, calls } = readerFor({ requestTarget: { table: 'sc_req_item', sysId: B }, pack: item });
  assert.equal(await f.enrich(task, { read, allowSensitive: false }), item);
  assert.deepEqual(calls.map((c) => c[0]), ['requestTarget', 'pack']);
  assert.deepEqual(calls[1][1], { table: 'sc_req_item', sysId: B, feature: 'request-explain', allowSensitive: false });
  const again = readerFor({});
  assert.equal(await f.enrich(item, { read: again.read }), item);
  assert.deepEqual(again.calls, []);
  const denied = readerFor({ requestTarget: { table: 'sc_req_item', sysId: B }, pack: new Error('403') });
  const own = await f.enrich(task, { read: denied.read });
  assert.equal(own.table, 'sc_task');
  assert.match(own.access.at(-1).note, /could not be read/);
});

test('resolution-improve works from the notes typed now; with no notes at all it says so and sends nothing', async () => {
  const f = featureById('resolution-improve');
  const pack = { table: 'incident', sysId: A, kind: 'incident', fields: { close_notes: 'saved notes' }, people: [], journal: [], related: {}, access: [] };
  const typed = readerFor({ resolutionFacts: { form: { close_notes: 'typed just now' } } });
  assert.equal((await f.enrich(pack, typed)).fields.close_notes, 'typed just now');
  const none = readerFor({ resolutionFacts: { form: null } });
  assert.equal((await f.enrich(pack, none)).fields.close_notes, 'saved notes');
  const empty = readerFor({ resolutionFacts: new Error('no page') });
  await assert.rejects(f.enrich({ ...pack, fields: {} }, empty), (e) => e.message === NO_NOTES_TO_IMPROVE);
});

test('fulfilment-checklist on a catalog task adds the answers of its requested item, once', async () => {
  const f = featureById('fulfilment-checklist');
  const task = { table: 'sc_task', sysId: A, kind: 'catalog_task', fields: { description: 'x' }, people: [], journal: [], related: {}, access: [] };
  const item = { table: 'sc_req_item', sysId: B, fields: { cat_item: 'Laptop' }, people: [], related: { variables: [{ question: 'Model', value: 'X1' }] }, access: [] };
  const { read } = readerFor({ requestTarget: { table: 'sc_req_item', sysId: B }, pack: item });
  const merged = await f.enrich(task, { read, allowSensitive: false });
  assert.deepEqual(merged.related.variables, [{ question: 'Model', value: 'X1' }]);
  assert.equal(merged.fields.cat_item, 'Laptop');
  const twice = readerFor({});
  assert.equal(await f.enrich(merged, twice), merged, 'already has the answers: nothing more is read');
  assert.deepEqual(twice.calls, []);
});
