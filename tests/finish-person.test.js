import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy } from '../src/policy/policy.js';
import { Glance, INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { callerSummary } from '../src/insights/related.js';
import { answerWords, personNoun, personWords } from '../src/insights/personWords.js';
import { latestCallerMessage, sinceLooked } from '../src/insights/sinceLooked.js';
import { repeatOfCaller } from '../src/insights/closeCode.js';
import { missingDetails } from '../src/insights/missing.js';
import { priorityMismatch, riskSignals } from '../src/insights/risk.js';
import { glanceChips } from '../src/sidepanel/ticket/cards/Glance.jsx';
import { resolutionCheck } from '../src/checks/resolutionCheck.js';
import { catalogueOf, getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_FINISH } from '../src/i18n/ar/finish.js';

// Audit of 2026-11-07, F11: the panel called everyone "the caller". For a requested item or a catalog task the person is the requester, for an
// HR case the employee, for a customer service case the customer, for a change the person who asked for it. One helper
// (src/insights/personWords.js), every sentence a whole sentence per noun. The five row titles ("Same caller") are static and stay.

const A = 'a'.repeat(32);
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

// ---- the noun ------------------------------------------------------------------------------------------------------------------------

test('F11: the noun of each kind (a task by its class); an unknown kind keeps the incident\'s "caller"', () => {
  const by = { incident: 'caller', request: 'requester', requested_item: 'requester', catalog_task: 'requester', change: 'requester', case: 'customer', hr_case: 'employee', chat: 'customer', problem: 'person', knowledge: 'person' };
  for (const [kind, noun] of Object.entries(by)) assert.equal(personNoun(kind), noun, kind);
  assert.equal(personNoun({ kind: 'task', table: 'incident_task' }), 'caller');
  assert.equal(personNoun({ kind: 'task', table: 'change_task' }), 'requester');
  assert.equal(personNoun({ kind: 'task', table: 'sn_customerservice_task' }), 'customer');
  assert.equal(personNoun({ kind: 'task', table: 'sn_hr_core_task' }), 'employee');
  assert.equal(personNoun({ kind: 'task', table: 'sn_hr_le_task' }), 'employee', 'any task of the HR family');
  assert.equal(personNoun({ kind: 'task', table: 'problem_task' }), 'person');
  assert.equal(personNoun({ kind: 'task', table: 'task' }), 'person');
  assert.equal(personNoun({ kind: 'task' }), 'person');
  for (const nothing of [undefined, null, '', 'other', 'something-new', {}, { kind: 'other' }]) assert.equal(personNoun(nothing), 'caller', String(nothing));
});

test('F11: each phrase is a whole sentence per noun; the incident\'s are the words it always had; no other noun carries the word "caller"', () => {
  const caller = personWords('incident');
  assert.equal(caller.unreadable(), 'Could not read who the caller is');
  assert.equal(caller.nobody(), 'Nobody is named as the caller');
  assert.equal(caller.noEarlier(), 'No earlier tickets from this caller');
  assert.equal(caller.bodyUnreadable(), 'The caller could not be read, so earlier tickets were not looked up.');
  assert.equal(caller.bodyNobody(), 'Nobody is named as the caller on this ticket.');
  assert.equal(caller.wrote(1), 'the caller wrote');
  assert.equal(caller.wrote(2), 'the caller wrote twice');
  assert.equal(caller.wrote(5), 'the caller wrote 5 times');
  assert.equal(caller.messagesFrom(1), '1 message from the caller');
  assert.equal(caller.repliesTo(3), '3 replies to the caller');
  assert.equal(caller.heading(), 'The caller wrote');
  assert.equal(caller.heading('today 09:14'), 'The caller wrote, today 09:14');
  assert.equal(caller.sameIssue('INC1'), 'INC1 from the same caller is the same issue: link it, or raise a problem if it comes back.');
  assert.equal(caller.noContact(), 'No caller or contact');
  assert.equal(caller.noEmail(), 'No email address for the caller');
  assert.equal(caller.vipLow('3 - Moderate'), 'The caller is a VIP but the priority is 3 - Moderate.');
  assert.equal(caller.vipTitle(), 'VIP caller');
  assert.equal(caller.vipNote(), 'The caller is marked VIP in ServiceNow.');

  for (const [kind, noun] of [['requested_item', 'requester'], ['hr_case', 'employee'], ['case', 'customer']]) {
    const w = personWords(kind);
    const said = [
      w.unreadable(), w.nobody(), w.noEarlier(), w.bodyUnreadable(), w.bodyNobody(), w.wrote(1), w.wrote(2), w.wrote(4), w.messagesFrom(1), w.messagesFrom(2), w.repliesTo(1), w.repliesTo(2), w.heading(), w.heading('today 09:14'),
      w.sameIssue('RITM1'), w.noContact(), w.noEmail(), w.vipLow('3 - Moderate'), w.vipTitle(), w.vipNote(),
    ];
    for (const text of said) {
      assert.ok(!/caller/i.test(text), `${kind}: "${text}"`);
    }
    assert.ok(said.filter((s) => s.includes(noun)).length >= 16, `${kind}: the noun is in the sentences`);
  }
  assert.equal(personWords('hr_case').nobody(), 'Nobody is named as the employee');
  assert.equal(personWords('requested_item').wrote(3), 'the requester wrote 3 times');
  assert.equal(personWords('case').messagesFrom(2), '2 messages from the customer');
  assert.equal(personWords('requested_item').noContact(), 'No contact named');
  // a kind that has nobody it is for says so without a noun
  const none = personWords('problem');
  assert.equal(none.nobody(), 'Nobody is named on this ticket');
  assert.equal(none.unreadable(), 'Could not read who this ticket is for');
  assert.equal(none.noEarlier(), 'No earlier tickets from this person');
  assert.equal(none.bodyNobody(), 'Nobody is named on this ticket.');
});

// ---- the sentences, in place ---------------------------------------------------------------------------------------------------------

test('F11: the "Same caller" row\'s line names the person as the kind does; the row title is not touched', () => {
  const none = { items: [], signals: null, access: [], noCaller: true };
  assert.equal(callerSummary({ history: none }).line, 'Nobody is named as the caller');
  assert.equal(callerSummary({ history: none, kind: 'incident' }).line, 'Nobody is named as the caller');
  assert.equal(callerSummary({ history: none, kind: 'requested_item' }).line, 'Nobody is named as the requester');
  assert.equal(callerSummary({ history: none, kind: 'hr_case' }).line, 'Nobody is named as the employee');
  assert.equal(callerSummary({ history: none, kind: 'case' }).line, 'Nobody is named as the customer');
  assert.equal(callerSummary({ history: none, kind: 'task', table: 'change_task' }).line, 'Nobody is named as the requester');
  assert.equal(callerSummary({ history: none, kind: 'problem' }).line, 'Nobody is named on this ticket');
  assert.equal(callerSummary({ history: { ...none, noCaller: 'unreadable' }, kind: 'requested_item' }).line, 'Could not read who the requester is');
  const empty = { items: [], signals: { openCount: 0 }, access: [{ source: 'incident', status: 'empty' }] };
  assert.equal(callerSummary({ history: empty, kind: 'catalog_task' }).line, 'No earlier tickets from this requester');
  assert.equal(callerSummary({ history: empty, kind: 'case' }).line, 'No earlier tickets from this customer');
  assert.equal(callerSummary({ history: empty }).line, 'No earlier tickets from this caller');
  assert.equal(callerSummary({ history: { ...empty, access: [{ source: 'incident', status: 'denied' }] }, kind: 'hr_case' }).line, 'Could not check all earlier tickets', 'a neutral sentence stays');
  const titles = INSIGHT_CARDS.map((c) => c.title);
  assert.ok(titles.includes("Caller's other tickets"), 'the card keeps its name');
});

function packOf(kind, over = {}) {
  return { version: 1, table: { hr_case: 'sn_hr_core_case', requested_item: 'sc_req_item', case: 'sn_customerservice_case', incident: 'incident' }[kind] || 'incident', sysId: A, number: 'X1', kind, fields: {}, people: [], journal: [], related: {}, access: [], ...over };
}

test('F11: "since you last looked" and "what the person wrote" say the requester, the employee or the customer', () => {
  const previous = NOW - 3 * 3600000;
  const who = { requested_item: ['requested_for', 'requester'], hr_case: ['opened_for', 'employee'], case: ['contact', 'customer'], incident: ['caller', 'caller'] };
  for (const [kind, [role, noun]] of Object.entries(who)) {
    const pack = packOf(kind, {
      people: [{ role, name: 'Abel Tuter', email: 'abel@example.com', sysId: A }, { role: 'assigned_to', name: 'Beth Anglin', sysId: 'b'.repeat(32) }],
      journal: [
        { when: '2026-11-07 10:00:00', by: 'Abel Tuter', type: 'comment', text: 'It is still broken.' },
        { when: '2026-11-07 10:30:00', by: 'Abel Tuter', type: 'comment', text: 'Please help.' },
        { when: '2026-11-07 11:00:00', by: 'Beth Anglin', type: 'comment', text: 'Looking now.' },
      ],
      fields: { sys_updated_on: '2026-11-07 11:00:00' },
      related: { times: { sys_updated_on: '2026-11-07 11:00:00' } },
    });
    const s = sinceLooked({ previous, pack, now: NOW });
    assert.ok(s?.changed, kind);
    assert.ok(s.sub.includes(`2 messages from the ${noun}`), `${kind}: ${s.sub}`);
    assert.ok(s.sub.includes(`1 reply to the ${noun}`), `${kind}: ${s.sub}`);
    assert.ok(s.line.includes(`the ${noun} wrote twice`), `${kind}: ${s.line}`);
    const last = latestCallerMessage(pack, NOW);
    assert.ok(last, kind);
    assert.match(last.heading, new RegExp(`^The ${noun} wrote`), kind);
  }
});

test('F11: "looks like a repeat" in Close well names the person as the kind does', () => {
  const history = { items: [{ number: 'RITM0010019', short_description: 'Laptop for the new starter in finance', table: 'sc_req_item', sysId: 'c'.repeat(32) }] };
  const ticket = { short_description: 'Laptop for a new starter in finance' };
  assert.match(repeatOfCaller(ticket, history).line, /^RITM0010019 from the same caller is the same issue/);
  assert.match(repeatOfCaller(ticket, history, { kind: 'incident' }).line, /from the same caller/);
  assert.match(repeatOfCaller(ticket, history, { kind: 'requested_item', table: 'sc_req_item' }).line, /^RITM0010019 from the same requester is the same issue/);
  assert.match(repeatOfCaller(ticket, history, { kind: 'case' }).line, /from the same customer/);
  assert.match(repeatOfCaller(ticket, history, { kind: 'hr_case' }).line, /from the same employee/);
});

test('F11: missing details and the VIP marks name the person as the kind does', () => {
  const item = (pack) => missingDetails(pack).items.find((i) => i.id === 'contact');
  const base = { version: 1, access: [], journal: [], related: {}, fields: { short_description: 'Printer in room 4 shows error 0x80', description: 'It stopped at nine and everyone on the floor is affected, the display says error 0x80.', cmdb_ci: 'Printer 4', category: 'Hardware' } };
  assert.equal(item({ ...base, kind: 'incident', table: 'incident', people: [] }).title, 'No caller or contact');
  assert.equal(item({ ...base, kind: 'case', table: 'sn_customerservice_case', people: [] }).title, 'No contact named');
  assert.equal(item({ ...base, kind: 'incident', table: 'incident', people: [{ role: 'caller', name: 'Abel Tuter', sysId: A, email: '' }] }).title, 'No email address for the caller');
  assert.equal(item({ ...base, kind: 'case', table: 'sn_customerservice_case', people: [{ role: 'contact', name: 'Erin Contact', sysId: A, email: '' }] }).title, 'No email address for the customer');
  // the VIP marks
  assert.deepEqual(priorityMismatch({ fields: { priority: '3 - Moderate' }, vip: true }), ['The caller is a VIP but the priority is 3 - Moderate.']);
  assert.deepEqual(priorityMismatch({ fields: { priority: '3 - Moderate' }, vip: true, subject: { kind: 'hr_case' } }), ['The employee is a VIP but the priority is 3 - Moderate.']);
  const signals = riskSignals({ pack: { ...base, kind: 'requested_item', table: 'sc_req_item', people: [], fields: { ...base.fields, priority: '2 - High' } }, vip: true, now: NOW });
  const vip = signals.signals.find((s) => s.id === 'vip');
  assert.equal(vip.title, 'VIP requester');
  assert.equal(vip.why, 'The requester is marked VIP in ServiceNow.');
  assert.equal(riskSignals({ pack: { ...base, kind: 'incident', table: 'incident', people: [], fields: base.fields }, vip: true, now: NOW }).signals.find((s) => s.id === 'vip').title, 'VIP caller');
  const chip = (pack) => glanceChips({ g: { vip: true }, state: 'New', pack }).find((c) => c.key === 'vip').title;
  assert.equal(chip({ ...base, kind: 'case', table: 'sn_customerservice_case', fields: { assigned_to: 'Beth' } }), 'The customer is marked VIP in ServiceNow.');
  assert.equal(chip(null), 'The caller is marked VIP in ServiceNow.');
});

test('F11: "did the person answer?" says the requester for a request or a requested item and the employee for an HR case; an incident and a case keep "the customer"', () => {
  const journal = [
    { when: '2026-11-04 09:00:00', by: 'Beth Anglin', type: 'comment', text: 'Please try again now.' },
    { when: '2026-11-04 15:00:00', by: 'Abel Tuter', type: 'comment', text: 'It still does not work for me.' },
  ];
  const pack = (kind, role, over = {}) =>
    packOf(kind, { fields: { state: 'In Progress', close_notes: 'Replaced the expired certificate and restarted the service for everyone on the team.', close_code: 'x' }, people: [{ role, name: 'Abel Tuter', email: 'abel@example.com' }, { role: 'assigned_to', name: 'Beth Anglin' }], journal, ...over });
  const check = (p) => resolutionCheck(p, {}, { now: NOW }).find((c) => c.id === 'customer');
  assert.equal(check(pack('requested_item', 'requested_for')).title, 'The requester wrote the last message');
  assert.equal(check(pack('request', 'requested_for')).title, 'The requester wrote the last message');
  assert.equal(check(pack('hr_case', 'opened_for')).title, 'The employee wrote the last message');
  assert.equal(check(pack('case', 'contact')).title, 'The customer wrote the last message');
  assert.equal(check(pack('incident', 'caller')).title, 'The customer wrote the last message');
  // nobody to tell from support
  assert.equal(check(pack('requested_item', 'requested_for', { people: [{ role: 'assigned_to', name: 'Beth Anglin' }] })).title, "Could not tell which messages are the requester's");
  assert.equal(check(pack('hr_case', 'opened_for', { people: [{ role: 'assigned_to', name: 'Beth Anglin' }] })).hint, 'Check by eye that the employee confirmed the fix or had a chance to answer.');
  // no messages
  assert.equal(check(pack('hr_case', 'opened_for', { journal: [] })).title, 'No messages to or from the employee on this ticket');
  assert.equal(check(pack('case', 'contact', { journal: [] })).title, 'No messages to or from the customer on this ticket');
  // the agent wrote last, and the wait is short
  const answered = pack('requested_item', 'requested_for', { journal: [journal[1], { when: '2026-11-07 10:00:00', by: 'Beth Anglin', type: 'comment', text: 'Try now.' }] });
  assert.equal(check(answered).title, 'The requester has not replied to your last message (today)');
  // the words of an answer, directly
  assert.equal(answerWords({ kind: 'incident' }).noun, 'customer');
  assert.equal(answerWords({ kind: 'request' }).noun, 'requester');
  assert.equal(answerWords({ kind: 'hr_case' }).authorUnknownHint(), 'Its author is shown only as a user name. Read it and check whether the employee confirmed the fix.');
});

// ---- the card ----------------------------------------------------------------------------------------------------------------------------

let tab = 1700;
const eff = () => ({ ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) });
async function drawCaller(kind, table, pack) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (tabId) => ({ id: tabId, index: 0, windowId: 1 });
  const record = { table, sysId: A, number: 'X1', kind };
  fake.onRead('glance', () => ({ pack, slas: { items: [], access: [] }, vip: { status: 'no', access: [] }, outage: { hits: [], windowHours: 24, access: [] } }));
  const seen = { summary: [] };
  const C = INSIGHT_CARDS.find((c) => c.id === 'caller').Card;
  const page = { status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/${table}.do?sys_id=${A}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
  const ui = await mount(<C page={page} eff={eff()} record={record} header={{ number: 'X1' }} active setSummary={(s) => seen.summary.push(s)} setAttention={() => {}} />);
  await settle(8);
  return { ui, summary: () => seen.summary.at(-1) };
}

