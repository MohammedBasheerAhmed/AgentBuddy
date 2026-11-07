// How a table is called in front of a person. A fulfiller does not say "sc_req_item" or "sn_hr_core_case": every screen, note and
// banner that has to name a table goes through this file, so no raw table name reaches the screen (audit of 2026-11-07, root cause 2).
//
// Contract (the lead wrote this first; the "labels" workstream completed it):
//   humanizeTable(table)            the plain fallback for any name: 'u_my_table' -> 'My table', 'x_acme_visit_log' -> 'Visit log'. Never
//                                   returns the raw name; '' when the text is not a table name at all.
//   tableLabel(table, options)      the phrase for a table, in this order:
//                                     1. the plain noun for a table ServiceNow ships (incident -> 'incident', sc_req_item -> 'requested
//                                        item'), translated;
//                                     2. the instance's own label when the caller has one (options.instanceLabel: the display value of
//                                        sys_class_name that the code already reads), so a custom class is called what the instance calls it;
//                                     3. the family the name belongs to (any HR case table -> 'HR case', sn_vul_* -> 'vulnerability record');
//                                     4. humanizeTable(table), lower case; and 'record' when the text is not a table name at all.
//                                   options.plural gives 'incidents'; options.sentenceCase capitalises the first letter;
//                                   options.english returns the English phrase untranslated (for text the AI reads and for the reports
//                                   engine, which runs in the ServiceNow page and writes English only: src/reports/shown.js translates it).
//   isKnownTable(table)             true when step 1 or 3 knows the name (the label is then a real noun, not a guess from the name).
//   translateTableNoun(text)    for src/reports/shown.js: the translation of an English noun this file wrote ('Approvals' -> Arabic),
//                                   or undefined. Case does not matter.
// Never put the label of a table into a sentence that is not translated whole: the sentence has a {slot} (see docs/i18n-arabic.md).
// Pure: no React and no chrome.*. Nothing here is ticket data, so it is translated (t) like every other text of the panel; an
// instance's own label is data and is isolated like a name.

import { isolate, t, tm } from '../i18n/core.js';

const TABLE_NAME = /^[a-z][a-z0-9_]*$/;
const SCOPE_PREFIX = /^(?:x_[a-z0-9]+_|u_|sn_[a-z0-9]+_|sys_|cmdb_ci_|cmdb_)/;

// Short words that are written in capitals ('u_hr_leave' is an "HR leave", not an "Hr leave").
const ACRONYMS = new Set(['hr', 'it', 'ci', 'sla', 'kb', 'cmdb', 'csm', 'itsm', 'ip', 'id', 'vip', 'url', 'ui', 'os', 'api', 'sap', 'ad', 'ldap', 'sso', 'vpn', 'pc', 'db', 'rfc', 'faq', 'pdf', 'sms', 'csv', 'erp', 'crm', 'hris', 'dns']);

