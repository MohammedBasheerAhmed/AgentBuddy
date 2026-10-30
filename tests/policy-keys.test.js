// The organisation policy, read adversarially: every key is in the schema, the parser and docs/deployment.md; unknown keys, wrong
// types, case, spaces, addresses in every spelling; and "a person can tighten, never loosen".
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  POLICY_KEYS,
  PII_MODES,
  PREVIEW_MODES,
  KEY_STORAGE_MODES,
  normalizePolicy,
  normalizeInstance,
  normalizeAllowEntry,
  normalizeEndpoint,
  isInstanceAllowed,
  checkProviderAllowed,
  effectiveSettings,
  policyProblems,
  instancePattern,
  bakedPolicy,
} from '../src/policy/policy.js';
import { PROVIDERS } from '../src/providers/config.js';
import { validateBaseUrl } from '../src/lib/aiUsage.js';

const { tableAfter } = require('../scripts/lib/traceability.js');

const ROOT = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'managed_schema.json'), 'utf8'));
const deployment = fs.readFileSync(path.join(ROOT, 'docs', 'deployment.md'), 'utf8');
const sorted = (list) => [...list].sort();

// ---- schema, parser and docs in step --------------------------------------------------------------------------------------------

test('managed_schema.json, POLICY_KEYS and the policy the parser returns name the same keys', () => {
  assert.deepEqual(sorted(Object.keys(schema.properties)), sorted(POLICY_KEYS));
  // aiBlocked is the parser's own verdict, never a key an administrator sets.
  assert.deepEqual(sorted(Object.keys(normalizePolicy({}))), sorted([...POLICY_KEYS, 'aiBlocked']));
  assert.equal(schema.type, 'object');
});

