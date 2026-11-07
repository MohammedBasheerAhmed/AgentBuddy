import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketLabel } from '../src/compose/ticketLabel.js';
import { planFill } from '../src/compose/notesToTicket.js';
import { formReadRefusal } from '../src/compose/rewrite.js';
import { emailClientTarget, matchesExpect, wrongRecordText } from '../src/lib/fillable.js';
import { madeWithout, madeWithoutText, sourceWords, unavailable, unavailableText } from '../src/features/parts.js';
import { insertText } from '../src/sidepanel/insertFlow.js';
import { createCache, createLimiter } from '../src/reports/engine/cache.js';
import { attempt, createReader } from '../src/reports/engine/reader.js';
import { shown } from '../src/reports/shown.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';
import { fakeInstance } from './reports-fixtures.js';

// The places that used to print a table name to a person, one test each: X1/X2 (the Write line), X3/J13 (Fill), X4/J12 (the wrong form),
// X5 (an insert for another form), A1 (Made without), A2/J10 (the banner of a blocked table), R1/R2 (the notes of the reports),
// S10 (the email form in the Next Experience).

registerCatalogue('ar', AR_LABELS);
test.afterEach(() => setLanguage('en'));

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const HOST = 'https://acme.service-now.com';
const TABLE_NAMES = /\b(?:sc_req_item|sc_task|sc_request|sn_hr_core_case|sn_customerservice_case|kb_knowledge|kb_use|m2m_kb_task|sys_user_grmember|sys_journal_field|sysapproval_approver|task_sla|sys_audit|cmdb_ci|u_[a-z_]+|x_[a-z_]+)\b/;
const noTableName = (text, where) => {
  assert.equal(typeof text, 'string', where);
  assert.ok(text.length > 0, `${where}: empty`);
  assert.doesNotMatch(text, TABLE_NAMES, where);
  assert.ok(!/[a-z]_[a-z]/.test(text), `${where}: has an underscore name: ${text}`);
};

// ---- X1, X2: the Write line --------------------------------------------------------------------------------------------------------

test('X1: a record with no number yet is "this ticket", never its table', () => {
  const page = { record: { table: 'sc_req_item', sysId: A } };
  assert.deepEqual(ticketLabel(page, null), { kind: 'record', number: '', text: 'For this ticket' });
  assert.deepEqual(ticketLabel(page, {}), { kind: 'record', number: '', text: 'For this ticket' });
  assert.equal(ticketLabel(page, { short_description: 'Laptop for Ann' }).text, 'For this ticket – Laptop for Ann');
  // the header read tells the number: from then on it is the number
  assert.equal(ticketLabel(page, { number: 'RITM0010001' }).text, 'For RITM0010001');
  assert.equal(ticketLabel(page, { number: 'RITM0010001', short_description: 'Laptop' }).text, 'For RITM0010001 – Laptop');
  // a record of any table, even one nobody knows
  for (const table of ['sn_hr_core_case', 'u_facilities_request', 'x_acme_visit_log', 'change_task']) noTableName(ticketLabel({ record: { table, sysId: A } }).text, table);
  assert.equal(ticketLabel({ record: { table: 'u_x', number: 'U0001' } }).number, 'U0001');
});

test('X2: a new blank form is called by its plain noun: "a new requested item form", not "a new sc req item form"', () => {
  const text = (table) => ticketLabel({ record: null, newRecord: { table } }).text;
  assert.equal(text('incident'), 'For a new incident form');
  assert.equal(text('sn_customerservice_case'), 'For a new case form');
  assert.equal(text('sc_req_item'), 'For a new requested item form');
  assert.equal(text('sc_task'), 'For a new catalog task form');
  assert.equal(text('change_request'), 'For a new change form');
  assert.equal(text('sn_hr_core_case'), 'For a new HR case form');
  assert.equal(text('sn_hr_core_case_payroll'), 'For a new HR case form');
  assert.equal(text('kb_knowledge'), 'For a new knowledge article form');
  assert.equal(text('u_facilities_request'), 'For a new facilities request form');
  assert.equal(text('ui_page'), 'For a new UI page form');
  for (const table of ['sc_req_item', 'sn_hr_core_case', 'kb_knowledge', 'u_facilities_request', 'x_acme_visit_log', 'ui_page', '???']) noTableName(text(table), table);
  assert.equal(ticketLabel({ record: null, newRecord: { table: ' INCIDENT ' } }).text, 'For a new incident form', 'case and spaces do not matter');
  setLanguage('ar');
  const ar = text('sc_req_item');
  assert.match(ar, /[؀-ۿ]/);
  assert.ok(ar.includes(AR_LABELS['requested item']), ar);
  assert.doesNotMatch(ar, /sc[ _]req/);
});

