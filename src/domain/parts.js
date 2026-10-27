// Turn a ContextPack into the untrusted "parts" the domain features send, including the per-kind extras (SLAs, approvals,
// linked incidents, schedule conflicts, the account's other cases). Pure. Every line is built from data already on the pack, so
// the allowlists in src/context decide what can appear; nothing here reads anything. Whatever text these lines carry is
// ticket text: it reaches the AI only as a part, through the firewall, which masks it.
//
// Two rules are worth knowing:
//  - An extra the person could not read is NOT described as empty. It is listed under "Data not available" so the model
//    says "not available" instead of "none" (an empty list is only written when the read worked and found nothing).
//  - Part field names avoid the words Strict mode treats as sensitive (see isSensitiveField in src/pii/firewall.js).

import { packToParts } from '../features/parts.js';

const present = (value) => String(value ?? '').trim();
const join = (bits, sep = ', ') => bits.map(present).filter(Boolean).join(sep);

// ---- One line per row, by kind of extra ----------------------------------------------------------------------

const SAME = { cmdb_ci: 'same configuration item', business_service: 'same business service' };

const RENDER = {
  slas: (r) => `- ${present(r.name) || 'SLA'}: ${join([r.stage, r.percentage && `${r.percentage}% of the time used`, r.breached === 'true' ? 'BREACHED' : r.breached === 'false' ? 'not breached' : '', r.plannedEnd && `planned end ${r.plannedEnd}`])}`,
  approvals: (r) => `- ${present(r.approver) || 'Approver not shown'}${present(r.group) ? ` (${r.group})` : ''}: ${join([r.state || 'state not shown', r.updated && `updated ${r.updated}`])}`,
  childTasks: (r) => `- ${join([r.number, r.type && `(${r.type})`], ' ')}: ${present(r.short_description)} - ${join([r.state, r.active === 'false' ? 'closed' : '', r.assignmentGroup && `group ${r.assignmentGroup}`, r.assignedTo && `assigned to ${r.assignedTo}`])}`,
  changeTasks: (r) => `- ${join([r.number, r.type && `(${r.type})`], ' ')}: ${present(r.short_description)} - ${join([r.state, r.active === 'false' ? 'closed' : '', r.assignmentGroup && `group ${r.assignmentGroup}`, r.assignedTo && `assigned to ${r.assignedTo}`])}`,
  linkedIncidents: (r) =>
    `- ${present(r.number)} (${present(r.state) || 'state not shown'}), opened ${present(r.opened) || 'date not shown'}${present(r.resolved) ? `, resolved ${r.resolved}` : ''}${present(r.ci) ? `, CI ${r.ci}` : ''}: ${present(r.short_description)}${present(r.closeNotes) ? ` | Close notes: ${r.closeNotes}` : ''}`,
  conflicts: (r) =>
    `- ${present(r.number)} (${join([r.state, r.type, r.risk && `risk ${r.risk}`])}): ${present(r.short_description)}; planned ${present(r.start) || '?'} to ${present(r.end) || '?'}; ${join((r.same || []).map((s) => SAME[s]).filter(Boolean)) || 'related by configuration item or service'}`,
  recentChanges: (r) =>
    `- ${present(r.number)} (${present(r.state) || 'state not shown'}): ${present(r.short_description)}; ${present(r.start) || '?'} to ${present(r.end) || '?'}${present(r.ci) ? `; configuration item ${r.ci}` : ''}`,
  accountCases: (r) =>
    `- ${present(r.number)}: ${present(r.short_description)} (${join([r.state, r.priority && `priority ${r.priority}`, r.opened_at && `opened ${r.opened_at}`, r.resolved_at ? `resolved ${r.resolved_at}` : 'not resolved'])})`,
};

// What to say when the read worked and the list is empty. Only used for a key that is on the pack, i.e. a confirmed "none".
const NONE = {
  slas: 'No SLAs are attached to this record.',
  approvals: 'No approval requests were found.',
  childTasks: 'No child tasks.',
  changeTasks: 'No change tasks.',
  linkedIncidents: 'No incidents are linked to this problem.',
  conflicts: 'Checked: no other active change that your user can see, on the same configuration item or business service, overlaps the planned window.',
  recentChanges: "Checked: no change on this case's configuration item was made in the last 14 days or is planned in the next 7.",
  accountCases: 'No other cases that your user can see for this account.',
};

const TITLE = {
  slas: ['Service level agreements', 'slas'],
  approvals: ['Approvals', 'approvals'],
  childTasks: ['Child tasks', 'child_tasks'],
  changeTasks: ['Change tasks', 'change_tasks'],
  linkedIncidents: ['Incidents linked to this problem', 'linked_incidents'],
  conflicts: ['Other changes overlapping the planned window', 'schedule_conflicts'],
  recentChanges: ['Recent changes on the same configuration item', 'recent_changes'],
  accountCases: ["The account's other cases", 'account_cases'],
};

