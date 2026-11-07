// The person a ticket is for, in the words of the kind (audit of 2026-11-07, F11). The panel said "the caller" about everyone: for a
// requested item or a catalog task the person is the requester, for an HR case the employee, for a customer service case the customer,
// for a change the person who asked for it. One pure helper, so every sentence that names the person picks the same word:
//
//   personNoun(subject)   'caller' | 'requester' | 'employee' | 'customer' | 'person'   subject: a kind, or { kind, table }
//   personWords(subject)  the sentences that need the noun, each ONE whole translated sentence per noun (a language can order the
//                         words as it likes; no noun is ever glued into a sentence)
//
// 'caller' is the incident's word and the one used when the kind is not known, so every sentence an incident shows is the one it always
// was. 'person' is the word for a kind that has nobody it is for (a problem, a task with no customer, an article): those sentences do not
// name a noun at all ("Nobody is named on this ticket"). The row titles ("Same caller") are static, shared with the command palette, and
// are not built here.
//
// Pure: no I/O. The kind is the panel's (src/context/kinds.js); a task has the kind 'task', so its class (the table) decides: the task
// of an incident has its caller, the task of a change its requester, of a customer service case its customer, of an HR case its employee.

import { t, tn } from '../i18n/index.js';

const NOUN_BY_KIND = Object.freeze({
  incident: 'caller',
  request: 'requester',
  requested_item: 'requester',
  catalog_task: 'requester',
  change: 'requester',
  case: 'customer',
  hr_case: 'employee',
  chat: 'customer',
  problem: 'person',
  knowledge: 'person',
});

const NOUN_BY_TASK_TABLE = Object.freeze({
  incident_task: 'caller',
  change_task: 'requester',
  sn_customerservice_task: 'customer',
  sn_hr_core_task: 'employee',
});

/** The word for the person a ticket is for. A kind that is not known (or not given) is the incident's 'caller', as before. */
export function personNoun(subject) {
  const kind = typeof subject === 'string' ? subject : String(subject?.kind || '');
  const table = typeof subject === 'object' && subject ? String(subject.table || '').toLowerCase() : '';
  if (kind === 'task') {
    if (Object.hasOwn(NOUN_BY_TASK_TABLE, table)) return NOUN_BY_TASK_TABLE[table];
    // (any other task table of the HR family is the employee's)
    return /^sn_hr_.*_task$/.test(table) ? 'employee' : 'person';
  }
  return Object.hasOwn(NOUN_BY_KIND, kind) ? NOUN_BY_KIND[kind] : 'caller';
}

// Each phrase: the sentence for each noun, written out in full. A noun a phrase has no sentence for (a 'person') says it as the caller's.
const pick = (table, noun) => (table[noun] || table.caller)();

/**
 * The sentences that name the person, for a kind. Every function returns the text in the panel's language.
 * @param {string|{ kind?: string, table?: string }} subject
 */
