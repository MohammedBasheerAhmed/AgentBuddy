import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderSection, PolicySection, PrivacySection, InstancesSection } from '../src/options/Options.jsx';
import { unknownDisabledFeatures, knownFeatureIds, dailyTokenLimit, parseLimit, parseDeployments, EXTRA_FEATURE_IDS, looserThanFloor, allowedProviderIds, hostAccessMode } from '../src/options/policyNotes.js';
import { FEATURES } from '../src/features/registry.js';
import { effectiveSettings, normalizePolicy, PII_MODES, PREVIEW_MODES } from '../src/policy/policy.js';

// The Settings page: the limit that applies, ids in the policy that match no feature, and the provider section as drawn (first
// render only: effects do not run in a static render, and nothing here touches chrome.*).

const eff = (settings = {}, policy = {}, over = {}) => {
  const e = effectiveSettings(settings, policy);
  return { values: e.values, locked: e.locked, floors: e.floors || {}, policy: e.policy, apiKey: '', keyLocked: false, ...over };
};
const draw = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('unknownDisabledFeatures: ids that match no feature, as the policy reads them, once each; real ids and "reports" are known', () => {
  const real = FEATURES[0].id;
  assert.deepEqual(unknownDisabledFeatures([real, real.toUpperCase(), 'reports', 'reply-drafts', ' Reply-Drafts ', 'kb-artcle-draft']), ['reply-drafts', 'kb-artcle-draft']);
  assert.deepEqual(unknownDisabledFeatures([]), []);
  assert.deepEqual(unknownDisabledFeatures(null), []);
  const known = knownFeatureIds();
  for (const f of FEATURES) assert.ok(known.has(f.id.toLowerCase()), f.id);
  for (const id of EXTRA_FEATURE_IDS) assert.ok(known.has(id));
});

test('every id the deployment guide lists for disabledFeatures is one Agent Buddy knows', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'deployment.md'), 'utf8');
  const section = guide.split('### Feature ids')[1]?.split('\n## ')[0] || '';
  // Feature ids have a hyphen ("reply-draft"); "reports" is the one without. Other code words in the section (`true`) are not ids.
  const ids = [...section.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]).filter((id) => id.includes('-') || id === 'reports');
  assert.ok(ids.length > 20, `found ${ids.length}`);
  assert.deepEqual(unknownDisabledFeatures(ids), [], 'the guide names an id Settings would call unknown');
});

