// Which record the page shows, for the content script (src/content/index.js: PAGE_STATE, the bar, Insert, and the reads that check the
// page is the record they were asked about). Kept apart from index.js so it is tested without a page (tests/content-record-resolver).
//
//   1) A classic form knows exactly which record it shows (the page bridge's getFormMeta).
//   2) Workspaces, Next Experience and portals: the address, read afresh on every request.
//
// Either way the page must be a TICKET page (audit of 2026-11-07, part 2): a form or an address that names a table is not a record to
// work on unless the table is a ticket-like one (src/context/kinds.js isTicketTable: the kinds the product knows, the families of
// the organisation's policy) or the live form proves it (g_form answers with a number). A UI page, a script, a user, the home page
// are "no record": nothing is read for them, the panel shows the plain "Open a ticket" help and the bar stays away.
//
// Two small reads can be needed, both through the policy guard: the sys_id of a number (an address that carries only a number) and
// the real class of a record opened through the base class `task`. A number is the same record whatever page it is on, and a sys_id
// is always of the same class, so these answers are the only things remembered between requests (bounded: a portal tab open all week
// does not grow them without end). A lookup that found nothing is not asked again for 30 seconds: the panel asks every few seconds,
// the bar every two.
import { isTicketTable, kindForTable, parseNewRecordRef, parseRecordRef } from '../context/kinds.js';
import { resolveRealClass } from '../context/pack.js';
import { SYS_ID_RE, TABLE_RE, raw } from '../context/util.js';

const MISS_MS = 30000;
const MAX_REMEMBERED = 200;
const MAX_NUMBER_CHARS = 40;

// What the form said is the number of its record: text, trimmed, short. Anything else is no number (the page world is untrusted).
const cleanNumber = (value) => (typeof value === 'string' ? value.trim().slice(0, MAX_NUMBER_CHARS) : '');

/**
 * @param {{
 *   guardedDeps: (policy?: object) => Promise<{ queryTable: Function }>,  the reads, wrapped by the policy guard (the panel's policy
 *                                                                         merged in when it sent one)
 *   formMeta: () => Promise<any>,                                         the page bridge's getFormMeta (untrusted)
 *   now?: () => number,
 * }} deps
 */
