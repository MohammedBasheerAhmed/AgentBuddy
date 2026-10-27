import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareFlow, sendFlow } from '../src/sidepanel/runFlow.js';
import { prepareRun, executeRun, previewRequired, auditBlocked, RunBlocked } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy, effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { makeTokens } from '../src/sidepanel/runLogic.js';

// The steps of a run with every dependency replaced (integration review T4): the order, what is audited, and how an abandoned
// run is dropped. The real policy checks and the real pipeline functions are used; the privacy filter, the network and the
// audit log are stand-ins (the filter itself is tested in tests/pii-*.test.js).

const PACK = {
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN fails', state: 'In Progress' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: {},
  access: [],
};
const fakeFirewall = () => ({
  buildRequest: (req) => ({ messages: [{ role: 'system', content: req.system }], preview: 'PREVIEW', stats: { total: 0, counts: {} } }),
  rehydrate: (t) => t,
  scan: () => [],
});

function world(over = {}) {
  const calls = [];
  const audits = [];
  const sent = [];
  const deps = {
    ensureAiPermission: async () => calls.push('permission'),
    prepareRun: (args) => {
      calls.push('prepare');
      return prepareRun(args);
    },
    previewRequired,
    auditBlocked,
    createFirewall: fakeFirewall,
    logAudit: async (entry) => audits.push(entry),
    executeRun,
    sendChat: async (config, request) => {
      sent.push(request);
      return { content: over.answer ?? 'Cause: the certificate expired.', usage: {} };
    },
    ...over.deps,
  };
  return { calls, audits, sent, deps };
}
const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const feature = featureById('record-summary');
const base = (w, over = {}) => ({
  feature,
  getPack: undefined,
  readPack: async () => PACK,
  readOp: async () => ({}),
  allowSensitive: false,
  config: config(),
  values: values({ previewMode: 'always' }),
  policy: normalizePolicy({}),
  isCurrent: () => true,
  deps: w.deps,
  ...over,
});

test('the happy path: permission, read, prepare, then a preview is asked for; nothing is sent yet', async () => {
  const w = world();
  const out = await prepareFlow(base(w));
  assert.equal(out.status, 'ready');
  assert.equal(out.preview, true);
  assert.deepEqual(w.calls, ['permission', 'prepare']);
  assert.equal(w.sent.length, 0, 'nothing leaves before the person has seen it');
  assert.equal(w.audits.length, 0);
});

test('preview mode "first": shown the first time, not after, and always for a pack that asks for it', async () => {
  const once = async (previewSeen, read) => (await prepareFlow(base(world(), { values: values({ previewMode: 'first', previewSeen }), readPack: read || (async () => PACK) }))).preview;
  assert.equal(await once([]), true);
  assert.equal(await once(['record-summary']), false);
  assert.equal(await once(['record-summary'], async () => ({ ...PACK, requirePreview: true })), true);
});

test('a custom getPack replaces the default read, and a feature\'s enrich is applied to what it returns', async () => {
  const w = world();
  let defaultRead = 0;
  const enriching = { ...feature, enrich: async (pack, ctx) => ({ ...pack, fields: { ...pack.fields, short_description: `${pack.fields.short_description} (+${typeof ctx.read})` } }) };
  const out = await prepareFlow(base(w, { feature: enriching, getPack: async () => PACK, readPack: async () => { defaultRead += 1; return PACK; } }));
  assert.equal(defaultRead, 0);
  assert.match(out.prepared.pack.fields.short_description, /VPN fails \(\+function\)/);
});

test('a run that is dropped while the pack is being read stops there: nothing is prepared, audited or sent', async () => {
  const w = world();
  const tokens = makeTokens();
  const mine = tokens.next();
  const out = await prepareFlow(base(w, { isCurrent: () => tokens.isCurrent(mine), readPack: async () => { tokens.drop(); return PACK; } }));
  assert.equal(out.status, 'abandoned');
  assert.deepEqual(w.calls, ['permission'], 'prepareRun was never called');
  assert.equal(w.audits.length, 0);
});

test('a run that is dropped while enrich is working stops before the privacy filter', async () => {
  const w = world();
  const tokens = makeTokens();
  const mine = tokens.next();
  const slow = { ...feature, enrich: async (pack) => { tokens.drop(); return pack; } };
  const out = await prepareFlow(base(w, { feature: slow, isCurrent: () => tokens.isCurrent(mine) }));
  assert.equal(out.status, 'abandoned');
  assert.ok(!w.calls.includes('prepare'));
});

test('a refusal by policy is audited as blocked, reported as a failure, and nothing is sent', async () => {
  const w = world();
  const out = await prepareFlow(base(w, { policy: normalizePolicy({ disabledFeatures: ['record-summary'] }) }));
  assert.equal(out.status, 'failed');
  assert.ok(out.error instanceof RunBlocked);
  assert.equal(out.error.message, 'Your organisation has switched this feature off.');
  assert.equal(w.audits.length, 1);
  assert.equal(w.audits[0].outcome, 'blocked');
  assert.equal(w.audits[0].feature, 'record-summary');
  assert.equal(w.sent.length, 0);
});

