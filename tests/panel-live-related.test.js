import { mount, click, makeChrome, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import RelatedView from '../src/sidepanel/RelatedView.jsx';
import { normalizePolicy } from '../src/policy/policy.js';

// The Related tab, driven: two reads that overlap, a part that fails, a part the person may not read.

const SYS = 'a'.repeat(32);
const CALLER = 'c'.repeat(32);
const page = { status: 'record', tabId: 7, href: `https://acme.service-now.com/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record: { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth' } };
const eff = (allowHrContent = false) => ({ ready: true, values: {}, locked: {}, policy: normalizePolicy({ allowHrContent }) });
const pack = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident', fields: { short_description: 'VPN drops' }, people: [{ role: 'caller', name: 'Abel Tuter', sysId: CALLER }], access: [] };
const ticket = (n, title) => ({ table: 'incident', sysId: String(n).repeat(32).slice(0, 32), number: `INC00000${n}`, short_description: title, state: 'Closed', opened_at: '2026-10-01 10:00:00' });

function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('pack', () => pack);
  fake.onRead('history', () => ({ items: [], signals: null, access: [] }));
  fake.onRead('similar', () => ({ hits: [], access: [] }));
  fake.onRead('duplicates', () => ({ hits: [], windowHours: 24, access: [] }));
  fake.onRead('knowledge', () => ({ hits: [], access: [] }));
  return fake;
}

test('two loads that overlap: the late answer of the older one does not overwrite the newer one', async () => {
  const fake = setup();
  const first = deferred();
  let packs = 0;
  fake.onRead('pack', () => {
    packs += 1;
    return packs <= 2 ? first.promise : pack; // the first load's two pack reads wait
  });
  fake.onRead('history', (args) => ({ items: [args.allowSensitive ? ticket(2, 'From the newer load') : ticket(1, 'From the older load')], signals: null, access: [] }));
  const ui = await mount(<RelatedView page={page} eff={eff(false)} />);
  // The organisation's policy changes while the first load waits (the panel's settings reload): the view reads again.
  await ui.rerender(<RelatedView page={page} eff={eff(true)} />);
  assert.match(ui.text(), /From the newer load/);
  await during(() => first.resolve(pack));
  assert.match(ui.text(), /From the newer load/);
  assert.ok(!/From the older load/.test(ui.text()), ui.text().slice(0, 300));
  await ui.unmount();
});

test('a part that fails says so (it is not just left out) and the tab offers to read again', async () => {
  const fake = setup();
  let calls = 0;
  fake.onRead('duplicates', () => {
    calls += 1;
    if (calls === 1) throw new Error('The open-tickets check failed.');
    return { hits: [], windowHours: 24, access: [] };
  });
  const ui = await mount(<RelatedView page={page} eff={eff()} />);
  assert.match(ui.text(), /open tickets on the same service could not be checked/i);
  await click(ui.button('Refresh'));
  assert.ok(!/could not be checked/i.test(ui.text()));
  await ui.unmount();
});

test('a part the person may not read says "not available to you", not an error', async () => {
  const fake = setup();
  fake.onRead('similar', () => {
    const err = new Error('HTTP 403 from the Table API');
    err.code = 'ACCESS_DENIED';
    throw err;
  });
  const ui = await mount(<RelatedView page={page} eff={eff()} />);
  assert.match(ui.text(), /Solved before/);
  assert.match(ui.text(), /not available to you/);
  assert.ok(!/HTTP 403/.test(ui.text()), 'the technical message is not shown');
  assert.equal(ui.$('.ab-note-danger'), null, 'not shown as an error');
  await ui.unmount();
});

test('the record cannot be read at all: one plain message with a way to try again', async () => {
  const fake = setup();
  fake.onRead('pack', () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  });
  const ui = await mount(<RelatedView page={page} eff={eff()} />);
  assert.match(ui.text(), /lost touch with this page/);
  assert.ok(ui.hasButton('Try again'));
  await ui.unmount();
});
