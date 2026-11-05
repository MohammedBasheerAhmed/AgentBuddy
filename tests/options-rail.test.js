import { mount, click, press, settle, makeChrome, focused } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RailSection } from '../src/options/basics/RailSection.jsx';
import { settingsMenu } from '../src/options/Options.jsx';
import * as railOptions from '../src/options/railOptions.js';
import { MAX_QUICK, RAIL_KINDS, pagePicks, railHasAssist, railKinds, togglePagePick } from '../src/options/railOptions.js';
import { featuresFor } from '../src/features/registry.js';
import { QUICK_DEFAULTS, QUICK_LABELS, isQuickId } from '../src/features/quick.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { setLanguage } from '../src/i18n/index.js';

// Settings > Side rail (docs/focus-layout.md, part C): the rail lists the five of each screen and All tools, so it has nothing left to
// arrange; the section says whether it is drawn at all (railShow, off by default) and, while it is, whether it shows its names
// (railNames). Then the small bar on the ServiceNow page as before: on or off, and up to 4 AI actions per kind (quickPins). The pure
// part first, then the section as drawn, then the section as used (clicks, keys, the focus, what is saved).

const effOf = (settings = {}, policy = {}) => {
  const e = effectiveSettings({ profiles: ['it'], profilesConfirmed: true, ...settings }, policy);
  return { values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey: '', keyLocked: false };
};
const draw = (props) => renderToStaticMarkup(React.createElement(RailSection, props));

// ---- what each kind offers the bar ------------------------------------------------------------------------------------------------

test('the kinds: incident, requested item, catalog task, change, problem, case; HR cases only for someone with the HR profile', () => {
  assert.deepEqual(railKinds(effOf()).map((k) => k.id), ['incident', 'requested_item', 'catalog_task', 'change', 'problem', 'case']);
  const hr = effOf({ profiles: ['it', 'hr'] }, { allowHrContent: true });
  assert.ok(railKinds(hr).some((k) => k.id === 'hr_case'));
  assert.ok(!railKinds(effOf({ profiles: ['it', 'hr'] })).some((k) => k.id === 'hr_case'), 'the HR profile needs the organisation\'s approval');
  for (const k of RAIL_KINDS) assert.ok(k.label && k.many, k.id);
});

test('the per-kind order and hide lists are gone: nothing of them is left to import', () => {
  for (const name of ['railOffer', 'railRows', 'toggleRailItem', 'moveRailItem', 'resetRail', 'actionLabel']) assert.equal(railOptions[name], undefined, name);
  assert.equal(railHasAssist(effOf({}, { aiEnabled: false })), false);
  assert.equal(railHasAssist(effOf({ aiSkipped: true })), true, '"Skip AI for now" still lets the person choose');
});