// ---- X3, J13: Fill ------------------------------------------------------------------------------------------------------------------

test('X3, J13: Fill says what it works on, without naming the form that is open or the "classic screen"', () => {
  const none = planFill({ shortDescription: 'x' }, null);
  assert.equal(none.canFill, false);
  assert.equal(none.reason, 'Fill works on a new, empty incident or case form. Open one, or copy the text.');
  assert.doesNotMatch(none.reason, /classic/i);
  for (const table of ['sc_req_item', 'sn_hr_core_case', 'u_facilities_request', 'ui_page']) {
    const refused = planFill({ shortDescription: 'x' }, { table, kind: 'other' });
    assert.equal(refused.canFill, false, table);
    assert.equal(refused.reason, 'The blank form that is open is not an incident or case form. Copy the text instead.', table);
    noTableName(refused.reason, table);
  }
  assert.equal(planFill({ shortDescription: 'x' }, { table: 'incident', kind: 'incident' }).canFill, true);
});

// ---- X4, J12, S10: the wrong form, the email form --------------------------------------------------------------------------------

test('X4, J12: "written for a new requested item form" and "another incident", never the names', () => {
  assert.equal(wrongRecordText({ expect: { table: 'sc_req_item', newRecord: true } }), 'This was written for a new requested item form. Open that form again, or use Copy.');
  assert.equal(wrongRecordText({ expect: { table: 'kb_knowledge', newRecord: true } }), 'This was written for a new knowledge article form. Open that form again, or use Copy.');
  assert.equal(wrongRecordText({ expect: { table: 'sn_hr_core_case', sysId: A } }), 'This was written for another HR case. Open that ticket again, or use Copy.');
  assert.equal(wrongRecordText({ expect: { table: 'u_site_visit', sysId: A } }), 'This was written for another site visit. Open that ticket again, or use Copy.');
  assert.equal(wrongRecordText({ expect: { table: 'incident', sysId: A }, number: 'INC0010001' }), 'This was written for INC0010001. Open that ticket again, or use Copy.');
  assert.equal(wrongRecordText({ expect: { email: true, table: 'incident', sysId: A } }), 'This was written for the email form of its own ticket. Open that email form, or use Copy.');
  assert.equal(wrongRecordText(null), 'This was written for another ticket. Open that ticket again, or use Copy.');
  assert.equal(wrongRecordText({ expect: 'garbage' }), 'This was written for another ticket. Open that ticket again, or use Copy.');
  for (const table of ['sc_req_item', 'sn_hr_core_case', 'u_site_visit', 'x_acme_visit_log']) {
    noTableName(wrongRecordText({ expect: { table, newRecord: true } }), table);
    noTableName(wrongRecordText({ expect: { table, sysId: A } }), table);
  }
  setLanguage('ar');
  noTableName(wrongRecordText({ expect: { table: 'sc_req_item', newRecord: true } }), 'ar');
});

