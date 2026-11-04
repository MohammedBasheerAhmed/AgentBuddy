import { mount, press, settle, during, document } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppView, useOwnLaunch, usePaletteToggle } from '../src/sidepanel/App.jsx';
import CommandPalette, { modalOnScreen } from '../src/sidepanel/palette/CommandPalette.jsx';
import { makeLaunch } from '../src/lib/launch.js';
import { effectiveSettings } from '../src/policy/policy.js';

// The command palette in the panel (src/sidepanel/App.jsx): what it offers depends on what is on screen (audit P2.5), its key does
// nothing over a preview (P2.7), and an action it chose expires like one from the bar on the page (P2.8).

const SYS = 'a'.repeat(32);
const record = { status: 'record', tabId: 7, href: `https://acme.service-now.com/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record: { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth' } };
const notServiceNow = { status: 'not-enabled', tabId: 9, origin: '' };
const notOn = { status: 'not-enabled', tabId: 9, origin: 'https://example.com' };
const eff = { ready: true, ...effectiveSettings({ provider: 'anthropic', profiles: ['it'], profilesConfirmed: true }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false };

// (A static render: the palette's list is drawn, no effect runs. PendingDraft is left out: a static render cannot subscribe to it.)
const draw = (props) => renderToStaticMarkup(React.createElement(AppView, { eff, onChoose() {}, onChanged() {}, Pending: () => null, section: 'ticket', visited: new Set(['ticket']), paletteOpen: true, ...props }));
const commandsIn = (markup) => [...markup.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1]);

// ---- what it offers (P2.5) -----------------------------------------------------------------------------------------------------

test('on a record the palette offers "This ticket" commands: the AI actions and the Insights cards', () => {
  const ids = commandsIn(draw({ page: record, lastGood: record, lastSeen: record }));
  assert.ok(ids.includes('run:record-summary'));
  assert.ok(ids.includes('run:card:ready'));
});

test('the setup help in place of the Ticket screen (this tab is not ServiceNow, or not turned on): no "This ticket" command', () => {
  for (const page of [notServiceNow, notOn]) {
    const markup = draw({ page, lastGood: record, lastSeen: record });
    const ids = commandsIn(markup);
    assert.ok(ids.length > 0, 'the palette is open');
    assert.ok(!ids.some((id) => id.startsWith('run:')), `nothing to run on a record no one can see (${page.origin || 'not ServiceNow'})`);
    assert.ok(ids.includes('go:ticket') && ids.includes('settings'), 'the rest is still there');
  }
});

// ---- its key (P2.7) -----------------------------------------------------------------------------------------------------------

function Probe({ preview = 'none' }) {
  const [open, setOpen] = usePaletteToggle();
  return (
    <div>
      <p>{open ? 'palette is open' : 'palette is closed'}</p>
      {preview !== 'none' && (
        <div hidden={preview === 'hidden'}>
          <div className="ab-backdrop" role="presentation">
            <div className="ab-dialog" role="dialog" aria-modal="true">
              <button type="button">Send to AI</button>
            </div>
          </div>
        </div>
      )}
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={[]} onRun={() => {}} />
    </div>
  );
}
const ctrlK = () => press(document.body, 'k', { ctrlKey: true, code: 'KeyK' });

test('Ctrl+K opens and closes the palette', async () => {
  const ui = await mount(<Probe />);
  try {
    assert.match(ui.text(), /palette is closed/);
    await ctrlK();
    assert.match(ui.text(), /palette is open/);
    assert.equal(modalOnScreen(document), false, 'the palette itself does not count');
    await ctrlK();
    assert.match(ui.text(), /palette is closed/);
  } finally {
    await ui.unmount();
  }
});

test('while a preview is on screen, Ctrl+K does nothing (the palette does not open over it)', async () => {
  const ui = await mount(<Probe preview="shown" />);
  try {
    assert.equal(modalOnScreen(document), true);
    await ctrlK();
    assert.match(ui.text(), /palette is closed/);
    assert.equal(ui.$$('.ab-palette').length, 0);
  } finally {
    await ui.unmount();
  }
});

test('a preview waiting in a hidden part of the panel does not stop the key', async () => {
  const ui = await mount(<Probe preview="hidden" />);
  try {
    assert.equal(modalOnScreen(document), false);
    await ctrlK();
    assert.match(ui.text(), /palette is open/);
  } finally {
    await ui.unmount();
  }
});

test('modalOnScreen without a document is false', () => {
  assert.equal(modalOnScreen(null), false);
  assert.equal(modalOnScreen({}), false);
});

// ---- an action it chose expires (P2.8) ----------------------------------------------------------------------------------------

let held = null;
function LaunchProbe({ ttl }) {
  const [own, setOwn] = useOwnLaunch(ttl);
  held = { own, setOwn };
  return <p>{own ? `waiting: ${own.featureId}` : 'nothing waiting'}</p>;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('an action the palette chose and nothing took is dropped after the time a launch counts', async () => {
  // (A short time to live instead of LAUNCH_TTL_MS's 30 s, with room to spare for a busy machine running every test at once.)
  const TTL = 800;
  const ui = await mount(<LaunchProbe ttl={TTL} />);
  try {
    const launch = makeLaunch({ tabId: 7, table: 'incident', sysId: SYS, featureId: 'reply-draft', now: Date.now() });
    await during(async () => held.setOwn(launch));
    assert.match(ui.text(), /waiting: reply-draft/);
    await during(() => wait(TTL + 300)); // (the timer fires inside act)
    assert.match(ui.text(), /nothing waiting/);
    // one that is already too old goes at once
    await during(async () => held.setOwn({ ...launch, at: Date.now() - TTL - 1000 }));
    assert.match(ui.text(), /nothing waiting/);
  } finally {
    await ui.unmount();
  }
});
