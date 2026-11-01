import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WAIT_DAYS, buildCheckView, isFillerNote, orderChecks, resolutionCheck, summarizeChecks, withCurrentNotes } from '../src/checks/resolutionCheck.js';
import { readContextPack } from '../src/context/pack.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';

const DAY = 86400000;
const GOOD_NOTES = 'Replaced the expired VPN gateway certificate on EU-2 and restarted the service. The user reconnected and stayed connected for an hour.';

const incident = (over = {}) => ({
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC1',
  kind: 'incident',
  fields: { number: 'INC1', state: 'In Progress', close_code: 'Solution provided', close_notes: GOOD_NOTES },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: { childTasks: [] },
  access: [],
  ...over,
});
const find = (checks, id) => checks.find((c) => c.id === id);
const comment = (by, when, text = 'ok') => ({ when, by, type: 'comment', text });

// ---- the notes ---------------------------------------------------------------------------------------------------------------

test('filler notes are recognised; real ones are not', () => {
  for (const n of ['Resolved', 'resolved.', 'Fixed', 'Done!', 'Issue resolved', 'Issue fixed, thanks', 'ticket closed as requested', 'N/A', 'ok']) assert.ok(isFillerNote(n), n);
  for (const n of ['Reset the password', 'Rebooted the router and the issue is resolved', 'Cleared the cache', '', '   ']) assert.ok(!isFillerNote(n), n);
});

test('notes: missing, filler, short and good', () => {
  const run = (close_notes) => find(resolutionCheck(incident({ fields: { state: 'In Progress', close_code: 'x', close_notes } })), 'notes');
  assert.equal(run('').status, 'warn');
  assert.match(run('').title, /No resolution notes/);
  assert.equal(run('Resolved.').status, 'warn');
  assert.match(run('Resolved.').title, /only say "resolved"/);
  assert.equal(run('Restarted the service').status, 'warn');
  assert.match(run('Restarted the service').title, /very short/);
  assert.equal(run(GOOD_NOTES).status, 'ok');
});

test('notes: a work note typed on the form is mentioned but does not count as resolution notes', () => {
  const pack = incident({ fields: { state: 'In Progress', close_code: 'x', close_notes: '' } });
  const c = find(resolutionCheck(pack, { form: { close_notes: '', work_notes: 'Fixed the cert' } }), 'notes');
  assert.equal(c.status, 'warn');
  assert.match(c.hint, /work note you have typed is separate/);
  assert.doesNotMatch(find(resolutionCheck(pack, { form: { close_notes: '', work_notes: '' } }), 'notes').hint, /work note/);
});

test('what is typed on the form wins over what is saved; a field the form does not have falls back to the saved value', () => {
  const pack = incident({ fields: { state: 'In Progress', close_code: 'Solution provided', close_notes: '' } });
  assert.equal(find(resolutionCheck(pack, { form: { close_notes: GOOD_NOTES } }), 'notes').status, 'ok');
  assert.equal(find(resolutionCheck(incident(), { form: { close_notes: '' } }), 'notes').status, 'warn', 'cleared on the form after being saved');
  assert.equal(find(resolutionCheck(incident(), { form: { comments: 'x' } }), 'notes').status, 'ok', 'no close_notes on the form: use the saved ones');
  assert.equal(find(resolutionCheck(pack, { form: null }), 'notes').status, 'warn');
});

// ---- the close code ---------------------------------------------------------------------------------------------------------

test('close code: incident uses close_code, problem and case use resolution_code, other kinds have none', () => {
  assert.equal(find(resolutionCheck(incident({ fields: { state: 'x', close_notes: GOOD_NOTES } })), 'code').status, 'warn');
  assert.equal(find(resolutionCheck(incident({ fields: { state: 'x', close_notes: GOOD_NOTES } }), { form: { close_code: 'Solution provided' } }), 'code').status, 'ok');
  const problem = incident({ kind: 'problem', fields: { state: 'x', close_notes: GOOD_NOTES, resolution_code: 'Fix applied' }, related: { childTasks: [] } });
  assert.equal(find(resolutionCheck(problem), 'code').status, 'ok');
  assert.equal(find(resolutionCheck({ ...problem, fields: { state: 'x', close_notes: GOOD_NOTES } }), 'code').status, 'warn');
  for (const kind of ['request', 'requested_item', 'catalog_task', 'task']) assert.equal(find(resolutionCheck(incident({ kind, related: {} })), 'code'), undefined, kind);
});

