const test = require('node:test');
const assert = require('node:assert/strict');
import { worstSla, riskOf } from '../src/reports/myDay.js';

const cell = (value, display) => ({ value, display_value: display ?? value });
const sla = (task, pct, breached) => ({ task: cell(task), sla: cell('x', 'Resolution'), stage: cell('in_progress', 'In progress'), has_breached: cell(breached ? 'true' : 'false'), percentage: cell(String(pct)), planned_end_time: cell('2026-10-27 09:00:00') });

test('worstSla and riskOf', () => {
  assert.equal(worstSla([]), null);
  assert.equal(riskOf(null), 'none');
  const w = worstSla([sla('t', 40, false), sla('t', 90, false), sla('t', 10, true)]);
  assert.equal(w.breached, true);
  assert.equal(riskOf({ breached: false, percentage: 75 }), 'at-risk');
  assert.equal(riskOf({ breached: false, percentage: 74 }), 'ok');
});
