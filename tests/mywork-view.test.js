import { mount as mountView, click, makeChrome, deferred, during, choose, fakeClipboard, settle } from './fixtures/panel-dom.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import MyWorkView, { accessLine } from '../src/sidepanel/mywork/MyWorkView.jsx';
import MyWorkDefault from '../src/sidepanel/mywork/index.js';
import { queueSummary, emptyQueueText } from '../src/sidepanel/mywork/cards.jsx';
import { statusChip } from '../src/sidepanel/mywork/parts.jsx';
import { normalizePolicy } from '../src/policy/policy.js';
import { HOUR, DAY, MINUTE } from '../src/mywork/time.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { useEffective } from '../src/sidepanel/useEffective.js';

// The My work screen, driven: what it reads, what it shows, what a click does.

const page = { status: 'other', tabId: 7, href: 'https://acme.service-now.com/now/nav/ui/home', surface: 'classic', portal: null, record: null, newRecord: null, user: { name: 'Beth' } };
const eff = (values = {}, policy = {}) => ({ ready: true, values, locked: {}, policy: normalizePolicy(policy) });
const USER = '46d44a23a9fe19810012d100cca80666';
const M = { known: true, since: 0, lastMineAt: null, lastCustomerAt: null, lastOtherAt: null, lastAt: null, replied: '' };

let n = 0;
function item(over = {}) {
  n += 1;
  const now = Date.now();
  return { table: 'incident', type: 'incident', sysId: String(n).padStart(32, 'a'), number: `INC00${String(n).padStart(5, '0')}`, title: `Ticket ${n}`, priority: '3 - Moderate', state: 'In Progress', holdReason: '', work: 'open', updatedAt: now - 2 * HOUR, openedAt: now - DAY, ci: null, group: null, sla: null, marker: M, ...over };
}
function answer({ items = [], groups = [], approvals = [], access = [], queue = {}, groupInfo = {} } = {}) {
  return {
    version: 1,
    readAt: Date.now(),
    queue: { items, totals: {}, total: items.length, more: false, empty: items.length ? null : 'nothing', names: {}, listQuery: `assigned_to=${USER}^active=true`, ...queue },
    approvals: { items: approvals, total: approvals.length, listQuery: `approver=${USER}^state=requested` },
    groups: { groups: [{ id: 'g'.repeat(32), name: 'Service Desk' }], items: groups, total: groups.length, more: false, listQuery: 'assignment_groupINx^assigned_toISEMPTY^active=true', names: {}, note: '', ...groupInfo },
    access,
  };
}
function setup(reply) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('myWork', typeof reply === 'function' ? reply : () => reply);
  return fake;
}
const linkOf = (ui, number) => ui.$$('a').find((a) => a.textContent.includes(number));

// Every view a test mounts is unmounted after it, even when the test fails half-way: the screen's timers (the "Read 2 min ago"
// tick) would otherwise keep the test process alive.
const mounted = new Set();
async function mount(element) {
  const ui = await mountView(element);
  const unmount = ui.unmount;
  ui.unmount = async () => {
    if (!mounted.delete(ui)) return;
    await unmount();
  };
  mounted.add(ui);
  return ui;
}
afterEach(async () => {
  for (const ui of [...mounted]) await ui.unmount();
});

