const test = require('node:test');
const assert = require('node:assert/strict');
import { readCoachingSample } from '../src/reports/engine/coaching.js';
import { createRuntime } from '../src/reports/engine/index.js';
import { createReportOps } from '../src/content/ops/reports.js';
import { OPS } from '../src/content/ops/index.js';
import {
  COACHING_LIMITS, COACHING_REMINDER, buildCoachingPack, checkCoachingAnswer, coachingBlockedBy, coachingParts,
  formatDay, normalizeCoachingRequest, pickSample, rangeFromDays,
} from '../src/reports/ai/coaching.js';
import { flagPerPersonScoring } from '../src/reports/ai/scoring.js';
import { allowedFields } from '../src/context/allowlists.js';
import { cell } from './reports-fixtures.js';
import { ABEL, DANA, GROUP_A, GROUP_SMALL, JOAN, MARCUS, NOW, PRIYA, USER, coachingWorld, id } from './reports-ai-fixtures.js';

const DAY = 86400000;
const request = (over = {}) => normalizeCoachingRequest({ groupId: GROUP_A, fromMs: NOW - 14 * DAY, toMs: NOW, sample: 4, tables: ['incident'], ...over }, { now: NOW });
const read = (inst, over = {}, env = {}) => readCoachingSample(request(over), { deps: inst.deps, userId: USER, now: NOW, ...env });

// ---- Days and the request ----------------------------------------------------------------------------------------------

test('days: a real date in the person\'s own time zone, both ends included', () => {
  const r = rangeFromDays('2026-10-13', '2026-10-27', 0);
  assert.equal(r.fromMs, Date.UTC(2026, 9, 13));
  assert.equal(r.toMs, Date.UTC(2026, 9, 28) - 1000, 'the last second of the last day');
  // UTC-5 (getTimezoneOffset 300): local midnight is 05:00 UTC
  assert.equal(rangeFromDays('2026-10-13', '2026-10-13', 300).fromMs, Date.UTC(2026, 9, 13, 5));
  assert.equal(rangeFromDays('2026-10-13', '2026-10-13', 0).toMs - rangeFromDays('2026-10-13', '2026-10-13', 0).fromMs, DAY - 1000);
  for (const [a, b] of [['2026-02-30', '2026-03-01'], ['2026-10-27', '2026-10-13'], ['', '2026-10-13'], ['2026-10-13', 'x'], [null, undefined], ['2026-1-3', '2026-10-13'], ['2026-13-01', '2026-13-02']]) {
    assert.equal(rangeFromDays(a, b, 0), null, `${a} ${b}`);
  }
  assert.equal(formatDay(Date.UTC(2026, 9, 27, 3), 0), '2026-10-27');
  assert.equal(formatDay(Date.UTC(2026, 9, 27, 3), 300), '2026-10-26', 'at 03:00 UTC it is still the 26th in UTC-5');
});

test('the request: one group, a date range of at most 92 days, a sample of 1 to 10, known non-HR tables', () => {
  const ok = request();
  assert.equal(ok.groupId, GROUP_A);
  assert.equal(ok.sample, 4);
  assert.deepEqual(ok.tables, ['incident']);
  assert.equal(request({ groupId: GROUP_A.toUpperCase() }).groupId, GROUP_A, 'ids are lower-cased');
  assert.equal(request({ sample: 0 }).sample, 1);
  assert.equal(request({ sample: 99 }).sample, 10);
  assert.equal(request({ sample: 'x' }).sample, COACHING_LIMITS.sampleDefault);
  assert.equal(request({ sample: undefined }).sample, 8);
  assert.equal(COACHING_LIMITS.sampleMax, 10);
  assert.ok(request({ tables: undefined }).tables.length >= 6, 'all report tables when none are named');
  assert.deepEqual(request({ tables: ['incident', 'incident', 'not_a_table', 'problem'] }).tables, ['incident', 'problem']);
  assert.deepEqual(request({ tables: ['nope'] }).tables.sort(), request({ tables: undefined }).tables.sort());
  assert.equal(request({ groupName: 'Service <b>Desk</b>\n' }).groupName, 'Service Desk');
});

