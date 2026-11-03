// The format editor as a person uses it (R11): in Settings > AI Assist and under an action in the side panel. Sections are named, moved,
// added and removed; the choice is saved to the person's settings; an organisation's locked format can be read and not changed.
import { mount, click, type, choose, settle, makeChrome, fakeClipboard } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { FormatsSection } from '../src/options/FormatsSection.jsx';
import { ActionGroups } from '../src/sidepanel/ticket/assist/actions/index.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';

const A = 'a'.repeat(32);
const rec = { kind: 'incident', table: 'incident', sysId: A, number: 'INC0010001' };
const head = { number: 'INC0010001', short_description: 'VPN', state: 'In Progress', priority: '3 - Moderate' };
const page = { tabId: 7, href: `https://x.service-now.com/incident.do?sys_id=${A}`, surface: 'classic', record: rec };

const setup = (user = {}, policy = {}) => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const eff = { ...effectiveSettings({ provider: 'openai', models: { openai: 'm' }, profiles: ['it'], profilesConfirmed: true, quickPins: {}, ...user }, policy), ready: true, apiKey: 'k' };
  return { fake, eff };
};
// The Settings section as the page keeps it: after a save, `reload` reads the settings again, so the section sees what was saved.
function Live({ fake, policy = {} }) {
  const [, again] = React.useState(0);
  const user = { provider: 'openai', models: { openai: 'm' }, profiles: ['it'], profilesConfirmed: true, ...(fake.chrome.storage.local.data[SETTINGS_KEY] || {}) };
  const eff = { ...effectiveSettings(user, policy), ready: true, apiKey: 'k' };
  return <FormatsSection eff={eff} reload={() => again((n) => n + 1)} />;
}
const stored = (fake) => fake.chrome.storage.local.data[SETTINGS_KEY]?.formats;
const open = async (ui, title) => {
  const item = ui.$$('details.ab-fmt-item', { all: true }).find((d) => d.querySelector('.ab-fmt-title')?.textContent === title);
  if (!item) throw new Error(`no item ${title}`);
  item.setAttribute('open', '');
  await settle();
  return item;
};

test('Settings lists every action whose format can change, the layouts first, each shut until opened', async () => {
  const { eff } = setup();
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const titles = ui.$$('.ab-fmt-title', { all: true }).map((e) => e.textContent);
  assert.ok(titles.length >= 15, titles.join(', '));
  assert.deepEqual(titles.slice(0, 3), ['Summarise this ticket', 'Write a hand-off brief', 'Catch up on the discussion']);
  assert.ok(titles.includes('Draft a reply to the customer'));
  assert.equal(ui.$$('.ab-fmt-state', { all: true }).length, 0, 'nothing is marked while nobody changed anything');
  await ui.unmount();
});

test('an action the organisation switched off is not listed', async () => {
  const { eff } = setup({}, { disabledFeatures: ['handoff-brief'] });
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const titles = ui.$$('.ab-fmt-title', { all: true }).map((e) => e.textContent);
  assert.ok(!titles.includes('Write a hand-off brief'));
  assert.ok(titles.includes('Summarise this ticket'));
  await ui.unmount();
});

test('naming the sections of the summary: edit, add, move, remove, save; the settings then hold the format', async () => {
  const { fake, eff } = setup();
  let reloads = 0;
  const ui = await mount(<FormatsSection eff={eff} reload={() => reloads++} />);
  const item = await open(ui, 'Summarise this ticket');
  const rows = () => [...item.querySelectorAll('.ab-fmt-row')];
  assert.equal(rows().length, 5, 'the five standard sections');
  const save = () => ui.button('Save format', { all: true });
  assert.ok(save().disabled, 'nothing to save yet');

  // rename "Done so far" and give it a hint
  await type(rows()[2].querySelectorAll('input')[0], 'Key actions performed');
  await type(rows()[2].querySelectorAll('input')[1], 'what was done, in order');
  assert.ok(!save().disabled);
  // drop "Impact", move "Next step" up one, add a section
  await click(rows()[1].querySelectorAll('button').find((b) => /^Remove section/.test(b.getAttribute('aria-label'))));
  assert.equal(rows().length, 4);
  await click(rows()[3].querySelectorAll('button').find((b) => /^Move section 4 up/.test(b.getAttribute('aria-label'))));
  await click(item.querySelector('[data-add]'));
  assert.equal(rows().length, 5);
  await type(rows()[4].querySelectorAll('input')[0], 'Outcome');
  await click(save());

  const f = stored(fake)['record-summary'];
  assert.deepEqual(f.sections.map((s) => s.name), ['Issue', 'Key actions performed', 'Next step', 'Current state', 'Outcome']);
  assert.equal(f.sections[1].hint, 'what was done, in order');
  assert.ok(reloads >= 1, 'the page was told to read the settings again');
  assert.match(ui.text(), /Saved\. The next answer uses this format\./);
  await ui.unmount();
});

test('a duplicate name or no section at all can not be saved, and says why', async () => {
  const { eff } = setup();
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const item = await open(ui, 'Summarise this ticket');
  const rows = () => [...item.querySelectorAll('.ab-fmt-row')];
  await type(rows()[1].querySelectorAll('input')[0], 'issue');
  assert.ok(ui.button('Save format', { all: true }).disabled);
  assert.match(ui.text(), /Two sections have the same name/);
  await type(rows()[1].querySelectorAll('input')[0], 'Impact');
  for (let i = 0; i < 5; i += 1) await click(rows()[0].querySelectorAll('button').find((b) => /^Remove section/.test(b.getAttribute('aria-label'))));
  assert.equal(rows().length, 0);
  assert.match(ui.text(), /Add at least one section/);
  assert.ok(ui.button('Save format', { all: true }).disabled);
  await ui.unmount();
});