test('docs/deployment.md has one row per policy key in "Every policy key", and no other', () => {
  const rows = tableAfter(deployment, /^##\s*Every policy key/);
  const keys = rows.map((r) => (/^`([A-Za-z]+)`$/.exec(r.Key) || [])[1]);
  assert.ok(keys.every(Boolean), `every row names one key in backticks: ${rows.map((r) => r.Key).join(', ')}`);
  assert.deepEqual(sorted(keys), sorted(POLICY_KEYS));
  for (const r of rows) assert.ok(r['What it does'].length > 20, `${r.Key} says what it does`);
});

test('every schema key has a title, a type the parser expects and a description; enums match the code', () => {
  const lists = ['allowedInstances', 'allowedProviders', 'allowedModels', 'disabledFeatures', 'blockedTables', 'blockedFields', 'sensitiveTablePrefixes'];
  const booleans = ['allowHrContent', 'auditExport', 'coachingEnabled', 'disablePageBar'];
  for (const [key, def] of Object.entries(schema.properties)) {
    assert.ok(def.title, `${key} has a title`);
    assert.ok(def.description || key === 'allowedModels', `${key} has a description`);
    if (lists.includes(key)) assert.deepEqual([def.type, def.items], ['array', { type: 'string' }], key);
    else if (booleans.includes(key)) assert.equal(def.type, 'boolean', key);
    else if (key === 'tokenBudgetPerDay') assert.deepEqual([def.type, def.minimum], ['integer', 0]);
    else assert.equal(def.type, 'string', key);
  }
  assert.deepEqual(schema.properties.piiMode.enum, PII_MODES);
  assert.deepEqual(schema.properties.previewMode.enum, PREVIEW_MODES);
  assert.deepEqual(schema.properties.keyStorage.enum, KEY_STORAGE_MODES);
});

test('the schema and the docs name every AI provider the code knows', () => {
  const docRow = tableAfter(deployment, /^##\s*Every policy key/).find((r) => r.Key === '`aiProvider`');
  for (const id of Object.keys(PROVIDERS)) {
    assert.ok(new RegExp(`\\b${id}\\b`).test(schema.properties.aiProvider.description), `schema names ${id}`);
    assert.ok(docRow['What it does'].includes(`\`${id}\``), `docs/deployment.md names ${id}`);
  }
});

test('this build has no compiled-in policy: the managed policy is read on its own', () => {
  assert.equal(bakedPolicy(), null);
  assert.equal(normalizePolicy({ allowHrContent: true }).allowHrContent, true);
  assert.equal(normalizePolicy({}).allowedInstances, null);
});

// ---- unknown keys, wrong types, case and spaces ---------------------------------------------------------------------------------

test('unknown keys and prototype tricks have no effect', () => {
  const p = normalizePolicy(JSON.parse('{"__proto__": {"allowHrContent": true, "piiMode": "standard"}, "constructor": {"x": 1}, "allowHRContent": true, "aiBlocked": ""}'));
  assert.equal(p.allowHrContent, false);
  assert.equal(p.piiMode, null);
  assert.equal(Object.prototype.allowHrContent, undefined);
  // A policy cannot hide its own problems by setting the parser's verdict.
  assert.match(normalizePolicy({ aiBaseUrl: 'http://gw.corp.example/v1', aiBlocked: '' }).aiBlocked, /not valid/);
  for (const raw of [[], [{ piiMode: 'strict' }], 'piiMode=strict', 7, true]) assert.equal(normalizePolicy(raw).piiMode, null, JSON.stringify(raw));
});

test('modes and the provider are read whatever their case or surrounding spaces; other words and types are "not set"', () => {
  const p = normalizePolicy({ piiMode: ' Strict ', previewMode: 'ALWAYS', keyStorage: 'Session', aiProvider: ' OpenAI ' });
  assert.deepEqual([p.piiMode, p.previewMode, p.keyStorage, p.aiProvider], ['strict', 'always', 'session', 'openai']);
  for (const bad of [['strict'], { mode: 'strict' }, 2, 'strictest', 'local only', '']) {
    assert.equal(normalizePolicy({ piiMode: bad }).piiMode, null, JSON.stringify(bad));
  }
  assert.equal(normalizePolicy({ aiProvider: '   ' }).aiProvider, null);
  assert.equal(normalizePolicy({ aiProvider: 42 }).aiProvider, null);
});

test('lists: spaces trimmed, repeats removed, names lower case; a list given as text is "not set"', () => {
  const p = normalizePolicy({ blockedTables: ['Incident', ' incident ', 'INCIDENT'], allowedModels: [' gpt-5-mini ', 'gpt-5-mini', ''], disabledFeatures: 'reply-draft' });
  assert.deepEqual(p.blockedTables, ['incident']);
  assert.deepEqual(p.allowedModels, ['gpt-5-mini']);
  assert.deepEqual(p.disabledFeatures, []);
});

test('the daily budget takes a whole number; true, text that is not a number, negatives and infinity mean no budget', () => {
  const budget = (v) => normalizePolicy({ tokenBudgetPerDay: v }).tokenBudgetPerDay;
  assert.equal(budget(200000), 200000);
  assert.equal(budget('5000'), 5000);
  assert.equal(budget(12.7), 12);
  for (const v of [true, false, null, '', ' ', 'lots', -1, 0, Infinity, NaN, [100]]) assert.equal(budget(v), 0, JSON.stringify(v));
});

test('switches count only as a real true; auditExport is on unless it is a real false', () => {
  for (const key of ['allowHrContent', 'coachingEnabled', 'disablePageBar']) {
    for (const v of ['true', 1, 'yes', {}, [true]]) assert.equal(normalizePolicy({ [key]: v })[key], false, `${key} ${JSON.stringify(v)}`);
    assert.equal(normalizePolicy({ [key]: true })[key], true);
  }
  assert.equal(normalizePolicy({ auditExport: false }).auditExport, false);
  assert.equal(normalizePolicy({}).auditExport, true);
});

// ---- addresses --------------------------------------------------------------------------------------------------------------------

test('an instance is one plain https host: case, :443, a path and a trailing slash do not matter', () => {
  for (const input of ['https://ACME.service-now.com', 'https://acme.service-now.com:443', 'https://acme.service-now.com/', ' acme.service-now.com ', 'https://acme.service-now.com/now/nav/ui/home?x=1#y']) {
    assert.equal(normalizeInstance(input), 'https://acme.service-now.com', input);
  }
  assert.equal(normalizeInstance('https://acme.service-now.com:8443'), 'https://acme.service-now.com:8443', 'another port is another origin');
  assert.equal(normalizeInstance('https://bücher.example'), 'https://xn--bcher-kva.example', 'an international name in its xn-- form, as the browser shows it');
});

test('an instance is never a wildcard, a user name, another scheme or a host with odd characters', () => {
  // "*" typed in Settings would otherwise ask the browser for every https site (https://*/*).
  for (const input of ['*', '*.service-now.com', 'https://*.service-now.com', 'https://*/', 'https://acme.service-now.com@evil.example', 'https://user:pw@acme.service-now.com', 'mailto:x@acme.service-now.com', 'ftp://acme.service-now.com', 'http://acme.service-now.com', 'https://acme .service-now.com', 'https://acme.service-\nnow.com', 'https://ac\tme.service-now.com', 'https://[::1]', 'https://acme_x.service-now.com', 'javascript:alert(1)', '']) {
    assert.equal(normalizeInstance(input), '', JSON.stringify(input));
  }
  assert.equal(instancePattern('https://ACME.service-now.com:443/'), 'https://acme.service-now.com/*');
});

test('allow-list entries: exact origins and wildcards of at least two names; anything wider is dropped', () => {
  assert.equal(normalizeAllowEntry(' *.Corp.Example.com '), '*.corp.example.com');
  assert.equal(normalizeAllowEntry('*.bücher.example'), '*.xn--bcher-kva.example');
  for (const bad of ['*', '*.', '*.com', '*.*.corp.example', 'acme.*.example', '*.corp.example.com:8443', '*.corp.example.com/', '*.10.0.0.1', '*.corp..example', 'https://*.corp.example.com']) {
    assert.equal(normalizeAllowEntry(bad), '', bad);
  }
  const p = normalizePolicy({ allowedInstances: ['*.com', 'https://u@acme.service-now.com'] });
  assert.deepEqual(p.allowedInstances, [], 'no usable entry: the list allows nothing, it is not "no list"');
  assert.equal(isInstanceAllowed('https://acme.service-now.com', p), false);
});

test('isInstanceAllowed: look-alikes, ports, case, and an allow-list that is not a list', () => {
  const p = normalizePolicy({ allowedInstances: ['https://acme.service-now.com', '*.corp.example.com'] });
  assert.equal(isInstanceAllowed('https://ACME.service-now.com/', p), true);
  assert.equal(isInstanceAllowed('https://acme.service-now.com:8443', p), false, 'an exact entry is one port');
  assert.equal(isInstanceAllowed('https://a.b.corp.example.com', p), true);
  assert.equal(isInstanceAllowed('https://evilcorp.example.com', p), false, 'a wildcard needs the dot');
  assert.equal(isInstanceAllowed('https://corp.example.com.evil.test', p), false);
  assert.equal(isInstanceAllowed('https://*.corp.example.com', p), false);
  // A policy object that was not normalised: entries are read the same way, and a non-list allows nothing.
  assert.equal(isInstanceAllowed('https://acme.service-now.com', { allowedInstances: ['ACME.service-now.com'] }), true);
  assert.equal(isInstanceAllowed('https://acme.service-now.com', { allowedInstances: 'https://acme.service-now.com' }), false);
  assert.equal(isInstanceAllowed('https://acme.service-now.com', { allowedInstances: null }), true);
});

test('aiBaseUrl is compared in the form Settings calls: case, :443 and a trailing slash do not matter', () => {
  const p = normalizePolicy({ aiProvider: 'OpenAI', aiBaseUrl: ' https://AI-Gateway.corp.example:443/v1/ ' });
  assert.equal(p.aiBaseUrl, 'https://ai-gateway.corp.example/v1');
  assert.equal(p.aiBlocked, '');
  // What the provider layer will call for the address the person (or the policy) put in Settings.
  const called = validateBaseUrl(p.aiBaseUrl).url;
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: called }, p).ok, true);
  assert.equal(checkProviderAllowed({ provider: 'OpenAI', model: 'm', baseUrl: 'https://ai-gateway.corp.example/v1/' }, p).ok, true);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: 'https://ai-gateway.corp.example/v2' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: 'https://ai-gateway.corp.example.evil.test/v1' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, p).ok, false, 'the vendor default is not the pinned gateway');
  // The canonical form is the same as Settings' own check for every valid address.
  for (const url of ['https://gw.corp.example/v1', 'http://localhost:11434/v1', 'https://x.openai.azure.com', 'https://GW.corp.example:8443/a/B/']) {
    assert.equal(normalizeEndpoint(url).url, validateBaseUrl(url).url, url);
  }
});

