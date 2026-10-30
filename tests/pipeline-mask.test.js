import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRun, executeRun, maskMore, auditCancelled, errorReason } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall } from '../src/pii/index.js';
import { isSealed } from '../src/pii/seal.js';
import { makeAuditEntry } from '../src/audit/auditLog.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

// "Mask this too" end to end through the pipeline with the REAL firewall, and what the send step does with the answer.

const PACK = {
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { short_description: 'VPN fails for Abel Tuter', description: 'Carol Diaz and Zed Alpha share the VPN profile. carol diaz agrees.' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [{ when: '2026-10-26 09:10:00', by: 'Abel Tuter', type: 'comment', text: 'Still failing, Carol Diaz too. My password: Summer2024!' }],
  related: {},
  access: [],
};
const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const prepare = (over = {}) => prepareRun({ feature: featureById('record-summary'), pack: PACK, values: values(over), policy: normalizePolicy({}), config: config(), createFirewall });
const userOf = (request) => request.messages.find((m) => m.role === 'user').content;

test('prepareRun keeps what the firewall was given (memory only, frozen) so it can build the same request again', () => {
  const p = prepare();
  assert.ok(Object.isFrozen(p.input) && Object.isFrozen(p.input.parts));
  assert.equal(p.input.feature, 'record-summary');
  assert.equal(p.input.system, featureById('record-summary').system);
  assert.ok(p.input.parts.some((x) => x.text.includes('Carol Diaz')));
  assert.equal(p.preview, p.request.preview);
});

test('maskMore: the same firewall masks the text everywhere and seals the request again; the old run is untouched', () => {
  const p = prepare();
  assert.ok(p.request.preview.includes('Carol Diaz'), 'no cue: not found by the detectors');
  const out = maskMore(p, '  Carol Diaz ');
  assert.equal(out.ok, true);
  assert.equal(out.masked, 3, 'two in the description (any case), one in the comment');
  assert.ok(isSealed(out.prepared.request));
  assert.notEqual(out.prepared.request, p.request);
  assert.ok(!/carol diaz/i.test(out.prepared.request.preview));
  assert.equal(out.prepared.preview, out.prepared.request.preview);
  assert.equal(out.prepared.stats, out.prepared.request.stats);
  assert.equal(out.prepared.stats.counts.MANUAL, 3);
  assert.equal(out.prepared.masks, 1);
  assert.equal(out.prepared.firewall, p.firewall, 'the same firewall: one numbering, one rehydration');
  assert.ok(p.request.preview.includes('Carol Diaz'), 'the earlier request is frozen and unchanged');
  // and again, on top
  const twice = maskMore(out.prepared, 'Zed Alpha');
  assert.equal(twice.ok, true);
  assert.equal(twice.prepared.masks, 2);
  assert.ok(!/zed alpha|carol diaz/i.test(twice.prepared.request.preview));
  assert.equal(twice.prepared.stats.counts.MANUAL, 4);
});

test('maskMore says why nothing changed, and never changes the run then', () => {
  const p = prepare();
  const cases = [
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    [undefined, 'EMPTY'],
    ['x', 'SHORT'],
    ['--', 'SHORT'],
    ['y'.repeat(201), 'LONG'],
    ['[PERSON_1] said', 'PLACEHOLDER'],
    ['(EMAIL_1)', 'PLACEHOLDER'],
    ['nowhere to be seen', 'NOT_FOUND'],
    ['Rules set by the application', 'NOT_DATA'],
  ];
  for (const [text, problem] of cases) assert.deepEqual(maskMore(p, text), { ok: false, problem }, String(text).slice(0, 20));
  assert.ok(p.request.preview.includes('Carol Diaz'));
  // a firewall that refuses: the run stays as it was
  const refusing = { ...p, firewall: { buildRequest: () => { throw new Error('no'); } } };
  assert.deepEqual(maskMore(refusing, 'Carol Diaz'), { ok: false, problem: 'FAILED' });
  assert.deepEqual(maskMore({}, 'Carol Diaz'), { ok: false, problem: 'FAILED' });
});

test('the request that is sent after maskMore is the new one; the answer comes back with the real text; the audit has numbers only', async () => {
  const out = maskMore(prepare(), 'Carol Diaz');
  const placeholder = /\[PERSON_\d+\]/g;
  let sent = null;
  const audits = [];
  const result = await executeRun({
    prepared: out.prepared,
    config: config(),
    values: values(),
    previewShown: true,
    sendChat: async (cfg, request) => {
      sent = request;
      const tokens = userOf(request).match(placeholder);
      return { content: `Ask ${tokens.join(' and ')} to retry.`, usage: { input: 5, output: 5 } };
    },
    logAudit: async (entry) => audits.push(entry),
  });
  assert.equal(sent, out.prepared.request, 'exactly the request the preview showed');
  assert.ok(!/carol diaz/i.test(sent.messages.map((m) => m.content).join('\n')));
  assert.match(result.text, /Carol Diaz/);
  assert.match(result.text, /Abel Tuter/);
  const entry = makeAuditEntry(audits[0]);
  assert.equal(entry.counts.MANUAL, 3);
  assert.equal(entry.preview, 'shown');
  assert.ok(!JSON.stringify(entry).toLowerCase().includes('carol'), 'no content in the audit entry');
});

test('a cancelled preview after maskMore is audited with the new counts', async () => {
  const out = maskMore(prepare(), 'Zed Alpha');
  const audits = [];
  await auditCancelled({ feature: out.prepared.feature, pack: PACK, config: config(), values: values(), stats: out.prepared.stats, logAudit: async (e) => audits.push(e) });
  const entry = makeAuditEntry(audits[0]);
  assert.equal(entry.outcome, 'cancelled');
  assert.equal(entry.counts.MANUAL, 1);
  assert.ok(!JSON.stringify(entry).includes('Zed'));
});

test('the answer never gets a password, card or ID number back, even when the model repeats its placeholder', async () => {
  const p = prepare();
  const secret = /\[SECRET_\d+\]/.exec(userOf(p.request))[0];
  const person = /\[PERSON_\d+\]/.exec(userOf(p.request))[0];
  const out = await executeRun({ prepared: p, config: config(), values: values(), sendChat: async () => ({ content: `Tell ${person} the password ${secret} must be changed.` }), logAudit: async () => {} });
  assert.equal(out.text, `Tell Abel Tuter the password ${secret} must be changed.`);
  assert.ok(!out.text.includes('Summer2024!'));
});

test('executeRun hands the AbortSignal to the provider and passes on a cut-short answer as a notice', async () => {
  const p = prepare();
  const controller = new AbortController();
  let options = null;
  const out = await executeRun({
    prepared: p,
    config: config(),
    values: values(),
    host: 'acme.service-now.com',
    signal: controller.signal,
    sendChat: async (cfg, request, opts) => {
      options = opts;
      return { content: 'Partial answer', truncated: true, stopReason: 'max_tokens', usage: {} };
    },
    logAudit: async () => {},
  });
  assert.equal(options.signal, controller.signal);
  assert.equal(options.host, 'acme.service-now.com');
  assert.equal(out.truncated, true);
  assert.match(out.notice, /cut short/);
  const whole = await executeRun({ prepared: p, config: config(), values: values(), sendChat: async () => ({ content: 'All of it' }), logAudit: async () => {} });
  assert.equal(whole.truncated, false);
  assert.equal(whole.notice, '');
});

test('a request the person stopped is audited as cancelled, a provider error with its code', async () => {
  const p = prepare();
  const audits = [];
  const fail = (code, message) => async () => {
    throw Object.assign(new Error(message), { code });
  };
  await assert.rejects(() => executeRun({ prepared: p, config: config(), values: values(), sendChat: fail('CANCELLED', 'Cancelled.'), logAudit: async (e) => audits.push(e) }), /Cancelled/);
  await assert.rejects(() => executeRun({ prepared: p, config: config(), values: values(), sendChat: fail('RATE_LIMIT', 'Too many requests'), logAudit: async (e) => audits.push(e) }));
  assert.deepEqual(audits.map((a) => [a.outcome, a.reason]), [['cancelled', 'CANCELLED'], ['error', 'RATE_LIMIT']]);
  assert.equal(errorReason({ code: 'TIMEOUT' }), 'TIMEOUT');
});
