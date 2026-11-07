// readContextPack: everything one feature may know about one record, as a plain-JSON ContextPack (docs/contracts.md).
//
// Only columns on the feature's allowlist are asked for (sysparm_fields) and only those are copied out, so a column an
// instance returns anyway never reaches the pack. Reads run with the signed-in user's own session; whatever is refused or
// ambiguous is reported in `access` and the pack carries the rest.

import { FEATURES, FEATURE_JOURNAL, FEATURE_TIMES, HR_HIDDEN, allowedFields, featureListsColumn, fieldLimit, maskOnlyFields } from './allowlists.js';
import { NOTE_TEXT, STATUS, absentColumns, entry as accessEntry, isBlockedTable, tm } from './access.js';
import { assignSides, readChatMessages } from './chat.js';
import { JOURNAL_RECORD_FIELDS, applyAuthorNames, readJournal } from './journal.js';
import { articleHtmlStats, statsToStrings } from './knowledge.js';
import { isSensitiveTable, kindForTable, rememberTaskClass, taskRowEvidence } from './kinds.js';
import { personRefs, resolvePeople, splitName } from './people.js';
import { readParentPerson, readRelated, relatedPlan } from './related.js';
import { PARENT_LINK, PARENT_PERSON_LINK, PARENT_TABLE, PARENT_WALK } from './specs/fit.js';
import { SYS_ID_RE, TABLE_RE, cleanText, disp, oneLine, raw, uniq } from './util.js';

export { stripHtml } from './util.js';
export { confirmEmptyIsReallyEmpty } from './access.js';

export const PACK_VERSION = 1;

// Two kinds are not tickets. A knowledge article has no notes, but its structure and its stored dates matter (the pack's text
// is plain, and its dates are shown in the reader's format); a chat has messages instead of a journal.
const TIME_COLUMNS = new Set(['valid_to', 'published', 'sys_updated_on', 'opened_at', 'closed_at']);

// Per-kind plain data for pack.related, all strings (docs/contracts.md):
//   knowledge: { article: counts from the HTML (headings, lists, full text length...), times: stored dates (UTC) }
//   chat:      { times: stored dates (UTC) }
//   any kind, for a feature whose spec names `times` (FEATURE_TIMES): { times: those dates as stored (UTC) }
function kindExtras(kind, row, names, feature) {
  const timed = FEATURE_TIMES[feature] || [];
  if (kind !== 'knowledge' && kind !== 'chat' && !timed.length) return {};
  const extras = {};
  if (kind === 'knowledge' && names.includes('text')) extras.article = statsToStrings(articleHtmlStats(disp(row.text)));
  const times = {};
  for (const name of names) {
    const wanted = kind === 'knowledge' || kind === 'chat' ? TIME_COLUMNS.has(name) : timed.includes(name);
    const stored = wanted ? raw(row[name]) : '';
    if (stored) times[name] = stored;
  }
  if (Object.keys(times).length) extras.times = times;
  return extras;
}

// Person columns that only one of the new kinds has (people.js knows the ticket ones). The author of an article is never shown
// or sent as a field; reading the column lets the privacy filter mask the name wherever the article text mentions it.
const KIND_PERSON_FIELDS = { knowledge: { author: 'author' } };

function kindPersonRefs(kind, row, names) {
  return Object.entries(KIND_PERSON_FIELDS[kind] || {}).flatMap(([name, role]) => {
    const sysId = raw(row[name]);
    if (!names.includes(name) || !SYS_ID_RE.test(sysId)) return [];
    const shown = disp(row[name]);
    return [{ role, sysId: sysId.toLowerCase(), name: SYS_ID_RE.test(shown) ? '' : oneLine(shown, 100), table: 'sys_user' }];
  });
}

// Chat participants get the role they played, once the messages say who spoke on which side.
function chatPeople(people, entries) {
  const sideOf = new Map();
  for (const e of entries) if (e.by && e.side && !sideOf.has(e.by.toLowerCase())) sideOf.set(e.by.toLowerCase(), e.side);
  return people.map((p) => {
    const side = sideOf.get(String(p.name).toLowerCase());
    return p.role === 'journal_author' && (side === 'customer' || side === 'agent') ? { ...p, role: side } : p;
  });
}

// (the message is what a person reads: no table name; the technical words stay in `detail`)
const TICKET_NOT_FOUND = tm('This ticket was not found, or it is not available to you.');

function notFound(table, what) {
  const err = new Error(TICKET_NOT_FOUND);
  err.code = 'NOT_FOUND';
  err.detail = `${what} was not found in ${table}`;
  return err;
}

