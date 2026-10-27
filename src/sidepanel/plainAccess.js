// "What could not be read", in words a fulfiller can act on. The context engine reports the table it tried (kb_use, m2m_kb_task,
// task_sla...) and puts the same name inside its notes; nobody at a service desk knows those names, so they become plain phrases
// here, at the last step before the screen. The data itself (access entries) is not changed.

const WORDS = {
  journal: 'notes and comments',
  sys_journal_field: 'notes and comments',
  record: 'this record',
  tickets: 'tickets',
  'caller-history': 'earlier tickets from this person',
  chat: 'chat messages',
  interaction: 'chats',
  live_message: 'chat messages',
  sys_cs_conversation: 'chats',
  sys_cs_message: 'chat messages',
  kb_knowledge: 'knowledge articles',
  kb_use: 'article links',
  m2m_kb_task: 'article links',
  kb_knowledge_base: 'knowledge bases',
  kb_category: 'knowledge categories',
  task_sla: 'SLAs',
  sysapproval_approver: 'approvals',
  incident: 'incidents',
  problem: 'problems',
  change_request: 'changes',
  change_task: 'change tasks',
  task: 'tasks',
  sc_request: 'requests',
  sc_req_item: 'requested items',
  sc_task: 'catalog tasks',
  sc_item_option_mtom: 'request answers',
  sc_item_option: 'request answers',
  item_option_new: 'request questions',
  sys_user: 'people',
  sys_user_group: 'groups',
  sn_customerservice_case: 'customer service cases',
  sn_hr_core_case: 'HR cases',
  cmdb_ci: 'configuration items',
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
  const words = WORDS[name] || (GENERIC_NAME_RE.test(name) ? 'some information' : name);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ('blocked' is the organisation's policy, not the person's access: it is said too, in the engine's own words.)
const SHOWN = new Set(['denied', 'error', 'empty-or-hidden', 'blocked']);

/** One line per source that could not be read (denied, error, or empty in a way that proves nothing). [] when all is well. */
export function describeAccess(access) {
  return (access || [])
    .filter((a) => a && SHOWN.has(a.status))
    .map((a) => (a.note ? `${plainSource(a.source)}: ${plainNote(a.note)}` : `${plainSource(a.source)}: not available to you.`));
}
