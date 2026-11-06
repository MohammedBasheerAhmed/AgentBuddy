// "Understand the ticket", round 4: what changed since the agent last opened the ticket (src/insights/sinceLooked.js), what the caller
// wrote last and when "Translate" is offered with it, how both become the first facts of the row (needsNow.js) and its one line
// (focusView.js groupLine). Pure, with the clock passed in. The view: tests/understand-view.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clockText, latestCallerMessage, needsTranslation, sinceLooked } from '../src/insights/sinceLooked.js';
import { needsNow } from '../src/sidepanel/ticket/needsNow.js';
import { groupLine, insightGroups, lookCount } from '../src/sidepanel/ticket/focusView.js';
import { translateOffered } from '../src/sidepanel/ticket/useNeeds.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { setLanguage } from '../src/i18n/index.js';

const MIN = 60000;
const H = 60 * MIN;
const D = 24 * H;
// Local times (the panel speaks the agent's own clock): built with the local Date constructor, so the test holds in any time zone.
const NOW = new Date(2026, 10, 6, 11, 30).getTime();
const YESTERDAY_1705 = new Date(2026, 10, 5, 17, 5).getTime();
// A note's stored (UTC) time, as the `glance` read gives it from sys_journal_field.
const sn = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: 'b'.repeat(32) };
const note = (ms, by, text, type = 'comment') => ({ when: sn(ms), by, type, text });
const packOf = ({ journal = [], updated = NOW - 10 * MIN, people = [BETH, ABEL], access = [{ source: 'journal', status: 'ok', strategy: 'sys_journal_field' }] } = {}) => ({
  table: 'incident',
  sysId: 'c'.repeat(32),
  kind: 'incident',
  fields: { short_description: 'VPN drops', state: 'In Progress', ...(Number.isFinite(updated) ? { sys_updated_on: sn(updated) } : {}) },
  people,
  journal,
  related: { times: Number.isFinite(updated) ? { sys_updated_on: sn(updated) } : {} },
  access,
});
const change = (field, to, ms, from = '') => ({ field, from, to, atUtc: sn(ms) });
const HISTORY = (changes = []) => ({ available: true, changes, note: '', access: [] });
const NO_HISTORY = { available: false, changes: [], note: 'The field history of this record is not readable for your user.', access: [] };

test('the clock: today and yesterday by name, older days by date, in the agent\'s own time zone', () => {
  assert.equal(clockText(new Date(2026, 10, 6, 9, 14).getTime(), NOW), 'today 09:14');
  assert.equal(clockText(YESTERDAY_1705, NOW), 'yesterday 17:05');
  assert.equal(clockText(new Date(2026, 10, 3, 8, 2).getTime(), NOW), '3 Nov 08:02');
  assert.equal(clockText(new Date(2025, 11, 30, 23, 59).getTime(), NOW), '30 Dec 2025 23:59', 'another year says it');
  assert.equal(clockText(NOW + H, NOW), 'today 11:30', 'a time ahead of the clock is now, never "tomorrow"');
  assert.equal(clockText(NaN, NOW), '');
});

test('the first visit: no fact and no line (nothing to compare with)', () => {
  assert.equal(sinceLooked({ previous: null, pack: packOf(), now: NOW }), null);
  assert.equal(sinceLooked({ previous: undefined, pack: packOf(), now: NOW }), null);
  assert.equal(sinceLooked({ previous: YESTERDAY_1705, pack: null, now: NOW }), null, 'nor before the ticket was read');
  const items = needsNow({ glance: null, since: null, caller: null });
  assert.deepEqual(items, []);
});

