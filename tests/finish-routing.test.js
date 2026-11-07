import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ITSM from '../src/content/ops/itsm.js';
import INSIGHTS from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { findSimilarTickets } from '../src/context/index.js';
import { createPolicyGuard, walkTables } from '../src/content/policyGuard.js';
import { routingVote, withoutInactiveGroups } from '../src/insights/routing.js';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// Audit of 2026-11-07, W-15: "Suggest where it should go" and the Routing card took the winning assignment group from solved look-alikes
// without asking whether the group is still in use; a retired group came back as the winning vote. The look-alike read now walks
// assignment_group.active in the SAME read (no new request); an inactive group is left out of the vote, the hint and the AI's pack; a flag that
// did not come back (a hidden field arrives as a missing key) is unknown, and unknown is not inactive.

const THIS = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a001';
const G = { net: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e001', old: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e002', desk: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e003' };

// A solved look-alike. `active`: 'true' | 'false' | undefined (the key is missing from the answer, as a field the user may not read is)
function ticket(n, group, active, over = {}) {
  const row = {
    sys_id: v(`b${String(n).padStart(2, '0')}`.padEnd(32, '0')),
    number: v(`INC00200${n}`),
    short_description: v('VPN keeps disconnecting every hour'),
    state: v('7', 'Closed'),
    close_notes: v('Reinstalled the client and cleared the cache.'),
    close_code: v('workaround', 'Solved (Work Around)'),
    category: v('network', 'Network'),
    subcategory: v('', ''),
    priority: v('3', '3 - Moderate'),
    resolved_at: v('2026-10-20 10:00:00'),
    sys_updated_on: v('2026-10-20 10:00:00'),
    assignment_group: v(G[group], { net: 'Network Support', old: 'Old VPN Team', desk: 'Service Desk' }[group]),
    ...over,
  };
  if (active !== undefined) row['assignment_group.active'] = v(active, active);
  return row;
}

const pack = () => ({ table: 'incident', sysId: THIS, number: 'INC0020000', fields: { short_description: 'VPN keeps disconnecting for everyone on the team', category: 'Network' }, people: [] });
const tablesOf = (...rows) => ({ incident: rows, sys_user: [] });

// ---- the read ----------------------------------------------------------------------------------------------------------------------

test('W-15: the look-alike read walks assignment_group.active in the same read, and each hit says whether its group is still in use', async () => {
  const deps = fakeDeps(tablesOf(ticket(1, 'net', 'true'), ticket(2, 'old', 'false'), ticket(3, 'desk', undefined)));
  const found = await findSimilarTickets(pack(), deps, { resolvedOnly: true, limit: 8, routing: true });
  assert.equal(deps.calls.length, 1, 'no new request');
  assert.ok(deps.calls[0].fields.includes('assignment_group.active'), 'the column is asked for with the others');
  const flag = (number) => found.hits.find((h) => h.number === number).assignment_group_active;
  assert.equal(flag('INC002001'), 'true');
  assert.equal(flag('INC002002'), 'false');
  assert.equal(flag('INC002003'), '', 'a key that did not come back is not told: unknown is not inactive');
  // without the routing read the column is not asked for at all (a look-alike search for a summary needs no group)
  const plain = fakeDeps(tablesOf(ticket(1, 'net', 'true'), ticket(2, 'old', 'false')));
  await findSimilarTickets(pack(), plain, { resolvedOnly: true, limit: 8 });
  assert.ok(!plain.calls[0].fields.includes('assignment_group.active'));
  assert.ok(!plain.calls[0].fields.includes('assignment_group'));
});

test('W-15: the Insights look-alikes read (lookalikes) carries the flag', async () => {
  const deps = fakeDeps(tablesOf(ticket(1, 'net', 'true'), ticket(2, 'old', 'false')));
  const out = await INSIGHTS.lookalikes({ pack: pack() }, { deps, checkPack, checkRecord });
  assert.deepEqual(out.hits.map((h) => h.assignment_group_active).sort(), ['false', 'true']);
});

test('W-15: the routing-hint read (routingLookalikes) asks for the flag in its one follow-up read, and keeps the answer in the hit', async () => {
  const deps = fakeDeps(tablesOf(ticket(1, 'net', 'true'), ticket(2, 'old', 'false'), ticket(3, 'desk', undefined)));
  const out = await ITSM.routingLookalikes({ pack: pack() }, { deps, checkPack, checkRecord });
  const calls = deps.calls.filter((c) => c.table === 'incident');
  assert.equal(calls.length, 2, 'the search, then ONE follow-up by sys_id, as before');
  assert.deepEqual(calls[1].fields, ['sys_id', 'assignment_group', 'assignment_group.active', 'priority', 'subcategory']);
  const flag = (number) => out.hits.find((h) => h.number === number).assignment_group_active;
  assert.equal(flag('INC002001'), 'true');
  assert.equal(flag('INC002002'), 'false');
  assert.equal(flag('INC002003'), '');
  // a refused follow-up gives no flag and no group, as it gave no group before
  const base = fakeDeps(tablesOf(ticket(1, 'net', 'true'), ticket(2, 'net', 'true')));
  let n = 0;
  const refused = { ...base, queryTable: async (...args) => { n += 1; if (n === 2) { const e = new Error('no'); e.code = 'ACCESS_DENIED'; throw e; } return base.queryTable(...args); } };
  const denied = await ITSM.routingLookalikes({ pack: pack() }, { deps: refused, checkPack, checkRecord });
  assert.ok(denied.hits.every((h) => h.assignment_group === '' && h.assignment_group_active === ''));
});

// ---- the vote ----------------------------------------------------------------------------------------------------------------------

const hit = (n, group, active) => ({ number: `INC00${n}`, assignment_group: group, assignment_group_active: active, category: 'Network' });

test('W-15: a retired group does not win the vote; the groups still in use are counted', () => {
  const hits = [hit(1, 'Old VPN Team', 'false'), hit(2, 'Old VPN Team', 'false'), hit(3, 'Old VPN Team', 'false'), hit(4, 'Network Support', 'true'), hit(5, 'Network Support', 'true')];
  const vote = routingVote(hits, { group: '', category: 'Network' });
  assert.equal(vote.enough, true);
  assert.equal(vote.group.name, 'Network Support');
  assert.equal(vote.total, 2, 'only the look-alikes whose group is still in use are counted');
  assert.equal(vote.line, '2 of 2 solved look-alikes went to Network Support, category Network');
  assert.ok(!vote.groups.some((g) => g.name === 'Old VPN Team'));
  // the same hits without the flag: as it always was
  const unknown = routingVote(hits.map(({ assignment_group_active: _a, ...rest }) => rest));
  assert.equal(unknown.group.name, 'Old VPN Team');
  assert.equal(unknown.total, 5);
});

test('W-15: when every group is retired there is no vote; a flag that was not told keeps the group in', () => {
  const retired = routingVote([hit(1, 'Old VPN Team', 'false'), hit(2, 'Old VPN Team', 'false'), hit(3, 'Other Old Team', 'false')]);
  assert.equal(retired.enough, false);
  assert.equal(retired.total, 0);
  assert.equal(retired.inactive, 3, 'and it says how many were left out');
  assert.equal(retired.line, '');
  assert.equal(routingVote([hit(1, 'Network Support', 'true'), hit(2, 'Network Support', 'true')]).inactive, 0);
  // one retired and one that was not told: the one that was not told is one look-alike, not enough
  assert.equal(routingVote([hit(1, 'Old VPN Team', 'false'), hit(2, 'Network Support', '')]).enough, false);
  // unknown ('' or a missing key) is kept, with active ones
  const mixed = routingVote([hit(1, 'Network Support', ''), hit(2, 'Network Support', 'true'), { number: 'INC9', assignment_group: 'Network Support' }]);
  assert.equal(mixed.enough, true);
  assert.equal(mixed.total, 3);
  assert.equal(mixed.strong, true);
  // the current group is compared with the winner as before
  assert.equal(routingVote([hit(1, 'Old VPN Team', 'false'), hit(2, 'Network Support', 'true'), hit(3, 'Network Support', 'true')], { group: 'Network Support' }).matchesGroup, true);
});

test('W-15: withoutInactiveGroups takes the name off a retired group\'s hit and leaves everything else (the hit stays: its category is evidence)', () => {
  const hits = [hit(1, 'Old VPN Team', 'false'), hit(2, 'Network Support', 'true'), hit(3, 'Service Desk', ''), null, 'x'];
  const out = withoutInactiveGroups(hits);
  assert.equal(out[0].assignment_group, '');
  assert.equal(out[0].category, 'Network');
  assert.equal(out[1].assignment_group, 'Network Support');
  assert.equal(out[2].assignment_group, 'Service Desk');
  assert.equal(out[3], null);
  assert.equal(out[4], 'x');
  assert.deepEqual(withoutInactiveGroups(null), []);
  assert.equal(hits[0].assignment_group, 'Old VPN Team', 'the answer is not changed in place');
});

// ---- the hint the AI gets ----------------------------------------------------------------------------------------------------------

test('W-15: "Suggest where it should go" is never shown a retired group as a place to send the ticket', async () => {
  const feature = featureById('routing-hint');
  const answer = {
    keywords: ['vpn'],
    access: [{ source: 'incident', status: 'ok', note: '' }],
    hits: [
      { ...hit(1, 'Old VPN Team', 'false'), number: 'INC0020001', short_description: 'VPN drops', priority: '3 - Moderate', sysId: 'b'.repeat(32) },
      { ...hit(2, 'Network Support', 'true'), number: 'INC0020002', short_description: 'VPN drops', priority: '3 - Moderate', sysId: 'c'.repeat(32) },
      { ...hit(3, 'Service Desk', ''), number: 'INC0020003', short_description: 'VPN drops', priority: '2 - High', sysId: 'd'.repeat(32) },
    ],
  };
  const asked = [];
  const base = { version: 1, table: 'incident', sysId: THIS, number: 'INC0020000', kind: 'incident', fields: { number: 'INC0020000', short_description: 'VPN keeps disconnecting', category: 'Network' }, people: [], journal: [], related: {}, access: [] };
  const enriched = await feature.enrich(base, { read: async (op) => (asked.push(op), answer), allowSensitive: false });
  assert.deepEqual(asked, ['routingLookalikes']);
  const groups = enriched.reference.similar.hits.map((h) => h.assignment_group);
  assert.deepEqual(groups, ['', 'Network Support', 'Service Desk'], 'a retired group lost its name; one not told stays');
  const text = feature.parts(enriched).map((p) => p.text).join('\n');
  assert.ok(!/Old VPN Team/.test(text), 'not in the parts the AI is sent');
  assert.match(text, /Network Support/);
  assert.match(text, /Service Desk/);
  assert.deepEqual(answer.hits[0].assignment_group, 'Old VPN Team', 'the read\'s answer is not changed');
  // a reader that cannot be asked, or an answer of another shape, goes through as before
  const none = await feature.enrich(base, { allowSensitive: false });
  assert.equal(none.reference.similar.status, 'error');
  const odd = await feature.enrich(base, { read: async () => ({ hits: 'nope', access: [] }) });
  assert.deepEqual(odd.reference.similar.hits, []);
});

// ---- the card --------------------------------------------------------------------------------------------------------------------------

let tab = 2100;
async function drawRouting(hits) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (tabId) => ({ id: tabId, index: 0, windowId: 1 });
  const record = { table: 'incident', sysId: THIS, number: 'INC0020000', kind: 'incident' };
  fake.onRead('glance', () => ({ pack: { version: 1, table: 'incident', sysId: THIS, number: 'INC0020000', kind: 'incident', fields: { number: 'INC0020000', short_description: 'VPN keeps disconnecting', assignment_group: 'Service Desk' }, people: [], journal: [], related: {}, access: [] }, slas: { items: [], access: [] }, vip: { status: 'no', access: [] }, outage: { hits: [], windowHours: 24, access: [] } }));
  fake.onRead('lookalikes', () => ({ hits, keywords: ['vpn'], access: [{ source: 'incident', status: 'ok' }] }));
  const seen = [];
  const C = INSIGHT_CARDS.find((c) => c.id === 'routing').Card;
  const page = { status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/incident.do?sys_id=${THIS}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
  const ui = await mount(<C page={page} eff={{ ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) }} record={record} header={{ number: 'INC0020000' }} active setSummary={(s) => seen.push(s)} setAttention={() => {}} />);
  await settle(8);
  return { ui, seen };
}

