// Which record the page shows, for the content script (src/content/index.js: PAGE_STATE, the bar, Insert, and the reads that check the
// page is the record they were asked about). Kept apart from index.js so it is tested without a page (tests/content-record-resolver).
//
//   1) A classic form knows exactly which record it shows (the page bridge's getFormMeta).
//   2) Workspaces, Next Experience and portals: the address, read afresh on every request.
//
// Two small reads can be needed, both through the policy guard: the sys_id of a number (an address that carries only a number) and
// the real class of a record opened through the base class `task`. A number is the same record whatever page it is on, and a sys_id
// is always of the same class, so these answers are the only things remembered between requests (bounded: a portal tab open all week
// does not grow them without end). A lookup that found nothing is not asked again for 30 seconds: the panel asks every few seconds,
// the bar every two.
import { kindForTable, parseRecordRef } from '../context/kinds.js';
import { resolveRealClass } from '../context/pack.js';
import { SYS_ID_RE, TABLE_RE, raw } from '../context/util.js';

const MISS_MS = 30000;
const MAX_REMEMBERED = 200;

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

  /**
   * { table, sysId, number, kind } of the record the page shows, or null.
   * `known`: the form's description when the caller has already asked the page for it (pageState asks once for everything).
   * `policy`: the panel's, sent with PAGE_STATE and READ; the bar and Insert send none (the managed policy applies on its own).
   */
  async function resolveRecord(href, known, policy) {
    // 1) The classic form knows exactly which record it shows.
    const meta = known === undefined ? await formMeta() : known;
    if (meta?.table && SYS_ID_RE.test(meta.sysId || '') && !meta.isNewRecord && TABLE_RE.test(meta.table)) {
      const table = await realClassOf(meta.table, meta.sysId, policy);
      return { table, sysId: meta.sysId, number: meta.number || '', kind: kindForTable(table) };
    }
    // 2) Workspaces, Next Experience and portals: the address (read afresh on every request).
    const ref = parseRecordRef(href);
    if (!ref || !TABLE_RE.test(ref.table || '')) return null;
    let { sysId } = ref;
    const { number } = ref;
    if (!sysId && number) sysId = await sysIdOfNumber(ref.table, number, policy);
    if (!SYS_ID_RE.test(sysId || '')) return null;
    const table = await realClassOf(ref.table, sysId, policy);
    return { table, sysId, number: number || '', kind: kindForTable(table) };
  }

  /** Forget everything looked up (the content script retires). */
  function clear() {
    numberCache.clear();
    numberMisses.clear();
    realClasses.clear();
    classMisses.clear();
  }

  return { resolveRecord, clear };
}
