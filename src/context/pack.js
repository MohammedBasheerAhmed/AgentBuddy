// readContextPack: everything one feature may know about one record, as a plain-JSON ContextPack (docs/contracts.md).
//
// Only columns on the feature's allowlist are asked for (sysparm_fields) and only those are copied out, so a column an
// instance returns anyway never reaches the pack. Reads run with the signed-in user's own session; whatever is refused or
// ambiguous is reported in `access` and the pack carries the rest.

import { FEATURES, FEATURE_JOURNAL, allowedFields, fieldLimit, withheldFields } from './allowlists.js';
import { STATUS, entry as accessEntry } from './access.js';
import { assignSides, readChatMessages } from './chat.js';
import { JOURNAL_RECORD_FIELDS, applyAuthorNames, readJournal } from './journal.js';
import { articleHtmlStats, statsToStrings } from './knowledge.js';
import { isSensitiveTable, kindForTable, tableForNumber } from './kinds.js';
import { personRefs, resolvePeople } from './people.js';
import { readRelated, relatedPlan } from './related.js';
import { SYS_ID_RE, TABLE_RE, cleanText, disp, oneLine, raw, uniq } from './util.js';
import { parseRecordNumber } from '../lib/recordNumber.js';

export { stripHtml } from './util.js';
export { confirmEmptyIsReallyEmpty } from './access.js';

export const PACK_VERSION = 1;

// Two kinds are not tickets. A knowledge article has no notes, but its structure and its stored dates matter (the pack's text
// is plain, and its dates are shown in the reader's format); a chat has messages instead of a journal.
const TIME_COLUMNS = new Set(['valid_to', 'published', 'sys_updated_on', 'opened_at', 'closed_at']);

