import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { MAX_SUGGESTED, actionPlan, featureBlock, offeredFeatures, recordBlock } from '../src/sidepanel/ticket/assist/actions/plan.js';

// What the AI Assist half offers on a ticket, before anything is clicked: the suggestions for its state, the rest by group, and the
// light checks that disable an action with a reason instead of letting it fail after the click.

const A = 'a'.repeat(32);
const rec = (kind, table = kind) => ({ kind, table, sysId: A, number: 'X1' });
const head = (state, extra = {}) => ({ number: 'INC0010001', short_description: 'VPN', state, priority: '3 - Moderate', ...extra });
const eff = ({ values = {}, policy = {} } = {}) => ({
  ready: true,
  apiKey: 'k',
  values: { piiMode: 'standard', profiles: ['it', 'req', 'csm'], provider: 'openai', model: 'm', ...values },
  locked: {},
  policy: normalizePolicy(policy),
});
const ids = (items) => items.map((i) => i.feature.id);
const plan = (kind, state, opts = {}) => actionPlan({ record: rec(kind, opts.table), header: state === undefined ? null : head(state, opts.head), eff: opts.eff || eff(), gates: opts.gates });

test('a new incident: understand it and get it to the right place (summary first, the one primary)', () => {
  const p = plan('incident', 'New');
  assert.equal(p.stage, 'new');
  assert.deepEqual(ids(p.suggested), ['record-summary', 'missing-info', 'routing-hint']);
  assert.equal(p.words, 'Suggested for a new ticket');
  // no resolution notes and no article on a ticket that has just come in (AI19, AI21)
  const all = [...ids(p.suggested), ...p.groups.flatMap((g) => ids(g.items))];
  for (const id of ['resolution-notes', 'resolution-improve', 'kb-article-draft']) assert.ok(!all.includes(id), id);
});

test('an incident in progress: reply and move it on', () => {
  const p = plan('incident', 'In Progress');
  assert.equal(p.stage, 'working');
  assert.deepEqual(ids(p.suggested), ['reply-draft', 'next-best-action', 'record-summary']);
});

test('a resolved incident: wrap up (resolution notes, improve my notes, the article)', () => {
  const p = plan('incident', 'Resolved');
  assert.deepEqual(ids(p.suggested), ['resolution-notes', 'resolution-improve', 'kb-article-draft']);
  assert.equal(p.groups.find((g) => g.id === 'resolve'), undefined, 'every Resolve action is already a suggestion');
});

test('a closed incident: no reply, no questions for the customer, no next steps (AI7)', () => {
  const p = plan('incident', 'Closed');
  const all = [...ids(p.suggested), ...p.groups.flatMap((g) => ids(g.items))];
  for (const id of ['reply-draft', 'missing-info', 'next-best-action', 'routing-hint', 'handoff-brief', 'sentiment-risk']) assert.ok(!all.includes(id), id);
  assert.deepEqual(ids(p.suggested), ['record-summary', 'kb-article-draft', 'thread-summary']);
});

test('the state is not known yet: the everyday three, and nothing is hidden because of it', () => {
  const p = plan('incident', undefined);
  assert.equal(p.stage, null);
  assert.equal(p.words, 'Suggested');
  assert.deepEqual(ids(p.suggested), ['record-summary', 'reply-draft', 'next-best-action']);
  const all = [...ids(p.suggested), ...p.groups.flatMap((g) => ids(g.items))];
  assert.ok(all.includes('resolution-notes'));
  assert.ok(!all.includes('major-incident-comms'), 'a major incident is never assumed');
});

test('at most three suggestions, the rest under More by group, in the order Understand, Reply, Work it, Resolve; nothing twice', () => {
  for (const [kind, state] of [['incident', 'In Progress'], ['case', 'New'], ['requested_item', 'Work in Progress'], ['problem', 'Assess'], ['change', 'Scheduled']]) {
    const p = plan(kind, state);
    assert.ok(p.suggested.length <= MAX_SUGGESTED, kind);
    const grouped = p.groups.flatMap((g) => ids(g.items));
    const all = [...ids(p.suggested), ...grouped];
    assert.equal(new Set(all).size, all.length, `${kind}: no duplicates`);
    assert.equal(p.more, grouped.length);
    assert.equal(p.total, all.length);
    const order = ['understand', 'reply', 'work', 'resolve'];
    assert.deepEqual(p.groups.map((g) => g.id), order.filter((id) => p.groups.some((g) => g.id === id)), kind);
    assert.ok(p.groups.every((g) => g.items.length > 0), `${kind}: no empty group`);
  }
});