test('nothing new: "Nothing new since you looked (yesterday 17:05)", no line under it, and the row keeps today\'s line', () => {
  const pack = packOf({ journal: [note(YESTERDAY_1705 - H, 'Abel Tuter', 'It dropped again.')], updated: YESTERDAY_1705 - H });
  const since = sinceLooked({ previous: YESTERDAY_1705, pack, audit: null, now: NOW });
  assert.equal(since.text, 'Nothing new since you looked (yesterday 17:05)');
  assert.deepEqual([since.changed, since.sub, since.line], [false, '', '']);
  // The field history read and nothing in it since: the same, even without the record's update time.
  const noTime = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ updated: NaN }), audit: HISTORY([change('state', 'In Progress', YESTERDAY_1705 - D)]), now: NOW });
  assert.equal(noTime.text, 'Nothing new since you looked (yesterday 17:05)');
  // Only the notes could be read: only that is said.
  const notesOnly = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ updated: NaN }), audit: NO_HISTORY, now: NOW });
  assert.equal(notesOnly.text, 'No new messages since you looked (yesterday 17:05)');
  // Neither: nothing is said at all.
  assert.equal(sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ updated: NaN, access: [{ source: 'journal', status: 'denied' }] }), audit: NO_HISTORY, now: NOW }), null);
  // The row: the fact first, but its line stays today's (the most urgent fact, else the first card's line).
  const sla = { kind: 'running', tone: 'warn', leftMs: 80 * MIN, text: 'SLA 1h 20m', name: 'P2 resolution' };
  const needs = needsNow({ glance: { sla }, since });
  assert.deepEqual(needs.map((n) => [n.id, n.level]), [['since', ''], ['sla', 'warn']]);
  const { groups } = insightGroups({ cards: [{ id: 'journey', title: 'Ticket journey' }], reports: { journey: { summary: 'Never reassigned' } }, needs });
  assert.equal(groups[0].line, 'The SLA is due in 1h 20m');
  assert.equal(groups[0].level, 'warn', 'the plain fact colours nothing');
});

test('the caller wrote twice: "2 messages from the caller", and the row says "Since you looked: the caller wrote twice · SLA 1h 20m"', () => {
  const journal = [
    note(YESTERDAY_1705 - H, 'Abel Tuter', 'It dropped again.'),
    note(YESTERDAY_1705 + 2 * H, 'Abel Tuter', 'Still dropping.'),
    note(NOW - 2 * H, 'Abel Tuter', 'Any news?'),
  ];
  const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal }), audit: HISTORY([]), now: NOW });
  assert.equal(since.text, 'Since you last looked (yesterday 17:05)');
  assert.equal(since.sub, '2 messages from the caller · not reassigned');
  assert.equal(since.line, 'Since you looked: the caller wrote twice');
  assert.equal(since.changed, true);
  const sla = { kind: 'running', tone: 'warn', leftMs: 80 * MIN, text: 'SLA 1h 20m', name: 'P2 resolution' };
  const needs = needsNow({ glance: { sla }, since });
  const { groups } = insightGroups({ cards: [{ id: 'journey', title: 'Ticket journey' }], needs });
  assert.equal(groups[0].id, 'understand');
  assert.equal(groups[0].line, 'Since you looked: the caller wrote twice · SLA 1h 20m');
  assert.equal(lookCount(groups), 1, 'the SLA still counts on the tab; the plain fact does not');
  // Without an urgent fact, the change alone.
  assert.equal(groupLine({ id: 'understand', cards: [] }, {}, needsNow({ since })), 'Since you looked: the caller wrote twice');
  // Once, three times; and the agents' replies and notes are told apart from the caller's.
  const once = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal: journal.slice(0, 2) }), now: NOW });
  assert.equal(once.line, 'Since you looked: the caller wrote');
  assert.equal(once.sub, '1 message from the caller');
  const more = [
    ...journal,
    note(NOW - H, 'Abel Tuter', 'Hello?'),
    note(NOW - 50 * MIN, 'Beth Anglin', 'Looking at it now.'),
    note(NOW - 40 * MIN, 'Beth Anglin', 'Gateway restarted.', 'work_note'),
    note(NOW - 30 * MIN, 'svc.integration', 'Automatic update.'),
  ];
  const busy = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal: more }), now: NOW });
  assert.equal(busy.line, 'Since you looked: the caller wrote 3 times');
  assert.equal(busy.sub, '3 messages from the caller · 1 reply to the caller · 1 new comment · 1 new work note');
});