export function makeRecordResolver({ guardedDeps, formMeta, now = () => Date.now() }) {
  const numberCache = new Map(); // `${table}:${number}` -> sys_id
  const numberMisses = new Map(); // `${table}:${number}` -> when it found nothing
  const realClasses = new Map(); // sys_id -> class
  const classMisses = new Map(); // sys_id -> when its class could not be looked up

  const remember = (map, key, value) => {
    if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value);
    map.set(key, value);
  };
  const missedLately = (map, key) => map.has(key) && now() - map.get(key) < MISS_MS;

  // A record opened through the base class (/task.do?sys_id=..., a Workspace /record/task/<id>) is really an incident, a case, an HR
  // case...: its real class is looked up once (one small read through the policy guard), so the panel's header, the bar's actions and
  // the record's kind are those of the real type. A class that cannot be looked up stays 'task' (the pack read then treats the record
  // as sensitive), and is not asked again for 30 seconds. `policy`: the panel's, when it sent one (the guard merges it).
  async function realClassOf(table, sysId, policy) {
    if (table !== 'task') return table;
    if (realClasses.has(sysId)) return realClasses.get(sysId);
    if (missedLately(classMisses, sysId)) return table;
    const guarded = await guardedDeps(policy);
    const found = await resolveRealClass({ table, sysId }, guarded).catch(() => ({ table, unresolved: true }));
    if (found.unresolved || !TABLE_RE.test(found.table)) {
      remember(classMisses, sysId, now());
      return table;
    }
    remember(realClasses, sysId, found.table);
    return found.table;
  }

  // Is a page of this table a ticket page? A table the product knows, or a family of the organisation's policy (asked only for a table
  // this build does not know), or a form that proved it with a number. `number`: what the live form said, '' when there is no form.
  async function ticketLike(table, number, policy) {
    if (cleanNumber(number) || isTicketTable(table)) return true;
    const guarded = await guardedDeps(policy).catch(() => null);
    return isTicketTable(table, { extraPrefixes: guarded?.sensitivePrefixes });
  }

  // The sys_id of a number, or ''. The row must carry the number asked for: ServiceNow ignores a condition on a column the table does
  // not have and answers with its first row, which is some other record.
  async function sysIdOfNumber(table, number, policy) {
    const key = `${table}:${number}`;
    if (!numberCache.has(key) && !missedLately(numberMisses, key)) {
      // (through the policy guard: a blocked table is not looked up)
      const guarded = await guardedDeps(policy);
      const rows = await guarded.queryTable(table, `number=${number}`, ['sys_id', 'number'], { limit: 1 }).catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      const sysId = row ? raw(row.sys_id) : '';
      if (row && raw(row.number).trim().toUpperCase() === number.toUpperCase() && SYS_ID_RE.test(sysId)) remember(numberCache, key, sysId);
      else remember(numberMisses, key, now());
    }
    return numberCache.get(key) || '';
  }

  // The record for a table and a sys_id, with the real class of a record opened through `task`. The table that ends up in the record
  // must pass the gate too: a record opened through `task` whose real class is a table nobody listed (and whose form said no number)
  // is not one the panel works on either, the same as when that table is named in an address.
  async function recordFor(asked, sysId, number, policy) {
    const table = await realClassOf(asked, sysId, policy);
    if (table !== asked && !(await ticketLike(table, number, policy))) return null;
    return { table, sysId, number, kind: kindForTable(table) };
  }

  /**
   * { table, sysId, number, kind } of the record the page shows, or null.
   * `known`: the form's description when the caller has already asked the page for it (pageState asks once for everything).
   * `policy`: the panel's, sent with PAGE_STATE and READ; the bar and Insert send none (the managed policy applies on its own).
   */
  async function resolveRecord(href, known, policy) {
    // 1) The classic form knows exactly which record it shows. A form of a table that is not a ticket's and has no number (a widget
    //    or a UI page that carries a g_form of its own) is not a record; the address may still name one, so it is looked at next.
    const meta = known === undefined ? await formMeta() : known;
    // The classic shell's frame has moved on to a list while the address still names the form before it: no ticket is open (audit of
    // 2026-11-07, S8; the page bridge says so only when the frame itself is a list without a form).
    if (meta?.frameIsList === true) return null;
    if (meta?.table && SYS_ID_RE.test(meta.sysId || '') && !meta.isNewRecord && TABLE_RE.test(meta.table)) {
      const formNumber = cleanNumber(meta.number);
      if (await ticketLike(meta.table, formNumber, policy)) return recordFor(meta.table, meta.sysId, formNumber, policy);
    }
    // 2) Workspaces, Next Experience and portals: the address (read afresh on every request). Only a ticket's table counts, so a
    //    number in the address of /ui_page.do or /home.do is not looked up in a table named after the page.
    const ref = parseRecordRef(href, { anyTable: true });
    if (!ref || !TABLE_RE.test(ref.table || '') || !(await ticketLike(ref.table, '', policy))) return null;
    let { sysId } = ref;
    const { number } = ref;
    if (!sysId && number) sysId = await sysIdOfNumber(ref.table, number, policy);
    if (!SYS_ID_RE.test(sysId || '')) return null;
    return recordFor(ref.table, sysId, number || '', policy);
  }

  /**
   * { table, kind } of the BLANK form the page shows (a new incident, a new article), or null. The form says so itself through
   * g_form (classic, and Next Experience where the bridge reaches its frame); otherwise the address does (sys_id=-1). Only a ticket's
   * table counts, as for a saved record: "For a new ui page form" is no help to anybody.
   * `known` and `policy` as for resolveRecord.
   */
  async function resolveNewRecord(href, known, policy) {
    const meta = known === undefined ? await formMeta() : known;
    if (meta?.frameIsList === true) return null;
    if (meta?.isNewRecord && TABLE_RE.test(meta.table || '') && (await ticketLike(meta.table, meta.number, policy))) return { table: meta.table, kind: kindForTable(meta.table) };
    if (meta?.table && meta.isNewRecord === false) return null; // the form on the page is a saved record
    const fromAddress = parseNewRecordRef(href, { anyTable: true });
    if (!fromAddress || !(await ticketLike(fromAddress.table, '', policy))) return null;
    return { table: fromAddress.table, kind: kindForTable(fromAddress.table) };
  }

  /** Forget everything looked up (the content script retires). */
  function clear() {
    numberCache.clear();
    numberMisses.clear();
    realClasses.clear();
    classMisses.clear();
  }

  return { resolveRecord, resolveNewRecord, clear };
}
