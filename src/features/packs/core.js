// The first five features: summary, customer reply, resolution notes, hand-off brief, missing information.
import { packToParts } from '../parts.js';
import { ALL_TASKS, WORKABLE } from './kinds.js';
import { relatedParts } from '../../itsm/parts.js';

// The extras a record carries (SLAs, approvals, tasks, answers on the request form). Which of them a feature actually gets is
// decided by its context spec (FEATURE_RELATED); a list that could not be read is said so to the model, never left out silently.
const RELATED_KEYS = ['slas', 'approvals', 'childTasks', 'changeTasks', 'catalogTasks', 'items', 'variables'];
const withRelated = (id, journal) => (pack) => [...packToParts(pack, { journal }), ...relatedParts(pack, RELATED_KEYS, id)];

const CORE = [
  {
    id: 'record-summary',
    title: 'Summarise this ticket',
    description: 'Issue, impact, what was tried, current state and the next step.',
    wave: 1,
    kinds: ALL_TASKS,
    journal: 15,
    parts: withRelated('record-summary', 15),
    insert: { field: 'work_notes', label: 'Add to work notes', fieldLabel: 'Work notes' },
    system:
      'You help a service desk agent understand a ServiceNow ticket in seconds.\n' +
      'Write a summary with exactly these five lines, in this order, each one to two short sentences:\n' +
      'Issue: what the person reports.\n' +
      'Impact: who or what is affected and how badly, only as the ticket says.\n' +
      'Done so far: steps already tried and their results.\n' +
      'Current state: status, owner and anything we are waiting for.\n' +
      'Next step: the single most useful next action.\n' +
      'Rules: use only facts in the ticket data. Write "Not stated" when something is missing. Do not guess causes. No greeting, at most 120 words.',
    instruction: 'Summarise the ticket for the agent who is about to work on it.',
  },
  {
    id: 'reply-draft',
    title: 'Draft a reply to the customer',
    description: 'A short, polite reply to the latest message, ready to edit and send.',
    wave: 1,
    kinds: WORKABLE,
    journal: 10,
    insert: { field: 'comments', label: 'Insert as customer comment', fieldLabel: 'Additional comments' },
    system:
      'You help a service desk agent reply to the person who raised a ticket.\n' +
      'Write the next customer-visible reply to the most recent customer message, using the rest of the ticket for context.\n' +
      'Rules: be polite, calm and specific; use plain language. Answer what was asked. Do not promise a fix, a date or an outcome that the ticket does not support. ' +
      'Never include internal work notes, internal team names or other people\'s details. If information is missing, ask for it as a short numbered list. ' +
      'End with one short closing line. Do not add a signature name. At most 150 words.',
    instruction: 'Draft the agent\'s reply to the requester.',
    // Internal notes are context for the agent, not material to quote back at the customer.
    parts: withRelated('reply-draft', 10),
  },
  {
    id: 'resolution-notes',
    title: 'Write resolution notes',
    description: 'Cause, fix and verification from the work notes and comments.',
    wave: 1,
    kinds: ['incident', 'problem', 'request', 'requested_item', 'catalog_task', 'case', 'task'],
    journal: 25,
    parts: withRelated('resolution-notes', 25),
    insert: { field: 'close_notes', label: 'Insert into resolution notes', fieldLabel: 'Resolution notes' },
    system:
      'You help a service desk agent write resolution notes for a ServiceNow ticket they are about to resolve.\n' +
      'Write exactly these lines:\n' +
      'Cause: what went wrong (or "Not confirmed").\n' +
      'Fix: what was done to resolve it, step by step if more than one.\n' +
      'Verification: how it was confirmed to work, or "Not confirmed with the customer".\n' +
      'Suggested close code: one short phrase for the closure category.\n' +
      'Rules: use only facts in the ticket data and never invent steps. Keep it factual and neutral, no apologies or greetings, at most 120 words. ' +
      'Resolution notes are searched later by other agents, so name the product, error text and the action taken.',
    instruction: 'Write the resolution notes for this ticket.',
  },
  {
    id: 'handoff-brief',
    title: 'Hand-off brief',
    description: 'A structured note so the next person does not re-ask the customer.',
    wave: 1,
    kinds: WORKABLE,
    journal: 20,
    parts: withRelated('handoff-brief', 20),
    insert: { field: 'work_notes', label: 'Add to work notes', fieldLabel: 'Work notes' },
    system:
      'You help a service desk agent hand a ticket to another team or shift.\n' +
      'Write an internal hand-off note with exactly these headings, each followed by short bullet points:\n' +
      'Summary\nSymptoms and evidence\nSteps tried (with results)\nOpen questions\nDo this first\nCustomer expectations (dates and SLA stated in the ticket)\n' +
      'Rules: use only facts in the ticket data, write "None" for an empty heading, no guessing, at most 180 words.',
    instruction: 'Write the hand-off note for the next resolver.',
  },
  {
    id: 'missing-info',
    title: 'What is missing? Questions to ask',
    description: 'Spots missing details and proposes clear questions for the requester.',
    wave: 1,
    kinds: WORKABLE,
    journal: 8,
    parts: withRelated('missing-info', 8),
    insert: { field: 'comments', label: 'Insert as customer comment', fieldLabel: 'Additional comments' },
    system:
      'You help a service desk agent get the information needed to resolve a ticket.\n' +
      'First write one line starting "Missing:" that lists the key details not yet in the ticket (for example affected user or device, exact error text, when it started, steps to reproduce, business impact).\n' +
      'Then write 3 to 5 numbered questions for the requester. One question per line, plain language, each with a few words of reason in brackets.\n' +
      'Rules: only ask for what the ticket does not already say. Never ask for passwords or security codes. No greeting.',
    instruction: 'List what is missing and write the questions to ask the requester.',
  },
];

export default CORE;