test('a kind\'s own action comes first: the CAB brief on a change, the RCA on a problem, the account on a case', () => {
  const mpc = { eff: eff({ values: { profiles: ['it', 'mpc'] } }) }; // (problem and change actions are for that profile)
  assert.deepEqual(ids(plan('change', 'Assess', mpc).suggested).slice(0, 2), ['record-summary', 'change-cab-brief']);
  assert.ok(ids(plan('problem', 'Root Cause Analysis', mpc).suggested).includes('problem-rca'));
  assert.deepEqual(ids(plan('case', 'New').suggested).slice(0, 2), ['record-summary', 'account-briefing']);
  assert.deepEqual(ids(plan('chat', undefined).suggested), ['chat-reply', 'chat-summary']);
  assert.deepEqual(ids(plan('knowledge', undefined, { eff: eff({ values: { profiles: ['it', 'km'] } }) }).suggested), ['article-optimise']);
});

test('AI15: the major incident updates appear on a P1 incident for the major incident profile, first while it is being worked', () => {
  const mpc = eff({ values: { profiles: ['it', 'mpc'] } });
  const p = plan('incident', 'In Progress', { head: { priority: '1 - Critical' }, eff: mpc });
  assert.deepEqual(ids(p.suggested).slice(0, 2), ['reply-draft', 'major-incident-comms']);
  const ordinary = plan('incident', 'In Progress', { eff: mpc });
  assert.ok(![...ids(ordinary.suggested), ...ordinary.groups.flatMap((g) => ids(g.items))].includes('major-incident-comms'));
  const noProfile = plan('incident', 'In Progress', { head: { priority: '1 - Critical' } });
  assert.ok(![...ids(noProfile.suggested), ...noProfile.groups.flatMap((g) => ids(g.items))].includes('major-incident-comms'), 'outside the person\'s profiles: not shown');
});

test('profiles decide what is shown; "show everything" shows it all', () => {
  const it = offeredFeatures({ record: rec('case'), header: head('Open'), eff: eff({ values: { profiles: ['it'] } }) }).map((f) => f.id);
  assert.ok(!it.includes('account-briefing'), 'customer service only');
  const all = offeredFeatures({ record: rec('case'), header: head('Open'), eff: eff({ values: { profiles: ['it'], showEverything: true } }) }).map((f) => f.id);
  assert.ok(all.includes('account-briefing'));
});

test('a feature the organisation switched off is not offered at all', () => {
  const p = plan('incident', 'In Progress', { eff: eff({ policy: { disabledFeatures: ['reply-draft'] } }) });
  assert.ok(![...ids(p.suggested), ...p.groups.flatMap((g) => ids(g.items))].includes('reply-draft'));
  assert.equal(ids(p.suggested)[0], 'next-best-action');
});

test('the checklist is offered only when the instructions have no steps (a gate that must say yes)', () => {
  const offered = (gates) => offeredFeatures({ record: rec('catalog_task', 'sc_task'), header: head('Open'), eff: eff(), gates }).map((f) => f.id);
  assert.ok(offered({ 'fulfilment-checklist': true }).includes('fulfilment-checklist'));
  assert.ok(!offered({ 'fulfilment-checklist': false }).includes('fulfilment-checklist'));
  assert.ok(!offered({ 'fulfilment-checklist': null }).includes('fulfilment-checklist'), 'not known yet: hidden');
  assert.ok(offered({}).includes('fulfilment-checklist'), 'no gate: the feature list alone decides');
});

// ---- light checks -----------------------------------------------------------------------------------------------------------

