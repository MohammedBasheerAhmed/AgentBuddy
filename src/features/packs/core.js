// The first five features: summary, customer reply, resolution notes, hand-off brief, missing information.
//
// Round 3 fields (docs/round3.md): `group` (Understand, Reply, Work it, Resolve), `primary` ('copy' for a note to self, 'insert' for
// text that belongs on the form) and `when(record, header)` (state rules, src/features/stages.js). An insert may name the `kinds`
// it is for (the problem form has no resolution-notes box) and a `mode` ('replace' for notes that are rewritten as a whole).
import { packToParts } from '../parts.js';
import { ALL_TASKS, WORKABLE } from './kinds.js';
import { relatedParts } from '../../itsm/parts.js';
import { pickCauseNotes, pickFixNotes, pickRequesterQuestions, pickResolutionNotes } from '../picks.js';
import { hasCustomer, notClosed, notNew } from '../stages.js';
import { rulesFor } from '../../prompts/rules.js';
import { t, tm } from '../../i18n/index.js';

// The extras a record carries (SLAs, approvals, tasks, answers on the request form). Which of them a feature actually gets is
// decided by its context spec (FEATURE_RELATED); a list that could not be read is said so to the model, never left out silently.
const RELATED_KEYS = ['slas', 'approvals', 'childTasks', 'changeTasks', 'catalogTasks', 'items', 'variables'];
const withRelated = (id, journal) => (pack) => [...packToParts(pack, { journal }), ...relatedParts(pack, RELATED_KEYS, id)];

