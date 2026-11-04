const test = require('node:test');
const assert = require('node:assert/strict');
import { assertRunnable, RunBlocked } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy, effectiveSettings, checkProviderAllowed } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { aiNeeds, aiNeedsText, isAiReady } from '../src/sidepanel/aiReady.js';

// Three ways the organisation's policy and a run used to disagree:
//   AI switched off (aiEnabled: false) only hid buttons, and a run that still got there was sent (AI_OFF);
//   a model the policy allows that is not on the provider's own list was swapped for the default, then refused, so no call could
//   ever be made;
//   an AI address in the policy that is not valid was reported as "The AI address is not valid", which sends the person to a field
//   they cannot change, instead of "ask your administrator".

const PACK = { table: 'incident', sysId: 'a'.repeat(32), fields: { short_description: 'VPN fails' }, people: [], journal: [], related: {}, access: [] };
const runFor = (settings, policyRaw, key = 'sk-ant-test') => {
  const eff = effectiveSettings(settings, policyRaw);
  const config = resolveProviderConfig(eff.values, key);
  return () => assertRunnable({ feature: featureById('record-summary'), pack: PACK, values: eff.values, policy: eff.policy, config });
};
const panelEff = (settings, policyRaw, over = {}) => {
  const e = effectiveSettings(settings, policyRaw);
  return { values: e.values, policy: e.policy, locked: e.locked, apiKey: 'sk-ant-test', keyLocked: false, ...over };
};

test('AI switched off by the organisation: every run is refused with AI_OFF, first, in plain words', () => {
  assert.throws(runFor({ provider: 'anthropic' }, { aiEnabled: false }), (e) => e instanceof RunBlocked && e.code === 'AI_OFF' && e.message === 'Your organisation has switched AI Assist off.');
  // Before anything else the run could be refused for (here: the feature is off too, and there is no key).
  assert.throws(runFor({ provider: 'anthropic' }, { aiEnabled: false, disabledFeatures: ['record-summary'] }, ''), (e) => e.code === 'AI_OFF');
  // A local model is no way round it.
  assert.throws(runFor({ provider: 'ollama' }, { aiEnabled: false }, ''), (e) => e.code === 'AI_OFF');
  // AI on (the default, or said so) runs as before.
  assert.doesNotThrow(runFor({ provider: 'anthropic' }, {}));
  assert.doesNotThrow(runFor({ provider: 'anthropic' }, { aiEnabled: true }));
  // A raw policy object (not normalised) is read the same way.
  const config = resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
  assert.throws(() => assertRunnable({ feature: featureById('record-summary'), pack: PACK, values: { piiMode: 'standard' }, policy: { aiEnabled: false }, config }), (e) => e.code === 'AI_OFF');
});

test('AI switched off: the panel agrees it is not ready, and says why instead of asking for a key', () => {
  const off = panelEff({ provider: 'anthropic' }, { aiEnabled: false });
  assert.equal(isAiReady(off), false);
  assert.equal(aiNeeds(off), 'policy');
  assert.equal(aiNeedsText(off, 'this action'), 'Your organisation has switched AI Assist off.');
  // Even with no key and a locked key store, the organisation's word comes first.
  assert.equal(aiNeedsText({ ...off, apiKey: '', keyLocked: true }), 'Your organisation has switched AI Assist off.');
  const on = panelEff({ provider: 'anthropic' }, {});
  assert.equal(isAiReady(on), true);
  assert.equal(aiNeeds(on), '');
});

test('a model the policy allows is used even when it is not on the provider\'s own list (the audit\'s example)', () => {
  const eff = effectiveSettings({}, { aiProvider: 'anthropic', allowedModels: ['claude-opus-4-1'] });
  assert.equal(eff.values.models.anthropic, 'claude-opus-4-1');
  const config = resolveProviderConfig(eff.values, 'sk-ant-x');
  assert.equal(config.model, 'claude-opus-4-1', 'not swapped for the provider default');
  assert.deepEqual(checkProviderAllowed(config, eff.policy), { ok: true, reason: '' });
  assert.doesNotThrow(runFor({}, { aiProvider: 'anthropic', allowedModels: ['claude-opus-4-1'] }));
  // The person picks the second allowed model: kept too.
  const second = effectiveSettings({ models: { anthropic: 'claude-opus-4-0' } }, { allowedModels: ['claude-opus-4-1', 'claude-opus-4-0'] });
  assert.equal(resolveProviderConfig(second.values, 'k').model, 'claude-opus-4-0');
});

test('the allowed models come from the policy only: a stored list cannot make an unknown model stick', () => {
  const eff = effectiveSettings({ provider: 'anthropic', models: { anthropic: 'claude-made-up' }, allowedModels: ['claude-made-up'] }, {});
  assert.equal(eff.values.allowedModels, null);
  assert.equal(resolveProviderConfig(eff.values, 'k').model, 'claude-sonnet-5-5', 'without a policy an unknown id is still the default');
  // A listed model is unchanged, with or without a policy.
  assert.equal(resolveProviderConfig(effectiveSettings({ models: { anthropic: 'claude-haiku-5-5' } }, {}).values, 'k').model, 'claude-haiku-5-5');
});

test('an AI address in the policy that is not valid says "ask your administrator", not "the address is not valid"', () => {
  const policy = { aiProvider: 'openai', aiBaseUrl: 'http://gw.corp.example/v1' };
  assert.ok(normalizePolicy(policy).aiBlocked, 'the policy parser blocks it');
  assert.throws(runFor({ provider: 'openai' }, policy, 'sk-x'), (e) => e.code === 'PROVIDER_BLOCKED' && /Ask your administrator/.test(e.message) && !/not valid: Use https/.test(e.message));
  // The panel says the same before any click, not "Finish the AI set-up in Settings".
  const eff = panelEff({ provider: 'openai' }, policy);
  assert.equal(isAiReady(eff), false);
  assert.equal(aiNeeds(eff), 'policy');
  assert.match(aiNeedsText(eff), /Ask your administrator/);
  // An address the PERSON typed that is not valid is still theirs to fix.
  assert.throws(runFor({ provider: 'openai', baseUrls: { openai: 'ftp://x' } }, {}, 'sk-x'), (e) => e.code === 'BAD_URL' && /not valid/.test(e.message));
});
