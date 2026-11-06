import { mount as mountView, click, makeChrome, deferred, during, choose, fakeClipboard, settle } from './fixtures/panel-dom.js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.deepEqual(fake.readsOf('myWork')[0], { profiles: ['it'], allowSensitive: false, accounts: false });
  const text = ui.text();
  assert.match(text, /Read just now/);
  assert.match(text, /My queue 6 open, 1 SLA breached, 1 replied/);
  // Calm: no red frame around the queue; the breached ticket carries a red dot and a chip on its own row, the reply a green dot.
  assert.equal(ui.$$('.ab-cardx-danger, .ab-cardx-warn', { all: true }).length, 0, 'no alarm frame around the queue');
  const dots = ui.$$('.ab-mw-row a').map((a) => a.querySelector('.ab-dot').className);
  assert.match(dots[0], /ab-dot-danger/);
  assert.match(dots[1], /ab-dot-ok/);
  assert.match(dots[2], /ab-dot-neutral/);
  assert.ok(ui.$$('.ab-mw-row a')[0].querySelector('.ab-mw-sla-breached.ab-chip-danger'), 'the breached SLA is a chip in its colour');
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
  assert.match(ui.text(), /Follow-ups due 2 due, 1 replied/);
  assert.match(ui.text(), /Got the logs Customer replied today/);
  assert.match(ui.text(), /Need logs Waiting on the customer 4 d/);
  assert.match(ui.text(), /Slow VPN Customer not updated for 6 d/);
  // The copy is a quiet action of its row, outside the link that opens the ticket. (Round 4: every one reads "Copy draft"; its
  // accessible name says which ticket, so a list of them is not a list of the same button.)
  const drafts = ui.$$('button').filter((b) => b.textContent.trim() === 'Copy draft');
  assert.equal(drafts.length, 2, 'a reminder and a status update; nothing to copy for the answered one');
  const draftFor = (number) => drafts.find((b) => (b.getAttribute('aria-label') || '').includes(number));
  assert.match(draftFor(waiting.number).getAttribute('aria-label'), /^Copy draft for /);
  assert.equal(draftFor(waiting.number).closest('a'), null);
  assert.ok(draftFor(waiting.number).closest('.ab-mw-row'));
  await click(draftFor(waiting.number));
  assert.match(copied[0], new RegExp(`your reply on ${waiting.number} \\(Need logs\\)`));
  assert.match(ui.text(), /Copied\. Paste it into the customer comment of the ticket\./);
  await click(draftFor(stale.number));
  assert.match(copied[1], /A quick update on .* \(Slow VPN\): we are still working on it, and it has not been forgotten\./);
  assert.match(copied[1], /If anything has changed on your side, just reply to this message\.\n\nThank you for your patience\.$/);
  assert.equal(ui.$('label.ab-mw-sr').textContent.trim(), 'Follow up after');
  // The period is the setting: choosing it here saves the setting, and the screen shows what the setting says.
  await choose(ui.$('select'), '5');
  assert.equal((await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY].followUpDays, 5);
  await ui.rerender(<MyWorkView page={page} eff={eff({ followUpDays: 5 })} active onOpenTicket={() => {}} />);
  assert.match(ui.text(), /Follow-ups due 1 due, 1 replied/);
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
  assert.match(ui.text(), /Unassigned in my groups 2 waiting, oldest 1 d/);
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
  assert.deepEqual(fake.readsOf('myWork'), [{ profiles: ['csm', 'hr'], allowSensitive: true, accounts: false }]);
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

// ---- round 4: tickets at risk first ------------------------------------------------------------------------------------------

