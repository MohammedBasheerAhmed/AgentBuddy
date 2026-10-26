import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  normalizeSnippet,
  addSnippet,
  updateSnippet,
  removeSnippet,
  searchSnippets,
  exportSnippets,
  importSnippets,
} from '../src/snippets/store.js';

const cp = (...codes) => String.fromCodePoint(...codes);

// Predictable ids and clock.
let counter = 0;
const opts = () => ({ now: 1000, makeId: () => `id${++counter}` });

function library() {
  let list = [];
  for (const s of [
    { title: 'Greeting', shortcut: 'hi', body: 'Hello {{caller.first_name}}, thanks for contacting us.' },
    { title: 'Request more info', shortcut: 'info', body: 'Could you share the exact error message and a screenshot?' },
    { title: 'Closing note', shortcut: '/bye', body: 'I am closing this ticket. Reply to reopen.' },
    { title: 'VPN steps', shortcut: 'vpn', body: 'Please reconnect the VPN and tell us what happens. Info needed: client version.' },
    { title: 'No shortcut one', shortcut: '', body: 'Plain body text about passwords.' },
  ]) {
    const r = addSnippet(list, s, opts());
    assert.equal(r.error, '');
    list = r.list;
  }
  return list;
}

// ---- normalizeSnippet ----------------------------------------------------------------------------------------------

test('normalizeSnippet cleans a snippet and keeps a valid id', () => {
  const { snippet, errors } = normalizeSnippet({ id: 'abc-1', title: '  My   title\n', shortcut: ' /Hello-World ', body: 'Line one\nLine two' }, opts());
  assert.deepEqual(errors, []);
  assert.deepEqual(snippet, { id: 'abc-1', title: 'My title', shortcut: '/hello-world', body: 'Line one\nLine two', createdAt: 1000, updatedAt: 1000 });
  assert.equal(normalizeSnippet({ id: 'bad id!', title: 't', body: 'b' }, opts()).snippet.id, '');
});

test('normalizeSnippet rejects bad shapes and over-long values, never cutting them', () => {
  const bad = (input) => normalizeSnippet(input, opts()).errors[0];
  assert.match(bad(null), /not a snippet/i);
  assert.match(bad('text'), /not a snippet/i);
  assert.match(bad([]), /not a snippet/i);
  assert.match(bad({ body: 'b' }), /title/i);
  assert.match(bad({ title: 't' }), /text is empty/i);
  assert.match(bad({ title: 't', body: '   ' }), /text is empty/i);
  assert.match(bad({ title: 5, body: 'b' }), /title must be text/i);
  assert.match(bad({ title: 't', body: { x: 1 } }), /text must be text/i);
  assert.match(bad({ title: 'x'.repeat(81), body: 'b' }), /title is longer than 80/i);
  assert.match(bad({ title: 't', shortcut: 'x'.repeat(31), body: 'b' }), /shortcut is longer than 30/i);
  assert.match(bad({ title: 't', body: 'x'.repeat(8001) }), /longer than 8000/i);
  assert.equal(normalizeSnippet({ title: 'x'.repeat(80), shortcut: 'y'.repeat(30), body: 'z'.repeat(8000) }, opts()).errors.length, 0);
  for (const shortcut of ["has space", "UPPER ok?", "a.b", "a@b", "caf" + cp(0xe9), "caf" + cp(0x65, 0x301), "<x>", "a,b", "a'b"]) {
    assert.match(bad({ title: 't', shortcut, body: 'b' }), /shortcut can only use/i, shortcut);
  }
  for (const shortcut of ['a', 'a-b_c/d', '/x', '0', 'UPPER']) {
    assert.equal(normalizeSnippet({ title: 't', shortcut, body: 'b' }, opts()).errors.length, 0, shortcut);
  }
});

test('normalizeSnippet strips control, bidi and zero-width characters, keeps newlines and tabs in the body', () => {
  const { snippet } = normalizeSnippet(
    { title: `Ti${cp(0x202e)}tle${cp(0x200b)}`, shortcut: `s${cp(0x200d)}c`, body: `a${cp(0)}b\tc\r\nd${cp(0x2066)}e` },
    opts()
  );
  assert.equal(snippet.title, 'Title');
  assert.equal(snippet.shortcut, 'sc');
  assert.equal(snippet.body, 'ab\tc\nde');
});

// ---- add / update / remove -----------------------------------------------------------------------------------------

