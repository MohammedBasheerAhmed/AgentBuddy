import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckView, codeFieldOf, currentCloseCode, openFindings, readyLine } from '../src/checks/resolutionCheck.js';
import { closeCodeFact, closeCodeVote, closeWellLine, repeatOfCaller } from '../src/insights/closeCode.js';
import { closeSections } from '../src/sidepanel/ticket/assist/answers/prepareClose.js';
import { setLanguage } from '../src/i18n/index.js';

// The "Close well" row (round 4, docs/round4.md): its line ("Not yet: the caller has not confirmed · close code suggested"), the two
// facts it adds (the close code most solved look-alikes used, an earlier ticket of the same caller about the same issue) and the
// sections of a "Prepare to close" answer. No AI anywhere here. Pure.

const NOW = Date.parse('2026-11-06T12:00:00Z');
const hit = (number, close_code, close_code_value = '') => ({ number, close_code, close_code_value, table: 'incident', sysId: 'a'.repeat(32) });
const hits = [
  hit('INC0010001', 'Solved (Work Around)', 'workaround'),
  hit('INC0010002', 'Solved (Work Around)', 'workaround'),
  hit('INC0010003', 'Solved (Work Around)', 'workaround'),
  hit('INC0010004', 'Solved (Work Around)', 'workaround'),
  hit('INC0010005', 'Solved (Permanently)', 'permanent'),
];
const incident = (fields = {}, extra = {}) => ({
  table: 'incident',
  kind: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010100',
  fields: { number: 'INC0010100', state: 'In Progress', close_notes: 'Cleared the VPN profile cache and reinstalled the client; the user confirmed it works.', close_code: '', ...fields },
  people: [{ role: 'caller', name: 'Abel Tuter', sysId: 'c'.repeat(32) }],
  journal: [],
  related: { childTasks: [] },
  access: [],
  ...extra,
});
const facts = { form: null, links: { problem: { status: 'yes' }, knowledge: { status: 'yes' } } };

test('readyLine: "Not yet:" and what needs a look first, with how many more; else the old two lines; nothing without a view', () => {
  const view = buildCheckView(incident(), facts, { now: NOW });
  // no close code (the only warning on this ticket)
  assert.equal(readyLine(view), 'Not yet: no close code chosen');
  const more = buildCheckView(incident({ close_notes: '' }), facts, { now: NOW });
  assert.equal(readyLine(more), 'Not yet: the resolution notes need work, and 1 more');
  const ready = buildCheckView(incident({ close_code: 'Solved (Work Around)' }), facts, { now: NOW });
  assert.match(readyLine(ready), /^(Looks ready|Nothing wrong, a few notes)$/);
  assert.equal(readyLine(null), '');
  assert.equal(readyLine({}), '');
  // a finding with no short phrase is named by its title
  assert.equal(readyLine({ checks: [{ id: 'made-up', status: 'warn', title: 'Something else' }] }), 'Not yet: Something else');
  assert.equal(readyLine({ checks: [{ id: 'customer', status: 'warn', title: 'x' }] }), 'Not yet: the caller has not confirmed');
});

test('openFindings: what to look at and the notes, never what is fine; the code field and the current code by kind', () => {
  const view = buildCheckView(incident({ close_notes: '' }), facts, { now: NOW });
  assert.ok(openFindings(view).length >= 2);
  assert.ok(openFindings(view).every((c) => c.status === 'warn' || c.status === 'info'));
  assert.deepEqual(openFindings(null), []);
  assert.equal(codeFieldOf('incident'), 'close_code');
  assert.equal(codeFieldOf('case'), 'resolution_code');
  assert.equal(codeFieldOf('requested_item'), '');
  // what is picked on the form (not saved yet) wins over the saved code; a Workspace's boxes never give the code
  const pack = incident({ close_code: 'Solved (Permanently)' });
  assert.equal(currentCloseCode(pack, {}), 'Solved (Permanently)');
  assert.equal(currentCloseCode(pack, { form: { close_code: 'workaround' } }), 'workaround');
  assert.equal(currentCloseCode(pack, { form: { close_code: 'workaround', close_notes: 'x' }, formSource: 'boxes' }), 'Solved (Permanently)');
  assert.equal(currentCloseCode({ kind: 'requested_item', fields: {} }, {}), '');
});

test('the close code fact: the suggestion with its count; quietly, when the ticket has it already; nothing without a vote', () => {
  const vote = closeCodeVote(hits);
  assert.equal(vote.value, 'workaround', 'the stored value, what a choice field takes');
  assert.equal(vote.label, 'Solved (Work Around)');
  assert.equal(closeCodeFact(vote), 'Suggested: Solved (Work Around). 4 of 5 look-alikes used it.');
  const same = closeCodeVote(hits, { current: 'workaround' });
  assert.equal(same.matchesCurrent, true);
  assert.equal(closeCodeFact(same), 'The ticket already has Solved (Work Around), as 4 of 5 look-alikes did.');
  assert.equal(closeCodeFact(closeCodeVote([hit('INC1', 'A'), hit('INC2', 'B')])), '', 'a tie says nothing');
  assert.equal(closeCodeFact(closeCodeVote([])), '');
  assert.equal(closeCodeFact(null), '');
});

