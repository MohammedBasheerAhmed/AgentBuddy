import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, contextFor, featureById, insertsFor, partsFor } from '../src/features/registry.js';
import { CODE_LINE, CODE_RULE, PREPARE_CLOSE, notesOnlyPrompt } from '../src/features/packs/close.js';
import { PAIN_POINTS, focusActions } from '../src/features/focus.js';
import { isFillable } from '../src/lib/fillable.js';
import { prepareRun } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/firewall.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { actionPlan } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { closeCodeFact, closeCodeVote, repeatOfCaller } from '../src/insights/closeCode.js';
import { buildCheckView } from '../src/checks/resolutionCheck.js';
import { closeSections } from '../src/sidepanel/ticket/assist/answers/prepareClose.js';
import { stageOf, whenAllows } from '../src/features/stages.js';

// "Prepare to close" (round 4, docs/round4.md): the fifth slot's AI action. Only the notes are the AI's: the request is the one "Write
// resolution notes" makes (the same context spec, parts and masking; the prompt without its close-code line), and the sections worked
// out in the panel (the resolve check, the close code, the repeat) never reach the model.

const A = 'a'.repeat(32);
const feature = () => featureById(PREPARE_CLOSE);
const notes = () => featureById('resolution-notes');
const effOf = (policy = {}) => ({ ready: true, apiKey: 'k', values: { piiMode: 'standard', profiles: ['it', 'req', 'csm'], provider: 'openai', model: 'm' }, locked: {}, policy: normalizePolicy(policy) });
const head = (state) => ({ number: 'INC0010100', short_description: 'VPN', state, priority: '3 - Moderate' });

test('the feature: its id, title and line, where and when it is offered (as "Write resolution notes"), and what Insert fills', () => {
  const f = feature();
  assert.ok(f, 'in the registry');
  assert.equal(FEATURES.filter((x) => x.id === PREPARE_CLOSE).length, 1);
  assert.equal(f.title, 'Prepare to close');
  assert.equal(f.description, 'Resolve check, close code and notes in one go');
  assert.match(f.previewNote, /resolve check and the close code come from your ServiceNow data, not from the AI/);
  assert.deepEqual(f.kinds, notes().kinds);
  assert.equal(f.group, 'resolve');
  assert.equal(f.primary, 'insert');
  assert.equal(contextFor(f), 'resolution-notes', 'reads exactly what "Write resolution notes" reads');
  assert.equal(f.journal, notes().journal);
  for (const state of ['New', 'In Progress', 'Resolved', 'Closed', undefined]) {
    const rec = { kind: 'incident', table: 'incident', sysId: A };
    assert.equal(whenAllows(f, rec, state ? head(state) : null), whenAllows(notes(), rec, state ? head(state) : null), String(state));
  }
  // the notes box of each kind, as "Write resolution notes"; the close code is NOT an insert of the answer (it never comes from the AI)
  const inserts = insertsFor(f);
  assert.deepEqual(inserts.map((s) => [s.field, s.kinds, s.mode]), insertsFor(notes()).map((s) => [s.field, s.kinds, s.mode]));
  assert.ok(inserts.every((s) => isFillable(s.field) && s.field !== 'close_code'));
  assert.equal(inserts[0].label, 'Insert');
});

test('the fifth slot: Prepare to close first, Write resolution notes when it is not offered (and in All tools), the chat summary last', () => {
  assert.deepEqual([...PAIN_POINTS.find((p) => p.id === 'close').actions], ['prepare-close', 'resolution-notes', 'chat-summary']);
  const item = (id) => ({ feature: { id }, reason: '', caution: '' });
  const { five, rest } = focusActions(['record-summary', 'resolution-notes', 'prepare-close', 'chat-summary'].map(item));
  assert.equal(five.find((f) => f.pain === 'close').item.feature.id, 'prepare-close');
  assert.deepEqual(rest.map((it) => it.feature.id), ['resolution-notes', 'chat-summary']);
  assert.equal(focusActions(['resolution-notes', 'chat-summary'].map(item)).five[0].item.feature.id, 'resolution-notes', 'switched off: the notes fill the slot');
  // on a resolved incident the record really offers it, in the close slot; Write resolution notes is under All tools
  const plan = actionPlan({ record: { kind: 'incident', table: 'incident', sysId: A }, header: head('Resolved'), eff: effOf() });
  assert.equal(plan.five.find((f) => f.pain === 'close').item.feature.id, 'prepare-close');
  assert.ok(plan.rest.some((it) => it.feature.id === 'resolution-notes'));
  // the organisation can switch it off by its id (disabledFeatures): the notes take the slot back
  const off = actionPlan({ record: { kind: 'incident', table: 'incident', sysId: A }, header: head('Resolved'), eff: effOf({ disabledFeatures: ['prepare-close'] }) });
  assert.equal(off.five.find((f) => f.pain === 'close').item.feature.id, 'resolution-notes');
  // a new ticket: neither (nothing to close yet)
  const fresh = actionPlan({ record: { kind: 'incident', table: 'incident', sysId: A }, header: head('New'), eff: effOf() });
  assert.ok(!fresh.items.some((it) => it.feature.id === 'prepare-close'));
  assert.equal(stageOf(null, head('Resolved')), 'resolve');
});

