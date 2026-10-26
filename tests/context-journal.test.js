import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS } from '../src/context/allowlists.js';
import { applyAuthorNames, orderChronological, parseJournalString, readJournal } from '../src/context/journal.js';
import { v } from './fixtures/sn-fakeDeps.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { COMMENTS_STRING, INCIDENT_ID, WORK_NOTES_STRING, journalRows } from './fixtures/sn-incident.js';

const recordText = { comments: COMMENTS_STRING, work_notes: WORK_NOTES_STRING };

// ---- parseJournalString ------------------------------------------------------------------------------

test('parses ServiceNow\'s journal string into entries, newest first as written', () => {
  const entries = parseJournalString(COMMENTS_STRING);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    when: '2026-10-26 10:20:41',
    by: 'Beth Anglin',
    type: 'comment',
    text: 'Hi Abel, I can see the gateway logs. Could you send me your client version? Call me on 555-0199 if easier.',
  });
  assert.equal(entries[1].by, 'Abel Tuter');
  assert.equal(entries[1].text, 'It dropped again at 09:50. Same as yesterday.');
});

test('the label decides the type when the column is not known', () => {
  const entries = parseJournalString(['2026-10-26 10:25:00 - Beth Anglin (Work notes)', 'internal', '', '2026-10-26 10:20:41 - Beth Anglin (Additional comments)', 'public'].join('\n'));
  assert.deepEqual(entries.map((e) => e.type), ['work_note', 'comment']);
});

test('the column decides the type when it is known, whatever the label says (translated labels)', () => {
  const entries = parseJournalString('2026-10-26 10:25:00 - Beth Anglin (Arbeitsnotizen)\nText', { type: 'work_note' });
  assert.equal(entries[0].type, 'work_note');
  const other = parseJournalString('2026-10-26 10:25:00 - Beth Anglin (Zusatzliche Kommentare)\nText', { type: 'comment' });
  assert.equal(other[0].type, 'comment');
});

test('an unrecognised label without a known column counts as a work note, never as a customer comment', () => {
  const [entry] = parseJournalString('2026-10-26 10:25:00 - Beth Anglin (Notizen)\nText');
  assert.equal(entry.type, 'work_note');
});