test('the state changed: "moved to In Progress", from the field history only', () => {
  const audit = HISTORY([change('state', 'New', YESTERDAY_1705 - D), change('state', 'In Progress', NOW - 3 * H, 'New'), change('priority', '2 - High', NOW - 2 * H, '3 - Moderate')]);
  const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf(), audit, now: NOW });
  assert.equal(since.sub, 'moved to In Progress · priority now 2 - High · not reassigned');
  assert.equal(since.line, 'Since you looked: moved to In Progress');
  // The example the user approved, word for word.
  const journal = [note(NOW - 3 * H, 'Abel Tuter', 'Still down.'), note(NOW - 2 * H, 'Abel Tuter', 'Any news?')];
  const both = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal }), audit: HISTORY([change('state', 'In progress', NOW - H, 'New')]), now: NOW });
  assert.equal(`${both.text} -> ${both.sub}`, 'Since you last looked (yesterday 17:05) -> 2 messages from the caller · moved to In progress · not reassigned');
});

test('reassigned: "reassigned to Network Support", and never "not reassigned" then', () => {
  const audit = HISTORY([change('assignment_group', 'Service Desk', YESTERDAY_1705 - D), change('assignment_group', 'Network Support', NOW - H, 'Service Desk')]);
  const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf(), audit, now: NOW });
  assert.equal(since.sub, 'reassigned to Network Support');
  assert.equal(since.line, 'Since you looked: reassigned to Network Support');
  assert.ok(!/not reassigned/.test(since.sub));
  // A group the user cannot see is still a change of hands.
  const hidden = sinceLooked({ previous: YESTERDAY_1705, pack: packOf(), audit: HISTORY([change('assignment_group', '', NOW - H, 'Service Desk')]), now: NOW });
  assert.equal(hidden.sub, 'reassigned');
});

test('the field history not readable (often admin-only): the messages and the update time, never a claim about the state or the group', () => {
  const journal = [note(NOW - H, 'Abel Tuter', 'Any news?')];
  const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal }), audit: NO_HISTORY, now: NOW });
  assert.equal(since.sub, '1 message from the caller · state and group changes not readable');
  assert.ok(!/reassigned|moved to/.test(since.sub));
  assert.equal(since.history, 'unreadable');
  // The record changed and nothing else explains it: when, without guessing what.
  const updated = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ updated: new Date(2026, 10, 6, 8, 40).getTime() }), audit: NO_HISTORY, now: NOW });
  assert.equal(updated.sub, 'updated today 08:40 · state and group changes not readable');
  assert.equal(updated.line, 'Since you looked: the ticket was updated');
  // While the history is still being read: nothing about it either way.
  const reading = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal }), audit: null, now: NOW });
  assert.equal(reading.sub, '1 message from the caller');
  assert.equal(reading.history, 'unknown');
});

test('an SLA that breached since you looked is said', () => {
  const slas = [{ name: 'P2 resolution', stage: 'In progress', stageValue: 'in_progress', breached: true, plannedEndUtc: sn(NOW - H) }];
  const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf(), audit: HISTORY([]), slas, now: NOW });
  assert.equal(since.sub, 'SLA breached · not reassigned');
  const before = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ updated: YESTERDAY_1705 - H }), slas: [{ ...slas[0], plannedEndUtc: sn(YESTERDAY_1705 - H) }], now: NOW });
  assert.equal(before.changed, false, 'breached before: not new');
});

test('the caller\'s newest message: who wrote it is the caller (not an agent), when, and the words without the quoted mail', () => {
  const journal = [
    note(NOW - 5 * H, 'Abel Tuter', 'First message.'),
    note(new Date(2026, 10, 6, 9, 14).getTime(), 'Abel Tuter', 'لا أستطيع الدخول إلى البريد منذ الصباح\n\nOn Mon, 3 Nov 2026 at 10:00, Beth Anglin <beth.anglin@example.com> wrote:\n> Could you restart?'),
    note(NOW - H, 'Beth Anglin', 'Could you restart the laptop?'),
  ];
  const message = latestCallerMessage(packOf({ journal }), NOW);
  assert.equal(message.heading, 'The caller wrote, today 09:14');
  assert.equal(message.text, 'لا أستطيع الدخول إلى البريد منذ الصباح');
  assert.equal(message.script, 'arabic');
  assert.equal(latestCallerMessage(packOf({ journal: [note(NOW - H, 'Beth Anglin', 'Hello')] }), NOW), null, 'the caller wrote nothing');
  assert.equal(latestCallerMessage(packOf({ journal, people: [BETH] }), NOW), null, 'no caller on the record: nobody is "the caller"');
  assert.equal(latestCallerMessage(null, NOW), null);
  // A time that may be off by the reader's time zone (read from the record's own text, no offset known): "about".
  const local = packOf({ journal: [{ when: '2026-11-06 06:00:00', by: 'Abel Tuter', type: 'comment', text: 'Hello?' }], updated: NaN, access: [{ source: 'journal', status: 'ok', strategy: 'record-fields' }] });
  assert.match(latestCallerMessage(local, Date.UTC(2026, 10, 6, 12)).heading, /^The caller wrote, about \d+ h ago$/);
});

