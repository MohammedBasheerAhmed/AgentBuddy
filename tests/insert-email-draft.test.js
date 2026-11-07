import { mount, click, settle, makeChrome, fakeAiFetch, fakeClipboard } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AGE_MS, afterInsert, clearPending, emailDraft, emailExpect, emailInserts, getPending, isEmailFeature, pendingFits, setPending, subjectWithNumber } from '../src/sidepanel/pendingDraft.js';
import PendingDraft from '../src/sidepanel/PendingDraft.jsx';
import { useAnswers, AnswerArea, forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { featureById } from '../src/features/registry.js';
import { EMAIL_TYPES, emailFormUrl } from '../src/compose/emailRecommend.js';
import { describeInsert, insertedNote } from '../src/lib/fillable.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { forgetInserts, insertTargets } from '../src/sidepanel/insertFlow.js';
import { AUDIT_KEY } from '../src/audit/auditLog.js';

// TRACKER.md AI9: an AI email draft on the Ticket screen goes into the email form of THAT ticket. "Open the email form" carries the
// draft (memory only, this site, this ticket's email form, 15 minutes) and the card at the top of the panel there offers Insert
// subject / Insert body through the one insert path: the review first, one whitelisted box each, never a save or a send.

const ORIGIN = 'https://acme.service-now.com';
const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const INC = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' };
const EMAIL = 'Subject: Update on your VPN problem\n\nHello Abel Tuter,\n\nWe restarted the gateway. Please tell us if the VPN drops again.\n\nKind regards';
const feature = featureById('email-status-update');

const emailPage = (sysId = SYS, { origin = ORIGIN, table = 'incident', wrapped = false } = {}) => {
  const inner = `email_client.do?sysparm_table=${table}&sysparm_sys_id=${sysId}&sysparm_target=${table}&sysparm_uniqueValue=${sysId}`;
  const href = wrapped ? `${origin}/nav_to.do?uri=${encodeURIComponent(inner)}` : `${origin}/${inner}`;
  return { status: 'record', tabId: 9, href, surface: 'classic', portal: null, record: null, newRecord: { table: 'sys_email' }, user: { name: 'Beth Anglin' } };
};
const ticketPage = (record = INC) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/${record.table}.do?sys_id=${record.sysId}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const draftOf = (over = {}) => emailDraft({ feature, text: EMAIL, people: [{ role: 'caller', name: 'Abel Tuter' }], scan: () => [], href: `${ORIGIN}/incident.do?sys_id=${SYS}`, ticket: { table: 'incident', sysId: SYS }, number: 'INC0010001', ...over });
const effOf = (values = {}) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', ...values }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });

// ---- Pure logic ----------------------------------------------------------------------------------------------------------------

test('the six AI email drafts count as email drafts; other answers do not', () => {
  for (const t of EMAIL_TYPES) assert.equal(isEmailFeature(featureById(t.featureId)), true, t.featureId);
  for (const id of ['reply-draft', 'record-summary', 'rewrite-short', 'kb-article-draft']) assert.equal(isEmailFeature(featureById(id)), false, id);
  assert.equal(isEmailFeature(null), false);
  assert.equal(isEmailFeature({ id: '' }), false);
});

test('emailDraft splits the answer into subject and body and binds it to the ticket and the site it was written on', () => {
  const d = draftOf({ ticket: { table: 'Incident', sysId: SYS.toUpperCase() } });
  assert.equal(d.subject, 'INC0010001: Update on your VPN problem');
  assert.match(d.body, /^Hello Abel Tuter,/);
  assert.ok(!d.body.includes('Subject:'), 'the subject line is not in the body');
  assert.deepEqual(d.email, { table: 'incident', sysId: SYS }, 'lower case, as the email client address is compared');
  assert.equal(d.origin, ORIGIN);
  assert.equal(d.number, 'INC0010001');
  assert.equal(d.text, EMAIL, 'the answer as it was shown (through the safe renderer)');
  // the model's markdown dressing does not end up in what is inserted
  assert.equal(draftOf({ text: '**Subject:** Your VPN\n\n**Hello**, done.' }).subject, 'INC0010001: Your VPN');
  assert.equal(draftOf({ text: '**Subject:** Your VPN\n\n**Hello**, done.' }).body, 'Hello, done.');
  // no subject line: all of it is the body
  const plain = draftOf({ text: 'Hello Abel,\n\nDone.' });
  assert.equal(plain.subject, '');
  assert.equal(plain.body, 'Hello Abel,\n\nDone.');
});

test('emailDraft refuses what it cannot bind: no https site, no valid ticket, no text, no feature', () => {
  assert.equal(draftOf({ href: 'http://acme.service-now.com/incident.do' }), null);
  assert.equal(draftOf({ href: 'chrome-extension://x/sidepanel.html' }), null);
  assert.equal(draftOf({ ticket: null }), null);
  assert.equal(draftOf({ ticket: { table: 'incident', sysId: 'nope' } }), null);
  assert.equal(draftOf({ ticket: { table: 'inc;drop', sysId: SYS } }), null);
  assert.equal(draftOf({ text: '' }), null);
  assert.equal(draftOf({ text: 'Subject: only a subject' }), null, 'nothing to put in the body');
  assert.equal(draftOf({ feature: null }), null);
});

test('setPending keeps an email draft only with a valid ticket; a bad one is refused and drops the old draft', () => {
  clearPending();
  assert.equal(setPending(draftOf()), true);
  assert.deepEqual(getPending().email, { table: 'incident', sysId: SYS });
  assert.equal(setPending({ ...draftOf(), email: { table: 'incident', sysId: 'x' } }), false);
  assert.equal(getPending(), null, 'nothing stale stays behind');
  assert.equal(setPending({ ...draftOf(), email: { table: 'INCIDENT', sysId: SYS.toUpperCase() } }), true);
  assert.deepEqual(getPending().email, { table: 'incident', sysId: SYS }, 'normalised');
  clearPending();
});

test('an email draft fits ONLY the email form of its own ticket, on its own site', () => {
  clearPending();
  setPending(draftOf());
  const d = getPending();
  assert.equal(pendingFits(d, emailPage()), true);
  assert.equal(pendingFits(d, emailPage(SYS, { wrapped: true })), true, 'also inside the classic frame (nav_to.do?uri=email_client.do...)');
  assert.equal(pendingFits(d, { ...emailPage(), href: emailPage().href.replace(SYS, SYS.toUpperCase()) }), true, 'case does not matter in a sys_id');
  // another ticket's email form, the same sys_id on another table, another site, a look-alike host, http
  assert.equal(pendingFits(d, emailPage(SYS_B)), false, "another ticket's email form");
  assert.equal(pendingFits(d, emailPage(SYS, { table: 'sc_req_item' })), false);
  assert.equal(pendingFits(d, emailPage(SYS, { origin: 'https://other.service-now.com' })), false);
  assert.equal(pendingFits(d, emailPage(SYS, { origin: 'https://acme.service-now.com.evil.example' })), false);
  assert.equal(pendingFits(d, emailPage(SYS, { origin: 'http://acme.service-now.com' })), false);
  // the ticket itself, a blank form, a page without an address
  assert.equal(pendingFits(d, ticketPage()), false, 'not on the ticket: the answer is shown there already');
  assert.equal(pendingFits(d, { ...ticketPage(), href: `${ORIGIN}/sys_email.do?sys_id=-1`, record: null, newRecord: { table: 'sys_email' } }), false);
  assert.equal(pendingFits(d, { href: '' }), false);
  assert.equal(pendingFits({ ...d, email: { table: 'incident', sysId: 'x' } }, emailPage()), false, 'a broken binding fits nowhere');
  // and the other way round: an article draft is never offered on an email form
  assert.equal(pendingFits({ feature: featureById('kb-article-draft'), origin: ORIGIN }, emailPage()), false);
  clearPending();
});

test('an email draft expires after fifteen minutes like any carried draft', () => {
  clearPending();
  setPending(draftOf());
  const at = getPending().at;
  assert.ok(getPending(at + MAX_AGE_MS - 1000));
  assert.equal(getPending(at + MAX_AGE_MS + 1), null);
  assert.equal(getPending(), null);
});

test('its inserts: the subject replaces, the body goes below; both land only in the email form of that ticket', () => {
  const d = draftOf();
  const specs = emailInserts(d);
  assert.deepEqual(specs.map((s) => [s.field, s.mode, s.label, s.fieldLabel]), [['subject', 'replace', 'Insert subject', 'Subject'], ['body', 'append', 'Insert body', 'Body']]);
  assert.equal(specs[0].pick(), d.subject);
  assert.equal(specs[1].pick(), d.body);
  assert.deepEqual(emailInserts(draftOf({ text: 'Hello Abel,\n\nDone.' })).map((s) => s.field), ['body'], 'no subject line: the body only');
  assert.deepEqual(emailInserts(null), []);
  assert.deepEqual(emailExpect(d), { email: true, table: 'incident', sysId: SYS });
  assert.equal(emailExpect({ email: { table: 'incident', sysId: 'x' } }), null);
  // used up when both went in, not after the first
  const both = { insert: specs };
  let step = afterInsert([], { field: 'subject' }, both);
  assert.equal(step.complete, false);
  step = afterInsert(step.done, { field: 'body' }, both);
  assert.equal(step.complete, true);
  assert.equal(afterInsert([], { field: 'body' }, { insert: emailInserts(draftOf({ text: 'Hello Abel,\n\nDone.' })) }).complete, true);
});

test('where an email insert lands, and the next step: nothing is sent until Send', () => {
  const subject = describeInsert({ field: 'subject', fieldLabel: 'Subject', mode: 'replace' });
  const body = describeInsert({ field: 'body', fieldLabel: 'Body', mode: 'append' });
  assert.equal(subject.where, 'Replaces what is in the email subject.');
  assert.equal(body.where, 'Goes below what is in the email body.');
  for (const d of [subject, body]) {
    assert.equal(d.next, 'Nothing is sent until you press Send in the email form.');
    assert.equal(d.caution, '');
  }
  assert.equal(insertedNote({ ok: true, method: 'gform' }, { field: 'body', mode: 'append' }), 'Inserted. Review it. Nothing is sent until you press Send in the email form.');
  const targets = insertTargets({ id: feature.id, insert: emailInserts(draftOf()) }, { page: emailPage() });
  assert.deepEqual(targets.map((t) => [t.field, t.mode, t.modes]), [['subject', 'replace', ['replace']], ['body', 'append', ['replace', 'append']]]);
  // the ticket's own boxes are unchanged
  assert.equal(describeInsert({ field: 'comments' }).next, 'Then press Save. The customer may be emailed.');
});

// ---- The card on the email form ------------------------------------------------------------------------------------------------

function chromeForEmail({ states = null, fill = () => ({ ok: true, method: 'gform' }) } = {}) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('insertTargets', (args) => ({ form: 'gform', match: true, fields: Object.fromEntries((args.fields || []).map((f) => [f.name, { state: states?.[f.name] || 'editable' }])) }));
  fake.onFill(fill);
  const copied = fakeClipboard();
  return { fake, copied };
}
const auditOf = (fake) => fake.chrome.storage.local.data[AUDIT_KEY] || [];

