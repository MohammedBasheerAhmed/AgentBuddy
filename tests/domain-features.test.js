import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES as ALL_FEATURES, contextFor, featureById, featuresFor, insertsFor, partsFor } from '../src/features/registry.js';
import domainPack, { PROBLEM_HEADINGS } from '../src/features/packs/domain.js';
import domainSpec from '../src/context/specs/domain.js';
import { FEATURES as CONTEXT_FEATURES, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, PERSON_COLUMNS, allowedFields, fieldLimit } from '../src/context/allowlists.js';
import { KINDS } from '../src/context/kinds.js';
import { readContextPack } from '../src/context/pack.js';
import { OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { RunBlocked, assertRunnable, prepareRun } from '../src/lib/pipeline.js';
import { createFirewall, FirewallError } from '../src/pii/index.js';
import { RULES_PREAMBLE, isSensitiveField } from '../src/pii/firewall.js';
import { normalizePolicy, effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { parseSafeText, toPlainText } from '../src/render/safeText.js';
import { UNTRUSTED } from '../src/prompts/rules.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { FORBIDDEN, IDS, SEED, domainTables } from './domain-fixtures.js';

const DOMAIN_IDS = ['hr-case-brief', 'account-briefing', 'case-eng-escalation', 'problem-rca', 'change-cab-brief'];
const KIND_OF = { 'hr-case-brief': 'hr_case', 'account-briefing': 'case', 'case-eng-escalation': 'case', 'problem-rca': 'problem', 'change-cab-brief': 'change' };
const REF = {
  'hr-case-brief': { table: 'sn_hr_core_case', sysId: IDS.hr },
  'account-briefing': { table: 'sn_customerservice_case', sysId: IDS.case },
  'case-eng-escalation': { table: 'sn_customerservice_case', sysId: IDS.case },
  'problem-rca': { table: 'problem', sysId: IDS.problem },
  'change-cab-brief': { table: 'change_request', sysId: IDS.change },
};
const HEADINGS = {
  'hr-case-brief': ['Request type', 'Status and due date', 'Done so far', 'Pending', 'Next steps'],
  'account-briefing': ['Who', 'Entitlement', 'This case', 'History', 'Watch out for', 'Suggested opening'],
  'case-eng-escalation': ['Summary', 'Customer impact', 'Environment', 'Steps to reproduce', 'Expected vs actual', 'Evidence from the case', 'What has been tried', 'Ask'],
  'problem-rca': ['Problem statement', 'Timeline', 'Probable cause', 'Workaround', 'Permanent fix options', 'Open questions'],
  'change-cab-brief': ['What changes', 'Why', 'When', 'Who is affected', 'Risk and impact', 'Plans', 'Approvals so far', 'Scheduling conflicts', 'Questions the CAB should ask'],
};

const features = DOMAIN_IDS.map((id) => featureById(id));
const ctx = (deps) => ({ deps, checkRecord, checkPack });

// The pack the panel would build: the context engine's read (HR with sensitive data allowed, as useRun does when the
// organisation allows HR content), then the feature's own enrich step.
async function buildPack(id, { tables = domainTables(), behaviour, now } = {}) {
  const feature = featureById(id);
  const fake = fakeDeps(tables, behaviour);
  const deps = now ? { ...fake, now: () => now } : fake;
  const allowSensitive = KIND_OF[id] === 'hr_case';
  let pack = await readContextPack(REF[id], deps, { feature: contextFor(feature), allowSensitive });
  if (feature.enrich) pack = await feature.enrich(pack, { read: (op, args) => OPS[op](args, ctx(deps)), allowSensitive });
  return pack;
}

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = (over = {}) => ({ ...resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test'), ...over });
const policy = (raw = {}) => normalizePolicy(raw);
const outgoing = (prepared) => `${prepared.request.messages.map((m) => m.content).join('\n')}\n${prepared.request.preview}`;

// ---- Contract: the feature definitions ----------------------------------------------------------------------------------

test('the five domain features exist, once, in the registry', () => {
  assert.deepEqual(domainPack.map((f) => f.id), DOMAIN_IDS);
  const ids = ALL_FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate feature ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  for (const id of DOMAIN_IDS) assert.ok(featureById(id), id);
});

test('kinds are real, waves are the plan\'s, and each feature appears on the right records only', () => {
  const waves = { 'hr-case-brief': 2, 'account-briefing': 2, 'case-eng-escalation': 3, 'problem-rca': 3, 'change-cab-brief': 3 };
  for (const f of features) {
    assert.deepEqual(f.kinds, [KIND_OF[f.id]], f.id);
    for (const k of f.kinds) assert.ok(KINDS.includes(k), `${f.id}: unknown kind ${k}`);
    assert.equal(f.wave, waves[f.id], f.id);
  }
  for (const kind of KINDS) {
    const shown = featuresFor(kind, policy()).map((f) => f.id).filter((id) => DOMAIN_IDS.includes(id));
    assert.deepEqual(shown.sort(), DOMAIN_IDS.filter((id) => KIND_OF[id] === kind).sort(), kind);
  }
});

test('titles and descriptions are short plain sentences', () => {
  for (const f of features) {
    assert.ok(f.title.length >= 8 && f.title.length <= 60, f.id);
    assert.ok(f.description.length >= 20 && f.description.length <= 160, f.id);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(f.title + f.description), 'no emoji');
  }
  assert.equal(featureById('account-briefing').title, 'Brief me before the call');
});

test('every insert names a field and its labels; the problem write-up has three, each with a section picker', () => {
  for (const f of features) {
    const inserts = insertsFor(f);
    assert.ok(inserts.length >= 1, f.id);
    for (const spec of inserts) {
      assert.match(spec.field, /^[a-z][a-z_]*$/, f.id);
      assert.ok(spec.label && spec.fieldLabel, `${f.id}: ${spec.field} needs label and fieldLabel`);
    }
  }
  for (const id of ['hr-case-brief', 'account-briefing', 'case-eng-escalation', 'change-cab-brief']) {
    assert.deepEqual(insertsFor(featureById(id)).map((s) => s.field), ['work_notes'], id);
  }
  const rca = insertsFor(featureById('problem-rca'));
  assert.deepEqual(rca.map((s) => s.field), ['description', 'cause_notes', 'workaround']);
  for (const spec of rca) assert.equal(typeof spec.pick, 'function');
  // none of these fields is customer-visible, so the safe-to-send check does not apply to them
  for (const f of features) for (const spec of insertsFor(f)) assert.ok(!['comments', 'close_notes'].includes(spec.field), `${f.id} writes to ${spec.field}`);
});

test('the problem inserts pick their own part of an answer, as the result view calls them', () => {
  const answer = [
    '**Problem statement:** Gateway drops sessions.',
    '',
    '**Timeline:**',
    '- 2026-10-01: INC001001 first report',
    '',
    '**Probable cause:** Hypothesis: the TLS bundle update.',
    '',
    '**Workaround:** Restart the pool.',
    '',
    '**Permanent fix options:** Roll back.',
    '',
    '**Open questions:** Why now?',
  ].join('\n');
  const plain = toPlainText(parseSafeText(answer));
  const [statement, cause, workaround] = insertsFor(featureById('problem-rca')).map((s) => s.pick(plain));
  assert.equal(statement, 'Gateway drops sessions.');
  assert.equal(cause, 'Hypothesis: the TLS bundle update.');
  assert.equal(workaround, 'Restart the pool.');
  // "Not stated" is not inserted
  const nothing = toPlainText(parseSafeText('Problem statement: x\nWorkaround: Not stated\nOpen questions: y'));
  assert.equal(insertsFor(featureById('problem-rca'))[2].pick(nothing), '');
});

test('the prompts are fixed text: no ticket data, no template holes, a fixed layout, a length cap and the injection rule', () => {
  for (const f of features) {
    assert.equal(typeof f.system, 'string');
    assert.equal(typeof f.instruction, 'string');
    for (const text of [f.system, f.instruction]) {
      assert.ok(!/\{\{|\$\{|<%|%\}/.test(text), `${f.id}: template hole`);
      assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(text), `${f.id}: an email in the prompt`);
      assert.ok(!/\b[0-9a-f]{32}\b/i.test(text), `${f.id}: a sys_id in the prompt`);
      assert.ok(!/\b[A-Z]{2,6}\d{5,}\b/.test(text), `${f.id}: a record number in the prompt`);
      for (const secret of FORBIDDEN) assert.ok(!text.includes(secret), `${f.id}: ${secret}`);
    }
    // The injection rule, in its shared wording (src/prompts/rules.js), is said once per request by the firewall's rules, which
    // follow this prompt in the system message (RULES_PREAMBLE); the prompt does not repeat it.
    assert.ok(RULES_PREAMBLE.includes(UNTRUSTED), 'the firewall says it');
    assert.ok(!f.system.includes(UNTRUSTED), `${f.id}: not said twice`);
    assert.match(f.system, /Not stated/, f.id);
    assert.match(f.system, /at most \d+ words/, f.id);
    assert.match(f.system, /use only facts in the data/i, f.id);
    // the headings, each with a colon, in the order of the brief
    let from = 0;
    for (const heading of HEADINGS[f.id]) {
      const at = f.system.indexOf(`${heading}:`, from);
      assert.ok(at >= from, `${f.id}: heading "${heading}:" missing or out of order`);
      from = at + heading.length;
    }
  }
  assert.deepEqual(HEADINGS['problem-rca'], PROBLEM_HEADINGS);
});

test('the prompt does not change with the ticket: two different records give the same system text', async () => {
  for (const id of DOMAIN_IDS) {
    const make = async (mutate) => {
      const tables = domainTables();
      mutate(tables);
      const pack = await buildPack(id, { tables });
      return prepareRun({ feature: featureById(id), pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic' }), config: config(), createFirewall }).request.messages[0].content;
    };
    const a = await make(() => {});
    const b = await make((t) => {
      for (const rows of Object.values(t)) for (const row of rows) if (row.short_description) row.short_description = { value: 'COMPLETELY DIFFERENT TITLE', display_value: 'COMPLETELY DIFFERENT TITLE' };
    });
    assert.equal(a, b, id);
    assert.ok(!a.includes('COMPLETELY DIFFERENT'));
  }
});

test('only the HR brief asks for a stricter privacy mode, and it asks for Strict', () => {
  assert.deepEqual(featureById('hr-case-brief').requires, { minMode: 'strict' });
  for (const id of DOMAIN_IDS.filter((x) => x !== 'hr-case-brief')) assert.equal(featureById(id).requires, undefined, id);
  for (const f of features) {
    assert.equal(f.defaultOff, undefined);
    assert.equal(f.keepMasked, undefined, `${f.id}: the answer goes into the same record, so names may come back`);
  }
});

// ---- Contract: the context specs ---------------------------------------------------------------------------------------------

test('every feature has a context spec, a journal switch and a list of extras', () => {
  for (const id of DOMAIN_IDS) {
    assert.ok(CONTEXT_FEATURES.includes(id), id);
    assert.ok(domainSpec.spec[id] && Array.isArray(domainSpec.spec[id].common) && domainSpec.spec[id].by, id);
    assert.equal(FEATURE_JOURNAL[id], true, id);
    assert.ok(Array.isArray(FEATURE_RELATED[id]), id);
    assert.equal(contextFor(featureById(id)), id);
  }
});

test('columns stay inside the kind\'s ceiling: nothing in a spec is silently dropped, and a feature reads only its own kind', () => {
  // Every feature that sends text to an AI also reads every PERSON column of the kind's ceiling (src/context/allowlists.js), so the
  // people are masked by name wherever the text mentions them; those columns are read for masking and are not fields of the pack.
  const peopleOf = (kind) => FIELDS_BY_KIND[kind].filter((name) => PERSON_COLUMNS.includes(name));
  for (const id of DOMAIN_IDS) {
    for (const [kind, names] of Object.entries(domainSpec.spec[id].by)) {
      assert.equal(kind, KIND_OF[id], `${id} lists columns for ${kind}`);
      const ceiling = new Set(FIELDS_BY_KIND[kind]);
      for (const name of names) assert.ok(ceiling.has(name), `${id}: ${name} is not in the ${kind} ceiling`);
      assert.deepEqual([...FEATURE_FIELDS[id][kind]].sort(), [...new Set(['number', ...names, ...peopleOf(kind)])].sort(), `${id}/${kind}`);
    }
    for (const kind of KINDS.filter((k) => k !== KIND_OF[id])) assert.deepEqual([...FEATURE_FIELDS[id][kind]].sort(), [...new Set(['number', ...peopleOf(kind)])].sort(), `${id} on ${kind}`);
  }
});

test('the ceilings are only ever widened, with a reason, and no base kind is overridden', () => {
  assert.deepEqual(domainSpec.fieldsByKind, {});
  assert.deepEqual(Object.keys(domainSpec.extendFields).sort(), ['change', 'hr_case']);
  assert.deepEqual(domainSpec.extendFields.hr_case, ['due_date']);
  for (const name of domainSpec.extendFields.change) {
    assert.ok(FIELDS_BY_KIND.change.includes(name), name);
    assert.ok(domainSpec.spec['change-cab-brief'].by.change.includes(name), `${name} is not used by any feature`);
  }
  // long text columns get a limit above the default of 300; every limit set here belongs to a column this pack adds
  for (const [name, limit] of Object.entries(domainSpec.limits)) {
    assert.ok(domainSpec.extendFields.change.includes(name), name);
    assert.equal(fieldLimit(name), limit);
    assert.ok(limit > 300);
  }
  assert.ok(domainSpec.spec['hr-case-brief'].by.hr_case.includes('due_date'));
  // the base columns are all still there
  for (const name of ['number', 'start_date', 'end_date', 'risk', 'approval', 'conflict_status']) assert.ok(FIELDS_BY_KIND.change.includes(name), name);
});

test('HR: free text and identities are only read when sensitive data is allowed, and then only what the brief lists', () => {
  const minimal = allowedFields('sn_hr_core_case', 'hr-case-brief');
  for (const hidden of ['short_description', 'description', 'close_notes', 'subject_person', 'opened_for', 'opened_by', 'hr_service']) assert.ok(!minimal.includes(hidden), hidden);
  assert.ok(minimal.includes('due_date') && minimal.includes('state'));
  const open = allowedFields('sn_hr_core_case', 'hr-case-brief', { allowSensitive: true });
  for (const name of ['short_description', 'description', 'hr_service', 'subject_person', 'opened_for', 'opened_by', 'due_date', 'close_notes']) assert.ok(open.includes(name), name);
  for (const never of ['hold_reason', 'category', 'subcategory', 'contact_type']) assert.ok(!open.includes(never), never);
});

// ---- The parts -----------------------------------------------------------------------------------------------------------------

test('every part is on the allowlist, or is one of the three extras added by this pack; no pack field leaks past the spec', async () => {
  const extraFields = new Set(['slas', 'approvals', 'child_tasks', 'change_tasks', 'linked_incidents', 'schedule_conflicts', 'recent_changes', 'account_cases', 'data_not_available', 'not_recorded']);
  for (const id of DOMAIN_IDS) {
    const pack = await buildPack(id, { behaviour: { leaky: true } });
    const allowed = new Set([...FEATURE_FIELDS[id][KIND_OF[id]], 'comments', 'work_notes']);
    const parts = partsFor(featureById(id), pack);
    assert.ok(parts.length >= 3, id);
    for (const p of parts) assert.ok(allowed.has(p.field) || extraFields.has(p.field), `${id}: part ${p.field}`);
    assert.ok(!JSON.stringify(parts).includes('LEAK'), id);
  }
});

test('part names never look sensitive to Strict mode, so Strict can be used by every feature', async () => {
  for (const id of DOMAIN_IDS) {
    const pack = await buildPack(id);
    for (const p of partsFor(featureById(id), pack)) {
      assert.equal(isSensitiveField(p.field), false, `${id}: ${p.field}`);
      assert.equal(isSensitiveField(p.label), false, `${id}: ${p.label}`);
    }
  }
});

test('the journal depth of each feature is what its parts use', async () => {
  const depth = { 'hr-case-brief': 15, 'account-briefing': 10, 'case-eng-escalation': 25, 'problem-rca': 20, 'change-cab-brief': 8 };
  for (const id of DOMAIN_IDS) {
    assert.equal(featureById(id).journal, depth[id], id);
    const pack = await buildPack(id);
    const many = { ...pack, journal: Array.from({ length: 40 }, (_, i) => ({ when: `2026-10-${String(i + 1).padStart(2, '0')} 08:00:00`, by: 'Someone Else', type: i % 2 ? 'comment' : 'work_note', text: `note ${i}` })) };
    const notes = partsFor(featureById(id), many).filter((p) => p.field === 'comments' || p.field === 'work_notes');
    assert.equal(notes.length, depth[id], id);
    assert.ok(notes.at(-1).text.includes('note 39'), 'the newest are kept');
  }
});

test('HR: the identity columns are read for masking but never sent as parts, and the labels are plain', async () => {
  const pack = await buildPack('hr-case-brief');
  for (const field of ['subject_person', 'opened_for', 'opened_by', 'assigned_to']) assert.ok(field in pack.fields, `${field} is read`);
  assert.ok(pack.people.some((p) => p.name === SEED.employee.name) && pack.people.some((p) => p.name === SEED.handler.name));
  const parts = partsFor(featureById('hr-case-brief'), pack);
  for (const field of ['subject_person', 'opened_for', 'opened_by', 'assigned_to']) assert.ok(!parts.some((p) => p.field === field), field);
  assert.ok(parts.some((p) => p.label === 'Request type' && p.text === 'Leave of absence'));
  assert.ok(parts.some((p) => p.field === 'due_date'));
});

test('engineering escalation: the contact\'s identity stays out of the parts; the account briefing keeps who the customer is', async () => {
  const esc = partsFor(featureById('case-eng-escalation'), await buildPack('case-eng-escalation'));
  for (const field of ['contact', 'consumer', 'assigned_to']) assert.ok(!esc.some((p) => p.field === field), field);
  const brief = partsFor(featureById('account-briefing'), await buildPack('account-briefing'));
  assert.ok(brief.some((p) => p.field === 'contact'));
  assert.ok(brief.some((p) => p.field === 'account_cases'));
});

test('related data that could not be read is named as unavailable, never described as empty', async () => {
  const pack = await buildPack('account-briefing', { behaviour: { denied: ['task_sla', 'change_request'] } });
  const parts = partsFor(featureById('account-briefing'), pack);
  const missing = parts.find((p) => p.field === 'data_not_available').text;
  assert.match(missing, /SLAs: not readable by your user/);
  assert.match(missing, /Changes: not readable by your user/);
  assert.match(missing, /do not describe them as empty/);
  assert.ok(!parts.some((p) => p.field === 'slas' || p.field === 'recent_changes'));
  // the wording is fixed: nothing from the instance's error text
  assert.ok(!/ACL|403|Access to/.test(missing));
});

test('a change with an empty back-out plan says so in a part of its own', async () => {
  const pack = await buildPack('change-cab-brief');
  const parts = partsFor(featureById('change-cab-brief'), pack);
  const note = parts.find((p) => p.field === 'not_recorded');
  assert.match(note.text, /Back-out plan/);
  assert.ok(!/Implementation plan/.test(note.text), 'a plan that exists is not listed as missing');
  assert.ok(parts.some((p) => p.label === 'Implementation plan'));
  const conflicts = parts.find((p) => p.field === 'schedule_conflicts').text;
  assert.match(conflicts, /CHG0030013 .*same configuration item, same business service/);
});

test('a change whose conflicts could not be checked says "not checked", not "none"', async () => {
  const tables = domainTables();
  Object.assign(tables.change_request[0], { cmdb_ci: { value: '', display_value: '' }, business_service: { value: '', display_value: '' } });
  const pack = await buildPack('change-cab-brief', { tables });
  const parts = partsFor(featureById('change-cab-brief'), pack);
  assert.ok(!parts.some((p) => p.field === 'schedule_conflicts'));
  assert.match(parts.find((p) => p.field === 'data_not_available').text, /no configuration item or business service, so schedule conflicts were not checked/);
});

// ---- Through prepareRun with the real firewall -------------------------------------------------------------------------------------

test('every feature, on a hostile record, sends none of the seeded personal data and keeps the prompt clean', async () => {
  for (const id of DOMAIN_IDS) {
    const feature = featureById(id);
    const pack = await buildPack(id);
    const prepared = prepareRun({ feature, pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic' }), config: config(), createFirewall });
    const text = outgoing(prepared);
    for (const secret of FORBIDDEN) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `${id} sent "${secret}"`);
    assert.ok(prepared.stats.total > 0, `${id}: something was masked`);

    const [system, user] = prepared.request.messages;
    assert.equal(system.role, 'system');
    // the system message is the fixed prompt plus the firewall's fixed rules, and nothing else: no ticket data in it
    assert.equal(system.content, `${feature.system}

${RULES_PREAMBLE}`, id);
    assert.ok(!system.content.includes(SEED.injection), 'the injection is in the data only');
    // the data sits inside delimiters and its angle brackets are escaped, so it cannot close the block early
    const opens = (user.content.match(/<ticket_data /g) || []).length;
    const closes = (user.content.match(/<\/ticket_data>/g) || []).length;
    assert.ok(opens > 3 && opens === closes, `${id}: ${opens} opens, ${closes} closes`);
    assert.ok(!/<system>|<\/system>/.test(text), `${id}: injected tags`);
    assert.equal(prepared.request.mode, 'strict');
    assert.equal(prepared.request.feature, id);
  }
});

test('the same features also run in Standard mode, apart from the HR brief', async () => {
  for (const id of DOMAIN_IDS.filter((x) => x !== 'hr-case-brief')) {
    const pack = await buildPack(id);
    const prepared = prepareRun({ feature: featureById(id), pack, values: values({ piiMode: 'standard' }), policy: policy(), config: config(), createFirewall });
    for (const secret of FORBIDDEN) assert.ok(!outgoing(prepared).toLowerCase().includes(secret.toLowerCase()), `${id} sent "${secret}"`);
  }
});

test('the other customers\' details inside the account\'s other cases are masked by pattern too', async () => {
  const tables = domainTables();
  tables.sn_customerservice_case[3].short_description = { value: 'Call back +1 (212) 555-0188 or jo.bloggs@initech-example.test', display_value: 'Call back +1 (212) 555-0188 or jo.bloggs@initech-example.test' };
  const pack = await buildPack('account-briefing', { tables });
  const prepared = prepareRun({ feature: featureById('account-briefing'), pack, values: values({ piiMode: 'strict' }), policy: policy(), config: config(), createFirewall });
  const text = outgoing(prepared);
  assert.ok(!text.includes('jo.bloggs@') && !text.includes('555-0188'));
  assert.ok(/Earlier gateway ticket/.test(text), 'the cases themselves are there');
});

test('real names come back only after the answer arrives, locally', async () => {
  const pack = await buildPack('change-cab-brief');
  const prepared = prepareRun({ feature: featureById('change-cab-brief'), pack, values: values({ piiMode: 'strict' }), policy: policy(), config: config(), createFirewall });
  const requested = /\[PERSON_\d+\]/.exec(outgoing(prepared));
  assert.ok(requested, 'people are placeholders in the request');
  const back = prepared.firewall.rehydrate(`Requested by ${requested[0]}.`);
  assert.ok(PEOPLE_NAMES().some((name) => back.includes(name)));
});
const PEOPLE_NAMES = () => [SEED.requester.name, SEED.agent.name, SEED.approver.name, SEED.customer.name, SEED.employee.name, SEED.handler.name];

// ---- HR gates ---------------------------------------------------------------------------------------------------------------------

test('HR brief: the HR gate refuses without the organisation\'s switch, in every privacy mode, before any firewall exists', async () => {
  const pack = await buildPack('hr-case-brief');
  const feature = featureById('hr-case-brief');
  for (const piiMode of ['standard', 'strict', 'local-only']) {
    const run = () => prepareRun({ feature, pack, values: values({ piiMode }), policy: policy(), config: piiMode === 'local-only' ? { ...config(), local: true } : config(), createFirewall: () => assert.fail('the firewall must not be created') });
    assert.throws(run, (e) => e instanceof RunBlocked && (piiMode === 'standard' ? e.code === 'MODE_TOO_LOW' : e.code === 'HR_BLOCKED'), piiMode);
  }
});

test('HR brief: it needs Strict privacy mode (the contract: MODE_TOO_LOW and the exact message)', async () => {
  const pack = await buildPack('hr-case-brief');
  const feature = featureById('hr-case-brief');
  const allowed = policy({ allowHrContent: true, aiProvider: 'anthropic' });
  try {
    assertRunnable({ feature, pack, values: values({ piiMode: 'standard' }), policy: allowed, config: config() });
    assert.fail('Standard mode must be refused');
  } catch (e) {
    assert.ok(e instanceof RunBlocked);
    assert.equal(e.code, 'MODE_TOO_LOW');
    assert.equal(e.message, 'This needs Strict privacy mode. Change it in Settings.');
  }
  for (const piiMode of ['strict']) {
    assert.doesNotThrow(() => assertRunnable({ feature, pack, values: values({ piiMode }), policy: allowed, config: config() }), piiMode);
  }
  // Local-only is stricter than Strict, and a local model satisfies it
  const local = resolveProviderConfig({ provider: 'ollama' }, '');
  // (a model on this computer needs no pinned endpoint: nothing leaves the machine)
  assert.doesNotThrow(() => assertRunnable({ feature, pack, values: values({ piiMode: 'local-only' }), policy: policy({ allowHrContent: true }), config: local }));
  // the mode check does not hide the table check or the feature switch
  assert.throws(() => assertRunnable({ feature, pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', blockedTables: ['sn_hr_core_case'] }), config: config() }), (e) => e.code === 'TABLE_BLOCKED');
  assert.throws(() => assertRunnable({ feature, pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', disabledFeatures: ['hr-case-brief'] }), config: config() }), (e) => e.code === 'FEATURE_OFF');
});

test('HR brief in Strict mode with HR content allowed: what is sent, and what is not', async () => {
  const pack = await buildPack('hr-case-brief');
  const prepared = prepareRun({ feature: featureById('hr-case-brief'), pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic' }), config: config(), createFirewall });
  const { request } = prepared;
  const user = request.messages[1].content;
  assert.equal(request.mode, 'strict');
  assert.equal(request.table, 'sn_hr_core_case');
  // A column is sent as a block of its own or, when short, as a "Label: value" line of the one fields block (src/pii/firewall.js).
  const sentFields = [...user.matchAll(/<ticket_data field="([^"]+)"/g)].map((m) => m[1]);
  const fieldLines = ((/<ticket_data field="fields">\n([\s\S]*?)\n<\/ticket_data>/.exec(user) || [])[1] || '').split('\n');
  const LABEL = { hr_service: 'Request type', state: 'State', short_description: 'Short description', description: 'Description', due_date: 'Due date', subject_person: 'Subject person', opened_for: 'Opened for', opened_by: 'Opened by', assigned_to: 'Assigned to' };
  const sent = (field) => sentFields.includes(field) || (LABEL[field] && fieldLines.some((l) => l.startsWith(`${LABEL[field]}: `)));
  for (const field of ['hr_service', 'state', 'short_description', 'description', 'due_date', 'work_notes', 'comments', 'child_tasks']) assert.ok(sent(field), `${field} is sent`);
  for (const field of ['subject_person', 'opened_for', 'opened_by', 'assigned_to']) assert.ok(!sent(field), `${field} is not sent`);
  // the fixed prompt asks for neutrality
  assert.match(request.messages[0].content, /health, conduct, performance, immigration status/);
  // the employee and the handler are placeholders, not names
  assert.ok(!user.includes(SEED.employee.name) && !user.includes(SEED.handler.name));
  assert.match(user, /\[PERSON_\d+\]/);
  for (const secret of FORBIDDEN) assert.ok(!outgoing(prepared).toLowerCase().includes(secret.toLowerCase()), secret);
});

test('HR brief: policy still wins inside Strict mode (a blocked field stops the whole request)', async () => {
  const pack = await buildPack('hr-case-brief');
  assert.throws(
    () => prepareRun({ feature: featureById('hr-case-brief'), pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', blockedFields: ['work_notes'] }), config: config(), createFirewall }),
    (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD'
  );
});

test('HR brief: without the HR switch Strict mode would refuse the free text (why allowHrFreeText matters)', async () => {
  // Calls the firewall the way the pipeline does when the switch is off, to show what the switch changes.
  const pack = await buildPack('hr-case-brief');
  const fw = createFirewall({ mode: 'strict', people: pack.people, allowHrFreeText: false });
  assert.throws(
    () => fw.buildRequest({ feature: 'hr-case-brief', table: 'sn_hr_core_case', system: featureById('hr-case-brief').system, parts: partsFor(featureById('hr-case-brief'), pack), userInstruction: 'x' }),
    (e) => e instanceof FirewallError && e.code === 'BLOCKED_FIELD' && /free text from HR tables/.test(e.message)
  );
});

test('the other domain features are not gated by the HR rules', async () => {
  for (const id of ['account-briefing', 'case-eng-escalation', 'problem-rca', 'change-cab-brief']) {
    const pack = await buildPack(id);
    assert.doesNotThrow(() => assertRunnable({ feature: featureById(id), pack, values: values({ piiMode: 'standard' }), policy: policy(), config: config() }), id);
  }
});

test('policy switches work for every domain feature', async () => {
  for (const id of DOMAIN_IDS) {
    const pack = await buildPack(id);
    assert.throws(() => assertRunnable({ feature: featureById(id), pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', disabledFeatures: [id] }), config: config() }), (e) => e.code === 'FEATURE_OFF', id);
    assert.throws(() => assertRunnable({ feature: featureById(id), pack, values: values({ piiMode: 'strict' }), policy: policy({ allowHrContent: true, aiProvider: 'anthropic', blockedTables: [pack.table] }), config: config() }), (e) => e.code === 'TABLE_BLOCKED', id);
  }
});
