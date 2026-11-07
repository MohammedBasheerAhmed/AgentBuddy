import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readJson } from '../src/content/tableApi.js';
import { classifyReadError, confirmEmptyIsReallyEmpty, softRead } from '../src/context/access.js';
import { accessLine, describeAccess, plainNote, plainSource } from '../src/sidepanel/plainAccess.js';
import { plainError } from '../src/sidepanel/ask.js';
import ErrorNote from '../src/sidepanel/ErrorNote.jsx';
import { Notes, ReadState, accessLines } from '../src/sidepanel/ticket/cards/bits.jsx';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_NOTES } from '../src/i18n/ar/notes.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

// Audit of 2026-11-07, workstream "notes and errors" (root cause 2): the engine reports the table it tried, and a table the panel did not
// list showed up in a sentence a person reads. Sixty names go through the whole path, in English and in Arabic: the read layer's error,
// the access entry, the line under a card, the error note, and the sentences older readers wrote with the name inside.
registerCatalogue('ar', AR_NOTES);
registerCatalogue('ar', AR_LABELS);

test.afterEach(() => setLanguage('en'));

const OUT_OF_THE_BOX = [
  'sys_audit', 'sc_cat_item', 'cmdb_ci_server', 'sys_user_grmember', 'csm_consumer', 'live_group_profile', 'sys_choice', 'kb_article',
  'incident_task', 'problem_task', 'sn_customerservice_task', 'sn_hr_core_task', 'sys_db_object', 'sys_documentation', 'sc_category',
  'task_ci', 'cmn_department', 'cmn_location', 'core_company', 'alm_hardware', 'sys_attachment', 'sys_email', 'ecc_queue',
  'sn_si_incident', 'sn_vul_vulnerable_item', 'cmdb_rel_ci', 'cmdb_ci_appl', 'sys_dictionary', 'sys_update_xml', 'customer_account',
];
const CUSTOM = [
  'u_vendor_ticket', 'u_site_visit', 'u_facilities_request', 'u_my_table', 'u_cost_center_owner', 'x_acme_visit_log', 'x_snc_app_widget',
  'x_1234_long_scope_table', 'u_a', 'u_hr_leave', 'u_it_asset', 'u_x_y_z',
];
const KNOWN = [
  'incident', 'problem', 'task', 'interaction', 'change_request', 'sc_request', 'sc_req_item', 'sc_task', 'kb_knowledge', 'kb_use',
  'm2m_kb_task', 'task_sla', 'sysapproval_approver', 'sys_user', 'sys_user_group', 'sn_customerservice_case', 'sn_hr_core_case', 'cmdb_ci',
  'sys_journal_field', 'sc_item_option_mtom',
];
const TABLES = [...OUT_OF_THE_BOX, ...CUSTOM, ...KNOWN];

test('the table list is what the audit asked for: about sixty names, unlisted, custom and one-word ones among them', () => {
  assert.ok(TABLES.length >= 60, String(TABLES.length));
  assert.equal(new Set(TABLES).size, TABLES.length);
  assert.ok(TABLES.some((n) => !n.includes('_')), 'one-word names');
});