test('addSnippet returns a new list and a snippet with a fresh id and dates', () => {
  const start = [];
  const r = addSnippet(start, { title: 'A', shortcut: 'a', body: 'b' }, opts());
  assert.equal(r.error, '');
  assert.equal(start.length, 0, 'the input list is not changed');
  assert.equal(r.list.length, 1);
  assert.equal(r.snippet, r.list[0]);
  assert.match(r.snippet.id, /^id\d+$/);
  assert.equal(r.snippet.createdAt, 1000);
  assert.equal(r.snippet.updatedAt, 1000);
  assert.notEqual(addSnippet(r.list, { title: 'B', body: 'b' }, opts()).snippet.id, r.snippet.id);
});

test('addSnippet ignores a caller-supplied id when it is already taken', () => {
  const list = library();
  const r = addSnippet(list, { id: list[0].id, title: 'Same id', body: 'b' }, opts());
  assert.equal(r.error, '');
  assert.notEqual(r.snippet.id, list[0].id);
});

test('addSnippet refuses a duplicate shortcut and a full library, with a message', () => {
  const list = library();
  const dup = addSnippet(list, { title: 'Other', shortcut: 'hi', body: 'x' }, opts());
  assert.match(dup.error, /"hi" is already used by "Greeting"/);
  assert.equal(dup.snippet, null);
  assert.equal(dup.list, list);
  let big = [];
  for (let i = 0; i < LIMITS.count; i++) big = addSnippet(big, { title: `T${i}`, body: `b${i}` }, opts()).list;
  assert.equal(big.length, 500);
  assert.match(addSnippet(big, { title: 'one more', body: 'x' }, opts()).error, /library is full/i);
});

test('addSnippet reports a bad snippet without changing the list', () => {
  const list = library();
  const r = addSnippet(list, { title: '', body: 'x' }, opts());
  assert.match(r.error, /title/i);
  assert.equal(r.list, list);
  assert.equal(addSnippet(undefined, { title: 'ok', body: 'x' }, opts()).list.length, 1);
});

test('updateSnippet changes only the given fields and keeps id and creation date', () => {
  const list = library();
  const target = list[1];
  const r = updateSnippet(list, target.id, { body: 'New body' }, { now: 5000 });
  assert.equal(r.error, '');
  assert.equal(r.snippet.id, target.id);
  assert.equal(r.snippet.title, target.title);
  assert.equal(r.snippet.shortcut, target.shortcut);
  assert.equal(r.snippet.body, 'New body');
  assert.equal(r.snippet.createdAt, target.createdAt);
  assert.equal(r.snippet.updatedAt, 5000);
  assert.equal(r.list[1], r.snippet);
  assert.equal(list[1], target, 'the old list is untouched');
  assert.equal(updateSnippet(list, target.id, { shortcut: '' }, opts()).snippet.shortcut, '');
  assert.equal(updateSnippet(list, target.id, { id: 'hijack', createdAt: 1 }, opts()).snippet.id, target.id);
});

test('updateSnippet checks the shortcut against the others, not itself, and validates', () => {
  const list = library();
  assert.match(updateSnippet(list, list[1].id, { shortcut: 'hi' }, opts()).error, /already used/);
  assert.equal(updateSnippet(list, list[0].id, { shortcut: 'hi', title: 'Greeting v2' }, opts()).error, '');
  assert.match(updateSnippet(list, list[0].id, { title: '' }, opts()).error, /title/i);
  assert.match(updateSnippet(list, list[0].id, { body: 'x'.repeat(9000) }, opts()).error, /longer/i);
  assert.match(updateSnippet(list, 'missing', { body: 'x' }, opts()).error, /no longer exists/);
  assert.equal(updateSnippet(list, list[0].id, null, opts()).error, '');
});

test('removeSnippet returns a new list without that snippet', () => {
  const list = library();
  const after = removeSnippet(list, list[2].id);
  assert.equal(after.length, list.length - 1);
  assert.ok(!after.some((s) => s.id === list[2].id));
  assert.equal(list.length, 5);
  assert.deepEqual(removeSnippet(list, 'nope'), list);
  assert.deepEqual(removeSnippet(undefined, 'x'), []);
});

// ---- Search --------------------------------------------------------------------------------------------------------

const titles = (list) => list.map((s) => s.title);

test('an empty query returns everything, by title', () => {
  const list = library();
  assert.deepEqual(titles(searchSnippets(list, '')), ['Closing note', 'Greeting', 'No shortcut one', 'Request more info', 'VPN steps']);
  assert.equal(searchSnippets(list, '   ').length, 5);
  assert.equal(searchSnippets(list, undefined).length, 5);
});