test('F11: the Caller card of a requested item, an HR case and a problem says who nobody is, in the words of the kind', async () => {
  const cases = [
    ['requested_item', 'sc_req_item', 'Nobody is named as the requester on this ticket.', 'Nobody is named as the requester'],
    ['hr_case', 'sn_hr_core_case', 'Nobody is named as the employee on this ticket.', 'Nobody is named as the employee'],
    ['problem', 'problem', 'Nobody is named on this ticket.', 'Nobody is named on this ticket'],
    ['incident', 'incident', 'Nobody is named as the caller on this ticket.', 'Nobody is named as the caller'],
  ];
  for (const [kind, table, body, line] of cases) {
    const pack = packOf(kind, { table, people: [], fields: { number: 'X1', short_description: 'A thing' } });
    const card = await drawCaller(kind, table, pack);
    try {
      assert.match(card.ui.text(), new RegExp(body.replace(/[.]/g, '\\.')), kind);
      assert.equal(card.summary(), line, kind);
    } finally {
      await card.ui.unmount();
    }
  }
});

// ---- Arabic ---------------------------------------------------------------------------------------------------------------------------

test('F11: every sentence above has an Arabic entry of its own, with the same {names}, in the Arabic noun; none is the English text', () => {
  const was = getLanguage();
  registerCatalogue('ar', AR_FINISH);
  try {
    setLanguage('ar');
    // (the stem of the Arabic noun: with or without the article, as the sentence needs it)
    const nouns = { requester: 'مقدّم', employee: 'موظف', customer: 'عميل' };
    for (const [noun, ar] of Object.entries(nouns)) {
      const w = personWords(noun === 'requester' ? 'requested_item' : noun === 'employee' ? 'hr_case' : 'case');
      for (const text of [w.unreadable(), w.nobody(), w.noEarlier(), w.bodyUnreadable(), w.bodyNobody(), w.wrote(1), w.wrote(2), w.wrote(4), w.messagesFrom(3), w.repliesTo(3), w.heading(), w.heading('اليوم'), w.sameIssue('X1'), w.noEmail(), w.vipLow('P'), w.vipTitle(), w.vipNote()]) {
        assert.ok(/[؀-ۿ]/.test(text), `Arabic: ${text}`);
        assert.ok(text.includes(ar), `${noun}: ${text}`);
      }
    }
    for (const kind of ['problem']) {
      const w = personWords(kind);
      for (const text of [w.unreadable(), w.nobody(), w.noEarlier(), w.bodyUnreadable(), w.bodyNobody()]) assert.ok(/[؀-ۿ]/.test(text), `${kind}: ${text}`);
    }
    for (const kind of ['request', 'hr_case']) {
      const w = answerWords(kind);
      for (const text of [w.unreadableHint(), w.noMessages(), w.cannotTell(), w.cannotTellHint(), w.wroteLast(), w.authorUnknownHint(), w.notReplied('اليوم')]) assert.ok(/[؀-ۿ]/.test(text), `${kind}: ${text}`);
    }
  } finally {
    setLanguage(was);
  }
});

