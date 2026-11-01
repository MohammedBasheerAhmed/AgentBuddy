// What a ticket's state means for the person it is assigned to. Pure.
//
// Works on DISPLAY values first (what the person sees), because the stored numbers differ between tables and releases; the few
// stored numbers that are fixed in the base system (incident 3 = On Hold, 6 = Resolved; hold reason 1 = Awaiting Caller) back it
// up. A state that is not recognised counts as live work: unknown fails towards "look at it".
//
//   'resolved'          resolved (or closed) but still active: the base incident and case stay active until they auto-close
//   'waiting-customer'  on hold waiting for the caller / customer / requester (more information, an answer, an acceptance)
//   'on-hold'           on hold for something else (a vendor, a change, a problem, an approval) or pending
//   'new'               not started
//   'open'              anything else: live work

const text = (v) => String(v ?? '').trim();

const FINISHED = /(^|[^a-z])(resolved|closed|complete|completed|cancel{1,2}ed|canceled|skipped|fulfilled)([^a-z]|$)/i;
const HOLD = /(^|[^a-z])(on[ -]?hold|hold|pending|awaiting|waiting|suspended|deferred)([^a-z]|$)/i;
// Who a hold waits for, when it is the customer: "Awaiting Caller", "Awaiting Customer", "Awaiting Info", "Pending customer response",
// "Awaiting user info", "Awaiting acceptance" (an HR or CSM resolution the person has to accept).
const ON_CUSTOMER = /(caller|customer|user|requester|requestor|requested for|employee|info|information|response|reply|feedback|acceptance|contact)/i;
const NEW = /^(new|draft|not started)$/i;

// Stored values that are the same on every base instance.
const RESOLVED_VALUES = { incident: ['6', '7'], sn_customerservice_case: ['6', '3'], problem: ['106', '107'] };
const HOLD_VALUES = { incident: ['3'] };
const CUSTOMER_HOLD_REASONS = { incident: ['1'] };

/**
 * @param {{ table: string, state: string, stateValue?: string, holdReason?: string, holdReasonValue?: string }} t
 * @returns {'resolved' | 'waiting-customer' | 'on-hold' | 'new' | 'open'}
 */
export function workState({ table, state, stateValue = '', holdReason = '', holdReasonValue = '' }) {
  const shown = text(state);
  const value = text(stateValue);
  if (FINISHED.test(shown) || (RESOLVED_VALUES[table] || []).includes(value)) return 'resolved';
  // The STATE decides whether it is on hold; the hold reason only says for whom. (A hold reason left filled in after the ticket went
  // back to In Progress is stale, and must not hide live work.)
  const reason = /^(none|-- none --)$/i.test(text(holdReason)) ? '' : text(holdReason);
  const held = HOLD.test(shown) || (HOLD_VALUES[table] || []).includes(value);
  if (held) {
    const forCustomer =
      (CUSTOMER_HOLD_REASONS[table] || []).includes(text(holdReasonValue)) ||
      (reason && ON_CUSTOMER.test(reason)) ||
      (!reason && /(awaiting|pending|waiting)/i.test(shown) && ON_CUSTOMER.test(shown));
    return forCustomer ? 'waiting-customer' : 'on-hold';
  }
  if (NEW.test(shown)) return 'new';
  return 'open';
}

/** Is this state one where the ticket waits (on the customer or on someone else)? */
export const isWaiting = (ws) => ws === 'waiting-customer' || ws === 'on-hold';
