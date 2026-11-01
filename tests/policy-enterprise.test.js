// The enterprise build: the config is checked strictly, the manifest names exactly the configured hosts, the compiled-in policy is a
// floor the managed policy can only tighten, and `node build.js --enterprise` really writes such a build into its own folder while the
// normal build stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validateEnterpriseConfig,
  enterpriseManifest,
  cspWithConnectSrc,
  bakedModuleSource,
  aiEndpointFor,
  BAKED_MODULE_FILTER,
  VENDOR_BASE_URLS,
} from '../src/policy/enterprise.js';
import { mergePolicies, normalizePolicy, effectiveSettings, checkProviderAllowed, isInstanceAllowed, instancePattern, POLICY_KEYS } from '../src/policy/policy.js';
import { resolveProviderConfig, PROVIDERS } from '../src/providers/config.js';
import { aiOriginPattern } from '../src/lib/aiPermission.js';

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'enterprise', 'example.json'), 'utf8'));
const base = { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'openai', aiBaseUrl: 'https://gw.corp.example/v1' };
const sorted = (list) => [...list].sort();
const check = (over) => validateEnterpriseConfig({ ...base, ...over });
const errorsOf = (over) => check(over).errors.join('\n');

// ---- the config -----------------------------------------------------------------------------------------------------------------

test('enterprise/example.json is valid and gives exact hosts', () => {
  const r = validateEnterpriseConfig(example);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plan.hostPermissions, ['https://example.service-now.com/*', 'https://example-test.service-now.com/*', 'https://ai-gateway.example.com/*']);
  assert.deepEqual(r.plan.connectSrc, ['https://ai-gateway.example.com']);
  assert.equal(r.plan.label, 'Example Corp');
  assert.deepEqual(Object.keys(r.plan.policy), POLICY_KEYS.filter((k) => k in r.plan.policy), 'keys in a fixed order');
  assert.equal(r.plan.policy.providedApiKey, undefined);
});

test('the two required keys, and unknown keys, are reported (all problems at once)', () => {
  const r = validateEnterpriseConfig({ allowedinstances: [], piiMode: 'Strict' });
  const text = r.errors.join('\n');
  assert.equal(r.ok, false);
  assert.match(text, /"allowedinstances" is not a config key\. Did you mean "allowedInstances"/);
  assert.match(text, /allowedInstances is required/);
  assert.match(text, /aiProvider is required/);
  assert.match(text, /piiMode "Strict" must be one of standard, strict, local-only/);
  for (const raw of [null, [], 'x', 1]) assert.equal(validateEnterpriseConfig(raw).ok, false);
});

test('a key is never compiled into a build', () => {
  assert.match(errorsOf({ providedApiKey: 'sk-123' }), /providedApiKey is not allowed/);
});

test('instances: exact canonical https origins only, no wildcard, no repeats, at least one, at most 50', () => {
  const cases = {
    '*.service-now.com': /wildcards are not allowed/,
    'https://*.service-now.com': /wildcards are not allowed/,
    'http://acme.service-now.com': /must use https/,
    'https://ACME.service-now.com': /write it as "https:\/\/acme\.service-now\.com"/,
    'https://acme.service-now.com/': /write it as/,
    'https://acme.service-now.com:443': /write it as/,
    'acme.service-now.com': /write it as/,
    'https://user@acme.service-now.com': /not an https address of one host/,
    ' https://acme.service-now.com': /spaces around it/,
  };
  for (const [entry, re] of Object.entries(cases)) assert.match(errorsOf({ allowedInstances: [entry] }), re, entry);
  assert.match(errorsOf({ allowedInstances: ['https://acme.service-now.com', 'https://acme.service-now.com'] }), /listed twice/);
  assert.match(errorsOf({ allowedInstances: [] }), /at least 1 entry/);
  assert.match(errorsOf({ allowedInstances: 'https://acme.service-now.com' }), /must be a list/);
  assert.match(errorsOf({ allowedInstances: Array.from({ length: 51 }, (_, i) => `https://i${i}.service-now.com`) }), /at most 50/);
  assert.equal(check({ allowedInstances: ['https://acme.service-now.com:8443'] }).ok, true, 'another port is fine when written exactly');
});