test('featureBlock: Strict privacy mode needed, or switched off; nothing otherwise', () => {
  const hr = featureById('hr-case-brief');
  assert.match(featureBlock(hr, eff()), /Needs Strict privacy mode/);
  assert.equal(featureBlock(hr, eff({ values: { piiMode: 'strict' } })), '');
  assert.equal(featureBlock(hr, eff({ values: { piiMode: 'local-only' } })), '');
  assert.equal(featureBlock(featureById('reply-draft'), eff()), '');
  assert.match(featureBlock(featureById('reply-draft'), eff({ policy: { disabledFeatures: ['reply-draft'] } })), /Switched off/);
});

test('recordBlock: a blocked table, HR content not allowed, HR without an approved endpoint, HR below Strict', () => {
  assert.equal(recordBlock({ record: rec('incident'), eff: eff() }), '');
  assert.match(recordBlock({ record: rec('incident'), eff: eff({ policy: { blockedTables: ['incident'] } }) }), /does not allow Agent Buddy to use incident records/);
  const hrRec = rec('hr_case', 'sn_hr_core_case');
  assert.match(recordBlock({ record: hrRec, eff: eff() }), /HR case content is not sent/);
  assert.match(recordBlock({ record: hrRec, eff: eff({ values: { piiMode: 'strict' }, policy: { allowHrContent: true } }) }), /approved/);
  assert.match(recordBlock({ record: hrRec, eff: eff({ policy: { allowHrContent: true, aiProvider: 'openai' } }) }), /HR records need Strict privacy mode/);
  // the pipeline's own rule (requiredMode): an HR child table, or a policy prefix, counts the same
  assert.match(recordBlock({ record: rec('task', 'sn_hr_core_task'), eff: eff({ policy: { allowHrContent: true, aiProvider: 'openai' } }) }), /HR records need Strict/);
  assert.match(recordBlock({ record: rec('incident', 'u_pay_case'), eff: eff({ policy: { allowHrContent: true, aiProvider: 'openai', sensitiveTablePrefixes: ['u_pay_'] } }) }), /HR records need Strict/);
  assert.equal(recordBlock({ record: hrRec, eff: eff({ values: { piiMode: 'strict' }, policy: { allowHrContent: true, aiProvider: 'openai' } }) }), '');
  // the plan carries it once, for the whole half
  const p = actionPlan({ record: hrRec, header: head('Work in Progress'), eff: eff({ values: { profiles: ['hr'] } }) });
  assert.match(p.block, /HR case content/);
});

test('a disabled action is never a suggestion: the next one that can run takes its place', () => {
  const strictOnly = { id: 'strict-thing', title: 'Summarise strictly', description: 'x', kinds: ['incident'], group: 'understand', primary: 'copy', requires: { minMode: 'strict' } };
  const p = actionPlan({ record: rec('incident'), header: head('In Progress'), eff: eff(), features: [strictOnly, featureById('record-summary'), featureById('reply-draft')] });
  assert.deepEqual(ids(p.suggested), ['reply-draft', 'record-summary']);
  const waiting = p.groups.flatMap((g) => g.items).find((i) => i.feature.id === 'strict-thing');
  assert.match(waiting.reason, /^Needs Strict privacy mode/);
  // on an HR record the whole record needs Strict: said once (recordBlock), not on each button
  const hr = actionPlan({ record: rec('hr_case', 'sn_hr_core_case'), header: head('Ready'), eff: eff({ values: { profiles: ['hr'] }, policy: { allowHrContent: true, aiProvider: 'openai' } }) });
  assert.match(hr.block, /HR records need Strict/);
  assert.ok([...hr.suggested, ...hr.groups.flatMap((g) => g.items)].every((i) => i.reason === ''), 'no button repeats it');
});

test('cautions travel with the action: comments on a catalog task do not reach the requester', () => {
  const p = plan('catalog_task', 'Work in Progress', { table: 'sc_task' });
  const reply = [...p.suggested, ...p.groups.flatMap((g) => g.items)].find((i) => i.feature.id === 'reply-draft');
  assert.match(reply.caution, /requester does not see comments on a catalog task/);
});
