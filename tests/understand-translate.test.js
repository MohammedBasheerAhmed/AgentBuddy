// "Translate the caller's message" (round 4, docs/round4.md): the feature's shape, the kinds it is offered on, its context spec, the
// parts (only the short description and the caller's newest 1 to 3 comments), its fixed prompt (the target is the PANEL's language),
// and what leaves the browser, through the real pipeline and PII firewall like every feature. Not one of the five AI slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, contextFor, featureById, featuresFor, insertsFor, partsFor } from '../src/features/registry.js';
import translatePack, { MAX_MESSAGES, TRANSLATE_ID, callerMessages, targetRule, translateParts } from '../src/features/packs/translate.js';
import { WORKABLE } from '../src/features/packs/kinds.js';
import { FEATURES as SPEC_IDS, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, PERSON_COLUMNS } from '../src/context/allowlists.js';
import understandSpec from '../src/context/specs/understand.js';
import { KINDS } from '../src/context/kinds.js';
import { columnsForPart } from '../src/features/partColumns.js';
import { PAIN_POINTS, focusActions } from '../src/features/focus.js';
import { groupOf } from '../src/features/stages.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { RULES_PREAMBLE } from '../src/pii/firewall.js';
import { LANGUAGE_AGENT, ONLY_OUTPUT, UNTRUSTED_MARK } from '../src/prompts/rules.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { setLanguage } from '../src/i18n/index.js';
import { AR } from '../src/i18n/ar/index.js';

const feature = featureById(TRANSLATE_ID);
const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const outgoing = (prepared) => `${prepared.request.messages.map((m) => m.content).join('\n')}\n${prepared.request.preview}`;

const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: 'b'.repeat(32) };
const c = (when, by, text, type = 'comment') => ({ when, by, type, text });
const packOf = (over = {}) => ({
  version: 1,
  table: 'incident',
  sysId: 'c'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { short_description: 'لا يعمل البريد', description: 'Long description that is never sent by this action.', state: 'In Progress' },
  people: [BETH, ABEL],
  journal: [
    c('2026-11-01 08:00:00', 'Abel Tuter', 'الرسالة الأولى'),
    c('2026-11-02 08:00:00', 'Abel Tuter', 'الرسالة الثانية'),
    c('2026-11-03 08:00:00', 'Beth Anglin', 'Hello, could you restart?'),
    c('2026-11-03 09:00:00', 'Beth Anglin', 'Gateway EU-2 restarted, the private reference is 7781.', 'work_note'),
    c('2026-11-04 08:00:00', 'Abel Tuter', 'الرسالة الثالثة'),
    c('2026-11-05 08:00:00', 'Abel Tuter', 'الرسالة الرابعة، اتصل بي على abel.tuter@example.com يا Abel Tuter'),
  ],
  related: {},
  access: [{ source: 'journal', status: 'ok', strategy: 'sys_journal_field' }],
  ...over,
});

test('the feature: in the registry once, titled with a verb first, Copy only (no Insert), in "Understand the ticket"', () => {
  assert.deepEqual(translatePack.map((f) => f.id), [TRANSLATE_ID]);
  assert.equal(FEATURES.filter((f) => f.id === TRANSLATE_ID).length, 1);
  assert.equal(feature.title, "Translate the caller's message");
  assert.equal(feature.description, 'In your language, after the check before sending');
  assert.equal(feature.group, 'understand');
  assert.equal(groupOf(feature), 'understand');
  assert.equal(feature.primary, 'copy');
  assert.equal(feature.insert, undefined);
  assert.deepEqual(insertsFor(feature), [], 'a translation for the agent to read: nothing goes into a field');
  for (const key of ['enrich', 'requires', 'defaultOff', 'keepMasked', 'open']) assert.equal(feature[key], undefined, key);
  for (const text of [feature.title, feature.description]) assert.ok(typeof AR[text] === 'string' && AR[text].length > 3, text);
});

