// Feature definitions for the record checks area (see docs/contracts.md, "Feature definition"). They started as buttons on the old
// record tabs (Request, Check, Checklist); in round 3 they are actions of the Ticket screen's AI Assist half like the others, so
// they list their record kinds. Each still runs through useRun(), so policy, the firewall and the preview apply.
//
// What the old tabs did in their own `getPack` now happens in `enrich`, so the action reads the right thing however it is started
// (the action list, the quick bar, the bar on the ServiceNow page):
//   request-explain       on a catalog task, the requested item it belongs to (that is what the requester asked for)
//   resolution-improve    the notes typed on the form but not saved yet, in place of the saved ones
//   fulfilment-checklist  on a catalog task, the answers to the request questions, which live on its requested item
// Each `enrich` is idempotent: a pack that already has what it adds (a view built it) is returned as it is.
//
// Prompts are fixed text. Ticket data only ever arrives as `parts` (untrusted, masked).
import { requestExplainParts } from '../../checks/requestView.js';
import { checklistParts, mergeParentPack } from '../../checks/checklistParts.js';
import { resolutionImproveParts } from '../../checks/resolutionParts.js';
import { withCurrentNotes } from '../../checks/resolutionCheck.js';
import { notClosed, notNew } from '../stages.js';
import { requesterCommentLabel } from './kinds.js';
import { rulesFor } from '../../prompts/rules.js';
import { t, tm, t as tr } from '../../i18n/index.js';

const isTask = (pack) => String(pack?.table || '').toLowerCase() === 'sc_task';
const access = (pack, entry) => ({ ...pack, access: [...(Array.isArray(pack.access) ? pack.access : []), entry] });

/** The requested item a catalog task belongs to ({ table, sysId }), or null when it is not known or not readable. */
async function parentItem(pack, read) {
  try {
    const target = await read('requestTarget', { table: pack.table, sysId: pack.sysId });
    return target && target.table === 'sc_req_item' && typeof target.sysId === 'string' ? target : null;
  } catch {
    return null;
  }
}

// request-explain: the message is about the REQUEST, which the requester reads on the requested item. On a catalog task the item is
// read instead (with this feature's own spec: state and due date, no answers). When the item cannot be read the task speaks for
// itself, and the model is told so.
async function explainTarget(pack, { read, allowSensitive }) {
  if (!isTask(pack)) return pack;
  const target = await parentItem(pack, read);
  if (!target) return access(pack, { source: 'sc_req_item', status: 'denied', note: t('The requested item this task belongs to could not be read, so the message is about the task only.') });
  try {
    const item = await read('pack', { table: target.table, sysId: target.sysId, feature: 'request-explain', allowSensitive });
    return item && typeof item === 'object' && item.table ? item : pack;
  } catch {
    return access(pack, { source: 'sc_req_item', status: 'denied', note: t('The requested item this task belongs to could not be read, so the message is about the task only.') });
  }
}

// resolution-improve: what is in the box NOW (classic forms, and the notes box of a Workspace page; read again at every run). Without any notes, typed or saved, there is
// nothing to improve: the person is told to write a few words first (or to use "Write resolution notes"), and nothing is sent.
export const NO_NOTES_TO_IMPROVE = tm('There are no resolution notes on the form yet. Type a few words first, or use "Write resolution notes".'); // an English text: show it with t()

async function typedNotes(pack, { read }) {
  let form;
  try {
    const facts = await read('resolutionFacts', { table: pack.table, sysId: pack.sysId });
    form = facts && typeof facts === 'object' ? facts.form : null;
  } catch {
    form = null;
  }
  const out = withCurrentNotes(pack, form);
  if (!String(out?.fields?.close_notes || '').trim()) throw new Error(tr(NO_NOTES_TO_IMPROVE));
  return out;
}

// fulfilment-checklist: a catalog task does not hold the answers to the request questions; its requested item does.
async function withRequestAnswers(pack, { read, allowSensitive }) {
  if (!isTask(pack) || (Array.isArray(pack.related?.variables) && pack.related.variables.length)) return pack;
  const target = await parentItem(pack, read);
  if (!target) return pack;
  try {
    const item = await read('pack', { table: target.table, sysId: target.sysId, feature: 'fulfilment-checklist', allowSensitive });
    return mergeParentPack(pack, item && typeof item === 'object' ? item : null);
  } catch {
    return access(pack, { source: 'sc_req_item', status: 'denied', note: t('You cannot see the requested item, so its answers are not included.') });
  }
}

