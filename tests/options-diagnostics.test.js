import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { browserName, diagnosticsText } from '../src/options/diagnostics.js';
import { DiagnosticsSection, ProfilesSection, SettingsPages, SITE_REFUSED_TEXT, settingsPageFromHash } from '../src/options/Options.jsx';
import { effectiveSettings } from '../src/policy/policy.js';

// F8 "Copy diagnostics": what support needs, and never a key (not the key, not its preview, not its length). F2: Settings in two pages.

const KEY = 'sk-personal-0123456789abcdefXYZW';
const ORG_KEY = 'sk-org-SUPPLIED-0123456789abcdef';
const effOf = (settings = {}, policy = {}, over = {}) => {
  const e = effectiveSettings(settings, policy);
  return { values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey: '', keyLocked: false, ...over };
};
const manifest = { version: '0.1.0', host_permissions: undefined };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test('the text names the versions, the settings, the policy in short, the sites as hosts and the last problems', () => {
  const eff = effOf(
    { provider: 'openai', models: { openai: 'gpt-5-mini' }, baseUrls: { openai: 'https://gw.corp.example/v1/chat' }, profiles: ['it', 'lead'], profilesConfirmed: true, instances: ['https://acme.service-now.com'] },
    { disabledFeatures: ['coaching-snapshot'], blockedTables: ['sn_hr_core_case'], piiMode: 'strict', internalPhrases: ['Team Falcon'] },
    { apiKey: KEY }
  );
  const audit = [
    { time: '2026-10-30T09:00:00.000Z', feature: 'reply-draft', table: 'incident', outcome: 'sent' },
    { time: '2026-10-30T09:05:00.000Z', feature: 'record-summary', table: 'incident', outcome: 'error', reason: 'RATE_LIMIT' },
    { time: '2026-10-30T09:06:00.000Z', feature: 'record-summary', table: 'sn_hr_core_case', outcome: 'blocked', reason: 'BLOCKED_TABLE' },
  ];
  const text = diagnosticsText({ manifest, userAgent: UA, eff, keyMode: 'local', instances: ['https://acme.service-now.com', 'https://beta.service-now.com/'], audit, now: new Date('2026-10-30T10:00:00Z') });
  assert.match(text, /^Agent Buddy diagnostics\n/);
  assert.match(text, /Version: 0\.1\.0/);
  assert.match(text, /Build: normal/);
  assert.match(text, /Browser: Chrome 130/);
  assert.match(text, /AI provider: openai/);
  assert.match(text, /Model: gpt-5-mini/);
  assert.match(text, /AI address: gw\.corp\.example\n/, 'the address as a host only');
  assert.match(text, /Key: saved \(local\)/);
  assert.match(text, /Privacy: strict/);
  assert.match(text, /Work profiles: it, lead; show everything: no/);
  assert.match(text, /switched-off features coaching-snapshot/);
  assert.match(text, /blocked tables 1/);
  assert.match(text, /internal phrases 1/);
  assert.ok(!text.includes('Team Falcon'), 'phrases that could name teams are counted, not listed');
  assert.match(text, /acme\.service-now\.com, beta\.service-now\.com/);
  assert.match(text, /2026-10-30T09:06:00Z {2}record-summary {2}sn_hr_core_case {2}blocked \(BLOCKED_TABLE\)/);
  assert.match(text, /record-summary {2}incident {2}error \(RATE_LIMIT\)/);
  assert.ok(!/reply-draft/.test(text), 'only problems from the log');
});

test('no key ever: not the person\'s, not the organisation\'s, not a preview or its length, not even one typed into the wrong box', () => {
  const personal = effOf({ provider: 'openai', models: { openai: KEY } }, {}, { apiKey: KEY });
  const org = effOf({ provider: 'openai' }, { aiProvider: 'openai', providedApiKey: ORG_KEY }, { apiKey: ORG_KEY });
  for (const [eff, secret] of [[personal, KEY], [org, ORG_KEY]]) {
    const text = diagnosticsText({ manifest, userAgent: UA, eff, keyMode: 'local', now: new Date('2026-10-30T10:00:00Z') });
    assert.ok(!text.includes(secret), 'the key');
    assert.ok(!text.includes(secret.slice(0, 4) + '…'), 'the preview');
    assert.ok(!text.includes(secret.slice(-4)), 'the end of the key');
    assert.ok(!text.includes(String(secret.length)), 'the length of the key');
  }
  assert.match(diagnosticsText({ eff: org }), /Key: supplied by the organisation/);
  assert.match(diagnosticsText({ eff: org }), /key supplied \(not shown\)/);
  assert.match(diagnosticsText({ eff: personal }), /Model: \[hidden\]/, 'a key pasted as the model name is hidden');
});