test('multi-line entries keep their lines, blank lines inside an entry stay, and dashes in the text are not headers', () => {
  const text = [
    '2026-10-26 11:00:00 - Beth Anglin (Work notes)',
    'Steps taken:',
    '- restarted the service',
    '- cleared the cache',
    '',
    'Result - still failing.',
    '',
    '2026-10-26 10:00:00 - Abel Tuter (Work notes)',
    'First note',
  ].join('\n');
  const entries = parseJournalString(text, { type: 'work_note' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'Steps taken:\n- restarted the service\n- cleared the cache\n\nResult - still failing.');
  assert.equal(entries[1].text, 'First note');
});

test('names with hyphens, accents, apostrophes and dashes are read whole', () => {
  const names = ["María-José O'Neil", 'Jean-Luc Picard', 'Zoë Müller-Schmidt', 'Smith - Jones', 'Renée (Contractor) Dubois', 'Łukasz Żółć'];
  const text = names.map((n, i) => `2026-10-2${i} 09:00:00 - ${n} (Additional comments)\nbody ${i}`).join('\n\n');
  const entries = parseJournalString(text, { type: 'comment' });
  assert.deepEqual(entries.map((e) => e.by), names);
  assert.deepEqual(entries.map((e) => e.text), names.map((_, i) => `body ${i}`));
});

test('a missing separator or missing label is tolerated at the start of a block', () => {
  const noDash = parseJournalString('2026-10-26 09:14:03 Beth Anglin (Work notes)\nrestarted', { type: 'work_note' });
  assert.deepEqual(noDash, [{ when: '2026-10-26 09:14:03', by: 'Beth Anglin', type: 'work_note', text: 'restarted' }]);

  const noLabel = parseJournalString('2026-10-26 09:14:03 - Beth Anglin\nrestarted', { type: 'comment' });
  assert.deepEqual(noLabel, [{ when: '2026-10-26 09:14:03', by: 'Beth Anglin', type: 'comment', text: 'restarted' }]);

  const em = parseJournalString('2026-10-26 09:14:03 – Beth Anglin (Work notes)\nrestarted', { type: 'work_note' });
  assert.equal(em[0].by, 'Beth Anglin');
});

test('a line that merely looks like a header inside a note is text, not a new entry', () => {
  const text = [
    '2026-10-26 11:00:00 - Beth Anglin (Work notes)',
    'Log excerpt:',
    '2026-10-26 10:59:00 - svc-gateway reset the session (twice)',
    '2026-10-26 10:59:30 - sentence that ends with a stop.',
    'done',
  ].join('\n');
  const entries = parseJournalString(text, { type: 'work_note' });
  assert.equal(entries.length, 1);
  assert.match(entries[0].text, /svc-gateway reset the session \(twice\)/);
  assert.match(entries[0].text, /^Log excerpt:/);
});

test('text with no header at all becomes one entry without time or author', () => {
  const entries = parseJournalString('Just a note someone typed into the column.', { type: 'comment' });
  assert.deepEqual(entries, [{ when: '', by: '', type: 'comment', text: 'Just a note someone typed into the column.' }]);
});

test('text before the first header is kept as its own entry', () => {
  const entries = parseJournalString('Imported note\n\n2026-10-26 09:00:00 - Beth Anglin (Work notes)\nLater', { type: 'work_note' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, 'Imported note');
  assert.equal(entries[0].by, '');
  assert.equal(entries[1].by, 'Beth Anglin');
});

test('empty, whitespace and non-string input give no entries', () => {
  for (const input of ['', '   \n  \n', null, undefined]) assert.deepEqual(parseJournalString(input), []);
});

test('Windows line endings and rich text are handled', () => {
  const entries = parseJournalString('2026-10-26 09:00:00 - Beth Anglin (Additional comments)\r\n[code]<p>Hello <b>Abel</b></p><p>Bye</p>[/code]\r\n', { type: 'comment' });
  assert.equal(entries[0].text, 'Hello Abel\n\nBye');
});

test('other date formats are read and kept as written; year-first is normalised', () => {
  const sample = (stamp) => parseJournalString(`${stamp} - Beth Anglin (Work notes)\nx`, { type: 'work_note' })[0];
  assert.equal(sample('26/10/2026 09:14:03').when, '26/10/2026 09:14:03');
  assert.equal(sample('10-26-2026 09:14:03').when, '10-26-2026 09:14:03');
  assert.equal(sample('26.10.2026 09:14').when, '26.10.2026 09:14');
  assert.equal(sample('10/26/2026 9:14:03 AM').when, '10/26/2026 9:14:03 AM');
  assert.equal(sample('Oct 26, 2026 9:14:03 AM').when, 'Oct 26, 2026 9:14:03 AM');
  assert.equal(sample('26-Oct-2026 09:14:03').when, '26-Oct-2026 09:14:03');
  assert.equal(sample('2026-10-26 9:14').when, '2026-10-26 09:14:00');
  assert.equal(sample('2026/10/26 09:14:03').when, '2026-10-26 09:14:03');
  assert.equal(sample('26/10/2026 09:14:03').by, 'Beth Anglin');
});

test('a very long entry is capped', () => {
  const [entry] = parseJournalString(`2026-10-26 09:00:00 - Beth Anglin (Work notes)\n${'word '.repeat(1000)}`, { type: 'work_note' });
  assert.ok(entry.text.length <= LIMITS.journalEntry);
  assert.ok(entry.text.endsWith('…'));
});

test('orderChronological interleaves by time when every time can be read, else keeps each column in its own order', () => {
  const a = [{ when: '2026-10-26 10:00:00', text: 'a-new' }, { when: '2026-10-26 08:00:00', text: 'a-old' }];
  const b = [{ when: '2026-10-26 09:00:00', text: 'b' }];
  assert.deepEqual(orderChronological([a, b]).map((e) => e.text), ['a-old', 'b', 'a-new']);

  const c = [{ when: '26/10/2026 10:00:00', text: 'c-new' }, { when: '26/10/2026 08:00:00', text: 'c-old' }];
  const d = [{ when: '26/10/2026 09:00:00', text: 'd' }];
  assert.deepEqual(orderChronological([c, d]).map((e) => e.text), ['c-old', 'c-new', 'd']);
  assert.deepEqual(orderChronological([]), []);
});

// ---- readJournal --------------------------------------------------------------------------------------

const incidentTables = () => ({ sys_journal_field: journalRows(), incident: [] });
const ask = (deps, text = recordText, options = {}) => readJournal({ table: 'incident', sysId: INCIDENT_ID, recordText: text }, deps, options);

test('strategy 1: sys_journal_field, oldest first, plain text, logins kept for the author lookup', async () => {
  const deps = fakeDeps(incidentTables());
  const { entries, access, loginNames } = await ask(deps);
  assert.deepEqual(entries.map((e) => [e.when, e.by, e.type]), [
    ['2026-10-26 07:58:03', 'abel.tuter', 'comment'],
    ['2026-10-26 08:20:41', 'beth.anglin', 'comment'],
    ['2026-10-26 08:25:00', 'beth.anglin', 'work_note'],
  ]);
  assert.equal(entries[1].text, 'Hi Abel, I can see the gateway logs.\n\nCould you send me your client version? Call me on 555-0199 if easier.');
  assert.equal(entries[2].text, "Gateway EU-2 shows 14 session resets. Checking certificate expiry. Customer's manager is María-José O'Neil.");
  assert.deepEqual(access.map((a) => [a.source, a.status, a.strategy]), [['journal', 'ok', 'sys_journal_field']]);
  assert.deepEqual(loginNames.sort(), ['abel.tuter', 'beth.anglin']);
  // the query: this record, comments and work notes only, newest first
  const call = deps.callsTo('sys_journal_field')[0];
  assert.equal(call.query, `name=incident^element_id=${INCIDENT_ID}^elementINcomments,work_notes^ORDERBYDESCsys_created_on`);
  assert.deepEqual(call.fields, ['element', 'value', 'sys_created_on', 'sys_created_by', 'element_id']);
  assert.equal(call.options.limit, LIMITS.journalEntries + 1);
});

test('other records\' entries are never used', async () => {
  const { entries } = await ask(fakeDeps(incidentTables()));
  assert.ok(!entries.some((e) => e.text === 'not this record'));
});

test('strategy 2: the journal table is denied, so the record\'s own strings are parsed', async () => {
  const deps = fakeDeps(incidentTables(), { denied: ['sys_journal_field'] });
  const { entries, access, loginNames } = await ask(deps);
  assert.deepEqual(entries.map((e) => [e.when, e.by, e.type]), [
    ['2026-10-26 09:58:03', 'Abel Tuter', 'comment'],
    ['2026-10-26 10:20:41', 'Beth Anglin', 'comment'],
    ['2026-10-26 10:25:00', 'Beth Anglin', 'work_note'],
  ]);
  assert.equal(access[0].status, 'ok');
  assert.equal(access[0].strategy, 'record-fields');
  assert.match(access[0].note, /could not be read by your user/);
  assert.match(access[0].note, /time zone/);
  assert.deepEqual(loginNames, [], 'display names are already names');
});

test('strategy 2 also applies when the journal table answers 200 with zero rows but the record has notes', async () => {
  for (const behaviour of [{ hidden: ['sys_journal_field'] }, {}]) {
    const tables = behaviour.hidden ? incidentTables() : { sys_journal_field: [], incident: [] };
    const { entries, access } = await ask(fakeDeps(tables, behaviour));
    assert.equal(entries.length, 3);
    assert.equal(access[0].strategy, 'record-fields');
    assert.match(access[0].note, /showed no entries/);
  }
});

test('each column falls back on its own: comments from the table, work notes from the string', async () => {
  const rows = journalRows().filter((r) => r.element === 'comments');
  const { entries, access } = await ask(fakeDeps({ sys_journal_field: rows, incident: [] }));
  assert.equal(entries.length, 3);
  assert.equal(access[0].strategy, 'mixed');
  assert.equal(entries.filter((e) => e.type === 'work_note').length, 1);
});

test('nothing anywhere: a table the user can see is a fact, a table they cannot is not', async () => {
  const empty = { comments: '', work_notes: '' };
  // visible: the instance has journal rows (of other records), this record has none
  const visible = await ask(fakeDeps({ sys_journal_field: journalRows().filter((r) => r.element_id !== INCIDENT_ID), incident: [] }), empty);
  assert.deepEqual(visible.entries, []);
  assert.equal(visible.access[0].status, 'empty');
  assert.equal(visible.access[0].note, 'This record has no notes or comments.');
  // hidden: no rows at all, filtered or not
  const hidden = await ask(fakeDeps({ sys_journal_field: [], incident: [] }), empty);
  assert.equal(hidden.access[0].status, 'empty-or-hidden');
  assert.match(hidden.access[0].note, /does not prove there are none/);
});

test('denied and nothing in the record\'s own fields is ambiguous; denied and fields not read is just denied', async () => {
  const deps = () => fakeDeps(incidentTables(), { denied: ['sys_journal_field'] });
  const ambiguous = await ask(deps(), { comments: '', work_notes: '' });
  assert.equal(ambiguous.access[0].status, 'empty-or-hidden');
  assert.match(ambiguous.access[0].note, /cannot read the journal table/);
  const denied = await ask(deps(), null);
  assert.equal(denied.access[0].status, 'denied');
});

test('rows that belong to other records mean the filter was ignored: they are not used', async () => {
  // An instance that answers every query with the same rows, whatever the condition.
  const stubborn = {
    queryTable: async () => [{ element: 'comments', value: 'leak', sys_created_on: '2026-10-26 08:00:00', sys_created_by: 'x', element_id: 'ffffffffffffffffffffffffffffffff' }],
  };
  const empty = await ask(stubborn, { comments: '', work_notes: '' });
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.access[0].status, 'error');
  assert.match(empty.access[0].note, /other records/);

  // With the record's own strings available they are used instead, and the note says why.
  const fallback = await ask(stubborn, recordText);
  assert.equal(fallback.entries.length, 3);
  assert.ok(!fallback.entries.some((e) => e.text === 'leak'));
  assert.match(fallback.access[0].note, /answered with other records/);
});

test('only the newest 30 entries are kept, shown oldest to newest, with a note', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    name: 'incident',
    element_id: INCIDENT_ID,
    element: i % 2 ? 'comments' : 'work_notes',
    sys_created_on: `2026-10-${String(1 + Math.floor(i / 10)).padStart(2, '0')} 0${i % 10}:00:00`,
    sys_created_by: 'beth.anglin',
    value: `entry ${i}`,
  }));
  const { entries, access } = await ask(fakeDeps({ sys_journal_field: rows, incident: [] }));
  assert.equal(entries.length, LIMITS.journalEntries);
  assert.equal(entries[entries.length - 1].text, 'entry 44');
  assert.equal(entries[0].text, 'entry 15');
  assert.ok(entries.every((e, i) => i === 0 || entries[i - 1].when <= e.when));
  assert.match(access[0].note, /newest 30/);
});