test('the AI endpoint: known provider, canonical https address, http only for this computer', () => {
  assert.match(errorsOf({ aiProvider: 'OpenAI' }), /must be one of/);
  assert.match(errorsOf({ aiProvider: 'nope' }), /must be one of/);
  assert.match(errorsOf({ aiBaseUrl: 'https://gw.corp.example/v1/' }), /write aiBaseUrl as "https:\/\/gw\.corp\.example\/v1"/);
  assert.match(errorsOf({ aiBaseUrl: 'https://GW.corp.example/v1' }), /write aiBaseUrl as/);
  assert.match(errorsOf({ aiBaseUrl: 'http://gw.corp.example/v1' }), /not valid/);
  assert.match(errorsOf({ aiBaseUrl: 'https://u:p@gw.corp.example/v1' }), /not valid/);
  assert.match(errorsOf({ aiBaseUrl: 'https://gw.corp.example/v1?x=1' }), /not valid/);
  assert.match(errorsOf({ aiBaseUrl: 42 }), /not valid|must be text/);
  assert.match(errorsOf({ aiProvider: 'custom', aiBaseUrl: 'http://[::1]:8080/v1' }), /only allowed for localhost or 127\.0\.0\.1/);
  // Providers that need an address, and presets whose address is fixed.
  assert.match(errorsOf({ aiProvider: 'custom', aiBaseUrl: undefined }), /needs aiBaseUrl/);
  if (PROVIDERS.azure) assert.match(validateEnterpriseConfig({ allowedInstances: base.allowedInstances, aiProvider: 'azure' }).errors.join('\n'), /needs aiBaseUrl/);
  assert.match(errorsOf({ aiProvider: 'gemini' }), /always calls https:\/\/generativelanguage\.googleapis\.com/);
  assert.equal(validateEnterpriseConfig({ allowedInstances: base.allowedInstances, aiProvider: 'gemini' }).ok, true);
});