test('S10: the email form is found inside the Next Experience shell, also with the query not encoded, and nowhere else', () => {
  const query = `sysparm_table=incident&sysparm_sys_id=${A}&sysparm_target=incident&sysparm_uniqueValue=${A}`;
  const want = { table: 'incident', sysId: A };
  const plain = `${HOST}/email_client.do?${query}`;
  const classicShell = `${HOST}/nav_to.do?uri=${encodeURIComponent(`email_client.do?${query}`)}`;
  const nextExperience = `${HOST}/now/nav/ui/classic/params/target/${encodeURIComponent(`email_client.do?${query}`)}`;
  const nextExperienceTwice = `${HOST}/now/nav/ui/classic/params/target/${encodeURIComponent(encodeURIComponent(`email_client.do?${query}`))}`;
  const nextExperienceOpen = `${HOST}/now/nav/ui/classic/params/target/email_client.do?${query}`;
  const nextExperienceSlash = `${HOST}/now/nav/ui/classic/params/target/${encodeURIComponent(`/email_client.do?${query}`)}`;
  const withHash = `${HOST}/now/nav/ui/classic/params/target/${encodeURIComponent(`email_client.do?${query}`)}#anchor`;
  for (const [name, href] of Object.entries({ plain, classicShell, nextExperience, nextExperienceTwice, nextExperienceOpen, nextExperienceSlash, withHash })) {
    assert.deepEqual(emailClientTarget(href), want, name);
    assert.equal(matchesExpect({ email: true, table: 'incident', sysId: A }, { href }), true, name);
    assert.equal(matchesExpect({ email: true, table: 'incident', sysId: B }, { href }), false, `${name}: the email form of another record`);
    assert.equal(matchesExpect({ email: true, table: 'problem', sysId: A }, { href }), false, `${name}: another table`);
  }
  // the lines the old code answered null for are the ones that were wrapped by the Next Experience
  assert.equal(emailClientTarget(`${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${A}`), null, 'a ticket form is not the email form');
  assert.equal(emailClientTarget(`${HOST}/now/nav/ui/classic/params/target/`), null);
  assert.equal(emailClientTarget(`${HOST}/now/nav/ui/classic/params/target/%E0%A4%A`), null, 'a broken encoding is no email form');
  assert.equal(emailClientTarget(`${HOST}/incident.do?sys_id=${A}`), null);
  assert.equal(emailClientTarget('not a url'), null);
  assert.equal(emailClientTarget(''), null);
  assert.equal(emailClientTarget(undefined), null);
  // wrappers inside wrappers stop after a few levels
  let deep = `email_client.do?${query}`;
  for (let i = 0; i < 6; i += 1) deep = `nav_to.do?uri=${encodeURIComponent(deep)}`;
  assert.equal(emailClientTarget(`${HOST}/${deep}`), null);
});

// ---- X5: an insert for another form ----------------------------------------------------------------------------------------------

test('X5: an insert that belongs on another form says which form in plain words', async () => {
  const send = async () => {
    throw new Error('nothing may be sent');
  };
  const page = { tabId: 1, href: `${HOST}/incident.do?sys_id=${A}`, record: { table: 'incident', sysId: A }, newRecord: null };
  const said = async (table) => (await insertText({ page, target: { field: 'text', table }, text: 'Some text', send })).why;
  assert.equal(await said('kb_knowledge'), 'This goes into a knowledge article form. Open that form first, then insert. Copy works now.');
  assert.equal(await said('sc_req_item'), 'This goes into a requested item form. Open that form first, then insert. Copy works now.');
  assert.equal(await said('u_facilities_request'), 'This goes into a facilities request form. Open that form first, then insert. Copy works now.');
  for (const table of ['kb_knowledge', 'sc_req_item', 'sn_hr_core_case', 'u_facilities_request']) noTableName(await said(table), table);
});

// ---- A2, J10: the banner of a table the organisation blocks ------------------------------------------------------------------