const withSys = (hits) => hits.map((h, i) => ({ ...h, sysId: String.fromCharCode(98 + i).repeat(32), table: 'incident' }));

test('W-15: the Routing card counts the groups still in use', async () => {
  const { ui, seen } = await drawRouting(withSys([hit(1, 'Old VPN Team', 'false'), hit(2, 'Old VPN Team', 'false'), hit(3, 'Old VPN Team', 'false'), hit(4, 'Network Support', 'true'), hit(5, 'Network Support', 'true')]));
  try {
    assert.equal(seen.at(-1), '2 of 2 solved look-alikes went to Network Support, category Network');
    assert.ok(!ui.text().includes('Old VPN Team'));
  } finally {
    await ui.unmount();
  }
});

test('W-15: when every group the look-alikes went to is retired the card says so in one line, not that they "do not say" which group', async () => {
  const { ui, seen } = await drawRouting(withSys([hit(1, 'Old VPN Team', 'false'), hit(2, 'Old VPN Team', 'false'), hit(3, 'Other Old Team', 'false')]));
  try {
    assert.equal(seen.at(-1), 'Too few solved look-alikes to tell');
    assert.match(ui.text(), /Groups that are no longer in use were left out, and too few look-alikes are left to tell./);
    assert.ok(!/do not say which group/.test(ui.text()));
    assert.ok(!ui.text().includes('Old VPN Team'));
  } finally {
    await ui.unmount();
  }
  // look-alikes that name no group at all: the card says what it always said
  const none = await drawRouting(withSys([hit(1, '', ''), hit(2, '', '')]));
  try {
    assert.match(none.ui.text(), /The solved look-alikes found do not say which group solved them./);
  } finally {
    await none.ui.unmount();
  }
});

// ---- the policy guard ------------------------------------------------------------------------------------------------------------------

test('W-15: the walk through the group is checked against the organisation\'s blocked tables (DOT_WALK_TABLES)', async () => {
  assert.deepEqual(walkTables('assignment_group.active'), ['sys_user_group'], 'the step "assignment_group" leads to sys_user_group');
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['sys_user_group'] } }) });
  const fake = fakeDeps(tablesOf(ticket(1, 'net', 'true')));
  const deps = await guard.deps(fake);
  await assert.rejects(() => deps.queryTable('incident', 'short_descriptionLIKEvpn', ['sys_id', 'assignment_group', 'assignment_group.active'], {}), (e) => e.code === 'BLOCKED_TABLE' && e.table === 'sys_user_group');
  assert.equal(fake.calls.length, 0, 'nothing reached the instance');
  // with something else blocked the walk goes through, as the other known walks do
  const other = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['sn_hr_core_case'] } }) });
  const fake2 = fakeDeps(tablesOf(ticket(1, 'net', 'true')));
  const deps2 = await other.deps(fake2);
  assert.ok(Array.isArray(await deps2.queryTable('incident', 'short_descriptionLIKEvpn', ['sys_id', 'assignment_group', 'assignment_group.active'], {})));
});