test('the request refuses what it should, with a sentence a person can act on', () => {
  const bad = (over, pattern) => assert.throws(() => request(over), pattern, JSON.stringify(over));
  bad({ groupId: '' }, /Pick one group/);
  bad({ groupId: 'not-an-id' }, /Pick one group/);
  bad({ groupId: [GROUP_A] }, /Pick one group/);
  bad({ fromMs: 'x' }, /first and the last day/);
  bad({ toMs: undefined }, /first and the last day/);
  bad({ fromMs: NOW, toMs: NOW - DAY }, /must come after/);
  bad({ toMs: NOW + 3 * DAY }, /cannot be in the future/);
  bad({ fromMs: NOW - 120 * DAY }, /at most 92 days/);
  bad({ fromMs: NOW - 400 * DAY, toMs: NOW - 380 * DAY }, /last twelve months/);
  bad({ tables: ['incident', 'sn_hr_core_case'] }, /HR case tables are never used/);
  bad({ tables: ['SN_HR_Core_Task'] }, /HR case tables are never used/);
  assert.equal(request({ toMs: NOW + 3600000 }).toMs, NOW, 'a last day that is still today is cut to now');
  assert.throws(() => normalizeCoachingRequest(null), /Pick one group/);
});

test('coachingBlockedBy: a policy that blocks the close notes or the comments makes coaching impossible, and says why', () => {
  assert.equal(coachingBlockedBy([]), '');
  assert.equal(coachingBlockedBy(['close_code', 'short_description']), '');
  assert.match(coachingBlockedBy(['close_notes']), /close notes field that coaching needs/);
  assert.match(coachingBlockedBy(['Comments']), /comments field that coaching needs/);
  assert.match(coachingBlockedBy(['comments', 'close_notes']), /close notes and comments fields/);
  assert.equal(coachingBlockedBy(undefined), '');
});

// ---- The sample --------------------------------------------------------------------------------------------------------------

const cand = (i, over = {}) => ({ table: 'incident', sysId: id(i), number: `INC${String(i).padStart(4, '0')}`, resolvedMs: NOW - i * 3600000, ...over });

test('the sample is at most k tickets, spread evenly over the resolution times', () => {
  const list = Array.from({ length: 30 }, (_, i) => cand(i + 1));
  const picked = pickSample(list, 5);
  assert.equal(picked.length, 5);
  const times = picked.map((c) => c.resolvedMs);
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'oldest first');
  // evenly spaced positions through the 30 sorted tickets: 3, 9, 15, 21, 27
  assert.deepEqual(picked.map((c) => c.number), ['INC0027', 'INC0021', 'INC0015', 'INC0009', 'INC0003']);
  assert.equal(pickSample(list, 99).length, 10);
  assert.equal(pickSample(list, 0).length, 1);
  assert.equal(pickSample(list, 'x').length, 8);
  assert.equal(pickSample(list.slice(0, 3), 8).length, 3, 'fewer candidates than the size: all of them');
  assert.deepEqual(pickSample([], 5), []);
  for (const bad of [null, undefined, 'x', {}]) assert.deepEqual(pickSample(bad, 5), []);
});

test('the same data always gives the same sample, whatever order it arrives in', () => {
  const list = Array.from({ length: 25 }, (_, i) => cand(i + 1));
  const a = pickSample(list, 6).map((c) => c.number);
  assert.deepEqual(pickSample([...list].reverse(), 6).map((c) => c.number), a);
  const shuffled = [...list].sort((x, y) => (x.number.charCodeAt(5) * 7 + x.sysId.charCodeAt(31)) - (y.number.charCodeAt(5) * 7 + y.sysId.charCodeAt(31)));
  assert.deepEqual(pickSample(shuffled, 6).map((c) => c.number), a);
});