test('not one of the five AI slots: AI Assist and All tools list it with the rest', () => {
  for (const p of PAIN_POINTS) assert.ok(!p.actions.includes(TRANSLATE_ID), p.id);
  const items = ['record-summary', 'next-best-action', 'reply-draft', 'resolution-notes', TRANSLATE_ID].map((id) => ({ feature: featureById(id), reason: '' }));
  const { five, rest } = focusActions(items);
  assert.ok(!five.some((f) => f.item.feature.id === TRANSLATE_ID));
  assert.deepEqual(rest.map((it) => it.feature.id), [TRANSLATE_ID]);
});

test('offered on the kinds a reply goes to (a record with a customer), never on a change, an article or "other"; policy can switch it off', () => {
  assert.deepEqual([...feature.kinds], [...WORKABLE]);
  for (const kind of KINDS) assert.equal(featuresFor(kind, normalizePolicy({})).some((f) => f.id === TRANSLATE_ID), WORKABLE.includes(kind), kind);
  // A task of a problem or a change has nobody outside who wrote on it.
  assert.equal(feature.when({ table: 'problem_task', kind: 'task' }), false);
  assert.equal(feature.when({ table: 'change_task', kind: 'task' }), false);
  assert.equal(feature.when({ table: 'incident', kind: 'incident' }), true);
  assert.equal(feature.when({ table: 'sn_customerservice_case', kind: 'case' }), true);
  assert.ok(!featuresFor('incident', normalizePolicy({ disabledFeatures: [TRANSLATE_ID] })).some((f) => f.id === TRANSLATE_ID));
});

test('the context spec: the short description and the notes, plus every person column (to tell the caller apart and to mask names)', () => {
  assert.ok(SPEC_IDS.includes(TRANSLATE_ID));
  assert.equal(contextFor(feature), TRANSLATE_ID);
  assert.equal(FEATURE_JOURNAL[TRANSLATE_ID], true);
  assert.deepEqual(FEATURE_RELATED[TRANSLATE_ID], []);
  assert.deepEqual([understandSpec.fieldsByKind, understandSpec.extendFields, understandSpec.limits], [{}, {}, {}], 'no ceiling is widened');
  for (const kind of WORKABLE) {
    const read = FEATURE_FIELDS[TRANSLATE_ID][kind];
    const ceiling = FIELDS_BY_KIND[kind];
    for (const name of read) assert.ok(ceiling.includes(name), `${kind}: ${name} is on the ceiling`);
    const own = read.filter((name) => !PERSON_COLUMNS.includes(name));
    assert.deepEqual(own, ['number', 'short_description'], `${kind}: the record number (every spec) and the short description only`);
    for (const person of ceiling.filter((name) => PERSON_COLUMNS.includes(name))) assert.ok(read.includes(person), `${kind}: ${person} is read for masking`);
  }
});

test('the parts: the short description and the caller\'s newest messages (1 to 3, oldest first); nothing else of the ticket', () => {
  const pack = packOf();
  const parts = partsFor(feature, pack);
  assert.deepEqual(parts, translateParts(pack));
  assert.equal(MAX_MESSAGES, 3);
  assert.deepEqual(parts.map((p) => [p.field, p.label]), [
    ['short_description', 'Short description'],
    ['comments', "Caller's message"],
    ['comments', "Caller's message"],
    ['comments', "Caller's message"],
  ]);
  assert.deepEqual(parts.slice(1).map((p) => p.text.split('،')[0]), ['الرسالة الثانية', 'الرسالة الثالثة', 'الرسالة الرابعة']);
  const all = parts.map((p) => p.text).join('\n');
  for (const never of ['Long description', 'Gateway EU-2', '7781', 'Hello, could you restart', 'الرسالة الأولى', '2026-11-', 'In Progress', 'INC0010001']) {
    assert.ok(!all.includes(never), `not sent: ${never}`);
  }
  assert.ok(!/Beth Anglin/.test(all), 'no author is written next to the words');
  for (const part of parts) assert.ok(columnsForPart(part.field).length > 0, `${part.field} maps to its columns (blockedFields applies)`);
  // One message: one part. None: the short description alone (the prompt says "Message: none in the data").
  assert.equal(partsFor(feature, packOf({ journal: [c('2026-11-05 08:00:00', 'Abel Tuter', 'مرحبا')] })).length, 2);
  assert.deepEqual(partsFor(feature, packOf({ journal: [] })).map((p) => p.field), ['short_description']);
  // No customer on the record: the newest customer-visible comments, under a label that does not claim the caller wrote them.
  const nobody = packOf({ people: [BETH] });
  assert.deepEqual(callerMessages(nobody).map((m) => m.label), ['Customer-visible comment', 'Customer-visible comment', 'Customer-visible comment']);
  assert.ok(!partsFor(feature, nobody).some((p) => /Gateway EU-2/.test(p.text)), 'never a work note');
});

