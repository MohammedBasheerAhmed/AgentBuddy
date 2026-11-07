// Who is the customer on a record, and did they write a given note? One answer for every place that asks: the resolution check, the
// mood signals, the glance and the journey, the email suggestions and templates, the missing details and the VIP read. Pure.
//
// Names, logins and email addresses are compared as KEYS: in any script (Arabic, Cyrillic, CJK and Latin letters are all kept),
// without accents, marks or case, words in any order. So "Tuter, Abel", "Abel Tuter", "ABEL TUTER" and the login "abel.tuter" are
// one key, and so are "أحمد علي" and "احمد علي". A value with no letter or digit has the empty key, which means "cannot tell": it
// never matches anyone.

/**
 * The roles (src/context/people.js PERSON_FIELDS) of the people a ticket is FOR: whoever raised it or is served by it. On an HR case
 * that is opened_for (the employee) and subject_person. opened_by and requested_by are left out on purpose: an agent often opens or
 * orders a ticket on someone else's behalf. In this order, the first is who an email is addressed to.
 */
export const CUSTOMER_ROLES = Object.freeze(['caller', 'requested_for', 'contact', 'consumer', 'opened_for', 'subject_person']);

export const isCustomerRole = (role) => CUSTOMER_ROLES.includes(role);

const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/**
 * The words of a name, login, address or text, folded: compatibility forms (NFKD), no combining marks (accents, Arabic short vowels
 * and the hamza written above or below a letter), lower case, cut at anything that is not a letter or a digit in any script.
 * @returns {string[]}
 */
export function foldWords(value) {
  return str(value).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** A text folded for comparing, words in their order ('' when it has no letter or digit). */
export const foldText = (value) => foldWords(value).join(' ');

/** A person key: the folded words in sorted order ('' = cannot tell). */
export const personKey = (value) => foldWords(value).sort().join(' ');

/**
 * Every key a person can appear as in a note's author: their name, their email, the front of the email (a login often is), and
 * first plus last name. (An author stays a login when the reader's user cannot read sys_user: src/context/journal.js.)
 * @returns {Set<string>}
 */
export function personKeys(person) {
  const email = str(person?.email);
  const keys = [person?.name, email, email.split('@')[0], `${str(person?.firstName)} ${str(person?.lastName)}`].map(personKey).filter(Boolean);
  return new Set(keys);
}

/** The people of a pack who are the customer, in the pack's order. */
export const customersOf = (pack) => (Array.isArray(pack?.people) ? pack.people : []).filter((p) => p && typeof p === 'object' && isCustomerRole(p.role));

/**
 * The customer(s) and the assignee of a pack as sets of person keys. `known` is true when at least one customer has a key, so
 * "not the customer" means something.
 * @returns {{ customers: Set<string>, support: Set<string>, known: boolean }}
 */
export function identities(pack) {
  const customers = new Set();
  const support = new Set();
  for (const p of Array.isArray(pack?.people) ? pack.people : []) {
    if (!p || typeof p !== 'object') continue;
    if (isCustomerRole(p.role)) personKeys(p).forEach((k) => customers.add(k));
    else if (p.role === 'assigned_to') personKeys(p).forEach((k) => support.add(k));
  }
  // A catalog task's requester is known (walked from its requested item, F1), but the requester does not read the comments of a catalog task
  // (the panel assumes it everywhere: src/features/stages.js cautionFor): they are not a conversation with the customer, so nobody who wrote
  // there can be told apart, and nothing is claimed about 'the customer replied'. The same for the other tasks, whose person is now their
  // parent's (the caller of an incident task, the contact of a case task, F15): they do not write on the task either.
  const conversation = pack?.kind !== 'catalog_task' && pack?.kind !== 'task';
  return { customers, support, known: conversation && customers.size > 0 };
}

/**
 * A display name has a space ("Beth Anglin") or a comma ("Anglin, Beth"); a bare login ("beth.anglin", "x123456") or address does
 * not. One that matches no customer may still be the customer's (a login that is not their email, a second address), so it is not
 * proof that somebody else wrote.
 */
export const looksLikeLogin = (by) => Boolean(str(by)) && !/[\s,]/.test(str(by));

/**
 * Who wrote a customer-visible comment, as far as can be told:
 *   'customer'  the author is one of the customers
 *   'support'   the assignee, or a display name that is not a customer's
 *   'unknown'   no customer is known, the author has no key, or a login or address that matches no one
 * @param {string} by the entry's author
 * @param {{ customers: Set<string>, support?: Set<string>, known: boolean }} ids from identities()
 */
export function authorRole(by, ids) {
  const key = personKey(by);
  if (!ids?.known || !key) return 'unknown';
  if (ids.customers.has(key)) return 'customer';
  if (ids.support?.has(key)) return 'support';
  return looksLikeLogin(by) ? 'unknown' : 'support';
}