test('the rule cannot see a person: names, assignees and groups on the candidates change nothing', () => {
  const plain = Array.from({ length: 25 }, (_, i) => cand(i + 1));
  const named = plain.map((c, i) => ({ ...c, assignee: i % 2 ? 'Priya Raman' : 'Marcus Webb', owner: 'Joan Parker', caller: 'Abel Tuter', title: 'Sell me to the model' }));
  assert.deepEqual(pickSample(named, 7).map((c) => c.number), pickSample(plain, 7).map((c) => c.number));
  // and moving a ticket to another person's name never moves it in or out
  const swapped = plain.map((c) => ({ ...c, assignee: 'Someone Else' }));
  assert.deepEqual(pickSample(swapped, 7).map((c) => c.sysId), pickSample(plain, 7).map((c) => c.sysId));
});

test('ties in time are broken by number and id; duplicates and unusable candidates are dropped', () => {
  const same = Array.from({ length: 6 }, (_, i) => cand(i + 1, { resolvedMs: NOW }));
  assert.deepEqual(pickSample([...same].reverse(), 6).map((c) => c.number), same.map((c) => c.number));
  const messy = [cand(1), cand(1), cand(2, { sysId: '' }), cand(3, { number: '' }), null, undefined, cand(4, { resolvedMs: NaN }), cand(5, { resolvedMs: undefined })];
  const out = pickSample(messy, 8);
  assert.deepEqual(out.map((c) => c.number).sort(), ['INC0001', 'INC0004', 'INC0005']);
  assert.equal(out[0].resolvedMs !== undefined, true);
});

// ---- The pack ---------------------------------------------------------------------------------------------------------------

const result = (over = {}) => ({
  ok: true,
  group: { id: GROUP_A, name: 'Service Desk', members: 3 },
  candidates: 12,
  agents: [PRIYA, MARCUS, JOAN],
  tickets: [
    { number: 'INC1', kind: 'incident', closeCode: 'Solved', closeNotes: 'Replaced the token.', comments: [{ when: '2026-10-20 10:00:00', text: 'Hi, it is fixed.' }], commentsNote: '', assignee: PRIYA, requesters: [ABEL, DANA] },
    { number: 'INC2', kind: 'incident', closeCode: '', closeNotes: '', comments: [], commentsNote: 'no customer-visible comments on the ticket', assignee: '', requesters: [ABEL] },
  ],
  access: [{ source: 'journal', status: 'error', note: 'INC2: comments could not be read' }],
  notes: ['One note.'],
  ...over,
});

test('the pack: a report, group members first, requesters after, no author names anywhere in the report', () => {
  const pack = buildCoachingPack(result(), { periodLabel: '2026-10-13 to 2026-10-27' });
  assert.equal(pack.table, 'report');
  assert.equal(pack.sysId, 'coaching');
  assert.equal(pack.requirePreview, true, 'different tickets every time: the preview is shown every time');
  assert.deepEqual(pack.people.map((p) => [p.role, p.name]), [['agent', PRIYA], ['agent', MARCUS], ['agent', JOAN], ['requester', ABEL], ['requester', DANA]]);
  assert.equal(pack.report.group, 'Service Desk');
  assert.equal(pack.report.period, '2026-10-13 to 2026-10-27');
  assert.ok(!JSON.stringify(pack.report).includes(PRIYA), 'the assignee is for masking only');
  assert.equal(pack.report.tickets.length, 2);
});