test('on the email form of its ticket the draft is shown, AI-marked, with Insert subject, Insert body, Copy body and Close', async () => {
  const { fake } = chromeForEmail();
  forgetInserts();
  clearPending();
  setPending(draftOf());
  const ui = await mount(<PendingDraft page={emailPage()} eff={effOf()} />);
  try {
    assert.match(ui.text(), /Email draft for INC0010001/);
    assert.ok(ui.$('.ab-ai-badge'), 'the AI mark');
    assert.match(ui.text(), /Update on your VPN problem/);
    const row = ui.$$('.ab-pending-email-actions button').map((b) => b.textContent.trim());
    assert.deepEqual(row, ['Insert subject', 'Insert body', 'Copy body'], 'at most four buttons; Close is in the title row');
    assert.ok(ui.hasButton('Close'));
    assert.match(ui.text(), /Nothing is sent until you press Send in the email form/);
    // the page was asked whether it has the two boxes, for this ticket's email form only
    const asked = fake.readsOf('insertTargets')[0];
    assert.deepEqual(asked.fields.map((f) => f.name), ['subject', 'body']);
    assert.deepEqual(asked.expect, { email: true, table: 'incident', sysId: SYS });
    assert.equal(fake.fills().length, 0, 'nothing is written just by showing it');
  } finally {
    await ui.unmount();
    clearPending();
  }
});

