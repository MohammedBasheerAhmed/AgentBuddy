import test from 'node:test';
import assert from 'node:assert/strict';
import { SNIPPETS_KEY } from '../src/lib/storage.js';
import { addSnippet, exportSnippets, importSnippets, removeSnippet, updateSnippet } from '../src/snippets/store.js';
import { BUILTIN_VARIABLES, buildVariables, renderSnippet } from '../src/snippets/render.js';
import { changeSnippets, cleanLibrary, loadSnippets, saveSnippets, starterSnippets } from '../src/snippets/library.js';
import { KNOWN_VARIABLE_NAMES, describeMissing, previewSnippet, unknownVariables } from '../src/snippets/preview.js';

// A storage area like chrome.storage.local, in memory. Values are copied in and out, as the real one does.
function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data[k] = JSON.parse(JSON.stringify(v));
    },
  };
}

let n = 0;
const opts = () => ({ now: 1000, makeId: () => `id${++n}` });
const seed = (...snippets) => snippets.reduce((list, s) => addSnippet(list, s, opts()).list, []);

// A pack shaped like the real one (src/context/pack.js): SLA rows have plannedEnd, not due.
const PACK = {
  table: 'incident',
  number: 'INC0010001',
  fields: { short_description: 'VPN fails', state: 'In Progress', priority: '2 - High', assigned_to: 'Beth Anglin' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }, { role: 'assigned_to', name: 'Beth Anglin' }],
  related: { slas: [{ name: 'Resolution', stage: 'In progress', breached: 'false', percentage: '40', plannedEnd: '2026-10-28 09:00:00' }] },
};
const AGENT = { name: 'Beth Anglin' };
const NOW = Date.parse('2026-10-27T12:00:00');

// ---- Storage ---------------------------------------------------------------------------------------------------------

test('snippets live under the key the storage module names', () => {
  assert.equal(SNIPPETS_KEY, 'agentbuddy_snippets');
});

test('save then load gives the same library', async () => {
  const area = fakeArea();
  const list = seed({ title: 'Greeting', shortcut: 'hi', body: 'Hello {{caller.first_name | there}}' });
  await saveSnippets(area, list);
  assert.deepEqual(await loadSnippets(area), list);
  assert.deepEqual(Object.keys(area.data), [SNIPPETS_KEY]);
});

test('an empty or broken store loads as an empty library, never an error', async () => {
  assert.deepEqual(await loadSnippets(fakeArea()), []);
  assert.deepEqual(await loadSnippets(fakeArea({ [SNIPPETS_KEY]: 'junk' })), []);
  assert.deepEqual(await loadSnippets(fakeArea({ [SNIPPETS_KEY]: { not: 'a list' } })), []);
  assert.deepEqual(await loadSnippets({ get: async () => { throw new Error('storage gone'); } }), []);
});

test('cleanLibrary keeps well-formed snippets and drops the rest, including repeated ids', () => {
  const good = seed({ title: 'A', body: 'one' }, { title: 'B', body: 'two' });
  const mixed = [good[0], null, 'text', 5, { title: '', body: 'no title', id: 'x1' }, { title: 'No id', body: 'x' }, { ...good[1], id: 'bad id!' }, { ...good[1] }, { ...good[0], title: 'Repeat of the first id' }];
  const clean = cleanLibrary(mixed);
  assert.deepEqual(clean.map((s) => s.title), ['A', 'B']);
  assert.deepEqual(cleanLibrary(undefined), []);
});

test('nothing but snippets (titles, shortcuts, text, ids, dates) is stored', async () => {
  const area = fakeArea();
  await saveSnippets(area, [...seed({ title: 'A', body: 'one' }), { title: 'Extra', body: 'x', id: 'e1', secret: 'leak', caller: 'Abel Tuter' }]);
  const stored = JSON.stringify(area.data);
  assert.ok(!stored.includes('leak') && !stored.includes('Abel Tuter'));
  for (const s of area.data[SNIPPETS_KEY]) assert.deepEqual(Object.keys(s).sort(), ['body', 'createdAt', 'id', 'shortcut', 'title', 'updatedAt']);
});

test('changeSnippets starts from what is stored now, so two windows do not undo each other', async () => {
  const area = fakeArea();
  const a = await changeSnippets(area, (cur) => addSnippet(cur, { title: 'First', body: 'one' }, opts()));
  assert.equal(a.error, '');
  // a second window, which never saw "First", adds another
  const b = await changeSnippets(area, (cur) => addSnippet(cur, { title: 'Second', body: 'two' }, opts()));
  assert.deepEqual(b.list.map((s) => s.title), ['First', 'Second']);
  assert.deepEqual((await loadSnippets(area)).map((s) => s.title), ['First', 'Second']);
});

