// readContextPack: everything one feature may know about one record, as a plain-JSON ContextPack (docs/contracts.md).
//
// Only columns on the feature's allowlist are asked for (sysparm_fields) and only those are copied out, so a column an
// instance returns anyway never reaches the pack. Reads run with the signed-in user's own session; whatever is refused or
// ambiguous is reported in `access` and the pack carries the rest.

import { FEATURES, FEATURE_JOURNAL, allowedFields, fieldLimit, withheldFields } from './allowlists.js';
import { STATUS, entry as accessEntry } from './access.js';
import { JOURNAL_RECORD_FIELDS, applyAuthorNames, readJournal } from './journal.js';
import { isSensitiveTable, kindForTable, tableForNumber } from './kinds.js';
import { personRefs, resolvePeople } from './people.js';
import { readRelated, relatedPlan } from './related.js';
import { SYS_ID_RE, TABLE_RE, cleanText, disp, raw, uniq } from './util.js';
import { parseRecordNumber } from '../lib/recordNumber.js';

export { stripHtml } from './util.js';
export { confirmEmptyIsReallyEmpty } from './access.js';

export const PACK_VERSION = 1;

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
  const minimised = isSensitiveTable(table) && !allowSensitive;
  const names = allowedFields(table, feature, { allowSensitive });
  const wantJournal = (options.includeJournal ?? FEATURE_JOURNAL[feature]) === true;
  const readJournalNow = wantJournal && !minimised;
  const memo = new Map(); // one "can this user see the table at all" read per table

  // 1. The record: allowlisted columns only, plus the two note columns when notes are wanted.
  const row = await deps.fetchRecord(table, sysId, readJournalNow ? [...names, ...JOURNAL_RECORD_FIELDS] : names, { displayValue: true });
  if (!row) throw notFound(table, 'The record');

  const fields = {};
  for (const name of names) {
    const value = cleanText(disp(row[name]), fieldLimit(name));
    if (value) fields[name] = value;
  }

  // 2. Notes and the per-kind extras (they do not depend on each other).
  const recordText = readJournalNow ? { comments: disp(row.comments), work_notes: disp(row.work_notes) } : null;
  const [journalResult, relatedResult] = await Promise.all([
    readJournalNow ? readJournal({ table, sysId, recordText }, deps, { memo }) : Promise.resolve({ entries: [], loginNames: [], access: [] }),
    readRelated(relatedPlan({ kind, feature, minimised }), { table, sysId }, deps, memo),
  ]);

  // 3. People: from the record, the extras and the note authors, with emails where sys_user allows.
  const displayNames = uniq(journalResult.entries.map((e) => e.by).filter((by) => /\s/.test(by)));
  const { people, access: peopleAccess, namesByLogin } = await resolvePeople(
    { refs: [...personRefs(row, names), ...relatedResult.refs], logins: journalResult.loginNames, names: displayNames },
    deps
  );

  const access = [...policyAccess(table, feature, { minimised, wantJournal, allowSensitive }), ...journalResult.access, ...relatedResult.access, ...peopleAccess];
  return {
    version: PACK_VERSION,
    table,
    sysId,
    number: fields.number || '',
    kind,
    fields,
    people,
    journal: applyAuthorNames(journalResult.entries, namesByLogin),
    related: relatedResult.related,
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
