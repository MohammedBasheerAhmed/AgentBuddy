// The people a record names (caller, assignee, approvers, note authors) with display name and email, so the privacy
// firewall can mask exactly these names and addresses, and snippets can greet the caller by first name.
// Names come from the record itself; emails come from one small sys_user read (name, email, first/last name only).
// When sys_user cannot be read the display names stay and the emails are left out; the pack's `access` says so.

import { LIMITS } from './allowlists.js';
import { STATUS, entry as accessEntry, softRead, tm } from './access.js';

// What the people lookup says (fixed sentences without a table name; marked for the Arabic catalogue).
const PEOPLE_NOTE = Object.freeze({
  denied: tm('You cannot read the details of the people on this ticket, so email addresses are not included.'),
  none: tm('The details of the people on this ticket could not be read, so email addresses are not included.'),
  noEmail: tm('{n} of {total} people have no email address that you can read.'),
  // The email column did not come back for these people (a field the user may not read), which is not the same as an empty one.
  emailHidden: tm('{n} of {total} people have an email address that you cannot read.'),
});
import { SYS_ID_RE, disp, oneLine, raw } from './util.js';

/** Record columns that hold a person, and the role each one plays. */
export const PERSON_FIELDS = Object.freeze({
  caller_id: 'caller',
  requested_for: 'requested_for',
  opened_by: 'opened_by',
  assigned_to: 'assigned_to',
  contact: 'contact',
  consumer: 'consumer',
  requested_by: 'requested_by',
  subject_person: 'subject_person',
  opened_for: 'opened_for',
  // A catalog task's requester, walked from its requested item (src/context/specs/fit.js): the same role as on the item itself.
  'request_item.requested_for': 'requested_for',
});

// A customer contact is a sys_user row too (customer_contact extends it); a consumer lives in its own table.
const TABLE_OF_FIELD = { consumer: 'csm_consumer' };
const USER_FIELDS = ['sys_id', 'user_name', 'name', 'email', 'first_name', 'last_name'];
const LOGIN_RE = /^[\w.@+-]{1,80}$/;

/** People referenced by the allowed columns of a row: [{ role, sysId, name, table }]. Only real references are used. */
export function personRefs(row, fieldNames) {
  const refs = [];
  for (const name of fieldNames) {
    const role = PERSON_FIELDS[name];
    const value = row?.[name];
    const sysId = raw(value);
    if (!role || !SYS_ID_RE.test(sysId)) continue;
    const shown = disp(value);
    refs.push({ role, sysId: sysId.toLowerCase(), name: SYS_ID_RE.test(shown) ? '' : oneLine(shown, 100), table: TABLE_OF_FIELD[name] || 'sys_user' });
  }
  return refs;
}

/** 'Mary Jane Smith' -> { firstName: 'Mary', lastName: 'Jane Smith' }; only a fallback when sys_user gave no names. */
export function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

const personFrom = (role, base, row) => {
  const name = oneLine(row?.name || base.name || '', 100);
  const guess = splitName(name);
  // A person known by id whose user row did not come back with its email column (or at all): the email may exist and be hidden from
  // this user. An empty column is an empty email; a missing one is not (R-14).
  const emailUnreadable = Boolean(base.sysId) && (!row || !Object.hasOwn(row, 'email'));
  return {
    role,
    name,
    email: oneLine(row?.email || '', 120),
    sysId: base.sysId || '',
    firstName: oneLine(row?.first_name || guess.firstName, 60),
    lastName: oneLine(row?.last_name || guess.lastName, 60),
    ...(emailUnreadable ? { emailUnreadable: true } : {}),
  };
};

/**
 * Build the people list.
 * @param {{ refs?: object[], logins?: string[], names?: string[] }} sources
 *   refs: from personRefs (and approver/assignee references from related reads); logins: note authors given as a login;
 *   names: note authors already given as a display name (no sys_id known).
 * @returns {Promise<{ people: object[], access: object[], namesByLogin: Map<string, string> }>}
 */