test('the queue: most urgent first, one status chip, SLA time left, waiting and resolved folded with counts', async () => {
  const now = Date.now();
  const breached = item({ title: 'Printer offline', sla: { breached: true, paused: false, percentage: 140, dueAt: now - DAY, risk: 'breached' } });
  const replied = item({ title: 'VPN drops', marker: { ...M, lastCustomerAt: now - HOUR, lastAt: now - HOUR, replied: 'customer' } });
  const due = item({ title: 'Mail slow', sla: { breached: false, paused: false, percentage: 30, dueAt: now + 2 * HOUR + 10 * MINUTE + 30000, risk: 'ok' } });
  const paused = item({ title: 'Laptop', sla: { breached: false, paused: true, percentage: 50, dueAt: now - HOUR, risk: 'paused' } });
  const waiting = item({ title: 'Need a screenshot', work: 'waiting-customer', state: 'On Hold', holdReason: 'Awaiting Caller' });
  const resolved = item({ title: 'Done already', work: 'resolved', state: 'Resolved' });
  const fake = setup(answer({ items: [resolved, waiting, paused, due, replied, breached] }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.equal(fake.readsOf('myWork').length, 1);
  assert.deepEqual(fake.readsOf('myWork')[0], { profiles: ['it'], allowSensitive: false });
  const text = ui.text();
  assert.match(text, /Read just now/);
  assert.match(text, /My queue 6 open · 1 SLA breached · 1 replied/);
  // Order on screen: breached, then the customer's reply, then priority/SLA.
  const shown = ui.$$('.ab-mw-row a').map((a) => a.textContent);
  assert.match(shown[0], /Printer offline.*SLA breached/);
  assert.match(shown[1], /VPN drops.*Customer replied/);
  assert.match(shown[2], /Mail slow.*SLA due in 2h 10m/);
  assert.match(shown[3], /Laptop.*SLA paused/);
  assert.equal(shown.length, 4, 'the waiting and the resolved tickets are folded away');
  assert.ok(ui.hasButton('Waiting on the customer or others (1)'));
  assert.ok(ui.hasButton('Resolved, awaiting closure (1)'));
  await click(ui.button('Resolved, awaiting closure (1)'));
  assert.match(ui.text(), /Done already Resolved/);
  await ui.unmount();
});

test('a plain click opens the ticket in this tab and switches to the Ticket screen; the link is real for Ctrl+click', async () => {
  const t = item({ title: 'Open me' });
  const fake = setup(answer({ items: [t] }));
  let opened = 0;
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => { opened += 1; }} />);
  const a = linkOf(ui, t.number);
  assert.equal(a.getAttribute('href'), `https://acme.service-now.com/nav_to.do?uri=${encodeURIComponent(`incident.do?sys_id=${t.sysId}`)}`);
  assert.equal(a.getAttribute('target'), '_blank');
  await click(a);
  assert.equal(opened, 1);
  assert.deepEqual(fake.updates.map((u) => u.tabId), [7]);
  assert.match(fake.updates[0].props.url, /incident\.do%3Fsys_id%3D/);
  await ui.unmount();
});