test('dailyTokenLimit: the smaller of the organisation\'s and the person\'s own, said in plain words with what is left today', () => {
  assert.deepEqual(dailyTokenLimit({}), { limit: 0, source: 'none', left: null, text: 'No daily token limit applies.' });
  const org = dailyTokenLimit({ policyBudget: 200000, ownCap: 0, usedToday: 50000 });
  assert.equal(org.limit, 200000);
  assert.equal(org.source, 'policy');
  assert.equal(org.left, 150000);
  assert.match(org.text, /^Your organisation's limit applies: 200,000 tokens a day\. Used today: 50,000, 150,000 left\.$/);
  const own = dailyTokenLimit({ policyBudget: 200000, ownCap: 80000, usedToday: 90000 });
  assert.equal(own.limit, 80000);
  assert.equal(own.source, 'own');
  assert.equal(own.left, 0);
  assert.match(own.text, /Your own limit applies: 80,000 tokens a day\. Your organisation allows up to 200,000\./);
  const higher = dailyTokenLimit({ policyBudget: 100000, ownCap: 300000 });
  assert.equal(higher.limit, 100000);
  assert.match(higher.text, /Your own limit \(300,000\) is higher, so your organisation's applies\./);
  assert.equal(dailyTokenLimit({ policyBudget: 5000, ownCap: 5000 }).source, 'policy', 'equal: the one that cannot be changed is named');
});

test('parseLimit and parseDeployments: what a person types into the limit and deployment boxes', () => {
  assert.deepEqual(parseLimit(''), { ok: true, value: 0 });
  assert.deepEqual(parseLimit(' 200,000 '), { ok: true, value: 200000 });
  assert.equal(parseLimit('-5').ok, false);
  assert.equal(parseLimit('1e9').ok, false);
  assert.equal(parseLimit('lots').ok, false);
  assert.deepEqual(parseDeployments('gpt-5-prod, gpt-5-mini-prod gpt-5-prod;bad name'), { ids: ['gpt-5-prod', 'gpt-5-mini-prod', 'bad', 'name'], bad: [] });
  assert.deepEqual(parseDeployments('ok-1, no/slash, <x>'), { ids: ['ok-1'], bad: ['no/slash', '<x>'] });
});

test('a key the organisation supplies is never drawn on the page, and Test connection is still offered', () => {
  const secret = 'sk-org-SUPPLIED-0123456789abcdef';
  // (An organisation key is used only when the policy also pins the provider or the address: src/policy/policy.js.)
  const props = { eff: eff({ provider: 'openai' }, { aiProvider: 'openai', providedApiKey: secret }, { apiKey: secret }), reload: () => {} };
  const markup = draw(ProviderSection, props);
  assert.ok(!markup.includes(secret), 'the key is not in the page');
  assert.ok(!markup.includes('SUPPLIED'));
  assert.ok(!/Show saved key/.test(markup), 'no "Show saved key" for an organisation key');
  assert.ok(!/id="key"/.test(markup), 'no key box');
  assert.match(markup, /provided by your organisation/);
  assert.match(markup, /Test connection/);
});

test('a saved personal key shows only its ends and length until asked; the full key is not in the first draw', () => {
  const key = 'sk-personal-0123456789abcdefXYZW';
  const markup = draw(ProviderSection, { eff: eff({ provider: 'openai' }, {}, { apiKey: key }), reload: () => {} });
  assert.ok(!markup.includes(key));
  assert.ok(!markup.includes('0123456789abcdef'));
});

test('Azure in Settings: resource address, form, deployment, other deployments; no "Load models"; every field has a label', () => {
  const markup = draw(ProviderSection, { eff: eff({ provider: 'azure', baseUrls: { azure: 'https://contoso.openai.azure.com' }, models: { azure: 'gpt-5-prod' } }), reload: () => {} });
  for (const id of ['provider', 'baseurl', 'azure-form', 'model', 'azure-deployments', 'keystorage', 'key']) {
    assert.match(markup, new RegExp(`id="${id}"`), id);
    assert.match(markup, new RegExp(`for="${id}"`), `${id} has a label`);
  }
  assert.ok(!/id="azure-version"/.test(markup), 'the api-version is asked only for the classic form');
  assert.ok(!/load-models/.test(markup), 'Azure gives a key no list of deployments');
  assert.match(markup, /Deployment name/);
  const classic = draw(ProviderSection, { eff: eff({ provider: 'azure', azure: { form: 'deployment' } }), reload: () => {} });
  assert.match(classic, /id="azure-version"/);
  assert.match(classic, /for="azure-version"/);
});

test('the gateway provider says when the address is an Azure one; a wrong address is reported next to the field', () => {
  const azureish = draw(ProviderSection, { eff: eff({ provider: 'openai', baseUrls: { openai: 'https://contoso.openai.azure.com/openai' } }), reload: () => {} });
  assert.match(azureish, /choose the provider &quot;Azure OpenAI&quot;/);
  const bad = draw(ProviderSection, { eff: eff({ provider: 'custom', baseUrls: { custom: 'http://gw.corp.example/v1' } }), reload: () => {} });
  assert.match(bad, /id="baseurl-error"[^>]*role="alert"/);
  assert.match(bad, /aria-invalid="true"/);
  assert.match(bad, /aria-describedby="baseurl-hint baseurl-error"/);
});

test('Settings lists policy ids that match no feature, so an administrator sees a typo', () => {
  const real = FEATURES[0].id;
  const markup = draw(PolicySection, { eff: eff({}, { disabledFeatures: [real, 'reply-drafts'] }) });
  assert.match(markup, /reply-drafts/);
  assert.match(markup, /match(es)? no feature/);
  assert.match(markup, new RegExp(real));
  assert.equal(draw(PolicySection, { eff: eff({}, {}) }), '', 'nothing to say without a policy');
  assert.ok(!/match(es)? no feature/.test(draw(PolicySection, { eff: eff({}, { disabledFeatures: [real] }) })));
});

// The source of the whole Settings page: every file under src/options/, so a section can move between files without a check below
// missing it.
const settingsSource = () => {
  const dir = path.join(__dirname, '..', 'src', 'options');
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => /\.jsx?$/.test(f))
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
};

test('Settings reads the token budget through the policy module, and shows the limit that applies', () => {
  const source = settingsSource();
  assert.match(source, /dailyTokenLimit\(\{ policyBudget: eff\.policy\?\.tokenBudgetPerDay/);
  assert.equal(normalizePolicy({ tokenBudgetPerDay: 1234 }).tokenBudgetPerDay, 1234);
  // Nothing on the page fails silently: every action has a place for its error.
  assert.ok(!/catch \{\s*\}/.test(source), 'no empty catch in Settings');
});

// ---- Policy floors, allowed providers, host access ---------------------------------------------------------------------------

const optionTag = (markup, selectId, value) => {
  const select = markup.split(`id="${selectId}"`)[1]?.split('</select>')[0] || '';
  return (select.match(new RegExp(`<option[^>]*value="${value}"[^>]*>`)) || [''])[0];
};

test("looserThanFloor agrees with the policy module's own order (effectiveSettings raises exactly the looser choices)", () => {
  for (const [setting, modes] of [['piiMode', PII_MODES], ['previewMode', PREVIEW_MODES]]) {
    for (const floor of modes) {
      for (const mode of modes) {
        const raised = effectiveSettings({ [setting]: mode }, { [setting]: floor }).values[setting] !== mode;
        assert.equal(looserThanFloor(setting, mode, floor), raised, `${setting}: ${mode} under the floor ${floor}`);
      }
    }
  }
  assert.equal(looserThanFloor('piiMode', 'standard', ''), false, 'no floor: nothing is looser');
});

test('a policy floor leaves the privacy selects usable: only the looser choices are off, with a note saying the minimum', () => {
  const at = eff({ piiMode: 'standard', previewMode: 'never' }, { piiMode: 'strict', previewMode: 'first' });
  assert.equal(at.values.piiMode, 'strict');
  assert.equal(at.values.previewMode, 'first');
  const markup = draw(PrivacySection, { eff: at, reload: () => {} });
  const piiSelect = markup.split('id="pii"')[0].split('<select').pop() + markup.split('id="pii"')[1].split('>')[0];
  assert.ok(!/disabled/.test(piiSelect), 'the person at the floor can still choose a stricter mode');
  assert.match(optionTag(markup, 'pii', 'standard'), /disabled/);
  assert.ok(!/disabled/.test(optionTag(markup, 'pii', 'strict')));
  assert.ok(!/disabled/.test(optionTag(markup, 'pii', 'local-only')));
  assert.match(markup, /Your organisation requires at least Strict\./);
  assert.match(optionTag(markup, 'preview', 'never'), /disabled/);
  assert.ok(!/disabled/.test(optionTag(markup, 'preview', 'first')));
  assert.ok(!/disabled/.test(optionTag(markup, 'preview', 'always')), 'seeing the text more often is always allowed');
  assert.match(markup, /Your organisation requires at least: Show it the first time for each action\./);

  // A stricter personal choice is kept and shown.
  const above = draw(PrivacySection, { eff: eff({ piiMode: 'local-only', previewMode: 'always' }, { piiMode: 'strict', previewMode: 'first' }), reload: () => {} });
  assert.match(above, /value="local-only" selected=""/);
  assert.match(above, /value="always" selected=""/);
  // Without a policy: nothing is off and no note.
  const free = draw(PrivacySection, { eff: eff({}, {}), reload: () => {} });
  assert.ok(!/requires at least/.test(free));
  assert.ok(!/<option[^>]*disabled/.test(free));
});

test('allowedProviders: only those providers are offered, case does not matter, and unknown ids are simply not offered', () => {
  const ids = ['anthropic', 'openai', 'azure', 'deepseek'];
  assert.deepEqual(allowedProviderIds(ids, { allowedProviders: ['Azure', ' OPENAI ', 'not-a-provider'] }), ['openai', 'azure']);
  assert.deepEqual(allowedProviderIds(ids, {}), ids);
  assert.deepEqual(allowedProviderIds(ids, { allowedProviders: [] }), []);
});

test('Settings shows only the allowed providers, and says plainly when the one chosen before is not allowed', () => {
  const policy = { allowedProviders: ['Anthropic', 'azure'] };
  const e = eff({ provider: 'deepseek' }, policy, { savedProvider: 'deepseek' });
  const markup = draw(ProviderSection, { eff: e, reload: () => {} });
  const options = [...(markup.split('id="provider"')[1].split('</select>')[0].matchAll(/value="([^"]+)"/g))].map((m) => m[1]);
  assert.deepEqual(options, ['anthropic', 'azure']);
  assert.ok(!options.includes('deepseek') && !options.includes('openai'), options.join(','));
  assert.match(markup, /id="provider-note"/);
  assert.match(markup, /Your organisation does not allow DeepSeek, which you chose before\./);
  // The chosen provider is allowed: no note.
  assert.ok(!/provider-note/.test(draw(ProviderSection, { eff: eff({ provider: 'azure' }, policy, { savedProvider: 'azure' }), reload: () => {} })));
  // No provider this version knows: said so.
  assert.match(draw(ProviderSection, { eff: eff({}, { allowedProviders: ['someday-ai'] }, { savedProvider: '' }), reload: () => {} }), /allows no AI provider that this version of Agent Buddy knows/);
});

test('host access: the normal build asks site by site; a build with fixed hosts (enterprise) says the browser does not ask', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(hostAccessMode(manifest), 'prompt');
  assert.equal(hostAccessMode({ host_permissions: ['https://acme.service-now.com/*', 'https://ai-gateway.corp.example/*'] }), 'granted');
  assert.equal(hostAccessMode({}), 'prompt');

  const props = { eff: eff({}, {}), reload: () => {} };
  const real = globalThis.chrome;
  try {
    globalThis.chrome = { runtime: { getManifest: () => manifest } };
    assert.match(draw(InstancesSection, props), /The browser asks you to confirm each one the first time\./);
    globalThis.chrome = { runtime: { getManifest: () => ({ ...manifest, optional_host_permissions: undefined, host_permissions: ['https://acme.service-now.com/*'] }) } };
    const enterprise = draw(InstancesSection, props);
    assert.match(enterprise, /so the browser does not ask/);
    assert.ok(!/asks you to confirm/.test(enterprise));
  } finally {
    globalThis.chrome = real;
  }
  // Nothing in Settings promises a prompt unconditionally any more.
  const source = settingsSource();
  assert.equal((source.match(/asks you to confirm/g) || []).length, 1, 'the one sentence that says so is the normal-build branch');
});
