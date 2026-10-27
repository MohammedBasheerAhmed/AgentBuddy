// Argument checks shared by every READ operation. Arguments come from an extension page but are still validated:
// a table name is a plain identifier, a sys_id is 32 hex characters.
import { SYS_ID_RE, TABLE_RE } from '../../context/util.js';

export function checkRecord({ table, sysId } = {}) {
  if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) throw new Error('That is not a valid record.');
}

// A pack passed back by the panel is only used for its table, id and the few fields a search reads.
export function checkPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('A ticket is needed for this search.');
  checkRecord(pack);
  return pack;
}

/** A plain identifier (a column or table name). */
export const isIdentifier = (value) => TABLE_RE.test(String(value || ''));
