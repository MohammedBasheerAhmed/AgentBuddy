// Security review, pipeline findings: SEC-02 (defence in depth: the table of the form the person is on), SEC-04 (HR needs an approved
// endpoint; custom sensitive prefixes; a record whose real class is unknown), SEC-09 (the daily token budget), SEC-05 (the preview
// is shown every time when the request carries text about other people's tickets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RunBlocked, assertRunnable, assertWithinPolicyBudget, auditBlocked, executeRun, isSensitivePack, prepareRun, previewRequired, requiredMode } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall, FirewallError } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { effectiveDailyTokenCap, makeEntry, tokensTodayReader, tokensUsedToday } from '../src/lib/aiUsage.js';

const PACK = {
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN fails', description: 'Cannot connect, error 809.', state: 'In Progress' },
  people: [],
  journal: [],
  related: {},
  access: [],
};

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = (over = {}) => ({ ...resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test'), ...over });
const policy = (raw = {}) => normalizePolicy(raw);
const feature = featureById('record-summary');
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code || e.message;
  }
};

// ---- SEC-02: the table of the form the person is on --------------------------------------------------------------------

// Rewrite and Notes-to-ticket label their pack 'compose': the table of the page is the only thing that says where the text came from.
const COMPOSE = { ...PACK, table: 'compose', kind: 'other', fields: {} };

test('SEC-02: assertRunnable applies blockedTables to the page table as well as the pack table', () => {
  const base = { feature, pack: COMPOSE, values: values(), config: config() };
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ blockedTables: ['incident'] }), pageTable: 'incident' })), 'TABLE_BLOCKED');
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ blockedTables: ['Incident'] }), pageTable: 'INCIDENT' })), 'TABLE_BLOCKED', 'not case-sensitive');
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ blockedTables: ['incident'] }), pageTable: 'problem' })), null);
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ blockedTables: ['incident'] }) })), null, 'no page table, nothing to check (the old behaviour)');
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ blockedTables: ['compose'] }), pageTable: 'incident' })), 'TABLE_BLOCKED', 'the pack table still counts');
  assert.match(
    (() => {
      try {
        assertRunnable({ ...base, policy: policy({ blockedTables: ['incident'] }), pageTable: 'incident' });
      } catch (e) {
        return e.message;
      }
      return '';
    })(),
    /does not allow Agent Buddy to use incident records/
  );
});

test('SEC-02: an HR page makes a compose pack an HR run: refused unless HR is allowed, and then only on an approved endpoint', () => {
  const base = { feature, pack: COMPOSE, values: values({ piiMode: 'strict' }), config: config() };
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy(), pageTable: 'sn_hr_core_case' })), 'HR_BLOCKED');
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ allowHrContent: true }), pageTable: 'sn_hr_core_case' })), 'HR_BLOCKED', 'allowed, but no approved endpoint');
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ allowHrContent: true, aiProvider: 'anthropic' }), pageTable: 'sn_hr_core_case' })), null);
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy(), pageTable: 'incident' })), null, 'an ordinary page is fine');
  // the organisation's own HR-family prefixes count for the page table as well
  assert.equal(codeOf(() => assertRunnable({ ...base, policy: policy({ sensitiveTablePrefixes: ['x_acme_hr_'] }), pageTable: 'x_acme_hr_case' })), 'HR_BLOCKED');
});

test('SEC-02: prepareRun passes the page table through and the firewall treats the run as HR (Strict mode free text rule)', () => {
  const part = { ...COMPOSE, compose: { text: 'Sick leave next week', label: 'Text to rewrite', field: 'text' } };
  const rewrite = featureById('rewrite-short');
  const go = (pol, pageTable) =>
    prepareRun({ feature: rewrite, pack: part, values: values({ piiMode: 'strict' }), policy: policy(pol), config: config(), createFirewall, pageTable });
  assert.equal(codeOf(() => go({}, 'sn_hr_core_case')), 'HR_BLOCKED');
  assert.ok(go({}, 'incident').request, 'an incident page: allowed');
  assert.ok(go({ allowHrContent: true, aiProvider: 'anthropic' }, 'sn_hr_core_case').request, 'HR allowed on an approved endpoint: the free text may go in Strict mode');
  assert.equal(codeOf(() => go({ blockedTables: ['sn_hr_core_case'] }, 'sn_hr_core_case')), 'TABLE_BLOCKED');
});

