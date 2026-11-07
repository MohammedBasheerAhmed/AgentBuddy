// A scriptable Team world for the tests of Needs attention (tests/lead-*.test.js): one ticket table (incident), a group, SLAs, states, a
// few lists. Every number is chosen by the test, so the sections can be compared with each other. Not a test file itself.
import { fakeInstance, cell, group, count, USER, GROUP_A, NOW, DAY } from './reports-fixtures.js';
import { snLiteral } from '../src/reports/engine/time.js';

export { USER, GROUP_A, NOW, DAY, cell, group, count };
export const id = (n) => String(n).padStart(32, '0');

/** One task_sla row for the ticket with sys_id `task`. */
export const slaRow = (task, percentage, breached, end = '2026-10-27 15:00:00') => ({ task: cell(task), sla: cell('s', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(percentage)), planned_end_time: cell(end) });

/** One incident row as the Table API returns it with display values. */
export function ticket(n, { number = `INC${String(n).padStart(7, '0')}`, title = `Ticket ${n}`, priority = '2', owner = 'Ann Lee', ownerId = 'u-ann', state = ['2', 'In Progress'], openedAt = '2026-10-27 06:00:00', reassignments = '1', table = 'incident' } = {}) {
  return {
    sys_id: cell(id(n)),
    number: cell(number),
    short_description: cell(title),
    priority: cell(priority, `${priority} - High`),
    state: cell(state[0], state[1]),
    assigned_to: owner ? cell(ownerId, owner) : cell('', ''),
    assignment_group: cell(GROUP_A, 'Service Desk'),
    opened_at: cell(openedAt),
    sys_updated_on: cell('2026-10-27 10:00:00'),
    sys_class_name: cell(table),
    opened_by: cell('u-x', 'Req Uester'),
    caller_id: cell('u-y', 'Cal Ler'),
    reassignment_count: cell(reassignments),
  };
}

const rowsOf = (list, call) => list.slice(call.options.offset || 0, (call.options.offset || 0) + (call.options.limit || 1000));
const idsIn = (query) => (/sys_idIN([0-9a-f,]+)/.exec(query)?.[1] || '').split(',').filter(Boolean);

/**
 * @param {object} o
 * @param {object[]} [o.slaRows]       the worrying task_sla rows (the radar reads them 500 at a time, up to 1000)
 * @param {number} [o.slaTotal]        active SLAs (the plain count)
 * @param {Record<number, object>} [o.tickets]  ticket rows by number n (their sys_id is id(n)); looked up by the radar
 * @param {object[]} [o.states]        the state breakdown of the open tickets (group('state', value, label, n))
 * @param {number} [o.open]            the open count (active tickets)
 * @param {number} [o.oldCount]        tickets open 15+ days (the last ageing bucket)
 * @param {number} [o.reassignedCount] tickets handed over often
 * @param {object[]} [o.reassignedRows] the five handed over most
 * @param {object[]} [o.waitingRows]   the oldest waiting tickets (whatever the state list asks for)
 * @param {object[]} [o.oldestRows]    the oldest open tickets
 * @param {object[]} [o.rules]         tried first
 * @param {string[]} [o.denied] @param {string[]} [o.hidden] @param {string[]} [o.missingColumns]
 */
export function leadWorld({
  slaRows = [],
  slaTotal = 40,
  tickets = {},
  states = [group('state', '2', 'In Progress', 6)],
  open = 6,
  oldCount = 0,
  reassignedCount = 0,
  reassignedRows = [],
  waitingRows = [],
  oldestRows = [],
  rules = [],
  ...base
} = {}) {
  const fifteen = snLiteral(NOW - 15 * DAY);
  return fakeInstance({
    ...base,
    rules: [
      ...rules,
      { when: (c) => c.table === 'sys_user_grmember', then: [{ group: cell(GROUP_A, 'Service Desk') }] },
      { when: (c) => c.kind === 'aggregate' && c.table === 'task_sla', then: count(slaTotal) },
      { when: (c) => c.kind === 'query' && c.table === 'task_sla', then: (c) => rowsOf(slaRows, c) },
      { when: (c) => c.kind === 'query' && c.table === 'task' && c.query.includes('sys_idIN'), then: (c) => idsIn(c.query).map((x) => tickets[Number(x)]).filter(Boolean) },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.join() === 'state', then: states },
      { when: (c) => c.kind === 'aggregate' && c.groupBy.length, then: [] },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('reassignment_count>='), then: count(reassignedCount) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes(`opened_at>${fifteen}`), then: count(Math.max(0, open - oldCount)) },
      // (the counts within 2, 4 and 8 days can be no more than within 15, so they are all the tickets that are not 15+ days old)
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>') && !c.query.includes('opened_at>='), then: count(Math.max(0, open - oldCount)) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('sys_updated_on<'), then: count(0) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('opened_at>='), then: count(0) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('assigned_toISEMPTY'), then: count(0) },
      { when: (c) => c.kind === 'aggregate' && c.query.includes('active=true'), then: count(open) },
      { when: (c) => c.kind === 'aggregate', then: count(0) },
      { when: (c) => c.kind === 'query' && c.table === 'incident' && c.query.includes('reassignment_count>='), then: reassignedRows },
      { when: (c) => c.kind === 'query' && c.table === 'incident' && c.query.includes('stateIN'), then: waitingRows },
      { when: (c) => c.kind === 'query' && c.table === 'incident' && c.query.includes('ORDERBYopened_at'), then: oldestRows },
    ],
  });
}