/** { table, sysId } for a reference given as { table, sysId }: the table name checked, the sys_id in lower case. */
export async function resolveRecordRef(ref) {
  const table = String(ref?.table || '').trim().toLowerCase();
  if (!SYS_ID_RE.test(ref?.sysId || '')) throw new TypeError('A record reference needs a sys_id.');
  if (!TABLE_RE.test(table)) throw new TypeError('A record reference needs a table name.');
  return { table, sysId: ref.sysId.toLowerCase() };
}

/**
 * A record addressed by the base class `task` (/task.do?sys_id=..., a Workspace /record/task/<id>) is really an incident, a
 * customer case, an HR case... Its real class decides the kind, the columns, the HR rules and the policy, so it is looked up first
 * with one small read. Any other table is returned as it is.
 *   resolved: { table }                 the real class (it may be 'task' itself)
 *   unresolved: { table, unresolved }   the class could not be looked up: the record is treated as SENSITIVE (minimised, HR-gated)
 * A lost session, a cancelled read and a class the organisation blocks are thrown, not turned into "unresolved".
 */
export async function resolveRealClass({ table, sysId }, deps) {
  if (table !== 'task') return { table, unresolved: false };
  try {
    const rows = await deps.queryTable('task', `sys_id=${sysId}`, ['sys_id', 'sys_class_name'], { limit: 1, displayValue: false });
    const found = Array.isArray(rows) ? rows[0] : null;
    const actual = found ? raw(found.sys_class_name).trim().toLowerCase() : '';
    // The class a record reports through `task` IS a kind of task: a custom one (u_*, x_*) is remembered as such (F7, src/context/kinds.js).
    if (TABLE_RE.test(actual)) {
      rememberTaskClass(actual);
      return { table: actual, unresolved: false };
    }
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED' || err?.name === 'AbortError' || isBlockedTable(err)) throw err;
  }
  return { table, unresolved: true };
}

// Names (display values) of the people in rows of OTHER tickets, added to the pack as people so the firewall masks them exactly.
// All of them: a name left out would still be in that row's wording. The rows are capped where they are read (at most 20 linked
// incidents with 3 person columns each, 10 overlapping changes and 5 recent ones with 2), which bounds this list.
function referencePeople(names, known) {
  const seen = new Set(known.map((p) => String(p.name || '').toLowerCase()).filter(Boolean));
  const out = [];
  for (const shown of names || []) {
    const name = oneLine(shown, 100);
    const key = name.toLowerCase();
    if (!name || SYS_ID_RE.test(name) || seen.has(key)) continue;
    seen.add(key);
    const guess = splitName(name);
    out.push({ role: 'reference_person', name, email: '', sysId: '', firstName: oneLine(guess.firstName, 60), lastName: oneLine(guess.lastName, 60) });
  }
  return out;
}

/**
 * Read a ContextPack.
 * @param {{ table: string, sysId?: string, number?: string }} ref
 * @param {{ queryTable: Function, fetchRecord: Function, sensitivePrefixes?: string[], isBlocked?: Function }} deps same signatures as
 *   src/content/tableApi.js. The content script passes the deps wrapped by src/content/policyGuard.js: a blocked table throws an error
 *   with code 'BLOCKED_TABLE', and `sensitivePrefixes` carries the policy's extra HR-family prefixes.
 * @param {{ feature?: string, includeJournal?: boolean, allowSensitive?: boolean }} [options]
 *   feature: one of FEATURES (default 'record-summary'); includeJournal: overrides the feature's default;
 *   allowSensitive: read free text and identities of HR-family tables too.
 * @throws an Error with code 'NOT_FOUND' (no such record or not visible), 'ACCESS_DENIED', 'BLOCKED_TABLE' (the organisation does not
 *   allow this table) or 'SESSION_EXPIRED' from the record read itself; every other read fails soft into `access`.
 *   The pack has `sensitive: true` when the record was opened through the base class `task` and its real class could not be looked up.
 *   It has `requirePreview: true` when it carries text about other tickets (linked incidents, overlapping changes...).
 */