// ---- The tables ServiceNow ships ----------------------------------------------------------------------------------------------------
//
// [one, many]: plain English the way a service desk says it, marked with tm() so that src/i18n/ar/labels.js must translate each one
// (tests/i18n.test.js). Several tables share a noun on purpose (the article-link tables, the chat tables): a person does not care
// which of them was meant. The words stay close to what plainAccess.js has always shown, so no note changes its wording.
const KNOWN = {
  // IT service management
  incident: [tm('incident'), tm('incidents')],
  incident_task: [tm('incident task'), tm('incident tasks')],
  problem: [tm('problem'), tm('problems')],
  problem_task: [tm('problem task'), tm('problem tasks')],
  change_request: [tm('change'), tm('changes')],
  change_task: [tm('change task'), tm('change tasks')],
  task: [tm('task'), tm('tasks')],
  task_ci: [tm('affected item'), tm('affected items')],
  // Service catalog
  sc_request: [tm('request'), tm('requests')],
  sc_req_item: [tm('requested item'), tm('requested items')],
  sc_task: [tm('catalog task'), tm('catalog tasks')],
  sc_cat_item: [tm('catalog item'), tm('catalog items')],
  sc_category: [tm('catalog category'), tm('catalog categories')],
  sc_item_option_mtom: [tm('request answer'), tm('request answers')],
  sc_item_option: [tm('request answer'), tm('request answers')],
  item_option_new: [tm('request question'), tm('request questions')],
  // Customer service
  sn_customerservice_case: [tm('customer service case'), tm('customer service cases')],
  sn_customerservice_task: [tm('customer service task'), tm('customer service tasks')],
  csm_consumer: [tm('consumer'), tm('consumers')],
  customer_contact: [tm('customer contact'), tm('customer contacts')],
  customer_account: [tm('customer account'), tm('customer accounts')],
  // HR service delivery
  sn_hr_core_case: [tm('HR case'), tm('HR cases')],
  sn_hr_core_task: [tm('HR task'), tm('HR tasks')],
  sn_hr_core_service: [tm('HR service'), tm('HR services')],
  sn_hr_core_profile: [tm('HR profile'), tm('HR profiles')],
  // Knowledge
  kb_knowledge: [tm('knowledge article'), tm('knowledge articles')],
  kb_use: [tm('article link'), tm('article links')],
  m2m_kb_task: [tm('article link'), tm('article links')],
  kb_knowledge_base: [tm('knowledge base'), tm('knowledge bases')],
  kb_category: [tm('knowledge category'), tm('knowledge categories')],
  // SLAs and approvals
  task_sla: [tm('SLA'), tm('SLAs')],
  sysapproval_approver: [tm('approval'), tm('approvals')],
  sysapproval_group: [tm('approval group'), tm('approval groups')],
  // People, groups, places
  sys_user: [tm('person'), tm('people')],
  sys_user_group: [tm('group'), tm('groups')],
  sys_user_grmember: [tm('group membership'), tm('group memberships')],
  sys_user_role: [tm('role'), tm('roles')],
  cmn_department: [tm('department'), tm('departments')],
  cmn_location: [tm('location'), tm('locations')],
  cmn_cost_center: [tm('cost center'), tm('cost centers')],
  core_company: [tm('company'), tm('companies')],
  // History, notes, mail
  sys_audit: [tm('history entry'), tm('history')],
  sys_journal_field: [tm('note or comment'), tm('notes and comments')],
  sys_attachment: [tm('attachment'), tm('attachments')],
  sys_email: [tm('email'), tm('emails')],
  // Chats and conversations
  interaction: [tm('chat'), tm('chats')],
  live_group_profile: [tm('chat'), tm('chats')],
  live_message: [tm('chat message'), tm('chat messages')],
  sys_cs_conversation: [tm('chat'), tm('chats')],
  sys_cs_message: [tm('chat message'), tm('chat messages')],
  chat_queue_entry: [tm('chat'), tm('chats')],
  // Configuration items: the base table and the classes people name most
  cmdb_ci: [tm('configuration item'), tm('configuration items')],
  cmdb_ci_server: [tm('server'), tm('servers')],
  cmdb_ci_computer: [tm('computer'), tm('computers')],
  cmdb_ci_win_server: [tm('server'), tm('servers')],
  cmdb_ci_linux_server: [tm('server'), tm('servers')],
  cmdb_ci_netgear: [tm('network device'), tm('network devices')],
  cmdb_ci_printer: [tm('printer'), tm('printers')],
  cmdb_ci_db_instance: [tm('database'), tm('databases')],
  cmdb_ci_appl: [tm('application'), tm('applications')],
  cmdb_ci_service: [tm('service'), tm('services')],
  cmdb_ci_vm_instance: [tm('virtual machine'), tm('virtual machines')],
  service_offering: [tm('service offering'), tm('service offerings')],
  // Security, vulnerability, risk and compliance (their prefixes are sensitive: src/context/kinds.js)
  sn_si_incident: [tm('security incident'), tm('security incidents')],
  sn_si_task: [tm('security task'), tm('security tasks')],
  sn_vul_vulnerable_item: [tm('vulnerable item'), tm('vulnerable items')],
  sn_vul_vulnerability: [tm('vulnerability'), tm('vulnerabilities')],
  sn_vul_remediation_task: [tm('remediation task'), tm('remediation tasks')],
  sn_risk_risk: [tm('risk'), tm('risks')],
  sn_compliance_control: [tm('control'), tm('controls')],
  sn_grc_issue: [tm('compliance issue'), tm('compliance issues')],
};

// Families, for a table the list above does not name: the HR case tables come in a family (a case per area, lifecycle events, employee
// relations: the same rule as kindForTable in src/context/kinds.js), and the add-on products keep one prefix. The first match wins.
const FAMILIES = [
  [/^sn_hr_(?:[a-z0-9]+_)*case(?:_[a-z0-9]+)*$/, [tm('HR case'), tm('HR cases')], (name) => !name.endsWith('_task')],
  [/^sn_hr_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, [tm('HR task'), tm('HR tasks')]],
  [/^sn_hr_/, [tm('HR record'), tm('HR records')]],
  [/^sn_customerservice_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, [tm('customer service task'), tm('customer service tasks')]],
  [/^sn_customerservice_/, [tm('customer service record'), tm('customer service records')]],
  [/^csm_/, [tm('customer service record'), tm('customer service records')]],
  [/^sn_si_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, [tm('security task'), tm('security tasks')]],
  [/^sn_si_/, [tm('security record'), tm('security records')]],
  [/^sn_vul_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, [tm('remediation task'), tm('remediation tasks')]],
  [/^sn_vul_/, [tm('vulnerability record'), tm('vulnerability records')]],
  [/^sn_(?:grc|risk|compliance|audit)_/, [tm('risk and compliance record'), tm('risk and compliance records')]],
  [/^kb_/, [tm('knowledge record'), tm('knowledge records')]],
];

