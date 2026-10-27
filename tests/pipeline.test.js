const test = require('node:test');
const assert = require('node:assert/strict');
import { prepareRun, executeRun, previewRequired, assertRunnable, connectionProblem, RunBlocked, errorReason } from '../src/lib/pipeline.js';
import { featureById, featuresFor, partsFor, insertsFor } from '../src/features/registry.js';
import { packToParts, peopleFor } from '../src/features/parts.js';
import { normalizePolicy, effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

const PACK = {
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN fails for Abel Tuter', description: 'Cannot connect, error 809.', state: 'In Progress' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [
    { when: '2026-10-26 09:00:00', by: 'Beth Anglin', type: 'work_note', text: 'Asked Abel to restart.' },
    { when: '2026-10-26 09:10:00', by: 'Abel Tuter', type: 'comment', text: 'Still failing. Call me on 555-123-4567.' },
  ],
  related: {},
  access: [],
};

// A stand-in for the real firewall (tested in tests/pii-*.test.js): records what it was asked and returns a plain object.
function fakeFirewall(opts) {
  const seen = { opts, requests: [] };
  const fw = {
    buildRequest(req) {
      seen.requests.push(req);
      return { messages: [{ role: 'system', content: req.system }, { role: 'user', content: JSON.stringify(req.parts) }], preview: 'PREVIEW', stats: { total: 2, counts: { PERSON: 2 } } };
    },
    rehydrate: (t) => t.replace('[PERSON_1]', 'Abel Tuter'),
  };
  fw.seen = seen;
  return Object.assign(fw, { __seen: seen });
}

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = (over = {}) => ({ ...resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test'), ...over });
const policy = (raw = {}) => normalizePolicy(raw);

test('parts carry only what is on the pack and put authors inside the masked text', () => {
  const parts = packToParts(PACK, { journal: 5 });
  assert.ok(parts.some((p) => p.field === 'short_description'));
  const note = parts.find((p) => p.field === 'work_notes');
  assert.ok(note.text.includes('Beth Anglin'), 'author is inside the text so the firewall masks it');
  assert.ok(!note.label.includes('Beth'), 'labels never carry names');
  assert.deepEqual(peopleFor(PACK).map((p) => p.name).sort(), ['Abel Tuter', 'Beth Anglin']);
});

test('journal limit keeps the newest entries', () => {
  const parts = packToParts(PACK, { journal: 1 });
  const journal = parts.filter((p) => p.field === 'comments' || p.field === 'work_notes');
  assert.equal(journal.length, 1);
  assert.ok(journal[0].text.includes('Still failing'));
});

test('every feature applies to the right record kinds and respects the policy switch', () => {
  assert.ok(featuresFor('incident', policy()).some((f) => f.id === 'record-summary'));
  assert.ok(!featuresFor('change', policy()).some((f) => f.id === 'resolution-notes'));
  assert.ok(!featuresFor('incident', policy({ disabledFeatures: ['record-summary'] })).some((f) => f.id === 'record-summary'));
  featuresFor('incident', policy()).forEach((f) => {
    // A feature may offer one insert, several, or none (Copy only); every insert it does offer names a field.
    assert.ok(f.system && f.instruction && insertsFor(f).every((i) => i.field && i.label), f.id);
    assert.ok(!/\{\{|\$\{/.test(f.system), 'prompts contain no template holes: ticket data only arrives as parts');
  });
});

test('prepareRun builds the request through the firewall with people, mode and allowlisted parts', () => {
  let fw;
  const p = prepareRun({ feature: featureById('record-summary'), pack: PACK, values: values({ piiMode: 'strict' }), policy: policy({ blockedFields: ['x'] }), config: config(), createFirewall: (o) => (fw = fakeFirewall(o)) });
  assert.equal(fw.__seen.opts.mode, 'strict');
  assert.deepEqual(fw.__seen.opts.blockedFields, ['x']);
  assert.equal(fw.__seen.opts.endpointIsLocal, false);
  assert.equal(fw.__seen.opts.people.length, 2);
  const req = fw.__seen.requests[0];
  assert.equal(req.feature, 'record-summary');
  assert.equal(req.table, 'incident');
  assert.ok(req.system.includes('Issue:'));
  assert.equal(p.preview, 'PREVIEW');
});

test('runs are refused before anything is built when policy or setup says no', () => {
  const run = (over) => () =>
    prepareRun({ feature: featureById('record-summary'), pack: PACK, values: values(over.values), policy: policy(over.policy), config: over.config || config(), createFirewall: () => assert.fail('firewall must not be created') });
  assert.throws(run({ policy: { disabledFeatures: ['record-summary'] } }), (e) => e instanceof RunBlocked && e.code === 'FEATURE_OFF');
  assert.throws(run({ policy: { blockedTables: ['incident'] } }), (e) => e.code === 'TABLE_BLOCKED');
  assert.throws(run({ config: config({ apiKey: '' }) }), (e) => e.code === 'NO_KEY');
  assert.throws(run({ config: config({ model: '' }) }), (e) => e.code === 'NO_MODEL');
  assert.throws(run({ values: { piiMode: 'local-only' } }), (e) => e.code === 'NOT_LOCAL');
  assert.throws(run({ policy: { aiProvider: 'openai' } }), (e) => e.code === 'PROVIDER_BLOCKED');
  assert.throws(run({ config: config({ invalidBaseUrl: 'bad' }) }), (e) => e.code === 'BAD_URL');
  // "Other (OpenAI-compatible server)" with no address would fall back to OpenAI's own API with the person's key.
  assert.throws(run({ config: resolveProviderConfig({ provider: 'custom', models: { custom: 'm' } }, 'k') }), (e) => e.code === 'BAD_URL' && /address of your AI server/.test(e.message));
});

test('connectionProblem: a custom provider needs an address; a hosted one may use its own API', () => {
  assert.match(connectionProblem(resolveProviderConfig({ provider: 'custom', models: { custom: 'm' } }, 'k')), /address of your AI server/);
  assert.equal(connectionProblem(resolveProviderConfig({ provider: 'custom', baseUrls: { custom: 'http://localhost:1234/v1' } }, 'k')), '');
  assert.equal(connectionProblem(resolveProviderConfig({ provider: 'openai' }, 'k')), '');
  assert.match(connectionProblem(resolveProviderConfig({ provider: 'custom', baseUrls: { custom: 'ftp://x' } }, 'k')), /not valid/);
});

test('HR content is blocked unless the organisation allows it', () => {
  const hr = { ...PACK, table: 'sn_hr_core_case', kind: 'hr_case' };
  const base = { feature: featureById('record-summary'), pack: hr, values: values(), config: config() };
  assert.throws(() => assertRunnable({ ...base, policy: policy() }), (e) => e.code === 'HR_BLOCKED');
  assert.doesNotThrow(() => assertRunnable({ ...base, policy: policy({ allowHrContent: true, aiProvider: 'anthropic' }) }));
});

test('a feature can require a stricter privacy mode than the person chose', () => {
  const needsStrict = { ...featureById('record-summary'), requires: { minMode: 'strict' } };
  const run = (mode) => assertRunnable({ feature: needsStrict, pack: PACK, values: values({ piiMode: mode }), policy: policy(), config: config() });
  assert.throws(() => run('standard'), (e) => e.code === 'MODE_TOO_LOW' && /Strict/.test(e.message));
  assert.doesNotThrow(() => run('strict'));
  const needsLocal = { ...featureById('record-summary'), requires: { minMode: 'local-only' } };
  assert.throws(() => assertRunnable({ feature: needsLocal, pack: PACK, values: values({ piiMode: 'strict' }), policy: policy(), config: config() }), (e) => e.code === 'MODE_TOO_LOW');
});

test('a default-off feature runs only when the organisation turns coaching on', () => {
  const coaching = { ...featureById('record-summary'), id: 'coaching-snapshot', defaultOff: true };
  const base = { feature: coaching, pack: PACK, values: values(), config: config() };
  assert.throws(() => assertRunnable({ ...base, policy: policy() }), (e) => e.code === 'FEATURE_OFF');
  assert.doesNotThrow(() => assertRunnable({ ...base, policy: policy({ coachingEnabled: true }) }));
  assert.throws(() => assertRunnable({ ...base, policy: policy({ coachingEnabled: true, disabledFeatures: ['coaching-snapshot'] }) }), (e) => e.code === 'FEATURE_OFF');
});

test('keepMasked leaves placeholders in the answer so real names never come back', async () => {
  const fw = fakeFirewall({});
  const feature = { ...featureById('record-summary'), keepMasked: true };
  const prepared = { request: fw.buildRequest({ feature: 'x', system: 's', parts: [] }), firewall: fw, feature, pack: PACK };
  const out = await executeRun({ prepared, config: config(), values: values(), sendChat: async () => ({ content: 'Call [PERSON_1] back.' }), logAudit: async () => {} });
  assert.equal(out.text, 'Call [PERSON_1] back.');
});

test('a local model satisfies local-only mode', () => {
  const local = resolveProviderConfig({ provider: 'ollama' }, '');
  assert.equal(local.local, true);
  assert.doesNotThrow(() => assertRunnable({ feature: featureById('record-summary'), pack: PACK, values: values({ piiMode: 'local-only' }), policy: policy(), config: local }));
});

test('preview rules', () => {
  assert.equal(previewRequired('always', 'f', ['f']), true);
  assert.equal(previewRequired('never', 'f', []), false);
  assert.equal(previewRequired('first', 'f', []), true);
  assert.equal(previewRequired('first', 'f', ['f']), false);
});

test('executeRun re-hydrates locally and audits without content', async () => {
  const audits = [];
  const fw = fakeFirewall({});
  const prepared = { request: fw.buildRequest({ feature: 'x', system: 's', parts: [] }), firewall: fw, feature: featureById('record-summary'), pack: PACK };
  const out = await executeRun({
    prepared, config: config(), values: values(), host: 'acme.service-now.com', previewShown: true,
    sendChat: async () => ({ content: 'Call [PERSON_1] back.', usage: { input: 10, output: 5 } }),
    logAudit: async (e) => audits.push(e),
  });
  assert.equal(out.text, 'Call Abel Tuter back.');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].outcome, 'sent');
  assert.equal(audits[0].preview, 'shown');
  const logged = JSON.stringify(audits[0]);
  assert.ok(!logged.includes('Abel Tuter') && !logged.includes('Call '), 'no ticket or reply text in the audit event');
});

test('a failed send is audited as an error with a machine reason and rethrown', async () => {
  const audits = [];
  const fw = fakeFirewall({});
  const prepared = { request: fw.buildRequest({ feature: 'x', system: 's', parts: [] }), firewall: fw, feature: featureById('record-summary'), pack: PACK };
  await assert.rejects(
    () => executeRun({ prepared, config: config(), values: values(), sendChat: async () => { throw new Error('Anthropic rejected the API key. abel.tuter@example.com'); }, logAudit: async (e) => audits.push(e) }),
    /rejected the API key/
  );
  assert.equal(audits[0].outcome, 'error');
  assert.equal(audits[0].reason, 'BAD_KEY');
  assert.ok(!JSON.stringify(audits[0]).includes('abel.tuter'));
  assert.equal(errorReason(Object.assign(new Error('x'), { code: 'BLOCKED_FIELD' })), 'BLOCKED_FIELD');
  assert.equal(errorReason(new Error('weird')), 'PROVIDER_ERROR');
});

test('partsFor uses the feature journal depth', () => {
  const f = featureById('resolution-notes');
  assert.ok(f.journal >= 20);
  assert.ok(partsFor(f, PACK).length >= 3);
});