const CORE = [
  {
    id: 'record-summary',
    get title() {
      return t('Summarise this ticket');
    },
    get description() {
      return t('Issue, impact, what was tried and the next step, in five lines.');
    },
    wave: 1,
    kinds: ALL_TASKS,
    group: 'understand',
    primary: 'copy', // a note for the agent: Copy first, "Add to work notes" second
    journal: 15,
    parts: withRelated('record-summary', 15),
    insert: { field: 'work_notes', get label() { return t('Add to work notes'); }, fieldLabel: tm('Work notes') },
    system:
      'You help a service desk agent understand a ServiceNow ticket in seconds.\n' +
      'Write a summary with exactly these five lines, in this order, each one to two short sentences:\n' +
      'Issue: what the person reports.\n' +
      'Impact: who or what is affected and how badly, only as the ticket says.\n' +
      'Done so far: steps already tried and their results.\n' +
      'Current state: status, owner and anything we are waiting for.\n' +
      'Next step: the single most useful next action.\n' +
      'Rules: use only facts in the ticket data. Write "Not stated" when something is missing. Do not guess causes. No greeting, nothing before or after the five lines, at most 120 words. ' +
      rulesFor('agent'),
    instruction: 'Summarise the ticket for the agent who is about to work on it.',
  },
  {
    id: 'reply-draft',
    get title() {
      return t('Draft a reply to the customer');
    },
    get description() {
      return t('A short, polite reply to the latest message, ready to edit and send.');
    },
    wave: 1,
    kinds: WORKABLE,
    group: 'reply',
    primary: 'insert',
    // Not on a closed ticket (nobody is waiting for a reply), nor on a task of a problem or a change (there is no customer).
    when: (record, header) => notClosed(record, header) && hasCustomer(record),
    journal: 10,
    insert: { field: 'comments', get label() { return t('Insert as customer comment'); }, fieldLabel: tm('Additional comments') },
    system:
      'You help a service desk agent reply to the person who raised a ticket.\n' +
      'Write the next customer-visible reply to the most recent customer message, using the rest of the ticket for context.\n' +
      'Rules: be polite, calm and specific; use plain language. Answer what was asked. Do not promise a fix, a date or an outcome that the ticket does not support. ' +
      'Never include internal work notes, internal team names or other people\'s details. If information is missing, ask for it as a short numbered list. ' +
      'End with one short closing line. Do not add a signature name. At most 150 words. ' +
      rulesFor('customer'),
    instruction: 'Draft the agent\'s reply to the requester.',
    // Internal notes are context for the agent, not material to quote back at the customer.
    parts: withRelated('reply-draft', 10),
  },
  {
    id: 'resolution-notes',
    get title() {
      return t('Write resolution notes');
    },
    get description() {
      return t('Cause, fix and how it was checked, from the notes and comments.');
    },
    wave: 1,
    kinds: ['incident', 'problem', 'requested_item', 'catalog_task', 'case', 'task'], // not 'request': its ceiling has no close_notes
    group: 'resolve',
    primary: 'insert',
    when: notNew, // a ticket that has just come in has nothing to write up yet
    journal: 25,
    parts: withRelated('resolution-notes', 25),
    // The close code has its own choice field: the Insert leaves the "Suggested close code" line out (src/features/picks.js).
    // Resolution notes are written as a whole, so Insert REPLACES what the box holds (Try again + Insert never doubles them); the
    // person can still choose "Add below" before inserting. Each kind gets its own box: incidents and cases call it "Resolution
    // notes", the request and task forms "Close notes", and a problem has "Cause notes" and "Fix notes" instead (no close_notes).
    insert: [
      { field: 'close_notes', kinds: ['incident', 'case'], get label() { return t('Insert into resolution notes'); }, fieldLabel: tm('Resolution notes'), mode: 'replace', pick: pickResolutionNotes },
      { field: 'close_notes', kinds: ['requested_item', 'catalog_task', 'task'], get label() { return t('Insert into close notes'); }, fieldLabel: tm('Close notes'), mode: 'replace', pick: pickResolutionNotes },
      { field: 'fix_notes', kinds: ['problem'], get label() { return t('Insert into fix notes'); }, fieldLabel: tm('Fix notes'), mode: 'replace', pick: pickFixNotes },
      { field: 'cause_notes', kinds: ['problem'], get label() { return t('Insert the cause into cause notes'); }, fieldLabel: tm('Cause notes'), mode: 'replace', pick: pickCauseNotes },
    ],
    system:
      'You help a service desk agent write resolution notes for a ServiceNow ticket they are about to resolve.\n' +
      'Write exactly these lines:\n' +
      'Cause: what went wrong (or "Not confirmed").\n' +
      'Fix: what was done to resolve it, step by step if more than one.\n' +
      'Verification: how it was confirmed to work, or "Not confirmed with the customer".\n' +
      'Suggested close code: one short phrase for the closure category.\n' +
      'Rules: use only facts in the ticket data and never invent steps. Keep it factual and neutral, no apologies or greetings, at most 120 words. ' +
      'Resolution notes are searched later by other agents, so name the product, error text and the action taken. ' +
      'The customer can often read these notes too: describe what was done, not who did it, and never include passwords, internal discussion or personal details. ' +
      'The "Suggested close code" line is advice for the agent and is not inserted into the notes. ' +
      rulesFor('agent'),
    instruction: 'Write the resolution notes for this ticket.',
  },
  {
    id: 'handoff-brief',
    get title() {
      return t('Write a hand-off brief');
    },
    get description() {
      return t('A structured note so the next person does not re-ask the customer.');
    },
    wave: 1,
    kinds: WORKABLE,
    group: 'work',
    primary: 'insert', // it is written for the work notes, where the next person looks
    when: notClosed,
    journal: 20,
    parts: withRelated('handoff-brief', 20),
    insert: { field: 'work_notes', get label() { return t('Add to work notes'); }, fieldLabel: tm('Work notes') },
    system:
      'You help a service desk agent hand a ticket to another team or shift.\n' +
      'Write an internal hand-off note with exactly these headings, each followed by short bullet points:\n' +
      'Summary\nSymptoms and evidence\nSteps tried (with results)\nOpen questions\nDo this first\nCustomer expectations (dates and SLA stated in the ticket)\n' +
      'Rules: use only facts in the ticket data, write "None" for an empty heading, no guessing, at most 180 words. ' +
      rulesFor('agent'),
    instruction: 'Write the hand-off note for the next resolver.',
  },
  {
    id: 'missing-info',
    get title() {
      return t('Ask the customer for missing details');
    },
    get description() {
      return t('Spots what the ticket does not say and drafts questions to send to the customer.');
    },
    wave: 1,
    kinds: WORKABLE,
    group: 'reply',
    primary: 'insert',
    when: (record, header) => notClosed(record, header) && hasCustomer(record),
    journal: 8,
    parts: withRelated('missing-info', 8),
    // The "Missing:" line is the agent's checklist: only the questions go into the customer comment (src/features/picks.js).
    insert: { field: 'comments', get label() { return t('Insert as customer comment'); }, fieldLabel: tm('Additional comments'), pick: pickRequesterQuestions },
    system:
      'You help a service desk agent get the information needed to resolve a ticket.\n' +
      'First write one line starting "Missing:" that lists, for the agent, the key details not yet in the ticket (for example affected user or device, exact error text, when it started, steps to reproduce, business impact).\n' +
      'Then, after a blank line, write for the requester: one short, friendly sentence that introduces the questions, then 3 to 5 numbered questions. ' +
      'One question per line, plain language, each with a few words of reason in brackets.\n' +
      'Only the part after the "Missing:" line is sent to the requester, as a customer-visible comment.\n' +
      'Rules: only ask for what the ticket does not already say. Never ask for passwords or security codes. No greeting and no signature. At most 120 words in all. ' +
      rulesFor('customer'),
    instruction: 'List what is missing and write the questions to ask the requester.',
  },
];

export default CORE;
