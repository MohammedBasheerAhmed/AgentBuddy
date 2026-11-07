import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import INSIGHTS, { LINKED_SHOWN, readLinkedIncidentCount } from '../src/content/ops/insights.js';
import { checkRecord } from '../src/content/ops/validate.js';
import { linkedLine } from '../src/insights/linkedIncidents.js';
import { Glance } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_FINISH } from '../src/i18n/ar/finish.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { IDS, domainTables } from './domain-fixtures.js';

// Audit of 2026-11-07, F14: a problem's linked incidents were read for the AI only. One line in the problem's glance, "N linked incidents that
// you can see": the rows the person's own session returned (not the instance's own total, which counts rows an access rule hides), "at least"
// when the page was full, and nothing at all when the read failed (never "0").

const P = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f001';
const linked = (n, problem = P) => Array.from({ length: n }, (_, i) => ({ sys_id: v(`${String(i + 1).padStart(2, '0')}`.padEnd(32, '0')), number: v(`INC${i}`), problem_id: v(problem, 'PRB1') }));

// ---- the read ----------------------------------------------------------------------------------------------------------------------------

test('F14: the count is of the rows read: ONE limited read of two columns of the incident table, for the problem\'s own id', async () => {
  const deps = fakeDeps({ incident: [...linked(3), ...linked(2, 'e'.repeat(32))] });
  const out = await readLinkedIncidentCount({ sysId: P }, deps);
  assert.deepEqual(out, { count: 3, atLeast: false });
  assert.equal(deps.calls.length, 1);
  const [call] = deps.calls;
  assert.equal(call.table, 'incident');
  assert.equal(call.query, `problem_id=${P}`);
  assert.deepEqual(call.fields, ['sys_id', 'problem_id'], 'the link and the row\'s id; nothing of the incidents\' text');
  assert.equal(call.options.limit, LINKED_SHOWN + 1);
  assert.ok(FIELDS_BY_KIND.incident.includes('problem_id'), 'the column is on the incident ceiling (specs/checks.js), with its reason');
});

test('F14: a full page is "at least"; the count never says more than it read', async () => {
  const many = await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: linked(80) }));
  assert.deepEqual(many, { count: LINKED_SHOWN, atLeast: true });
  assert.deepEqual(await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: linked(LINKED_SHOWN) })), { count: LINKED_SHOWN, atLeast: false }, 'exactly a page is not "at least"');
});

test('F14: none is a fact only when the user can see incidents at all; a read that fails says nothing', async () => {
  assert.deepEqual(await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: [{ sys_id: v('9'.repeat(32)), problem_id: v('') }] })), { count: 0, atLeast: false });
  // zero rows and no incident visible at all: an ACL may hide them, which is not "none"
  assert.equal(await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: [] }, { hidden: ['incident'] })), null);
  assert.equal(await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: linked(2) }, { denied: ['incident'] })), null);
  assert.equal(await readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: linked(2) }, { errors: { incident: new Error('boom') } })), null);
  const blocked = fakeDeps({ incident: linked(2) });
  assert.equal(await readLinkedIncidentCount({ sysId: P }, { ...blocked, queryTable: async () => { const e = new Error('Your organisation does not allow Agent Buddy to read this.'); e.code = 'BLOCKED_TABLE'; throw e; } }), null, 'the organisation blocks incidents');
  // the instance ignored the condition and sent other problems\' incidents: none of them is a count
  const base = fakeDeps({ incident: linked(2, 'e'.repeat(32)) });
  assert.equal(await readLinkedIncidentCount({ sysId: P }, { ...base, queryTable: (t, q, f, o) => base.queryTable(t, '', f, o) }), null);
  // a lost sign-in is not a read problem: it stops the read, as everywhere
  await assert.rejects(() => readLinkedIncidentCount({ sysId: P }, fakeDeps({ incident: linked(2) }, { expired: ['incident'] })), (e) => e.code === 'SESSION_EXPIRED');
});