test('F11/F13/F14: the new Arabic file keeps no key that another Arabic file already has, and every {name} of a key is in its Arabic', () => {
  const others = catalogueOf('ar') || {};
  const mine = new Set(Object.keys(AR_FINISH));
  assert.ok(mine.size > 70);
  // (the catalogue may already hold these when the lead has wired the file in: a key the lead wired is the same text)
  for (const [key, value] of Object.entries(AR_FINISH)) {
    if (Object.hasOwn(others, key)) assert.deepEqual(others[key], value, `${key} is defined twice with different words`);
    const names = (text) => [...new Set([...String(text).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))].sort();
    const english = names(key.split('|').join(' '));
    for (const form of typeof value === 'object' ? Object.values(value) : [value]) {
      for (const name of english) if (name !== 'n') assert.ok(form.includes(`{${name}}`), `${key}: {${name}}`);
    }
    if (typeof value === 'object') assert.deepEqual(Object.keys(value).sort(), ['few', 'many', 'one', 'other', 'two', 'zero'], key);
  }
});

test('F11: the Glance of a case names its customer as VIP only through the shared helper (the chip title)', async () => {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (tabId) => ({ id: tabId, index: 0, windowId: 1 });
  const pack = packOf('case', { table: 'sn_customerservice_case', fields: { number: 'CS1', short_description: 'No access to portal', state: 'Open', assigned_to: 'Beth Anglin' } });
  fake.onRead('glance', () => ({ pack, slas: { items: [], access: [] }, vip: { status: 'yes', access: [] }, outage: { hits: [], windowHours: 24, access: [] } }));
  const record = { table: 'sn_customerservice_case', sysId: A, number: 'CS1', kind: 'case' };
  const page = { status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/x?sys_id=${A}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
  const ui = await mount(<Glance page={page} eff={eff()} record={record} header={{ number: 'CS1', short_description: 'No access to portal', state: 'Open', priority: '3 - Moderate' }} headPhase="ready" />);
  await settle(6);
  try {
    assert.equal(ui.$('[data-chip="vip"]')?.getAttribute('title'), 'The customer is marked VIP in ServiceNow.');
  } finally {
    await ui.unmount();
  }
});