test('a firewall refusal is audited as blocked too; any other failure is reported but not audited as a block', async () => {
  const firewallError = Object.assign(new Error('blocked field'), { name: 'FirewallError', code: 'BLOCKED_FIELD' });
  const w1 = world({ deps: { prepareRun: () => { throw firewallError; } } });
  const a = await prepareFlow(base(w1));
  assert.equal(a.status, 'failed');
  assert.equal(w1.audits[0]?.outcome, 'blocked');
  const w2 = world();
  const b = await prepareFlow(base(w2, { readPack: async () => { throw new Error('Agent Buddy lost touch with this page.'); } }));
  assert.equal(b.status, 'failed');
  assert.equal(b.error.message, 'Agent Buddy lost touch with this page.');
  assert.equal(w2.audits.length, 0);
});

test('an error that arrives after the run was dropped is not shown; a refusal is still put on record', async () => {
  const tokens = makeTokens();
  const mine = tokens.next();
  const w = world({ deps: { ensureAiPermission: async () => { tokens.drop(); throw new Error('The browser did not allow Agent Buddy to reach the AI address.'); } } });
  const out = await prepareFlow(base(w, { isCurrent: () => tokens.isCurrent(mine) }));
  assert.equal(out.status, 'abandoned', 'the person moved on: no error card for a run they walked away from');
  // a policy refusal found while the person is still there is audited as blocked, and shown (see the test above); one that
  // comes from the firewall after a drop is audited the same way and then dropped
  const t2 = makeTokens();
  const m2 = t2.next();
  const w2 = world({ deps: { prepareRun: () => { t2.drop(); throw Object.assign(new Error('blocked field'), { name: 'FirewallError', code: 'BLOCKED_FIELD' }); } } });
  const out2 = await prepareFlow(base(w2, { isCurrent: () => t2.isCurrent(m2) }));
  assert.equal(out2.status, 'abandoned');
  assert.equal(w2.audits.at(-1)?.outcome, 'blocked', 'the refusal is on record even though nobody sees it');
  assert.equal(w2.sent.length, 0);
});

test('the permission step comes first: a refusal stops the run before any read', async () => {
  const w = world({ deps: { ensureAiPermission: async () => { throw new Error('The browser did not allow Agent Buddy to reach the AI address.'); } } });
  let read = 0;
  const out = await prepareFlow(base(w, { readPack: async () => { read += 1; return PACK; } }));
  assert.equal(out.status, 'failed');
  assert.equal(read, 0);
});

// ---- sending ---------------------------------------------------------------------------------------------------------------

const ready = async (w) => (await prepareFlow(base(w))).prepared;
const sendArgs = (w, prepared, over = {}) => ({ prepared, config: config(), values: values(), host: 'acme.service-now.com', previewShown: true, isCurrent: () => true, deps: w.deps, ...over });

test('send: the answer comes back as text and the call is audited as sent with the preview shown', async () => {
  const w = world();
  const out = await sendFlow(sendArgs(w, await ready(w)));
  assert.deepEqual(out, { status: 'done', text: 'Cause: the certificate expired.' });
  assert.equal(w.sent.length, 1);
  assert.equal(w.audits.at(-1).outcome, 'sent');
  assert.equal(w.audits.at(-1).preview, 'shown');
});

test('L9: an empty answer is a failure with a plain message, not an empty card', async () => {
  for (const answer of ['', '   \n']) {
    const w = world({ answer });
    const out = await sendFlow(sendArgs(w, await ready(w)));
    assert.equal(out.status, 'failed');
    assert.equal(out.error.message, 'The AI sent back nothing. Try again.');
  }
});

test('an answer that arrives after the run was dropped is not shown (the request still happened and is audited)', async () => {
  const w = world();
  const tokens = makeTokens();
  const mine = tokens.next();
  const prepared = await ready(w);
  const pending = sendFlow(sendArgs(w, prepared, { isCurrent: () => tokens.isCurrent(mine) }));
  tokens.drop(); // the person pressed Cancel while it was on its way
  const out = await pending;
  assert.equal(out.status, 'abandoned');
  assert.equal(w.sent.length, 1, 'the provider was already called');
  assert.equal(w.audits.at(-1).outcome, 'sent', 'and the log says so: the request cannot be called back');
});

test('a provider error is reported (and audited as an error); after the run was dropped it is silent', async () => {
  const boom = { deps: { sendChat: async () => { throw new Error('The AI provider rejected the API key.'); } } };
  const w = world(boom);
  const out = await sendFlow(sendArgs(w, await ready(w)));
  assert.equal(out.status, 'failed');
  assert.equal(out.error.message, 'The AI provider rejected the API key.');
  assert.equal(w.audits.at(-1).outcome, 'error');
  assert.equal(w.audits.at(-1).reason, 'BAD_KEY');

  const w2 = world(boom);
  const dropped = await sendFlow(sendArgs(w2, await ready(w2), { isCurrent: () => false }));
  assert.equal(dropped.status, 'abandoned');
});
