import { mount, click, press, settle, makeChrome, focused } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RailSection } from '../src/options/basics/RailSection.jsx';
import { settingsMenu } from '../src/options/Options.jsx';
import {
  MAX_QUICK,
  RAIL_KINDS,
  actionLabel,
  moveRailItem,
  pagePicks,
  railHasAssist,
  railKinds,
  railOffer,
  railRows,
  resetRail,
  togglePagePick,
  toggleRailItem,
} from '../src/options/railOptions.js';
import { featureById, featuresFor } from '../src/features/registry.js';
import { QUICK_DEFAULTS, QUICK_LABELS, isQuickId } from '../src/features/quick.js';
import { railPrefsFor } from '../src/features/railLayout.js';
import { profilesOfFeature, shownFor } from '../src/profiles/profiles.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';
import { setLanguage } from '../src/i18n/index.js';

// Settings > Side rail (docs/rail-layout.md, part C): per kind of record and half, hide items and change their order (railLayout), the
// "what fits the state first" switch (railByState), and the small bar on the ServiceNow page: on or off, and up to 4 AI actions per
// kind (quickPins). The pure part first, then the section as drawn, then the section as used (clicks, keys, the focus, what is saved).

const effOf = (settings = {}, policy = {}) => {
  const e = effectiveSettings({ profiles: ['it'], profilesConfirmed: true, ...settings }, policy);
  return { values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey: '', keyLocked: false };
};
const draw = (props) => renderToStaticMarkup(React.createElement(RailSection, props));

// ---- what each kind offers -----------------------------------------------------------------------------------------------------

test('the kinds: incident, requested item, catalog task, change, problem, case; HR cases only for someone with the HR profile', () => {
  assert.deepEqual(railKinds(effOf()).map((k) => k.id), ['incident', 'requested_item', 'catalog_task', 'change', 'problem', 'case']);
  const hr = effOf({ profiles: ['it', 'hr'] }, { allowHrContent: true });
  assert.ok(railKinds(hr).some((k) => k.id === 'hr_case'));
  assert.ok(!railKinds(effOf({ profiles: ['it', 'hr'] })).some((k) => k.id === 'hr_case'), 'the HR profile needs the organisation\'s approval');
  for (const k of RAIL_KINDS) assert.ok(k.label && k.many, k.id);
});

test('AI Assist side: the kind\'s AI actions minus the policy and other work profiles, the kind\'s suggestions first; short labels', () => {
  const eff = effOf();
  const offer = railOffer('incident', 'assist', eff);
  const expected = featuresFor('incident', eff.policy).filter((f) => shownFor(profilesOfFeature(f), eff)).map((f) => f.id);
  assert.deepEqual([...offer.map((o) => o.id)].sort(), [...expected].sort());
  assert.deepEqual(offer.slice(0, QUICK_DEFAULTS.incident.length).map((o) => o.id), QUICK_DEFAULTS.incident, 'what fits an incident first');
  for (const o of offer) {
    const f = featureById(o.id);
    assert.equal(o.label, isQuickId(o.id) ? QUICK_LABELS[o.id] : f.title, o.id);
    assert.ok(o.icon, o.id);
  }
  assert.equal(actionLabel(featureById('record-summary')), QUICK_LABELS['record-summary']);

  // Without "what fits the state first": the order of the actions list.
  const plain = railOffer('incident', 'assist', effOf({ railByState: false })).map((o) => o.id);
  assert.deepEqual(plain, featuresFor('incident', eff.policy).filter((f) => shownFor(profilesOfFeature(f), eff)).map((f) => f.id));

  // The organisation's policy and the person's profiles.
  assert.ok(!railOffer('incident', 'assist', effOf({}, { disabledFeatures: ['reply-draft'] })).some((o) => o.id === 'reply-draft'));
  assert.ok(!railOffer('problem', 'assist', eff).some((o) => o.id === 'problem-rca'), 'a major-incident action is not for an IT person');
  assert.ok(railOffer('problem', 'assist', effOf({ profiles: ['it', 'mpc'] })).some((o) => o.id === 'problem-rca'));
  assert.deepEqual(railOffer('change', 'assist', effOf({ profiles: ['it', 'mpc'] })).slice(0, 3).map((o) => o.id), QUICK_DEFAULTS.change, 'a change: its own suggestions first');

  // AI switched off by the organisation: no AI Assist side at all ("Skip AI for now" still lets the person arrange it).
  assert.equal(railHasAssist(effOf({}, { aiEnabled: false })), false);
  assert.deepEqual(railOffer('incident', 'assist', effOf({}, { aiEnabled: false })), []);
  assert.ok(railOffer('incident', 'assist', effOf({ aiSkipped: true })).length > 0);
});