test('A2, J10: a blocked table is said by its plural noun, in both languages', () => {
  const blocked = (table, options) => formReadRefusal(table, 'comments', normalizePolicy({ blockedTables: [table] }), options);
  assert.equal(blocked('incident'), 'Your organisation does not allow Agent Buddy to use incidents.');
  assert.equal(blocked('sc_req_item'), 'Your organisation does not allow Agent Buddy to use requested items.');
  assert.equal(blocked('sn_customerservice_case'), 'Your organisation does not allow Agent Buddy to use customer service cases.');
  assert.equal(blocked('u_facilities_request'), 'Your organisation does not allow Agent Buddy to use facilities requests.');
  assert.equal(formReadRefusal('u_facilities_request', 'comments', normalizePolicy({ blockedTables: ['u_facilities_request'] }), 'Site Visit'), 'Your organisation does not allow Agent Buddy to use site visits.');
  assert.equal(formReadRefusal('incident', 'comments', normalizePolicy({})), '');
  setLanguage('ar');
  for (const table of ['sc_req_item', 'sn_hr_core_case', 'u_facilities_request']) {
    const text = blocked(table);
    noTableName(text, table);
    assert.match(text, /[؀-ۿ]/);
  }
  assert.ok(blocked('sc_req_item').includes(AR_LABELS['requested items']));
});

// ---- A1: Made without --------------------------------------------------------------------------------------------------------------

const access = (source, status = 'denied', extra = {}) => ({ source, status, note: 'x', ...extra });

test('A1: every source of "Made without" is a plain noun; the two mislabelled tables are not mislabelled; nothing prints a name', () => {
  const sources = ['kb_knowledge', 'kb_use', 'm2m_kb_task', 'sys_user_grmember', 'sn_hr_core_case', 'problem', 'sys_audit', 'u_site_visit', 'cmdb_ci', 'incident', 'sn_customerservice_case', 'task', 'change_request', 'sc_item_option_mtom', 'item_option_new', 'x_acme_visit_log'];
  const list = unavailable({ table: 'incident-compose', access: sources.map((s) => access(s)) });
  const whats = list.map((u) => u.what);
  assert.ok(whats.length >= 14);
  whats.forEach((w) => noTableName(w, w));
  assert.ok(whats.includes('Knowledge articles') && whats.includes('Article links') && whats.includes('Group memberships') && whats.includes('HR cases'));
  assert.ok(whats.includes('Incidents'), '`incident` is "Incidents", not "Linked incidents"');
  assert.ok(whats.includes('Customer service cases'), "`sn_customerservice_case` is not \"The account's other cases\"");
  assert.ok(!whats.includes('Linked incidents') && !whats.includes("The account's other cases") && !whats.includes('Other changes') && !whats.includes('Child tasks'));
  assert.ok(whats.includes('Facilities requests') || whats.includes('Site visits'), 'a custom table is its name made into words');
  // the model reads the same words, in English
  const text = unavailableText(list);
  noTableName(text.replace(/\bnot readable by your user\b/g, ''), 'the Not available part');
  assert.match(text, /^- Incidents: not readable by your user$/m);
  // ...and the person reads them in the language of the panel
  const person = madeWithout(list);
  assert.deepEqual(person.map((m) => m.status), list.map((u) => u.status));
  person.forEach((m) => noTableName(m.what, 'person'));
  assert.equal(madeWithoutText([{ what: 'Incidents', why: 'you cannot read them' }]), 'Made without: Incidents (you cannot read them).');
});

test('A1: two tables with one noun are said once; fields of the record itself that were skipped are "some fields of this ticket"; a source nobody can name is "Something"', () => {
  const list = unavailable({ table: 'sc_req_item', access: [access('sc_item_option_mtom'), access('sc_item_option'), access('sc_req_item', 'skipped', { note: 'The text of this record is not read.' }), access('journal'), access('sys_journal_field'), access('similar tickets'), access('', 'denied'), access('sys_user'), access('incident', 'empty-or-hidden', { reference: true })] });
  assert.deepEqual(list.map((u) => u.what), ['Request answers', 'Some fields of this ticket', 'Notes and comments', 'Something']);
  // the same table read for OTHER tickets (the caller's history, the account's cases) is the table, not the record itself
  assert.deepEqual(unavailable({ table: 'sn_customerservice_case', access: [access('sn_customerservice_case', 'error')] }).map((u) => u.what), ['Customer service cases']);
  assert.deepEqual(unavailable({ table: 'incident', access: [access('incident', 'denied')] }).map((u) => u.what), ['Incidents']);
  assert.equal(sourceWords('caller-history'), "The caller's other tickets");
  assert.equal(sourceWords('field history'), 'History');
  assert.equal(sourceWords('chat'), 'Chat messages');
  assert.equal(sourceWords('tickets'), 'Tickets');
  assert.equal(sourceWords('some words'), 'Something');
  assert.equal(sourceWords(null), 'Something');
});