// ---- did the customer answer? --------------------------------------------------------------------------------------------------

test('customer: no messages at all is a note, not a warning', () => {
  const c = find(resolutionCheck(incident(), {}, { now: NOW }), 'customer');
  assert.equal(c.status, 'info');
  assert.match(c.hint, /by phone or in person/);
});

test('customer: the customer wrote last is fine', () => {
  const j = [comment('Beth Anglin', '2026-10-26 08:00:00'), comment('Abel Tuter', '2026-10-26 09:00:00', 'Works now, thanks')];
  assert.equal(find(resolutionCheck(incident({ journal: j }), {}, { now: NOW }), 'customer').status, 'ok');
});

test('customer: an agent wrote last, recently: warn; long ago: fine; time unreadable: warn', () => {
  const recent = [comment('Abel Tuter', '2026-10-25 08:00:00'), comment('Beth Anglin', '2026-10-26 08:00:00')];
  const warn = find(resolutionCheck(incident({ journal: recent }), {}, { now: NOW }), 'customer');
  assert.equal(warn.status, 'warn');
  assert.match(warn.title, /not replied to your last message \(today\)/);

  const twoDays = [comment('Beth Anglin', '2026-10-24 12:00:00')];
  assert.match(find(resolutionCheck(incident({ journal: twoDays }), {}, { now: NOW }), 'customer').title, /2 days ago/);

  const old = [comment('Abel Tuter', '2026-10-10 08:00:00'), comment('Beth Anglin', '2026-10-20 08:00:00')];
  const wait = find(resolutionCheck(incident({ journal: old }), {}, { now: NOW }), 'customer');
  assert.equal(wait.status, 'ok');
  assert.match(wait.title, /No reply for 6 days/);

  const noTime = [comment('Beth Anglin', '26/10/2026 08:00')];
  const unknown = find(resolutionCheck(incident({ journal: noTime }), {}, { now: NOW }), 'customer');
  assert.equal(unknown.status, 'warn');
  assert.match(unknown.title, /no reply yet/);
});

test('customer: the wait is a parameter, work notes do not count, and an unknown customer is said plainly', () => {
  const j = [comment('Beth Anglin', '2026-10-24 12:00:00')];
  assert.equal(find(resolutionCheck(incident({ journal: j }), {}, { now: NOW, waitDays: 2 }), 'customer').status, 'ok');
  assert.equal(DEFAULT_WAIT_DAYS, 3);
  const onlyNotes = [{ when: '2026-10-26 08:00:00', by: 'Beth Anglin', type: 'work_note', text: 'internal' }];
  assert.match(find(resolutionCheck(incident({ journal: onlyNotes }), {}, { now: NOW }), 'customer').title, /No messages/);
  const nobody = find(resolutionCheck(incident({ people: [], journal: j }), {}, { now: NOW }), 'customer');
  assert.equal(nobody.status, 'info');
  assert.match(nobody.title, /Could not tell/);
});

// ---- open work -------------------------------------------------------------------------------------------------------------------

test('children: open tasks warn and are named; closed ones are fine; unreadable ones say why', () => {
  const t = (number, state, active) => ({ number, state, active });
  const open = find(resolutionCheck(incident({ related: { childTasks: [t('TASK1', 'Open', 'true'), t('TASK2', 'Closed Complete', 'false'), t('TASK3', 'Work in Progress', 'true')] } })), 'children');
  assert.equal(open.status, 'warn');
  assert.equal(open.title, '2 tasks still open');
  assert.match(open.hint, /TASK1 \(Open\), TASK3 \(Work in Progress\)/);
  assert.equal(find(resolutionCheck(incident({ related: { childTasks: [t('TASK2', 'Closed Complete', 'false')] } })), 'children').title, 'All 1 task closed');
  assert.equal(find(resolutionCheck(incident({ related: { childTasks: [] } })), 'children').status, 'ok');
  const hidden = find(resolutionCheck(incident({ related: {}, access: [{ source: 'task', status: 'denied', note: '' }] })), 'children');
  assert.equal(hidden.status, 'info');
  assert.match(hidden.hint, /cannot read tasks/);
});

