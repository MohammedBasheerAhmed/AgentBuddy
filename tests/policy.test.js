const test = require('node:test');
const assert = require('node:assert/strict');
import {
  normalizePolicy,
  effectiveSettings,
  isInstanceAllowed,
  isFeatureEnabled,
  isTableAllowed,
  checkProviderAllowed,
  normalizeInstance,
  DEFAULT_SETTINGS,
} from '../src/policy/policy.js';

test('an empty or garbage policy means "nothing pinned"', () => {
  for (const raw of [undefined, null, 'x', 42, {}]) {
    const p = normalizePolicy(raw);
    assert.equal(p.allowedInstances, null);
    assert.equal(p.piiMode, null);
    assert.equal(p.keyStorage, null);
    assert.deepEqual(p.disabledFeatures, []);
    assert.equal(p.allowHrContent, false);
    assert.equal(p.coachingEnabled, false);
    assert.equal(p.disablePageBar, false);
  }
});

test('bad policy values become "not set", never a guess', () => {
  const p = normalizePolicy({ piiMode: 'loose', previewMode: 'sometimes', keyStorage: 'cloud', tokenBudgetPerDay: -4, allowedInstances: 'acme' });
  assert.equal(p.piiMode, null);
  assert.equal(p.previewMode, null);
  assert.equal(p.keyStorage, null);
  assert.equal(p.tokenBudgetPerDay, 0);
  assert.equal(p.allowedInstances, null);
});

test('instances are normalised to https origins', () => {
  assert.equal(normalizeInstance('Acme.service-now.com'), 'https://acme.service-now.com');
  assert.equal(normalizeInstance('https://acme.service-now.com/nav_to.do?uri=x'), 'https://acme.service-now.com');
  assert.equal(normalizeInstance('http://acme.service-now.com'), '');
  assert.equal(normalizeInstance('javascript:alert(1)'), '');
  assert.equal(normalizeInstance(''), '');
});

test('instance allow-list: exact origins and *.wildcards, look-alikes refused', () => {
  const p = normalizePolicy({ allowedInstances: ['acme.service-now.com', '*.corp.example.com'] });
  assert.equal(isInstanceAllowed('https://acme.service-now.com', p), true);
  assert.equal(isInstanceAllowed('https://dev.corp.example.com', p), true);
  assert.equal(isInstanceAllowed('https://acme.service-now.com.evil.test', p), false);
  assert.equal(isInstanceAllowed('https://evil.test/acme.service-now.com', p), false);
  assert.equal(isInstanceAllowed('https://corp.example.com', p), false);
  assert.equal(isInstanceAllowed('http://acme.service-now.com', p), false);
  assert.equal(isInstanceAllowed('https://anything.service-now.com', normalizePolicy({})), true);
});

test('the policy PII mode is a floor, never lowered by the user', () => {
  const a = effectiveSettings({ piiMode: 'standard' }, { piiMode: 'strict' });
  assert.equal(a.values.piiMode, 'strict');
  assert.ok(a.locked.piiMode);
  const b = effectiveSettings({ piiMode: 'local-only' }, { piiMode: 'strict' });
  assert.equal(b.values.piiMode, 'local-only', 'a stricter personal choice is kept');
  assert.equal(b.locked.piiMode, undefined);
  const c = effectiveSettings({ piiMode: 'strict' }, {});
  assert.equal(c.values.piiMode, 'strict');
});

test('policy locks key storage, preview, provider and model', () => {
  const r = effectiveSettings(
    { keyStorage: 'local', previewMode: 'never', provider: 'openai', models: { openai: 'gpt-5' } },
    { keyStorage: 'session', previewMode: 'always', aiProvider: 'anthropic', allowedModels: ['claude-sonnet-5-5'] },
  );
  assert.equal(r.values.keyStorage, 'session');
  assert.equal(r.values.previewMode, 'always');
  assert.equal(r.values.provider, 'anthropic');
  assert.equal(r.values.models.anthropic, 'claude-sonnet-5-5');
  ['keyStorage', 'previewMode', 'provider', 'model'].forEach((k) => assert.ok(r.locked[k], k));
});

test('user settings are used when no policy applies; defaults fill the gaps', () => {
  const r = effectiveSettings({ keyStorage: 'encrypted' }, null);
  assert.equal(r.values.keyStorage, 'encrypted');
  assert.equal(r.values.piiMode, DEFAULT_SETTINGS.piiMode);
  assert.deepEqual(r.locked, {});
});

test('a provided key wins and is flagged when the policy pins where it goes', () => {
  const r = effectiveSettings({}, { providedApiKey: ' sk-org ', aiProvider: 'openai' });
  assert.equal(r.values.providedApiKey, 'sk-org');
  assert.ok(r.locked.apiKey);
  const byAddress = effectiveSettings({}, { providedApiKey: 'sk-org', aiBaseUrl: 'https://gw.corp.example/v1' });
  assert.equal(byAddress.values.providedApiKey, 'sk-org');
});

test('an organisation key is never used with a provider the person picks: no pin, no key', () => {
  for (const policy of [{ providedApiKey: 'sk-org' }, { providedApiKey: 'sk-org', allowedProviders: ['openai'] }, { providedApiKey: 'sk-org', aiProvider: '  ' }]) {
    const r = effectiveSettings({ provider: 'deepseek' }, policy);
    assert.equal(r.values.providedApiKey, '', JSON.stringify(policy));
    assert.equal(r.locked.apiKey, undefined, JSON.stringify(policy));
  }
});

test('user-enabled instances outside the allow-list are dropped', () => {
  const r = effectiveSettings({ instances: ['https://acme.service-now.com', 'https://other.service-now.com'] }, { allowedInstances: ['acme.service-now.com'] });
  assert.deepEqual(r.values.instances, ['https://acme.service-now.com']);
});

test('provider checks follow the policy', () => {
  const p = normalizePolicy({ aiProvider: 'openai', aiBaseUrl: 'https://gw.corp.example/v1/', allowedModels: ['gpt-5-mini'] });
  assert.equal(checkProviderAllowed({ provider: 'anthropic', model: 'x', baseUrl: '' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'gpt-5-mini', baseUrl: 'https://other.example/v1' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'gpt-5', baseUrl: 'https://gw.corp.example/v1' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'gpt-5-mini', baseUrl: 'https://gw.corp.example/v1' }, p).ok, true);
  assert.equal(checkProviderAllowed({ provider: 'anything', model: 'm', baseUrl: '' }, normalizePolicy({})).ok, true);
});

test('feature and table switches', () => {
  const p = normalizePolicy({ disabledFeatures: ['coaching'], blockedTables: ['SN_HR_Core_Case'] });
  assert.equal(isFeatureEnabled('coaching', p), false);
  assert.equal(isFeatureEnabled('record-summary', p), true);
  assert.equal(isTableAllowed('sn_hr_core_case', p), false);
  assert.equal(isTableAllowed('incident', p), true);
});

test('disablePageBar switches the bar on ServiceNow pages off and locks the setting; only true counts', () => {
  assert.equal(normalizePolicy({ disablePageBar: true }).disablePageBar, true);
  for (const junk of ['true', 1, 'yes', null, undefined, {}]) assert.equal(normalizePolicy({ disablePageBar: junk }).disablePageBar, false, String(junk));
  const on = effectiveSettings({ pageBar: true }, { disablePageBar: true });
  assert.equal(on.values.pageBar, false);
  assert.match(on.locked.pageBar, /organisation/);
  const free = effectiveSettings({ pageBar: true }, {});
  assert.equal(free.values.pageBar, true);
  assert.equal(free.locked.pageBar, undefined);
});
