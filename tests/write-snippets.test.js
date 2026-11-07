import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrgSnippet, orgSnippetList, withOrgSnippets } from '../src/snippets/org.js';
import { MAX_FILE_BYTES, fileProblem, snippetFileName, withoutBom } from '../src/snippets/file.js';
import { snippetTargetFor, snippetTargets } from '../src/snippets/targets.js';
import { exportSnippets, importSnippets, searchSnippets } from '../src/snippets/store.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { FILLABLE_FIELDS, isSingleLineField } from '../src/lib/fillable.js';

// N21 Snippets (round 3): organisation snippets from the policy, backup as a file, and the fields a snippet can go into.

const ORG = [
  { title: 'Password reset steps', body: 'Open the portal and choose Reset password.', shortcut: 'pw' },
  { title: 'Outage notice', body: 'We are aware of the outage and working on it.' },
  { title: 'Bad search word', body: 'Still a good snippet.', shortcut: 'two words' },
  { title: '', body: 'no title' },
  { title: 'Password reset steps', body: 'A repeat of the first title.' },
];

test('organisation snippets come from the policy, read-only, with stable ids; broken entries are left out', () => {
  const list = orgSnippetList(normalizePolicy({ orgSnippets: ORG }).orgSnippets);
  assert.deepEqual(list.map((s) => s.title), ['Password reset steps', 'Outage notice', 'Bad search word']);
  assert.ok(list.every((s) => s.org === true && isOrgSnippet(s) && /^org-/.test(s.id)));
  assert.equal(list[0].shortcut, 'pw');
  assert.equal(list[2].shortcut, '', 'a search word the library would refuse is dropped, not the snippet');
  assert.deepEqual(orgSnippetList(normalizePolicy({ orgSnippets: ORG }).orgSnippets).map((s) => s.id), list.map((s) => s.id), 'the same ids on every load');
  for (const bad of [undefined, null, 'x', 7, [null, 'x', { title: 7 }]]) assert.deepEqual(orgSnippetList(bad), [], JSON.stringify(bad));
});

test('one list: the organisation\'s first, then your own; search finds both, and only your own are exported', () => {
  const org = orgSnippetList(ORG);
  const own = [{ id: 'mine1', title: 'Greeting', shortcut: 'hi', body: 'Hello there, about the password', createdAt: 1, updatedAt: 1 }];
  const all = withOrgSnippets(own, org);
  assert.deepEqual(all.map((s) => s.title), ['Password reset steps', 'Outage notice', 'Bad search word', 'Greeting']);
  assert.equal(isOrgSnippet(own[0]), false);
  assert.deepEqual(searchSnippets(all, 'pw').map((s) => s.title), ['Password reset steps'], 'the search word finds it first');
  assert.deepEqual(searchSnippets(all, 'password').map((s) => s.title), ['Password reset steps', 'Greeting']);
  const exported = JSON.parse(exportSnippets(own));
  assert.deepEqual(exported.snippets.map((s) => s.title), ['Greeting']);
  assert.deepEqual(withOrgSnippets(null, null), []);
  assert.deepEqual(withOrgSnippets([org[0]], []), [], 'an organisation snippet never counts as your own');
});

test('a snippet file: only a .json file of a sane size is read; the name has the date', () => {
  assert.equal(fileProblem({ name: 'agent-buddy-snippets.json', size: 120, type: 'application/json' }), '');
  assert.equal(fileProblem({ name: 'snippets.JSON', size: 120, type: '' }), '', 'Windows often gives no type');
  assert.equal(fileProblem({ name: 'snippets.json', size: 120, type: 'text/plain' }), '');
  assert.match(fileProblem({ name: 'snippets.txt', size: 120, type: 'text/plain' }), /snippet file/);
  assert.match(fileProblem({ name: 'snippets.json', size: 120, type: 'application/x-msdownload' }), /snippet file/);
  assert.match(fileProblem({ name: 'snippets.json', size: 0, type: 'application/json' }), /empty/);
  assert.match(fileProblem({ name: 'snippets.json', size: MAX_FILE_BYTES + 1, type: 'application/json' }), /too large/);
  assert.match(fileProblem(null), /Choose a file/);
  assert.equal(snippetFileName(Date.UTC(2026, 9, 30, 12)), 'agent-buddy-snippets-2026-10-30.json');
  assert.equal(snippetFileName(NaN), 'agent-buddy-snippets-backup.json');
});