test('changeSnippets does not write when nothing changed or the change was refused', async () => {
  const area = fakeArea();
  let writes = 0;
  const set = area.set;
  area.set = async (o) => {
    writes += 1;
    return set(o);
  };
  const refused = await changeSnippets(area, (cur) => addSnippet(cur, { title: '', body: 'x' }, opts()));
  assert.match(refused.error, /title/i);
  assert.equal(refused.saved, false);
  const same = await changeSnippets(area, (cur) => ({ list: cur }));
  assert.equal(same.saved, false);
  assert.equal(writes, 0);
  const ok = await changeSnippets(area, (cur) => addSnippet(cur, { title: 'A', body: 'x' }, opts()));
  assert.equal(ok.saved, true);
  assert.equal(writes, 1);
});

test('edit and delete go through changeSnippets and keep the rest', async () => {
  const area = fakeArea();
  await changeSnippets(area, (cur) => addSnippet(cur, { title: 'Keep', shortcut: 'k', body: 'keep' }, opts()));
  const added = await changeSnippets(area, (cur) => addSnippet(cur, { title: 'Change me', body: 'old' }, opts()));
  const id = added.snippet.id;
  const edited = await changeSnippets(area, (cur) => updateSnippet(cur, id, { body: 'new' }, opts()));
  assert.equal(edited.list.find((s) => s.id === id).body, 'new');
  const clash = await changeSnippets(area, (cur) => updateSnippet(cur, id, { shortcut: 'k' }, opts()));
  assert.match(clash.error, /already used/);
  const removed = await changeSnippets(area, (cur) => ({ list: removeSnippet(cur, id) }));
  assert.deepEqual(removed.list.map((s) => s.title), ['Keep']);
  assert.deepEqual((await loadSnippets(area)).map((s) => s.title), ['Keep']);
});

test('export, then import into another library through the clipboard text', async () => {
  const source = seed({ title: 'Greeting', shortcut: 'hi', body: 'Hello {{caller.first_name | there}}' }, { title: 'Bye', body: 'Goodbye {{agent.first_name}}' });
  const json = exportSnippets(source);
  const area = fakeArea();
  const res = await changeSnippets(area, (cur) => {
    const r = importSnippets(json, cur, opts());
    return { list: r.list, added: r.added, skipped: r.skipped, errors: r.errors };
  });
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 0);
  assert.deepEqual((await loadSnippets(area)).map((s) => [s.title, s.shortcut, s.body]), source.map((s) => [s.title, s.shortcut, s.body]));
  // importing the same text again adds nothing and does not write
  const again = await changeSnippets(area, (cur) => {
    const r = importSnippets(json, cur, opts());
    return { list: r.list, added: r.added, skipped: r.skipped, errors: r.errors };
  });
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.equal(again.saved, false);
  // junk pasted into the box is reported, not stored
  const junk = await changeSnippets(area, (cur) => {
    const r = importSnippets('not json at all', cur, opts());
    return { list: r.list, added: r.added, skipped: r.skipped, errors: r.errors };
  });
  assert.equal(junk.added, 0);
  assert.match(junk.errors[0], /not a valid JSON/);
});

test('the starter snippets are valid, use known variables only, and fill without missing values on example data', () => {
  let list = [];
  for (const s of starterSnippets()) {
    const r = addSnippet(list, s, opts());
    assert.equal(r.error, '', s.title);
    list = r.list;
    assert.deepEqual(unknownVariables(s.body), [], s.title);
    assert.deepEqual(previewSnippet(s.body, { examples: true }).missing, [], s.title);
  }
  assert.equal(list.length, 3);
  assert.equal(new Set(list.map((s) => s.shortcut)).size, 3);
});

// ---- Preview ---------------------------------------------------------------------------------------------------------

test('previewSnippet fills from the open record and the signed-in agent', () => {
  const p = previewSnippet('Hello {{caller.first_name}}, {{number}} ({{state}}, {{priority}}) is with {{assigned_to.name}}. Regards {{agent.first_name}}. Due {{sla.due}} on {{today}}.', { pack: PACK, agent: AGENT, now: NOW });
  assert.equal(p.text, 'Hello Abel, INC0010001 (In Progress, 2 - High) is with Beth Anglin. Regards Beth. Due 2026-10-28 09:00:00 on 2026-10-27.');
  assert.deepEqual(p.missing, []);
  assert.equal(p.source, 'record');
});