export async function readContextPack(ref, deps, options = {}) {
  const { feature = 'record-summary', allowSensitive = false } = options;
  if (!FEATURES.includes(feature)) throw new Error(`Unknown feature "${feature}". Known: ${FEATURES.join(', ')}.`);
  const prefixes = deps.sensitivePrefixes;

  const asked = await resolveRecordRef(ref);
  const { table, unresolved } = await resolveRealClass(asked, deps);
  const sysId = asked.sysId;
  let kind = kindForTable(table);
  const isChat = kind === 'chat';
  // An HR-family table, or a record whose class could not be told, keeps its free text and identities unread unless allowed.
  const sensitive = isSensitiveTable(table, prefixes) || unresolved;
  const minimised = sensitive && !allowSensitive;
  const readNames = allowedFields(table, feature, { allowSensitive, sensitivePrefixes: prefixes });
  // The organisation blocks the table a task's requester and item are walked from: the walk would make the whole read fail (the policy
  // guard refuses a dot-walk through a blocked table), so the walked columns and the link are left out and the pack says so.
  const parentTable = PARENT_TABLE[kind];
  const parentBlocked = Boolean(parentTable) && typeof deps.isBlocked === 'function' && deps.isBlocked(parentTable);
  const walkedOut = parentBlocked ? new Set([...Object.keys(PARENT_WALK[kind] || {}), PARENT_LINK[kind]]) : new Set();
  const names = (unresolved && !allowSensitive ? readNames.filter((name) => !HR_HIDDEN.has(name)) : readNames).filter((name) => !walkedOut.has(name));
  // Person columns that are not part of the feature's own spec are read only to mask those people; they are not fields of the pack.
  const maskOnly = new Set(maskOnlyFields(table, feature));
  const wantJournal = (options.includeJournal ?? FEATURE_JOURNAL[feature]) === true;
  const readJournalNow = wantJournal && !minimised;
  // When the organisation blocks the journal table, the record's own notes columns are not a way round it.
  const journalBlocked = typeof deps.isBlocked === 'function' && deps.isBlocked('sys_journal_field');
  const memo = new Map(); // one "can this user see the table at all" read per table

  // 1. The record: allowlisted columns only, plus the two note columns when notes are wanted (a chat's messages are elsewhere).
  const row = await deps.fetchRecord(table, sysId, readJournalNow && !isChat && !journalBlocked ? [...names, ...JOURNAL_RECORD_FIELDS] : names, { displayValue: true });
  if (!row) throw notFound(table, 'The record');
  // A table the product does not know whose row carries the columns only a task has is a custom kind of task (F7): it is read and
  // described as a task from here on (its SLAs, its child tasks, the task's notes), and remembered as one (src/context/kinds.js). Nothing
  // is read to find out: these columns are on the generic ceiling and came back with the row.
  if (kind === 'other' && taskRowEvidence(row)) {
    rememberTaskClass(table);
    kind = 'task';
  }
  // A catalog task's requester and item come from the requested item it is a step of (F1, F2): the walked columns are read with the
  // task (names below), and the item's own id says where its answers are.
  const walked = PARENT_WALK[kind] || {};
  const aliasOf = (name) => walked[name] || name;

  // Columns the instance did not send at all (not even empty): a field the user may not read (R-14). They are not "empty" and the panel
  // must not say "No description" of them; pack.unreadable names them. (An empty column comes back as an empty value and is dropped below.)
  // A reference whose stored value is an id but whose name came back empty is listed too: the thing is there and its name is hidden
  // from this user (D1, R-13), which is not "unassigned" or "no group".
  const unreadable = absentColumns(row, names).map(aliasOf);
  const fields = {};
  for (const name of names) {
    if (maskOnly.has(name)) continue;
    const key = aliasOf(name);
    // An article's body is an HTML column; any other column is read as HTML only when it carries markup (cleanText's 'auto'), so a
    // title such as "List<String> is empty" keeps its words.
    const value = cleanText(disp(row[name]), fieldLimit(key), { html: kind === 'knowledge' && key === 'text' ? true : 'auto' });
    if (value) fields[key] = value;
    else if (SYS_ID_RE.test(raw(row[name])) && !unreadable.includes(key)) unreadable.push(key);
  }
  // The task names its requested item but the requester or the item came back empty: the item is there and hidden from this user (a
  // task of an item you cannot read), which is not "nobody" and not "no item" (R-14).
  const link = PARENT_LINK[kind];
  const parentId = link && names.includes(link) ? raw(row[link]) : '';
  if (SYS_ID_RE.test(parentId)) {
    for (const [dotted, alias] of Object.entries(walked)) if (names.includes(dotted) && !disp(row[dotted]) && !unreadable.includes(alias)) unreadable.push(alias);
  }

  // 2. Notes (or the messages of a chat) and the per-kind extras (they do not depend on each other).
  const recordText = readJournalNow && !isChat && !journalBlocked ? { comments: disp(row.comments), work_notes: disp(row.work_notes) } : null;
  const noJournal = { entries: [], loginNames: [], access: [] };
  // A task of an incident, a change or a case is for the person of that parent (F15): ONE small read of the parent, with the others.
  const parentPersonRead =
    kind === 'task' && names.includes(PARENT_PERSON_LINK)
      ? readParentPerson({ table, parentId: raw(row[PARENT_PERSON_LINK]), linkHidden: !Object.hasOwn(row, PARENT_PERSON_LINK) }, deps, { allowSensitive })
      : Promise.resolve(null);
  const [journalResult, relatedResult, parentPerson] = await Promise.all([
    !readJournalNow ? Promise.resolve(noJournal) : isChat ? readChatMessages({ table, sysId }, deps, { memo }) : readJournal({ table, sysId, recordText, hiddenColumns: recordText ? absentColumns(row, JOURNAL_RECORD_FIELDS) : [] }, deps, { memo }),
    readRelated(relatedPlan({ kind, feature, minimised }), { table, sysId, ...(link ? { parent: SYS_ID_RE.test(parentId) ? { table: PARENT_TABLE[kind], sysId: parentId.toLowerCase() } : null } : {}) }, deps, memo),
    parentPersonRead,
  ]);
  // The parent's person: a person of the pack (masked, with a role, so the caller card, the greeting and the briefing find them); a field of the
  // pack only for a feature whose own spec lists the column, as for a catalog task's requester; a column that could not be told is unreadable.
  if (parentPerson) {
    for (const [column, name] of Object.entries(parentPerson.fields)) if (featureListsColumn(feature, column)) fields[column] = name;
    for (const column of parentPerson.unreadable) if (!unreadable.includes(column)) unreadable.push(column);
  }

  // 3. People: from the record, the extras and the note authors, with emails where sys_user allows.
  const displayNames = isChat ? journalResult.names || [] : uniq(journalResult.entries.map((e) => e.by).filter((by) => /\s/.test(by)));
  const { people, access: peopleAccess, namesByLogin } = await resolvePeople(
    { refs: [...personRefs(row, names), ...kindPersonRefs(kind, row, names), ...relatedResult.refs, ...(parentPerson ? parentPerson.refs : [])], logins: journalResult.loginNames, names: displayNames },
    deps
  );

  let journal = applyAuthorNames(journalResult.entries, namesByLogin);
  let finalPeople = people;
  if (isChat) {
    // Who is the customer and who the agent: the record says (opened_for, assigned_to); the messages' own columns said the rest.
    const named = (role) => people.filter((p) => p.role === role).map((p) => p.name);
    journal = assignSides(journal, { customers: named('opened_for'), agents: named('assigned_to') });
    finalPeople = chatPeople(people, journal);
  }

  // The people named in rows of other tickets (linked incidents, overlapping changes...): their names are masked exactly too.
  finalPeople = [...finalPeople, ...referencePeople(relatedResult.referenceNames, finalPeople)];

  // (the walked columns that were left out are said to be: not "nobody", not "no item")
  if (parentBlocked) for (const alias of Object.values(PARENT_WALK[kind] || {})) if (!unreadable.includes(alias)) unreadable.push(alias);
  const access = [
    ...(parentBlocked ? [accessEntry(parentTable, STATUS.BLOCKED, NOTE_TEXT.blocked)] : []),
    ...policyAccess(table, { minimised, wantJournal, unresolved }),
    ...journalResult.access,
    ...relatedResult.access,
    ...(parentPerson ? parentPerson.access : []),
    ...peopleAccess,
  ];
  return {
    version: PACK_VERSION,
    table,
    sysId,
    number: fields.number || '',
    kind,
    fields,
    ...(unreadable.length ? { unreadable } : {}),
    people: finalPeople,
    journal,
    related: { ...relatedResult.related, ...kindExtras(kind, row, names, feature), ...parentExtra(row, names, fields) },
    access,
    // The class of a record opened through `task` could not be looked up: the run is gated like an HR case (src/lib/pipeline.js).
    ...(unresolved ? { sensitive: true } : {}),
    // The text of other people's tickets is in this pack: the person sees what is sent every time, not once per feature.
    ...(relatedResult.hasReference ? { requirePreview: true } : {}),
  };
}