test('where the calls go: vendor defaults, presets and a model on this computer', () => {
  assert.equal(aiEndpointFor('anthropic').baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(aiEndpointFor('openai').baseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(VENDOR_BASE_URLS, { anthropic: 'https://api.anthropic.com/v1', openai: 'https://api.openai.com/v1' });
  const ollama = aiEndpointFor('ollama');
  assert.deepEqual([ollama.origin, ollama.pattern, ollama.local], ['http://localhost:11434', 'http://localhost/*', true]);
  const local = aiEndpointFor('custom', 'http://127.0.0.1:1234/v1');
  assert.deepEqual([local.origin, local.pattern], ['http://127.0.0.1:1234', 'http://127.0.0.1/*']);
  const port = aiEndpointFor('openai', 'https://gw.corp.example:8443/v1');
  assert.deepEqual([port.origin, port.pattern], ['https://gw.corp.example:8443', 'https://gw.corp.example/*']);
});

test('every policy key but providedApiKey can be compiled in, exactly as written', () => {
  const full = {
    allowedInstances: ['https://acme.service-now.com'],
    aiProvider: 'openai',
    aiBaseUrl: 'https://gw.corp.example/v1',
    allowedProviders: ['openai'],
    allowedModels: ['gpt-5-mini'],
    piiMode: 'strict',
    previewMode: 'always',
    keyStorage: 'session',
    disabledFeatures: ['coaching-snapshot'],
    blockedTables: ['sn_hr_core_case'],
    blockedFields: ['work_notes'],
    sensitiveTablePrefixes: ['x_acme_hr_'],
    allowHrContent: true,
    tokenBudgetPerDay: 1000,
    auditExport: false,
    coachingEnabled: true,
    disablePageBar: true,
    aiEnabled: false,
    disabledSections: ['team'],
    allowedProfiles: ['it', 'req'],
    lockedProfiles: ['it'],
    orgSnippets: [{ title: 'Password reset steps', body: 'Open the self-service portal and choose Reset password.', shortcut: 'pw' }],
    internalPhrases: ['Project Falcon'],
    defaultDashboard: { kind: 'agentbuddy-dashboard-layout', version: 1, dashboard: { name: 'Service desk today', scope: { kind: 'groups', groupIds: [], groupNames: {} }, tables: null, widgets: [{ type: 'section', section: 'overview' }, { type: 'section', section: 'sla' }] } },
    priorityAccounts: ['Boxeo', 'Acme Corporation EMEA'],
  };
  assert.deepEqual(sorted(Object.keys(full)), sorted(POLICY_KEYS.filter((k) => k !== 'providedApiKey')), 'the sample covers every key');
  const r = validateEnterpriseConfig(full);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plan.policy, full);
});

test('allowedProviders in a config: known ids only, and it must include aiProvider', () => {
  assert.match(errorsOf({ allowedProviders: ['OpenAI'] }), /not a provider id/);
  assert.match(errorsOf({ allowedProviders: ['openai', 'deepseak'] }), /not a provider id/);
  assert.match(errorsOf({ allowedProviders: ['gemini'] }), /does not include aiProvider "openai"/);
  assert.match(errorsOf({ allowedProviders: [] }), /at least 1/);
  assert.equal(check({ allowedProviders: ['openai', 'anthropic'] }).ok, true);
});

test('policy keys are checked exactly: modes, switches, budget, names, feature ids', () => {
  assert.match(errorsOf({ previewMode: 'ALWAYS' }), /previewMode/);
  assert.match(errorsOf({ keyStorage: 'cloud' }), /keyStorage/);
  assert.match(errorsOf({ allowHrContent: 'true' }), /allowHrContent must be true or false/);
  assert.match(errorsOf({ tokenBudgetPerDay: -1 }), /whole number/);
  assert.match(errorsOf({ tokenBudgetPerDay: 1.5 }), /whole number/);
  assert.match(errorsOf({ blockedTables: ['Incident'] }), /not a table name in lower case/);
  assert.match(errorsOf({ blockedFields: ['short description'] }), /not a column name/);
  assert.match(errorsOf({ sensitiveTablePrefixes: ['x'] }), /not a table-name prefix/);
  assert.match(errorsOf({ disabledFeatures: ['reply-drafts'] }), /not a feature id/);
  assert.equal(check({ disabledFeatures: ['reports', 'coaching-snapshot'] }).ok, true);
  assert.match(errorsOf({ allowedModels: [] }), /at least 1/);
  assert.match(errorsOf({ piiMode: 'local-only' }), /no AI call could ever be made/);
  assert.equal(validateEnterpriseConfig({ allowedInstances: base.allowedInstances, aiProvider: 'ollama', piiMode: 'local-only' }).ok, true);
  assert.match(errorsOf({ label: '' }), /label/);
  assert.match(errorsOf({ label: 'Acme"; alert(1)' }), /label/);
  assert.match(errorsOf({ updateUrl: 'http://ext.corp.example/update.xml' }), /updateUrl/);
  assert.equal(check({ updateUrl: 'https://ext.corp.example/agentbuddy/update.xml', $comment: 'anything' }).ok, true);
});

// ---- the manifest -----------------------------------------------------------------------------------------------------------------

test('the enterprise manifest grants exactly the configured hosts and connects to the AI origin only; nothing else changes', () => {
  const { plan } = validateEnterpriseConfig({ ...example, updateUrl: 'https://ext.example.com/agentbuddy/update.xml' });
  const before = JSON.stringify(manifest);
  const m = enterpriseManifest(manifest, plan);
  assert.equal(JSON.stringify(manifest), before, 'the normal manifest is not changed');
  assert.deepEqual(m.host_permissions, plan.hostPermissions);
  assert.equal(m.optional_host_permissions, undefined, 'nothing else can ever be requested');
  assert.ok(m.host_permissions.every((h) => !h.includes('*.') && !/^\*|:\/\/\*/.test(h)), 'no wildcard host');
  assert.deepEqual(m.permissions, manifest.permissions);
  assert.equal(m.version_name, '0.1.0 Example Corp');
  assert.equal(m.update_url, 'https://ext.example.com/agentbuddy/update.xml');
  for (const key of ['content_scripts', 'web_accessible_resources', 'externally_connectable', 'key']) assert.equal(m[key], undefined, key);
  assert.deepEqual(m.commands, manifest.commands, 'the keyboard shortcuts are the same in an enterprise build');
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /connect-src https:\/\/ai-gateway\.example\.com;/);
  assert.ok(!/connect-src[^;]*(https:(\s|;)|localhost|\*)/.test(csp), 'no https: wildcard, no localhost');
  // Every other directive is the normal one, unchanged.
  const others = (text) => text.split(';').map((d) => d.trim()).filter((d) => !d.startsWith('connect-src'));
  assert.deepEqual(others(csp), others(manifest.content_security_policy.extension_pages));
  const { host_permissions: hp, version_name: vn, update_url: uu, content_security_policy: c1, ...restE } = m;
  const { optional_host_permissions: ohp, content_security_policy: c2, ...restN } = manifest;
  assert.deepEqual(restE, restN);
});