export default [
  {
    id: 'request-explain',
    get title() {
      return t('Tell the requester where it stands');
    },
    get description() {
      return t('A short, friendly message that says where the request stands and what it is waiting for.');
    },
    wave: 1,
    kinds: ['request', 'requested_item', 'catalog_task'],
    group: 'reply',
    primary: 'insert',
    when: notClosed,
    journal: 6,
    enrich: explainTarget,
    parts: requestExplainParts,
    // The requester reads the request and its requested item, not the catalog task (audit of 2026-11-07, W-02): on a task the work
    // notes come first and the comment is the second, warned choice.
    insert: [
      { field: 'comments', kinds: ['request', 'requested_item'], get label() { return t('Insert as customer comment'); }, fieldLabel: tm('Additional comments') },
      { field: 'work_notes', kinds: ['catalog_task'], get label() { return t('Add to work notes'); }, fieldLabel: tm('Work notes') },
      { field: 'comments', kinds: ['catalog_task'], get label() { return requesterCommentLabel(); }, labelFor: requesterCommentLabel, fieldLabel: tm('Additional comments') },
    ],
    system:
      'You help a service desk agent tell a requester where their service request stands.\n' +
      'Write a short, friendly status message the agent can send to the requester as a comment.\n' +
      'Base it on the line "Status worked out from the records" and on the approvals and tasks in the ticket data.\n' +
      'Rules: plain, calm language with no jargon and no system names. Say what is happening now and what it is waiting for. ' +
      'Say what happens next only if the data says so. Refer to teams in general terms ("our desktop support team"); never name an individual staff member, approver or any other person. ' +
      'Do not promise a date or an outcome the data does not support; mention a due date only if the data gives one, as "expected by". ' +
      'If an approval was rejected, say so gently and invite the requester to reply if they want to talk about it. ' +
      'Never mention work notes or anything internal. Start with a short greeting and end with one friendly line. No signature. At most 90 words. ' +
      rulesFor('customer'),
    instruction: 'Write the status message for the requester.',
  },
  {
    id: 'resolution-improve',
    get title() {
      return t('Improve my resolution notes');
    },
    get description() {
      return t('Rewrites the notes you have started so they say the cause, the fix and how it was checked.');
    },
    wave: 2,
    // The kinds whose form has close_notes (a problem keeps its fix in fix_notes, which this does not read).
    kinds: ['incident', 'change', 'requested_item', 'catalog_task', 'case', 'hr_case', 'task'],
    group: 'resolve',
    primary: 'insert',
    when: notNew,
    // Reads what 'resolution-notes' reads plus the people (spec 'resolution-improve'); enrich swaps in the notes typed on the form.
    journal: 15,
    enrich: typedNotes,
    parts: resolutionImproveParts,
    // The answer keeps every fact of the notes it rewrites, so it REPLACES them (Add below would leave the old and the new).
    insert: [
      { field: 'close_notes', kinds: ['incident', 'case'], get label() { return t('Insert into resolution notes'); }, fieldLabel: tm('Resolution notes'), mode: 'replace' },
      { field: 'close_notes', kinds: ['requested_item', 'catalog_task', 'task', 'change', 'hr_case'], get label() { return t('Insert into close notes'); }, fieldLabel: tm('Close notes'), mode: 'replace' },
    ],
    system:
      'You help a service desk agent improve the resolution notes they are writing for a ServiceNow ticket.\n' +
      'The ticket data has a part called "Close notes": that is the agent\'s current text. Keep every fact in it and rewrite it into these lines:\n' +
      'Cause: what went wrong (or "Not confirmed").\n' +
      'Fix: what was done, step by step if more than one.\n' +
      'Verification: how it was confirmed to work, or "Not confirmed with the customer".\n' +
      'Rules: add a fact only if the rest of the ticket data states it; never invent a cause, a step or a confirmation. ' +
      'Keep the agent\'s own wording where it is already clear. Name the product, the error text and the action taken, because other agents will search these notes later. ' +
      'Do not include passwords, keys, card numbers or the customer\'s personal details. The customer can often read these notes: describe what was done, not who did it. ' +
      'No greeting, no apology, nothing before or after the three lines, at most 120 words. ' +
      rulesFor('agent'),
    instruction: 'Rewrite the agent\'s resolution notes so they are complete and useful to the next person.',
  },
  {
    id: 'fulfilment-checklist',
    get title() {
      return t('Draft a checklist from the instructions');
    },
    get description() {
      return t('Turns the written instructions and the request answers into short, ordered steps.');
    },
    wave: 3,
    // Offered only when the written instructions give no steps by themselves (the AI Assist list checks that first: the no-AI
    // checklist in Insights is the better answer when there is one).
    kinds: ['requested_item', 'catalog_task'],
    group: 'work',
    primary: 'copy',
    when: notClosed,
    journal: 0,
    enrich: withRequestAnswers,
    parts: checklistParts,
    insert: { field: 'work_notes', get label() { return t('Add to work notes'); }, fieldLabel: tm('Work notes') },
    system:
      'You help a fulfiller carry out a catalog task or a requested item.\n' +
      'Turn the written instructions and the answers to the request questions in the ticket data into a short, ordered checklist.\n' +
      'Write a numbered list with one action per line. Each line starts with a verb and is under 20 words. Write at most 12 lines. ' +
      'Merge lines that are one action and split a line that hides two. Use the answers (which model, which software, which date) where they change a step.\n' +
      'Rules: use only what the data says and never invent a step the instructions do not support. ' +
      'If the instructions are missing or too vague, write a short general list for this kind of item and make the first line "Instructions are missing, so this is a general list". ' +
      'Do not include passwords or personal details. No introduction and no closing. ' +
      rulesFor('agent'),
    instruction: 'Write the checklist for this task.',
  },
];