test('the length has to be between 30 and 500 words', async () => {
  const { eff } = setup();
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const item = await open(ui, 'Summarise this ticket');
  const words = item.querySelector('input[type="number"]');
  await type(words, '12');
  assert.ok(ui.button('Save format', { all: true }).disabled);
  assert.match(ui.text(), /between 30 and 500 words/);
  await type(words, '60');
  assert.ok(!ui.button('Save format', { all: true }).disabled);
  await ui.unmount();
});

test('an action that only takes extra instructions shows just the box; saving and using the standard format again', async () => {
  const { fake } = setup();
  const ui = await mount(<Live fake={fake} />);
  const item = await open(ui, 'Draft a reply to the customer');
  assert.equal(item.querySelectorAll('.ab-fmt-row').length, 0, 'no sections to name');
  assert.match(ui.text(), /The customer reads this text/);
  await type(item.querySelector('textarea'), 'Use plain words.');
  const inItem = (label) => [...item.querySelectorAll('button')].find((b) => b.textContent === label);
  await click(inItem('Save format'));
  assert.deepEqual(stored(fake), { 'reply-draft': { extra: 'Use plain words.' } });
  await click(inItem('Use the standard format'));
  assert.deepEqual(stored(fake), {});
  await ui.unmount();
});

test('"Show the instructions this sends" holds the real text, with the rules and the extra instructions', async () => {
  const { eff } = setup({ formats: { 'record-summary': { sections: [{ name: 'Issue' }, { name: 'Outcome', hint: 'how it ended' }], extra: 'Use plain words.' } } });
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const item = await open(ui, 'Summarise this ticket');
  const text = item.querySelector('pre').textContent;
  assert.match(text, /exactly these two lines/);
  assert.match(text, /Outcome: how it ended\./);
  assert.match(text, /use only facts in the ticket data/);
  assert.match(text, /Use plain words\./);
  assert.match(ui.text(), /Your format/);
  await ui.unmount();
});

test('an organisation\'s locked format can be read and not changed; its standard one can be replaced by your own', async () => {
  const { fake, eff } = setup({}, { orgFormats: [{ feature: 'record-summary', words: 60, locked: true }, { feature: 'reply-draft', extra: 'Sign off as the Service Desk.' }] });
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const locked = await open(ui, 'Summarise this ticket');
  assert.match(locked.textContent, /Set by your organisation/);
  assert.ok(locked.querySelector('input[type="number"]').disabled);
  assert.equal(locked.querySelector('input[type="number"]').value, '60');
  assert.ok(![...locked.querySelectorAll('button')].some((b) => b.textContent === 'Save format'), 'no Save on a locked format');
  assert.ok(locked.querySelector('pre').textContent.includes('at most 60 words'));

  const standard = await open(ui, 'Draft a reply to the customer');
  assert.match(standard.textContent, /This is your organisation's format/);
  assert.equal(standard.querySelector('textarea').value, 'Sign off as the Service Desk.');
  await type(standard.querySelector('textarea'), 'Sign off as the IT team.');
  await click([...standard.querySelectorAll('button')].find((b) => b.textContent === 'Save format'));
  assert.deepEqual(stored(fake), { 'reply-draft': { extra: 'Sign off as the IT team.' } });
  await ui.unmount();
});

test('"Copy for your administrator" puts the policy entry on the clipboard', async () => {
  const { eff } = setup();
  const copied = fakeClipboard();
  const ui = await mount(<FormatsSection eff={eff} reload={() => {}} />);
  const item = await open(ui, 'Summarise this ticket');
  await type(item.querySelector('input[type="number"]'), '90');
  await click([...item.querySelectorAll('button')].find((b) => b.textContent === 'Copy for your administrator'));
  assert.equal(copied.length, 1);
  assert.deepEqual(JSON.parse(copied[0]), { feature: 'record-summary', words: 90 });
  assert.match(ui.text(), /Your administrator can add it to the orgFormats list/);
  await ui.unmount();
});

// ---- in the side panel -----------------------------------------------------------------------------------------------------------

test('under an action in the panel: "Change format" opens the same editor and never runs the action', async () => {
  const { fake, eff } = setup();
  const ran = [];
  const ui = await mount(<ActionGroups page={page} eff={eff} record={rec} header={head} aiReady onRun={(f) => ran.push(f.id)} />);
  const toggles = ui.$$('button').filter((b) => b.textContent === 'Change format');
  assert.ok(toggles.length >= 2, 'a toggle under each action that can be laid out');
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
  await click(toggles[0]);
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'true');
  assert.ok(ui.$('.ab-fmt'), 'the editor is open in place');
  assert.deepEqual(ran, [], 'opening it did not start an action');

  await type(ui.$('textarea.ab-fmt-extra'), 'Keep it short.');
  await click(ui.button('Save format'));
  assert.ok(Object.values(stored(fake))[0].extra === 'Keep it short.', JSON.stringify(stored(fake)));
  await click(toggles[0]);
  assert.equal(ui.$('.ab-fmt'), null, 'shut again');
  await ui.unmount();
});

test('in the panel an action with its own format is marked, and a locked one says so', async () => {
  const { eff } = setup({ formats: { 'reply-draft': { extra: 'Be brief.' } } }, { orgFormats: [{ feature: 'record-summary', words: 60, locked: true }] });
  const ui = await mount(<ActionGroups page={page} eff={eff} record={rec} header={head} aiReady onRun={() => {}} />);
  const text = ui.text();
  assert.match(text, /Your format/);
  assert.match(text, /Set by your organisation/);
  assert.ok(ui.hasButton('See format'), 'a locked format is read, not changed');
  await ui.unmount();
});