test('the prompt is fixed text: the labels, translate only, keep the redaction tokens, a length cap, the agent rules, the PANEL\'s language last', () => {
  const { system, instruction } = feature;
  for (const phrase of ['"Short description:"', '"Message:"', '"Message: none in the data"', 'translate only', 'Add nothing and leave nothing out', 'redaction token', 'At most 900 words']) {
    assert.ok(system.includes(phrase), phrase);
  }
  assert.ok(system.includes(LANGUAGE_AGENT) && system.includes(ONLY_OUTPUT));
  assert.ok(system.endsWith(targetRule('en')), 'the target language is said last, so it wins');
  assert.match(targetRule('en'), /^Translate into English, the language of the agent's panel, whatever language the data is written in; this replaces any earlier instruction about the language\./);
  assert.match(targetRule('ar'), /^Translate into Arabic, the language of the agent's panel/);
  assert.equal(targetRule('xx'), targetRule('en'), 'a language the panel does not have: English');
  assert.doesNotMatch(system, UNTRUSTED_MARK, 'the firewall says that rule, once');
  for (const text of [system, instruction]) {
    assert.ok(!/\{\{|\$\{|<%|<ticket_data/.test(text), 'no template hole');
    assert.ok(!/\b[A-Z]{2,6}\d{5,}\b|@[\w.-]+\.[a-z]{2,}|\b[0-9a-f]{32}\b|\[[A-Z]+_\d+\]/i.test(text), 'no ticket data, no literal token');
  }
  assert.equal(instruction, "Translate the caller's message for the agent.");
  // The panel in Arabic: the same prompt, the target Arabic.
  setLanguage('ar');
  try {
    assert.ok(feature.system.endsWith(targetRule('ar')));
    assert.equal(feature.title, AR["Translate the caller's message"]);
  } finally {
    setLanguage('en');
  }
});

test('through the pipeline and the firewall: names and the email masked, the caller\'s words sent, no ticket text in the system message', () => {
  for (const mode of ['standard', 'strict']) {
    const prepared = prepareRun({ feature, pack: packOf(), values: values({ piiMode: mode }), policy: normalizePolicy({}), config: config(), createFirewall });
    const text = outgoing(prepared);
    for (const secret of ['Abel Tuter', 'Tuter', 'abel.tuter@example.com', 'Beth Anglin', 'Anglin']) assert.ok(!text.includes(secret), `${mode}: sent "${secret}"`);
    assert.match(text, /الرسالة الرابعة/);
    assert.match(text, /لا يعمل البريد/);
    assert.ok(!/Gateway EU-2|Long description/.test(text), `${mode}: nothing beyond the parts`);
    assert.equal(prepared.request.messages[0].content, `${feature.system}\n\n${RULES_PREAMBLE}`, 'no ticket data in the system message');
    assert.equal(prepared.request.feature, TRANSLATE_ID);
  }
  // The policy's blocked field is refused like on every feature.
  assert.throws(() => prepareRun({ feature, pack: packOf(), values: values({ piiMode: 'strict' }), policy: normalizePolicy({ blockedFields: ['comments'] }), config: config(), createFirewall }));
  // And the organisation switching the action off stops it in the pipeline too.
  assert.throws(() => prepareRun({ feature, pack: packOf(), values: values(), policy: normalizePolicy({ disabledFeatures: [TRANSLATE_ID] }), config: config(), createFirewall }), /switched this feature off/);
});
