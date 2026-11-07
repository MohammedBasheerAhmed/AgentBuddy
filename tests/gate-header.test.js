import { mount, settle, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import {
  HEADER_BLOCKED, HEADER_DENIED, HEADER_NOT_TICKET, HEADER_UNAVAILABLE, describeHeader, headerPhase, headerPhaseFor, phaseOfError,
} from '../src/sidepanel/recordHeader.js';
import { buildGlance } from '../src/insights/glance.js';
import { tableLabel } from '../src/lib/tableLabels.js';
import { setLanguage } from '../src/i18n/index.js';
import { AR_GATE } from '../src/i18n/ar/gate.js';

// The header card and the glance say a failure by its cause, and never print a table name (audit of 2026-11-07, part 2: the owner's
// home page showed "ui_page" and "Details are not available to you.").

test.afterEach(() => setLanguage('en'));

const ID = 'a'.repeat(32);
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

// ---- no table name on the screen ---------------------------------------------------------------------------------------------------

test('the number slot holds the number, else a plain word: never the table name', () => {
  for (const table of ['ui_page', 'sys_ui_page', 'incident', 'sc_req_item', 'sn_hr_core_case', 'kb_knowledge', 'u_facilities_request', 'x_acme_visit_log']) {
    for (const phase of ['loading', 'ready', 'failed', 'blocked', 'unavailable']) {
      const card = describeHeader({ phase, header: phase === 'ready' ? { short_description: 'x' } : null }, { table, sysId: ID });
      assert.notEqual(card.number, table, `${table} / ${phase}`);
      assert.ok(card.number && !card.number.includes('_'), `${table} / ${phase}: "${card.number}"`);
      assert.equal(card.number, tableLabel(table, { sentenceCase: true }), 'the plain word is the table\'s label');
    }
  }
  // the record's own number first, then the header's
  assert.equal(describeHeader({ phase: 'loading', header: null }, { table: 'incident', sysId: ID, number: 'INC0010001' }).number, 'INC0010001');
  assert.equal(describeHeader({ phase: 'ready', header: { number: 'INC0010002' } }, { table: 'incident', sysId: ID }).number, 'INC0010002');
  assert.equal(describeHeader({ phase: 'failed', header: { number: 'INC0010003' } }, { table: 'incident', sysId: ID }).number, 'INC0010003');
  // a page that is no ticket's has no number to show
  assert.equal(describeHeader({ phase: 'not-ticket', header: null }, { table: 'ui_page', sysId: ID }).number, '');
});

test('the table is not a tag (tags: [table] reached no view, and now cannot)', () => {
  const record = { table: 'u_facilities_request', sysId: ID };
  for (const state of [
    { phase: 'loading', header: null },
    { phase: 'failed', header: null },
    { phase: 'not-ticket', header: null },
    { phase: 'ready', header: { number: 'FAC1', short_description: 'Door', state: 'New', priority: '3 - Moderate' } },
    { phase: 'ready', header: { number: 'FAC1' } },
  ]) {
    const card = describeHeader(state, record);
    assert.ok(!card.tags.some((tag) => /facilities|u_/.test(tag)), JSON.stringify(card.tags));
  }
  assert.deepEqual(describeHeader({ phase: 'ready', header: { short_description: 'Door', state: 'New', priority: '3 - Moderate' } }, record).tags, ['New', '3 - Moderate']);
});

// ---- failures by cause ---------------------------------------------------------------------------------------------------------------

test('the sentence of each cause: only a refusal says the details are not available to you', () => {
  const record = { table: 'incident', sysId: ID, number: 'INC0010001' };
  const said = (phase) => describeHeader({ phase, header: null }, record);
  assert.deepEqual([said('failed').title, said('failed').titleKind], ['Details are not available to you.', 'denied']);
  assert.deepEqual([said('not-ticket').title, said('not-ticket').titleKind], ['This page is not a ticket.', 'not-ticket']);
  assert.deepEqual([said('blocked').title, said('blocked').titleKind], ['Your organisation does not let Agent Buddy read this.', 'blocked']);
  assert.deepEqual([said('unavailable').title, said('unavailable').titleKind], ['Details could not be loaded. Try again in a moment.', 'unavailable']);
  assert.equal(HEADER_DENIED, 'Details are not available to you.');
  assert.equal(HEADER_NOT_TICKET, 'This page is not a ticket.');
  assert.equal(HEADER_BLOCKED, 'Your organisation does not let Agent Buddy read this.');
  assert.equal(HEADER_UNAVAILABLE, 'Details could not be loaded. Try again in a moment.');
  const titles = new Set(['failed', 'not-ticket', 'blocked', 'unavailable', 'loading'].map((phase) => said(phase).title));
  assert.equal(titles.size, 5, 'five different sentences');
  for (const title of titles) assert.ok(!/ui_page|sys_id|\b40\d\b|table/i.test(title), title);
});

test('an unknown phase shows what a ready header with nothing in it shows, never a made-up refusal', () => {
  const card = describeHeader({ phase: 'surprise', header: null }, { table: 'incident', sysId: ID });
  assert.notEqual(card.title, HEADER_DENIED);
});

test('a row of blank columns: an access rule on a ticket, but only "not a ticket" on a table that has no ticket columns', () => {
  const blank = { number: '', short_description: '', state: '', priority: '' };
  assert.equal(headerPhase(blank), 'failed');
  // tickets (and the organisation's own families, and a form that carried a number): blank means the ACL emptied the row
  for (const record of [{ table: 'incident' }, { table: 'sn_hr_core_case' }, { table: 'kb_knowledge' }, { table: 'sn_si_incident' }, { table: 'u_facilities_request', number: 'FAC0001234' }]) {
    assert.equal(headerPhaseFor(blank, record), 'failed', JSON.stringify(record));
  }
  assert.equal(headerPhaseFor(blank, { table: 'x_acme_hr_case' }, ['x_acme_hr_']), 'failed');
  // anything else
  for (const record of [{ table: 'ui_page' }, { table: 'sys_user' }, { table: 'u_facilities_request' }, { table: 'x_acme_hr_case' }, { table: 'u_x', number: '  ' }]) {
    assert.equal(headerPhaseFor(blank, record), 'not-ticket', JSON.stringify(record));
  }
  // readable stays readable
  assert.equal(headerPhaseFor({ number: 'FAC1', short_description: '', state: '', priority: '' }, { table: 'ui_page' }), 'ready');
  for (const odd of [null, undefined, 'text', 5]) assert.equal(headerPhaseFor(odd, { table: 'incident' }), 'failed');
  assert.equal(headerPhaseFor(null, { table: 'ui_page' }), 'not-ticket');
});

test('a failed read is worded by its cause', () => {
  const err = (code, message = '') => Object.assign(new Error(message), { code });
  // a 403, or a record the user cannot see
  assert.equal(phaseOfError(err('ACCESS_DENIED', 'Your user is not allowed to read this (403).')), 'failed');
  assert.equal(phaseOfError(err('NOT_FOUND', 'The record is not available to you.')), 'failed');
  // the organisation's block
  assert.equal(phaseOfError(err('BLOCKED_TABLE', 'Your organisation does not allow Agent Buddy to read incident records.')), 'blocked');
  // the instance says the table is not there
  assert.equal(phaseOfError(err('', 'Table API query on "ui_page" failed (400): Invalid table ui_page')), 'not-ticket');
  assert.equal(phaseOfError(err('', 'Table API query on "x" failed (404)')), 'not-ticket');
  assert.equal(phaseOfError({ message: 'No such table here' }), 'not-ticket');
  // the read did not get through: not an access decision
  for (const code of ['SESSION_EXPIRED', 'LOST_TOUCH', 'SN_RATE_LIMITED', 'SN_UNAVAILABLE', 'SN_NOT_DATA', 'SN_TIMEOUT']) assert.equal(phaseOfError(err(code, 'x')), 'unavailable', code);
  // anything else is not "not available to you" either
  for (const odd of [err(''), err('', 'Something broke (500)'), null, undefined, 'text', {}, { code: 5 }]) assert.equal(phaseOfError(odd), 'unavailable', String(odd));
  // the message of a 403 that happens to say "404" does not turn into a missing table
  assert.equal(phaseOfError(err('ACCESS_DENIED', 'Your user is not allowed to read this (403): see article 404.')), 'failed');
});

// ---- the glance ------------------------------------------------------------------------------------------------------------------------

test('the glance of a record never prints the table name, whatever the header read says', () => {
  const record = { table: 'ui_page', sysId: ID, number: '', kind: 'other' };
  for (const [headPhase, header] of [['loading', null], ['failed', null], ['not-ticket', null], ['blocked', null], ['unavailable', null], ['ready', { number: '', short_description: '', state: 'New', priority: '' }]]) {
    const g = buildGlance({ record, header, headPhase, answer: null, now: NOW });
    assert.ok(!JSON.stringify(g).includes('ui_page'), `${headPhase}: ${JSON.stringify(g)}`);
  }
  const g = buildGlance({ record, header: null, headPhase: 'not-ticket', answer: null, now: NOW });
  assert.deepEqual([g.number, g.title, g.titleKind], ['', 'This page is not a ticket.', 'not-ticket']);
});

test('a glance read that has the title still gives it when the header failed (as before)', () => {
  const record = { table: 'incident', sysId: ID, number: 'INC0010001', kind: 'incident' };
  const answer = { pack: { fields: { short_description: 'VPN keeps disconnecting' }, journal: [] } };
  const g = buildGlance({ record, header: null, headPhase: 'failed', answer, now: NOW });
  assert.equal(g.title, 'VPN keeps disconnecting');
  assert.equal(g.number, 'INC0010001');
});

// ---- Arabic ----------------------------------------------------------------------------------------------------------------------------

test('Arabic: every new sentence of a cause has an entry, and no two share a translation', () => {
  for (const english of [HEADER_NOT_TICKET, HEADER_BLOCKED, HEADER_UNAVAILABLE]) {
    assert.ok(typeof AR_GATE[english] === 'string' && AR_GATE[english].length > 5, english);
    assert.ok(/[؀-ۿ]/.test(AR_GATE[english]), english);
    assert.ok(!/[ً-ْ]/.test(AR_GATE[english]), 'no tashkeel');
  }
  assert.equal(new Set(Object.values(AR_GATE)).size, Object.keys(AR_GATE).length, 'no two sentences share one translation');
});

// ---- the Ticket screen ---------------------------------------------------------------------------------------------------------------

const ORIGIN = 'https://dev364920.service-now.com';
const eff = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'], profilesConfirmed: true }, {}), apiKey: '', keyLocked: false };
const pageOf = (record) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/x`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth' } });

/** The Ticket screen of a record whose header read fails with this error (or answers with this). */
async function screenWith(record, headerRead) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('header', headerRead);
  const ui = await mount(<TicketView page={pageOf(record)} eff={eff} />);
  await settle();
  const text = ui.text();
  await ui.unmount();
  return text;
}
const failing = (code, message) => () => {
  throw Object.assign(new Error(message), { code });
};

test('the Ticket screen words a failed header read by its cause, and never shows the table name', async () => {
  const record = { table: 'incident', sysId: ID, number: 'INC0010001', kind: 'incident' };
  const denied = await screenWith(record, failing('ACCESS_DENIED', 'Your user is not allowed to read this (403).'));
  assert.match(denied, /Details are not available to you./);
  const blocked = await screenWith(record, failing('BLOCKED_TABLE', 'Your organisation does not allow Agent Buddy to read incident records.'));
  assert.match(blocked, /Your organisation does not let Agent Buddy read this./);
  assert.ok(!/not available to you/.test(blocked));
  const lost = await screenWith(record, failing('SESSION_EXPIRED', 'Your ServiceNow session has expired.'));
  assert.match(lost, /Details could not be loaded. Try again in a moment./);
  assert.ok(!/not available to you/.test(lost));
  // the instance has no such table: the page is not a ticket, and the table is not named
  const odd = { table: 'ui_page', sysId: ID, number: '', kind: 'other' };
  const missing = await screenWith(odd, failing('', 'Table API query on "ui_page" failed (400): Invalid table ui_page'));
  assert.match(missing, /This page is not a ticket./);
  assert.ok(!/not available to you|ui_page/.test(missing), missing);
  // a row with nothing readable in it: an access rule on a ticket, but only "not a ticket" on a table that has no ticket columns
  const blank = () => ({ number: '', short_description: '', state: '', priority: '' });
  assert.match(await screenWith(record, blank), /Details are not available to you./);
  const page = await screenWith(odd, blank);
  assert.match(page, /This page is not a ticket./);
  assert.ok(!/not available to you|ui_page/.test(page), page);
});

test('the Ticket screen of a record whose number is not known yet shows a plain word, not the table name', async () => {
  const text = await screenWith({ table: 'sc_req_item', sysId: ID, number: '', kind: 'requested_item' }, () => new Promise(() => {}));
  assert.ok(!text.includes('sc_req_item'), text);
  assert.match(text, /Loading…/);
});
