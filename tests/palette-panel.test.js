import { mount, press, during, document, type, click, focused } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppView, useOwnLaunch, usePaletteToggle } from '../src/sidepanel/App.jsx';
import CommandPalette, { modalOnScreen } from '../src/sidepanel/palette/CommandPalette.jsx';
import { AllToolsContext, useAllTools } from '../src/sidepanel/palette/allToolsContext.js';
import { GROUPS, buildCommands, groupLabel } from '../src/sidepanel/palette/commands.js';
import { makeLaunch } from '../src/lib/launch.js';
import { effectiveSettings } from '../src/policy/policy.js';

// All tools, the command palette, in the panel (src/sidepanel/App.jsx): what it offers depends on what is on screen (audit P2.5), its
// key does nothing over a preview (P2.7), an action it chose expires like one from the bar on the page (P2.8), and any part of the
// panel opens it at a group (useAllTools, docs/focus-layout.md).

const SYS = 'a'.repeat(32);
const record = { status: 'record', tabId: 7, href: `https://acme.service-now.com/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record: { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' }, newRecord: null, user: { name: 'Beth' } };
const notServiceNow = { status: 'not-enabled', tabId: 9, origin: '' };
const notOn = { status: 'not-enabled', tabId: 9, origin: 'https://example.com' };
const eff = { ready: true, ...effectiveSettings({ provider: 'anthropic', profiles: ['it'], profilesConfirmed: true }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false };

// (A static render: the palette's list is drawn, no effect runs. PendingDraft is left out: a static render cannot subscribe to it.)
const draw = (props) => renderToStaticMarkup(React.createElement(AppView, { eff, onChoose() {}, onChanged() {}, Pending: () => null, section: 'ticket', visited: new Set(['ticket']), paletteOpen: true, ...props }));
const commandsIn = (markup) => [...markup.matchAll(/data-command="([^"]+)"/g)].map((m) => m[1]);
const groupsIn = (markup) => [...markup.matchAll(/class="ab-palette-section" role="group" aria-label="[^"]*" data-group="([^"]+)"/g)].map((m) => m[1]);

// ---- what it offers (P2.5) -----------------------------------------------------------------------------------------------------

test('on the Ticket screen with a record: "More for this ticket" (the cards and AI actions beyond the five) before Go to and Panel', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record });
  assert.deepEqual(groupsIn(markup), ['ticket-insights', 'ticket-assist', 'go', 'panel']);
  const ids = commandsIn(markup);
  assert.ok(ids.includes('run:show:related'), 'a card beyond the five');
  assert.ok(ids.includes('run:ask:ticket'), 'Ask about this ticket');
  assert.ok(ids.includes('run:handoff-brief'), 'an AI action beyond the five');
  assert.ok(!ids.includes('run:record-summary'), 'the summary is one of the five: on the Ticket screen itself');
  assert.ok(!ids.includes('run:card:ready'), 'no QUICK_CARDS entry');
});

test('on another screen: no "More for this ticket", only Go to and Panel', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record, section: 'write', visited: new Set(['ticket', 'write']) });
  assert.deepEqual(groupsIn(markup), ['go', 'panel']);
});

test('the setup help in place of the Ticket screen (this tab is not ServiceNow, or not turned on): nothing to run on a record', () => {
  for (const page of [notServiceNow, notOn]) {
    const markup = draw({ page, lastGood: record, lastSeen: record });
    const ids = commandsIn(markup);
    assert.ok(ids.length > 0, 'All tools is open');
    assert.ok(!ids.some((id) => id.startsWith('run:')), `nothing to run on a record no one can see (${page.origin || 'not ServiceNow'})`);
    assert.ok(ids.includes('go:ticket') && ids.includes('settings'), 'the rest is still there');
  }
});

test('opened at a group by the shell: that group\'s first tool is the highlighted one', () => {
  const markup = draw({ page: record, lastGood: record, lastSeen: record, paletteSection: 'ticket-assist' });
  assert.deepEqual([...markup.matchAll(/role="option" aria-selected="true" data-command="([^"]+)"/g)].map((m) => m[1]), ['run:ask:ticket']);
});

// ---- its key and its opener (P2.7) -------------------------------------------------------------------------------------------

const list = buildCommands({ eff, screens: [{ id: 'ticket', label: 'Ticket' }, { id: 'team', label: 'Team' }], active: 'ticket', recordPage: { tabId: 7, record: record.record } });

/** What a screen does: it gets the opener from the context and calls it with a group (MoreTools in the Ticket screen). */
function MoreButton({ at }) {
  const open = useAllTools();
  return <button type="button" onClick={() => open(at)}>More for this ticket</button>;
}

function Probe({ preview = 'none', commands = [] }) {
  const [open, setOpen, section] = usePaletteToggle();
  return (
    <AllToolsContext.Provider value={(at) => setOpen(true, at)}>
      <div>
        <p>{open ? `palette is open${section ? ` at ${section}` : ''}` : 'palette is closed'}</p>
        <MoreButton at="ticket-assist" />
        {preview !== 'none' && (
          <div hidden={preview === 'hidden'}>
            <div className="ab-backdrop" role="presentation">
              <div className="ab-dialog" role="dialog" aria-modal="true">
                <button type="button">Send to AI</button>
              </div>
            </div>
          </div>
        )}
        <CommandPalette open={open} section={section} onClose={() => setOpen(false)} commands={commands} onRun={() => {}} />
      </div>
    </AllToolsContext.Provider>
  );
}
const ctrlK = () => press(document.body, 'k', { ctrlKey: true, code: 'KeyK' });

test('Ctrl+K opens and closes All tools', async () => {
  const ui = await mount(<Probe />);
  try {
    assert.match(ui.text(), /palette is closed/);
    await ctrlK();
    assert.match(ui.text(), /palette is open/);
    assert.equal(modalOnScreen(document), false, 'All tools itself does not count');
    await ctrlK();
    assert.match(ui.text(), /palette is closed/);
  } finally {
    await ui.unmount();
  }
});

test('a screen opens it at a group through useAllTools; Ctrl+K closes it, and the next Ctrl+K opens it from the top', async () => {
  const ui = await mount(<Probe commands={list} />);
  try {
    const opener = ui.button('More for this ticket');
    opener.focus();
    await click(opener);
    assert.match(ui.text(), /palette is open at ticket-assist/);
    assert.equal(ui.$('.ab-palette-item.is-active')?.getAttribute('data-command'), 'run:ask:ticket', 'the group\'s first tool');
    assert.equal(focused(), ui.$('.ab-palette-input'), 'the focus is in the search box');
    await ctrlK();
    assert.match(ui.text(), /palette is closed/);
    assert.equal(focused(), opener, 'the focus goes back to what opened it');
    await ctrlK();
    assert.match(ui.text(), /palette is open$|palette is open (?!at)/);
    assert.equal(ui.$('.ab-palette-item.is-active')?.getAttribute('data-command'), list[0].id, 'from the top');
  } finally {
    await ui.unmount();
  }
});

test('while a preview is on screen, Ctrl+K does nothing (All tools does not open over it)', async () => {
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

test('outside the shell useAllTools does nothing (a view drawn on its own, in a test, still works)', async () => {
  let opener = null;
  function Bare() {
    opener = useContext(AllToolsContext);
    return null;
  }
  const ui = await mount(<Bare />);
  try {
    assert.equal(typeof opener, 'function');
    assert.doesNotThrow(() => opener('ticket-insights'));
  } finally {
    await ui.unmount();
  }
});

// ---- the sheet as used ----------------------------------------------------------------------------------------------------------

function Sheet({ onRun, onClose = () => {}, section = '' }) {
  return <CommandPalette open section={section} onClose={onClose} commands={list} onRun={onRun} />;
}
const headings = (ui) => ui.$$('.ab-palette-group').map((h) => h.textContent);
const active = (ui) => ui.$('.ab-palette-item.is-active')?.getAttribute('data-command');

test('typing keeps the headings of the groups that have a match; the arrows move through every group; Enter runs', async () => {
  const ran = [];
  let closed = 0;
  const ui = await mount(<Sheet onRun={(c) => ran.push(c.id)} onClose={() => closed++} />);
  try {
    assert.deepEqual(headings(ui), ['ticket-insights', 'ticket-assist', 'go', 'panel'].map(groupLabel));
    const box = ui.$('.ab-palette-input');
    await type(box, 'email');
    assert.deepEqual(headings(ui), [groupLabel('ticket-assist')], 'only AI Assist has an email');
    assert.ok(ui.$$('[role="option"]').every((o) => o.closest('[role="group"]').getAttribute('data-group') === 'ticket-assist'));
    await type(box, 'language');
    assert.deepEqual(headings(ui), [groupLabel('panel')]);
    assert.equal(active(ui), 'language:en', 'the first match is the highlighted one');
    // The best match is the highlighted one wherever its group is (Enter runs it); the groups keep their order, so nothing jumps.
    await type(box, 'go to team');
    assert.equal(active(ui), 'go:team');
    const order = ui.$$('[role="group"]').map((g) => g.getAttribute('data-group'));
    assert.deepEqual(order, [...order].sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b)), 'the groups stay in their order');
    await type(box, '');
    assert.equal(active(ui), list[0].id);
    await press(box, 'End');
    assert.equal(active(ui), list.at(-1).id);
    await press(box, 'ArrowDown');
    assert.equal(active(ui), list[0].id, 'round from the last to the first');
    await press(box, 'ArrowUp');
    assert.equal(active(ui), list.at(-1).id);
    assert.equal(box.getAttribute('aria-activedescendant'), ui.$('.ab-palette-item.is-active').id);
    await type(box, 'related');
    await press(box, 'Enter');
    assert.deepEqual(ran, ['run:show:related']);
    assert.equal(closed, 1, 'it closes before the tool runs');
  } finally {
    await ui.unmount();
  }
});

test('opened at a group, the arrow keys go on from its first tool; Esc and the close button close it', async () => {
  let closed = 0;
  const ui = await mount(<Sheet section="ticket-assist" onRun={() => {}} onClose={() => closed++} />);
  try {
    const assist = list.filter((c) => c.group === 'ticket-assist');
    assert.equal(active(ui), assist[0].id);
    await press(ui.$('.ab-palette-input'), 'ArrowDown');
    assert.equal(active(ui), assist[1].id);
    await press(ui.$('.ab-palette-input'), 'Escape');
    assert.equal(closed, 1);
    await click(ui.$('.ab-palette-close'));
    assert.equal(closed, 2);
    assert.equal(ui.$('.ab-palette-close').getAttribute('aria-label'), 'Close All tools');
  } finally {
    await ui.unmount();
  }
});

// ---- an action it chose expires (P2.8) ----------------------------------------------------------------------------------------

let held = null;
function LaunchProbe({ ttl }) {
  const [own, setOwn] = useOwnLaunch(ttl);
  held = { own, setOwn };
  return <p>{own ? `waiting: ${own.featureId}` : 'nothing waiting'}</p>;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('an action All tools chose and nothing took is dropped after the time a launch counts', async () => {
  // (A short time to live instead of LAUNCH_TTL_MS's 30 s, with room to spare for a busy machine running every test at once.)
  const TTL = 800;
  const ui = await mount(<LaunchProbe ttl={TTL} />);
  try {
    const launch = makeLaunch({ tabId: 7, table: 'incident', sysId: SYS, featureId: 'show:knownErrors', now: Date.now() });
    await during(async () => held.setOwn(launch));
    assert.match(ui.text(), /waiting: show:knownErrors/);
    await during(() => wait(TTL + 300)); // (the timer fires inside act)
    assert.match(ui.text(), /nothing waiting/);
    // one that is already too old goes at once
    await during(async () => held.setOwn({ ...launch, at: Date.now() - TTL - 1000 }));
    assert.match(ui.text(), /nothing waiting/);
  } finally {
    await ui.unmount();
  }
});