test('sla.due understands the context engine\'s SLA rows (plannedEnd), and skips breached, completed and cancelled ones', () => {
  const pack = {
    related: {
      slas: [
        { name: 'A', stage: 'In progress', breached: 'true', plannedEnd: '2026-10-20 08:00:00' },
        { name: 'B', stage: 'Completed', breached: 'false', plannedEnd: '2026-10-21 08:00:00' },
        { name: 'C', stage: 'Cancelled', breached: 'false', plannedEnd: '2026-10-22 08:00:00' },
        { name: 'D', stage: 'In progress', breached: 'false', plannedEnd: '2026-10-30 08:00:00' },
        { name: 'E', stage: 'Paused', breached: 'false', plannedEnd: '2026-10-29 08:00:00' },
      ],
    },
  };
  assert.equal(buildVariables(pack, {}).sla.due, '2026-10-29 08:00:00');
  assert.equal(buildVariables({ related: { slas: [{ stage: 'In progress', breached: 'true', plannedEnd: '2026-10-20 08:00:00' }] } }, {}).sla, undefined);
  assert.equal(buildVariables({ related: { slas: [{ stage: 'In progress', plannedEnd: '' }] } }, {}).sla, undefined);
});

test('a variable with no value stays visible and is reported, never silently dropped', () => {
  const p = previewSnippet('Hi {{caller.first_name}}, your SLA is {{sla.due}}. {{caller.nickname | friend}} {{caller.firstname}}', { pack: { number: 'INC1' }, agent: {}, now: NOW });
  assert.equal(p.text, 'Hi {{caller.first_name}}, your SLA is {{sla.due}}. friend {{caller.firstname}}');
  assert.deepEqual(p.missing, ['caller.first_name', 'sla.due', 'caller.firstname']);
});

test('with no record open, the real preview reports everything missing and the example preview fills it for show', () => {
  const body = 'Hello {{caller.first_name}}, about {{number}}.';
  const real = previewSnippet(body, { pack: null, agent: null, now: NOW });
  assert.deepEqual(real.missing, ['caller.first_name', 'number']);
  assert.equal(real.text, body, 'nothing is invented');
  const shown = previewSnippet(body, { examples: true });
  assert.equal(shown.text, 'Hello Abel, about INC0010001.');
  assert.deepEqual(shown.missing, []);
  assert.equal(shown.source, 'examples');
});

test('examples cover every built-in variable', () => {
  const body = BUILTIN_VARIABLES.map((v) => `{{${v.name}}}`).join(' ');
  const p = previewSnippet(body, { examples: true });
  assert.deepEqual(p.missing, []);
  for (const v of BUILTIN_VARIABLES) assert.ok(p.text.includes(v.example), v.name);
});

test('describeMissing says why in plain words, and flags a name Agent Buddy does not know', () => {
  const lines = describeMissing(['caller.first_name', 'agent.name', 'sla.due', 'number', 'assigned_to.name', 'caller.firstname']);
  assert.equal(lines.length, 6);
  assert.match(lines[0].hint, /No caller is known/);
  assert.match(lines[1].hint, /Your name is not available/);
  assert.match(lines[2].hint, /no open service level/);
  assert.match(lines[3].hint, /no value/);
  assert.match(lines[4].hint, /not assigned/);
  assert.match(lines[5].hint, /does not know this variable/);
  assert.deepEqual(describeMissing(undefined), []);
});

test('unknownVariables finds typos and leaves known names alone', () => {
  assert.deepEqual(unknownVariables('Hi {{caller.first_name}} {{caller.firstname}} {{ numbr | n/a }} {{today}} {{caller.first_name}}'), ['caller.firstname', 'numbr']);
  assert.deepEqual(unknownVariables('no variables here'), []);
  assert.deepEqual(unknownVariables('{{ 1 + 1 }}'), [], 'not a placeholder, so not a variable');
  assert.deepEqual(KNOWN_VARIABLE_NAMES, BUILTIN_VARIABLES.map((v) => v.name));
});

test('values from the record are inserted as written: a value that looks like a placeholder is not expanded', () => {
  const p = previewSnippet('Re: {{short_description}}', { pack: { fields: { short_description: 'Fix {{caller.first_name}} now' } }, agent: {}, now: NOW });
  assert.equal(p.text, 'Re: Fix {{caller.first_name}} now');
  assert.deepEqual(p.missing, []);
  assert.equal(renderSnippet('x', {}).text, 'x');
});