test('the prompt is the resolution-notes prompt without its close-code line: the AI writes the notes only', () => {
  const f = feature();
  assert.ok(notes().system.includes(CODE_LINE) && notes().system.includes(CODE_RULE), 'core.js still words the close-code line this way (else bring CODE_LINE / CODE_RULE in step)');
  assert.equal(f.system, notes().system.replace(CODE_LINE, '').replace(CODE_RULE, ''));
  assert.doesNotMatch(f.system, /close code/i);
  assert.match(f.system, /Cause:[\s\S]*Fix:[\s\S]*Verification:/);
  assert.equal(f.instruction, notes().instruction);
  assert.equal(f.parts, notes().parts, 'the very same parts');
  // a prompt that was reworded is used as it is (Insert still leaves a close-code line out)
  assert.equal(notesOnlyPrompt('Something else entirely.'), 'Something else entirely.');
  assert.equal(notesOnlyPrompt(undefined), '');
});

// A ticket and what the panel knows around it: look-alikes with their codes, the caller's earlier ticket, the resolve check.
const PACK = {
  version: 1,
  table: 'incident',
  sysId: A,
  number: 'INC0010100',
  kind: 'incident',
  fields: { number: 'INC0010100', short_description: 'VPN drops every hour', description: 'Abel Tuter says the VPN drops every hour.', state: 'In Progress', close_notes: '', close_code: '' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'c'.repeat(32) }],
  journal: [{ type: 'work_note', by: 'Beth Anglin', when: '2026-11-05 10:00:00', text: 'Cleared the VPN profile cache, reinstalled the client.' }],
  related: {},
  access: [],
};
const LOOKALIKES = [1, 2, 3, 4].map((n) => ({ number: `INC00200${n}0`, close_code: 'Solved (Work Around)', close_code_value: 'workaround_xyz' }));
const HISTORY = { items: [{ table: 'incident', sysId: 'e'.repeat(32), number: 'INC0010019', short_description: 'VPN drops every hour again', category: '' }] };

test('the sections worked out in the panel never reach the model: the request is the resolution-notes request, word for word', () => {
  const view = buildCheckView(PACK, { form: null, links: null }, { now: Date.parse('2026-11-06T12:00:00Z') });
  const vote = closeCodeVote(LOOKALIKES);
  const repeat = repeatOfCaller(PACK.fields, HISTORY);
  const sections = closeSections({ view, vote, repeat, notesLabel: 'Resolution notes', notes: '' });
  assert.ok(vote.enough && repeat, 'the test has something to leak');
  // the parts are built from the pack only: no look-alike, no repeat, no check
  const parts = partsFor(feature(), PACK);
  assert.deepEqual(parts, partsFor(notes(), PACK));
  const values = effectiveSettings({ provider: 'anthropic' }, {}).values;
  const config = resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
  const sent = prepareRun({ feature: feature(), pack: PACK, values, policy: normalizePolicy({}), config, createFirewall });
  const wire = JSON.stringify(sent.request.messages);
  const local = [
    'workaround_xyz', 'Solved (Work Around)', closeCodeFact(vote), 'look-alike', 'INC0010019', 'INC0020010', repeat.line, 'From ServiceNow', 'From look-alikes',
    "From the caller's tickets", 'Ready to resolve?', ...sections[0].items.map((i) => i.title), 'Close code',
  ];
  for (const text of local) assert.ok(!wire.includes(text), `not sent: ${text}`);
  // ... and it is the notes request: the same data, the same rules, only the close-code line taken out of the task
  const theirs = prepareRun({ feature: notes(), pack: PACK, values, policy: normalizePolicy({}), config, createFirewall });
  assert.equal(sent.request.messages[1].content, theirs.request.messages[1].content, 'the same user message (the masked ticket data)');
  assert.equal(sent.request.messages[0].content, theirs.request.messages[0].content.replace(CODE_LINE, '').replace(CODE_RULE, ''), 'the same system message, minus the close-code line');
  assert.ok(!wire.includes('Abel Tuter'), 'the caller is masked, as in every request');
});
