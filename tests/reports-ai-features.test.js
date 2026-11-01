import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, contextFor, featureById, featuresFor, insertsFor, isFeatureAvailable, partsFor } from '../src/features/registry.js';
import reportFeatures from '../src/features/packs/reports.js';
import { FEATURES as CONTEXT_FEATURES, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, allowedFields } from '../src/context/allowlists.js';
import { KINDS } from '../src/context/kinds.js';
import { isFeatureEnabled, normalizePolicy } from '../src/policy/policy.js';
import { SECTION_IDS } from '../src/reports/engine/constants.js';
import { REPORT_SECTIONS, addableSections, sectionById } from '../src/sidepanel/reports/sections.js';
import { COACHING_RUBRIC } from '../src/reports/ai/coaching.js';
import { HANDOVER_HEADINGS } from '../src/reports/ai/handover.js';
import { INSIGHT_HEADINGS } from '../src/reports/ai/insights.js';

const IDS = ['shift-handover', 'coaching-snapshot', 'dashboard-insights'];
const policy = (raw = {}) => normalizePolicy(raw);

// ---- The contract ----------------------------------------------------------------------------------------------------------

test('this pack defines the three features, and ids are unique across ALL packs', () => {
  assert.deepEqual(reportFeatures.map((f) => f.id), IDS);
  const all = FEATURES.map((f) => f.id);
  assert.equal(new Set(all).size, all.length, `duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i)}`);
  for (const id of IDS) assert.equal(featureById(id), reportFeatures.find((f) => f.id === id));
});

test('none is on any Actions list: kinds is empty, so the Team section runs them itself', () => {
  for (const f of reportFeatures) assert.ok(Array.isArray(f.kinds) && f.kinds.length === 0, f.id);
  for (const kind of KINDS) {
    for (const p of [policy(), policy({ coachingEnabled: true })]) {
      const listed = featuresFor(kind, p).map((f) => f.id);
      for (const id of IDS) assert.ok(!listed.includes(id), `${id} is listed for ${kind}`);
    }
  }
});