test('Insights side: the kind\'s cards for the person\'s profiles', () => {
  const ids = railOffer('incident', 'insights', effOf()).map((o) => o.id);
  assert.ok(ids.includes('related') && ids.includes('resolve') && ids.includes('outage'));
  assert.ok(!ids.includes('account') && !ids.includes('request'));
  assert.ok(railOffer('requested_item', 'insights', effOf({ profiles: ['req'] })).some((o) => o.id === 'checklist'));
});

// ---- the changes it saves --------------------------------------------------------------------------------------------------------

test('hide, move and reset build a new railLayout for one kind and half, and leave the rest as it was', () => {
  const eff = effOf();
  const other = { change: { insights: { order: ['journey'], hidden: [] } } };
  const ids = railRows('incident', 'insights', eff, other).rows.map((r) => r.id);

  // Hiding keeps the suggested order: the others are not frozen in place by it.
  const hidden = toggleRailItem(other, 'incident', 'insights', 'email');
  assert.deepEqual(railPrefsFor(hidden, 'incident', 'insights'), { order: [], hidden: ['email'], arranged: true });
  assert.deepEqual(hidden.change, other.change);
  assert.deepEqual(other, { change: { insights: { order: ['journey'], hidden: [] } } }, 'the stored layout is never changed in place');
  const rows = railRows('incident', 'insights', eff, hidden);
  assert.deepEqual(rows.rows.map((r) => r.id), ids, 'a hidden item keeps its place in Settings');
  assert.equal(rows.rows.find((r) => r.id === 'email').hidden, true);
  assert.equal(rows.shown, ids.length - 1);
  assert.equal(railRows('incident', 'insights', eff, toggleRailItem(hidden, 'incident', 'insights', 'email')).rows.find((r) => r.id === 'email').hidden, false);

  // Moving saves the whole list as it now stands.
  const moved = moveRailItem(hidden, 'incident', 'insights', ids, ids[2], -1);
  const want = [...ids];
  [want[1], want[2]] = [want[2], want[1]];
  assert.deepEqual(railPrefsFor(moved, 'incident', 'insights').order, want);
  assert.deepEqual(railPrefsFor(moved, 'incident', 'insights').hidden, ['email'], 'the hidden items stay hidden');
  assert.deepEqual(railRows('incident', 'insights', eff, moved).rows.map((r) => r.id), want);

  // The first cannot go up, the last cannot go down: nothing changes.
  assert.deepEqual(moveRailItem(hidden, 'incident', 'insights', ids, ids[0], -1), hidden);
  assert.deepEqual(moveRailItem(hidden, 'incident', 'insights', ids, ids[ids.length - 1], 1), hidden);

  // An id of the saved order the list does not show (another profile's card) keeps its place after the list.
  const withForeign = { incident: { insights: { order: ['account', ids[1]], hidden: [] } } };
  assert.deepEqual(railPrefsFor(moveRailItem(withForeign, 'incident', 'insights', railRows('incident', 'insights', eff, withForeign).rows.map((r) => r.id), ids[0], 1), 'incident', 'insights').order.slice(-1), ['account']);

  // Reset: that kind and half back to the suggestions; the rest stays.
  const reset = resetRail(moved, 'incident', 'insights');
  assert.deepEqual(reset, other);
  assert.equal(railRows('incident', 'insights', eff, reset).arranged, false);
  assert.equal(railRows('incident', 'insights', eff, moved).arranged, true);
});