test('ranking: shortcut beats title beats body', () => {
  const list = library();
  // "info": the shortcut of "Request more info", the body of "VPN steps" mentions "Info"
  assert.deepEqual(titles(searchSnippets(list, 'info')), ['Request more info', 'VPN steps']);
  // "vpn": exact shortcut on "VPN steps"
  assert.equal(searchSnippets(list, 'vpn')[0].title, 'VPN steps');
  // "closing": title only; "ticket" appears in two bodies
  assert.equal(searchSnippets(list, 'closing')[0].title, 'Closing note');
  assert.equal(searchSnippets(list, 'ticket').length, 1);
  // title prefix outranks a body hit
  const mixed = [
    { id: '1', title: 'Passwords overview', shortcut: '', body: 'x' },
    { id: '2', title: 'Other', shortcut: '', body: 'Passwords are secret' },
  ];
  assert.deepEqual(searchSnippets(mixed, 'pass').map((s) => s.id), ['1', '2']);
});

test('a leading slash is optional in both the query and the shortcut', () => {
  const list = library();
  assert.equal(searchSnippets(list, '/bye')[0].title, 'Closing note');
  assert.equal(searchSnippets(list, 'bye')[0].title, 'Closing note');
  assert.equal(searchSnippets(list, '/hi')[0].title, 'Greeting');
});

test('several words must all match; matching ignores case; no match gives an empty list', () => {
  const list = library();
  assert.deepEqual(titles(searchSnippets(list, 'vpn client')), ['VPN steps']);
  assert.deepEqual(titles(searchSnippets(list, 'GREETING')), ['Greeting']);
  assert.deepEqual(searchSnippets(list, 'vpn greeting'), []);
  assert.deepEqual(searchSnippets(list, 'zzzzz'), []);
  assert.deepEqual(searchSnippets(undefined, 'x'), []);
  assert.deepEqual(searchSnippets([null, 5, { title: 'ok' }], 'ok').map((s) => s.title), ['ok']);
});

test('the limit option caps the results; regex characters in the query are plain text', () => {
  const list = library();
  assert.equal(searchSnippets(list, '', { limit: 2 }).length, 2);
  assert.deepEqual(searchSnippets(list, '.*'), []);
  assert.deepEqual(searchSnippets(list, '(((['), []);
});

// ---- Export / import -----------------------------------------------------------------------------------------------

test('exportSnippets writes JSON with titles, shortcuts and bodies only', () => {
  const list = library();
  const json = exportSnippets(list);
  const data = JSON.parse(json);
  assert.equal(data.format, 'agent-buddy-snippets');
  assert.equal(data.version, 1);
  assert.equal(data.snippets.length, 5);
  assert.deepEqual(Object.keys(data.snippets[0]), ['title', 'shortcut', 'body']);
  assert.equal(exportSnippets(list), json, 'stable output');
  assert.equal(JSON.parse(exportSnippets(undefined)).snippets.length, 0);
});

test('an export imports back into an empty library with the same content', () => {
  const list = library();
  const r = importSnippets(exportSnippets(list), [], opts());
  assert.equal(r.added, 5);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.list.map(({ title, shortcut, body }) => ({ title, shortcut, body })), list.map(({ title, shortcut, body }) => ({ title, shortcut, body })));
  assert.equal(new Set(r.list.map((s) => s.id)).size, 5);
});

test('importing the same file twice adds nothing the second time', () => {
  const json = exportSnippets(library());
  const first = importSnippets(json, [], opts());
  const second = importSnippets(json, first.list, opts());
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 5);
  assert.equal(second.list.length, 5);
  assert.ok(second.errors.length >= 1);
});

test('import dedupes by shortcut, against the library and within the file', () => {
  const existing = addSnippet([], { title: 'Mine', shortcut: 'hi', body: 'my own greeting' }, opts()).list;
  const file = JSON.stringify([
    { title: 'Theirs', shortcut: 'hi', body: 'their greeting' },
    { title: 'New A', shortcut: 'new', body: 'a' },
    { title: 'New B', shortcut: 'new', body: 'b' },
    { title: 'No shortcut 1', body: 'c' },
    { title: 'No shortcut 2', body: 'd' },
  ]);
  const r = importSnippets(file, existing, opts());
  assert.equal(r.added, 3);
  assert.equal(r.skipped, 2);
  assert.deepEqual(titles(r.list), ['Mine', 'New A', 'No shortcut 1', 'No shortcut 2']);
  assert.equal(r.list[0], existing[0], 'existing snippets are kept as they are');
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Snippet 1 \("Theirs"\).*"hi" is already used/);
  assert.equal(existing.length, 1, 'the input list is not changed');
});