export function personWords(subject) {
  const noun = personNoun(subject);
  return {
    noun,

    // ---- "Same caller": the row's line (src/insights/related.js callerSummary) and the card's body (CallerCard.jsx) ---------------------
    unreadable: () =>
      pick(
        {
          caller: () => t('Could not read who the caller is'),
          requester: () => t('Could not read who the requester is'),
          employee: () => t('Could not read who the employee is'),
          customer: () => t('Could not read who the customer is'),
          person: () => t('Could not read who this ticket is for'),
        },
        noun
      ),
    nobody: () =>
      pick(
        {
          caller: () => t('Nobody is named as the caller'),
          requester: () => t('Nobody is named as the requester'),
          employee: () => t('Nobody is named as the employee'),
          customer: () => t('Nobody is named as the customer'),
          person: () => t('Nobody is named on this ticket'),
        },
        noun
      ),
    noEarlier: () =>
      pick(
        {
          caller: () => t('No earlier tickets from this caller'),
          requester: () => t('No earlier tickets from this requester'),
          employee: () => t('No earlier tickets from this employee'),
          customer: () => t('No earlier tickets from this customer'),
          person: () => t('No earlier tickets from this person'),
        },
        noun
      ),
    bodyUnreadable: () =>
      pick(
        {
          caller: () => t('The caller could not be read, so earlier tickets were not looked up.'),
          requester: () => t('The requester could not be read, so earlier tickets were not looked up.'),
          employee: () => t('The employee could not be read, so earlier tickets were not looked up.'),
          customer: () => t('The customer could not be read, so earlier tickets were not looked up.'),
          person: () => t('The person could not be read, so earlier tickets were not looked up.'),
        },
        noun
      ),
    bodyNobody: () =>
      pick(
        {
          caller: () => t('Nobody is named as the caller on this ticket.'),
          requester: () => t('Nobody is named as the requester on this ticket.'),
          employee: () => t('Nobody is named as the employee on this ticket.'),
          customer: () => t('Nobody is named as the customer on this ticket.'),
          person: () => t('Nobody is named on this ticket.'),
        },
        noun
      ),

    // ---- "Since you last looked" (src/insights/sinceLooked.js) ---------------------------------------------------------------------
    /** The row's line for n messages: "the caller wrote", "the caller wrote twice", "the caller wrote 3 times". */
    wrote: (n) => {
      if (n === 1) {
        return pick({ caller: () => t('the caller wrote'), requester: () => t('the requester wrote'), employee: () => t('the employee wrote'), customer: () => t('the customer wrote') }, noun);
      }
      if (n === 2) {
        return pick(
          { caller: () => t('the caller wrote twice'), requester: () => t('the requester wrote twice'), employee: () => t('the employee wrote twice'), customer: () => t('the customer wrote twice') },
          noun
        );
      }
      const times = {
        caller: () => tn(n, 'the caller wrote {n} time', 'the caller wrote {n} times'),
        requester: () => tn(n, 'the requester wrote {n} time', 'the requester wrote {n} times'),
        employee: () => tn(n, 'the employee wrote {n} time', 'the employee wrote {n} times'),
        customer: () => tn(n, 'the customer wrote {n} time', 'the customer wrote {n} times'),
      };
      return pick(times, noun);
    },
    messagesFrom: (n) =>
      pick(
        {
          caller: () => tn(n, '{n} message from the caller', '{n} messages from the caller'),
          requester: () => tn(n, '{n} message from the requester', '{n} messages from the requester'),
          employee: () => tn(n, '{n} message from the employee', '{n} messages from the employee'),
          customer: () => tn(n, '{n} message from the customer', '{n} messages from the customer'),
        },
        noun
      ),
    repliesTo: (n) =>
      pick(
        {
          caller: () => tn(n, '{n} reply to the caller', '{n} replies to the caller'),
          requester: () => tn(n, '{n} reply to the requester', '{n} replies to the requester'),
          employee: () => tn(n, '{n} reply to the employee', '{n} replies to the employee'),
          customer: () => tn(n, '{n} reply to the customer', '{n} replies to the customer'),
        },
        noun
      ),
    /** "The caller wrote" and, with the time, "The caller wrote, today 09:14" (the newest message of the person, TicketInsights). */
    heading: (when = '') =>
      when
        ? pick(
            {
              caller: () => t('The caller wrote, {when}', { when }),
              requester: () => t('The requester wrote, {when}', { when }),
              employee: () => t('The employee wrote, {when}', { when }),
              customer: () => t('The customer wrote, {when}', { when }),
            },
            noun
          )
        : pick({ caller: () => t('The caller wrote'), requester: () => t('The requester wrote'), employee: () => t('The employee wrote'), customer: () => t('The customer wrote') }, noun),

    // ---- The repeat line of "Close well" (src/insights/closeCode.js) ---------------------------------------------------------------
    sameIssue: (number) =>
      pick(
        {
          caller: () => t('{number} from the same caller is the same issue: link it, or raise a problem if it comes back.', { number }),
          requester: () => t('{number} from the same requester is the same issue: link it, or raise a problem if it comes back.', { number }),
          employee: () => t('{number} from the same employee is the same issue: link it, or raise a problem if it comes back.', { number }),
          customer: () => t('{number} from the same customer is the same issue: link it, or raise a problem if it comes back.', { number }),
        },
        noun
      ),

    // ---- Missing details (src/insights/missing.js) ---------------------------------------------------------------------------------
    noContact: () => (noun === 'caller' ? t('No caller or contact') : t('No contact named')),
    noEmail: () =>
      pick(
        {
          caller: () => t('No email address for the caller'),
          requester: () => t('No email address for the requester'),
          employee: () => t('No email address for the employee'),
          customer: () => t('No email address for the customer'),
        },
        noun
      ),

    // ---- The VIP marks (src/insights/risk.js, the Glance chip) -----------------------------------------------------------------------
    vipLow: (priority) =>
      pick(
        {
          caller: () => t('The caller is a VIP but the priority is {priority}.', { priority }),
          requester: () => t('The requester is a VIP but the priority is {priority}.', { priority }),
          employee: () => t('The employee is a VIP but the priority is {priority}.', { priority }),
          customer: () => t('The customer is a VIP but the priority is {priority}.', { priority }),
        },
        noun
      ),
    vipTitle: () =>
      pick({ caller: () => t('VIP caller'), requester: () => t('VIP requester'), employee: () => t('VIP employee'), customer: () => t('VIP customer') }, noun),
    vipNote: () =>
      pick(
        {
          caller: () => t('The caller is marked VIP in ServiceNow.'),
          requester: () => t('The requester is marked VIP in ServiceNow.'),
          employee: () => t('The employee is marked VIP in ServiceNow.'),
          customer: () => t('The customer is marked VIP in ServiceNow.'),
        },
        noun
      ),
  };
}

