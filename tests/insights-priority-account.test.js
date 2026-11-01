import { mount, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { accountKey, isPriorityAccount, PRIORITY_ACCOUNT_MARK } from '../src/insights/priorityAccount.js';
import { normalizePolicy } from '../src/policy/policy.js';
import AccountCard from '../src/sidepanel/ticket/cards/AccountCard.jsx';
import Glance from '../src/sidepanel/ticket/cards/Glance.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';

// N28, the "priority account" mark: the organisation names its priority accounts in its policy (ServiceNow has no standard column),
// and the case's account name, already read for the Account card and the Glance, is compared with that list. No read, no column.

// ---- Matching ------------------------------------------------------------------------------------------------------------------

test('matching: case, spaces around and inside, and the Unicode form do not matter; anything else does', () => {
  const list = [' Boxeo ', 'Acme  Corporation EMEA', 'Café Noir'];
  assert.equal(isPriorityAccount('boxeo', list), true);
  assert.equal(isPriorityAccount('BOXEO', list), true);
  assert.equal(isPriorityAccount('Acme Corporation emea', list), true);
  assert.equal(isPriorityAccount('Café Noir', list), true, 'the same letters typed another way');
  for (const other of ['Boxeo Ltd', 'Box', 'Acme Corporation', 'Cafe Noir', '', '   ', null, undefined, 42, ['Boxeo']]) {
    assert.equal(isPriorityAccount(other, list), false, JSON.stringify(other));
  }
  // A list that is not a list, or entries that are not text, name no account.
  for (const bad of [null, undefined, 'Boxeo', { Boxeo: true }, [7, null, { name: 'Boxeo' }], []]) assert.equal(isPriorityAccount('Boxeo', bad), false, JSON.stringify(bad));
  assert.equal(accountKey('  Acme \n Corp  '), 'acme corp');
  assert.equal(accountKey(5), '');
});

test('matching against the policy as read: the organisation\'s list reaches eff.policy cleaned', () => {
  const policy = normalizePolicy({ priorityAccounts: ['Boxeo', 7, 'x'.repeat(101)] });
  assert.equal(isPriorityAccount('boxeo', policy.priorityAccounts), true);
  assert.equal(isPriorityAccount('x'.repeat(101), policy.priorityAccounts), false, 'a name too long to be an account is not on the list');
  assert.equal(isPriorityAccount('Boxeo', normalizePolicy({}).priorityAccounts), false);
});

// ---- On the Account card and the Glance ----------------------------------------------------------------------------------------

const CASE_ID = 'c'.repeat(32);
const record = { table: 'sn_customerservice_case', sysId: CASE_ID, number: 'CS0001001', kind: 'case' };
const header = { number: 'CS0001001', short_description: 'Invoices are not delivered', state: 'Open', priority: '2 - High' };
let tab = 300;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/sn_customerservice_case.do?sys_id=${CASE_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = (policy = {}) => ({ ready: true, values: { profiles: ['csm'] }, locked: {}, policy: normalizePolicy(policy) });
const glanceAnswer = (account = 'Boxeo') => ({
  pack: {
    table: record.table,
    sysId: CASE_ID,
    number: 'CS0001001',
    kind: 'case',
    fields: { number: 'CS0001001', short_description: 'Invoices are not delivered', state: 'Open', priority: '2 - High', assigned_to: 'Beth Anglin', ...(account ? { account } : {}), entitlement: 'Gold support' },
    people: [],
    journal: [],
    related: {},
    access: [],
  },
  slas: { items: [], access: [{ source: 'task_sla', status: 'empty' }] },
  vip: { status: 'no', access: [] },
  outage: null,
});

function setup(account) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('glance', () => glanceAnswer(account));
  fake.onRead('accountCases', () => ({ cases: [{ number: 'CS0001000', short_description: 'Login fails', state: 'Open', priority: '3 - Moderate' }], more: 0, access: [{ source: 'sn_customerservice_case', status: 'ok' }] }));
  fake.onRead('ciChanges', () => ({ items: [], keys: ['cmdb_ci'], access: [{ source: 'change_request', status: 'empty' }] }));
  return fake;
}
const reads = (fake) => ['glance', 'accountCases', 'ciChanges'].map((op) => fake.readsOf(op).length);

test('Account card: an account on the list carries the "Priority account" mark (the VIP look) and the summary starts with it', async () => {
  const fake = setup('Boxeo');
  let summary = '';
  const ui = await mount(<AccountCard page={pageFor()} eff={eff({ priorityAccounts: ['BOXEO', 'Initech'] })} record={record} active setSummary={(s) => (summary = s)} />);
  try {
    await settle(6);
    const mark = ui.$('.ab-glance-vip');
    assert.ok(mark, 'the mark is drawn');
    assert.equal(mark.textContent, PRIORITY_ACCOUNT_MARK.text);
    assert.equal(mark.getAttribute('title'), PRIORITY_ACCOUNT_MARK.title);
    assert.match(ui.text(), /Account\s*Boxeo\s*Priority account/);
    assert.match(summary, /^Priority account · Boxeo · 1 open case/);
    assert.deepEqual(reads(fake), [1, 1, 1], 'the reads of the card, nothing more');
  } finally {
    await ui.unmount();
  }
});

test('Account card: an account not on the list, a case with no account, or no list: no mark, the summary as before', async () => {
  for (const [account, policy] of [['Globex', { priorityAccounts: ['Boxeo'] }], ['', { priorityAccounts: ['Boxeo'] }], ['Boxeo', {}]]) {
    const fake = setup(account);
    let summary = '';
    // eslint-disable-next-line no-await-in-loop
    const ui = await mount(<AccountCard page={pageFor()} eff={eff(policy)} record={record} active setSummary={(s) => (summary = s)} />);
    try {
      // eslint-disable-next-line no-await-in-loop
      await settle(6);
      assert.equal(ui.$('.ab-glance-vip'), null, `${account || 'no account'}: no mark`);
      assert.ok(!/Priority account/.test(ui.text()));
      assert.ok(!/Priority account/.test(summary));
      if (account) assert.match(summary, new RegExp(`^${account} · 1 open case`));
      else assert.match(ui.text(), /This case has no account/);
      assert.deepEqual(reads(fake), [1, 1, 1]);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await ui.unmount();
    }
  }
});

test('Glance: the mark sits next to VIP for a listed account, from the same one read', async () => {
  const fake = setup('Boxeo');
  const ui = await mount(<Glance page={pageFor()} eff={eff({ priorityAccounts: ['boxeo'] })} record={record} header={header} headPhase="ready" />);
  try {
    await settle(4);
    const head = ui.$('.ab-glance-head');
    const marks = head.querySelectorAll('.ab-glance-vip');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].textContent, 'Priority account');
    assert.deepEqual(reads(fake), [1, 0, 0], 'only the glance read');
  } finally {
    await ui.unmount();
  }
  const other = setup('Globex');
  const plain = await mount(<Glance page={pageFor()} eff={eff({ priorityAccounts: ['boxeo'] })} record={record} header={header} headPhase="ready" />);
  try {
    await settle(4);
    assert.equal(plain.$('.ab-glance-vip'), null);
    assert.deepEqual(reads(other), [1, 0, 0]);
  } finally {
    await plain.unmount();
  }
});
