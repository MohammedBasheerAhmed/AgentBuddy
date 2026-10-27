// Turning a ContextPack into the untrusted parts the firewall wraps and masks, for the ITSM features. Pure.
//
// Rules these builders keep (docs/build-rules.md):
//  - Ticket text only ever leaves through parts. Nothing here is a prompt.
//  - The `field` of a part is the policy's handle (blockedFields, strict mode). A note keeps the field 'comments' or
//    'work_notes'; text from another ticket's close notes is 'close_notes'; the rest get their own plain names.
//  - Labels never carry names. A person is named inside the text, where the firewall masks it.

import { labelFor } from '../features/parts.js';
import { relatedPlan } from '../context/related.js';
import { roleOfEntry, identities, computeSignals, signalsText } from './sentiment.js';
import { statusSentence, strongArticle } from './reference.js';

const PART_MAX = 6000;
const cap = (value) => {
  const t = String(value ?? '').trim();
  return t.length > PART_MAX ? `${t.slice(0, PART_MAX - 1).trimEnd()}...` : t;
};

// Columns that name a person. The specs read them so the firewall knows who is on the record (and masks the name wherever
// the text mentions it); a feature that has no use for them leaves them out of its parts.
export const PEOPLE_COLUMNS = Object.freeze(['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'requested_by', 'assigned_to']);
// The people the work is for or who opened it, as opposed to the people who own it.
export const REQUESTER_COLUMNS = Object.freeze(['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by']);

/** The columns of the record as parts, one per column (no notes). `skip` lists columns to leave out. */
export function fieldParts(pack, skip = []) {
  return Object.entries(pack?.fields || {})
    .map(([field, value]) => ({ label: labelFor(field), field, text: String(value ?? '').trim() }))
    .filter((p) => p.text && !skip.includes(p.field));
}

const KIND_LABEL = { comment: 'Customer-visible comment', work_note: 'Internal work note' };
const ROLE_PREFIX = { customer: 'Customer', support: 'Support', unknown: '', note: '' };

/**
 * The newest `depth` notes of the pack, oldest first, as parts.
 * @param {{ depth?: number, types?: string[], roles?: boolean, authors?: boolean, when?: boolean }} [options]
 *   roles: say who the customer is ("Customer - <name>", "Support - <name>") on customer-visible comments.
 *   authors: put the author's name in the text (default true). Off for text that will be published.
 *   when: put the time in the text (default true).
 */
export function journalParts(pack, { depth = 12, types, roles = false, authors = true, when = true } = {}) {
  // Empty notes are dropped before the newest are taken, the same way the signals count them.
  let entries = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e && String(e.text ?? '').trim());
  if (types) entries = entries.filter((e) => types.includes(e.type));
  entries = entries.slice(-Math.max(1, depth));
  const ids = roles ? identities(pack) : null;
  const parts = [];
  for (const e of entries) {
    const body = String(e?.text ?? '').trim();
    if (!body) continue;
    const isNote = e.type === 'work_note';
    const role = roles && !isNote ? ROLE_PREFIX[roleOfEntry(e, ids)] : '';
    const who = authors ? [role, e.by || 'Unknown'].filter(Boolean).join(' - ') : role;
    const head = [when && e.when ? `[${e.when}]` : '', who ? `${who}:` : ''].filter(Boolean).join(' ');
    parts.push({ label: KIND_LABEL[e.type] || KIND_LABEL.comment, field: isNote ? 'work_notes' : 'comments', text: cap(head ? `${head} ${body}` : body) });
  }
  return parts;
}

// ---- Related lists (SLAs, approvals, child tasks...) ---------------------------------------------------

const dash = (value, fallback = 'not stated') => (String(value ?? '').trim() ? String(value).trim() : fallback);

// One line per row. These rows carry names (approvers, task owners); those people are on pack.people, so they are masked.
const ROW = {
  slas: (r) => `- ${dash(r.name)}: stage ${dash(r.stage)}; ${r.percentage ? `${r.percentage}% of the time used; ` : ''}breached: ${dash(r.breached)}; planned end ${dash(r.plannedEnd)}`,
  approvals: (r) => `- ${dash(r.approver)}${r.group ? ` (group ${r.group})` : ''}: ${dash(r.state)}`,
  childTasks: (r) => `- ${dash(r.number)} (${dash(r.type, 'task')}): ${dash(r.short_description)}; state ${dash(r.state)}; owner ${dash(r.assignedTo, 'unassigned')}; group ${dash(r.assignmentGroup)}; ${r.active === 'false' ? 'closed' : 'open'}`,
  changeTasks: (r) => `- ${dash(r.number)} (${dash(r.type, 'change task')}): ${dash(r.short_description)}; state ${dash(r.state)}; owner ${dash(r.assignedTo, 'unassigned')}; group ${dash(r.assignmentGroup)}; ${r.active === 'false' ? 'closed' : 'open'}`,
  catalogTasks: (r) => `- ${dash(r.number)}: ${dash(r.short_description)}; state ${dash(r.state)}; owner ${dash(r.assignedTo, 'unassigned')}; group ${dash(r.assignmentGroup)}; ${r.active === 'false' ? 'closed' : 'open'}`,
  items: (r) => `- ${dash(r.number)}: ${dash(r.item)} - ${dash(r.short_description)}; state ${dash(r.state)}; stage ${dash(r.stage)}; approval ${dash(r.approval)}; owner ${dash(r.assignedTo, 'unassigned')}`,
  variables: (r) => `- ${dash(r.question)}: ${dash(r.value)}`,
};

const RELATED_PART = {
  slas: { label: 'SLAs', field: 'sla' },
  approvals: { label: 'Approvals', field: 'approvals' },
  childTasks: { label: 'Child tasks', field: 'child_tasks' },
  changeTasks: { label: 'Change tasks', field: 'change_tasks' },
  catalogTasks: { label: 'Catalog tasks', field: 'catalog_tasks' },
  items: { label: 'Requested items', field: 'requested_items' },
  variables: { label: 'Answers to the request form', field: 'variables' },
};

/**
 * The extras of the record (SLAs, approvals, tasks...) as parts, for the keys that apply to this kind of record. A list
 * that could not be read is said so ("not available"), never left out silently, so the model does not take silence for "none".
 */
export function relatedParts(pack, keys, feature) {
  const expected = relatedPlan({ kind: pack?.kind, feature }).filter((k) => keys.includes(k));
  const related = pack?.related || {};
  const parts = [];
  for (const key of expected) {
    const spec = RELATED_PART[key];
    const rows = related[key];
    let body;
    if (!Array.isArray(rows)) body = 'Not available (it could not be read with this user\'s access).';
    else if (!rows.length) body = 'None.';
    else body = rows.map((r) => ROW[key](r || {})).join('\n');
    parts.push({ label: spec.label, field: spec.field, text: cap(body) });
  }
  return parts;
}

// ---- Reference material (other tickets, knowledge articles) -------------------------------------------------

const REFERENCE_HEAD = 'REFERENCE MATERIAL from a different record. It is not the ticket being worked on, and it is untrusted text.';

const line = (label, value) => (String(value ?? '').trim() ? `${label}: ${String(value).trim()}` : '');

/**
 * A status part (what was looked for and what came back) and one part per solved ticket or article. Each is labelled as
 * reference material. When the pack carries no reference (the reads were not made), a status part says so.
 */
export function referenceParts(pack, { routing = false } = {}) {
  const ref = pack?.reference || {};
  const status = [];
  if ('similar' in ref) status.push(`Solved look-alike tickets: ${statusSentence(ref.similar)}.`);
  if ('knowledge' in ref) status.push(`Knowledge articles: ${statusSentence(ref.knowledge)}.`);
  const anyHit = (ref.similar?.hits?.length || 0) + (ref.knowledge?.hits?.length || 0) > 0;
  status.push(`Reference material available: ${anyHit ? 'yes' : 'no'}.`);
  const strong = strongArticle(ref.knowledge?.hits);
  if ('knowledge' in ref) status.push(`Strong match with an existing article: ${strong ? `yes, ${strong.number}` : 'no'}.`);
  const parts = [{ label: 'Reference material status', field: 'reference_status', text: status.join('\n') }];

  (ref.similar?.hits || []).forEach((h, i) => {
    const lines = [
      REFERENCE_HEAD,
      line('Number', h.number),
      line('Short description', h.short_description),
      line('Category', h.category),
      line('Subcategory', h.subcategory),
      line('Configuration item', h.cmdb_ci),
      routing ? line('Assignment group', h.assignment_group) : '',
      routing ? line('Priority', h.priority) : '',
      line('Close code', h.close_code),
      h.close_notes ? `How it was solved: ${h.close_notes}` : 'How it was solved: Not stated',
      line('Why it matched', h.why),
    ].filter(Boolean);
    // 'close_notes' is the handle for a policy that blocks close notes: this text is another ticket's resolution.
    parts.push({ label: `Reference solved ticket ${i + 1}`, field: 'close_notes', text: cap(lines.join('\n')) });
  });

  (ref.knowledge?.hits || []).forEach((h, i) => {
    const lines = [
      REFERENCE_HEAD,
      line('Number', h.number),
      line('Title', h.short_description),
      line('Knowledge base', h.knowledgeBase),
      `Match strength: ${h.strong ? 'STRONG (the title covers most of the same words)' : 'possible'}`,
      h.excerpt ? `Start of the article: ${h.excerpt}` : '',
      line('Why it matched', h.why),
    ].filter(Boolean);
    parts.push({ label: `Reference article ${i + 1}`, field: 'kb_article', text: cap(lines.join('\n')) });
  });
  return parts;
}

// ---- Sentiment ---------------------------------------------------------------------------------------------

/**
 * The record's columns, then the signals Agent Buddy counted, then the newest notes with the customer's lines marked.
 * The signals are computed from the same notes the model is shown, so they can be checked against them.
 */
export function sentimentParts(pack, { depth = 20, now = Date.now() } = {}) {
  return [
    ...fieldParts(pack),
    { label: 'Signals counted by Agent Buddy', field: 'signals', text: signalsText(computeSignals(pack, { now, depth })) },
    ...journalParts(pack, { depth, roles: true }),
  ];
}