// A task that is part of another ticket (parent): its number and the id to open it by, for "Part of CS0001234" (F15). Not text for any
// prompt: the parts name the related lists they send, and this is not one of them.
function parentExtra(row, names, fields) {
  const id = names.includes('parent') ? raw(row.parent) : '';
  return SYS_ID_RE.test(id) && fields.parent ? { parent: { sysId: id.toLowerCase(), number: fields.parent } } : {};
}

// What was left out on purpose, so the pack never looks more complete than it is.
// (fixed sentences: they name no table and no column; the pack's `fields` show what was read)
const MINIMISED_NOTE = Object.freeze({
  unresolved: tm('This ticket was opened as a general task and its real type could not be looked up, so it is treated as sensitive: free text and identities were not read.'),
  sensitive: tm('This kind of ticket holds sensitive data, so free text and identities were not read.'),
  journal: tm('Notes and comments on sensitive tickets are not read unless sensitive data is allowed.'),
});

function policyAccess(table, { minimised, wantJournal, unresolved }) {
  if (!minimised) return [];
  const out = [accessEntry(table, STATUS.SKIPPED, unresolved ? MINIMISED_NOTE.unresolved : MINIMISED_NOTE.sensitive)];
  if (wantJournal) out.push(accessEntry('journal', STATUS.SKIPPED, MINIMISED_NOTE.journal));
  return out;
}