// ---- SEC-04: HR content needs an approved endpoint --------------------------------------------------------------------------

const HR = { ...PACK, table: 'sn_hr_core_case', kind: 'hr_case' };

test('SEC-04: allowHrContent alone is not enough: the endpoint must be pinned by the policy or run on this computer', () => {
  // (Strict mode: every function on an HR record needs it, see the AI0.2 test below; this test is about the endpoint.)
  const base = { feature, pack: HR, values: values({ piiMode: 'strict' }) };
  const blocked = (pol, cfg) => codeOf(() => assertRunnable({ ...base, policy: policy(pol), config: cfg }));
  assert.equal(blocked({}, config()), 'HR_BLOCKED');
  assert.equal(blocked({ allowHrContent: true }, config()), 'HR_BLOCKED');
  assert.equal(blocked({ allowHrContent: true, aiProvider: 'anthropic' }, config()), null);
  assert.equal(blocked({ allowHrContent: true, aiBaseUrl: 'https://ai-gateway.corp.example/v1', aiProvider: 'openai' }, resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'https://ai-gateway.corp.example/v1' } }, 'k')), null);
  assert.equal(blocked({ allowHrContent: true }, resolveProviderConfig({ provider: 'ollama' }, '')), null, 'a model on this computer needs no pin');
  // the message names what to do
  try {
    assertRunnable({ ...base, policy: policy({ allowHrContent: true }), config: config() });
    assert.fail('should have been refused');
  } catch (e) {
    assert.ok(e instanceof RunBlocked);
    assert.match(e.message, /approved/);
    assert.match(e.message, /AI endpoint/);
    assert.match(e.message, /administrator/);
  }
  // not allowing HR at all keeps its own, older message
  try {
    assertRunnable({ ...base, policy: policy(), config: config() });
    assert.fail('should have been refused');
  } catch (e) {
    assert.match(e.message, /unless your organisation allows it/);
  }
});

test('SEC-04: sensitiveTablePrefixes make a custom table an HR table for the gate; the default behaviour is unchanged', () => {
  const custom = { ...PACK, table: 'x_acme_hr_case', kind: 'other' };
  const run = (pol) => codeOf(() => assertRunnable({ feature, pack: custom, values: values({ piiMode: 'strict' }), policy: policy(pol), config: config() }));
  assert.equal(run({}), null, 'without the prefix the table is ordinary');
  assert.equal(run({ sensitiveTablePrefixes: ['x_acme_hr_'] }), 'HR_BLOCKED');
  assert.equal(run({ sensitiveTablePrefixes: ['x_acme_hr_'], allowHrContent: true }), 'HR_BLOCKED');
  assert.equal(run({ sensitiveTablePrefixes: ['x_acme_hr_'], allowHrContent: true, aiProvider: 'anthropic' }), null);
  assert.equal(isSensitivePack(HR, policy()), true);
  assert.equal(isSensitivePack(custom, policy()), false);
  assert.equal(isSensitivePack(custom, policy({ sensitiveTablePrefixes: ['x_acme_hr_'] })), true);
});

test('SEC-04: a pack that says its real class is unknown (`sensitive`) is gated like an HR case', () => {
  const unknown = { ...PACK, table: 'task', kind: 'task', sensitive: true };
  const run = (pol) => codeOf(() => assertRunnable({ feature, pack: unknown, values: values({ piiMode: 'strict' }), policy: policy(pol), config: config() }));
  assert.equal(run({}), 'HR_BLOCKED');
  assert.equal(run({ allowHrContent: true }), 'HR_BLOCKED');
  assert.equal(run({ allowHrContent: true, aiProvider: 'anthropic' }), null);
  assert.equal(isSensitivePack({ ...unknown, sensitive: false }, policy()), false);
});