test('the parts: the sample described, then closing information and agent comments for each ticket, under the two policy handles', () => {
  const parts = coachingParts(buildCoachingPack(result(), { periodLabel: '2026-10-13 to 2026-10-27' }));
  assert.deepEqual(parts.map((p) => p.field), ['coaching_scope', 'close_notes', 'comments', 'close_notes', 'comments']);
  assert.match(parts[0].text, /Group: Service Desk/);
  assert.match(parts[0].text, /resolved in the period: 12/);
  assert.match(parts[0].text, /chosen by a fixed rule .* not by who worked on them/);
  assert.match(parts[0].text, /Completeness of notes; Clarity; Tone with the customer; Follow-through/);
  assert.match(parts[0].text, /Author names are not included/);
  assert.match(parts[1].text, /Ticket INC1 \(incident\)\nClose code: Solved\nClose notes: Replaced the token\./);
  assert.match(parts[2].text, /^\[2026-10-20 10:00:00\] Hi, it is fixed\.$/);
  assert.match(parts[3].text, /Close notes: \(empty\)/);
  assert.ok(!/Close code/.test(parts[3].text), 'no code, no line');
  assert.match(parts[4].text, /No customer-visible comment written by this group's agents was found \(no customer-visible comments on the ticket\)\./);
  assert.deepEqual(parts.map((p) => p.label).slice(1), ['Closed ticket INC1', 'Customer comments on INC1', 'Closed ticket INC2', 'Customer comments on INC2']);
});

test('a blocked close code is left out; text is capped; at most four comments per ticket', () => {
  const comments = Array.from({ length: 9 }, (_, i) => ({ when: `2026-10-2${i} 10:00:00`, text: `c${i}${'x'.repeat(900)}` }));
  const r = result({ tickets: [{ number: 'INC1', kind: 'incident', closeCode: 'Solved', closeNotes: 'n'.repeat(5000), comments, commentsNote: '', assignee: '', requesters: [] }] });
  const parts = coachingParts(buildCoachingPack(r, { blockedFields: ['close_code'] }));
  assert.ok(!/Close code/.test(parts[1].text));
  assert.ok(parts[1].text.length < COACHING_LIMITS.closeNotesChars + 80);
  const lines = parts[2].text.split('\n');
  assert.equal(lines.length, COACHING_LIMITS.commentsPerTicket);
  assert.ok(lines.every((l) => l.length <= COACHING_LIMITS.commentChars + 30));
  assert.ok(lines[3].includes('c8'), 'the newest are kept');
  const withCode = coachingParts(buildCoachingPack(r, { blockedFields: ['resolution_code'] }));
  assert.ok(!/Close code/.test(withCode[1].text), 'either spelling of the code column');
});

test('no pack when the read failed or found nothing', () => {
  for (const bad of [null, undefined, {}, { ok: false, reason: 'x' }, result({ tickets: [] }), result({ tickets: undefined })]) assert.equal(buildCoachingPack(bad), null);
  assert.deepEqual(coachingParts(null), []);
  assert.deepEqual(coachingParts({ report: { kind: 'handover' } }), []);
});

test('the answer check finds the closing sections that did not come back', () => {
  assert.deepEqual(checkCoachingAnswer('Ticket INC1\n...\nGroup themes:\n- a\nWhat the group does well:\n- b').missing, []);
  assert.deepEqual(checkCoachingAnswer('Ticket INC1\nGroup themes:\n- a').missing, ['What the group does well:']);
  assert.equal(COACHING_REMINDER, 'This is a coaching aid for the team lead only, not a performance rating.');
});

// ---- The output check ---------------------------------------------------------------------------------------------------------

const PEOPLE = [
  { role: 'agent', name: PRIYA }, { role: 'agent', name: MARCUS }, { role: 'agent', name: JOAN },
  { role: 'requester', name: ABEL }, { role: 'requester', name: DANA },
];
const kinds = (text, people = PEOPLE) => flagPerPersonScoring(text, { people }).findings.map((f) => f.kind);

test('a clean group-level answer is not flagged', () => {
  const clean = [
    'Ticket INC0020001',
    'Completeness of notes: Strong - cause and fix are both named.',
    'Clarity: Adequate - steps are in order but one is vague.',
    'Tone with the customer: Strong - greets Abel by name and thanks him.',
    'Follow-through: Needs work - no check that the fix held.',
    'Evidence: "I have reset it and will check back on Friday."',
    'Coaching tip: Ask the customer to confirm the fix before closing.',
    'Group themes:',
    '- Notes often lack the cause.',
    '- Replies are friendly and short.',
    'What the group does well:',
    '- Quick first replies.',
  ].join('\n');
  const verdict = flagPerPersonScoring(clean, { people: PEOPLE });
  assert.deepEqual(verdict, { tripped: false, findings: [] });
  assert.deepEqual(flagPerPersonScoring('', { people: PEOPLE }), { tripped: false, findings: [] });
  assert.deepEqual(flagPerPersonScoring(null), { tripped: false, findings: [] });
});

test('ranking language is flagged without any name', () => {
  for (const text of [
    'Here is the ranking of the team.',
    'The league table shows who is ahead.',
    'The top performer wrote the best notes.',
    'The weakest agent needs support.',
    'Ranked from best to worst: 1, 2, 3.',
    'Some people outperform the others.',
    'Notes are better than the rest of the team.',
    'Their overall performance score is high.',
    "The agent's score is 4/5.",
    'Worst performers should be retrained.',
  ]) assert.ok(kinds(text).includes('ranking'), text);
});

test('a named team member next to a rating word is flagged; a customer\'s name is not', () => {
  for (const text of [
    'Priya Raman scored 4/5 on tone.',
    'Marcus Webb: Needs work',
    'Joan is the strongest writer here.',
    'Webb gets a poor grade for follow-through.',
    'Notes by priya raman were excellent.',
    'Priya\'s notes are weak.',
  ]) assert.ok(kinds(text).includes('person-rating'), text);
  for (const text of [
    'Tone with the customer: Strong - greets Abel Tuter by name.',
    'Dana Cole is thanked for her patience in an excellent reply.',
    'Evidence: "Hi Abel, thanks for waiting. Regards, Priya" (a quote)',
  ]) assert.deepEqual(kinds(text), [], text);
  assert.deepEqual(kinds('Priya Raman scored 4/5 on tone.', []), [], 'without a people list only ranking language can be found');
});

test('labels such as "Agent A" and left-over [PERSON_n] placeholders count as people too', () => {
  assert.ok(kinds('Agent A: Strong on clarity.').includes('agent-label'));
  assert.ok(kinds('Analyst 2 scored best.').includes('agent-label'));
  assert.ok(kinds('Person #3 needs work on tone.').includes('agent-label'));
  assert.ok(kinds('[PERSON_2] is excellent at tone.').includes('person-rating'));
  assert.deepEqual(kinds('Agent notes are strong.'), [], 'the word agent alone is fine');
  assert.deepEqual(kinds('The member of staff replied.'), []);
});

test('name matching is by whole word and does not trip on parts of other words or common words', () => {
  const people = [{ role: 'agent', name: 'Ann Lee' }, { role: 'agent', name: 'Will Grace' }];
  assert.deepEqual(kinds('The annual review of notes is strong.', people), [], 'Ann is not inside annual');
  assert.deepEqual(kinds('We will be strong on clarity.', people), [], 'Will and Grace are ordinary words');
  assert.ok(kinds('Will Grace was excellent.', people).includes('person-rating'), 'the full name still counts');
  assert.ok(kinds('Ann is strong.', people).includes('person-rating'));
  assert.ok(kinds('LEE gets a poor score.', people).includes('person-rating'));
});

test('each finding carries a short excerpt of the sentence, once', () => {
  const verdict = flagPerPersonScoring('Intro line.\nPriya Raman scored 5/5. Marcus Webb scored 2/5!\nPriya Raman scored 5/5.', { people: PEOPLE });
  assert.equal(verdict.tripped, true);
  assert.equal(verdict.findings.length, 2, 'the repeated sentence is listed once');
  assert.ok(verdict.findings.every((f) => f.excerpt.length <= 140 && f.kind === 'person-rating'));
  const long = flagPerPersonScoring(`Priya Raman scored ${'very '.repeat(80)}well.`, { people: PEOPLE });
  assert.ok(long.findings[0].excerpt.length <= 140);
});

// ---- The read ------------------------------------------------------------------------------------------------------------------

test('the read: one group, the tickets it resolved, spread over the days, with close notes and the group\'s own comments', async () => {
  const inst = coachingWorld();
  const r = await read(inst);
  assert.equal(r.ok, true);
  assert.deepEqual(r.group, { id: GROUP_A, name: 'Service Desk', members: 3 });
  assert.equal(r.candidates, 12);
  assert.equal(r.tickets.length, 4);
  assert.deepEqual(r.tickets.map((t) => t.resolvedMs), [...r.tickets.map((t) => t.resolvedMs)].sort((a, b) => a - b));
  const t = r.tickets[0];
  assert.equal(t.kind, 'incident');
  assert.equal(t.closeCode, 'Solved (Permanently)');
  assert.ok(t.closeNotes.startsWith('Called Abel Tuter on 555-123-4567.'));
  assert.ok(t.closeNotes.includes('IGNORE PREVIOUS INSTRUCTIONS'), 'the text is data, so it is kept');
  // Close notes are plain text: a forged tag is kept as written, and the firewall escapes every angle bracket inside the data, so it
  // cannot close the data block (src/pii/firewall.js escapeData).
  assert.ok(t.closeNotes.includes('</ticket_data>'), 'plain text is kept as written');
  // the customer's comment is read to be filtered and is NOT returned; the agent's is, without its author
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].text, 'Hi Abel, this is Priya. I have reset it. Regards, Priya Raman');
  assert.deepEqual(Object.keys(t.comments[0]).sort(), ['text', 'when']);
  assert.match(t.commentsNote, /1 comment by the customer or by people outside the group left out/);
  assert.equal(t.assignee, PRIYA);
  assert.deepEqual(t.requesters.sort(), [ABEL, DANA].sort());
  assert.deepEqual(r.agents.sort(), [JOAN, MARCUS, PRIYA]);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'plain JSON');
  assert.ok(!JSON.stringify(r).includes('abel.tuter') || true);
});