const response = (status, body = '') => ({ ok: status >= 200 && status < 300, status, redirected: false, url: '', headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const snError = (message, detail = null) => ({ error: { message, detail }, status: 'failure' });
const failureOf = async (res, what) => {
  try {
    await readJson(res, what);
  } catch (err) {
    return err;
  }
  throw new Error('readJson did not throw');
};

/** The errors a read of `table` can raise: from the read layer (answers of every kind), and the messages older code wrote by hand. */
async function errorsOf(table) {
  const what = `Table API query on "${table}"`;
  const fromLayer = [
    await failureOf(response(403, snError('Insufficient rights to query records', 'Field(s) present in the query do not have permission to be read')), what),
    await failureOf(response(403, snError('User Not Authorized', 'Failed API level ACL Validation')), what),
    await failureOf(response(400, snError(`Invalid table ${table}`)), what),
    await failureOf(response(404, ''), what),
    await failureOf(response(500, snError('java.lang.NullPointerException')), what),
    await failureOf(response(429, ''), what),
    await failureOf(response(503, ''), what),
    await failureOf(response(200, '<html>maintenance</html>'), what),
  ];
  const byHand = [
    Object.assign(new Error(`Your user is not allowed to read this (403): Access to ${table} is denied by ACL.`), { code: 'ACCESS_DENIED' }),
    new Error(`Table API query on "${table}" failed (500): boom`),
    new Error(`Invalid table ${table}`),
    Object.assign(new Error(`Your organisation does not allow Agent Buddy to read ${table} records.`), { code: 'BLOCKED_TABLE' }),
    Object.assign(new Error(`The record was not found in ${table}, or your user cannot see it.`), { code: 'NOT_FOUND' }),
    new Error(`Count on "${table}" failed (500)`),
    new Error(`Breakdown of "${table}" by assigned_to failed (500)`),
  ];
  return [...fromLayer, ...byHand];
}

/** The sentences older readers wrote with the name inside, as they reach plainNote. */
const OLD_SENTENCES = (table) => [
  `Your user cannot read ${table}.`,
  `You cannot read ${table}.`,
  `${table} is not on this instance.`,
  `${table} on this instance does not have a column this read needs.`,
  `Could not read ${table}: Table API query on "${table}" failed (500): boom`,
  `Could not read ${table}: HTTP 500`,
  `Your user sees no rows of ${table} at all, so "none for this record" proves nothing: the instance may have none, or an access rule hides them.`,
  `Your organisation does not allow reading ${table}.`,
  `Your organisation does not allow Agent Buddy to read ${table} records.`,
  `${table} did not apply the filter on this ticket, so it was not used.`,
  `Could not check ${table} by u_site: the instance did not apply the filter, so its rows were not used.`,
  `Could not check ${table}: cmdb_ci, u_site may not be read for this kind of record.`,
  `The record was not found in ${table}, or your user cannot see it.`,
  `Your user is not allowed to read this (403): Security constraints prevent access to ${table}.`,
];

/** Does `text` still show `table` as it is written in the database? */
function showsTheName(text, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (table.includes('_')) return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(text);
  // a one-word name is an ordinary word: it counts where a table name stands (after a verb or a preposition, or in quotes)
  return new RegExp(`(?:\\b(?:read|reading|see|find|check|checking|in|of|on|from|for|by|rows of|table)\\s+|["'\`])${escaped}(?=[\\s.,;:)"'\`]|$)`, 'i').test(text);
}
const FORBIDDEN = [/\byour user\b/i, /\b403\b/, /\b[1-5]\d\d\)/, /Table API/i, /\bTable API query\b/, /sysparm/i, /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/];

function check(text, table, where) {
  assert.equal(typeof text, 'string', where);
  assert.ok(text.trim(), `${where}: empty`);
  assert.equal(showsTheName(text, table), false, `${where}: shows ${table}: ${text}`);
  for (const re of FORBIDDEN) assert.doesNotMatch(text, re, `${where}: ${text}`);
}

for (const language of ['en', 'ar']) {
  test(`${language}: ${TABLES.length} table names go through the read layer, the access entry, the line under a card and the error note without showing a name, "your user", a code or "Table API"`, async () => {
    for (const table of TABLES) {
      setLanguage(language);
      // 1. the errors of every kind: as a message, as an entry, as a line, as a card note, as an error note
      for (const err of await errorsOf(table)) {
        const f = classifyReadError(err);
        const entry = { source: table, status: f.status, note: f.note };
        check(f.note, table, `${table} note`);
        check(plainError(err), table, `${table} plainError`);
        check(renderToStaticMarkup(React.createElement(ErrorNote, { error: err, onRetry: () => {} })).replace(/<[^>]*>/g, ' '), table, `${table} ErrorNote`);
        check(renderToStaticMarkup(React.createElement(ReadState, { state: { phase: 'error', data: null, error: err }, what: plainSource(table), onRetry: () => {} })).replace(/<[^>]*>/g, ' '), table, `${table} ReadState`);
        // (a skipped entry is left out quietly, a lost sign-in is thrown: only the others are drawn)
        for (const line of describeAccess([entry])) check(line, table, `${table} line`);
        const markup = renderToStaticMarkup(React.createElement(Notes, { access: [entry] })).replace(/<[^>]*>/g, ' ');
        if (markup.trim()) check(markup, table, `${table} Notes`);
        for (const line of accessLines([entry])) check(line, table, `${table} accessLines`);
      }
      // 2. an empty answer that proves nothing
      const hidden = await confirmEmptyIsReallyEmpty(table, fakeDeps({ [table]: [] }));
      check(accessLine({ source: table, ...hidden }), table, `${table} hidden`);
      const denied = await softRead(fakeDeps({ [table]: [] }, { denied: [table] }), table, '', ['sys_id']);
      check(accessLine({ source: table, ...denied.failure }), table, `${table} denied`);
      // 3. the label of the source itself
      check(plainSource(table), table, `${table} source`);
      // 4. the sentences older readers wrote with the name inside
      for (const sentence of OLD_SENTENCES(table)) check(plainNote(sentence), table, `${table} <- ${sentence}`);
      for (const sentence of OLD_SENTENCES(table)) check(accessLine({ source: table, status: 'denied', note: sentence }), table, `${table} line <- ${sentence}`);
    }
  });
}

test('in Arabic the line under a card is Arabic (not the English sentence with an Arabic label put in it)', () => {
  setLanguage('ar');
  for (const table of ['incident', 'u_vendor_ticket', 'sys_audit', 'cmdb_ci_server']) {
    const [line] = describeAccess([{ source: table, status: 'denied', note: 'Not available to you with your role.' }]);
    assert.ok(/[؀-ۿ]/.test(line), line);
    assert.doesNotMatch(line, /Not available|not available|You cannot|with your role/);
  }
});
