import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy } from '../src/policy/policy.js';
import { Glance, INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';

// The cards say "none", "nobody" and "all clear" only when the read for it completed (audit of 2026-11-07, part 3, R-09 and its
// neighbours). Each card is drawn in the small DOM with the answer its read would give when a table is denied, hidden or failed; the
// line, the body and the status ("clear" is the green) must agree. tests/honest-reads.test.js has the rules on their own.

const record = { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' };
let tab = 900;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/incident.do?sys_id=${INCIDENT_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin', userId: 'b'.repeat(32) } });
const eff = () => ({ ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) });
const header = { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High' };
const card = (id) => INSIGHT_CARDS.find((c) => c.id === id).Card;
const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel@example.com', sysId: 'a'.repeat(32) };
const OK = [{ source: 'task_sla', status: 'empty' }];

const packOf = (over = {}) => ({
  version: 1,
  table: 'incident',
  sysId: INCIDENT_ID,
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', description: 'It drops every ten minutes and the error 809 comes up for everyone on the team.', state: 'In Progress', category: 'Network', cmdb_ci: 'VPN Gateway EU', assigned_to: 'Beth Anglin', assignment_group: 'Network Support' },
  people: [ABEL],
  journal: [],
  related: {},
  access: [],
  ...over,
});
const glanceOf = (pack, extra = {}) => ({ pack, slas: { items: [], access: OK }, vip: { status: 'no', access: [] }, outage: { hits: [], windowHours: 24, access: [{ source: 'incident', status: 'empty' }] }, ...extra });

/** Draws a card with spies for its one-line summary and its status; `reads` answers the panel's reads. */
async function draw(id, reads) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.chrome.tabs.get = async (tabId) => ({ id: tabId, index: 0, windowId: 1 });
  for (const [op, answer] of Object.entries(reads)) fake.onRead(op, typeof answer === 'function' ? answer : () => answer);
  const seen = { summary: [], attention: [] };
  const C = card(id);
  const ui = await mount(<C page={pageFor()} eff={eff()} record={record} header={header} active setSummary={(s) => seen.summary.push(s)} setAttention={(s) => seen.attention.push(s)} />);
  await settle(8);
  return { ui, fake, summary: () => seen.summary.at(-1), attention: () => seen.attention.at(-1), text: () => ui.text() };
}

// ---- the Caller card (R-09) -------------------------------------------------------------------------------------------------------

test('Caller: every table checked and nothing earlier: said so, and green', async () => {
  const c = await draw('caller', { glance: glanceOf(packOf()), history: { items: [], signals: { openCount: 0 }, access: [{ source: 'incident', status: 'empty' }, { source: 'sc_req_item', status: 'empty' }] } });
  try {
    assert.equal(c.summary(), 'No earlier tickets from this caller');
    assert.match(c.text(), /No earlier tickets from this person\./);
    assert.equal(c.attention(), 'clear');
  } finally {
    await c.ui.unmount();
  }
});

test('Caller: a table that was denied, hidden or failed: the line, the body and the status all say it could not be checked', async () => {
  for (const status of ['denied', 'empty-or-hidden', 'error']) {
    const c = await draw('caller', { glance: glanceOf(packOf()), history: { items: [], signals: { openCount: 0 }, access: [{ source: 'incident', status: 'empty' }, { source: 'sc_req_item', status }] } });
    try {
      assert.equal(c.summary(), 'Could not check all earlier tickets', status);
      assert.ok(!/No earlier tickets from this person\./.test(c.text()), `${status}: the body does not say none`);
      assert.match(c.text(), /No earlier tickets found, but some could not be checked\./);
      assert.notEqual(c.attention(), 'clear', status);
      assert.ok(!/sc_req_item|403/.test(c.text()), 'no table name, no code');
      assert.equal(c.ui.$('.ab-ins-caller-head .ab-chip'), null, 'no "0" count when nothing could be counted');
    } finally {
      await c.ui.unmount();
    }
  }
});

test('Caller: tickets found and one table not checked: the tickets stand and the line says it may not be all', async () => {
  const item = { sysId: '1'.repeat(32), table: 'incident', number: 'INC0000009', short_description: 'Earlier VPN problem', state: 'Closed', opened_at: '2026-10-01 10:00:00' };
  const c = await draw('caller', { glance: glanceOf(packOf()), history: { items: [item], signals: { openCount: 0 }, access: [{ source: 'incident', status: 'ok' }, { source: 'sc_req_item', status: 'denied' }] } });
  try {
    assert.equal(c.summary(), '1 earlier ticket · some could not be checked');
    assert.match(c.text(), /INC0000009/);
    assert.equal(c.attention(), '');
  } finally {
    await c.ui.unmount();
  }
});

test('Caller: a caller column that did not come back is not "nobody is named"', async () => {
  const blind = packOf({ people: [], unreadable: ['caller_id'] });
  const c = await draw('caller', { glance: glanceOf(blind) });
  try {
    assert.equal(c.summary(), 'Could not read who the caller is');
    assert.match(c.text(), /The caller could not be read, so earlier tickets were not looked up\./);
    assert.ok(!/Nobody is named/.test(c.text()));
    assert.notEqual(c.attention(), 'clear');
    assert.equal(c.fake.readsOf('history').length, 0, 'nobody was looked up');
  } finally {
    await c.ui.unmount();
  }
  const nobody = await draw('caller', { glance: glanceOf(packOf({ people: [] })) });
  try {
    assert.equal(nobody.summary(), 'Nobody is named as the caller');
    assert.match(nobody.text(), /Nobody is named as the caller on this ticket\./);
    assert.equal(nobody.attention(), 'clear', 'a caller column that came back empty is a fact');
  } finally {
    await nobody.ui.unmount();
  }
});

// ---- Related, outage, changes, problems, knowledge, steps ------------------------------------------------------------------------------

test('Related tickets: a search that was denied is not "0 solved" and not green', async () => {
  const denied = await draw('related', { glance: glanceOf(packOf()), lookalikes: { hits: [], keywords: ['vpn'], access: [{ source: 'incident', status: 'denied', note: 'Not available to you with your role.' }] } });
  try {
    assert.equal(denied.summary(), 'Could not check solved tickets');
    assert.notEqual(denied.attention(), 'clear');
    await click(denied.ui.button(/Solved look-alikes/));
    assert.match(denied.text(), /No similar solved tickets found, but some could not be checked\./);
  } finally {
    await denied.ui.unmount();
  }
  const calm = await draw('related', { glance: glanceOf(packOf()), lookalikes: { hits: [], keywords: ['vpn'], truncated: true, access: [{ source: 'incident', status: 'empty' }] } });
  try {
    assert.equal(calm.summary(), '0 solved');
    assert.equal(calm.attention(), 'clear');
    await click(calm.ui.button(/Solved look-alikes/));
    assert.match(calm.text(), /No similar solved ticket found among the newest matches\./, 'a full page: only the newest were read');
  } finally {
    await calm.ui.unmount();
  }
  const plain = await draw('related', { glance: glanceOf(packOf()), lookalikes: { hits: [], keywords: ['vpn'], access: [{ source: 'incident', status: 'empty' }] } });
  try {
    await click(plain.ui.button(/Solved look-alikes/));
    assert.match(plain.text(), /No similar solved tickets found\./);
  } finally {
    await plain.ui.unmount();
  }
  // The check of the item failing keeps it from going green too.
  const noOutage = await draw('related', { glance: glanceOf(packOf(), { outage: { hits: [], windowHours: 24, access: [{ source: 'incident', status: 'error' }] } }), lookalikes: { hits: [], keywords: ['vpn'], access: [{ source: 'incident', status: 'empty' }] } });
  try {
    assert.notEqual(noOutage.attention(), 'clear');
  } finally {
    await noOutage.ui.unmount();
  }
});

test('Outage: green only when the check ran to the end', async () => {
  const run = async (access, extra = {}) => {
    const c = await draw('outage', { glance: glanceOf(packOf(), { outage: { hits: [], windowHours: 24, access, ...extra } }) });
    try {
      return { summary: c.summary(), attention: c.attention(), text: c.text() };
    } finally {
      await c.ui.unmount();
    }
  };
  const ok = await run([{ source: 'incident', status: 'empty' }]);
  assert.equal(ok.attention, 'clear');
  assert.match(ok.summary, /^No other open tickets found on VPN Gateway EU/);
  for (const status of ['denied', 'empty-or-hidden', 'error']) {
    const bad = await run([{ source: 'incident', status }]);
    assert.notEqual(bad.attention, 'clear', status);
    assert.equal(bad.summary, 'Could not check other open tickets on this item');
    assert.ok(!/counts as a possible outage/.test(bad.text), 'the rule of thumb is not offered as if it had been applied');
  }
  const hidden = await run([{ source: 'denied-field', status: 'denied', reason: 'hidden-field', note: 'Part of this ticket is hidden from you, so this could not be looked up.' }]);
  assert.notEqual(hidden.attention, 'clear');
  assert.match(hidden.text, /part of this ticket is hidden from you/);
});

test('Changes and Known errors: "no CI or service" only when the ticket has none; a column that did not come back is not that', async () => {
  const run = async (id, answer) => {
    const c = await draw(id, { glance: glanceOf(packOf()), ciChanges: answer, knownErrors: answer });
    try {
      return { summary: c.summary(), attention: c.attention(), text: c.text() };
    } finally {
      await c.ui.unmount();
    }
  };
  for (const [id, source] of [['changes', 'change_request'], ['knownErrors', 'problem']]) {
    const none = await run(id, { items: [], keys: [], noTarget: true, access: [{ source, status: 'skipped', note: 'This ticket has no configuration item or service, so changes on it were not looked up.' }] });
    assert.equal(none.summary, 'No CI or service on this ticket', id);
    assert.equal(none.attention, 'clear');
    const hidden = await run(id, { items: [], keys: [], access: [{ source, status: 'denied', reason: 'hidden-field', note: 'Part of this ticket is hidden from you, so this could not be looked up.' }] });
    assert.equal(hidden.summary, id === 'changes' ? 'Could not check changes' : 'Could not check problems');
    assert.notEqual(hidden.attention, 'clear');
    assert.match(hidden.text, /part of this ticket is hidden from you/);
    const sensitive = await run(id, { items: [], keys: [], access: [{ source, status: 'skipped', note: 'This ticket holds sensitive data, so this is not looked up unless sensitive data is allowed.' }] });
    assert.notEqual(sensitive.summary, 'No CI or service on this ticket', 'a sensitive ticket is not a ticket without an item');
    assert.notEqual(sensitive.attention, 'clear');
    const calm = await run(id, { items: [], keys: ['cmdb_ci'], access: [{ source, status: 'empty' }] });
    assert.equal(calm.attention, 'clear');
  }
});

test('Knowledge: a search that could not see is not "no matching articles"; the link button asks the agent to check the customer can open it', async () => {
  const none = await draw('knowledge', { glance: glanceOf(packOf()), knowledge: { hits: [], keywords: ['vpn'], access: [{ source: 'kb_knowledge', status: 'denied' }] } });
  try {
    assert.equal(none.summary(), 'Could not check articles');
    assert.notEqual(none.attention(), 'clear');
    assert.match(none.text(), /No published article found, but some could not be checked\./);
  } finally {
    await none.ui.unmount();
  }
  const cut = await draw('knowledge', { glance: glanceOf(packOf()), knowledge: { hits: [], keywords: ['vpn'], truncated: true, access: [{ source: 'kb_knowledge', status: 'empty' }] } });
  try {
    assert.equal(cut.summary(), 'No matching articles');
    assert.equal(cut.attention(), 'clear');
    assert.match(cut.text(), /No published article found among the newest matches/);
  } finally {
    await cut.ui.unmount();
  }
  const hit = { sysId: '5'.repeat(32), number: 'KB0000001', short_description: 'Fix the VPN client', excerpt: 'Restart it.', knowledgeBase: 'IT', viewCount: 4 };
  const some = await draw('knowledge', { glance: glanceOf(packOf()), knowledge: { hits: [hit], keywords: ['vpn'], access: [{ source: 'kb_knowledge', status: 'ok' }] } });
  try {
    const button = some.ui.button('Copy link');
    assert.equal(button.getAttribute('title'), "Copy the article's address. Check that the customer can open it.");
    assert.ok(!/share it with the customer/.test(some.ui.html?.() || some.text()));
  } finally {
    await some.ui.unmount();
  }
});

test('Find the fix: nothing found is "none" only when both searches saw everything', async () => {
  const look = (status) => ({ hits: [], keywords: ['vpn'], access: [{ source: 'incident', status }] });
  const kb = (status) => ({ hits: [], keywords: ['vpn'], access: [{ source: 'kb_knowledge', status }] });
  const quiet = packOf({ fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', description: 'It drops every ten minutes.', state: 'In Progress' } });
  const calm = await draw('steps', { glance: glanceOf(quiet), lookalikes: look('empty'), knowledge: kb('empty') });
  try {
    assert.equal(calm.summary(), 'None found');
    assert.equal(calm.attention(), 'clear');
  } finally {
    await calm.ui.unmount();
  }
  const partly = await draw('steps', { glance: glanceOf(quiet), lookalikes: look('empty'), knowledge: kb('denied') });
  try {
    assert.equal(partly.summary(), 'Could not check everything');
    assert.notEqual(partly.attention(), 'clear');
    assert.match(partly.text(), /No solved ticket or article with written steps found, but some could not be checked\./);
  } finally {
    await partly.ui.unmount();
  }
});

// ---- Missing details, risk, the Glance ------------------------------------------------------------------------------------------------

test('Missing details: columns that did not come back are listed as not checked; the card is not green and says "hidden", not "missing"', async () => {
  const hidden = packOf({ fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress' }, unreadable: ['description', 'cmdb_ci', 'category'] });
  const c = await draw('missing', { glance: glanceOf(hidden) });
  try {
    assert.ok(!/No description|No configuration item|No category/.test(c.text()), c.text());
    assert.match(c.text(), /Could not check: .*description.*\. That part of the ticket is hidden from you\./);
    assert.notEqual(c.attention(), 'clear');
    assert.match(c.summary(), /^Nothing obvious missing; could not check /);
  } finally {
    await c.ui.unmount();
  }
  const empty = packOf({ fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress' } });
  const e = await draw('missing', { glance: glanceOf(empty) });
  try {
    assert.match(e.text(), /No description/, 'a column that came back empty is missing');
    assert.match(e.text(), /No configuration item/);
  } finally {
    await e.ui.unmount();
  }
});

test('Risk: the SLA, the VIP flag and the notes that could not be read are named, and the card is not green', async () => {
  const answer = glanceOf(packOf(), { slas: { items: [], access: [{ source: 'task_sla', status: 'denied' }] }, vip: { status: 'unknown', access: [{ source: 'sys_user', status: 'denied' }] } });
  const c = await draw('risk', { glance: answer });
  try {
    assert.equal(c.summary(), 'No warning signs found; could not check the SLA, the VIP flag');
    assert.notEqual(c.attention(), 'clear');
    assert.match(c.text(), /Could not check the SLA, the VIP flag, so a risk there would not show\./);
    assert.ok(!/Nothing in the wording, the counts or the SLA points to a risk\./.test(c.text()));
  } finally {
    await c.ui.unmount();
  }
  const whole = await draw('risk', { glance: glanceOf(packOf()) });
  try {
    assert.equal(whole.summary(), 'No warning signs');
    assert.equal(whole.attention(), 'clear');
  } finally {
    await whole.ui.unmount();
  }
});

test('the Glance: a hidden owner is "not shown to you" in the details and is no "Unassigned" chip', async () => {
  const hidden = packOf({ fields: { number: 'INC0010001', short_description: 'x', state: 'In Progress' }, unreadable: ['assigned_to', 'assignment_group'] });
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('glance', () => glanceOf(hidden));
  const ui = await mount(<Glance page={pageFor()} eff={eff()} record={record} header={header} headPhase="ready" />);
  try {
    await settle(6);
    assert.equal(ui.$('[data-chip="unassigned"]'), null);
    await click(ui.$('button.ab-glance-more'));
    assert.match(ui.$('[data-fact="assigned"]').textContent, /Not shown to you/);
    assert.match(ui.$('[data-fact="group"]').textContent, /Not shown to you/);
    assert.ok(!/Nobody yet/.test(ui.text()));
    await click(ui.$('button.ab-glance-more'));
  } finally {
    await ui.unmount();
  }
});