test('A1 in Arabic: "Made without" names the sources in Arabic, and keeps the English for the model', () => {
  const list = unavailable({ table: 'incident', access: [access('kb_use'), access('sn_hr_core_case', 'blocked'), access('sys_user_grmember', 'error'), access('u_site_visit', 'empty-or-hidden')] });
  setLanguage('ar');
  const person = madeWithout(list);
  assert.equal(person[0].what, AR_LABELS['article links']);
  assert.equal(person[1].what, AR_LABELS['HR cases']);
  assert.equal(person[2].what, AR_LABELS['group memberships']);
  assert.match(person[3].what, /Site visits/);
  person.forEach((m) => assert.match(m.why, /[؀-ۿ]/));
  // the model's part stays English whatever the panel's language
  const text = unavailableText(list);
  assert.match(text, /^- Article links: not readable by your user$/m);
  assert.doesNotMatch(text, /[؀-ۿ]/);
});

// ---- R1, R2: the notes of the reports ----------------------------------------------------------------------------------------------

function readerFor(instance, options = {}) {
  return createReader({ deps: instance.deps, cache: createCache({}), limiter: createLimiter(4), ...options });
}

test('R1: a table the person cannot read is "Not available to you.", whatever the table is, with no name and no instance text', async () => {
  const inst = fakeInstance({ denied: ['incident', 'task_sla', 'sysapproval_approver'] });
  const reader = readerFor(inst);
  for (const table of ['incident', 'task_sla', 'sysapproval_approver']) {
    const got = await attempt(() => reader.count(table, ''), table);
    assert.deepEqual([got.ok, got.status, got.note], [false, 'denied', 'Not available to you.'], table);
  }
  // a refusal the instance words in its own way is still our sentence
  const odd = await attempt(async () => {
    throw Object.assign(new Error('Insufficient rights to query records: ACL x_acme_secret said no (403)'), { code: 'ACCESS_DENIED' });
  }, 'x_acme_secret');
  assert.deepEqual([odd.status, odd.note], ['denied', 'Not available to you.']);
  // any other failure is "Could not be read right now.": ServiceNow's words and the table's name stay out
  const broken = await attempt(async () => {
    throw new Error('Table API query on "sc_req_item" failed (500): java.lang.NullPointerException in sys_script_ajax');
  }, 'sc_req_item');
  assert.equal(broken.status, 'error');
  assert.equal(broken.note, 'Could not be read right now.');
});

test('R1, R2: the organisation blocking a table is said with the table\'s words in every place the reports say it', async () => {
  const inst = fakeInstance({});
  const reader = readerFor(inst, { blocked: ['sc_req_item', 'task_sla', 'u_visits'] });
  await assert.rejects(() => reader.count('sc_req_item', ''), (e) => e.code === 'BLOCKED' && e.message === 'Your organisation does not allow reports to read requested items.');
  await assert.rejects(() => reader.rows('task_sla', '', ['sys_id']), (e) => e.message === 'Your organisation does not allow reports to read SLAs.');
  await assert.rejects(() => reader.groups('u_visits', '', ['state']), (e) => e.message === 'Your organisation does not allow reports to read visits.');
  assert.deepEqual(await reader.visibility('task_sla'), { status: 'blocked', note: 'Your organisation does not allow reports to read SLAs.' });
  // the policy guard of the page answers with its own message, which names the table: the engine words it itself
  const guarded = await attempt(async () => {
    throw Object.assign(new Error('Your organisation does not allow Agent Buddy to read sc_req_item records.'), { code: 'BLOCKED_TABLE' });
  }, 'sc_req_item');
  assert.deepEqual([guarded.status, guarded.note], ['blocked', 'Your organisation does not allow reports to read requested items.']);
  const unnamed = await attempt(async () => {
    throw Object.assign(new Error('Your organisation does not allow Agent Buddy to read sc_req_item records.'), { code: 'BLOCKED_TABLE' });
  });
  assert.deepEqual([unnamed.status, unnamed.note], ['blocked', 'Your organisation does not allow reports to read this.']);
});

