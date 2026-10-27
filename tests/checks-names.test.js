import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById } from '../src/features/registry.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { readContextPack } from '../src/context/pack.js';
import { mergeParentPack } from '../src/checks/checklistParts.js';
import { withCurrentNotes } from '../src/checks/resolutionCheck.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { RITM_ID } from './fixtures/sn-requested-item.js';

// The firewall masks exactly the people the pack knows. A name written inside a title, a note or an answer is masked only
// when that person is on the pack through a person column, so each spec must READ the person columns even where its parts
// leave them off. These tests put names ONLY inside text: no note author, no approver, no journal row names them.

const NAMES = ['Charlie Whitherspoon', 'Beth Anglin', 'Dave Loftus', 'Abel Tuter'];
const EMAILS = ['charlie.w@example.com', 'beth.anglin@example.com', 'dave.loftus@example.com', 'abel.tuter@example.com'];

const values = () => effectiveSettings({ provider: 'anthropic' }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const policy = normalizePolicy({});
const sentText = (prepared) => `${prepared.request.messages.map((m) => m.content).join('\n')}\n${prepared.preview}`;
const run = (id, pack) => sentText(prepareRun({ feature: featureById(id), pack, values: values(), policy, config: config(), createFirewall }));

function noNameLeft(sent) {
  const lower = sent.toLowerCase();
  for (const word of [...NAMES, ...EMAILS]) {
    const at = lower.indexOf(word.toLowerCase());
    assert.equal(at, -1, `"${word}" was sent: ...${sent.slice(Math.max(0, at - 40), at + 40)}...`);
  }
}

// The fixture instance without any notes, so nobody is learnt as a note author.
function bareInstance() {
  const tables = buildInstance();
  tables.sys_journal_field = [];
  for (const table of ['incident', 'sc_req_item', 'sc_task', 'sc_request']) {
    for (const row of tables[table] || []) {
      if ('comments' in row) row.comments = v('', '');
      if ('work_notes' in row) row.work_notes = v('', '');
    }
  }
  return tables;
}
const read = (tables, table, sysId, feature) => readContextPack({ table, sysId }, fakeDeps(tables), { feature });

test('request-explain: names inside the title are masked, and the assignee and the opener are not sent as fields', async () => {
  const tables = bareInstance();
  tables.sc_req_item[0].short_description = v('Laptop for Charlie Whitherspoon, delivered by Beth Anglin, approved by Dave Loftus');
  const pack = await read(tables, 'sc_req_item', RITM_ID, 'request-explain');
  const known = pack.people.map((p) => p.name);
  for (const name of ['Charlie Whitherspoon', 'Beth Anglin', 'Dave Loftus']) assert.ok(known.includes(name), `${name} is on the pack`);
  const sent = run('request-explain', pack);
  noNameLeft(sent);
  assert.match(sent, /Laptop for \[PERSON_\d+\], delivered by \[PERSON_\d+\], approved by \[PERSON_\d+\]/);
  assert.ok(!/label="(Assigned to|Opened by)"/.test(sent));
});

test('request-explain: a customer comment that names people only in its text is masked too', async () => {
  const tables = bareInstance();
  tables.sc_req_item[0].comments = v('', '2026-10-26 09:00:00 - Someone Else (Additional comments)\nHi, this is for Charlie Whitherspoon, please ask Beth Anglin.');
  const pack = await read(tables, 'sc_req_item', RITM_ID, 'request-explain');
  const sent = run('request-explain', pack);
  noNameLeft(sent);
  assert.match(sent, /this is for \[PERSON_\d+\], please ask \[PERSON_\d+\]/);
});

test('fulfilment-checklist: names inside the instructions and the special instructions are masked', async () => {
  const tables = bareInstance();
  const taskId = 'a'.repeat(32);
  const task = tables.sc_task.find((r) => r.sys_id.value === 'sct2');
  Object.assign(task, {
    sys_id: v(taskId),
    request_item: v(RITM_ID, 'RITM0010050'),
    description: v('1. Ask Beth Anglin for the laptop\n2. Deliver it to Charlie Whitherspoon\n3. Get Dave Loftus to sign'),
    special_instructions: v('Charlie Whitherspoon (charlie.w@example.com) is on leave until Monday.'),
  });
  const pack = mergeParentPack(await read(tables, 'sc_task', taskId, 'fulfilment-checklist'), await read(tables, 'sc_req_item', RITM_ID, 'fulfilment-checklist'));
  const sent = run('fulfilment-checklist', pack);
  noNameLeft(sent);
  assert.match(sent, /Ask \[PERSON_\d+\] for the laptop/);
  assert.match(sent, /Deliver it to \[PERSON_\d+\]/);
  assert.match(sent, /Operating system: Windows 11/, 'the answers still go');
  assert.ok(!/label="(Assigned to|Opened by)"/.test(sent));
});

test('resolution-improve: names inside the typed notes and the saved text are masked, and the person fields are not sent', async () => {
  const tables = bareInstance();
  tables.incident[0].description = v('Abel Tuter says the VPN drops. Beth Anglin looked at it.');
  const saved = await read(tables, 'incident', INCIDENT_ID, 'resolution-improve');
  const names = saved.people.map((p) => p.name);
  assert.ok(names.includes('Abel Tuter') && names.includes('Beth Anglin'), 'caller and assignee are on the pack');
  const pack = withCurrentNotes(saved, { close_notes: 'Restarted the gateway for Abel Tuter (abel.tuter@example.com). Beth Anglin confirmed it is stable.' });
  const sent = run('resolution-improve', pack);
  noNameLeft(sent);
  assert.match(sent, /Restarted the gateway for \[PERSON_\d+\] \(\[EMAIL_\d+\]\)/);
  assert.ok(!/label="(Caller|Assigned to|Opened by)"/.test(sent), 'the person fields are not sent');
});

test('without the person columns the same name WOULD go out: the check above is not vacuous', async () => {
  const tables = bareInstance();
  tables.incident[0].description = v('Abel Tuter says the VPN drops.');
  const pack = await read(tables, 'incident', INCIDENT_ID, 'resolution-improve');
  const blind = { ...pack, people: [] };
  assert.ok(run('resolution-improve', blind).includes('Abel Tuter'), 'a firewall that knows nobody cannot mask a name in prose');
});