test('the bar on the ServiceNow page: its suggestions until the person chooses, up to 4, the last one off goes back to the suggestions', () => {
  const eff = effOf();
  const first = pagePicks('incident', eff, {});
  assert.deepEqual(first.chosen, QUICK_DEFAULTS.incident, 'what the bar shows now');
  assert.equal(first.own, false);
  assert.deepEqual(first.items.slice(0, 3).map((p) => p.id), QUICK_DEFAULTS.incident, 'the kind\'s suggestions first');
  for (const p of first.items) assert.ok(isQuickId(p.id) && featuresFor('incident', eff.policy).some((f) => f.id === p.id), p.id);
  assert.ok(first.items.every((p) => p.label === QUICK_LABELS[p.id] && p.icon));
  assert.deepEqual(pagePicks('change', eff, {}).items.slice(0, QUICK_DEFAULTS.change.length).map((p) => p.id), QUICK_DEFAULTS.change, 'a change: its own suggestions first');

  // Turning a suggestion off makes the rest the person's own choice.
  let pins = togglePagePick({ change: ['change-cab-brief'] }, 'incident', first.chosen, 'reply-draft');
  assert.deepEqual(pins, { change: ['change-cab-brief'], incident: ['record-summary', 'resolution-notes'] });
  assert.equal(pagePicks('incident', eff, pins).own, true);
  pins = togglePagePick(pins, 'incident', pagePicks('incident', eff, pins).chosen, 'missing-info');
  pins = togglePagePick(pins, 'incident', pagePicks('incident', eff, pins).chosen, 'handoff-brief');
  assert.equal(pagePicks('incident', eff, pins).chosen.length, MAX_QUICK);
  assert.equal(togglePagePick(pins, 'incident', pagePicks('incident', eff, pins).chosen, 'reply-draft'), pins, 'no fifth');

  // Every one off: the bar goes back to its suggestions (it is never empty).
  let left = pins;
  for (const id of pagePicks('incident', eff, pins).chosen) left = togglePagePick(left, 'incident', pagePicks('incident', eff, left).chosen, id);
  assert.deepEqual(left, { change: ['change-cab-brief'] });

  // A pin the organisation switched off is not shown and not counted; the old Insights pins of the panel's bar are not AI actions.
  const policy = effOf({}, { disabledFeatures: ['resolution-notes'] });
  assert.ok(!pagePicks('incident', policy, {}).items.some((p) => p.id === 'resolution-notes'));
  assert.deepEqual(pagePicks('incident', eff, { incident: ['card:ready', 'reply-draft'] }).chosen, ['reply-draft']);
  assert.deepEqual(pagePicks('incident', effOf({}, { aiEnabled: false }), {}), { items: [], chosen: [], own: false });
});

// ---- the section as drawn --------------------------------------------------------------------------------------------------------