test('at risk: an "At risk" chip and the reasons on the row, at-risk tickets first, one more filter chip with its count', async () => {
  const now = Date.now();
  const bounced = item({ title: 'VPN drops every hour', priority: '2 - High', reassignments: 3, marker: { ...M, lastCustomerAt: now - 2 * DAY - HOUR, lastAt: now - 2 * DAY - HOUR, replied: 'customer' } });
  const reopened = item({ table: 'sn_customerservice_case', type: 'sn_customerservice_case', number: 'CS0001023', title: 'Invoice portal shows an error', priority: '4 - Low', reopens: 2, account: 'Boxeo' });
  const slaVip = item({ title: 'Mail slow for the CFO', vip: true, sla: { breached: false, paused: false, percentage: 80, dueAt: now + 3 * HOUR, risk: 'at-risk' } });
  const fresh = item({ title: 'Fresh reply', marker: { ...M, lastCustomerAt: now - HOUR, lastAt: now - HOUR, replied: 'customer' } });
  const calm = item({ title: 'Critical but calm', priority: '1 - Critical', reassignments: 1, reopens: 0, vip: false });
  const done = item({ title: 'Done already', work: 'resolved', state: 'Resolved', reopens: 3 });
  const unassigned = item({ title: 'Nobody has it', reassignments: 6, group: { id: 'g'.repeat(32), name: 'Service Desk' } });
  const fake = setup(answer({ items: [calm, fresh, done, reopened, bounced, slaVip], groups: [unassigned] }));
  const ui = await mount(<MyWorkView page={page} eff={eff({}, { priorityAccounts: ['Boxeo'] })} active onOpenTicket={() => {}} />);
  // The organisation names priority accounts, so the read asks for a case's account.
  assert.equal(fake.readsOf('myWork')[0].accounts, true);

  // At risk first (the SLA one leads: its SLA ranks first anyway), then the rest in the order My work always had.
  const rows = () => ui.$$('[data-card="mywork-queue"] .ab-mw-row a');
  const titles = () => rows().map((a) => a.querySelector('.ab-mw-title').textContent);
  assert.deepEqual(titles(), ['Mail slow for the CFO', 'VPN drops every hour', 'Invoice portal shows an error', 'Fresh reply', 'Critical but calm']);
  const why = (a) => a.querySelector('.ab-mw-why')?.textContent || '';
  assert.deepEqual(rows().map(why), ['SLA nearly used · VIP caller', 'Reassigned 3 times · waiting on you 2 days', 'Reopened twice · priority account', '', '']);
  // The chip: amber, the SLA-risk chip's family, first on the line; only on the rows at risk.
  const chips = rows().map((a) => a.querySelector('.ab-mw-risk'));
  assert.deepEqual(chips.map(Boolean), [true, true, true, false, false]);
  assert.match(chips[0].className, /(^| )ab-chip( |$)/);
  assert.match(chips[0].className, /(^| )ab-chip-warn( |$)/);
  assert.equal(chips[1].textContent, 'At risk');
  assert.equal(chips[1].parentNode.firstChild, chips[1], 'the chip leads the line');
  assert.match(rows()[1].textContent, /VPN drops every hour.*At risk.*Customer replied.*P2.*Reassigned 3 times/);
  // Not on the unassigned tickets of my groups, not on a resolved ticket.
  assert.equal(ui.$$('[data-card="mywork-groups"] .ab-mw-risk').length, 0);
  await click(ui.button('Resolved, awaiting closure (1)'));
  assert.ok(!ui.$$('.ab-mw-row a').find((a) => /Done already/.test(a.textContent)).querySelector('.ab-mw-risk'));

  // One more chip in the existing row, first, with its count; a real button with aria-pressed, so the keyboard reaches it.
  const first = ui.$('.ab-mw-chips button');
  assert.equal(first.textContent.replace(/\s+/g, ' ').trim(), 'At risk 3');
  assert.equal(first.getAttribute('type'), 'button');
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  await click(ui.button('At risk 3'));
  assert.equal(ui.button('At risk 3').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(titles(), ['Mail slow for the CFO', 'VPN drops every hour', 'Invoice portal shows an error']);
  await click(ui.button('At risk 3'));
  assert.equal(rows().length, 5, 'pressed again: the filter is off');
  // No new card or section: the same sections as before.
  assert.deepEqual(ui.$$('.ab-mywork > .ab-cardx').map((c) => c.getAttribute('data-card')), ['mywork-queue', 'mywork-followups', 'mywork-groups']);
  await ui.unmount();
});

test('at risk: without priority accounts the account is not asked for and is no reason; nothing at risk, no chip', async () => {
  const boxeo = item({ table: 'sn_customerservice_case', type: 'sn_customerservice_case', number: 'CS0001024', title: 'Boxeo case', account: 'Boxeo' });
  const fake = setup(answer({ items: [boxeo, item({ title: 'Plain' })] }));
  const ui = await mount(<MyWorkView page={page} eff={eff()} active onOpenTicket={() => {}} />);
  assert.equal(fake.readsOf('myWork')[0].accounts, false);
  assert.equal(ui.$$('.ab-mw-risk').length, 0);
  assert.equal(ui.$$('.ab-mw-why').length, 0);
  assert.ok(!ui.hasButton(/^At risk/), 'a chip with nothing behind it is not shown');
  await ui.unmount();
});