test('R1, R2: what a count that came back wrong or a column that is not there says', async () => {
  const noCount = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.table === 'sc_task', then: { stats: {} } }] });
  await assert.rejects(() => readerFor(noCount).count('sc_task', ''), (e) => e.message === 'ServiceNow did not return a count for catalog tasks.');
  const noColumn = fakeInstance({ rules: [{ when: (c) => c.kind === 'aggregate' && c.groupBy?.[0] === 'cmdb_ci', then: { stats: { count: '5' } } }] });
  await assert.rejects(() => readerFor(noColumn).groups('incident', '', ['cmdb_ci']), (e) => e.message === 'configuration item is not available on incidents.');
});

test('R1 in Arabic: the note of a table is translated whole, the table in the sentence too', () => {
  setLanguage('ar');
  for (const text of ['Incidents: Not available to you.', 'Requested items: Could not be read right now.', 'Catalog tasks: Not available on this ServiceNow site.', 'Your organisation does not allow reports to read SLAs.', 'Your organisation does not allow reports to read requested items.']) {
    const done = shown(text);
    assert.match(done, /[؀-ۿ]/, text);
    assert.doesNotMatch(done, /Incidents|Requested|Catalog|SLAs|approvals|read requested/, `${text} -> ${done}`);
  }
  assert.equal(shown('Incidents: Not available to you.'), `${shown('Incidents')}: ${AR_LABELS['Not available to you.']}`);
  // a noun the labels know that the report catalogue does not: found through the labels, with or without a capital
  assert.equal(shown('Your organisation does not allow reports to read group memberships.').includes(AR_LABELS['group memberships']), true);
  assert.equal(shown('Group memberships: Not available to you.'), `${AR_LABELS['group memberships']}: ${AR_LABELS['Not available to you.']}`);
  assert.equal(shown('History: Could not be read right now.'), `${AR_LABELS.history}: ${AR_LABELS['Could not be read right now.']}`);
});

// ---- J18 in the files of this workstream: "you", not "your user" -----------------------------------------------------------------

test('a refused search for look-alike tickets or articles says "You cannot read this."', async () => {
  const { addReference } = await import('../src/itsm/reference.js');
  const refused = async () => {
    throw Object.assign(new Error('Your user is not allowed to read this (403).'), { code: 'ACCESS_DENIED' });
  };
  const out = await addReference({ table: 'incident', sysId: A, fields: {}, people: [], access: [] }, { read: refused }, { knowledge: true });
  const entry = out.access.find((a) => a.source === 'knowledge');
  assert.equal(entry.status, 'denied');
  assert.equal(entry.note, 'You cannot read this.');
  assert.equal(entry.reference, true);
});

test('S10: a wrapper that points at another site is no email form', () => {
  const query = `sysparm_table=incident&sysparm_sys_id=${A}`;
  const elsewhere = `https://evil.example/email_client.do?${query}`;
  assert.equal(emailClientTarget(`${HOST}/nav_to.do?uri=${encodeURIComponent(elsewhere)}`), null);
  assert.equal(emailClientTarget(`${HOST}/now/nav/ui/classic/params/target/${encodeURIComponent(elsewhere)}`), null);
  // the same site written out in full is fine
  assert.deepEqual(emailClientTarget(`${HOST}/nav_to.do?uri=${encodeURIComponent(`${HOST}/email_client.do?${query}`)}`), { table: 'incident', sysId: A });
});