test('cspWithConnectSrc replaces only connect-src and refuses a CSP without one', () => {
  assert.equal(cspWithConnectSrc("default-src 'none'; connect-src https:; img-src 'self'", ['https://a.example']), "default-src 'none'; connect-src https://a.example; img-src 'self'");
  assert.throws(() => cspWithConnectSrc("default-src 'none'", ['https://a.example']), /no connect-src/);
});

test('end to end through the real runtime code: the hosts the extension asks for are exactly the ones granted', () => {
  const configs = [
    example,
    { allowedInstances: ['https://acme.service-now.com:8443'], aiProvider: 'anthropic' },
    { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'openai' },
    { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'gemini' },
    { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'ollama', piiMode: 'local-only' },
    { allowedInstances: ['https://acme.service-now.com'], aiProvider: 'custom', aiBaseUrl: 'http://127.0.0.1:1234/v1' },
    ...(PROVIDERS.azure ? [{ allowedInstances: ['https://acme.service-now.com'], aiProvider: 'azure', aiBaseUrl: 'https://acme-ai.openai.azure.com', allowedModels: ['gpt-5-mini'] }] : []),
  ];
  for (const config of configs) {
    const { plan, errors } = validateEnterpriseConfig(config);
    assert.deepEqual(errors, [], JSON.stringify(config));
    const policy = normalizePolicy(plan.policy);
    // Whatever the person had chosen before, the policy decides the endpoint.
    const { values } = effectiveSettings({ provider: 'deepseek', baseUrls: { [plan.ai.provider]: 'https://evil.example/v1' } }, plan.policy);
    const cfg = resolveProviderConfig(values, 'key');
    assert.equal(cfg.baseUrl, plan.ai.baseUrl, `${config.aiProvider}: calls go to the configured address`);
    assert.ok(plan.hostPermissions.includes(aiOriginPattern(cfg)), `${config.aiProvider}: the AI permission the extension checks is granted`);
    assert.ok(plan.connectSrc.includes(new URL(cfg.baseUrl).origin), `${config.aiProvider}: connect-src allows the call`);
    assert.equal(checkProviderAllowed(cfg, policy).ok, true, `${config.aiProvider}: the policy check passes`);
    for (const origin of plan.instances) {
      assert.ok(plan.hostPermissions.includes(instancePattern(origin)), origin);
      assert.equal(isInstanceAllowed(origin, policy), true, origin);
    }
    assert.equal(isInstanceAllowed('https://other.service-now.com', policy), false);
  }
});

test('the compiled-in source is the policy as JSON, the same text for the same config', () => {
  const { plan } = validateEnterpriseConfig(example);
  const src = bakedModuleSource(plan.policy, plan.label);
  assert.equal(src, bakedModuleSource(validateEnterpriseConfig(JSON.parse(JSON.stringify(example))).plan.policy, plan.label));
  const json = /export const BAKED_POLICY = (\{[\s\S]*\});\n$/.exec(src);
  assert.ok(json, 'one exported object');
  assert.deepEqual(JSON.parse(json[1]), plan.policy);
  assert.ok(BAKED_MODULE_FILTER.test(path.join(ROOT, 'src', 'policy', 'baked.js')));
  assert.ok(!BAKED_MODULE_FILTER.test(path.join(ROOT, 'src', 'policy', 'policy.js')));
});

// ---- the compiled-in policy as a floor ---------------------------------------------------------------------------------------------

const FLOOR = validateEnterpriseConfig(example).plan.policy;
const merged = (managed) => mergePolicies(FLOOR, managed);

test('with no managed policy the compiled-in policy applies as written', () => {
  const p = merged({});
  assert.deepEqual(p.allowedInstances, FLOOR.allowedInstances);
  assert.deepEqual([p.aiProvider, p.aiBaseUrl, p.piiMode, p.previewMode, p.keyStorage], ['openai', 'https://ai-gateway.example.com/v1', 'strict', 'first', 'session']);
  assert.deepEqual(p.allowedModels, ['gpt-5-mini']);
  assert.equal(p.tokenBudgetPerDay, 200000);
  assert.deepEqual(p.disabledFeatures, ['coaching-snapshot']);
  assert.ok(p.sensitiveTablePrefixes.includes('sn_hr_') && p.sensitiveTablePrefixes.includes('x_example_hr_'));
  assert.equal(p.aiBlocked, '');
});

