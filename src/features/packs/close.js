// Round 4 (docs/round4.md), owned by the Close well agent: "Prepare to close" (AI), the fifth slot of AI Assist ("Close well").
//
// One answer with sections, each labelled with where it came from:
//   Ready to resolve?   From ServiceNow: the open findings of the resolve check (src/checks/resolutionCheck.js)          no AI
//   Close code          From look-alikes: the code most solved look-alikes used (src/insights/closeCode.js)              no AI
//   Resolution notes    Written by your AI: this feature (the request of "Write resolution notes" without its close-code line)
//   Repeat issue        From the caller's tickets, only when there is one (src/insights/closeCode.js repeatOfCaller)     no AI
//
// Only the notes go to the AI, through the firewall like every feature: the same context spec ('resolution-notes'), the same parts
// and the same prompt minus the "Suggested close code" line (the code comes from ServiceNow, not from the AI), so what is read, what
// is masked and how the notes are written are those of "Write resolution notes". The no-AI sections are worked out in the panel
// (src/sidepanel/ticket/assist/answers/prepareClose.js) from reads the Insights half makes anyway; they are never part of the pack,
// the parts or the prompt.
//
// Insert fills two fields (the user's named exception, docs/build-rules.md rule 1): the close code first, by its stored value, then
// the notes, in the right box for the kind (src/sidepanel/insertFlow.js insertCloseAndNotes). Nothing is saved; Undo puts both back.
import core from './core.js';
import { notNew } from '../stages.js';
import { pickCauseNotes, pickFixNotes, pickResolutionNotes } from '../picks.js';
import { t, tm } from '../../i18n/index.js';

export const PREPARE_CLOSE = 'prepare-close';

// "Write resolution notes" (src/features/packs/core.js): its parts, prompt and instruction are the ones used here.
const NOTES = core.find((f) => f.id === 'resolution-notes');

// The two pieces of the resolution-notes prompt that ask the AI for a close code. Without them the AI writes the notes only.
export const CODE_LINE = 'Suggested close code: one short phrase for the closure category.\n';
export const CODE_RULE = 'The "Suggested close code" line is advice for the agent and is not inserted into the notes. ';

/**
 * The resolution-notes prompt without its close-code line. When the prompt no longer has those exact pieces (someone reworded it),
 * the prompt is used as it is: the notes are still right, and Insert still leaves a close-code line out (pickResolutionNotes).
 * tests/close-feature.test.js fails in that case, so the wording is brought back in step.
 */
export function notesOnlyPrompt(system) {
  const text = String(system ?? '');
  return text.includes(CODE_LINE) && text.includes(CODE_RULE) ? text.replace(CODE_LINE, '').replace(CODE_RULE, '') : text;
}

export default [
  {
    id: PREPARE_CLOSE,
    get title() {
      return t('Prepare to close');
    },
    get description() {
      return t('Resolve check, close code and notes in one go');
    },
    // What the check before sending says about the parts that are NOT sent (src/sidepanel/PreviewDialog.jsx shows it under the title).
    get previewNote() {
      return t('The resolve check and the close code come from your ServiceNow data, not from the AI, and are not sent. The AI only writes the notes.');
    },
    wave: 3,
    kinds: [...NOTES.kinds], // where "Write resolution notes" is offered: every kind with a notes box
    group: 'resolve',
    primary: 'insert',
    when: notNew, // as "Write resolution notes": a ticket that has just come in has nothing to close yet
    context: 'resolution-notes', // the same fields, journal and extras: nothing more about the ticket is read
    journal: NOTES.journal,
    parts: NOTES.parts,
    system: notesOnlyPrompt(NOTES.system),
    instruction: NOTES.instruction,
    // The notes box of each kind, as "Write resolution notes" has them. The close code is not an insert of the answer: its value comes
    // from the look-alikes, never from the AI's text, and it is added by the answer card (insertCloseAndNotes) where the form has it.
    insert: [
      { field: 'close_notes', kinds: ['incident', 'case'], get label() { return t('Insert'); }, fieldLabel: tm('Resolution notes'), mode: 'replace', pick: pickResolutionNotes },
      { field: 'close_notes', kinds: ['requested_item', 'catalog_task', 'task'], get label() { return t('Insert'); }, fieldLabel: tm('Close notes'), mode: 'replace', pick: pickResolutionNotes },
      { field: 'fix_notes', kinds: ['problem'], get label() { return t('Insert'); }, fieldLabel: tm('Fix notes'), mode: 'replace', pick: pickFixNotes },
      { field: 'cause_notes', kinds: ['problem'], get label() { return t('Insert the cause into cause notes'); }, fieldLabel: tm('Cause notes'), mode: 'replace', pick: pickCauseNotes },
    ],
  },
];
