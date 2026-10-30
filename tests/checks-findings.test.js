// Wrong results found while walking the record checks, each pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolutionCheck } from '../src/checks/resolutionCheck.js';
import { makeChecksOps } from '../src/content/ops/checks.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const customerLine = (pack) => resolutionCheck(pack, {}, { now: NOW }).find((c) => c.id === 'customer');
const incident = (people, journal) => ({
  kind: 'incident',
  fields: { number: 'INC0010001', state: 'In Progress' },
  people,
  journal,
  related: { childTasks: [] },
  access: [{ source: 'journal', status: 'ok', note: '' }],
});
const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', firstName: 'Abel', lastName: 'Tuter' };
const asked = { when: '2026-10-25 09:00:00', by: 'Beth Anglin', type: 'comment', text: 'Can you try again please?' };

// When sys_user cannot be read, note authors stay as LOGINS (src/context/journal.js): "abel.tuter", not "Abel Tuter".
test('Check tab: the customer\'s reply written under their login is the customer\'s, not an agent\'s', () => {
  const reply = { when: '2026-10-26 08:00:00', by: 'abel.tuter', type: 'comment', text: 'It works now, thanks.' };
  const c = customerLine(incident([ABEL], [asked, reply]));
  assert.equal(c.status, 'ok', c.title);
  assert.match(c.title, /customer wrote the last message/);
  // The login is the front of the email address even when it is not first.last.
  const odd = customerLine(incident([{ ...ABEL, email: 'atuter@example.com' }], [asked, { ...reply, by: 'atuter' }]));
  assert.equal(odd.status, 'ok', odd.title);
});

test('Check tab: a login that matches nobody is not taken for an agent ("could not tell"), never "the customer has not replied"', () => {
  const unknown = { when: '2026-10-26 08:00:00', by: 'x123456', type: 'comment', text: 'Any news?' };
  const c = customerLine(incident([ABEL], [asked, unknown]));
  assert.equal(c.status, 'info', c.title);
  assert.match(c.title, /Could not tell who wrote the last message/);
  // A display name that is not the customer's is the service desk, as before.
  const agent = customerLine(incident([ABEL], [{ ...asked, when: '2026-10-26 08:00:00' }]));
  assert.equal(agent.status, 'warn');
  assert.match(agent.title, /not replied to your last message/);
});

test('Check tab: names compare without case, accents or order ("Tuter, Abel")', () => {
  const reply = { when: '2026-10-26 08:00:00', by: 'Tuter, Abel', type: 'comment', text: 'Fixed, thank you.' };
  assert.equal(customerLine(incident([ABEL], [asked, reply])).status, 'ok');
  const accented = customerLine(incident([{ ...ABEL, name: 'José Núñez', email: '' }], [asked, { ...reply, by: 'Jose Nunez' }]));
  assert.equal(accented.status, 'ok', accented.title);
});

// ---- Linked article: kb_use may point at the ticket through `task` (docs/live-questions/knowledge.md, question 21) -----------

test('Check tab: an article linked through kb_use.task counts as linked', async () => {
  const INC = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const deps = fakeDeps({ incident: [{ sys_id: v(INC) }], m2m_kb_task: [{ sys_id: v('m1'), task: v('e'.repeat(32)) }], kb_use: [{ sys_id: v('u1'), task: v(INC), article: v('k1') }] });
  const ops = makeChecksOps({ callPage: async () => null });
  const out = await ops.resolutionFacts({ table: 'incident', sysId: INC }, { deps, checkRecord, checkPack });
  assert.equal(out.links.knowledge.status, 'yes');
  for (const c of deps.calls) assert.ok(c.fields.length <= 3, `${c.table}: ${c.fields.join(',')}`);
});
