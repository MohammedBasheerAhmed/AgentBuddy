// docs/states.md is the table the owner reviews: it must say what the code does, row for row (audit of 2026-11-07, F9).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATE_TABLES, classifyState, stageFor, bucketFor, reportClassFor } from '../src/domain/states.js';
import { workState } from '../src/mywork/states.js';

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'states.md'), 'utf8');

// The tables with the same rows and the same confidence share their lines (the task states are the same on six tables).
function groups() {
  const by = new Map();
  for (const [table, { sure, rows }] of Object.entries(STATE_TABLES)) {
    const key = JSON.stringify([rows, sure]);
    if (!by.has(key)) by.set(key, { tables: [], sure, rows });
    by.get(key).tables.push(table);
  }
  return [...by.values()];
}

/** The start of the line a row has in the doc: everything but the free-text "why" at its end. */
function docLine(group, [value, label, meaning]) {
  const args = { table: group.tables[0], value };
  const cells = [group.tables.join(', '), value, label, meaning, stageFor(args) || 'unknown', bucketFor(args), workState({ table: args.table, state: '', stateValue: value }), reportClassFor(args), group.sure ? 'yes' : 'no'];
  return `| ${cells.join(' | ')} |`;
}

test('every row of the code is a line of docs/states.md, with the meaning each screen gives it', () => {
  let n = 0;
  for (const g of groups()) {
    for (const row of g.rows) {
      n += 1;
      assert.equal(classifyState({ table: g.tables[0], value: row[0] }), row[2], `${g.tables[0]} ${row[0]}`);
      assert.ok(DOC.includes(docLine(g, row)), `docs/states.md has no line "${docLine(g, row)}"`);
    }
  }
  assert.ok(n >= 50);
});

test('docs/states.md says how a state is read, who calls it, how to add a state and what is assumed', () => {
  for (const heading of ['## How a state is understood', '## The seven meanings', '## The table', '## Where this changes what a person saw', '## Who a wait is for', "## Add a customer's own state", '## Who calls it', '## What is still assumed']) {
    assert.ok(DOC.includes(heading), heading);
  }
  for (const meaning of ['new', 'working', 'waiting', 'resolved', 'closed', 'cancelled', 'unknown']) assert.ok(new RegExp(`\\| ${meaning} \\|`).test(DOC), meaning);
  assert.ok(DOC.includes('docs/live-questions/audit-1107-states.md'));
});

test('the live questions file exists and asks one question for each assumption', () => {
  const file = path.join(__dirname, '..', 'docs', 'live-questions', 'audit-1107-states.md');
  const text = fs.readFileSync(file, 'utf8');
  const questions = [...text.matchAll(/^\d+\. \*\*/gm)];
  assert.ok(questions.length >= 12, `${questions.length} questions`);
  // how to list the real choice values
  assert.match(text, /sys_choice/);
  assert.match(text, /ui\/meta/);
});