// A note about a list that is longer than what is shown.
function trailer(key, pack) {
  const summary = pack?.related?.[`${key}Summary`];
  if (!summary || typeof summary !== 'object') return '';
  if (key === 'linkedIncidents' && summary.shown < (summary.total ?? summary.shown + 1)) {
    return summary.total
      ? `The list is partial: ${summary.total} incidents are linked in total. The oldest and the newest are shown, the ones in between are not.`
      : 'The list is partial: more incidents are linked than are shown. The oldest and the newest are shown.';
  }
  if (key === 'conflicts' && summary.total > summary.shown) return `${summary.total - summary.shown} more overlapping changes exist and are not shown.`;
  if (key === 'accountCases' && summary.more) return `${summary.more} more cases exist for this account and are not shown.`;
  if (key === 'accountCases' && summary.more === null) return 'More cases exist for this account and are not shown.';
  return '';
}

/** The text of one extra, or '' when the pack does not have it (it could not be read: see unavailableText). */
export function relatedText(key, pack) {
  const rows = pack?.related?.[key];
  const render = RENDER[key];
  if (!Array.isArray(rows) || !render) return '';
  if (!rows.length) return NONE[key] || '';
  return [...rows.map((r) => render(r || {})), trailer(key, pack)].filter(Boolean).join('\n');
}

// ---- What could not be read -----------------------------------------------------------------------------------

const SOURCE_LABEL = {
  task_sla: 'SLAs',
  sysapproval_approver: 'Approvals',
  task: 'Child tasks',
  change_task: 'Change tasks',
  incident: 'Linked incidents',
  change_request: 'Other changes',
  journal: 'Notes and comments',
  sys_journal_field: 'Notes and comments',
  sn_customerservice_case: "The account's other cases",
};
// People lookups only affect email addresses; the model has no use for hearing about them.
const QUIET_SOURCES = new Set(['sys_user', 'csm_consumer', 'customer_contact']);

const PHRASE = {
  denied: 'not readable by your user',
  'empty-or-hidden': 'nothing visible to your user; it may exist but be hidden from them',
  error: 'could not be read',
};

/** One line per part of the record the person's user could not read, or ''. Fixed wording: no text from the instance. */
export function unavailableText(pack) {
  const lines = [];
  for (const a of Array.isArray(pack?.access) ? pack.access : []) {
    if (!a || QUIET_SOURCES.has(a.source)) continue;
    const phrase = a.status === 'skipped' ? present(a.note) : PHRASE[a.status];
    if (!phrase) continue;
    lines.push(`- ${SOURCE_LABEL[a.source] || String(a.source || 'Something').slice(0, 60)}: ${phrase}`);
  }
  if (!lines.length) return '';
  return `These parts could not be read, so do not describe them as empty or as "none":\n${[...new Set(lines)].join('\n')}`;
}

// ---- The parts ---------------------------------------------------------------------------------------------------

/** Columns with no value (empty, or not readable by the person's user), named so the model can say "Missing" instead of guessing. */
export function missingText(pack, wanted) {
  const absent = Object.entries(wanted || {})
    .filter(([field]) => !present(pack?.fields?.[field]))
    .map(([, label]) => label);
  return absent.length ? `These have no value on the record (empty, or not readable by your user): ${absent.join(', ')}.` : '';
}

const BASE_LABELS = { sys_updated_on: 'Last updated' };

/**
 * @param {object} pack ContextPack (possibly enriched)
 * @param {{ journal?: number, skipFields?: string[], labels?: Record<string,string>, related?: string[], missing?: Record<string,string> }} [options]
 *   skipFields: pack fields that stay out of the parts (they can still be on the pack so the person is masked by name);
 *   labels: a plainer label for a field; related: the extras to include, in this order;
 *   missing: { column: label } to list, in a part of its own, the ones that have no value.
 */
export function domainParts(pack, { journal = 12, skipFields = [], labels = {}, related = [], missing } = {}) {
  const names = { ...BASE_LABELS, ...labels };
  const parts = packToParts(pack, { journal, skipFields }).map((p) => (Object.prototype.hasOwnProperty.call(names, p.field) ? { ...p, label: names[p.field] } : p));
  const absent = missing ? missingText(pack, missing) : '';
  if (absent) parts.push({ label: 'Not recorded', field: 'not_recorded', text: absent });
  for (const key of related) {
    const text = relatedText(key, pack);
    if (text && TITLE[key]) parts.push({ label: TITLE[key][0], field: TITLE[key][1], text });
  }
  const unreadable = unavailableText(pack);
  if (unreadable) parts.push({ label: 'Data not available', field: 'data_not_available', text: unreadable });
  return parts;
}
