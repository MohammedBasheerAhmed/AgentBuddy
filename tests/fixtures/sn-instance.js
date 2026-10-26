// One fake instance with all the fixture records. `buildInstance()` returns fresh rows every time so a test may change them.

import { caseTables } from './sn-case.js';
import { hrCaseTables } from './sn-hr-case.js';
import { incidentTables } from './sn-incident.js';
import { requestedItemTables } from './sn-requested-item.js';
import { userRows } from './sn-users.js';

export function buildInstance() {
  const parts = [incidentTables(), requestedItemTables(), caseTables(), hrCaseTables()];
  const tables = { sys_user: userRows() };
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) tables[table] = [...(tables[table] || []), ...rows];
  }
  // sys_user is also readable as the customer-contact class; the lookups use sys_user so nothing more is needed.
  return tables;
}