test('children: requested items hold catalog tasks, requests hold items, catalog tasks have none', () => {
  const open = [{ number: 'SCTASK1', state: 'Open', active: 'true' }];
  assert.match(find(resolutionCheck(incident({ kind: 'requested_item', related: { catalogTasks: open } })), 'children').title, /1 catalog task still open/);
  assert.match(find(resolutionCheck(incident({ kind: 'request', related: { items: [{ number: 'RITM1', state: 'Open' }] } })), 'children').title, /1 requested item still open/);
  assert.equal(find(resolutionCheck(incident({ kind: 'catalog_task', related: {} })), 'children'), undefined);
  const many = Array.from({ length: 7 }, (_, i) => ({ number: `TASK${i}`, state: 'Open', active: 'true' }));
  assert.match(find(resolutionCheck(incident({ related: { childTasks: many } })), 'children').hint, /and 3 more/);
});

// ---- linked problem or article -----------------------------------------------------------------------------------------------------

test('links: found, none, unknown, and an article named in the notes', () => {
  const yes = { problem: { status: 'yes' }, knowledge: { status: 'no' } };
  assert.equal(find(resolutionCheck(incident(), { links: yes }), 'links').title, 'Linked to a problem');
  assert.equal(find(resolutionCheck(incident(), { links: { problem: { status: 'yes' }, knowledge: { status: 'yes' } } }), 'links').title, 'Linked to a problem and an article');
  const none = find(resolutionCheck(incident(), { links: { problem: { status: 'no' }, knowledge: { status: 'no' } } }), 'links');
  assert.equal(none.status, 'info');
  assert.equal(none.title, 'No problem or article is linked');
  const unsure = find(resolutionCheck(incident(), { links: { problem: { status: 'no' }, knowledge: { status: 'unknown', note: 'You cannot read m2m_kb_task.' } } }), 'links');
  assert.match(unsure.title, /Could not fully check/);
  assert.match(unsure.hint, /cannot read m2m_kb_task/);
  assert.match(find(resolutionCheck(incident(), {}), 'links').title, /Could not check/);
  const mentioned = incident({ fields: { state: 'x', close_code: 'x', close_notes: `${GOOD_NOTES} See KB0010023.` } });
  assert.equal(find(resolutionCheck(mentioned, { links: { problem: { status: 'no' }, knowledge: { status: 'no' } } }), 'links').title, 'Linked to an article (named in the notes)');
  // Not asked of fulfilment tickets; a problem has no "linked problem".
  assert.equal(find(resolutionCheck(incident({ kind: 'catalog_task', related: {} })), 'links'), undefined);
  const problem = find(resolutionCheck(incident({ kind: 'problem' }), { links: { problem: { status: 'na' }, knowledge: { status: 'no' } } }), 'links');
  assert.equal(problem.title, 'No article is linked');
});

// ---- personal data and secrets ----------------------------------------------------------------------------------------------------------

const SECRETS = ['jane.roe@corp.example.org', '+1 (555) 123-4567', '4111 1111 1111 1111', 'Hunter2-Secret!'];

test('pii: reports the KIND and COUNT, never the value, for the notes and the unsent comment', () => {
  const notes = `${GOOD_NOTES} Contact jane.roe@corp.example.org or +1 (555) 123-4567. password: Hunter2-Secret!`;
  const pack = incident({ fields: { state: 'x', close_code: 'x', close_notes: notes } });
  const checks = resolutionCheck(pack, { form: { comments: 'Your card 4111 1111 1111 1111 was used.' } });
  const pii = find(checks, 'pii');
  assert.equal(pii.status, 'warn');
  assert.match(pii.hint, /1 email address/);
  assert.match(pii.hint, /1 phone number/);
  assert.match(pii.hint, /1 password or key/);
  assert.match(pii.hint, /1 card number in the comment you have not sent yet/);
  assert.match(pii.hint, /in the resolution notes/);
  const everything = JSON.stringify(checks);
  for (const s of SECRETS) assert.ok(!everything.includes(s), `${s} must not appear in any result`);
  assert.ok(!everything.includes('Hunter2'));
});