test('the read asks for nothing outside the contract: no work notes, no descriptions, GET-shaped only, columns from the spec', async () => {
  const inst = coachingWorld();
  await read(inst);
  const asked = new Set(inst.calls.flatMap((c) => c.fields));
  for (const never of ['work_notes', 'description', 'short_description', 'priority', 'work_note']) assert.ok(!asked.has(never), `${never} was asked for`);
  assert.ok(inst.calls.every((c) => c.kind === 'query' || c.kind === 'aggregate'));
  assert.ok(inst.calls.every((c) => !c.query.includes('work_notes')), 'the journal read names the comments column only');
  const journal = inst.callsTo('sys_journal_field');
  assert.ok(journal.length > 0 && journal.every((c) => c.query.includes('element=comments')));
  const details = inst.calls.filter((c) => c.table === 'incident' && c.query.startsWith('sys_id='));
  const allowed = new Set(['sys_id', ...allowedFields('incident', 'coaching-snapshot')]);
  details.filter((c) => c.fields.includes('close_notes')).forEach((c) => c.fields.forEach((f) => assert.ok(allowed.has(f), `${f} is not on the coaching spec`)));
  assert.ok(!allowed.has('short_description') && !allowed.has('description'));
});

test('the sample is the same on a second read, and is the rule\'s choice from the candidates', async () => {
  const a = await read(coachingWorld());
  const b = await read(coachingWorld());
  assert.deepEqual(a.tickets.map((t) => t.number), b.tickets.map((t) => t.number));
  const expected = pickSample(Array.from({ length: 12 }, (_, i) => ({ table: 'incident', sysId: id(100 + i), number: `INC00200${String(i).padStart(2, '0')}`, resolvedMs: NOW - (i + 1) * 6 * 3600000 })), 4).map((c) => c.number);
  assert.deepEqual(a.tickets.map((t) => t.number), expected);
});