// ---- AI0.2: every function on an HR record needs Strict (or Local-only) privacy mode -------------------------------------------
//
// Not only the HR case brief (its requires.minMode): any feature, on any table the policy treats as sensitive (sn_hr_ and the
// policy's prefixes, an HR child table whatever kind it is mapped to, a record whose real class is unknown), and on the table of the
// form the person is on (Rewrite and Notes carry it as pageTable).
test('AI0.2: every function on an HR record is refused below Strict mode, with a message that says what to change', () => {
  const allowed = policy({ allowHrContent: true, aiProvider: 'anthropic' });
  const run = (pack, piiMode, extra = {}) => codeOf(() => assertRunnable({ feature, pack, values: values({ piiMode }), policy: allowed, config: config(), ...extra }));
  for (const pack of [HR, { ...PACK, table: 'sn_hr_core_case_payroll', kind: 'other' }, { ...PACK, table: 'sn_hr_le_case', kind: 'hr_case' }, { ...PACK, table: 'task', kind: 'task', sensitive: true }]) {
    assert.equal(run(pack, 'standard'), 'MODE_TOO_LOW', pack.table);
    assert.equal(run(pack, 'strict'), null, pack.table);
  }
  // keyed on the table, not the kind: a custom prefix the policy names
  const custom = { ...PACK, table: 'x_acme_er_case', kind: 'other' };
  assert.equal(codeOf(() => assertRunnable({ feature, pack: custom, values: values(), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', sensitiveTablePrefixes: ['x_acme_er_'] }), config: config() })), 'MODE_TOO_LOW');
  assert.equal(codeOf(() => assertRunnable({ feature, pack: custom, values: values(), policy: allowed, config: config() })), null, 'an ordinary table keeps Standard mode');
  // Local-only ranks above Strict (a model on this computer, no pinned endpoint needed)
  assert.equal(codeOf(() => assertRunnable({ feature, pack: HR, values: values({ piiMode: 'local-only' }), policy: policy({ allowHrContent: true }), config: resolveProviderConfig({ provider: 'ollama' }, '') })), null);
  // the page the person is on counts too (Rewrite on an HR form)
  assert.equal(run({ ...PACK, table: 'compose' }, 'standard', { pageTable: 'sn_hr_core_case' }), 'MODE_TOO_LOW');
  // the organisation's own refusal comes first: there is no point asking the person to change the mode
  assert.equal(codeOf(() => assertRunnable({ feature, pack: HR, values: values(), policy: policy(), config: config() })), 'HR_BLOCKED');
  try {
    assertRunnable({ feature, pack: HR, values: values(), policy: allowed, config: config() });
    assert.fail('Standard mode must be refused');
  } catch (e) {
    assert.ok(e instanceof RunBlocked);
    assert.equal(e.message, 'HR records need Strict privacy mode (or Local-only). Change the privacy mode in Settings, then try again.');
  }
  // and nothing is built: prepareRun refuses before the firewall sees a byte
  let built = 0;
  assert.throws(
    () => prepareRun({ feature, pack: HR, values: values(), policy: allowed, config: config(), createFirewall: () => ({ buildRequest: () => (built++, {}) }) }),
    (e) => e.code === 'MODE_TOO_LOW'
  );
  assert.equal(built, 0);
  // what a view shows before the click
  assert.equal(requiredMode(feature, HR, allowed), 'strict');
  assert.equal(requiredMode(feature, PACK, allowed), '');
  assert.equal(requiredMode(feature, { ...PACK, table: 'compose' }, allowed, 'sn_hr_core_case'), 'strict');
  assert.equal(requiredMode({ ...feature, requires: { minMode: 'local-only' } }, HR, allowed), 'local-only');
  assert.equal(requiredMode({ ...feature, requires: { minMode: 'strict' } }, PACK, allowed), 'strict');
});

test('SEC-04: the firewall applies Strict mode\'s HR free-text rule to the policy\'s extra prefixes and to a sensitive record', () => {
  const part = { label: 'Description', field: 'description', text: 'Leave of absence for medical reasons next week.' };
  const send = (options, table) => createFirewall({ mode: 'strict', ...options }).buildRequest({ feature: 'x', table, system: 's', parts: [part], userInstruction: 'u' });
  assert.ok(send({}, 'x_acme_hr_case'), 'an ordinary table to the firewall that was not told');
  assert.throws(() => send({ sensitivePrefixes: ['x_acme_hr_'] }, 'x_acme_hr_case'), (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD' && /free text from HR tables/.test(e.message));
  assert.throws(() => send({ sensitiveRecord: true }, 'task'), (e) => e instanceof FirewallError && /free text from HR tables/.test(e.message));
  assert.ok(send({ sensitivePrefixes: ['x_acme_hr_'], allowHrFreeText: true }, 'x_acme_hr_case'));
  assert.throws(() => send({}, 'sn_hr_core_case'), (e) => /free text from HR tables/.test(e.message), 'the default prefix is unchanged');
  assert.ok(send({ sensitivePrefixes: ['x_acme_hr_'] }, 'incident'), 'other tables are unaffected');
});

// ---- SEC-05: the preview every time when other people\'s text is in the request -------------------------------------------

test('SEC-05: previewRequired shows the preview every time for a pack with reference material, in "first" mode', () => {
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action']), false, 'seen once: not shown again (the old behaviour)');
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action'], { requirePreview: true }), true);
  assert.equal(previewRequired('first', 'next-best-action', [], { requirePreview: true }), true);
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action'], { requirePreview: false }), false);
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action'], {}), false);
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action'], null), false);
  assert.equal(previewRequired('first', 'next-best-action', ['next-best-action'], { requirePreview: 'yes' }), false, 'only the boolean true counts');
  assert.equal(previewRequired('always', 'a', [], {}), true);
  assert.equal(previewRequired('never', 'a', [], { requirePreview: true }), false, 'the organisation\'s or the person\'s explicit "never" is kept');
});

// ---- SEC-09: tokenBudgetPerDay ---------------------------------------------------------------------------------------------

function prepared() {
  return {
    request: { messages: [], preview: 'P', stats: { total: 0, counts: {} } },
    firewall: { rehydrate: (t) => t },
    feature,
    pack: PACK,
  };
}

async function run({ pol, used, send = async () => ({ content: 'ok', usage: { input: 5, output: 5 } }) } = {}) {
  const audit = [];
  let sent = 0;
  const out = await executeRun({
    prepared: prepared(),
    config: config(),
    values: values(),
    policy: pol === undefined ? null : policy(pol),
    tokensUsedToday: used,
    sendChat: async (...args) => {
      sent += 1;
      return send(...args);
    },
    logAudit: async (entry) => audit.push(entry),
  }).then(
    (r) => ({ ok: r }),
    (e) => ({ err: e })
  );
  return { ...out, audit, sent };
}

test('SEC-09: at or over the policy budget nothing is sent: BUDGET, a plain message, an audit row marked blocked', async () => {
  const r = await run({ pol: { tokenBudgetPerDay: 1000 }, used: async () => 1000 });
  assert.ok(r.err instanceof RunBlocked);
  assert.equal(r.err.code, 'BUDGET');
  assert.match(r.err.message, /Your organisation/);
  assert.match(r.err.message, /1,000/);
  assert.match(r.err.message, /tomorrow/);
  assert.equal(r.sent, 0, 'sendChat was not called');
  assert.equal(r.audit.length, 1);
  assert.equal(r.audit[0].outcome, 'blocked');
  assert.equal(r.audit[0].reason, 'BUDGET');
  assert.equal(r.audit[0].feature, 'record-summary');
  const over = await run({ pol: { tokenBudgetPerDay: 1000 }, used: async () => 5000 });
  assert.equal(over.err.code, 'BUDGET');
});

test('SEC-09: under the budget the call goes through and is audited as sent', async () => {
  const r = await run({ pol: { tokenBudgetPerDay: 1000 }, used: async () => 999 });
  assert.equal(r.err, undefined);
  assert.equal(r.ok.text, 'ok');
  assert.equal(r.sent, 1);
  assert.equal(r.audit[0].outcome, 'sent');
});

test('SEC-09: no budget in the policy, no policy, or no reader: nothing is checked', async () => {
  const gone = async () => {
    throw new Error('the reader must not be called');
  };
  assert.equal((await run({ pol: { tokenBudgetPerDay: 0 }, used: gone })).sent, 1);
  assert.equal((await run({ pol: {}, used: gone })).sent, 1);
  assert.equal((await run({ used: gone })).sent, 1, 'no policy at all');
  assert.equal((await run({ pol: { tokenBudgetPerDay: 10 } })).sent, 1, 'the panel passed no reader: the old behaviour');
});

test('SEC-09: a storage problem reading the usage log does not stop the work (the same stance as the person\'s own caps)', async () => {
  const r = await run({ pol: { tokenBudgetPerDay: 10 }, used: async () => { throw new Error('storage broke'); } });
  assert.equal(r.sent, 1);
  const nan = await run({ pol: { tokenBudgetPerDay: 10 }, used: async () => 'lots' });
  assert.equal(nan.sent, 1);
});

test('SEC-09: the check is a helper the panel can call too, and it audits through the same blocked path', async () => {
  const audit = [];
  await assert.rejects(
    () => assertWithinPolicyBudget({ policy: policy({ tokenBudgetPerDay: 5 }), tokensUsedToday: async () => 6, feature, pack: PACK, config: config(), values: values(), logAudit: async (e) => audit.push(e) }),
    (e) => e.code === 'BUDGET'
  );
  assert.equal(audit[0].outcome, 'blocked');
  await auditBlocked({ feature, pack: PACK, config: config(), values: values(), err: new RunBlocked('x', 'BUDGET'), logAudit: async (e) => audit.push(e) });
  assert.equal(audit[1].reason, 'BUDGET');
});

test('SEC-09: tokensUsedToday counts today\'s real calls only, in the person\'s day; the smaller of the two caps applies', () => {
  const now = new Date(2026, 9, 27, 15, 0, 0);
  const at = (d) => new Date(d).toISOString();
  const usage = { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 };
  const log = [
    makeEntry({ now: new Date(2026, 9, 27, 9, 0, 0), provider: 'anthropic', model: 'm', usage }),
    makeEntry({ now: new Date(2026, 9, 27, 10, 0, 0), provider: 'openai', model: 'm', usage }),
    makeEntry({ now: new Date(2026, 9, 27, 11, 0, 0), provider: 'openai', model: 'm', usage, kind: 'validate' }),
    makeEntry({ now: new Date(2026, 9, 26, 23, 0, 0), provider: 'openai', model: 'm', usage }),
  ];
  assert.equal(at(log[0].time), log[0].time);
  assert.equal(tokensUsedToday(log, now), 2 * 165, 'two real calls today; the key check and yesterday do not count');
  assert.equal(tokensUsedToday([], now), 0);
  assert.equal(tokensUsedToday(undefined, now), 0);
  assert.equal(tokensUsedToday([null, {}, { time: 'x' }], now), 0);
  assert.equal(effectiveDailyTokenCap(1000, 500), 500);
  assert.equal(effectiveDailyTokenCap(500, 1000), 500);
  assert.equal(effectiveDailyTokenCap(1000, 0), 1000);
  assert.equal(effectiveDailyTokenCap(0, 700), 700);
  assert.equal(effectiveDailyTokenCap(0, 0), 0);
  assert.equal(effectiveDailyTokenCap(undefined, 'x'), 0);
});

test('SEC-09: tokensTodayReader turns the stored log into the function executeRun wants', async () => {
  const now = new Date(2026, 9, 27, 15, 0, 0);
  const log = [makeEntry({ now: new Date(2026, 9, 27, 9, 0, 0), provider: 'anthropic', model: 'm', usage: { input: 400, output: 100 } })];
  const used = tokensTodayReader(async () => log, () => now);
  assert.equal(await used(), 500);
  const r = await run({ pol: { tokenBudgetPerDay: 500 }, used });
  assert.equal(r.err.code, 'BUDGET', 'the real reader and the pipeline together');
  const ok = await run({ pol: { tokenBudgetPerDay: 501 }, used });
  assert.equal(ok.sent, 1);
});