test('filters with counts narrow the list; pressing again clears; the outage note filters by its CI', async () => {
  const vpn = { id: 'c'.repeat(32), name: 'VPN Gateway EU' };
  const items = [item({ ci: vpn }), item({ ci: vpn }), item({ ci: vpn, type: 'sc_task', table: 'sc_task', title: 'Catalog one' }), item({ priority: '1 - Critical', title: 'Critical one' })];
  setup(answer({ items }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.ok(ui.hasButton('P1 1'));
  assert.ok(ui.hasButton('Incidents 3'));
  assert.ok(ui.hasButton('Catalog tasks 1'));
  await click(ui.button('Catalog tasks 1'));
  assert.equal(ui.button('Catalog tasks 1').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(ui.$$('.ab-mw-row a').map((a) => /Catalog one/.test(a.textContent)), [true]);
  await click(ui.button('Catalog tasks 1'));
  assert.equal(ui.$$('.ab-mw-row a').length, 4);
  // Three of my tickets on one CI: a note, and a way to see them together.
  assert.match(ui.text(), /3 of your tickets are on VPN Gateway EU\. One cause\?/);
  await click(ui.button('Show them'));
  assert.ok(ui.hasButton('On VPN Gateway EU 3'));
  assert.equal(ui.$$('.ab-mw-row a').length, 3);
  await ui.unmount();
});

test('over the cap: "Showing 25 of 40" with the full list in ServiceNow', async () => {
  const items = Array.from({ length: 25 }, () => item());
  setup(answer({ items, queue: { total: 40, more: true } }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /My queue 40 open/);
  assert.match(ui.text(), /Showing 25 of 40\. Open the full list/);
  const link = ui.$$('a').find((a) => a.textContent === 'Open the full list');
  assert.equal(decodeURIComponent(decodeURIComponent(link.getAttribute('href'))), `https://acme.service-now.com/nav_to.do?uri=task_list.do?sysparm_query=assigned_to=${USER}^active=true`);
  // Five first, then the rest behind "Show all".
  assert.equal(ui.$$('.ab-mw-row a').length, 5);
  assert.ok(ui.hasButton('Show all (25)'));
  await ui.unmount();
});

test('follow-ups: a reminder and a status update to copy, the customer\'s answer marked; the period can change', async () => {
  const now = Date.now();
  const waiting = item({ title: 'Need logs', work: 'waiting-customer', marker: { ...M, lastMineAt: now - 4 * DAY, lastAt: now - 4 * DAY } });
  const stale = item({ title: 'Slow VPN', marker: { ...M, lastMineAt: now - 6 * DAY, lastAt: now - 6 * DAY } });
  const answered = item({ title: 'Got the logs', work: 'waiting-customer', marker: { ...M, lastMineAt: now - 4 * DAY, lastCustomerAt: now - HOUR, lastAt: now - HOUR, replied: 'customer' } });
  const fake = setup(answer({ items: [waiting, stale, answered] }));
  const copied = fakeClipboard();
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /Follow-ups due 2 due · 1 replied/);
  assert.match(ui.text(), /Got the logs Customer replied today/);
  assert.match(ui.text(), /Need logs Waiting on the customer 4 d/);
  assert.match(ui.text(), /Slow VPN Customer not updated for 6 d/);
  await click(ui.button('Copy reminder'));
  assert.match(copied[0], new RegExp(`your reply on ${waiting.number} \\(Need logs\\)`));
  assert.match(ui.text(), /Copied\. Paste it into the customer comment of the ticket\./);
  await click(ui.button('Copy status update'));
  assert.match(copied[1], /A quick update on .* \(Slow VPN\)/);
  assert.equal(ui.$('label.ab-mw-sr').textContent.trim(), 'Follow up after');
  // The period is the setting: choosing it here saves the setting, and the screen shows what the setting says.
  await choose(ui.$('select'), '5');
  assert.equal((await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY].followUpDays, 5);
  await ui.rerender(<MyWorkView page={page} eff={eff({ followUpDays: 5 })} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /Follow-ups due 1 due · 1 replied/);
  await ui.unmount();
});

test('follow-ups: the period follows the setting, also when it changes in Settings while the screen is open', async () => {
  const now = Date.now();
  const four = item({ title: 'Four days', marker: { ...M, lastMineAt: now - 4 * DAY, lastAt: now - 4 * DAY } });
  const fake = setup(answer({ items: [four] }));
  // The panel's own settings, as App passes them: read from storage and read again when storage changes.
  function Panel() {
    const live = useEffective();
    return live.ready ? <MyWorkView page={page} eff={live} active onOpenTicket={() => {}} /> : null;
  }
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { followUpDays: 5 } });
  const ui = await mount(<Panel />);
  assert.equal(ui.$('select').value, '5');
  assert.match(ui.text(), /No customer has waited 5 days for a word from you\./);
  // Changed on the Settings page while the panel is open.
  await during(() => fake.chrome.storage.local.set({ [SETTINGS_KEY]: { followUpDays: 3 } }));
  assert.equal(ui.$('select').value, '3');
  assert.match(ui.text(), /Follow-ups due 1 due/);
  // Changed here: the setting is saved, and the screen follows it.
  await choose(ui.$('select'), '7');
  await settle();
  assert.equal((await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY].followUpDays, 7);
  assert.equal(ui.$('select').value, '7');
  assert.match(ui.text(), /No customer has waited 7 days for a word from you\./);
  await ui.unmount();
});

test('empty: a useful line, with what waits in my groups', async () => {
  const now = Date.now();
  const end = new Date(now);
  end.setHours(23, 0, 0, 0);
  const dueAt = Math.max(now + MINUTE, Math.min(end.getTime(), now + 30 * MINUTE));
  const g = (title, sla) => item({ title, group: { id: 'g'.repeat(32), name: 'Service Desk' }, sla });
  setup(answer({ items: [], groups: [g('Unassigned A', { breached: false, paused: false, percentage: 10, dueAt, risk: 'at-risk' }), g('Unassigned B', null)] }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /Nothing is waiting on you\. 1 ticket in your groups is due today\./);
  assert.match(ui.text(), /Unassigned in my groups 2 waiting · oldest 1 d/);
  assert.match(ui.text(), /Unassigned A .*Service Desk/);
  await ui.unmount();
});

test('access notes are one plain line; no approvals card without approvals; approvals open the approval record', async () => {
  const fake = setup(answer({ items: [item()], access: [{ source: 'sn_customerservice_case', status: 'denied', note: 'You cannot read cases.' }, { source: 'x', status: 'denied', note: 'You cannot read cases.' }] }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.equal(ui.$('.ab-mw-access').textContent, 'You cannot read cases.');
  assert.ok(!/Approvals waiting on you/.test(ui.text()));
  await ui.unmount();
  const appr = { table: 'sysapproval_approver', sysId: 'e'.repeat(32), type: 'sc_req_item', number: 'RITM0010001', title: 'New laptop', requestedAt: Date.now() - 2 * DAY, dueAt: null };
  fake.onRead('myWork', () => answer({ items: [item()], approvals: [appr] }));
  let opened = 0;
  const ui2 = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => { opened += 1; }} />);
  assert.match(ui2.text(), /Approvals waiting on you 1/);
  assert.match(ui2.text(), /RITM0010001 New laptop asked 2 d ago/);
  await click(linkOf(ui2, 'RITM0010001'));
  assert.match(fake.updates[fake.updates.length - 1].props.url, /sysapproval_approver\.do/);
  assert.equal(opened, 0, 'an approval is not a ticket: the panel stays on My work');
  await ui2.unmount();
  assert.equal(accessLine([{ note: 'a' }, { note: 'a' }, { note: '' }, { note: 'b' }]), 'a b');
});

test('read when shown; again when shown after 5 minutes, not before; HR as the policy allows; profiles go along', async () => {
  const fake = setup(answer({ items: [item()] }));
  const ui = await mount(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active={false} onOpenTicket={() => {}} />);
  assert.equal(fake.readsOf('myWork').length, 0, 'nothing is read while the screen is not on show');
  await ui.rerender(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active onOpenTicket={() => {}} />);
  assert.deepEqual(fake.readsOf('myWork'), [{ profiles: ['csm', 'hr'], allowSensitive: true }]);
  const realNow = Date.now;
  try {
    await ui.rerender(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active={false} onOpenTicket={() => {}} />);
    const base = realNow();
    Date.now = () => base + 2 * MINUTE;
    await ui.rerender(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active onOpenTicket={() => {}} />);
    assert.equal(fake.readsOf('myWork').length, 1, 'shown again within 5 minutes: no new read');
    await ui.rerender(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active={false} onOpenTicket={() => {}} />);
    Date.now = () => base + 6 * MINUTE;
    await ui.rerender(<MyWorkView page={page} eff={eff({ profiles: ['csm', 'hr'] }, { allowHrContent: true })} active onOpenTicket={() => {}} />);
    assert.equal(fake.readsOf('myWork').length, 2, 'shown again after 5 minutes: read again');
  } finally {
    Date.now = realNow;
  }
  await ui.unmount();
});

test('a read can be stopped: its late answer is dropped, "Try again" reads again', async () => {
  const held = deferred();
  let calls = 0;
  const fake = setup(() => {
    calls += 1;
    return calls === 1 ? held.promise : answer({ items: [item({ title: 'Second read' })] });
  });
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /Reading your work/);
  await click(ui.button('Stop'));
  assert.match(ui.text(), /Stopped before anything was read\./);
  await during(() => held.resolve(answer({ items: [item({ title: 'Late answer' })] })));
  assert.ok(!/Late answer/.test(ui.text()));
  await click(ui.button('Try again'));
  assert.match(ui.text(), /Second read/);
  assert.equal(fake.readsOf('myWork').length, 2);
  await ui.unmount();
});

test('a slow read says what it waits for', async () => {
  const held = deferred();
  setup(() => held.promise);
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.ok(!/Waiting for ServiceNow/.test(ui.text()));
  await new Promise((r) => setTimeout(r, 3100));
  await settle();
  assert.match(ui.text(), /Waiting for ServiceNow to answer: your tickets, their SLAs and the latest comments\./);
  await during(() => held.resolve(answer({ items: [item()] })));
  assert.ok(!/Waiting for ServiceNow/.test(ui.text()));
  await ui.unmount();
});

test('a failed read is a plain sentence with "Try again"', async () => {
  setup(() => {
    throw Object.assign(new Error('Your ServiceNow session has expired. Log in again, then retry.'), { code: 'SESSION_EXPIRED' });
  });
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.match(ui.$('.ab-note-danger').textContent, /session has expired/);
  assert.ok(ui.hasButton('Try again'));
  await ui.unmount();
});

test('another instance in the tab: the first instance\'s tickets are not listed while it reads, after it fails, or after Stop', async () => {
  const pageB = { ...page, href: 'https://other-company.service-now.com/now/nav/ui/home' };
  const mineOnA = item({ title: 'Instance A ticket' });
  let onB = deferred();
  let calls = 0;
  setup(() => {
    calls += 1;
    return calls === 1 ? answer({ items: [mineOnA] }) : onB.promise;
  });
  let opened = 0;
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => { opened += 1; }} />);
  assert.match(ui.text(), /Instance A ticket/);
  await ui.rerender(<MyWorkView page={pageB} eff={eff()} active onOpenTicket={() => { opened += 1; }} />);
  assert.match(ui.text(), /Reading your work/);
  assert.ok(!/Instance A ticket/.test(ui.text()), 'not while the other instance is read');
  assert.equal(linkOf(ui, mineOnA.number), undefined, 'nothing to click that would open A\'s sys_id here');
  await during(() => onB.reject(Object.assign(new Error('You cannot read the task table.'), { code: 'DENIED' })));
  assert.match(ui.text(), /You cannot read the task table\./);
  assert.ok(!/Instance A ticket/.test(ui.text()), 'not after the read failed');
  onB = deferred();
  await click(ui.button('Try again'));
  await click(ui.button('Stop'));
  assert.match(ui.text(), /Stopped before anything was read\./);
  assert.ok(!/Instance A ticket/.test(ui.text()), 'not after Stop');
  // Back on the first instance, its own answer is its own again.
  await ui.rerender(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => { opened += 1; }} />);
  assert.match(ui.text(), /Instance A ticket/);
  assert.equal(opened, 0);
  await ui.unmount();
});