test('the section: the menu entry "Side rail", one switch with its line, no names switch while the rail is off, nothing to arrange', () => {
  assert.ok(settingsMenu('basics', effOf()).some((m) => m.id === 'h-rail' && m.label === 'Side rail' && m.icon === 'command'));
  assert.ok(!settingsMenu('basics', effOf()).some((m) => m.id === 'h-quick'));
  const markup = draw({ eff: effOf(), reload: () => {} });
  assert.match(markup, /<h2[^>]*id="h-rail"[^>]*>Side rail<\/h2>/);
  assert.match(markup, /<p class="ab-sub ab-set-desc" id="rail-show-desc">The five of each screen on the right of the panel, with All tools at its foot\.<\/p>/);
  assert.match(markup, /<input id="rail-show" type="checkbox" role="switch"(?![^>]*checked="")[^>]*aria-describedby="rail-show-desc"/, 'off by default, described by the line');
  assert.match(markup, /<label class="ab-set-switch" for="rail-show"><span class="ab-set-switch-text">Show the side rail<\/span>/);
  assert.ok(!markup.includes('id="rail-names"'), 'no names to show without a rail');
  // What arranged the rail per kind and half is gone.
  for (const gone of ['Which list to arrange', 'Insights for', 'Reset to the suggested order', 'rail-by-state', 'Move ', 'in the rail', 'ab-set-rail-move', 'ab-set-rail-toggle']) {
    assert.ok(!markup.includes(gone), gone);
  }
  // The bar on the ServiceNow page as before, its kinds as tabs over its actions.
  assert.match(markup, /<input id="page-bar" type="checkbox" role="switch"[^>]*checked=""/);
  assert.match(markup, /role="tablist" aria-label="Kind of record"/);
  assert.match(markup, /id="rail-kind-tab-incident"[^>]*aria-selected="true"[^>]*aria-controls="rail-page-panel"[^>]*tabindex="0"/);
  assert.match(markup, /id="rail-kind-tab-change"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(markup, /id="rail-page-panel" role="tabpanel" aria-labelledby="rail-kind-tab-incident"/);
  assert.match(markup, /role="group" aria-labelledby="rail-page-title"/);
  assert.match(markup, /id="rail-page-title">Its actions for incidents \(up to 4\)</);
  const pills = [...markup.matchAll(/<button type="button" class="ab-set-rail-pill" aria-pressed="(true|false)"/g)];
  assert.equal(pills.filter((m) => m[1] === 'true').length, QUICK_DEFAULTS.incident.length);
  assert.match(markup, /Until you choose, the bar shows these suggestions\./);
});

test('as drawn with the rail on: the switch is on and "Show names" sits under it, following railNames', () => {
  const on = draw({ eff: effOf({ railShow: true }), reload: () => {} });
  assert.match(on, /<input id="rail-show" type="checkbox" role="switch"[^>]*checked=""/);
  assert.match(on, /<div class="ab-set-subswitch"><label class="ab-set-switch" for="rail-names"><span class="ab-set-switch-text">Show names<\/span><input id="rail-names" type="checkbox" role="switch"(?![^>]*checked="")/);
  const named = draw({ eff: effOf({ railShow: true, railNames: true }), reload: () => {} });
  assert.match(named, /<input id="rail-names" type="checkbox" role="switch"[^>]*checked=""/);
  // A stored value that is not true is no rail (an old or hand-edited setting).
  assert.match(draw({ eff: effOf({ railShow: 'yes' }), reload: () => {} }), /<input id="rail-show" type="checkbox" role="switch"(?![^>]*checked="")/);
});

test('as drawn: four chosen turn the other pills off', () => {
  const eff = effOf({ quickPins: { incident: ['record-summary', 'reply-draft', 'resolution-notes', 'missing-info'] } });
  const markup = draw({ eff, reload: () => {} });
  const pills = [...markup.matchAll(/<button type="button" class="ab-set-rail-pill" aria-pressed="(true|false)"( disabled="")?/g)];
  assert.equal(pills.filter((m) => m[1] === 'true').length, 4);
  assert.ok(pills.filter((m) => m[1] === 'false').every((m) => m[2]), 'the rest are off once 4 are on');
  assert.match(markup, /The bar holds up to 4\. Turn one off to choose another\./);
  assert.ok(!/Until you choose/.test(markup));
  assert.match(markup, /4 of 4 chosen/);
});

test('as drawn: AI switched off by the organisation, a bar switched off or locked: no actions and no kinds to choose them for', () => {
  const off = draw({ eff: effOf({}, { aiEnabled: false }), reload: () => {} });
  assert.ok(!/ab-set-rail-pill/.test(off));
  assert.ok(!/Kind of record/.test(off));
  assert.match(off, /id="rail-show"/, 'the rail itself does not need AI');
  const bar = draw({ eff: effOf({ pageBar: false }), reload: () => {} });
  assert.match(bar, /<input id="page-bar" type="checkbox" role="switch"(?![^>]*checked="")[^>]*>/);
  assert.ok(!/ab-set-rail-pill/.test(bar));
  assert.ok(!/Kind of record/.test(bar));
  const locked = draw({ eff: effOf({}, { disablePageBar: true }), reload: () => {} });
  assert.match(locked, /<input id="page-bar" type="checkbox" role="switch"[^>]*disabled=""/);
  assert.match(locked, /Switched off by your organisation\./);
  assert.ok(!/ab-set-rail-pill/.test(locked));
});

test('in Arabic the section speaks Arabic', () => {
  try {
    setLanguage('ar');
    const markup = draw({ eff: effOf({ railShow: true }), reload: () => {} });
    for (const english of ['Side rail', 'Show the side rail', 'The five of each screen', 'All tools', 'Show names', 'Kind of record', 'On the ServiceNow page', 'Its actions']) {
      assert.ok(!markup.includes(english), english);
    }
    assert.match(markup, /الشريط الجانبي/);
    assert.ok(!/يمين|يسار/.test(markup), 'the rail is on the left in Arabic: the line names no side');
  } finally {
    setLanguage('en');
  }
});

// ---- the section as used ---------------------------------------------------------------------------------------------------------

// The section on a fake chrome.storage, with a reload that reads the settings back the way the Settings page does.
async function setup(settings = {}, policy = {}) {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  await fake.chrome.storage.local.set({ [SETTINGS_KEY]: { profiles: ['it'], profilesConfirmed: true, ...settings } });
  const saved = async () => (await fake.chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  function Harness() {
    const [eff, setEff] = useState(() => effOf(settings, policy));
    const reload = async () => setEff(effOf(await saved(), policy));
    return <RailSection eff={eff} reload={reload} />;
  }
  const ui = await mount(<Harness />);
  return { ui, saved };
}

test('as used: turn the rail on, then its names; turn it off and the names switch goes (the choice is kept)', async () => {
  const { ui, saved } = await setup();
  assert.equal(ui.$('#rail-names'), null);
  await click(ui.field('Show the side rail'));
  await settle(3);
  assert.equal((await saved()).railShow, true);
  assert.equal(ui.field('Show the side rail').checked, true);
  const names = ui.field('Show names');
  assert.equal(names.checked, false);
  await click(names);
  await settle(3);
  assert.equal((await saved()).railNames, true);
  await click(ui.field('Show the side rail'));
  await settle(3);
  assert.equal((await saved()).railShow, false);
  assert.equal(ui.$('#rail-names'), null, 'no rail, no names to show');
  assert.equal((await saved()).railNames, true, 'the names come back with the rail');
  await ui.unmount();
});

test('as used: the tabs pick the kind (arrow keys too); a pill is saved for that kind only', async () => {
  const { ui, saved } = await setup();
  await press(ui.$('#rail-kind-tab-incident'), 'ArrowRight');
  assert.equal(ui.$('#rail-kind-tab-requested_item').getAttribute('aria-selected'), 'true');
  assert.equal(focused()?.id, 'rail-kind-tab-requested_item');
  await click(ui.tab('Change'));
  assert.match(ui.text(), /Its actions for changes/);
  assert.equal(ui.$('#rail-page-panel').getAttribute('aria-labelledby'), 'rail-kind-tab-change');
  const firstOn = ui.$$('.ab-set-rail-pill').find((b) => b.getAttribute('aria-pressed') === 'true');
  await click(firstOn);
  await settle(3);
  assert.deepEqual(Object.keys((await saved()).quickPins), ['change']);
  await press(ui.$('#rail-kind-tab-change'), 'Home');
  assert.equal(ui.$('#rail-kind-tab-incident').getAttribute('aria-selected'), 'true');
  assert.match(ui.text(), /Its actions for incidents/);
  await ui.unmount();
});

test('as used: the pills choose the bar\'s actions for the kind on show, up to 4; the bar\'s switch saves its choice', async () => {
  const { ui, saved } = await setup();
  const pill = (label) => ui.$$('.ab-set-rail-pill').find((b) => b.textContent === label);
  await click(pill(QUICK_LABELS['missing-info']));
  await settle(3);
  assert.deepEqual((await saved()).quickPins, { incident: [...QUICK_DEFAULTS.incident, 'missing-info'] });
  assert.equal(pill(QUICK_LABELS['missing-info']).getAttribute('aria-pressed'), 'true');
  const off = ui.$$('.ab-set-rail-pill').filter((b) => b.getAttribute('aria-pressed') === 'false');
  assert.ok(off.length > 0 && off.every((b) => b.disabled), 'four on: the rest are off');
  await click(pill(QUICK_LABELS['reply-draft']));
  await settle(3);
  assert.deepEqual((await saved()).quickPins.incident, ['record-summary', 'resolution-notes', 'missing-info']);
  assert.ok(ui.$$('.ab-set-rail-pill').every((b) => !b.disabled));

  await click(ui.field('Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.'));
  await settle(3);
  assert.equal((await saved()).pageBar, false);
  assert.equal(ui.$$('.ab-set-rail-pill').length, 0, 'no bar, no actions to choose');
  await ui.unmount();
});