test("it is not shown on another ticket's email form, on the ticket, or on another site", async () => {
  chromeForEmail();
  clearPending();
  setPending(draftOf());
  for (const page of [emailPage(SYS_B), ticketPage(), emailPage(SYS, { origin: 'https://other.service-now.com' })]) {
    const ui = await mount(<PendingDraft page={page} eff={effOf()} />);
    try {
      assert.equal(ui.text(), '', page.href);
    } finally {
      await ui.unmount();
    }
  }
  clearPending();
});

test('Insert subject replaces, Insert body appends, each into the email form of that ticket; after both the draft is gone', async () => {
  const { fake } = chromeForEmail();
  forgetInserts();
  clearPending();
  setPending(draftOf({ provider: 'anthropic', model: 'claude-test' }));
  const ui = await mount(<PendingDraft page={emailPage()} eff={effOf()} />);
  try {
    await click(ui.button('Insert subject'));
    await settle(4);
    let fills = fake.fills();
    assert.equal(fills.length, 1);
    assert.deepEqual([fills[0].field, fills[0].mode, fills[0].value], ['subject', 'replace', 'INC0010001: Update on your VPN problem']);
    assert.deepEqual(fills[0].expect, { email: true, table: 'incident', sysId: SYS }, 'only the email form of this ticket');
    assert.equal(fills[0].label, 'Subject', 'the box is found by its own label on a page without g_form');
    assert.match(ui.text(), /Inserted\. Review it\. Nothing is sent until you press Send in the email form\./);
    assert.ok(ui.hasButton('Subject inserted'));
    assert.ok(getPending(), 'still there: the body is to come');

    await click(ui.button('Insert body'));
    await settle(4);
    fills = fake.fills();
    assert.equal(fills.length, 2);
    assert.deepEqual([fills[1].field, fills[1].mode], ['body', 'append']);
    assert.match(fills[1].value, /^Hello Abel Tuter,/);
    assert.ok(!fills[1].value.includes('Subject:'));
    // used up: the card goes, one line stays while this email form is open
    assert.equal(getPending(), null);
    assert.match(ui.text(), /The draft is in the email form\. Review it\. Nothing is sent until you press Send/);
    assert.ok(!ui.hasButton('Insert body'));
    // only the two FILL_FIELD messages and the READ were sent: no save, no send, nothing else
    assert.deepEqual([...new Set(fake.sent.map((s) => s.message.type))].sort(), ['ab:fill-field', 'ab:read'].sort());
    await settle(4);
    const audit = auditOf(fake);
    assert.deepEqual(audit.map((e) => [e.feature, e.table, e.outcome, e.provider, e.model]), [
      ['email-status-update', 'incident', 'inserted', 'anthropic', 'claude-test'],
      ['email-status-update', 'incident', 'inserted', 'anthropic', 'claude-test'],
    ]);
    assert.ok(audit.every((e) => e.record && !JSON.stringify(e).includes(SYS)), 'the record is a salted hash; no text in the log');
    await click(ui.button('Close'));
    assert.equal(ui.text(), '');
  } finally {
    await ui.unmount();
    clearPending();
  }
});

