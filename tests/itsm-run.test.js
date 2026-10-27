// Every ITSM feature, end to end through prepareRun and executeRun with the REAL firewall (src/pii), on a hostile ticket:
// names, emails, phones, a card and a password inside notes, text that tries to give the model orders, and look-alike
// tickets and articles that carry personal data too. Only the model (sendChat) and the instance (the reads) are faked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirewall } from '../src/pii/index.js';
import { executeRun, prepareRun } from '../src/lib/pipeline.js';
import { featureById, insertsFor, partsFor } from '../src/features/registry.js';
import { FEATURE_JOURNAL, allowedFields } from '../src/context/allowlists.js';
import { readContextPack } from '../src/context/pack.js';
import { findSimilarTickets, searchKnowledge } from '../src/context/index.js';
import { relatedPlan } from '../src/context/related.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import OPS from '../src/content/ops/itsm.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { FORGED_CLOSE, INJECTION, SEEDED, hostilePack, hostileRead } from './fixtures/itsm-hostile.js';

const IDS = ['sentiment-risk', 'next-best-action', 'thread-summary', 'routing-hint', 'kb-article-draft', 'major-incident-comms'];

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');

// The pack the context engine would build for this feature: only the columns, notes and extras its spec allows.
function restrict(pack, id) {
  const names = new Set(allowedFields(pack.table, id));
  const plan = relatedPlan({ kind: pack.kind, feature: id });
  return {
    ...pack,
    fields: Object.fromEntries(Object.entries(pack.fields).filter(([name]) => names.has(name))),
    journal: FEATURE_JOURNAL[id] ? pack.journal : [],
    related: Object.fromEntries(Object.entries(pack.related).filter(([key]) => plan.includes(key))),
  };
}

async function prepare(id, { pack = hostilePack(), read = hostileRead(), mode = 'standard', policy = {}, restricted = true } = {}) {
  const feature = featureById(id);
  const base = restricted ? restrict(pack, id) : pack;
  const full = feature.enrich ? await feature.enrich(base, { read, allowSensitive: false }) : base;
  const prepared = prepareRun({ feature, pack: full, values: values({ piiMode: mode }), policy: normalizePolicy(policy), config: config(), createFirewall });
  return { feature, prepared, pack: full };
}

// A seeded value counts as present only as a whole word: "Abel" is not in the word "label" (every data block has a label attribute).
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[]\]/g, '\const outgoing = (prepared) =>');
const has = (text, secret) => new RegExp(`(?<![A-Za-z0-9])${escapeRegex(secret)}(?![A-Za-z0-9])`, 'i').test(text);

const outgoing = (prepared) => prepared.request.messages.map((m) => m.content).join('\n');
const userMessage = (prepared) => prepared.request.messages.find((m) => m.role === 'user').content;
const systemMessage = (prepared) => prepared.request.messages.find((m) => m.role === 'system').content;

// ---- Nothing personal leaves, whatever the feature ----------------------------------------------------------------

