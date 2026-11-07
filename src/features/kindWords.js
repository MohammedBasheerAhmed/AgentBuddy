// What kind of ticket an AI run is about, in fixed English sentences chosen by `pack.kind` from a lookup (audit of 2026-11-07, F4, F8,
// F12: "the panel is incident-first"). Until now every prompt said "a service desk agent" and "a ServiceNow ticket", the summary asked a
// laptop order for its "Impact" and the resolution notes asked a delivered account for its "Cause". The model was never told which
// kind of ticket it had, so the shape of the answer was always the incident's.
//
// Build rule 3 allows this: the sentences are FIXED text picked by the kind of record, they hold no ticket data, and they are English
// like every prompt (a prompt is never shown to a person, and the answer follows the language of the ticket, src/prompts/rules.js).
//
//   kindStatement(kind)        one sentence: what this kind of ticket is, and what the work on it is
//   kindNote(featureId, kind)  what the run appends to the action's own prompt: the statement, and for the actions whose answer has a
//                              shape that depends on the kind (the summary, the resolution notes, the missing details) how that shape
//                              reads for this kind. '' for an action or a kind with nothing to add.
//
// The panel wires this in one place (src/lib/pipeline.js prepareRun appends kindNote(feature.id, pack.kind) to the system message, before
// the language rule). The action's own text is unchanged, so a person's output format (src/formats) and the organisation's keep working:
// the note is added after them and only describes the kind.

/** One sentence per kind of ticket: what it is, so the model does not take every ticket for an incident. */
export const KIND_STATEMENT = Object.freeze({
  incident: 'This ticket is an incident: something that stopped working or does not work as it should, reported by the person it affects.',
  problem: 'This ticket is a problem: the underlying cause behind one or more incidents, worked by a team; there is no customer to reply to.',
  change: 'This ticket is a change request: planned work on a service or system, with a type, a risk, a schedule and an approval.',
  request: 'This ticket is a service request: something a person asked for from the service catalog, made up of requested items. Nothing has gone wrong.',
  requested_item:
    'This ticket is a requested item: one thing a person ordered from the service catalog (a laptop, an account, access), fulfilled through catalog tasks. Nothing has gone wrong; the work is to deliver what was ordered.',
  catalog_task:
    'This ticket is a catalog task: one step of fulfilling a requested item, done by a fulfiller. Nothing has gone wrong; the work is to deliver what was ordered, for the person who requested it.',
  case: 'This ticket is a customer service case: a customer\'s question or issue, handled by a support agent.',
  hr_case: 'This ticket is an HR case: an employee\'s request or question to HR, handled by an HR agent.',
  task: 'This ticket is a task: one piece of work that belongs to a larger ticket or to a team.',
  other: 'This ticket is of a kind Agent Buddy does not know by name; it is some piece of work that people handle.',
});

// ---- The kinds that fulfil something -------------------------------------------------------------------------------------------

const FULFILMENT = Object.freeze(['request', 'requested_item', 'catalog_task']);

/** Is this a kind whose work is delivering what was asked for (nothing has gone wrong, so there is no cause)? */
export const isFulfilment = (kind) => FULFILMENT.includes(kind);

// ---- How the answer reads for the kind -----------------------------------------------------------------------------------------

// The five lines of the summary (Issue, Impact, Done so far, Current state, Next step) are an incident's. The lines stay (the panel and a
// person's format name them); what they mean for the kind is said here.
const SUMMARY = Object.freeze({
  request:
    'Read the five lines for a service request: Issue is what was asked for and for whom; Impact is who needs it and by when ("Not stated" if the data does not say); Done so far is what has been fulfilled and approved; Current state is the stage and who holds the work; Next step is the next fulfilment action.',
  requested_item:
    'Read the five lines for a requested item: Issue is what was ordered, how many, and for whom; Impact is who needs it and by when ("Not stated" if the data does not say); Done so far is what has been approved and fulfilled; Current state is the stage and who holds the work; Next step is the next fulfilment action.',
  catalog_task:
    'Read the five lines for a catalog task: Issue is what has to be delivered, from the request form answers, and for whom; Impact is who needs it and by when ("Not stated" if the data does not say); Done so far is what has been done on this task; Current state is the state and who holds the task; Next step is the next fulfilment action.',
  change:
    'Read the five lines for a change: Issue is what the change does and why; Impact is the risk, the schedule and the services it touches; Done so far is the approvals and tasks completed; Current state is the state, the approval and who holds it; Next step is what has to happen before or at the planned time.',
  problem:
    'Read the five lines for a problem: Issue is the underlying fault; Impact is the incidents and the people it causes trouble for; Done so far is what the investigation found; Current state is whether it is a known error and whether a workaround exists; Next step is the next investigation or fix step.',
  hr_case:
    'Read the five lines for an HR case: Issue is what the employee asked; Impact is what depends on the answer ("Not stated" if the data does not say); Done so far is what HR has done; Current state is the state and who holds the case; Next step is the next HR action.',
  task: 'Read the five lines for a task: Issue is the work to be done; Impact is what depends on it ("Not stated" if the data does not say); Done so far is what has been done; Current state is the state and who holds the task; Next step is the next action.',
});