test('repeatOfCaller: the newest of the caller\'s tickets that reads like this one, with what is needed to open it', () => {
  const ticket = { short_description: 'VPN drops every hour', category: 'Network' };
  const history = {
    items: [
      { table: 'incident', sysId: 'd'.repeat(32), number: 'INC0010010', short_description: 'VPN drops when on hotel wifi', category: 'Network' },
      { table: 'incident', sysId: 'e'.repeat(32), number: 'INC0010019', short_description: 'VPN keeps dropping every hour', category: 'Network' },
      { table: 'incident', sysId: 'f'.repeat(32), number: 'INC0010020', short_description: 'Printer jams on floor 3', category: 'Hardware' },
    ],
  };
  const found = repeatOfCaller(ticket, history);
  assert.equal(found.number, 'INC0010019', 'the newest that matches (the list is oldest first)');
  assert.equal(found.table, 'incident');
  assert.equal(found.sysId, 'e'.repeat(32));
  assert.equal(found.line, 'INC0010019 from the same caller is the same issue: link it, or raise a problem if it comes back.');
  // one shared word is enough only with the same category or CI
  assert.equal(repeatOfCaller({ short_description: 'Outlook crashes', category: 'Email' }, { items: [{ number: 'INC0010030', short_description: 'Outlook is slow', category: 'Software' }] }), null);
  assert.equal(repeatOfCaller({ short_description: 'Outlook crashes', category: 'Email' }, { items: [{ number: 'INC0010030', short_description: 'Outlook is slow', category: 'email' }] })?.number, 'INC0010030');
  // nothing to compare, nothing read, a row that is not a record: no repeat; a row that cannot be linked is named without a link
  assert.equal(repeatOfCaller({}, history), null);
  assert.equal(repeatOfCaller(ticket, null), null);
  assert.equal(repeatOfCaller(ticket, { items: [{ number: '<b>x</b>', short_description: 'VPN drops every hour' }] }), null);
  const unlinked = repeatOfCaller(ticket, { items: [{ number: 'INC0010040', short_description: 'VPN drops every hour', sysId: 'not-an-id', table: 'incident' }] });
  assert.deepEqual([unlinked.number, unlinked.table, unlinked.sysId], ['INC0010040', '', '']);
});

test('the row\'s line: where the ticket stands, then the close code, else the repeat (one fact at most)', () => {
  const vote = closeCodeVote(hits);
  const repeat = { number: 'INC0010019' };
  assert.equal(closeWellLine({ ready: 'Not yet: the caller has not confirmed', vote, repeat }), 'Not yet: the caller has not confirmed · close code suggested');
  assert.equal(closeWellLine({ ready: 'Looks ready', vote: closeCodeVote(hits, { current: 'Solved (Work Around)' }), repeat }), 'Looks ready · looks like a repeat');
  assert.equal(closeWellLine({ ready: 'Looks ready', vote: null, repeat: null }), 'Looks ready');
  assert.equal(closeWellLine({ ready: '', vote }), 'close code suggested');
  assert.equal(closeWellLine(), '');
});

test('Prepare to close\'s sections: each says where it came from; only the notes are the AI\'s; the code and the repeat only when there is one', () => {
  const view = buildCheckView(incident({ close_notes: '' }), facts, { now: NOW });
  const vote = closeCodeVote(hits);
  const repeat = repeatOfCaller({ short_description: 'VPN drops every hour', category: 'Network' }, { items: [{ table: 'incident', sysId: 'e'.repeat(32), number: 'INC0010019', short_description: 'VPN drops every hour', category: 'Network' }] });
  const all = closeSections({ view, vote, repeat, notesLabel: 'Resolution notes', notes: 'Cause: disk full.' });
  assert.deepEqual(all.map((s) => s.id), ['ready', 'code', 'notes', 'repeat']);
  assert.deepEqual(all.map((s) => s.source), ['From ServiceNow', 'From look-alikes', 'Written by your AI', "From the caller's tickets"]);
  assert.deepEqual(all.map((s) => s.ai), [false, false, true, false]);
  assert.deepEqual(all.map((s) => s.title), ['Ready to resolve?', 'Close code', 'Resolution notes', 'Repeat issue']);
  assert.ok(all[0].items.length >= 2 && all[0].items.every((i) => i.status !== 'ok'));
  assert.equal(all[1].text, 'Suggested: Solved (Work Around). 4 of 5 look-alikes used it.');
  assert.equal(all[2].text, 'Cause: disk full.');
  assert.deepEqual(all[3].link, { table: 'incident', sysId: 'e'.repeat(32), number: 'INC0010019' });
  const bare = closeSections({ view: buildCheckView(incident({ close_code: 'Solved (Work Around)' }), facts, { now: NOW }), vote: null, repeat: null, notesLabel: 'Close notes' });
  assert.deepEqual(bare.map((s) => s.id), ['ready', 'notes'], 'no vote, no repeat: nothing said about them');
  assert.equal(bare[1].title, 'Close notes');
  assert.equal(closeSections({ view: null, loading: true })[0].text, 'Looking…');
  assert.match(closeSections({ view: null })[0].text, /could not be read/);
});

test('the row and the sections in Arabic', () => {
  try {
    setLanguage('ar');
    const vote = closeCodeVote(hits);
    assert.match(closeCodeFact(vote), /المقترح/);
    assert.match(closeWellLine({ ready: readyLine({ checks: [{ id: 'customer', status: 'warn', title: 'x' }] }), vote }), /^ليس بعد: .+ · رمز إغلاق مقترح$/);
    assert.deepEqual(closeSections({ view: null }).map((s) => s.source), ['من ServiceNow', 'كتبه الذكاء الاصطناعي لديك']);
  } finally {
    setLanguage('en');
  }
});
