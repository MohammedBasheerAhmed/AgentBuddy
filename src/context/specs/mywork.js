// Context specs for the My work screen (owner: My work agent, docs/round3.md). See src/context/specs/index.js.
//
// My work reads no context pack: its reads (src/mywork/read.js) ask for a fixed, small list of columns per table, written down with
// the reason for each in src/mywork/tables.js (COMMON_COLUMNS, KNOWN_TABLES): the number, the title, priority, state, times, class and
// CI of each ticket, the hold reason, and the customer's login (compared in the content script, never sent to the panel). No free text
// but the title, no journal text (only who wrote a comment and when). Nothing here goes to an AI.
//
// Round 4 (docs/round4.md, "tickets at risk"): the few columns below are read on the rows of MY queue only (not the unassigned tickets
// of my groups), by the ticket's kind (src/context/kinds.js kindForTable), so My work can say why a ticket is at risk
// (src/mywork/risk.js). Each one is on that kind's display ceiling (FIELDS_BY_KIND in src/context/allowlists.js, with the extendFields
// of specs/itsm.js and specs/insights.js); tests/mywork-risk.test.js checks it, and that every dot-walk is the same walk My work
// already makes for the customer's login. A column the instance does not return is simply not used. No text, no names.

/** Counters, by the kinds whose ceiling has them. */
export const RISK_COLUMNS = Object.freeze({
  // reassigned 2 or more times: the ticket bounced between teams (a task column; HR cases and changes have no ceiling for it)
  reassignment_count: Object.freeze(['incident', 'problem', 'requested_item', 'catalog_task', 'case', 'task']),
  // reopened at least once: the fix did not hold. A base column of incident only (other tables: docs/live-questions/mywork.md)
  reopen_count: Object.freeze(['incident']),
});

/**
 * VIP caller: the customer's own VIP flag (sys_user.vip; a customer contact is a sys_user row too), dot-walked from the customer
 * column the ticket already names for "customer replied" (src/mywork/tables.js KNOWN_TABLES). Only a true / false comes back.
 */
export const VIP_COLUMNS = Object.freeze({
  incident: 'caller_id.vip',
  requested_item: 'requested_for.vip',
  catalog_task: 'request_item.requested_for.vip',
  case: 'contact.vip',
});

/**
 * Priority account (N28, src/insights/priorityAccount.js): the case's account, as its display name, compared in the panel with the
 * organisation's policy `priorityAccounts`. Read only when that list names at least one account (the panel says so with the read).
 */
export const ACCOUNT_COLUMNS = Object.freeze({ case: 'account' });

export default {};