test('an aiBaseUrl that is not valid blocks every AI call instead of being ignored', () => {
  for (const bad of ['http://gw.corp.example/v1', 'https://user:pw@gw.corp.example/v1', 'https://gw.corp.example/v1?key=1', 'https://gw.corp.example/v1#x', 'gw.corp.example', 'not an address', 'https://gw corp.example']) {
    const p = normalizePolicy({ aiBaseUrl: bad });
    assert.match(p.aiBlocked, /not valid/, bad);
    assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: bad }, p).ok, false, bad);
    assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, p).ok, false, bad);
    assert.ok(policyProblems({ aiBaseUrl: bad }).some((x) => x.level === 'error' && x.key === 'aiBaseUrl'), bad);
  }
  assert.equal(normalizePolicy({ aiBaseUrl: 'http://127.0.0.1:1234/v1' }).aiBlocked, '', 'a model on this computer is fine');
  assert.equal(normalizePolicy({ aiBaseUrl: '' }).aiBaseUrl, null, 'empty is "not set"');
});

test('allowed models are compared exactly, after trimming', () => {
  const p = normalizePolicy({ allowedModels: [' gpt-5-mini '] });
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'gpt-5-mini', baseUrl: '' }, p).ok, true);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: ' gpt-5-mini ', baseUrl: '' }, p).ok, true);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'GPT-5-mini', baseUrl: '' }, p).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'gpt-5', baseUrl: '' }, p).ok, false);
});