test('import never throws on bad JSON or the wrong shape, and returns errors', () => {
  const existing = library();
  for (const text of ['', '   ', '{', 'not json', '[1,2', 'null', '42', '"text"', '{"snippets": 5}', '{"other": []}', undefined, null, 12, {}]) {
    const r = importSnippets(text, existing, opts());
    assert.equal(r.added, 0, String(text));
    assert.equal(r.list.length, 5);
    assert.ok(r.errors.length >= 1, String(text));
    assert.equal(typeof r.errors[0], 'string');
  }
  assert.match(importSnippets('{', [], opts()).errors[0], /not a valid JSON/i);
  assert.match(importSnippets('', [], opts()).errors[0], /empty/i);
  assert.match(importSnippets('{"x":1}', [], opts()).errors[0], /No snippets found/);
});

test('import validates every entry: wrong types, limits, bad shortcuts; good ones still come in', () => {
  const file = JSON.stringify({
    snippets: [
      { title: 'Good', shortcut: 'good', body: 'ok' },
      'just a string',
      null,
      [],
      { title: 'No body' },
      { title: 5, body: 'x' },
      { title: 'x'.repeat(81), body: 'x' },
      { title: 'Long body', body: 'x'.repeat(8001) },
      { title: 'Bad shortcut', shortcut: 'no spaces allowed', body: 'x' },
      { title: 'Long shortcut', shortcut: 'y'.repeat(31), body: 'x' },
      { title: 'Also good', body: 'fine' },
    ],
  });
  const r = importSnippets(file, [], opts());
  assert.equal(r.added, 2);
  assert.equal(r.skipped, 9);
  assert.deepEqual(titles(r.list), ['Good', 'Also good']);
  assert.equal(r.errors.length, 9);
  assert.ok(r.errors[0].startsWith('Snippet 2:'));
});

test('import ignores ids, dates and unknown fields from the file', () => {
  const file = JSON.stringify([{ id: 'evil', title: 'T', body: 'B', createdAt: 5, updatedAt: 6, html: '<script>', __proto__: { polluted: true } }]);
  const r = importSnippets(file, [{ id: 'evil', title: 'Other', shortcut: '', body: 'other', createdAt: 1, updatedAt: 1 }], opts());
  assert.equal(r.added, 1);
  assert.notEqual(r.list[1].id, 'evil');
  assert.deepEqual(Object.keys(r.list[1]).sort(), ['body', 'createdAt', 'id', 'shortcut', 'title', 'updatedAt']);
  assert.equal(r.list[1].createdAt, 1000);
  assert.equal({}.polluted, undefined);
});

test('import stops at the library limit and says so once', () => {
  const entries = Array.from({ length: 520 }, (_, i) => ({ title: `T${i}`, body: `b${i}` }));
  const r = importSnippets(JSON.stringify(entries), [], opts());
  assert.equal(r.list.length, 500);
  assert.equal(r.added, 500);
  assert.equal(r.skipped, 20);
  assert.equal(r.errors.filter((e) => /library is full/i.test(e)).length, 1);
  const again = importSnippets(JSON.stringify(entries.slice(0, 3)), r.list, opts());
  assert.equal(again.added, 0);
  assert.equal(again.list.length, 500);
});

test('import caps its error list and the number of entries read, and refuses huge files', () => {
  const bad = JSON.stringify(Array.from({ length: 100 }, () => ({ title: '' })));
  const r = importSnippets(bad, [], opts());
  assert.equal(r.skipped, 100);
  assert.equal(r.errors.length, LIMITS.importErrors + 1);
  assert.match(r.errors[r.errors.length - 1], /and 80 more/);
  const many = importSnippets(JSON.stringify(Array.from({ length: 2500 }, (_, i) => ({ title: `T${i}`, body: `b${i}` }))), [], opts());
  assert.equal(many.added, 500);
  assert.ok(many.errors.some((e) => /first 2000 entries/.test(e)));
  const huge = importSnippets(`[${' '.repeat(LIMITS.importChars + 1)}]`, [], opts());
  assert.match(huge.errors[0], /too large/i);
  assert.equal(huge.added, 0);
});

test('imported text is cleaned the same way as typed text', () => {
  const file = JSON.stringify([{ title: `T${cp(0x202e)}itle`, shortcut: 'SC', body: `a${cp(0x200b)}b` }]);
  const r = importSnippets(file, [], opts());
  assert.deepEqual([r.list[0].title, r.list[0].shortcut, r.list[0].body], ['Title', 'sc', 'ab']);
});

test('default ids are unique and well-formed when no makeId is given', () => {
  let list = [];
  for (let i = 0; i < 50; i++) list = addSnippet(list, { title: `T${i}`, body: `b${i}` }).list;
  assert.equal(new Set(list.map((s) => s.id)).size, 50);
  assert.ok(list.every((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s.id)));
  assert.ok(list.every((s) => Number.isFinite(s.createdAt) && s.createdAt > 0));
});
