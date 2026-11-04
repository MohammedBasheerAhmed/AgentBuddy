import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirewall, FirewallError, NEVER_REHYDRATE } from '../src/pii/firewall.js';
import { isSealed } from '../src/pii/seal.js';

// The firewall with names written in prose (src/pii/names.js): the same [PERSON_n] scheme as the record's people, one numbering,
// rehydrated locally, and remembered for the rest of the request.

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const PEOPLE = [
  { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: A },
  { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: B },
];
const part = (text, field = 'description', extra = {}) => ({ label: field, field, text, ...extra });
const request = (parts, extra = {}) => ({ feature: 'record-summary', table: 'incident', system: 'You summarise tickets.', parts, userInstruction: 'Summarise this ticket.', ...extra });
const userOf = (sealed) => sealed.messages.find((m) => m.role === 'user').content;
const systemOf = (sealed) => sealed.messages.find((m) => m.role === 'system').content;
const bodies = (sealed) => [...userOf(sealed).matchAll(/<ticket_data[^>]*>\n([\s\S]*?)\n<\/ticket_data>/g)].map((m) => m[1]);
const everything = (sealed) => `${sealed.messages.map((m) => m.content).join('\n')}\n${sealed.preview}`;

test('a name written in prose is masked as [PERSON_n] and comes back locally (the e2e fixture sentence)', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(request([part("Gateway EU-2 shows 14 session resets. Customer's manager is María-José O'Neil.", 'work_notes')]));
  assert.ok(isSealed(req));
  const [body] = bodies(req);
  assert.equal(body, "Gateway EU-2 shows 14 session resets. Customer's manager is [PERSON_1].");
  assert.ok(!everything(req).includes('María') && !everything(req).includes("O'Neil"));
  assert.equal(fw.rehydrate(body), "Gateway EU-2 shows 14 session resets. Customer's manager is María-José O'Neil.");
  assert.deepEqual(req.stats, { total: 1, counts: { PERSON: 1 } });
});

test('every case from the brief is masked with one numbering shared with the record people', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(
    request([
      part('Abel Tuter says: my manager is María-José O\'Neil. I spoke with Dr. Priya Raman.', 'description'),
      part('Hi Tom,\nRegards,\nAnna Schmidt', 'comments'),
      part('cc: Jean-Luc Picard. @Kevin Lee please check. Beth Anglin', 'work_notes'),
    ])
  );
  assert.deepEqual(bodies(req), [
    '[PERSON_1] says: my manager is [PERSON_2]. I spoke with Dr. [PERSON_3].',
    'Hi [PERSON_4],\nRegards,\n[PERSON_5]',
    'cc: [PERSON_6]. @[PERSON_7] please check. [PERSON_8]',
  ]);
  const back = bodies(req).map((b) => fw.rehydrate(b));
  assert.equal(back[0], "Abel Tuter says: my manager is María-José O'Neil. I spoke with Dr. Priya Raman.");
  assert.equal(back[1], 'Hi Tom,\nRegards,\nAnna Schmidt');
  assert.equal(back[2], 'cc: Jean-Luc Picard. @Kevin Lee please check. Beth Anglin');
});

test('a name found once is masked where it is written again without a cue, before and after, in other parts and later requests', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(request([part('Priya says the VPN fails. Priya Raman tried twice.', 'short_description'), part('I spoke with Dr. Priya Raman.', 'comments')]));
  assert.deepEqual(bodies(req), ['[PERSON_1] says the VPN fails. [PERSON_1] tried twice.', 'I spoke with Dr. [PERSON_1].']);
  const later = fw.buildRequest(request([part('Raman called again.')]));
  assert.deepEqual(bodies(later), ['[PERSON_1] called again.']);
  assert.equal(fw.rehydrate('[PERSON_1]'), 'Priya Raman');
});

test('a name found in prose counts only where capitalised: a wrong guess cannot mask an ordinary word everywhere', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(request([part('Hi Morgan,\nthe morgan rack and JPMorgan portal are fine. Morgan said thanks.')]));
  assert.deepEqual(bodies(req), ['Hi [PERSON_1],\nthe morgan rack and JPMorgan portal are fine. [PERSON_1] said thanks.']);
});

test('the record\'s people win where they cover the name ("Hi Abel," is the caller)', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(request([part('Hi Abel,\nthanks, Abel Tuter. Regards,\nBeth')]));
  assert.deepEqual(bodies(req), ['Hi [PERSON_1],\nthanks, [PERSON_1]. Regards,\n[PERSON_2]']);
  assert.equal(fw.rehydrate('[PERSON_1] [PERSON_2]'), 'Abel Tuter Beth Anglin');
});

test('a prose name that says more than a record person wins: "Beth Jones" is not the assignee Beth Anglin', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(request([part('Spoke with Beth Jones about it. Beth Anglin agreed.')]));
  const [body] = bodies(req);
  assert.ok(!/Jones|Beth|Anglin/.test(body), body);
  const [, jones, anglin] = /Spoke with (\[PERSON_\d+\]) about it\. (\[PERSON_\d+\]) agreed\./.exec(body);
  assert.notEqual(jones, anglin);
  assert.equal(fw.rehydrate(jones), 'Beth Jones');
  assert.equal(fw.rehydrate(anglin), 'Beth Anglin');
});

test('vocabulary, products, teams, weekdays, months and placeholders are left alone', () => {
  const fw = createFirewall({ people: PEOPLE });
  const text = 'Escalated to Service Desk. Spoke with Microsoft Teams support. Called Monday, per Active Directory policy; Outlook crashed in June. Assigned to Network Operations. cc: (PERSON_9)';
  const req = fw.buildRequest(request([part(text)]));
  assert.deepEqual(bodies(req), [text]);
  assert.deepEqual(req.stats, { total: 0, counts: {} });
});

