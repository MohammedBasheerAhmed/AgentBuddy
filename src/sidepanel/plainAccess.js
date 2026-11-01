import { plainError } from './ask.js';
import { t, tm, t as tr } from '../i18n/index.js';

// "What could not be read", in words a fulfiller can act on. The context engine reports the table it tried (kb_use, m2m_kb_task,
// task_sla...) and puts the same name inside its notes; nobody at a service desk knows those names, so they become plain phrases
// here, at the last step before the screen. The data itself (access entries) is not changed. WORDS holds English texts marked with
// tm(); plainSource shows them in the language of the panel (plainNote works inside the engine's English sentence, so it keeps English).

const WORDS = {
  journal: tm('notes and comments'),
  sys_journal_field: tm('notes and comments'),
  record: tm('this record'),
  tickets: tm('tickets'),
  'caller-history': tm('earlier tickets from this person'),
  chat: tm('chat messages'),
  interaction: tm('chats'),
  live_message: tm('chat messages'),
  sys_cs_conversation: tm('chats'),
  sys_cs_message: tm('chat messages'),
  kb_knowledge: tm('knowledge articles'),
  kb_use: tm('article links'),
  m2m_kb_task: 'article links',
  kb_knowledge_base: tm('knowledge bases'),
  kb_category: tm('knowledge categories'),
  task_sla: tm('SLAs'),
  sysapproval_approver: tm('approvals'),
  incident: tm('incidents'),
  problem: tm('problems'),
  change_request: tm('changes'),
  change_task: tm('change tasks'),
  task: tm('tasks'),
  sc_request: tm('requests'),
  sc_req_item: tm('requested items'),
  sc_task: tm('catalog tasks'),
  sc_item_option_mtom: tm('request answers'),
  sc_item_option: tm('request answers'),
  item_option_new: tm('request questions'),
  sys_user: tm('people'),
  sys_user_group: tm('groups'),
  sn_customerservice_case: tm('customer service cases'),
  sn_hr_core_case: tm('HR cases'),
  cmdb_ci: tm('configuration items'),
};

// Inside a sentence only the names with an underscore are replaced (kb_use, task_sla): single words such as "task" or "incident" already
// read as English there and must not be touched ("This task has no requested item"). Longest first, so sc_item_option_mtom is not
// cut short by sc_item_option.
const NAMES = Object.keys(WORDS).filter((n) => n.includes('_')).sort((a, b) => b.length - a.length);
const NAME_RE = new RegExp(`(?<![\\w-])(${NAMES.map((n) => n.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`, 'g');
const GENERIC_NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

/** A sentence from the context engine with its table names replaced by plain phrases. */
export const plainNote = (text) =>
  String(text ?? '')
    .replace(NAME_RE, (name, _group, at) => (at === 0 ? WORDS[name].charAt(0).toUpperCase() + WORDS[name].slice(1) : WORDS[name]))
    // The engine writes in the third person about "your user"; a person reads it as "you".
    .replace(/\bYour user (cannot|may not)\b/g, 'You $1');

/** The start of a line about one source: "Article links", "Notes and comments"; a table nobody knows becomes "Some information". */
export function plainSource(source) {
  const name = String(source ?? '');
  const known = WORDS[name] || (GENERIC_NAME_RE.test(name) ? tm('some information') : '');
  const said = known ? tr(known) : name; // a name nobody knows is shown as it is
  return said.charAt(0).toUpperCase() + said.slice(1);
}

// ('blocked' is the organisation's policy, not the person's access: it is said too, in the engine's own words.)
const SHOWN = new Set(['denied', 'error', 'empty-or-hidden', 'blocked']);

/** One line per source that could not be read (denied, error, or empty in a way that proves nothing). [] when all is well. */
export function describeAccess(access) {
  return (access || [])
    .filter((a) => a && SHOWN.has(a.status))
    .map((a) => (a.note ? `${plainSource(a.source)}: ${plainNote(a.note)}` : t('{source}: not available to you.', { source: plainSource(a.source) })));
}

/**
 * A read that failed, said the way rule 9 asks: a refusal (403, a record the person cannot see) is "not available to you", the
 * organisation's own block is said as such, and anything else is an error in plain words.
 * @param {Error|{ message?: string, code?: string }} err as the panel's read() throws it (the content script's code travels along)
 * @param {string} what the thing that could not be read, as a phrase that can start a sentence ("Earlier tickets from this person")
 * @returns {{ kind: 'denied' | 'blocked' | 'error', text: string }}
 */
export function readFailure(err, what) {
  const code = String(err?.code || '');
  const thing = String(what || t('This'));
  if (code === 'ACCESS_DENIED' || code === 'NOT_FOUND') return { kind: 'denied', text: t('{thing}: not available to you.', { thing }) };
  if (code === 'BLOCKED_TABLE') return { kind: 'blocked', text: t('{thing}: your organisation does not let Agent Buddy read this.', { thing }) };
  return { kind: 'error', text: plainError(err, t('{thing} could not be read.', { thing })) };
}
