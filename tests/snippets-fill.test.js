// Snippets filled from the open record: every built-in variable must be fillable from the pack the Snippets panel reads, and
// the person the record is for is found whatever their role (a consumer on a customer service case too).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readContextPack } from '../src/context/pack.js';
import { FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, allowedFields } from '../src/context/allowlists.js';
import { BUILTIN_VARIABLES, buildVariables } from '../src/snippets/render.js';
import { SNIPPET_FEATURE, previewSnippet } from '../src/snippets/preview.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';

const AGENT = { name: 'Beth Anglin', first_name: 'Beth' };
const RECORD_VARIABLES = BUILTIN_VARIABLES.map((v) => v.name).filter((name) => !name.startsWith('agent.') && name !== 'today');

test('the snippets have their own context spec: the columns the variables need, the people, the SLAs, and no notes', () => {
  assert.equal(SNIPPET_FEATURE, 'snippet-fill');
  const incident = allowedFields('incident', SNIPPET_FEATURE);
  for (const column of ['number', 'short_description', 'state', 'priority', 'caller_id', 'assigned_to']) assert.ok(incident.includes(column), column);
  // Nothing a snippet cannot show: no description, no close notes, no notes and comments.
  for (const column of ['description', 'close_notes', 'work_notes', 'comments']) assert.ok(!incident.includes(column), column);
  assert.equal(FEATURE_JOURNAL[SNIPPET_FEATURE], false);
  assert.deepEqual(FEATURE_RELATED[SNIPPET_FEATURE], ['slas']);
  for (const kind of Object.keys(FIELDS_BY_KIND)) for (const c of FEATURE_FIELDS[SNIPPET_FEATURE][kind]) assert.ok(FIELDS_BY_KIND[kind].includes(c), `${kind}.${c}`);
});

test('every record variable of a snippet is filled from the pack the snippet spec reads ({{priority}} was always "missing")', async () => {
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: SNIPPET_FEATURE });
  const body = RECORD_VARIABLES.map((name) => `${name}={{${name}}}`).join('\n');
  const { text, missing } = previewSnippet(body, { pack, agent: AGENT, now: NOW });
  assert.deepEqual(missing, [], text);
  assert.match(text, /priority=2 - High/);
  assert.match(text, /caller\.first_name=Abel/);
  assert.match(text, /sla\.due=\d{4}-\d{2}-\d{2}/);
  assert.equal(pack.journal.length, 0, 'no notes are read for a snippet');
});

test('the reply-draft pack the panel used to read cannot fill {{priority}} (why the panel must read the snippet spec)', async () => {
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: 'reply-draft' });
  assert.deepEqual(previewSnippet('{{priority}}', { pack, agent: AGENT, now: NOW }).missing, ['priority']);
});

test('a consumer (business-to-consumer case) is the caller of a snippet', () => {
  const vars = buildVariables({ fields: {}, people: [{ role: 'assigned_to', name: 'Beth Anglin' }, { role: 'consumer', name: 'Maria Lopez' }] }, AGENT, NOW);
  assert.equal(vars.caller?.first_name, 'Maria');
  assert.equal(vars.caller?.name, 'Maria Lopez');
  // The person the ticket is about still comes first when there is one.
  const both = buildVariables({ fields: {}, people: [{ role: 'consumer', name: 'Maria Lopez' }, { role: 'caller', name: 'Abel Tuter' }] }, AGENT, NOW);
  assert.equal(both.caller.name, 'Abel Tuter');
});