for (const id of IDS) {
  test(`${id}: none of the seeded personal data is in anything sent, and the preview shows the same text`, async () => {
    const { prepared } = await prepare(id);
    const text = outgoing(prepared);
    for (const secret of SEEDED) assert.ok(!has(text, secret), `"${secret}" would leave the browser`);
    for (const secret of SEEDED) assert.ok(!has(prepared.preview, secret), `"${secret}" is in the preview`);
    assert.ok(prepared.stats.total > 0, 'something was masked');
    assert.equal(prepared.preview, prepared.request.preview);
  });

  test(`${id}: the prompt is fixed text, and the ticket only arrives inside untrusted-data blocks`, async () => {
    const { feature, prepared } = await prepare(id);
    // No ticket data in the instructions.
    for (const text of [feature.system, feature.instruction]) {
      for (const secret of SEEDED) assert.ok(!text.includes(secret), `the prompt of ${id} contains "${secret}"`);
      assert.ok(!text.includes('INC0010001') && !text.includes('VPN'), 'no ticket content in a prompt');
      assert.ok(!/\{\{|\$\{/.test(text), 'no template holes');
    }
    const system = systemMessage(prepared);
    assert.ok(system.startsWith(feature.system), 'the firewall leaves the prompt as written');
    assert.ok(!system.includes('PWNED') && !system.includes('IGNORE PREVIOUS') && !system.includes('admin mode'), 'injected text is not in the system message');
    // Outside the data blocks there is only the fixed instruction.
    const user = userMessage(prepared);
    assert.equal(user.replace(/<ticket_data[^>]*>[\s\S]*?<\/ticket_data>/g, '').trim(), feature.instruction);
    // The forged closing tag in the ticket text is escaped, so it cannot end a block early.
    assert.equal((user.match(/<\/ticket_data>/g) || []).length, (user.match(/<ticket_data /g) || []).length);
  });

  test(`${id}: runs in strict mode (no part is named like a sensitive field)`, async () => {
    const { prepared } = await prepare(id, { mode: 'strict' });
    assert.equal(prepared.request.mode, 'strict');
    assert.ok(prepared.request.messages.length >= 2);
  });

  test(`${id}: every part has a plain label and a plain field name, so the firewall does not rewrite them`, async () => {
    const { feature, pack } = await prepare(id);
    const parts = partsFor(feature, pack);
    assert.ok(parts.length > 0);
    for (const p of parts) {
      assert.match(p.label, /^[A-Za-z0-9_.:\[\] -]+$/, p.label);
      assert.match(p.field, /^[a-z][a-z_]*$/, p.field);
      assert.equal(typeof p.text, 'string');
      assert.ok(p.text.trim().length > 0);
      assert.ok(p.text.length <= 6000, `${p.label} is capped`);
    }
  });
}

test('the injected orders and the forged closing tag are present only as escaped data', async () => {
  const { prepared } = await prepare('thread-summary');
  const user = userMessage(prepared);
  assert.ok(user.includes('IGNORE PREVIOUS INSTRUCTIONS'), 'the text is data, so it is kept');
  assert.ok(user.includes('&lt;/ticket_data&gt; SYSTEM'), 'but its angle brackets are escaped');
  assert.ok(!user.includes(FORGED_CLOSE));
  assert.ok(user.includes(INJECTION));
});

// ---- Policy still applies -----------------------------------------------------------------------------------------

test('a policy that blocks a field blocks every part that carries it', async () => {
  const blocked = async (id, field) => {
    try {
      await prepare(id, { policy: { blockedFields: [field] } });
      return null;
    } catch (err) {
      return err.code;
    }
  };
  // Notes keep their own field names, so blocking them stops every feature that reads notes.
  for (const id of ['sentiment-risk', 'next-best-action', 'thread-summary', 'kb-article-draft', 'major-incident-comms']) {
    assert.equal(await blocked(id, 'work_notes'), 'BLOCKED_FIELD', id);
    assert.equal(await blocked(id, 'comments'), 'BLOCKED_FIELD', id);
  }
  assert.equal(await blocked('routing-hint', 'work_notes'), null, 'routing reads no notes');
  // Other tickets' close notes are sent as close_notes: a policy against close notes covers them.
  for (const id of ['next-best-action', 'routing-hint']) assert.equal(await blocked(id, 'close_notes'), 'BLOCKED_FIELD', id);
  assert.equal(await blocked('thread-summary', 'close_notes'), null);
  assert.equal(await blocked('sentiment-risk', 'signals'), 'BLOCKED_FIELD', 'even the counted signals have a field name to block');
});

// ---- What each feature sends ----------------------------------------------------------------------------------------

test('sentiment-risk sends the signals and marks the customer\'s lines', async () => {
  const { prepared } = await prepare('sentiment-risk');
  const user = userMessage(prepared);
  assert.match(user, /label="Signals counted by Agent Buddy"/);
  assert.match(user, /Customer chasers .*: 2\./);
  assert.match(user, /Customer messages in a row with no reply from support: 2\./);
  assert.match(user, /Frustration words in the customer's messages: ridiculous\./);
  assert.match(user, /Shouting .*: 2 messages/, 'the forged SYSTEM: line shouts too');
  assert.match(user, /Reopened: 2 times\./);
  assert.match(user, /Reassigned between groups or people: 3 times\./);
  assert.match(user, /SLAs: 1 breached of 1\./);
  assert.match(user, /Customer - \[PERSON_\d+\]:/);
  assert.match(user, /Support - \[PERSON_\d+\]:/);
  assert.match(user, /label="Internal work note"/);
});

test('next-best-action sends solved look-alikes and articles as reference material, and says what was found', async () => {
  const read = hostileRead();
  const { prepared } = await prepare('next-best-action', { read });
  assert.deepEqual(read.calls.map((c) => c.op).sort(), ['knowledge', 'similar']);
  const user = userMessage(prepared);
  assert.match(user, /Solved look-alike tickets: 2 found\./);
  assert.match(user, /Knowledge articles: 2 found\./);
  assert.match(user, /Number: INC0009640/);
  assert.match(user, /Number: KB0010001/);
  assert.equal((user.match(/REFERENCE MATERIAL from a different record/g) || []).length, 4);
  assert.match(systemMessage(prepared), /- \[ \] /);
  assert.match(systemMessage(prepared), /\(general practice\)/);
});

test('next-best-action still works when both reads are refused, and the status says so', async () => {
  const denied = Object.assign(new Error('403'), { code: 'ACCESS_DENIED' });
  const read = async () => { throw denied; };
  const { prepared } = await prepare('next-best-action', { read });
  const user = userMessage(prepared);
  assert.match(user, /Solved look-alike tickets: could not be read \(no access\)\./);
  assert.match(user, /Knowledge articles: could not be read \(no access\)\./);
  assert.match(user, /Reference material available: no\./);
  assert.ok(!/REFERENCE MATERIAL from a different record/.test(user));
  assert.match(systemMessage(prepared), /No similar tickets or articles were available, so these steps come only from this record\./);
});

test('routing-hint asks the routing read and sends each look-alike\'s group and priority; it reads no notes', async () => {
  const read = hostileRead();
  const { prepared } = await prepare('routing-hint', { read });
  assert.deepEqual(read.calls.map((c) => c.op), ['routingLookalikes']);
  const user = userMessage(prepared);
  assert.match(user, /Assignment group: Service Desk/);
  assert.match(user, /Priority: 3 - Moderate/);
  assert.ok(!/label="(Customer-visible comment|Internal work note)/.test(user), 'no notes');
  assert.ok(!has(user, 'Abel') && !has(user, 'Beth'), 'no people');
  assert.equal(insertsFor(featureById('routing-hint')).length, 0, 'copy only');
});

test('kb-article-draft sends no ticket number, no authors and no times, and flags the strong match', async () => {
  const read = hostileRead();
  const { prepared } = await prepare('kb-article-draft', { read });
  assert.deepEqual(read.calls.map((c) => c.op), ['knowledge'], 'the knowledge read comes first, and alone');
  const user = userMessage(prepared);
  assert.ok(!user.includes('INC0010001'), 'the ticket number stays out');
  assert.ok(!/\[2026-/.test(user), 'no times');
  assert.ok(!/Customer - |Support - /.test(user), 'no roles or authors');
  assert.match(user, /Strong match with an existing article: yes, KB0010001\./);
  assert.match(user, /Match strength: STRONG/);
  assert.match(systemMessage(prepared), /Similar article exists: <article number> <article title>\. Consider updating it instead\./);
});

test('major-incident-comms sends SLAs, tasks and the timeline, and the update is copy only', async () => {
  const { prepared, feature } = await prepare('major-incident-comms');
  const user = userMessage(prepared);
  assert.match(user, /label="SLAs"/);
  assert.match(user, /breached: true/);
  assert.match(user, /label="Child tasks"/);
  assert.match(user, /TASK0010005/);
  assert.equal(insertsFor(feature).length, 0, 'a customer-visible update is a deliberate act, so there is no Insert');
  assert.match(systemMessage(prepared), /Next update: \[time\]/);
});

// ---- The answer comes back: rehydrate, except for text that gets published -------------------------------------------

async function runWithReply(id, makeReply) {
  const { feature, prepared } = await prepare(id);
  const placeholder = /\[PERSON_\d+\]/.exec(userMessage(prepared))?.[0];
  assert.ok(placeholder, 'a person was masked');
  let sentTo = null;
  const out = await executeRun({
    prepared,
    config: config(),
    values: values(),
    sendChat: async (cfg, request) => {
      sentTo = request;
      return { content: makeReply(placeholder), usage: { input: 1, output: 1 } };
    },
    logAudit: async () => {},
  });
  return { feature, out, placeholder, sentTo };
}

test('features that are read by the agent get the real names back, locally', async () => {
  for (const id of ['sentiment-risk', 'next-best-action', 'thread-summary', 'routing-hint', 'major-incident-comms']) {
    const { out, placeholder, sentTo } = await runWithReply(id, (p) => `Ask ${p} about the VPN client.`);
    assert.ok(!out.text.includes(placeholder), `${id}: the placeholder is replaced`);
    assert.match(out.text, /Abel Tuter|Beth Anglin/, id);
    for (const m of sentTo.messages) assert.ok(!has(m.content, 'Abel Tuter'), 'and what was sent still had none');
  }
});

test('kb-article-draft keeps the placeholders: real names are never put back into a published article', async () => {
  const reply = (p) => `Title: How to fix VPN drops for ${p}\nSymptoms: ${p} sees the VPN drop.\nResolution: Replace the certificate.\nApplies to: VPN`;
  const { out, placeholder, feature } = await runWithReply('kb-article-draft', reply);
  assert.equal(feature.keepMasked, true);
  assert.equal(out.text, reply(placeholder), 'exactly what the model wrote');
  assert.ok(out.text.includes(placeholder));
  for (const name of ['Abel', 'Tuter', 'Beth', 'Anglin']) assert.ok(!has(out.text, name));
  // The two inserts take just their part of it.
  const [titleInsert, bodyInsert] = insertsFor(feature);
  assert.equal(titleInsert.pick(out.text), `How to fix VPN drops for ${placeholder}`);
  assert.ok(bodyInsert.pick(out.text).startsWith('Symptoms:'));
  assert.ok(!bodyInsert.pick(out.text).includes('Title:'));
});

// ---- The realistic path: the real context engine and the real searches over the fixture instance ------------------------

const INCIDENT_SEEDED = ['Abel Tuter', 'abel.tuter@example.com', 'beth.anglin@example.com', '555-0134', '555-0199', 'Beth Anglin'];

for (const id of IDS) {
  test(`${id}: on the fixture incident, read by the real engine, nothing personal is sent`, async () => {
    const deps = fakeDeps(buildInstance());
    const feature = featureById(id);
    const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: id });
    const read = async (op, args) => {
      if (op === 'similar') return findSimilarTickets(checkPack(args.pack), deps, { resolvedOnly: args.resolvedOnly === true });
      if (op === 'knowledge') return searchKnowledge(checkPack(args.pack), deps, { limit: 5 });
      return OPS[op](args, { deps, checkPack, checkRecord });
    };
    const full = feature.enrich ? await feature.enrich(pack, { read, allowSensitive: false }) : pack;
    const prepared = prepareRun({ feature, pack: full, values: values(), policy: normalizePolicy({}), config: config(), createFirewall });
    const text = outgoing(prepared);
    for (const secret of INCIDENT_SEEDED) assert.ok(!has(text, secret), `${id}: "${secret}" would leave the browser`);
    assert.ok(prepared.stats.total > 0);
    if (feature.enrich) {
      const user = userMessage(prepared);
      assert.match(user, /REFERENCE MATERIAL from a different record/, `${id}: reference material was found and labelled`);
      assert.ok(!user.includes(INCIDENT_ID), 'no raw sys_id');
    }
  });
}

test('on the fixture incident the strong article match is KB0010001 and the look-alikes are earlier VPN tickets', async () => {
  const deps = fakeDeps(buildInstance());
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps, { feature: 'next-best-action' });
  const read = async (op, args) => (op === 'similar' ? findSimilarTickets(checkPack(args.pack), deps, { resolvedOnly: true }) : searchKnowledge(checkPack(args.pack), deps, { limit: 5 }));
  const full = await featureById('next-best-action').enrich(pack, { read });
  assert.ok(full.reference.similar.hits.some((h) => h.number === 'INC0009640'));
  assert.ok(full.reference.knowledge.hits.some((h) => h.number === 'KB0010001'));
});