export async function resolvePeople({ refs = [], logins = [], names = [] }, deps) {
  const safeLogins = [...new Set(logins.filter((l) => LOGIN_RE.test(l)))];
  const rowsById = new Map();
  const rowsByLogin = new Map();
  const access = [];

  // One read per user table (almost always just sys_user); logins ride on the sys_user read.
  const tables = [...new Set([...refs.map((r) => r.table), ...(safeLogins.length ? ['sys_user'] : [])])];
  for (const table of tables) {
    const ids = [...new Set(refs.filter((r) => r.table === table).map((r) => r.sysId))];
    const byLogin = table === 'sys_user' ? safeLogins : [];
    const clauses = [ids.length ? `sys_idIN${ids.join(',')}` : '', byLogin.length ? `user_nameIN${byLogin.join(',')}` : ''].filter(Boolean);
    // eslint-disable-next-line no-await-in-loop -- one or two small reads, kept sequential.
    const { rows, failure } = await softRead(deps, table, clauses.join('^OR'), USER_FIELDS, { limit: ids.length + byLogin.length + 5, displayValue: false });
    if (failure) {
      access.push(accessEntry(table, failure.status, failure.status === STATUS.DENIED ? PEOPLE_NOTE.denied : failure.note));
    } else if (!rows.length) {
      access.push(accessEntry(table, STATUS.DENIED, PEOPLE_NOTE.none));
    } else {
      access.push(accessEntry(table, STATUS.OK));
    }
    for (const row of rows) {
      rowsById.set(raw(row.sys_id).toLowerCase(), row);
      if (raw(row.user_name)) rowsByLogin.set(raw(row.user_name), row);
    }
  }

  const people = [];
  const seenIds = new Set();
  const seenNames = new Set();
  let authors = 0;
  // Every person a column or a related row names (the record's own people, approvers, task owners, people in the form's answers) is
  // kept, however many there are: the row still carries the name, so a person left off this list would reach the AI unmasked (build
  // rule 4). Those rows are capped where they are read (LIMITS.relatedRows, the variables read), which bounds this list too. Only note
  // authors have a cap of their own (LIMITS.people), and a capped author is still masked: the firewall takes every note's author from
  // the notes themselves (peopleFor, src/features/parts.js).
  const add = (person, author = false) => {
    const key = person.name.toLowerCase();
    if (!person.name || (person.sysId && seenIds.has(person.sysId)) || (!person.sysId && seenNames.has(key))) return;
    if (author && authors >= LIMITS.people) return;
    if (author) authors += 1;
    if (person.sysId) seenIds.add(person.sysId);
    seenNames.add(key);
    people.push(person);
  };

  refs.forEach((ref) => add(personFrom(ref.role, ref, rowsById.get(ref.sysId))));
  const namesByLogin = new Map();
  safeLogins.forEach((login) => {
    const row = rowsByLogin.get(login);
    if (!row) return;
    namesByLogin.set(login, oneLine(row.name || login, 100));
    add(personFrom('journal_author', { sysId: raw(row.sys_id).toLowerCase() }, row), true);
  });
  names.forEach((name) => add(personFrom('journal_author', { name, sysId: '' }, null), true));

  const hiddenEmail = people.filter((p) => p.emailUnreadable).length;
  const withoutEmail = people.filter((p) => !p.email && !p.emailUnreadable).length;
  const userAccess = access.find((a) => a.source === 'sys_user');
  if (userAccess?.status === STATUS.OK && (hiddenEmail || withoutEmail)) {
    // "partial": the read worked, but not everything about these people could be seen. The cards print it (src/sidepanel/ticket/cards/bits.jsx).
    userAccess.note = (hiddenEmail ? PEOPLE_NOTE.emailHidden : PEOPLE_NOTE.noEmail).replace('{n}', String(hiddenEmail || withoutEmail)).replace('{total}', String(people.length));
    if (hiddenEmail) userAccess.partial = true;
  }
  return { people, access, namesByLogin };
}
