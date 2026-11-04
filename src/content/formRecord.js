// Is the classic form the page bridge describes (getFormMeta, getFieldStates: g_form's table and sys_id) the record a read is about?
//
// g_form names the table the form was OPENED through. A record opened as /task.do?sys_id=... says 'task', while the content script and
// the panel know it by its real class (an incident, a case...: src/content/recordResolver.js looks it up). Compared as they are, the
// two never match, and the resolution facts, the form values and the Insert targets all said "another record". So a form of `task`
// with the right sys_id counts when the content script's own reading of the page, currentRecord() (that same form, its class looked
// up the same way, and remembered), is the record. A form of any other table must be the record's own table.

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * @param {*} form what the page said, { table, sysId } (untrusted)
 * @param {{ table: string, sysId: string }} record the record asked about (validated by the caller: a plain table name, a sys_id)
 * @param {() => Promise<{table: string, sysId: string}|null>} [currentRecord] the record the content script finds on the page now
 * @returns {Promise<boolean>}
 */
export async function formShowsRecord(form, { table, sysId }, currentRecord) {
  if (!form || typeof form !== 'object' || Array.isArray(form) || !sameId(form.sysId, sysId)) return false;
  const formTable = typeof form.table === 'string' ? form.table.toLowerCase() : '';
  if (formTable === table) return true;
  if (formTable !== 'task' || typeof currentRecord !== 'function') return false;
  let open;
  try {
    open = await currentRecord();
  } catch {
    open = null;
  }
  return Boolean(open) && typeof open === 'object' && open.table === table && sameId(open.sysId, sysId);
}