/**
 * The sentences of "did the person answer?" (src/checks/resolutionCheck.js customerCheck). An incident, a case and any kind not named
 * here keep the words they always had ("the customer"); a request or a requested item says "requester", an HR case "employee".
 */
export function answerWords(subject) {
  const noun = personNoun(subject) === 'requester' || personNoun(subject) === 'employee' ? personNoun(subject) : 'customer';
  const pickCustomer = (table) => table[noun]();
  return {
    noun,
    unreadableHint: () =>
      pickCustomer({
        customer: () => t('Check by eye whether the customer confirmed the fix or has had a chance to answer.'),
        requester: () => t('Check by eye whether the requester confirmed the fix or has had a chance to answer.'),
        employee: () => t('Check by eye whether the employee confirmed the fix or has had a chance to answer.'),
      }),
    noMessages: () =>
      pickCustomer({
        customer: () => t('No messages to or from the customer on this ticket'),
        requester: () => t('No messages to or from the requester on this ticket'),
        employee: () => t('No messages to or from the employee on this ticket'),
      }),
    cannotTell: () =>
      pickCustomer({
        customer: () => t("Could not tell which messages are the customer's"),
        requester: () => t("Could not tell which messages are the requester's"),
        employee: () => t("Could not tell which messages are the employee's"),
      }),
    cannotTellHint: () =>
      pickCustomer({
        customer: () => t('Check by eye that the customer confirmed the fix or had a chance to answer.'),
        requester: () => t('Check by eye that the requester confirmed the fix or had a chance to answer.'),
        employee: () => t('Check by eye that the employee confirmed the fix or had a chance to answer.'),
      }),
    wroteLast: () =>
      pickCustomer({
        customer: () => t('The customer wrote the last message'),
        requester: () => t('The requester wrote the last message'),
        employee: () => t('The employee wrote the last message'),
      }),
    authorUnknownHint: () =>
      pickCustomer({
        customer: () => t('Its author is shown only as a user name. Read it and check whether the customer confirmed the fix.'),
        requester: () => t('Its author is shown only as a user name. Read it and check whether the requester confirmed the fix.'),
        employee: () => t('Its author is shown only as a user name. Read it and check whether the employee confirmed the fix.'),
      }),
    notReplied: (age) =>
      pickCustomer({
        customer: () => t('The customer has not replied to your last message ({age})', { age }),
        requester: () => t('The requester has not replied to your last message ({age})', { age }),
        employee: () => t('The employee has not replied to your last message ({age})', { age }),
      }),
  };
}