test('every entry is capped and stripped', async () => {
  const rows = [{ name: 'incident', element_id: INCIDENT_ID, element: 'comments', sys_created_on: '2026-10-26 08:00:00', sys_created_by: 'x', value: `<p>${'a'.repeat(5000)}</p>` }];
  const { entries } = await ask(fakeDeps({ sys_journal_field: rows, incident: [] }));
  assert.equal(entries[0].text.length, LIMITS.journalEntry);
});

test('a lost session is not hidden as a note', async () => {
  await assert.rejects(ask(fakeDeps(incidentTables(), { expired: ['sys_journal_field'] })), (err) => err.code === 'SESSION_EXPIRED');
});

test('other read errors become a note', async () => {
  const { entries, access } = await ask(fakeDeps(incidentTables(), { errors: { sys_journal_field: new Error('Table API query on "sys_journal_field" failed (500)') } }), null);
  assert.deepEqual(entries, []);
  assert.equal(access[0].status, 'error');
});

test('applyAuthorNames swaps logins for names and leaves the rest', () => {
  const out = applyAuthorNames(
    [{ by: 'beth.anglin', text: 'a' }, { by: 'Someone Else', text: 'b' }],
    new Map([['beth.anglin', 'Beth Anglin']])
  );
  assert.deepEqual(out.map((e) => e.by), ['Beth Anglin', 'Someone Else']);
});

test('the shared v() helper builds display_value=all cells', () => {
  assert.deepEqual(v('2', 'In Progress'), { value: '2', display_value: 'In Progress' });
});