test('reading a policy twice gives the same policy (the panel passes an already-read one to effectiveSettings)', () => {
  const samples = [
    {},
    { allowedInstances: ['ACME.service-now.com', '*.Corp.example.com'], aiProvider: 'OpenAI', aiBaseUrl: 'https://GW.corp.example/v1/' },
    { aiBaseUrl: 'http://gw.corp.example/v1', piiMode: 'Strict', previewMode: 'never', blockedTables: ['Incident'] },
    { sensitiveTablePrefixes: ['x_acme_hr_'], tokenBudgetPerDay: '100', allowHrContent: true, providedApiKey: ' k ' },
  ];
  for (const raw of samples) {
    const once = normalizePolicy(raw);
    assert.deepEqual(normalizePolicy(once), once, JSON.stringify(raw));
  }
});

// ---- allowedProviders -------------------------------------------------------------------------------------------------------------

test('allowedProviders rules out every other vendor; ids are not case-sensitive and not checked against a fixed list', () => {
  const p = normalizePolicy({ allowedProviders: [' OpenAI ', 'AZURE', 'openai', 'some-future-provider'] });
  assert.deepEqual(p.allowedProviders, ['openai', 'azure', 'some-future-provider']);
  const ok = (provider) => checkProviderAllowed({ provider, model: 'm', baseUrl: '' }, p).ok;
  assert.equal(ok('openai'), true);
  assert.equal(ok('Azure'), true);
  assert.equal(ok('some-future-provider'), true, 'a provider added later works without a policy-code change');
  assert.equal(ok('deepseek'), false);
  assert.match(checkProviderAllowed({ provider: 'deepseek', model: 'm', baseUrl: '' }, p).reason, /openai, azure/);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, normalizePolicy({ allowedProviders: [] })).ok, false, 'an empty list allows none');
  assert.equal(normalizePolicy({ allowedProviders: 'openai' }).allowedProviders, null, 'not a list: "not set", like every list');
  assert.equal(normalizePolicy({}).allowedProviders, null);
});