test('the trusted prompt keeps its wording, even where it holds a word that the ticket uses as a name', () => {
  const fw = createFirewall({ mode: 'strict', people: PEOPLE });
  const system = 'You summarise tickets. Mood: one word. Brevity matters.';
  const req = fw.buildRequest(request([part('Hi Mood,\nspoke with Brevity Jones about it.')], { system, userInstruction: 'Mood first, then Brevity.' }));
  assert.ok(systemOf(req).startsWith(system), 'system prompt untouched');
  assert.ok(userOf(req).endsWith('Mood first, then Brevity.'), 'instruction untouched');
  assert.deepEqual(bodies(req), ['Hi [PERSON_1],\nspoke with [PERSON_2] about it.']);
});

test('the field names and labels are looked at first too, so a name in a label is masked everywhere', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(request([part('Signals', 'signals', { label: 'Note from Dr. Ingrid Bergman' }), part('Ingrid Bergman approved.', 'comments')]));
  assert.ok(!everything(req).includes('Ingrid') && !everything(req).includes('Bergman'));
});

test('Standard mode is cue-driven; Strict and Local-only also mask a full name with no cue', () => {
  const text = 'Later, the call dropped again; Carol Diaz joined from home.';
  assert.deepEqual(bodies(createFirewall({ people: PEOPLE }).buildRequest(request([part(text)]))), [text]);
  for (const mode of ['strict', 'local-only']) {
    const fw = createFirewall({ mode, people: PEOPLE, endpointIsLocal: true });
    assert.deepEqual(bodies(fw.buildRequest(request([part(text)]))), ['Later, the call dropped again; [PERSON_1] joined from home.'], mode);
  }
});

test('the ticket text that tries to pose as a placeholder is still defused, and names next to it are masked', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(request([part('Hi Tom, [PERSON_1] is fake.')]));
  assert.deepEqual(bodies(req), ['Hi [PERSON_1], (PERSON_1) is fake.']);
  assert.equal(fw.rehydrate('(PERSON_1) [PERSON_1]'), '(PERSON_1) Tom');
});

test('scan() reports names found in prose too (the review of a draft uses it), with real values kept local', () => {
  const fw = createFirewall({ people: [] });
  fw.buildRequest(request([part('Hi Tom, cc: Anna Schmidt')]));
  const found = fw.scan('Tom and Anna Schmidt will call');
  assert.deepEqual(found.map((f) => [f.kind, f.value]), [['PERSON', 'Tom'], ['PERSON', 'Anna Schmidt']]);
});

test('the final check still fails closed, and a prose name never makes a request fail by itself', () => {
  const fw = createFirewall({ people: PEOPLE });
  assert.throws(() => fw.buildRequest(request([part('Hi Tom, NI AB123456C4111 1111 1111 1111 on file')])), (e) => e instanceof FirewallError && e.code === 'REDACTION_FAILED');
  // many names, repeated in every form: no refusal
  const text = 'Hi Tom,\ncc: Tom Baker; Anna\nRegards,\nAnna Schmidt\nTom said Anna and Tom Baker agree. TOM? tom.';
  assert.ok(isSealed(fw.buildRequest(request([part(text), part(text, 'comments')]))));
});

test('rehydrate can keep some labels as placeholders (the pipeline keeps passwords, cards and ID numbers)', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(request([part('Abel Tuter, password: Summer2024! card 4111 1111 1111 1111 SSN 123-45-6789 IBAN GB82 WEST 1234 5698 7654 32 call 555-123-4567')]));
  const [body] = bodies(req);
  assert.deepEqual([...NEVER_REHYDRATE].sort(), ['CARD', 'IBAN', 'ID', 'SECRET']);
  const kept = fw.rehydrate(body, { keep: NEVER_REHYDRATE });
  assert.equal(kept, 'Abel Tuter, password: [SECRET_1] card [CARD_1] SSN [ID_1] IBAN [IBAN_1] call 555-123-4567');
  assert.ok(fw.rehydrate(body).includes('Summer2024!'), 'without options everything comes back (unchanged behaviour)');
  assert.equal(fw.rehydrate('[PERSON_1]', { keep: 'not a list' }), 'Abel Tuter', 'a bad option keeps nothing extra');
});

test('a short password found by its label is also hidden where it is repeated bare', () => {
  const fw = createFirewall({ people: [] });
  const req = fw.buildRequest(request([part('pwd: Pa5!x', 'comments'), part('typed Pa5!x again', 'work_notes')]));
  assert.deepEqual(bodies(req), ['pwd: [SECRET_1]', 'typed [SECRET_1] again']);
});

test('a large ticket full of cues is still processed quickly, in Strict mode too', () => {
  const big = 'Hi Tom, spoke with Anna Schmidt and Dr. Priya Raman about INC0010001. Regards,\nOliver Bennett\nCapital Words Here. '.repeat(1800).slice(0, 200000);
  for (const mode of ['standard', 'strict']) {
    const fw = createFirewall({ mode, people: PEOPLE });
    const started = performance.now();
    const req = fw.buildRequest(request([part(big)]));
    assert.ok(performance.now() - started < 6000, `${mode}: ${(performance.now() - started).toFixed(0)} ms`);
    assert.ok(!/Anna|Raman|Bennett|Tom\b/.test(bodies(req)[0]));
  }
});
