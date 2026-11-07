import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { humanizeTable, isKnownTable, tableLabel, translateTableNoun } from '../src/lib/tableLabels.js';
import { getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';
import { collect, walk } from '../scripts/lib/i18nCheck.js';

// The shared label of a table (src/lib/tableLabels.js, audit of 2026-11-07 root cause 2): a person never reads a table name. Every
// table ServiceNow ships has a plain noun, singular and plural, in English and Arabic; a custom table is called what the instance
// calls it, or its name made into words; text that is no table name at all is "record".

registerCatalogue('ar', AR_LABELS); // (the lead adds the same entries to src/i18n/ar/index.js; this test needs only these)

const SHIPPED = [
  'incident', 'incident_task', 'problem', 'problem_task', 'change_request', 'change_task', 'task', 'task_ci',
  'sc_request', 'sc_req_item', 'sc_task', 'sc_cat_item', 'sc_category', 'sc_item_option_mtom', 'sc_item_option', 'item_option_new',
  'sn_customerservice_case', 'sn_customerservice_task', 'csm_consumer', 'customer_contact', 'customer_account',
  'sn_hr_core_case', 'sn_hr_core_task', 'sn_hr_core_service', 'sn_hr_core_profile',
  'kb_knowledge', 'kb_use', 'm2m_kb_task', 'kb_knowledge_base', 'kb_category',
  'task_sla', 'sysapproval_approver', 'sysapproval_group',
  'sys_user', 'sys_user_group', 'sys_user_grmember', 'sys_user_role', 'cmn_department', 'cmn_location', 'cmn_cost_center', 'core_company',
  'sys_audit', 'sys_journal_field', 'sys_attachment', 'sys_email',
  'interaction', 'live_group_profile', 'live_message', 'sys_cs_conversation', 'sys_cs_message', 'chat_queue_entry',
  'cmdb_ci', 'cmdb_ci_server', 'cmdb_ci_computer', 'cmdb_ci_win_server', 'cmdb_ci_linux_server', 'cmdb_ci_netgear', 'cmdb_ci_printer',
  'cmdb_ci_db_instance', 'cmdb_ci_appl', 'cmdb_ci_service', 'cmdb_ci_vm_instance', 'service_offering',
  'sn_si_incident', 'sn_si_task', 'sn_vul_vulnerable_item', 'sn_vul_vulnerability', 'sn_vul_remediation_task', 'sn_risk_risk',
  'sn_compliance_control', 'sn_grc_issue',
];
// Names the list above does not have: families of tables, add-on products, custom tables, scoped tables, odd input.
const OTHER = [
  'sn_hr_core_case_payroll', 'sn_hr_core_case_benefits', 'sn_hr_core_case_relations', 'sn_hr_le_case', 'sn_hr_er_case', 'sn_hr_core_case_workforce_admin_task',
  'sn_hr_core_task_survey', 'sn_hr_core_leave', 'sn_hr_sp_page', 'sn_customerservice_order', 'sn_customerservice_case_extra_task', 'csm_ticket',
  'sn_si_request', 'sn_si_playbook_task', 'sn_vul_scan', 'sn_vul_change_task', 'sn_grc_profile', 'sn_risk_assessment', 'sn_compliance_policy', 'sn_audit_engagement',
  'kb_feedback', 'kb_submission', 'cmdb_ci_mainframe', 'cmdb_ci_ip_router', 'cmdb_model', 'sys_choice', 'sys_properties', 'sys_db_object',
  'u_facilities_request', 'u_site_visit', 'u_hr_leave', 'u_it_asset_loan', 'u_access_card', 'x_acme_visit_log', 'x_acme_hr_onboarding', 'x_snc_widgets_order',
  'ui_page', 'compose', 'live_profile', 'sn_unknown_thing', 'sn_x', 'u_', 'x_acme_', 'a', 'sys_',
  '', ' ', 'Not A Table', 'incident; drop table', '../etc/passwd', 'x', 'U_UPPER_CASE', ' INCIDENT ',
];
const NAMES = [...SHIPPED, ...OTHER];

const rawName = (name) => String(name).trim().toLowerCase();
const isTableName = (name) => /^[a-z][a-z0-9_]*$/.test(rawName(name));

function check(label, name, where) {
  assert.equal(typeof label, 'string', where);
  assert.ok(label.trim().length > 0, `${where}: empty`);
  const bare = label.replace(/[⁦-⁩]/g, ''); // (isolation marks around a name made from the table's name)
  assert.ok(!bare.includes('_'), `${where}: has an underscore: ${bare}`);
  if (isTableName(name) && rawName(name).includes('_')) assert.notEqual(bare.toLowerCase(), rawName(name), `${where}: is the raw name`);
  assert.ok(!/\bsys_|\bsn_|\bx_|\bu_|_id\b/.test(bare), `${where}: names the platform: ${bare}`);
}

test('about eighty table names: none comes back empty, with an underscore or as its raw name, singular or plural, English or Arabic', () => {
  assert.ok(NAMES.length >= 80, `${NAMES.length} names`);
  const language = getLanguage();
  try {
    for (const lang of ['en', 'ar']) {
      setLanguage(lang);
      for (const name of NAMES) {
        for (const plural of [false, true]) {
          for (const sentenceCase of [false, true]) check(tableLabel(name, { plural, sentenceCase }), name, `${lang} ${JSON.stringify(name)} plural=${plural} sentenceCase=${sentenceCase}`);
          check(tableLabel(name, { plural, instanceLabel: 'Facilities Request' }), name, `${lang} ${JSON.stringify(name)} with an instance label`);
        }
      }
    }
  } finally {
    setLanguage(language);
  }
});

test('every shipped table has its own noun: plain English, a different plural, and an Arabic text', () => {
  const english = new Map();
  try {
    setLanguage('en');
    for (const name of SHIPPED) {
      const one = tableLabel(name);
      const many = tableLabel(name, { plural: true });
      assert.ok(isKnownTable(name), name);
      assert.match(one, /^[A-Za-z][A-Za-z -]*$/, `${name}: ${one}`);
      english.set(name, [one, many]);
      assert.notEqual(one, many, `${name}: the plural differs`);
    }
    setLanguage('ar');
    for (const name of SHIPPED) {
      const [one, many] = english.get(name);
      for (const [said, was] of [[tableLabel(name), one], [tableLabel(name, { plural: true }), many]]) {
        assert.match(said, /[؀-ۿ]/, `${name}: Arabic for ${was}`);
        assert.notEqual(said, was, `${name}: ${was} is translated`);
      }
    }
  } finally {
    setLanguage('en');
  }
});

test('the words people use: the service desk nouns for the tables an agent works with', () => {
  setLanguage('en');
  const say = (name, options) => tableLabel(name, options);
  assert.equal(say('incident'), 'incident');
  assert.equal(say('incident', { plural: true, sentenceCase: true }), 'Incidents');
  assert.equal(say('sc_req_item'), 'requested item');
  assert.equal(say('sc_req_item', { plural: true }), 'requested items');
  assert.equal(say('sc_task'), 'catalog task');
  assert.equal(say('change_request'), 'change');
  assert.equal(say('sn_hr_core_case'), 'HR case');
  assert.equal(say('sn_hr_core_case', { plural: true }), 'HR cases');
  assert.equal(say('sn_customerservice_case', { plural: true }), 'customer service cases');
  assert.equal(say('kb_knowledge'), 'knowledge article');
  assert.equal(say('kb_use', { plural: true }), 'article links');
  assert.equal(say('m2m_kb_task', { plural: true }), 'article links');
  assert.equal(say('task_sla', { plural: true }), 'SLAs');
  assert.equal(say('sysapproval_approver', { plural: true }), 'approvals');
  assert.equal(say('sys_user', { plural: true }), 'people');
  assert.equal(say('sys_user_grmember', { plural: true }), 'group memberships');
  assert.equal(say('sys_audit', { plural: true }), 'history');
  assert.equal(say('cmdb_ci', { plural: true }), 'configuration items');
  assert.equal(say('interaction', { plural: true }), 'chats');
  assert.equal(say('sys_cs_message', { plural: true }), 'chat messages');
  assert.equal(say(' INCIDENT '), 'incident', 'case and spaces do not matter');
});

test('a family of tables is called by its family: every HR case table is an HR case, an add-on keeps its product word', () => {
  setLanguage('en');
  for (const name of ['sn_hr_core_case_payroll', 'sn_hr_core_case_benefits', 'sn_hr_core_case_relations', 'sn_hr_le_case', 'sn_hr_er_case']) assert.equal(tableLabel(name), 'HR case', name);
  assert.equal(tableLabel('sn_hr_core_case_workforce_admin_task'), 'HR task', 'a task of the family stays a task');
  assert.equal(tableLabel('sn_hr_sp_page'), 'HR record');
  assert.equal(tableLabel('sn_si_request'), 'security record');
  assert.equal(tableLabel('sn_vul_scan'), 'vulnerability record');
  assert.equal(tableLabel('sn_vul_change_task'), 'remediation task');
  assert.equal(tableLabel('sn_grc_profile', { plural: true }), 'risk and compliance records');
  assert.equal(tableLabel('sn_audit_engagement'), 'risk and compliance record');
  assert.equal(tableLabel('csm_ticket'), 'customer service record');
  assert.equal(tableLabel('sn_customerservice_case_extra_task'), 'customer service task');
  assert.equal(isKnownTable('sn_hr_core_case_payroll'), true);
  assert.equal(isKnownTable('u_facilities_request'), false);
});

test('a table the list does not know: the instance\'s own label, else its name made into words', () => {
  setLanguage('en');
  assert.equal(tableLabel('u_facilities_request'), 'facilities request');
  assert.equal(tableLabel('u_facilities_request', { plural: true }), 'facilities requests');
  assert.equal(tableLabel('u_facilities_request', { plural: true, sentenceCase: true }), 'Facilities requests');
  assert.equal(tableLabel('x_acme_visit_log'), 'visit log');
  assert.equal(tableLabel('x_snc_widgets_order', { plural: true }), 'widgets orders');
  assert.equal(tableLabel('u_hr_leave'), 'HR leave', 'a short word that is always capitals keeps them');
  assert.equal(tableLabel('u_access_card', { plural: true }), 'access cards');
  assert.equal(tableLabel('u_branch', { plural: true }), 'branches');
  assert.equal(tableLabel('u_entry', { plural: true }), 'entries');
  assert.equal(tableLabel('u_settings', { plural: true }), 'settings', 'already plural');
  // the instance's own label wins over the words of the name, and Title Case is lowered in the middle of a sentence
  assert.equal(tableLabel('u_facilities_request', { instanceLabel: 'Facilities Request' }), 'facilities request');
  assert.equal(tableLabel('u_facilities_request', { instanceLabel: 'Site Visit', plural: true }), 'site visits');
  assert.equal(tableLabel('x_acme_hr_onboarding', { instanceLabel: 'HR Onboarding Case', plural: true, sentenceCase: true }), 'HR onboarding cases');
  assert.equal(tableLabel('u_site_visit', { instanceLabel: 'ServiceNow Visit' }), 'ServiceNow visit', 'a brand keeps its capitals');
  // a label that is only the name again, an id or empty is no label
  assert.equal(tableLabel('u_site_visit', { instanceLabel: 'u_site_visit' }), 'site visit');
  assert.equal(tableLabel('u_site_visit', { instanceLabel: '0123456789abcdef0123456789abcdef' }), 'site visit');
  assert.equal(tableLabel('u_site_visit', { instanceLabel: '   ' }), 'site visit');
  // a shipped table keeps its own noun: the instance's label is for the tables we cannot name
  assert.equal(tableLabel('incident', { instanceLabel: 'Ticket' }), 'incident');
  // the family of an HR case table is less exact than what the instance calls it
  assert.equal(tableLabel('sn_hr_core_case_payroll', { instanceLabel: 'Payroll Case' }), 'payroll case');
});

test('text that is no table name is "record"; a name with nothing left after its prefix still says something', () => {
  setLanguage('en');
  for (const junk of ['', ' ', null, undefined, 'Not A Table', 'incident; drop table', '../etc/passwd', '1abc', 7]) {
    assert.equal(tableLabel(junk), 'record', JSON.stringify(junk));
    assert.equal(tableLabel(junk, { plural: true }), 'records');
    assert.equal(humanizeTable(junk), '');
  }
  assert.equal(tableLabel('', { instanceLabel: 'Facilities Request' }), 'facilities request', 'the label of the instance is used even when the name is missing');
  assert.equal(humanizeTable('u_my_table'), 'My table');
  assert.equal(humanizeTable('x_acme_visit_log'), 'Visit log');
  assert.equal(humanizeTable('u_hr_leave'), 'HR leave');
  assert.equal(humanizeTable('sys_user_preference'), 'User preference');
  assert.ok(!humanizeTable('u_').includes('_'));
});

test('english: true is the untranslated English, whatever the language of the panel (for the text the AI reads and the reports engine)', () => {
  try {
    setLanguage('ar');
    assert.equal(tableLabel('sc_req_item', { plural: true, sentenceCase: true, english: true }), 'Requested items');
    assert.equal(tableLabel('u_site_visit', { english: true, instanceLabel: 'Site Visit' }), 'site visit');
    assert.ok(!tableLabel('u_site_visit', { english: true, instanceLabel: 'Site Visit' }).includes('⁨'), 'no isolation marks in English');
    assert.match(tableLabel('sc_req_item'), /[؀-ۿ]/);
  } finally {
    setLanguage('en');
  }
});

test('in Arabic a name made from the table\'s name or the instance\'s label is isolated, so a right-to-left sentence keeps it whole', () => {
  try {
    setLanguage('ar');
    assert.equal(tableLabel('u_site_visit'), '⁨site visit⁩');
    assert.equal(tableLabel('u_site_visit', { instanceLabel: 'Site Visit', plural: true }), '⁨site visits⁩');
    assert.equal(tableLabel('incident'), AR_LABELS.incident, 'a noun of ours is not wrapped');
  } finally {
    setLanguage('en');
  }
});

test('translateTableNoun finds the Arabic of a noun the engine wrote in English, in any case', () => {
  try {
    setLanguage('en');
    assert.equal(translateTableNoun('Approvals'), undefined, 'English has nothing to translate');
    setLanguage('ar');
    assert.equal(translateTableNoun('Approvals'), AR_LABELS.approvals);
    assert.equal(translateTableNoun('requested items'), AR_LABELS['requested items']);
    assert.equal(translateTableNoun(' SLAs '), AR_LABELS.SLAs);
    assert.equal(translateTableNoun('History'), AR_LABELS.history);
    assert.equal(translateTableNoun('Some other words'), undefined);
    assert.equal(translateTableNoun(''), undefined);
    assert.equal(translateTableNoun(null), undefined);
  } finally {
    setLanguage('en');
  }
});


test('every noun in tableLabels.js has an Arabic text, and no text of labels.js is left over', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'tableLabels.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const keys = [...new Set([...source.matchAll(/\btm\('((?:[^'\\]|\\.)*)'\)/g)].map((m) => m[1]))];
  assert.ok(keys.length > 120, `${keys.length} nouns`);
  assert.deepEqual(keys.filter((k) => !AR_LABELS[k]), [], 'nouns without an Arabic text');
  // every text of the file is used by some text of the panel (the nouns above, or a sentence in another file)
  const used = new Set(collect(walk(path.join(__dirname, '..', 'src')).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`))).keys.keys());
  // (one text waits for an edit of a file of the lead's: the banner of a blocked table at the top of AI Assist, plan.js)
  const waiting = new Set(['Your organisation does not allow Agent Buddy to use {type} with AI. Insights still works.']);
  assert.deepEqual(Object.keys(AR_LABELS).filter((k) => !used.has(k) && !waiting.has(k)), [], 'Arabic texts no text uses');
  const names = (text) => [...text.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [key, text] of Object.entries(AR_LABELS)) {
    if (typeof text === 'object') {
      // a text with a count: the six forms, each with no {name} the English text does not have
      assert.deepEqual(Object.keys(text).sort(), ['few', 'many', 'one', 'other', 'two', 'zero'], key);
      continue;
    }
    assert.equal(typeof text, 'string', key);
    assert.ok(text.trim().length > 0, key);
    assert.equal(names(text), names(key), `the {names} of ${key}`);
  }
});