test('the managed policy can tighten every setting', () => {
  const p = merged({
    allowedInstances: ['https://example.service-now.com'],
    allowedModels: ['gpt-5-mini'],
    piiMode: 'local-only',
    previewMode: 'always',
    disabledFeatures: ['reply-draft'],
    blockedTables: ['incident'],
    blockedFields: ['work_notes'],
    sensitiveTablePrefixes: ['x_legal_'],
    tokenBudgetPerDay: 1000,
    auditExport: false,
    disablePageBar: true,
  });
  assert.deepEqual(p.allowedInstances, ['https://example.service-now.com']);
  assert.equal(p.piiMode, 'local-only');
  assert.equal(p.previewMode, 'always');
  assert.deepEqual(p.disabledFeatures, ['coaching-snapshot', 'reply-draft']);
  assert.deepEqual([p.blockedTables, p.blockedFields], [['incident'], ['work_notes']]);
  assert.ok(p.sensitiveTablePrefixes.includes('x_legal_') && p.sensitiveTablePrefixes.includes('x_example_hr_'));
  assert.equal(p.tokenBudgetPerDay, 1000);
  assert.equal(p.auditExport, false);
  assert.equal(p.disablePageBar, true);
});

test('the managed policy cannot loosen anything', () => {
  const p = merged({
    allowedInstances: ['https://other.service-now.com', 'https://example.service-now.com'],
    piiMode: 'standard',
    previewMode: 'never',
    keyStorage: 'local',
    allowHrContent: true,
    coachingEnabled: true,
    tokenBudgetPerDay: 10_000_000,
    disablePageBar: false,
  });
  assert.deepEqual(p.allowedInstances, ['https://example.service-now.com'], 'only instances both allow');
  assert.equal(p.piiMode, 'strict');
  assert.equal(p.previewMode, 'first');
  assert.equal(p.keyStorage, 'session');
  assert.equal(p.allowHrContent, false, 'HR content needs the build to allow it too');
  assert.equal(p.coachingEnabled, false);
  assert.equal(p.tokenBudgetPerDay, 200000);
  // Not a list, not a number, not a word it knows: the floor stays.
  const junk = merged({ allowedInstances: 'https://other.service-now.com', piiMode: 'off', tokenBudgetPerDay: 'lots', disabledFeatures: 'all' });
  assert.deepEqual(junk.allowedInstances, FLOOR.allowedInstances);
  assert.equal(junk.piiMode, 'strict');
  assert.equal(junk.tokenBudgetPerDay, 200000);
  // And the person cannot loosen the result either.
  const { values } = effectiveSettings({ piiMode: 'standard', previewMode: 'never', keyStorage: 'local', instances: ['https://other.service-now.com'] }, p);
  assert.deepEqual([values.piiMode, values.previewMode, values.keyStorage, values.instances], ['strict', 'first', 'session', []]);
});

test('a managed policy that names another endpoint, or no model in common, stops every AI call', () => {
  const cfg = { provider: 'openai', model: 'gpt-5-mini', baseUrl: 'https://ai-gateway.example.com/v1' };
  assert.equal(checkProviderAllowed(cfg, merged({})).ok, true);
  for (const managed of [{ aiProvider: 'anthropic' }, { aiBaseUrl: 'https://other-gw.example.com/v1' }, { allowedModels: ['gpt-5'] }, { aiBaseUrl: 'http://bad.example/v1' }]) {
    const p = merged(managed);
    assert.ok(p.aiBlocked, JSON.stringify(managed));
    assert.equal(checkProviderAllowed(cfg, p).ok, false, JSON.stringify(managed));
    assert.equal(checkProviderAllowed({ ...cfg, provider: p.aiProvider, baseUrl: p.aiBaseUrl, model: p.allowedModels[0] }, p).ok, false, 'nor the managed one');
  }
  assert.equal(merged({ aiProvider: 'OpenAI', aiBaseUrl: 'https://AI-Gateway.example.com/v1/' }).aiBlocked, '', 'the same endpoint in another spelling is no conflict');
});