test('allowedProviders: a provider the person had that is not allowed is replaced by the first allowed one; a pinned one wins', () => {
  const r = effectiveSettings({ provider: 'deepseek' }, { allowedProviders: ['Azure', 'openai'] });
  assert.equal(r.values.provider, 'azure');
  assert.equal(r.locked.provider, undefined, 'the person may still choose among the allowed ones');
  assert.equal(effectiveSettings({ provider: 'openai' }, { allowedProviders: ['azure', 'openai'] }).values.provider, 'openai');
  const pinned = effectiveSettings({ provider: 'deepseek' }, { aiProvider: 'gemini', allowedProviders: ['openai'] });
  assert.equal(pinned.values.provider, 'gemini');
  assert.equal(checkProviderAllowed({ provider: 'gemini', model: 'm', baseUrl: '' }, pinned.policy).ok, false, 'a pin outside the list allows nothing');
});

test('policyProblems knows the providers it is given: a misspelt aiProvider or allowedProviders entry is an error', () => {
  const providers = Object.keys(PROVIDERS);
  const has = (raw, re) => policyProblems(raw, { providers }).some((p) => p.level === 'error' && re.test(p.message));
  assert.ok(has({ aiProvider: 'open-ai' }, /not a provider Agent Buddy knows/));
  assert.ok(has({ allowedProviders: ['openai', 'deepseak'] }, /allowedProviders\[1\].*not a provider/));
  assert.ok(has({ allowedProviders: [] }, /no AI provider is allowed/));
  assert.ok(has({ aiProvider: 'gemini', allowedProviders: ['openai'] }, /does not include aiProvider/));
  assert.ok(has({ providedApiKey: 'sk-org' }, /must also pin aiProvider or aiBaseUrl/));
  assert.deepEqual(policyProblems({ aiProvider: 'azure', aiBaseUrl: 'https://contoso.openai.azure.com', allowedProviders: ['azure'], allowedModels: ['gpt-5-mini-prod'], keyStorage: 'session' }, { providers }), []);
  // Without the list, names are not judged (the content script reads policies without the provider layer).
  assert.deepEqual(policyProblems({ aiProvider: 'open-ai' }), []);
  assert.ok(policyProblems({ aiProvider: 'OpenAI' }, { providers }).every((p) => p.level === 'note'));
});

// ---- a person can tighten, never loosen -----------------------------------------------------------------------------------------

test('previewMode is a floor: a person may see the text more often, never less', () => {
  const more = effectiveSettings({ previewMode: 'always' }, { previewMode: 'first' });
  assert.equal(more.values.previewMode, 'always');
  assert.equal(more.locked.previewMode, undefined);
  assert.equal(more.floors.previewMode, 'first');
  const less = effectiveSettings({ previewMode: 'never' }, { previewMode: 'first' });
  assert.equal(less.values.previewMode, 'first');
  assert.ok(less.locked.previewMode);
  assert.equal(effectiveSettings({ previewMode: 'never' }, { previewMode: 'always' }).values.previewMode, 'always');
});