test('the bar on the ServiceNow page: its suggestions until the person chooses, up to 4, the last one off goes back to the suggestions', () => {
  const eff = effOf();
  const first = pagePicks('incident', eff, {});
  assert.deepEqual(first.chosen, QUICK_DEFAULTS.incident, 'what the bar shows now');
  assert.equal(first.own, false);
  assert.deepEqual(first.items.slice(0, 3).map((p) => p.id), QUICK_DEFAULTS.incident);
  for (const p of first.items) assert.ok(isQuickId(p.id) && featuresFor('incident', eff.policy).some((f) => f.id === p.id), p.id);
  assert.ok(first.items.every((p) => p.label === QUICK_LABELS[p.id]));

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

test('the section: a menu entry "Side rail", two rows of tabs, one row per item with a named switch and Move up / Move down', () => {
  assert.ok(settingsMenu('basics', effOf()).some((m) => m.id === 'h-rail' && m.label === 'Side rail' && m.icon === 'command'));
  assert.ok(!settingsMenu('basics', effOf()).some((m) => m.id === 'h-quick'));
  const eff = effOf();
  const markup = draw({ eff, reload: () => {} });
  assert.match(markup, /<h2[^>]*id="h-rail"[^>]*>Side rail<\/h2>/);
  assert.match(markup, /The rail on the right of the Ticket screen lists everything Insights or AI Assist offers/);
  assert.match(markup, /role="tablist" aria-label="Kind of record"/);
  assert.match(markup, /role="tablist" aria-label="Which list to arrange"/);
  assert.match(markup, /id="rail-kind-tab-incident"[^>]*aria-selected="true"[^>]*aria-controls="rail-set-panel"[^>]*tabindex="0"/);
  assert.match(markup, /id="rail-kind-tab-change"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
  assert.match(markup, /id="rail-set-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="rail-set-title"/);
  assert.match(markup, /<h3[^>]*id="rail-set-title"[^>]*>Insights for incidents<\/h3>/);

  const { rows } = railRows('incident', 'insights', eff, {});
  assert.match(markup, new RegExp(`${rows.length} of ${rows.length} shown`));
  const switches = [...markup.matchAll(/<button type="button" role="switch" aria-checked="(true|false)" aria-label="([^"]+)"/g)];
  assert.deepEqual(switches.map((m) => m[2]), rows.map((r) => `Show ${r.label} in the rail`));
  assert.ok(switches.every((m) => m[1] === 'true'));
  const ups = [...markup.matchAll(/<button type="button" class="ab-set-rail-move" aria-label="Move ([^"]+) up"[^>]*?( disabled="")?>/g)];
  const downs = [...markup.matchAll(/<button type="button" class="ab-set-rail-move" aria-label="Move ([^"]+) down"[^>]*?( disabled="")?>/g)];
  assert.equal(ups.length, rows.length);
  assert.deepEqual(ups.map((m) => Boolean(m[2])), rows.map((r, i) => i === 0), 'only the first cannot go up');
  assert.deepEqual(downs.map((m) => Boolean(m[2])), rows.map((r, i) => i === rows.length - 1), 'only the last cannot go down');
  assert.match(markup, /<button type="button" class="ab-btn ab-btn-sm" disabled="">Reset to the suggested order<\/button>/, 'nothing to reset yet');

  assert.match(markup, /<input id="rail-by-state" type="checkbox" role="switch"[^>]*checked=""/);
  assert.match(markup, /<input id="page-bar" type="checkbox" role="switch"[^>]*checked=""/);
  assert.ok(!/panel-bar|Keep the bar open/.test(markup), 'the panel has no quick-actions bar any more');
  assert.match(markup, /role="group" aria-labelledby="rail-page-title"/);
  assert.match(markup, /id="rail-page-title">Its actions for incidents \(up to 4\)</);
  const pills = [...markup.matchAll(/<button type="button" class="ab-set-rail-pill" aria-pressed="(true|false)"/g)];
  assert.equal(pills.filter((m) => m[1] === 'true').length, QUICK_DEFAULTS.incident.length);
  assert.match(markup, /Until you choose, the bar shows these suggestions\./);
});

test('as drawn: a hidden item is off and counted out; an arranged kind can be reset; four chosen turn the other pills off', () => {
  const eff = effOf({
    railLayout: { incident: { insights: { order: [], hidden: ['email', 'journey'] } } },
    quickPins: { incident: ['record-summary', 'reply-draft', 'resolution-notes', 'missing-info'] },
  });
  const markup = draw({ eff, reload: () => {} });
  const { rows } = railRows('incident', 'insights', eff, eff.values.railLayout);
  assert.match(markup, new RegExp(`${rows.length - 2} of ${rows.length} shown`));
  assert.match(markup, /aria-checked="false" aria-label="Show Which email fits in the rail"/);
  assert.match(markup, /<button type="button" class="ab-btn ab-btn-sm">Reset to the suggested order<\/button>/);
  const pills = [...markup.matchAll(/<button type="button" class="ab-set-rail-pill" aria-pressed="(true|false)"( disabled="")?/g)];
  assert.equal(pills.filter((m) => m[1] === 'true').length, 4);
  assert.ok(pills.filter((m) => m[1] === 'false').every((m) => m[2]), 'the rest are off once 4 are on');
  assert.match(markup, /The bar holds up to 4\. Turn one off to choose another\./);
  assert.ok(!/Until you choose/.test(markup));
});

test('as drawn: AI switched off by the organisation leaves Insights only; a bar switched off or locked shows no actions', () => {
  const off = draw({ eff: effOf({}, { aiEnabled: false }), reload: () => {} });
  assert.ok(!/Which list to arrange/.test(off));
  assert.ok(!/rail-by-state/.test(off));
  assert.ok(!/ab-set-rail-pill/.test(off));
  assert.match(off, /Insights for incidents/);
  const bar = draw({ eff: effOf({ pageBar: false }), reload: () => {} });
  assert.match(bar, /<input id="page-bar" type="checkbox" role="switch"(?![^>]*checked="")[^>]*>/);
  assert.ok(!/ab-set-rail-pill/.test(bar));
  const locked = draw({ eff: effOf({}, { disablePageBar: true }), reload: () => {} });
  assert.match(locked, /<input id="page-bar" type="checkbox" role="switch"[^>]*disabled=""/);
  assert.match(locked, /Switched off by your organisation\./);
  assert.ok(!/ab-set-rail-pill/.test(locked));
});

test('in Arabic the section speaks Arabic', () => {
  try {
    setLanguage('ar');
    const markup = draw({ eff: effOf(), reload: () => {} });
    for (const english of ['Side rail', 'Kind of record', 'Insights for', 'Reset to the suggested order', 'On the ServiceNow page', 'in the rail', 'Move ']) {
      assert.ok(!markup.includes(english), english);
    }
    assert.match(markup, /الشريط الجانبي/);
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

const names = (ui) => ui.$$('.ab-set-rail-name').map((el) => el.textContent);
const switchFor = (ui, label) => ui.$(`[role="switch"][aria-label="Show ${label} in the rail"]`);
const moveButton = (ui, label, way) => ui.$(`button[aria-label="Move ${label} ${way}"]`);

test('as used: hide an item, move one down and up again (the focus stays on the row), reset; each is saved at once', async () => {
  const { ui, saved } = await setup();
  const before = names(ui);
  assert.ok(before.length > 3);

  const ids = railRows('incident', 'insights', effOf(), {}).rows.map((r) => r.id);
  await click(switchFor(ui, before[1]));
  await settle(3);
  assert.deepEqual((await saved()).railLayout, { incident: { insights: { order: [], hidden: [ids[1]] } } });
  assert.equal(switchFor(ui, before[1]).getAttribute('aria-checked'), 'false');
  assert.match(ui.text(), new RegExp(`${before.length - 1} of ${before.length} shown`));

  // Two moves down in a row (the second builds on the first even before the settings are read again).
  const first = moveButton(ui, before[0], 'down');
  first.focus();
  await click(first);
  await click(moveButton(ui, before[0], 'down'));
  await settle(3);
  assert.deepEqual(names(ui).slice(0, 3), [before[1], before[2], before[0]]);
  const base = railRows('incident', 'insights', effOf(), {}).rows.map((r) => r.id);
  const order = (await saved()).railLayout.incident.insights.order;
  assert.deepEqual(order, [base[1], base[2], base[0], ...base.slice(3)]);
  assert.equal(focused()?.getAttribute('aria-label'), `Move ${before[0]} down`, 'the focus stays on the button pressed');

  // Up to the top: its Move up is off there, so the focus goes to its Move down.
  await click(moveButton(ui, before[0], 'up'));
  await click(moveButton(ui, before[0], 'up'));
  await settle(3);
  assert.equal(names(ui)[0], before[0]);
  assert.equal(moveButton(ui, before[0], 'up').disabled, true);
  assert.equal(focused()?.getAttribute('aria-label'), `Move ${before[0]} down`);

  await click(ui.button('Reset to the suggested order'));
  await settle(3);
  assert.deepEqual((await saved()).railLayout, {});
  assert.deepEqual(names(ui), before);
  assert.equal(switchFor(ui, before[1]).getAttribute('aria-checked'), 'true');
  assert.equal(ui.button('Reset to the suggested order').disabled, true);
  await ui.unmount();
});

test('as used: the tabs pick the kind and the half (arrow keys too); a change is saved for that kind and half only', async () => {
  const { ui, saved } = await setup();
  await press(ui.$('#rail-kind-tab-incident'), 'ArrowRight');
  assert.equal(ui.$('#rail-kind-tab-requested_item').getAttribute('aria-selected'), 'true');
  assert.equal(focused()?.id, 'rail-kind-tab-requested_item');
  await click(ui.tab('Change'));
  await click(ui.tab('AI Assist'));
  assert.match(ui.text(), /AI Assist for changes/);
  const first = names(ui)[0];
  await click(switchFor(ui, first));
  await settle(3);
  const layout = (await saved()).railLayout;
  assert.deepEqual(Object.keys(layout), ['change']);
  assert.deepEqual(Object.keys(layout.change), ['assist']);
  assert.equal(layout.change.assist.hidden.length, 1);
  await press(ui.$('#rail-half-tab-assist'), 'Home');
  assert.equal(ui.$('#rail-half-tab-insights').getAttribute('aria-selected'), 'true');
  assert.match(ui.text(), /Insights for changes/);
  await ui.unmount();
});

test('as used: the pills choose the bar\'s actions for the kind on show, up to 4; the switches save their choice', async () => {
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

  await click(ui.field("When I have not arranged a kind, put what fits the ticket's state first."));
  await settle(3);
  assert.equal((await saved()).railByState, false);
  await click(ui.field('Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.'));
  await settle(3);
  assert.equal((await saved()).pageBar, false);
  assert.equal(ui.$$('.ab-set-rail-pill').length, 0, 'no bar, no actions to choose');
  await ui.unmount();
});