test('pii: the record\'s own people are not flagged, nothing found is a plain "fine", nothing written says so', () => {
  const own = incident({ fields: { state: 'x', close_code: 'x', close_notes: `${GOOD_NOTES} Told abel.tuter@example.com it works.` } });
  assert.equal(find(resolutionCheck(own), 'pii').status, 'ok');
  assert.match(find(resolutionCheck(own), 'pii').title, /No personal data or secrets spotted/);
  const empty = incident({ fields: { state: 'x' } });
  assert.match(find(resolutionCheck(empty), 'pii').title, /Nothing written yet/);
});

test('pii: a serious value already in a comment on the ticket (even the customer\'s) is reported; their phone number is not', () => {
  const j = [
    comment('Abel Tuter', '2026-10-26 08:00:00', 'My card is 4111 1111 1111 1111 please charge it. Call me on +1 (555) 123-4567.'),
    comment('Beth Anglin', '2026-10-26 08:30:00', 'Thanks'),
  ];
  const pii = find(resolutionCheck(incident({ journal: j })), 'pii');
  assert.equal(pii.status, 'warn');
  assert.match(pii.hint, /1 card number in comments already on the ticket/);
  assert.ok(!/phone/.test(pii.hint), 'only the serious kinds are listed for earlier comments');
  assert.ok(!JSON.stringify(pii).includes('4111'));
});

test('pii: low-severity findings (an IP address) are left out', () => {
  const pack = incident({ fields: { state: 'x', close_code: 'x', close_notes: `${GOOD_NOTES} The gateway at 203.0.113.45 was restarted.` } });
  assert.equal(find(resolutionCheck(pack), 'pii').status, 'ok');
});

// ---- hold reason, already finished ----------------------------------------------------------------------------------------------------------

test('hold reason: still set is a warning; cleared on the form is fine; none saved is no check at all', () => {
  const held = incident({ fields: { state: 'In Progress', close_code: 'x', close_notes: GOOD_NOTES, hold_reason: 'Awaiting Caller' } });
  assert.equal(find(resolutionCheck(held), 'hold').status, 'warn');
  assert.equal(find(resolutionCheck(held, { form: { hold_reason: '' } }), 'hold'), undefined, 'cleared on the form');
  assert.equal(find(resolutionCheck(incident({ fields: { state: 'x', hold_reason: '' } }), { form: { hold_reason: 'Awaiting Evidence' } }), 'hold').status, 'warn', 'set on the form, not saved yet');
  assert.equal(find(resolutionCheck(incident()), 'hold'), undefined);
});

test('an already resolved ticket gets one note at the top of the list', () => {
  const done = resolutionCheck(incident({ fields: { state: 'Closed', close_code: 'x', close_notes: GOOD_NOTES } }));
  assert.equal(done[0].id, 'state');
  assert.equal(done[0].status, 'info');
  assert.equal(find(resolutionCheck(incident()), 'state'), undefined);
});

// ---- the list as a whole -------------------------------------------------------------------------------------------------------------------

test('every check is { id, status, title, hint } with a known status, and the function never blocks: it only returns advice', () => {
  const checks = resolutionCheck(incident({ fields: { state: 'On Hold', hold_reason: 'x' }, journal: [comment('Beth Anglin', '2026-10-26 08:00:00')], related: { childTasks: [{ number: 'T', state: 'Open', active: 'true' }] } }), { form: { close_notes: 'Resolved' } }, { now: NOW });
  assert.ok(checks.length >= 6);
  for (const c of checks) {
    assert.deepEqual(Object.keys(c).sort(), ['hint', 'id', 'status', 'title']);
    assert.ok(['ok', 'warn', 'info'].includes(c.status), c.status);
    assert.ok(c.title);
  }
  assert.equal(new Set(checks.map((c) => c.id)).size, checks.length, 'ids are unique');
});