test('piiMode floor is reported in floors; an unknown stored mode never ranks above the floor', () => {
  const r = effectiveSettings({ piiMode: 'off' }, { piiMode: 'strict' });
  assert.equal(r.values.piiMode, 'strict');
  assert.equal(r.floors.piiMode, 'strict');
  assert.equal(effectiveSettings({ piiMode: 'off', previewMode: 'sometimes', keyStorage: 'cloud' }, {}).values.piiMode, 'standard');
  assert.equal(effectiveSettings({ previewMode: 'sometimes' }, {}).values.previewMode, 'first');
  assert.equal(effectiveSettings({ keyStorage: 'cloud' }, {}).values.keyStorage, 'local');
  assert.deepEqual(effectiveSettings({}, {}).floors, {});
});

test('a person\'s settings cannot carry a policy value: an own "provided key", a base URL or a model for a pinned endpoint', () => {
  const r = effectiveSettings(
    { providedApiKey: 'sk-mine', provider: 'gemini', baseUrls: { openai: 'https://evil.example/v1' }, models: { openai: 'gpt-5' }, instances: ['https://ACME.service-now.com', 'https://other.service-now.com'] },
    { aiProvider: 'openai', aiBaseUrl: 'https://gw.corp.example/v1', allowedModels: ['gpt-5-mini'], allowedInstances: ['https://acme.service-now.com'] }
  );
  assert.equal(r.values.providedApiKey, '');
  assert.equal(r.values.provider, 'openai');
  assert.equal(r.values.baseUrls.openai, 'https://gw.corp.example/v1');
  assert.equal(r.values.models.openai, 'gpt-5-mini');
  assert.deepEqual(r.values.instances, ['https://ACME.service-now.com']);
  assert.ok(r.locked.provider && r.locked.baseUrl && r.locked.model && r.locked.instances);
});

// ---- what an administrator is told ----------------------------------------------------------------------------------------------

test('policyProblems names unknown keys (with the likely one), wrong types, words it does not know and re-read values', () => {
  const problems = policyProblems({
    previewmode: 'always',
    allowedInstances: 'https://acme.service-now.com',
    piiMode: 'loose',
    keyStorage: 'Session',
    allowHrContent: 'true',
    tokenBudgetPerDay: 1.5,
    blockedTables: ['incident', 'In cident', 3],
    sensitiveTablePrefixes: ['x'],
    providedApiKey: 'sk-1',
  });
  const by = (key) => problems.filter((p) => p.key === key);
  assert.match(by('previewmode')[0].message, /Did you mean "previewMode"/);
  assert.equal(by('allowedInstances')[0].level, 'error');
  assert.equal(by('piiMode')[0].level, 'error');
  assert.equal(by('keyStorage')[0].level, 'note');
  assert.match(by('allowHrContent')[0].message, /read as false/);
  assert.equal(by('tokenBudgetPerDay')[0].level, 'error');
  assert.equal(by('blockedTables').length, 2);
  assert.equal(by('sensitiveTablePrefixes')[0].level, 'error');
  assert.match(by('providedApiKey')[0].message, /policy store/);
});

test('policyProblems: a clean policy has none; garbage never throws', () => {
  assert.deepEqual(policyProblems({ allowedInstances: ['https://acme.service-now.com'], aiProvider: 'openai', piiMode: 'strict', disablePageBar: true }), []);
  assert.deepEqual(policyProblems({}), []);
  assert.deepEqual(policyProblems(undefined), []);
  for (const raw of [null, [], 'x', 3, { tokenBudgetPerDay: 10n, aiBaseUrl: {}, allowedInstances: [null, 5, {}] }]) assert.doesNotThrow(() => policyProblems(raw));
  assert.ok(policyProblems({ allowedInstances: ['*.com'] }).some((p) => /no usable entry/.test(p.message)));
  assert.ok(policyProblems({ allowHrContent: true }).some((p) => p.key === 'allowHrContent'), 'HR allowed without a pinned endpoint is pointed out');
});