test('allowed providers are intersected: the managed policy can remove a vendor, never add one', () => {
  const floor = { allowedProviders: ['openai', 'azure'] };
  assert.deepEqual(mergePolicies(floor, {}).allowedProviders, ['openai', 'azure']);
  assert.deepEqual(mergePolicies(floor, { allowedProviders: ['Azure', 'deepseek'] }).allowedProviders, ['azure']);
  const none = mergePolicies(floor, { allowedProviders: ['deepseek'] });
  assert.deepEqual(none.allowedProviders, []);
  assert.equal(checkProviderAllowed({ provider: 'openai', model: 'm', baseUrl: '' }, none).ok, false);
  assert.equal(checkProviderAllowed({ provider: 'deepseek', model: 'm', baseUrl: '' }, none).ok, false);
  assert.deepEqual(mergePolicies({}, { allowedProviders: ['openai'] }).allowedProviders, ['openai']);
  assert.equal(mergePolicies({}, {}).allowedProviders, null);
  // keyStorage set by the build: a managed policy can only move it to a stricter mode.
  assert.equal(mergePolicies({ keyStorage: 'encrypted' }, { keyStorage: 'local' }).keyStorage, 'encrypted');
  assert.equal(mergePolicies({ keyStorage: 'encrypted' }, { keyStorage: 'session' }).keyStorage, 'session');
});

test('instance lists with wildcards are intersected exactly', () => {
  const exact = mergePolicies({ allowedInstances: ['https://a.corp.example', 'https://b.other.example'] }, { allowedInstances: ['*.corp.example'] });
  assert.deepEqual(exact.allowedInstances, ['https://a.corp.example']);
  const nested = mergePolicies({ allowedInstances: ['*.corp.example'] }, { allowedInstances: ['*.eu.corp.example', '*.other.example'] });
  assert.deepEqual(nested.allowedInstances, ['*.eu.corp.example']);
  assert.equal(isInstanceAllowed('https://x.eu.corp.example', nested), true);
  assert.equal(isInstanceAllowed('https://x.us.corp.example', nested), false);
  const none = mergePolicies({ allowedInstances: ['https://a.corp.example'] }, { allowedInstances: ['https://b.corp.example'] });
  assert.deepEqual(none.allowedInstances, []);
  assert.equal(isInstanceAllowed('https://a.corp.example', none), false);
  assert.equal(mergePolicies({}, {}).allowedInstances, null);
});

test('combining is stable: reading the result again with the same floor changes nothing', () => {
  const samples = [{}, { aiProvider: 'anthropic' }, { allowedModels: ['other'] }, { allowedInstances: ['*.service-now.com'] }, { piiMode: 'local-only', blockedTables: ['incident'] }, { aiBaseUrl: 'http://bad.example' }, { allowedInstances: [] }];
  for (const managed of samples) {
    const once = merged(managed);
    assert.deepEqual(mergePolicies(FLOOR, once), once, JSON.stringify(managed));
  }
});

// ---- the build itself ----------------------------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbuddy-enterprise-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const build = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'build.js'), ...args], { cwd: ROOT, encoding: 'utf8' });
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('node build.js --enterprise writes a working enterprise build into its own folder', () => {
  const out = path.join(tmp, 'enterprise');
  const r = build('--enterprise', 'enterprise/example.json', '--out', out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /connect-src:\s+https:\/\/ai-gateway\.example\.com/);
  const built = JSON.parse(read(out, 'manifest.json'));
  assert.deepEqual(built, enterpriseManifest(JSON.parse(read(ROOT, 'manifest.json')), validateEnterpriseConfig(example).plan));
  for (const file of ['background.bundle.js', 'content.bundle.js', 'sidepanel.bundle.js', 'options.bundle.js', 'dashboard.bundle.js']) {
    const text = read(out, file);
    assert.ok(text.includes('"https://example-test.service-now.com"'), `${file} carries the compiled-in policy`);
    assert.ok(!/BAKED_POLICY\d*\s*=\s*null/.test(text), `${file} has no empty policy`);
  }
  assert.ok(!read(out, 'pagebridge.js').includes('BAKED_POLICY'), 'the page bridge has no policy at all');
});