test('each has a title, a description, a task and an instruction, a parts function, and no template holes', () => {
  for (const f of reportFeatures) {
    for (const key of ['title', 'description', 'system', 'instruction']) assert.ok(typeof f[key] === 'string' && f[key].trim().length > 10, `${f.id}.${key}`);
    assert.ok(Number.isInteger(f.wave) && f.wave >= 1 && f.wave <= 3, f.id);
    assert.equal(typeof f.parts, 'function', f.id);
    assert.ok(!/\{\{|\$\{|<ticket_data/.test(f.system + f.instruction), `${f.id} has a template hole`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(`${f.title}${f.description}${f.system}`), 'no emoji');
  }
});

test('no result is inserted into a form and nothing opens a form: a team note, not a ticket field', () => {
  for (const f of reportFeatures) {
    assert.deepEqual(insertsFor(f), [], f.id);
    assert.equal(f.open, undefined, f.id);
    assert.equal(f.keepMasked, undefined, `${f.id}: the people reading the answer may see real names`);
  }
});

test('only the coaching snapshot is default-off and needs Strict mode; the other two need neither', () => {
  const by = (id) => featureById(id);
  assert.equal(by('coaching-snapshot').defaultOff, true);
  assert.deepEqual(by('coaching-snapshot').requires, { minMode: 'strict' });
  for (const id of ['shift-handover', 'dashboard-insights']) {
    assert.equal(by(id).defaultOff, undefined, id);
    assert.equal(by(id).requires, undefined, id);
  }
});

test('policy: each can be switched off by id; coaching stays off until the organisation turns it on', () => {
  for (const id of IDS) {
    const f = featureById(id);
    assert.equal(isFeatureEnabled(id, policy({ disabledFeatures: [id] })), false, id);
    assert.equal(isFeatureAvailable(f, policy({ disabledFeatures: [id], coachingEnabled: true })), false, id);
  }
  assert.equal(isFeatureAvailable(featureById('shift-handover'), policy()), true);
  assert.equal(isFeatureAvailable(featureById('dashboard-insights'), policy()), true);
  assert.equal(isFeatureAvailable(featureById('coaching-snapshot'), policy()), false);
  assert.equal(isFeatureAvailable(featureById('coaching-snapshot'), policy({ coachingEnabled: false })), false);
  assert.equal(isFeatureAvailable(featureById('coaching-snapshot'), policy({ coachingEnabled: true })), true);
  assert.equal(isFeatureAvailable(featureById('coaching-snapshot'), null), false);
  // and the existing "reports" id still hides the whole tab
  assert.equal(isFeatureEnabled('reports', policy({ disabledFeatures: ['reports'] })), false);
});

// ---- The prompts --------------------------------------------------------------------------------------------------------------

test('the hand-over prompt names the five headings, the 220-word cap and "Not stated" (the firewall says the untrusted-data rule, once)', () => {
  const { system, instruction } = featureById('shift-handover');
  assert.deepEqual([...HANDOVER_HEADINGS], ['Headline:', 'Needs attention now:', 'Waiting on others:', 'Watch during the next shift:', 'Notes for the incoming team:']);
  let last = -1;
  for (const h of HANDOVER_HEADINGS) {
    const at = system.indexOf(h);
    assert.ok(at > last, `${h} is named, in order`);
    last = at;
  }
  assert.match(system, /at most 220 words/);
  assert.match(system, /Write "Not stated"/);
  assert.doesNotMatch(system, /ignore any instruction/, 'said once per request, by the firewall (tests/prompts-contract.test.js)');
  assert.match(system, /only facts in the data/);
  assert.match(system, /Keep any bracketed placeholder/);
  assert.match(instruction, /hand-over note for the next shift/);
});

test('the insights prompt asks for three bullets, hypotheses labelled as such, three actions, and a word cap', () => {
  const { system } = featureById('dashboard-insights');
  assert.deepEqual([...INSIGHT_HEADINGS], ['What stands out:', 'Likely reasons (hypotheses):', 'Suggested actions:']);
  for (const h of INSIGHT_HEADINGS) assert.ok(system.includes(h), h);
  assert.match(system, /What stands out: exactly three bullet points/);
  assert.match(system, /starts with "Hypothesis:"/);
  assert.match(system, /guesses to check, not conclusions/);
  assert.match(system, /Suggested actions: exactly three bullet points/);
  assert.match(system, /at most 220 words/);
  assert.match(system, /Write "Not stated"/);
  assert.doesNotMatch(system, /ignore any instruction/);
});

test('the coaching prompt uses the fixed rubric, forbids ranking and scoring people, and asks for group themes', () => {
  const { system, instruction } = featureById('coaching-snapshot');
  assert.deepEqual(COACHING_RUBRIC.map((r) => r.label), ['Completeness of notes', 'Clarity', 'Tone with the customer', 'Follow-through']);
  for (const r of COACHING_RUBRIC) assert.ok(system.includes(`${r.label}:`), r.label);
  assert.match(system, /coaching aid for the team lead only, not a performance rating/);
  assert.match(system, /must never rank, score or compare individual people/);
  assert.match(system, /Never name, guess, rank, score, grade or compare any individual/);
  assert.match(system, /Evidence: one quote of at most 20 words/);
  assert.match(system, /Coaching tip: one concrete suggestion/);
  assert.match(system, /Group themes:/);
  assert.match(system, /What the group does well:/);
  assert.match(system, /Not enough to judge/);
  assert.match(system, /Author names are not included/);
  assert.doesNotMatch(system, /ignore any instruction/);
  assert.match(instruction, /rubric/);
});

test('no prompt holds data: sentinels placed in every pack field reach parts only, never system or instruction', () => {
  const S = 'ZZ-SENTINEL-7731';
  const handover = {
    version: 1, table: 'report', sysId: 'handover', people: [], report: {
      kind: 'handover', scope: `My groups (1): ${S}`, hours: 12, figures: [{ label: 'Open tickets', value: 5 }], notes: [S],
      tickets: [{ number: 'INC1', type: 'incident', priority: '1', state: S, group: S, assignee: S, title: S, reasons: [S] }],
    },
  };
  const insights = { version: 1, table: 'report', sysId: 'insights', people: [], report: { kind: 'insights', scope: S, sections: [{ id: 'overview', title: 'Overview', field: 'insights_overview', lines: [S] }], missing: [S], notes: [S] } };
  const coaching = { version: 1, table: 'report', sysId: 'coaching', people: [], report: { kind: 'coaching', group: S, period: S, candidates: 3, notes: [S], tickets: [{ number: 'INC1', type: 'incident', closeCode: S, closeNotes: S, comments: [{ when: '', text: S }], commentsNote: S }] } };
  for (const [id, pack] of [['shift-handover', handover], ['dashboard-insights', insights], ['coaching-snapshot', coaching]]) {
    const f = featureById(id);
    const parts = partsFor(f, pack);
    assert.ok(parts.length > 0, id);
    assert.ok(JSON.stringify(parts).includes(S), `${id}: the data goes in as parts`);
    assert.ok(!f.system.includes(S) && !f.instruction.includes(S), `${id}: the data is not in the prompt`);
    for (const p of parts) assert.match(p.field, /^[a-z][a-z_]*$/, `${id}: ${p.field} is a plain handle`);
  }
});

test('parts are empty for a pack of the wrong kind, so a feature can never send another feature\'s data', () => {
  const wrong = { report: { kind: 'insights', sections: [], missing: [], notes: [], scope: '' } };
  assert.deepEqual(partsFor(featureById('shift-handover'), wrong), []);
  assert.deepEqual(partsFor(featureById('coaching-snapshot'), wrong), []);
  assert.deepEqual(partsFor(featureById('dashboard-insights'), { report: { kind: 'handover' } }), []);
  assert.deepEqual(partsFor(featureById('dashboard-insights'), {}), []);
  assert.deepEqual(partsFor(featureById('dashboard-insights'), null), []);
});

// ---- The context spec -------------------------------------------------------------------------------------------------------

test('the coaching spec reads closing information and the people on the ticket, and nothing that describes the problem', () => {
  assert.ok(CONTEXT_FEATURES.includes('coaching-snapshot'));
  assert.equal(contextFor(featureById('coaching-snapshot')), 'coaching-snapshot');
  const incident = allowedFields('incident', 'coaching-snapshot');
  for (const name of ['number', 'close_notes', 'close_code', 'resolved_at', 'assigned_to', 'caller_id', 'opened_by']) assert.ok(incident.includes(name), name);
  for (const name of ['short_description', 'description', 'priority', 'category', 'cmdb_ci', 'assignment_group', 'comments', 'work_notes', 'state']) assert.ok(!incident.includes(name), `${name} must not be read`);
  assert.ok(allowedFields('sn_customerservice_case', 'coaching-snapshot').includes('resolution_code'));
  assert.ok(allowedFields('problem', 'coaching-snapshot').includes('resolution_code'));
  assert.ok(allowedFields('sc_task', 'coaching-snapshot').includes('close_notes'));
  assert.equal(FEATURE_JOURNAL['coaching-snapshot'], true);
  assert.deepEqual(FEATURE_RELATED['coaching-snapshot'], []);
  assert.ok(Object.values(FEATURE_FIELDS['coaching-snapshot']).every((list) => list.includes('number')));
});

test('an HR-family table gives up its free text and identities even if it were ever asked for', () => {
  const hr = allowedFields('sn_hr_core_case', 'coaching-snapshot');
  for (const name of ['close_notes', 'opened_by', 'short_description']) assert.ok(!hr.includes(name), name);
});

// ---- The sections -------------------------------------------------------------------------------------------------------------

test('the three sections can be saved on a dashboard and have a view, a label and a description', () => {
  for (const id of ['handover', 'coaching', 'insights']) {
    assert.ok(SECTION_IDS.includes(id), id);
    const s = sectionById(id);
    assert.equal(typeof s.View, 'function', id);
    assert.ok(s.label && s.description, id);
  }
  assert.deepEqual(REPORT_SECTIONS.map((s) => s.id).sort(), [...SECTION_IDS].sort());
  assert.deepEqual(['handover', 'coaching', 'insights'].map((id) => sectionById(id).feature), ['shift-handover', 'coaching-snapshot', 'dashboard-insights']);
});

test('Customize (Insights) never offers an AI section; the hand-over page is always offered', () => {
  const ids = (p) => addableSections(p).map((s) => s.id);
  assert.ok(ids(policy()).includes('handover'));
  // Explain this dashboard and coaching live in the Team screen's AI Assist half (src/sidepanel/team), whatever the policy says.
  for (const p of [policy(), policy({ coachingEnabled: true })]) {
    assert.ok(!ids(p).includes('insights') && !ids(p).includes('coaching'));
  }
  assert.ok(ids(policy({ disabledFeatures: ['shift-handover'] })).includes('handover'), 'the page works without AI');
  for (const base of ['overview', 'workload', 'sla', 'quality', 'fulfilment']) assert.ok(ids(policy({ disabledFeatures: ['dashboard-insights', 'coaching-snapshot'] })).includes(base), base);
});