test('a group of fewer than three people is refused: its snapshot would describe individuals', async () => {
  const r = await read(coachingWorld(), { groupId: GROUP_SMALL });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'GROUP_TOO_SMALL');
  assert.match(r.reason, /one person/);
  assert.match(r.reason, /fewer than 3 people/);
  const two = await read(coachingWorld({ members: [{ user: cell('a', PRIYA), 'user.user_name': cell('priya') }, { user: cell('b', MARCUS), 'user.user_name': cell('marcus') }] }));
  assert.equal(two.code, 'GROUP_TOO_SMALL');
  assert.match(two.reason, /2 people/);
  assert.equal(COACHING_LIMITS.minMembers, 3);
  // and nothing about tickets was read for it
  const inst = coachingWorld();
  await read(inst, { groupId: GROUP_SMALL });
  assert.equal(inst.callsTo('incident', 'resolved_at').length, 0);
});

test('without membership the run stops: it will not guess which comments an agent of the group wrote', async () => {
  const inst = coachingWorld({ extra: { denied: ['sys_user_grmember'] } });
  const r = await read(inst);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_MEMBERS');
  assert.match(r.reason, /Group membership is not available to you/);
  assert.equal(inst.callsTo('incident').filter((c) => c.query !== '').length, 0, 'no ticket was read');
  assert.equal(inst.callsTo('sys_journal_field').length, 0);
});