test('the review runs first: a card number in the body stops it, nothing is written until "Insert anyway"', async () => {
  const { fake } = chromeForEmail();
  forgetInserts();
  clearPending();
  setPending(draftOf({ text: 'Subject: Your card\n\nHello Abel,\n\nThe card 4111 1111 1111 1111 was refused.' }));
  const ui = await mount(<PendingDraft page={emailPage()} eff={effOf()} />);
  try {
    await click(ui.button('Insert body'));
    await settle(4);
    assert.equal(fake.fills().length, 0, 'stopped before anything was written');
    assert.match(ui.text(), /Check before sending to the customer/);
    assert.ok(ui.hasButton('Edit first'));
    await click(ui.button('Insert anyway'));
    await settle(4);
    assert.equal(fake.fills().length, 1);
    assert.equal(fake.fills()[0].field, 'body');
  } finally {
    await ui.unmount();
    clearPending();
  }
});

test('a box the form does not have is said before the click; a failed insert copies instead; Close drops the draft', async () => {
  const { fake, copied } = chromeForEmail({ states: { subject: 'missing' }, fill: () => ({ ok: false, reason: 'no-form' }) });
  forgetInserts();
  clearPending();
  setPending(draftOf());
  const ui = await mount(<PendingDraft page={emailPage()} eff={effOf()} />);
  try {
    assert.equal(ui.button('Insert subject').disabled, true);
    assert.match(ui.text(), /Subject is not on this form, so this cannot be inserted here\. Use Copy\./);
    await click(ui.button('Insert body'));
    await settle(4);
    assert.equal(fake.fills().length, 1);
    assert.match(ui.text(), /could not reach a form field on this page\. Copied to the clipboard instead\./);
    assert.match(copied[0], /^Hello Abel Tuter,/);
    assert.ok(getPending(), 'not used up by a failed insert');
    await click(ui.button('Close'));
    assert.equal(getPending(), null);
    assert.equal(ui.text(), '');
  } finally {
    await ui.unmount();
    clearPending();
  }
});

