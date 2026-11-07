// Shared by tests/live-*.test.js and the tests that read the words of a state or a priority: the answer of the UI meta service
// (src/content/tableApi.js readTableMeta), as measured on dev364920 on 2026-11-07 (docs/live-checks-2026-11-07.md), and a fake
// `deps.readTableMeta` made from it. The fake reduces the answer exactly as the real one does (reduceTableMeta), so a test cannot pass on
// a shape the real read would not give.

import { reduceTableMeta } from '../src/content/tableApi.js';

/** The service's answer for an incident, in the shape the real instance gives it: result.columns.<name>.{ label, choices }. */
export const INCIDENT_META = Object.freeze({
  result: {
    columns: {
      state: {
        label: 'State',
        type: 'integer',
        choices: [
          { value: '1', label: 'New' },
          { value: '2', label: 'In Progress' },
          { value: '3', label: 'On Hold' },
          { value: '6', label: 'Resolved' },
          { value: '7', label: 'Closed' },
          { value: '8', label: 'Canceled' },
        ],
      },
      priority: {
        label: 'Priority',
        type: 'integer',
        choices: [
          { value: '1', label: '1 - Critical' },
          { value: '2', label: '2 - High' },
          { value: '3', label: '3 - Moderate' },
          { value: '4', label: '4 - Low' },
          { value: '5', label: '5 - Planning' },
        ],
      },
      short_description: { label: 'Short description', type: 'string', choices: [] },
    },
  },
});

/** The same in Arabic, as an instance whose user speaks Arabic would answer. */
export const INCIDENT_META_AR = Object.freeze({
  result: {
    columns: {
      state: { label: 'الحالة', choices: [{ value: '1', label: 'جديد' }, { value: '2', label: 'قيد التقدم' }, { value: '3', label: 'معلق' }] },
      priority: { label: 'الأولوية', choices: [{ value: '1', label: '1 - حرجة' }, { value: '3', label: '3 - متوسطة' }] },
    },
  },
});

const refusal = (table) =>
  Object.assign(new Error('Not available to you with your role.'), {
    code: 'ACCESS_DENIED',
    reason: 'acl',
    status: 403,
    detail: `Labels of "${table}" failed (403): User Not Authorized - User is unauthorized to access table: ${table}`,
  });

/**
 * `deps` plus a `readTableMeta(table, columns)` that answers from `answers` (table -> the service's JSON), like the real read.
 * Records what was asked in `metaCalls`. `denied`: tables that answer 403; `failWith`: an error thrown for every table.
 */
export function withMeta(deps, answers = {}, { denied = [], failWith = null } = {}) {
  const metaCalls = [];
  const readTableMeta = async (table, columns = []) => {
    metaCalls.push({ table, columns: [...columns] });
    if (failWith) throw failWith;
    if (denied.includes(table)) throw refusal(table);
    if (!Object.hasOwn(answers, table)) throw Object.assign(new Error('This does not exist on this ServiceNow site.'), { reason: 'missing', status: 404 });
    return reduceTableMeta(answers[table], columns);
  };
  return Object.assign(deps, { readTableMeta, metaCalls });
}