// Per-kind plain data for pack.related, all strings (docs/contracts.md):
//   knowledge: { article: counts from the HTML (headings, lists, full text length...), times: stored dates (UTC) }
//   chat:      { times: stored dates (UTC) }
function kindExtras(kind, row, names) {
  if (kind !== 'knowledge' && kind !== 'chat') return {};
  const extras = {};
  if (kind === 'knowledge' && names.includes('text')) extras.article = statsToStrings(articleHtmlStats(disp(row.text)));
  const times = {};
  for (const name of names) {
    const stored = TIME_COLUMNS.has(name) ? raw(row[name]) : '';
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

function notFound(table, what) {
  const err = new Error(`${what} was not found in ${table}, or your user cannot see it.`);
  err.code = 'NOT_FOUND';
  return err;
}

/**
 * { table, sysId } for a reference given as { table, sysId } or { table?, number }. A number is looked up with one
 * small read (task and its children share the number space, so an unknown table is searched as `task`).
 */
export async function resolveRecordRef(ref, deps) {
  const table = String(ref?.table || '').trim().toLowerCase();
  if (SYS_ID_RE.test(ref?.sysId || '')) {
    if (!TABLE_RE.test(table)) throw new TypeError('A record reference needs a table name.');
    return { table, sysId: ref.sysId.toLowerCase() };
  }
  const number = parseRecordNumber(ref?.number);
  if (!number) throw new TypeError('A record reference needs a sys_id or a record number.');
  const searchTable = TABLE_RE.test(table) ? table : tableForNumber(number) || 'task';
  const rows = await deps.queryTable(searchTable, `number=${number}`, ['sys_id', 'sys_class_name'], { limit: 1, displayValue: false });
  const found = rows[0];
  if (!found || !SYS_ID_RE.test(raw(found.sys_id))) throw notFound(searchTable, number);
  const actual = raw(found.sys_class_name);
  return { table: searchTable === 'task' && TABLE_RE.test(actual) ? actual : searchTable, sysId: raw(found.sys_id).toLowerCase() };
}

/**
 * Read a ContextPack.
 * @param {{ table: string, sysId?: string, number?: string }} ref
 * @param {{ queryTable: Function, fetchRecord: Function }} deps same signatures as src/content/tableApi.js
 * @param {{ feature?: string, includeJournal?: boolean, allowSensitive?: boolean }} [options]
 *   feature: one of FEATURES (default 'record-summary'); includeJournal: overrides the feature's default;
 *   allowSensitive: read free text and identities of HR-family tables too.
 * @throws an Error with code 'NOT_FOUND' (no such record or not visible), 'ACCESS_DENIED' or 'SESSION_EXPIRED' from the
 *   record read itself; every other read fails soft into `access`.
 */
export async function readContextPack(ref, deps, options = {}) {
  const { feature = 'record-summary', allowSensitive = false } = options;
  if (!FEATURES.includes(feature)) throw new Error(`Unknown feature "${feature}". Known: ${FEATURES.join(', ')}.`);

  const { table, sysId } = await resolveRecordRef(ref, deps);
  const kind = kindForTable(table);
  const isChat = kind === 'chat';
  const minimised = isSensitiveTable(table) && !allowSensitive;
  const names = allowedFields(table, feature, { allowSensitive });
  const wantJournal = (options.includeJournal ?? FEATURE_JOURNAL[feature]) === true;
  const readJournalNow = wantJournal && !minimised;
  const memo = new Map(); // one "can this user see the table at all" read per table

  // 1. The record: allowlisted columns only, plus the two note columns when notes are wanted (a chat's messages are elsewhere).
  const row = await deps.fetchRecord(table, sysId, readJournalNow && !isChat ? [...names, ...JOURNAL_RECORD_FIELDS] : names, { displayValue: true });
  if (!row) throw notFound(table, 'The record');

  const fields = {};
  for (const name of names) {
    const value = cleanText(disp(row[name]), fieldLimit(name));
    if (value) fields[name] = value;
  }

  // 2. Notes (or the messages of a chat) and the per-kind extras (they do not depend on each other).
  const recordText = readJournalNow && !isChat ? { comments: disp(row.comments), work_notes: disp(row.work_notes) } : null;
  const noJournal = { entries: [], loginNames: [], access: [] };
  const [journalResult, relatedResult] = await Promise.all([
    !readJournalNow ? Promise.resolve(noJournal) : isChat ? readChatMessages({ table, sysId }, deps, { memo }) : readJournal({ table, sysId, recordText }, deps, { memo }),
    readRelated(relatedPlan({ kind, feature, minimised }), { table, sysId }, deps, memo),
  ]);

  // 3. People: from the record, the extras and the note authors, with emails where sys_user allows.
  const displayNames = isChat ? journalResult.names || [] : uniq(journalResult.entries.map((e) => e.by).filter((by) => /\s/.test(by)));
  const { people, access: peopleAccess, namesByLogin } = await resolvePeople(
    { refs: [...personRefs(row, names), ...kindPersonRefs(kind, row, names), ...relatedResult.refs], logins: journalResult.loginNames, names: displayNames },
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

  const access = [...policyAccess(table, feature, { minimised, wantJournal, allowSensitive }), ...journalResult.access, ...relatedResult.access, ...peopleAccess];
  return {
    version: PACK_VERSION,
    table,
    sysId,
    number: fields.number || '',
    kind,
    fields,
    people: finalPeople,
    journal,
    related: { ...relatedResult.related, ...kindExtras(kind, row, names) },
    access,
  };
}

// What was left out on purpose, so the pack never looks more complete than it is.
function policyAccess(table, feature, { minimised, wantJournal, allowSensitive }) {
  if (!minimised) return [];
  const withheld = withheldFields(table, feature, { allowSensitive });
  const out = [accessEntry(table, STATUS.SKIPPED, `${table} holds sensitive data, so free text and identities were not read${withheld.length ? ` (${withheld.join(', ')})` : ''}.`)];
  if (wantJournal) out.push(accessEntry('journal', STATUS.SKIPPED, 'Notes and comments on sensitive records are not read unless sensitive data is allowed.'));
  return out;
}