test('anything odd in settings or the log is left out rather than copied', () => {
  const eff = effOf({ provider: 'openai', models: { openai: 'gpt 5 <b>' } });
  const text = diagnosticsText({ eff, audit: [{ time: 'x', feature: 'Abel Tuter said hi', table: 'incident', outcome: 'error', reason: 'the caller is Abel' }] });
  assert.match(text, /Model: default/);
  assert.ok(!/Abel/.test(text));
  assert.equal(browserName('Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'), 'Edge 131');
  assert.equal(browserName(''), '');
  assert.match(diagnosticsText({ manifest: { version: '0.1.0', host_permissions: ['https://acme.service-now.com/*'] } }), /Build: enterprise/);
});

// ---- Settings pages --------------------------------------------------------------------------------------------------------------

const draw = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('Settings has two pages, Basics and AI Assist; the address picks the page', () => {
  assert.equal(settingsPageFromHash('#ai'), 'ai');
  assert.equal(settingsPageFromHash('#AI'), 'ai');
  assert.equal(settingsPageFromHash(''), 'basics');
  assert.equal(settingsPageFromHash('#whatever'), 'basics');
  const markup = draw(SettingsPages, { eff: effOf(), reload: () => {}, initial: 'basics' });
  assert.match(markup, /role="tablist"[^>]*aria-label="Settings pages"/);
  assert.match(markup, />Basics</);
  assert.match(markup, />AI Assist</);
  assert.match(markup, /id="ab-settings-panel-ai"[^>]*hidden=""/, 'AI Assist is hidden while Basics shows');
  for (const id of ['h-instances', 'h-profiles', 'h-quick', 'h-privacy', 'h-audit', 'h-stored', 'h-diagnostics']) assert.match(markup, new RegExp(`id="${id}"`), id);
  assert.match(markup, /id="provider"/, 'the AI page is in the page too, hidden');
  const ai = draw(SettingsPages, { eff: effOf(), reload: () => {}, initial: 'ai' });
  assert.match(ai, /id="ab-settings-panel-basics"[^>]*hidden=""/);
});

test('AI switched off by the organisation: the AI page says so and shows no provider, key or model', () => {
  const markup = draw(SettingsPages, { eff: effOf({}, { aiEnabled: false }), reload: () => {}, initial: 'ai' });
  assert.match(markup, /AI is switched off/);
  assert.ok(!/id="provider"/.test(markup));
  assert.ok(!/id="key"/.test(markup));
  assert.ok(!/id="ai-skipped"/.test(markup), 'no "Skip AI" choice either');
});

test('What you work on: tick boxes, Show everything, Skip AI; locked profiles are said, not offered', () => {
  const markup = draw(ProfilesSection, { eff: effOf({ profiles: ['csm'], profilesConfirmed: true }), reload: () => {} });
  assert.match(markup, /id="profile-csm"[^>]*checked=""/);
  assert.match(markup, /id="profile-it"/);
  assert.ok(!/id="profile-hr"/.test(markup), 'HR only where the organisation approved it');
  assert.match(markup, /id="show-everything"/);
  assert.match(markup, /id="ai-skipped"/);
  const locked = draw(ProfilesSection, { eff: effOf({}, { lockedProfiles: ['it', 'req'] }), reload: () => {} });
  assert.match(locked, /Set by your organisation: IT service desk and resolver, Request fulfilment\./);
  assert.ok(!/id="profile-it"/.test(locked));
});

test('a refused site permission says the next step; the diagnostics button is there', () => {
  assert.match(SITE_REFUSED_TEXT, /choose Allow/);
  assert.match(SITE_REFUSED_TEXT, /IT team may block it/);
  assert.match(draw(DiagnosticsSection, { eff: effOf() }), /Copy diagnostics/);
});

import { FollowUpSection, FOLLOW_UP_CHOICES } from '../src/options/Options.jsx';

test('Basics: "Follow-ups due after" offers 2, 3, 5 and 7 days, shows the saved choice, and 3 for anything else', () => {
  assert.deepEqual([...FOLLOW_UP_CHOICES], [2, 3, 5, 7]);
  const five = draw(FollowUpSection, { eff: effOf({ followUpDays: 5 }), reload: () => {} });
  assert.match(five, /<label[^>]*for="follow-up-days"[^>]*>Follow-ups due after<\/label>/);
  assert.deepEqual([...five.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]), ['2', '3', '5', '7']);
  assert.match(five, /<option value="5" selected="">5 days<\/option>/);
  assert.match(draw(FollowUpSection, { eff: effOf({ followUpDays: 40 }), reload: () => {} }), /<option value="3" selected="">/);
  assert.match(draw(SettingsPages, { eff: effOf(), reload: () => {}, initial: 'basics' }), /id="follow-up-days"/, 'on the Basics page');
});