test('the screen\'s default export is this view; pure helpers', () => {
  assert.equal(MyWorkDefault, MyWorkView);
  assert.equal(queueSummary({ total: 0 }, []), '');
  assert.equal(queueSummary({ total: 40 }, [item()]), '40 open');
  assert.equal(emptyQueueText({ empty: 'unread', now: Date.now() }), 'None of your ticket queues could be read.');
  assert.match(emptyQueueText({ empty: 'unseen', now: Date.now() }), /cannot tell whether anything is assigned to you/);
  assert.equal(emptyQueueText({ empty: 'nothing', waiting: 2, groupTotal: 4, now: Date.now() }), 'Nothing needs you right now. 2 tickets wait on the customer or others. Your groups have 4 unassigned tickets.');
  assert.deepEqual(statusChip(item({ work: 'on-hold', holdReason: 'Awaiting Vendor' })), { text: 'On hold: Awaiting Vendor', tone: 'quiet' });
  assert.deepEqual(statusChip(item({ work: 'new', state: 'New' })), { text: 'New', tone: 'plain' });
  assert.deepEqual(statusChip(item({ marker: { ...M, replied: 'other' } })), { text: 'New comment', tone: 'reply' });
  assert.equal(statusChip(item({ work: 'resolved', state: 'Resolved', marker: { ...M, replied: 'customer' } })).text, 'Resolved');
});