// ---- The answer on the Ticket screen -------------------------------------------------------------------------------------------

function Screen({ page, eff }) {
  const assist = useAnswers({ page, eff, record: page.record });
  return (
    <div>
      <AnswerArea assist={assist} page={page} eff={eff} record={page.record} active />
      <button type="button" disabled={assist.busy} onClick={() => assist.run(feature)}>Draft email</button>
    </div>
  );
}

function setupTicket(answer = EMAIL) {
  forgetAnswers();
  forgetInserts();
  clearPending();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch(answer);
  const copied = fakeClipboard();
  const created = [];
  fake.chrome.tabs.create = (props) => {
    created.push(props);
    return Promise.resolve({ id: 9 });
  };
  fake.onRead('pack', () => ({
    version: 1,
    table: 'incident',
    sysId: SYS,
    number: 'INC0010001',
    kind: 'incident',
    fields: { number: 'INC0010001', short_description: 'VPN drops every hour', state: 'In Progress' },
    people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
    journal: [],
    related: {},
    access: [],
  }));
  fake.onRead('insertTargets', (args) => ({ form: 'gform', match: true, fields: Object.fromEntries((args.fields || []).map((f) => [f.name, { state: 'editable' }])) }));
  return { fake, copied, created };
}

test('an email answer offers Open the email form and Copy body (Copy subject and Copy all under More), and inserts nothing into the ticket', async () => {
  const { fake, copied } = setupTicket();
  const ui = await mount(<Screen page={ticketPage()} eff={effOf()} />);
  try {
    await click(ui.button('Draft email'));
    await settle(6);
    const card = ui.$('section.ab-answer');
    const row = [...card.querySelectorAll('.ab-answer-actions button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(row, ['Open the email form', 'Copy body', 'Refine', 'More'], 'four buttons at most; Refine and More stay');
    assert.ok(card.querySelector('.ab-answer-main').textContent.includes('Open the email form'), 'the main button');
    assert.match(card.textContent, /Nothing is sent until you press Send/);
    await click(ui.button('Copy body'));
    assert.match(copied[0], /^Hello Abel Tuter,/);
    assert.ok(!copied[0].includes('Subject:'));
    await click(ui.button(/^More/));
    await click(ui.button('Copy subject'));
    assert.equal(copied[1], 'Update on your VPN problem');
    await click(ui.button(/^More/));
    await click(ui.button('Copy all'));
    assert.match(copied[2], /^Subject: Update on your VPN problem/);
    assert.equal(fake.fills().length, 0, 'nothing went into the ticket form');
  } finally {
    await ui.unmount();
  }
});

test('Open the email form carries the draft and opens the email client of THIS ticket in a new tab; the draft waits there', async () => {
  const { fake, created } = setupTicket();
  const eff = effOf();
  const ui = await mount(<Screen page={ticketPage()} eff={eff} />);
  try {
    await click(ui.button('Draft email'));
    await settle(6);
    await click(ui.button('Open the email form'));
    await settle(4);
    assert.equal(created.length, 1, 'a new tab');
    assert.equal(created[0].url, emailFormUrl(ticketPage().href, { table: 'incident', sysId: SYS }));
    assert.equal(fake.updates.length, 0, 'the ticket tab stays where it is');
    assert.match(ui.text(), /The email form opened in a new tab/);
    const d = getPending();
    assert.ok(d, 'the draft is kept');
    assert.deepEqual(d.email, { table: 'incident', sysId: SYS });
    assert.equal(d.origin, ORIGIN);
    assert.equal(d.number, 'INC0010001');
    assert.equal(d.subject, 'INC0010001: Update on your VPN problem');
    assert.equal(d.feature.id, 'email-status-update');
    assert.equal(typeof d.scan, 'function', 'the firewall memory for the review (memory only)');
    assert.ok(d.people.some((p) => p.name === 'Abel Tuter'));
    assert.equal(d.provider, 'anthropic');
    // nothing of it went to storage
    const stored = JSON.stringify([fake.chrome.storage.local.data, fake.chrome.storage.session.data, fake.chrome.storage.sync.data]);
    assert.ok(!stored.includes('VPN problem') && !stored.includes('Abel'), 'no ticket content in chrome.storage');
  } finally {
    await ui.unmount();
  }
  // The panel follows the new tab: on the email form of the ticket the card is there, and it inserts.
  const there = await mount(<PendingDraft page={emailPage()} eff={eff} />);
  try {
    assert.match(there.text(), /Email draft for INC0010001/);
    await click(there.button('Insert subject'));
    await settle(4);
    const fill = fake.fills().slice(-1)[0];
    assert.deepEqual([fill.field, fill.value, fill.expect], ['subject', 'INC0010001: Update on your VPN problem', { email: true, table: 'incident', sysId: SYS }]);
  } finally {
    await there.unmount();
    clearPending();
  }
});

test('without a ticket to bind to the answer offers Copy body as its main button and no email form', async () => {
  setupTicket();
  // a page without an https site: no email form address can be built (emailFormUrl), and no draft could be bound
  const page = { ...ticketPage(), href: `http://acme.service-now.com/incident.do?sys_id=${SYS}` };
  const ui = await mount(<Screen page={page} eff={effOf()} />);
  try {
    await click(ui.button('Draft email'));
    await settle(6);
    const card = ui.$('section.ab-answer');
    const row = [...card.querySelectorAll('.ab-answer-actions button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(row, ['Copy body', 'Refine', 'More']);
    assert.ok(card.querySelector('.ab-answer-main').textContent.includes('Copy body'));
    assert.equal(getPending(), null);
  } finally {
    await ui.unmount();
  }
});

test('the subject keeps the ticket number the email form had put there, so a reply can be matched to the ticket', () => {
  assert.equal(subjectWithNumber('Your VPN is working again', 'INC0010001'), 'INC0010001: Your VPN is working again');
  assert.equal(subjectWithNumber('Re INC0010001 - VPN fixed', 'INC0010001'), 'Re INC0010001 - VPN fixed', 'already named: left as it is');
  assert.equal(subjectWithNumber('About inc0010001', 'INC0010001'), 'About inc0010001', 'in any case');
  assert.equal(subjectWithNumber('No number known', ''), 'No number known');
  assert.equal(subjectWithNumber('Odd number', 'not a number!'), 'Odd number', 'only a real ticket number is added');
  assert.equal(subjectWithNumber('', 'INC0010001'), '', 'no subject, nothing to add to');
  assert.equal(subjectWithNumber('x'.repeat(300), 'CS0001001').length, 200);
});