// What a name that is no table at all is called.
const GENERIC = [tm('record'), tm('records')];

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const nameOf = (table) => String(table ?? '').trim().toLowerCase();

function exact(name) {
  return hasOwn(KNOWN, name) ? KNOWN[name] : null;
}

function family(name) {
  for (const [pattern, pair, accept] of FAMILIES) if (pattern.test(name) && (!accept || accept(name))) return pair;
  return null;
}

/** The words of a table name without its prefix: 'x_acme_visit_log' -> ['visit', 'log']; acronyms in capitals ('HR', 'IT'). */
function wordsOf(name) {
  if (!TABLE_NAME.test(name)) return [];
  // (a name that is only a prefix, or a single letter, names nothing: 'record' is said instead)
  const stripped = name.replace(SCOPE_PREFIX, '');
  const words = stripped.split('_').filter(Boolean);
  if (words.join('').length < 2) return [];
  return words.map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word));
}

const upperFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** 'u_my_table' -> 'My table'; '' when `table` is not a table name. */
export function humanizeTable(table) {
  const words = wordsOf(nameOf(table));
  return upperFirst(words.join(' '));
}

/** Is this name one the labels know (a real noun), as opposed to a phrase made from the name? */
export function isKnownTable(table) {
  const name = nameOf(table);
  return Boolean(exact(name) || family(name));
}

// ---- The plural of a phrase we only have in the singular ------------------------------------------------------------------------------

const LATIN_ENDING = /[A-Za-z]$/;

/** English plural of the last word, for a phrase made from a name or taken from the instance. Arabic and other scripts are left alone. */
function pluralize(phrase) {
  if (!LATIN_ENDING.test(phrase)) return phrase;
  if (/(?:ss|x|z|ch|sh)$/i.test(phrase)) return `${phrase}es`;
  if (/[^aeiou]y$/i.test(phrase)) return `${phrase.slice(0, -1)}ies`;
  if (/s$/i.test(phrase)) return phrase; // already plural ('settings', 'analytics')
  return `${phrase}s`;
}

// An instance writes its labels in Title Case ('Facilities Request'); in the middle of a sentence they read better in lower case, but
// an acronym or a brand ('HR Case', 'ServiceNow') keeps its capitals.
const lowerTitleWords = (label) => label.replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());

// The instance's label, or '' when it is not usable (empty, looks like a name or an id, or is the raw name itself).
function usableLabel(label, name) {
  const text = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!text || text.includes('_') || /^[0-9a-f]{32}$/i.test(text) || text.toLowerCase() === name) return '';
  return text;
}

const cased = (phrase, sentenceCase) => (sentenceCase ? upperFirst(phrase) : phrase);

/**
 * The phrase for a table (see the contract above).
 * @param {string} table the table name ('' or text that is no table name gives 'record')
 * @param {{ plural?: boolean, sentenceCase?: boolean, instanceLabel?: string, english?: boolean }} [options]
 */
export function tableLabel(table, { plural = false, sentenceCase = false, instanceLabel = '', english = false } = {}) {
  const name = nameOf(table);
  const say = (key) => (english ? key : t(key));
  const pick = (pair) => cased(say(plural ? pair[1] : pair[0]), sentenceCase);

  const own = exact(name);
  if (own) return pick(own);

  const given = usableLabel(instanceLabel, name);
  if (given) {
    const phrase = lowerTitleWords(given);
    const done = cased(plural ? pluralize(phrase) : phrase, sentenceCase);
    return english ? done : isolate(done);
  }

  const kin = family(name);
  if (kin) return pick(kin);

  const guess = wordsOf(name);
  if (guess.length) {
    const phrase = guess.join(' ');
    const done = cased(plural ? pluralize(phrase) : phrase, sentenceCase);
    return english ? done : isolate(done);
  }
  return pick(GENERIC);
}

// ---- For src/reports/shown.js: the engine writes these words in English and the panel translates them -------------------------------

let byEnglish = null;
function englishIndex() {
  if (byEnglish) return byEnglish;
  byEnglish = new Map();
  const all = [...Object.values(KNOWN), ...FAMILIES.map((f) => f[1]), GENERIC];
  for (const pair of all) for (const word of pair) if (!byEnglish.has(word.toLowerCase())) byEnglish.set(word.toLowerCase(), word);
  return byEnglish;
}

/** The translation of an English noun this file wrote ('Approvals', 'requested items'), whatever its case; undefined for any other text. */
export function translateTableNoun(text) {
  const key = englishIndex().get(String(text ?? '').trim().toLowerCase());
  if (!key) return undefined;
  const said = t(key);
  return said === key ? undefined : said;
}
