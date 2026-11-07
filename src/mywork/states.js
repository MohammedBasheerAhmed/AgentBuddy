// What a ticket's state means for the person it is assigned to. Pure.
//
// The one reader of a state is src/domain/states.js (docs/states.md): by the STORED value of the state for the ticket's own table, then by the
// words of the label in English, German or Arabic. This file only turns its answer into the words My work has always used. A state that is not
// recognised counts as live work: unknown fails towards "look at it".
//
//   'resolved'          resolved, closed or cancelled but still active: the base incident and case stay active until they auto-close
//   'waiting-customer'  on hold waiting for the caller / customer / requester (more information, an answer, an acceptance)
//   'on-hold'           on hold for something else (a vendor, a change, a problem, an approval, an earlier task) or pending
//   'new'               not started
//   'open'              anything else: live work
import { classifyState, waitsOn } from '../domain/states.js';

/**
 * @param {{ table: string, state: string, stateValue?: string, holdReason?: string, holdReasonValue?: string, stage?: string }} t
 *   `state`: the label shown; `stateValue`: the stored value; `stage`: a requested item's stage (stored or shown)
 * @returns {'resolved' | 'waiting-customer' | 'on-hold' | 'new' | 'open'}
 */
export function workState({ table, state, stateValue = '', holdReason = '', holdReasonValue = '', stage = '' }) {
  const args = { table, value: stateValue, label: state, stage };
  const meaning = classifyState(args);
  if (meaning === 'resolved' || meaning === 'closed' || meaning === 'cancelled') return 'resolved';
  // The STATE decides whether it is on hold; the hold reason only says for whom. (A hold reason left filled in after the ticket went
  // back to In Progress is stale, and must not hide live work.)
  if (meaning === 'waiting') return waitsOn({ ...args, holdReason, holdReasonValue }) === 'customer' ? 'waiting-customer' : 'on-hold';
  if (meaning === 'new') return 'new';
  return 'open';
}
