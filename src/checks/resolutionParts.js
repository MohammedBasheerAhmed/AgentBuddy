// Parts for 'resolution-improve': what the notes are rewritten from. The ticket's own fields and its latest notes go (with the
// notes typed on the form in place of the saved ones, see withCurrentNotes), but not the person columns: resolution notes
// should not name the customer or the agents. The pack still HOLDS those people, so the firewall masks any name that appears
// inside the text. Pure: no I/O.
import { packToParts } from '../features/parts.js';

export const PERSON_FIELDS_LEFT_OUT = Object.freeze(['caller_id', 'requested_for', 'contact', 'consumer', 'opened_by', 'assigned_to']);

export function resolutionImproveParts(pack) {
  return packToParts(pack, { journal: 15, skipFields: [...PERSON_FIELDS_LEFT_OUT] });
}