// The lines of the resolution notes. The action's own prompt asks for Cause, Fix, Verification and a suggested close code (an incident's);
// these say what to write instead for the other kinds. A line the panel reads back keeps its label: Insert picks "Cause", "Fix" and
// "Verification" for a problem's two boxes, and drops the "Suggested close code" line from every box (src/features/picks.js).
const NOTES = Object.freeze({
  request:
    'This is not an incident: write these lines instead of Cause, Fix, Verification and Suggested close code, and write no cause. Delivered: what was provided or done, and for whom. Done: how, step by step if more than one. Confirmed: how the requester confirmed it, or "Not confirmed with the requester". Requester to do: anything the requester still has to do, or "Nothing".',
  requested_item:
    'This is not an incident: write these lines instead of Cause, Fix, Verification and Suggested close code, and write no cause. Delivered: what was provided or done, and for whom. Done: how, step by step if more than one. Confirmed: how the requester confirmed it, or "Not confirmed with the requester". Requester to do: anything the requester still has to do, or "Nothing".',
  catalog_task:
    'This is not an incident: write these lines instead of Cause, Fix, Verification and Suggested close code, and write no cause. Delivered: what this task provided or did, and for whom. Done: how, step by step if more than one. Requester to do: anything the requester still has to do, or "Nothing". Hand-over: what the next task or the requested item needs from this one, or "None".',
  change:
    'This is a change: write these lines instead of Cause, Fix and Verification. Outcome: whether the change was carried out and whether it succeeded. Implementation: what was done, step by step if more than one. Verification: how the result was checked. Issues: anything unexpected, or "None". Then the Suggested close code line.',
  problem:
    'This is a problem: Cause is the root cause (or "Not confirmed"); add a line Workaround: what keeps people working until the fix, or "None"; Fix is the permanent fix; Verification is how it was confirmed. Suggested close code is the resolution code.',
  case: 'This is a customer service case: write these lines instead of Cause, Fix and Verification. What was done: the steps taken, in plain words. Outcome: how it ended for the customer. Confirmed: how the customer confirmed it, or "Not confirmed with the customer". Then the Suggested close code line, as a resolution code.',
  hr_case:
    'This is an HR case: write these lines instead of Cause, Fix, Verification and Suggested close code. What was done: the steps taken, in plain words. Outcome: how it ended for the employee. Confirmed: how the employee confirmed it, or "Not confirmed with the employee". Write nothing that is not needed to understand the outcome.',
  task: 'This is a task, not an incident: write these lines instead of Cause, Fix, Verification and Suggested close code, and write no cause. Done: what was done, step by step if more than one. Result: what it produced or how it ended. Left to do: anything still open for the parent ticket, or "Nothing".',
});

// What "missing details" means when the ordered item's answers are in the data.
const MISSING = Object.freeze({
  request: 'The answers to the request form are in the data: do not ask for anything they already answer.',
  requested_item: 'The answers to the request form are in the data: do not ask for anything they already answer.',
  catalog_task: 'The answers to the request form are in the data: do not ask for anything they already answer. Ask only for what the fulfiller still needs to carry out this task.',
});

// The shapes by action. The resolution actions share one.
const SHAPE = Object.freeze({
  'record-summary': SUMMARY,
  'resolution-notes': NOTES,
  'prepare-close': NOTES,
  'resolution-improve': NOTES,
  'missing-info': MISSING,
});

// The actions that are told what kind of ticket they have: everything that writes about a ticket in general. (The domain actions work on
// one kind and say so in their own prompt; a chat, an article and the reports are not tickets.)
const ACTIONS = Object.freeze([
  'record-summary', 'reply-draft', 'resolution-notes', 'prepare-close', 'resolution-improve', 'handoff-brief', 'missing-info', 'thread-summary',
  'next-best-action', 'sentiment-risk', 'kb-article-draft', 'caller-briefing', 'routing-hint',
]);

/** One sentence saying what kind of ticket this is; '' for a kind that is not a ticket (an article, a chat). */
export const kindStatement = (kind) => KIND_STATEMENT[kind] || '';

/** Does this action take a note about the kind of ticket? */
export const takesKindNote = (featureId) => ACTIONS.includes(featureId);

/**
 * What to append to an action's system message for a ticket of this kind: the statement, then how the answer's shape reads for the kind
 * (when the action has one). '' when the action takes no note or the kind is not a ticket's. Fixed text only.
 */
export function kindNote(featureId, kind) {
  if (!takesKindNote(featureId)) return '';
  const statement = kindStatement(kind);
  if (!statement) return '';
  const shape = SHAPE[featureId]?.[kind] || '';
  // (an incident is what the action's own prompt is written for: nothing to say about its shape)
  return [statement, shape].filter(Boolean).join(' ');
}

/** The kinds that have their own lines for the resolution notes (everything but an incident, which the prompt is written for). */
export const NOTES_KINDS = Object.freeze(Object.keys(NOTES));