test('F14: the glance read of a problem carries the count; no other kind reads it', async () => {
  const deps = fakeDeps(domainTables({ incidents: { linked: 25 } }));
  const out = await INSIGHTS.glance({ table: 'problem', sysId: IDS.problem }, { deps, checkRecord, allowSensitive: false });
  assert.deepEqual(out.linked, { count: 25, atLeast: false });
  assert.ok(out.pack && out.slas && out.vip && out.outage, 'the rest of the answer is as it was');
  const counts = deps.calls.filter((c) => c.table === 'incident' && c.query === `problem_id=${IDS.problem}`);
  assert.equal(counts.length, 1);
  // a failed count leaves the key out, and the rest of the glance is unharmed
  const blocked = fakeDeps(domainTables());
  const guarded = { ...blocked, queryTable: async (table, ...rest) => { if (table === 'incident') { const e = new Error('no'); e.code = 'ACCESS_DENIED'; throw e; } return blocked.queryTable(table, ...rest); } };
  const without = await INSIGHTS.glance({ table: 'problem', sysId: IDS.problem }, { deps: guarded, checkRecord, allowSensitive: false });
  assert.equal('linked' in without, false);
  assert.ok(without.pack);
  // an incident or a case: nothing is read for it
  const other = fakeDeps(domainTables());
  const inc = await INSIGHTS.glance({ table: 'sn_customerservice_case', sysId: IDS.case }, { deps: other, checkRecord, allowSensitive: false });
  assert.equal('linked' in inc, false);
  assert.equal(other.calls.filter((c) => c.query === `problem_id=${IDS.case}`).length, 0);
});

// ---- the line ----------------------------------------------------------------------------------------------------------------------------

test('F14: the line says "that you can see", "at least" for a full page, and nothing when the count is not known', () => {
  assert.equal(linkedLine({ count: 1, atLeast: false }), '1 linked incident that you can see');
  assert.equal(linkedLine({ count: 3, atLeast: false }), '3 linked incidents that you can see');
  assert.equal(linkedLine({ count: 0, atLeast: false }), 'No linked incidents that you can see');
  assert.equal(linkedLine({ count: 50, atLeast: true }), 'At least 50 linked incidents that you can see');
  for (const nothing of [null, undefined, {}, { count: 'x' }, { count: -1 }, { count: 1.5 }, 'x', 7]) assert.equal(linkedLine(nothing), '', JSON.stringify(nothing));
  assert.equal(linkedLine({ count: 3 }, 'incident'), '', 'only a problem has the line');
  assert.equal(linkedLine({ count: 3 }, 'case'), '');
});

test('F14: the plural forms of the line in Arabic, and the sentence with no linked incident', () => {
  const was = getLanguage();
  registerCatalogue('ar', AR_FINISH);
  try {
    setLanguage('ar');
    const said = [0, 1, 2, 3, 11, 100].map((n) => linkedLine({ count: n, atLeast: false }));
    for (const text of said) assert.ok(/[؀-ۿ]/.test(text) && !/linked incident/.test(text), text);
    assert.equal(new Set(said.slice(1)).size, 5, 'one, two, few, many and other read differently');
    assert.ok(linkedLine({ count: 50, atLeast: true }).startsWith('ما لا يقل عن'));
  } finally {
    setLanguage(was);
  }
});

// ---- on screen -----------------------------------------------------------------------------------------------------------------------------

let tab = 2300;
async function glanceOf(kind, table, answer) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  const pack = { version: 1, table, sysId: P, number: 'PRB0001001', kind, fields: { number: 'PRB0001001', short_description: 'Gateway pool drops connections', state: 'Assess', priority: '2 - High', assigned_to: 'Beth Anglin' }, people: [], journal: [], related: {}, access: [] };
  fake.onRead('glance', () => ({ pack, slas: { items: [], access: [] }, vip: { status: 'no', access: [] }, outage: { hits: [], windowHours: 24, access: [] }, ...answer }));
  const record = { table, sysId: P, number: 'PRB0001001', kind };
  const page = { status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/${table}.do?sys_id=${P}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
  const eff = { ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) };
  const ui = await mount(<Glance page={page} eff={eff} record={record} header={{ number: 'PRB0001001', short_description: 'Gateway pool drops connections', state: 'Assess', priority: '2 - High' }} headPhase="ready" />);
  await settle(6);
  return ui;
}

test('F14: the problem\'s glance shows the line under the chips, once; a failed count shows no line; a case never has it', async () => {
  const withCount = await glanceOf('problem', 'problem', { linked: { count: 25, atLeast: false } });
  try {
    const lines = withCount.$$('[data-line="linked"]');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].textContent, '25 linked incidents that you can see');
  } finally {
    await withCount.unmount();
  }
  const capped = await glanceOf('problem', 'problem', { linked: { count: 50, atLeast: true } });
  try {
    assert.equal(capped.$('[data-line="linked"]').textContent, 'At least 50 linked incidents that you can see');
  } finally {
    await capped.unmount();
  }
  const failed = await glanceOf('problem', 'problem', {});
  try {
    assert.equal(failed.$('[data-line="linked"]'), null, 'no line, and no "0"');
    assert.ok(!/linked incident/i.test(failed.text()));
  } finally {
    await failed.unmount();
  }
  const aCase = await glanceOf('case', 'sn_customerservice_case', { linked: { count: 5, atLeast: false } });
  try {
    assert.equal(aCase.$('[data-line="linked"]'), null);
  } finally {
    await aCase.unmount();
  }
});