test('the normal build is unchanged: the manifest as it is in the repository, no compiled-in policy', () => {
  const out = path.join(tmp, 'normal');
  const r = build('--out', out);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(read(out, 'manifest.json'), read(ROOT, 'manifest.json').replace(/\r\n/g, '\n'));
  assert.equal(read(out, 'managed_schema.json'), read(ROOT, 'managed_schema.json').replace(/\r\n/g, '\n'));
  for (const file of ['background.bundle.js', 'content.bundle.js', 'sidepanel.bundle.js', 'options.bundle.js', 'dashboard.bundle.js']) {
    assert.match(read(out, file), /BAKED_POLICY\d*\s*=\s*null/, file);
  }
});

test('the compiled-in policy really is the floor inside a bundle made with the build\'s own plugin', () => {
  const script = `
    const esbuild = require('esbuild');
    const path = require('path');
    const { loadEsm } = require('./scripts/lib/load-esm.js');
    const { bakedPolicyPlugin } = require('./scripts/lib/baked-plugin.js');
    const tools = loadEsm(process.cwd(), 'src/policy/enterprise.js');
    const plan = tools.validateEnterpriseConfig(require('./enterprise/example.json')).plan;
    const outfile = path.join(${JSON.stringify(tmp)}, 'floor.cjs');
    esbuild.build({
      stdin: { contents: "export { normalizePolicy, bakedPolicy } from './src/policy/policy.js';", resolveDir: process.cwd(), loader: 'js' },
      bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', absWorkingDir: process.cwd(),
      plugins: [bakedPolicyPlugin(tools.bakedModuleSource(plan.policy, plan.label), tools.BAKED_MODULE_FILTER)],
    }).then(() => {
      const m = require(outfile);
      const loose = m.normalizePolicy({ piiMode: 'standard', allowedInstances: ['https://other.service-now.com'], allowHrContent: true });
      const tight = m.normalizePolicy({ previewMode: 'always', blockedTables: ['incident'] });
      process.stdout.write(JSON.stringify({ baked: m.bakedPolicy() !== null, empty: m.normalizePolicy({}), loose, tight }));
    }).catch((e) => { console.error(e); process.exit(1); });`;
  const r = spawnSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.baked, true);
  assert.deepEqual(got.empty.allowedInstances, example.allowedInstances);
  assert.equal(got.empty.aiBaseUrl, 'https://ai-gateway.example.com/v1');
  assert.deepEqual([got.loose.piiMode, got.loose.allowedInstances, got.loose.allowHrContent], ['strict', [], false]);
  assert.deepEqual([got.tight.previewMode, got.tight.blockedTables, got.tight.piiMode], ['always', ['incident'], 'strict']);
});

test('a bad config builds nothing and leaves the output folder alone', () => {
  const out = path.join(tmp, 'kept');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), '{}');
  const config = path.join(tmp, 'bad.json');
  fs.writeFileSync(config, JSON.stringify({ allowedInstances: ['*.service-now.com'], aiProvider: 'openai', providedApiKey: 'sk-1' }));
  const r = build('--enterprise', config, '--out', out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing was built/);
  assert.match(r.stderr, /wildcards are not allowed/);
  assert.match(r.stderr, /providedApiKey is not allowed/);
  assert.equal(read(out, 'manifest.json'), '{}');
  const broken = path.join(tmp, 'broken.json');
  fs.writeFileSync(broken, '{ not json');
  assert.match(build('--enterprise', broken, '--out', out).stderr, /cannot read the enterprise config/);
});

test('the build refuses output folders it must not empty', () => {
  const stranger = path.join(tmp, 'stranger');
  fs.mkdirSync(stranger, { recursive: true });
  fs.writeFileSync(path.join(stranger, 'notes.txt'), 'mine');
  const cases = [
    [['--out', 'src'], /cannot be inside src/],
    [['--out', 'SRC/x'], /cannot be inside src/],
    [['--out', '.'], /project folder itself/],
    [['--out', '..'], /cannot contain the project folder|root of a drive/],
    [['--out', stranger], /does not look like an earlier build/],
    [['--enterprise', 'enterprise/example.json', '--out', 'dist'], /never goes into dist/],
    [['--out'], /needs a value/],
    [['--fast'], /unknown option/],
  ];
  for (const [args, re] of cases) {
    const r = build(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, re, args.join(' '));
  }
  assert.equal(read(stranger, 'notes.txt'), 'mine');
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'policy', 'policy.js')));
});