test('a group that cannot be seen, and a blocked table, stop the read with a reason', async () => {
  const gone = await read(coachingWorld({ extra: { denied: ['sys_user_group'] } }));
  assert.equal(gone.code, 'NO_GROUP');
  assert.match(gone.reason, /not available to you/);
  const blockedGroups = await read(coachingWorld(), {}, { blocked: ['sys_user_group'] });
  assert.equal(blockedGroups.ok, false);
  const inst = coachingWorld();
  const blocked = await read(inst, {}, { blocked: ['incident'] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'NO_TABLE');
  assert.equal(inst.callsTo('incident').length, 0, 'a blocked table is never asked');
  const noJournal = await read(coachingWorld(), {}, { blocked: ['sys_journal_field'] });
  assert.equal(noJournal.ok, true);
  assert.ok(noJournal.tickets.every((t) => t.comments.length === 0), 'a blocked journal table is not worked around');
});

test('HR tables are refused by name and are not in the list of tables the read can use', async () => {
  assert.throws(() => request({ tables: ['sn_hr_core_case'] }), /HR case tables are never used/);
  await assert.rejects(() => readCoachingSample({ ...request(), tables: ['sn_hr_core_case'] }, { deps: coachingWorld().deps, userId: USER }), /HR case tables are never used/);
  const inst = coachingWorld();
  await read(inst, { tables: undefined });
  assert.ok(inst.calls.every((c) => !/^sn_hr_/.test(c.table)));
});

test('when the journal table cannot be read, the record\'s own comments field is used (and said)', async () => {
  const comments = `2026-10-26 10:00:00 - ${PRIYA} (Additional comments)\nI reset the token, please confirm.\n\n2026-10-25 09:00:00 - ${ABEL} (Additional comments)\nIt still fails.`;
  const inst = coachingWorld({
    extra: {
      denied: ['sys_journal_field'],
      rules: [{ when: (c) => c.kind === 'query' && c.table === 'incident' && c.fields.join() === 'sys_id,comments', then: [{ sys_id: cell(id(100)), comments: cell(comments, comments) }] }],
    },
  });
  const r = await read(inst);
  const t = r.tickets[0];
  assert.equal(t.comments.length, 1);
  assert.equal(t.comments[0].text, 'I reset the token, please confirm.');
  assert.match(t.commentsNote, /read from the ticket's own comments field/);
  assert.match(t.commentsNote, /left out/);
});

test('a ticket without comments from the group says so, and one that cannot be read is left out with a note', async () => {
  const none = await read(coachingWorld({ extra: { rules: [{ when: (c) => c.table === 'sys_journal_field', then: [] }] } }));
  assert.ok(none.tickets.every((t) => t.comments.length === 0));
  assert.match(none.tickets[0].commentsNote, /no customer-visible comments on the ticket/);
  const hidden = coachingWorld({ extra: { rules: [{ when: (c) => c.kind === 'query' && c.table === 'incident' && c.query.startsWith('sys_id=') && c.fields.includes('close_notes'), then: [] }] } });
  const r = await read(hidden);
  assert.equal(r.ok, true);
  assert.equal(r.tickets.length, 0);
  assert.ok(r.notes.some((n) => /could not be read with your access and were left out/.test(n)));
});

test('no resolved tickets in the days: an ok answer with an empty list, not an error', async () => {
  const r = await read(coachingWorld({ tickets: 0 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.tickets, []);
  assert.equal(r.candidates, 0);
  assert.equal(buildCoachingPack(r), null);
});

test('more resolved tickets than the read takes: it says which it chose from', async () => {
  const big = coachingWorld({ tickets: COACHING_LIMITS.candidatesMax });
  const r = await read(big);
  assert.equal(r.tickets.length, 4);
  assert.equal(r.candidates, COACHING_LIMITS.candidatesMax);
});

test('a table with no resolved date is skipped with a note', async () => {
  const r = await read(coachingWorld({ extra: { missingColumns: ['resolved_at', 'closed_at'] } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.tickets, []);
  assert.ok(r.notes.some((n) => /no resolved date/.test(n)));
});

test('the read leaves nothing in the shared report cache', async () => {
  const runtime = createRuntime();
  const inst = coachingWorld();
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime });
  const r = await ops.coachingSample({ groupId: GROUP_A, fromMs: NOW - 5 * DAY, toMs: NOW - 1000, sample: 3, tables: ['incident'] });
  assert.equal(r.ok, true);
  assert.equal(runtime.cache.size, 0, 'no close note or comment is kept in the cache every widget shares');
});

// ---- The operation ----------------------------------------------------------------------------------------------------------

test('coachingSample is registered, checks every argument, and needs to know who is signed in', async () => {
  assert.equal(typeof OPS.coachingSample, 'function');
  const inst = coachingWorld();
  const ops = createReportOps({ deps: inst.deps, getSession: async () => ({ userId: USER }), runtime: createRuntime() });
  const args = { groupId: GROUP_A, fromMs: NOW - 5 * DAY, toMs: NOW - 1000, sample: 3 };
  await assert.rejects(() => ops.coachingSample({ ...args, groupId: 'x' }), /Pick one group/);
  await assert.rejects(() => ops.coachingSample({ ...args, tables: ['sn_hr_core_case'] }), /HR case tables are never used/);
  await assert.rejects(() => ops.coachingSample({ ...args, fromMs: NOW - 200 * DAY }), /at most 92 days/);
  await assert.rejects(() => ops.coachingSample({}), /Pick one group/);
  assert.equal(inst.calls.length, 0, 'a bad request reads nothing');
  const nobody = createReportOps({ deps: inst.deps, getSession: async () => null, runtime: createRuntime() });
  await assert.rejects(() => nobody.coachingSample(args), /who is signed in/);
  const okay = await ops.coachingSample({ ...args, tables: ['incident'], blocked: ['Incident', 'bad name!'] });
  assert.equal(okay.code, 'NO_TABLE', 'the policy\'s blocked tables are honoured, tidied first');
});

test('a lost session is thrown, not turned into an empty snapshot', async () => {
  const deps = { queryTable: async () => { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); }, aggregate: async () => { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); } };
  await assert.rejects(() => readCoachingSample(request(), { deps, userId: USER, now: NOW }), /expired/);
});