test('"Translate" only for a message in another script than the panel\'s language', () => {
  const arabic = 'لا أستطيع الدخول إلى البريد';
  const english = 'I cannot log in to my mailbox';
  assert.equal(needsTranslation(arabic, 'en'), true, 'an Arabic message, an English panel');
  assert.equal(needsTranslation(english, 'ar'), true, 'a Latin message, an Arabic panel');
  assert.equal(needsTranslation(english, 'en'), false);
  assert.equal(needsTranslation(arabic, 'ar'), false);
  assert.equal(needsTranslation('Привет, не работает почта', 'en'), true, 'another script altogether');
  assert.equal(needsTranslation('ok', 'en'), false, 'too short to tell');
  assert.equal(needsTranslation('INC0010001 ٤٥', 'en'), false, 'a record number is no message');
  assert.equal(needsTranslation('VPN ما زال لا يعمل منذ Outlook', 'en'), false, 'both scripts: nothing to offer');
  // The fact: the button only when it is offered AND the scripts differ.
  const caller = { heading: 'The caller wrote, today 09:14', text: arabic, translate: true };
  const [fact] = needsNow({ caller });
  assert.deepEqual([fact.id, fact.level, fact.text, fact.message, fact.translate], ['caller', '', 'The caller wrote, today 09:14', arabic, true]);
  assert.equal(needsNow({ caller: { ...caller, translate: 'yes' } })[0].translate, false, 'only a real true');
});

test('"Translate" is offered where AI Assist would offer the action, and not when the organisation turned AI or the action off', () => {
  const eff = (policy = {}) => effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'] }, policy);
  const incident = { table: 'incident', sysId: 'c'.repeat(32), kind: 'incident' };
  assert.equal(translateOffered({ record: incident, header: null, eff: eff() }), true);
  assert.equal(translateOffered({ record: incident, header: null, eff: eff({ aiEnabled: false }) }), false);
  assert.equal(translateOffered({ record: incident, header: null, eff: eff({ disabledFeatures: ['Translate-Message'] }) }), false);
  assert.equal(translateOffered({ record: { table: 'change_request', sysId: 'c'.repeat(32), kind: 'change' }, header: null, eff: eff() }), false);
  assert.equal(translateOffered({ record: { table: 'problem_task', sysId: 'c'.repeat(32), kind: 'task' }, header: null, eff: eff() }), false, 'nobody outside wrote on it');
});

test('in Arabic: the fact and the line are Arabic, the caller\'s words are not touched', () => {
  setLanguage('ar');
  try {
    const journal = [note(NOW - 3 * H, 'Abel Tuter', 'Still down.'), note(NOW - 2 * H, 'Abel Tuter', 'Any news?')];
    const since = sinceLooked({ previous: YESTERDAY_1705, pack: packOf({ journal }), audit: HISTORY([]), now: NOW });
    assert.match(since.text, /^منذ آخر مرة نظرت فيها \(أمس 17:05\)$/);
    assert.match(since.line, /كتب المتصل مرتين/);
    assert.equal(latestCallerMessage(packOf({ journal }), NOW).text, 'Any news?');
    assert.equal(needsTranslation('Any news about my mailbox?'), true, 'the panel is Arabic now');
  } finally {
    setLanguage('en');
  }
});
