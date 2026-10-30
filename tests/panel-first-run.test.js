import { mount, click, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { firstRunSteps } from '../src/sidepanel/firstRun.js';
import FirstRun from '../src/sidepanel/FirstRun.jsx';
import ErrorBoundary from '../src/sidepanel/ErrorBoundary.jsx';

// The first run leads the person step by step (turn the site on, add a key, open a ticket), and a part of the panel that breaks
// offers the next step instead of a dead end.

const SN = 'https://acme.service-now.com';
const off = (origin = '') => ({ status: 'not-enabled', tabId: 3, origin });
const list = { status: 'no-record', tabId: 3, href: `${SN}/home` };
const ticket = { status: 'record', tabId: 3, href: `${SN}/incident.do`, record: { table: 'incident', sysId: 'a'.repeat(32) } };
const states = (r) => r.steps.map((s) => `${s.id}:${s.state}`).join(' ');

test('a brand-new panel on a ServiceNow tab that is not turned on: step 1 is next, the rest come later', () => {
  const r = firstRunSteps({ page: off(SN), lastSeen: null, aiReady: false });
  assert.equal(r.show, true);
  assert.equal(states(r), 'site:next key:later ticket:later');
  assert.match(r.steps[0].hint, /button for it is below/);
  assert.match(firstRunSteps({ page: off(''), lastSeen: null, aiReady: false }).steps[0].hint, /Open your ServiceNow instance in this tab/);
});

test('the site is on (here, or a ServiceNow tab answered before) but there is no key: the key is next', () => {
  assert.equal(states(firstRunSteps({ page: list, lastSeen: list, aiReady: false })), 'site:done key:next ticket:later');
  assert.equal(states(firstRunSteps({ page: off(''), lastSeen: list, aiReady: false })), 'site:done key:next ticket:later');
});

test('a key but no site yet: the site is next and the key is done', () => {
  assert.equal(states(firstRunSteps({ page: off(SN), lastSeen: null, aiReady: true })), 'site:next key:done ticket:later');
});

test('once the site is on and the AI can be used the list is gone for good (it is not for every page that is not a ticket)', () => {
  assert.equal(firstRunSteps({ page: list, lastSeen: list, aiReady: true }).show, false);
  assert.equal(firstRunSteps({ page: ticket, lastSeen: ticket, aiReady: true }).show, false);
  assert.equal(firstRunSteps({ page: off(''), lastSeen: list, aiReady: true }).show, false);
});

test('drawn: an ordered list, the step on now marked for screen readers, every state written out', async () => {
  globalThis.chrome = makeChrome().chrome;
  const ui = await mount(<FirstRun page={off(SN)} lastSeen={null} aiReady={false} />);
  assert.match(ui.text(), /Getting started Step 1 of 3/);
  assert.equal(ui.$$('ol li').length, 3);
  assert.equal(ui.$('li[aria-current="step"]').textContent.includes('Turn on Agent Buddy'), true);
  assert.match(ui.text(), /Next/);
  assert.match(ui.text(), /Later/);
  await ui.rerender(<FirstRun page={list} lastSeen={list} aiReady />);
  assert.equal(ui.text(), '', 'nothing once the setup is done');
  await ui.unmount();
});

// Breaks while globalThis.flakyBroken is true (React draws a failed part twice before it gives up, so a one-off failure would not do).
function Flaky() {
  if (globalThis.flakyBroken) throw new Error('the draw fails: Abel Tuter');
  return <p>Drawn fine</p>;
}

test('a part that breaks says so in plain words and "Try again" gives it another chance; the error text is never shown', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.flakyBroken = true;
  const original = console.error;
  console.error = () => {};
  try {
    const ui = await mount(
      <ErrorBoundary resetKey="a">
        <Flaky />
      </ErrorBoundary>
    );
    assert.match(ui.text(), /Something went wrong in this part of Agent Buddy\. Try again, or reload the panel\./);
    assert.ok(!ui.text().includes('Abel Tuter'));
    assert.ok(ui.hasButton('Reload the panel'));
    await click(ui.button('Open Settings'));
    assert.equal(fake.optionsOpened, 1);
    globalThis.flakyBroken = false; // (what went wrong has passed: a page answer that was late, say)
    await click(ui.button('Try again'));
    assert.match(ui.text(), /Drawn fine/);
    await ui.unmount();
  } finally {
    console.error = original;
  }
});