test('warnings sort first, then notes, then what is fine; the summary counts them', () => {
  const checks = [{ id: 'a', status: 'ok', title: '', hint: '' }, { id: 'b', status: 'warn', title: '', hint: '' }, { id: 'c', status: 'info', title: '', hint: '' }, { id: 'd', status: 'warn', title: '', hint: '' }];
  assert.deepEqual(orderChecks(checks).map((c) => c.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(summarizeChecks(checks), { warn: 2, info: 1, ok: 1, tone: 'warn', headline: '2 things to look at before you resolve this' });
  assert.equal(summarizeChecks([checks[1]]).headline, '1 thing to look at before you resolve this');
  assert.equal(summarizeChecks([checks[0], checks[2]]).tone, 'info');
  assert.equal(summarizeChecks([checks[0]]).tone, 'ok');
});

test('buildCheckView says whether the form was used; withCurrentNotes swaps in the typed notes only', () => {
  assert.equal(buildCheckView(incident(), { form: { close_notes: 'x' } }, { now: NOW }).usedForm, true);
  assert.equal(buildCheckView(incident(), { form: null }, { now: NOW }).usedForm, false);
  assert.equal(buildCheckView(incident(), undefined, { now: NOW }).usedForm, false);

  const pack = incident();
  const swapped = withCurrentNotes(pack, { close_notes: '  My draft notes  ', comments: 'not this' });
  assert.equal(swapped.fields.close_notes, 'My draft notes');
  assert.equal(pack.fields.close_notes, GOOD_NOTES, 'the original pack is untouched');
  assert.equal(swapped.fields.comments, undefined);
  assert.equal(withCurrentNotes(pack, null), pack);
  assert.equal(withCurrentNotes(pack, { close_notes: '   ' }), pack, 'an empty form field keeps the saved notes');
  assert.ok(withCurrentNotes(pack, { close_notes: 'x'.repeat(5000) }).fields.close_notes.length <= 2000);
});

// ---- a Workspace page: only the notes boxes were read (TRACKER.md N4) ------------------------------------------------------------------

const boxes = (form) => ({ form, formSource: 'boxes' });

test('Workspace boxes: the notes typed in the box count, as on a classic form', () => {
  const empty = incident({ fields: { state: 'In Progress', close_code: 'Solution provided', close_notes: '' } });
  assert.equal(find(resolutionCheck(empty, boxes({ close_notes: GOOD_NOTES })), 'notes').status, 'ok', 'typed, not saved: counted');
  assert.match(find(resolutionCheck(empty, boxes({ close_notes: 'Done.' })), 'notes').title, /only say "resolved"/);
  assert.equal(find(resolutionCheck(incident(), boxes({ close_notes: '' })), 'notes').status, 'warn', 'the box was emptied');
  // a work note typed in the composer is mentioned, and the hint does not claim the page has no form
  const notes = find(resolutionCheck(empty, boxes({ close_notes: '', work_notes: 'Fixed the cert' })), 'notes');
  assert.match(notes.hint, /work note you have typed is separate/);
  assert.doesNotMatch(notes.hint, /no form|not found/);
});

test('Workspace boxes: no notes box found is the saved notes, and the hint says typed notes were not seen', () => {
  const empty = incident({ fields: { state: 'In Progress', close_code: 'Solution provided', close_notes: '' } });
  const notes = find(resolutionCheck(empty, boxes({ work_notes: 'wn' })), 'notes');
  assert.equal(notes.status, 'warn');
  assert.match(notes.hint, /resolution notes box was not found on this page, so notes typed there and not saved are not counted/);
  assert.doesNotMatch(notes.hint, /no form Agent Buddy can read/, 'the page was read: it is the box that is missing');
  // saved notes still count when the box is not found
  assert.equal(find(resolutionCheck(incident(), boxes({ work_notes: 'wn' })), 'notes').status, 'ok');
});

test('Workspace boxes: the close code, the hold reason and the state are always the saved ones, never "no close code" from a missing field', () => {
  const saved = incident({ fields: { state: 'In Progress', close_code: 'Solution provided', close_notes: GOOD_NOTES, hold_reason: 'Awaiting Caller' } });
  // a box answer never carries a code; if one did, it is ignored (not just missing: ignored)
  const checks = resolutionCheck(saved, boxes({ close_notes: GOOD_NOTES, close_code: '', hold_reason: '', state: '6' }));
  assert.equal(find(checks, 'code').status, 'ok', 'the saved code, not the empty one in the answer');
  assert.equal(find(checks, 'hold').status, 'warn', 'the saved hold reason stays');
  // nothing saved: a warning, and it says a code picked on this page is not counted (rather than "this page has no form")
  const noCode = find(resolutionCheck(incident({ fields: { state: 'x', close_code: '', close_notes: GOOD_NOTES } }), boxes({ close_notes: GOOD_NOTES })), 'code');
  assert.equal(noCode.status, 'warn');
  assert.match(noCode.hint, /only the notes are read, so a code picked and not saved yet is not counted/);
  assert.doesNotMatch(noCode.hint, /no form/);
  // the same answer marked as a classic form behaves as before: the form's empty code wins and nothing more is said
  const classic = find(resolutionCheck(incident({ fields: { state: 'x', close_code: 'x', close_notes: GOOD_NOTES } }), { form: { close_notes: GOOD_NOTES, close_code: '' } }), 'code');
  assert.equal(classic.status, 'warn');
  assert.doesNotMatch(classic.hint, /only the notes|no form/);
});

test('Workspace boxes: the personal-data check scans the typed notes and comment, and says when a box was not found', () => {
  const pack = incident({ fields: { state: 'x', close_code: 'x', close_notes: '' } });
  const found = find(resolutionCheck(pack, boxes({ close_notes: `${GOOD_NOTES} Confirmed with priya.raman@example.com.`, comments: 'Card 4111 1111 1111 1111' })), 'pii');
  assert.equal(found.status, 'warn');
  assert.match(found.hint, /1 email address in the resolution notes/);
  assert.match(found.hint, /1 card number in the comment you have not sent yet/);
  assert.ok(!JSON.stringify(found).includes('4111') && !JSON.stringify(found).includes('priya.raman@'));
  const all = find(resolutionCheck(incident(), boxes({ close_notes: GOOD_NOTES, comments: '' })), 'pii');
  assert.equal(all.status, 'ok');
  assert.equal(all.hint, '', 'both boxes were read');
  const partly = find(resolutionCheck(incident(), boxes({ close_notes: GOOD_NOTES })), 'pii');
  assert.match(partly.hint, /Some boxes on this page could not be found, so text typed there and not saved was not checked/);
});

test('buildCheckView says where the typed values came from: the form, the Workspace boxes, or nowhere', () => {
  const view = (facts) => buildCheckView(incident(), facts, { now: NOW });
  assert.deepEqual([view({ form: { close_notes: 'x' } }).formSource, view({ form: { close_notes: 'x' } }).usedForm], ['form', true]);
  assert.deepEqual([view(boxes({ close_notes: 'x' })).formSource, view(boxes({ close_notes: 'x' })).usedForm], ['boxes', true]);
  assert.deepEqual([view({ form: null }).formSource, view({ form: null }).usedForm], ['', false]);
  assert.deepEqual([view(undefined).formSource, view(undefined).usedForm], ['', false]);
  // boxes with nothing in them (or only fields a box never gives) is no form at all: "the saved ticket only" stays true
  for (const form of [{}, { close_code: 'x' }, ['close_notes']]) {
    const v = view(boxes(form));
    assert.deepEqual([v.formSource, v.usedForm], ['', false], JSON.stringify(form));
    assert.match(find(v.checks, 'pii').hint, /typed and not saved on this page was not checked/);
  }
  // "Improve my resolution notes" starts from the notes typed in the Workspace box
  assert.equal(withCurrentNotes(incident(), { close_notes: 'Typed in the box' }).fields.close_notes, 'Typed in the box');
});

// ---- from a real pack (the fixture incident) --------------------------------------------------------------------------------------------------

test('the fixture incident: customer has not answered, one open task, no close notes yet', async () => {
  const deps = fakeDeps(buildInstance());
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'resolution-check' });
  const checks = resolutionCheck(pack, { form: { close_notes: 'Resolved' }, links: { problem: { status: 'no' }, knowledge: { status: 'no' } } }, { now: NOW });
  assert.equal(find(checks, 'notes').status, 'warn');
  assert.equal(find(checks, 'code').status, 'warn', 'no close code saved');
  assert.match(find(checks, 'customer').title, /not replied to your last message \(today\)/);
  assert.match(find(checks, 'children').title, /1 task still open/);
  assert.equal(find(checks, 'links').status, 'info');
  // The check reads little: no description, no priority, no CI.
  assert.equal(pack.fields.description, undefined);
  assert.equal(pack.fields.cmdb_ci, undefined);
  assert.ok(pack.journal.length > 0, 'the conversation is read');
  assert.ok(Object.keys(pack.related).every((k) => ['childTasks', 'catalogTasks', 'items'].includes(k)));
  assert.equal(Math.round((NOW - Date.UTC(2026, 9, 26, 8, 20, 41)) / DAY * 24), 4);
});