test('a file saved with a byte-order mark imports like the export it came from; nothing is overwritten', () => {
  const own = [{ id: 'mine1', title: 'Greeting', shortcut: 'hi', body: 'Hello', createdAt: 1, updatedAt: 1 }];
  const text = `${String.fromCharCode(0xfeff)}${exportSnippets([...own, { title: 'Closing', shortcut: 'bye', body: 'Bye' }])}`;
  assert.equal(withoutBom(text).charCodeAt(0), 123, 'starts with {');
  assert.equal(withoutBom('plain'), 'plain');
  const result = importSnippets(withoutBom(text), own, { now: 5, makeId: () => 'new1' });
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.match(result.errors[0], /the search word "hi" is already used|already in your library/);
  assert.deepEqual(result.list.map((s) => s.title), ['Greeting', 'Closing']);
  assert.equal(importSnippets(text, own).errors[0], 'This is not a snippet file from Agent Buddy.', 'with the mark left in, the JSON does not parse');
});

// Audit P3.10: whatever "Save to a file" writes, "Add from a file" reads back: a full library of the longest snippets, written in a
// script of three bytes a character, or full of characters JSON escapes.
test('the largest library that can be exported can be imported again, as a file and as pasted text', () => {
  const full = (char) => Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, title: `${i} ${char.repeat(80 - String(i).length - 1)}`, shortcut: `w${i}`.padEnd(30, 'x'), body: char.repeat(8000), createdAt: 1, updatedAt: 1 }));
  for (const char of ['€', '"']) {
    const text = `${String.fromCharCode(0xfeff)}${exportSnippets(full(char))}`;
    const bytes = Buffer.byteLength(text, 'utf8');
    assert.ok(bytes <= MAX_FILE_BYTES, `${bytes} bytes <= ${MAX_FILE_BYTES}`);
    assert.equal(fileProblem({ name: 'agent-buddy-snippets.json', size: bytes, type: 'application/json' }), '');
    const result = importSnippets(withoutBom(text), [], { now: 5 });
    assert.deepEqual(result.errors, []);
    assert.equal(result.added, 500);
  }
  assert.ok(MAX_FILE_BYTES < 16 * 1024 * 1024, 'still a sane upper bound');
});

const pageOf = (kind, href = 'https://acme.service-now.com/x.do') => ({ href, record: kind ? { table: kind, sysId: 'a'.repeat(32), kind } : null, newRecord: null });

test('a snippet can go into every multi-line field the form of this kind has, customer comment first on an incident', () => {
  assert.deepEqual(snippetTargets(pageOf('incident')).map((t) => t.field), ['comments', 'work_notes', 'close_notes', 'description']);
  // (audit P3.14: a problem form has Fix notes, not Resolution notes)
  assert.deepEqual(snippetTargets(pageOf('problem')).map((t) => t.field), ['work_notes', 'comments', 'description', 'cause_notes', 'workaround', 'fix_notes']);
  assert.equal(snippetTargetFor(pageOf('problem'), 'close_notes'), null, 'no Resolution notes box on a problem');
  assert.deepEqual([snippetTargetFor(pageOf('problem'), 'fix_notes').label, snippetTargetFor(pageOf('problem'), 'fix_notes').customerVisible], ['Fix notes', false]);
  assert.deepEqual(snippetTargets(pageOf('catalog_task')).map((t) => t.field)[0], 'work_notes', 'an internal task starts with work notes');
  assert.deepEqual(snippetTargets(pageOf('')).map((t) => t.field), ['comments', 'work_notes'], 'no record: the journal fields');
  assert.deepEqual(snippetTargets(pageOf('incident', 'https://acme.service-now.com/email_client.do?sysparm_table=incident&sysparm_sys_id=' + 'a'.repeat(32))).map((t) => t.field), ['body'], 'the email form: its body');
  for (const kind of ['incident', 'problem', 'change', 'case', 'requested_item', 'catalog_task', 'hr_case', 'other']) {
    for (const t of snippetTargets(pageOf(kind))) {
      assert.ok(Object.prototype.hasOwnProperty.call(FILLABLE_FIELDS, t.field), `${kind}: ${t.field} is fillable`);
      assert.equal(isSingleLineField(t.field), false, `${kind}: ${t.field} is not a one-line field`);
      assert.equal(t.mode, 'append');
      assert.ok(t.label && t.fieldLabel);
    }
  }
  const comments = snippetTargetFor(pageOf('incident'), 'comments');
  assert.equal(comments.customerVisible, true);
  assert.equal(snippetTargetFor(pageOf('incident'), 'work_notes').customerVisible, false);
  assert.equal(snippetTargetFor(pageOf('incident'), 'short_description'), null, 'a title is never offered');
});
