// Feature definitions for the record checks area (see docs/contracts.md, "Feature definition"). All three are run from a
// record tab (Request, Check, Checklist), not from the Actions list, so `kinds` is empty. Each one is a button on its tab;
// the tab runs it through useRun() like any other feature, so policy, the firewall and the preview apply.
//
// Prompts are fixed text. Ticket data only ever arrives as `parts` (untrusted, masked).
import { requestExplainParts } from '../../checks/requestView.js';
import { checklistParts } from '../../checks/checklistParts.js';
import { resolutionImproveParts } from '../../checks/resolutionParts.js';
import { rulesFor } from '../../prompts/rules.js';

export default [
  {
    id: 'request-explain',
    title: 'Explain it in plain words for the requester',
    description: 'A short, friendly message that says where the request stands and what it is waiting for.',
    wave: 1,
    kinds: [],
    journal: 6,
    parts: requestExplainParts,
    insert: { field: 'comments', label: 'Insert as customer comment', fieldLabel: 'Additional comments' },
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
    title: 'Improve my resolution notes',
    description: 'Rewrites the notes you have started so they say the cause, the fix and how it was checked.',
    wave: 2,
    kinds: [],
    // Reads what 'resolution-notes' reads plus the people (spec 'resolution-improve'); the Check tab swaps in the notes typed on the form.
    journal: 15,
    parts: resolutionImproveParts,
    insert: { field: 'close_notes', label: 'Insert into resolution notes', fieldLabel: 'Resolution notes' },
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
    title: 'Propose a cleaner checklist',
    description: 'Turns the written instructions and the answers to the request questions into a short, ordered list of steps.',
    wave: 3,
    kinds: [],
    journal: 0,
    parts: checklistParts,
    insert: { field: 'work_notes', label: 'Add to work notes', fieldLabel: 'Work notes' },
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
