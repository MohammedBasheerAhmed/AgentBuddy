import test from 'node:test';
import assert from 'node:assert/strict';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { actionPlan, featureBlock, offeredFeatures, recordBlock } from '../src/sidepanel/ticket/assist/actions/plan.js';

// What the AI Assist half offers on a ticket, before anything is clicked: every action the record offers, the five shown (one per pain
// point, docs/focus-layout.md), the rest (All tools), the one primary for the ticket's state, and the light checks that disable an
// action with a reason instead of letting it fail after the click.

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
const fiveIds = (p) => p.five.map((f) => f.item.feature.id);
const plan = (kind, state, opts = {}) => actionPlan({ record: rec(kind, opts.table), header: state === undefined ? null : head(state, opts.head), eff: opts.eff || eff(), gates: opts.gates });

test('a new incident: understand it and get it to the right place (the summary is the one primary)', () => {
  const p = plan('incident', 'New');
  assert.equal(p.stage, 'new');
  assert.equal(p.primary, 'record-summary');
  assert.equal(fiveIds(p)[0], 'record-summary', '"Understand the ticket" first');
  // no resolution notes and no article on a ticket that has just come in (AI19, AI21)
  for (const id of ['resolution-notes', 'resolution-improve', 'kb-article-draft']) assert.ok(!ids(p.items).includes(id), id);
  assert.ok(ids(p.rest).includes('missing-info') && ids(p.rest).includes('routing-hint'), 'what is missing and where it goes: in All tools');
});

test('an incident in progress: reply and move it on', () => {
  const p = plan('incident', 'In Progress');
  assert.equal(p.stage, 'working');
  assert.equal(p.primary, 'reply-draft');
  for (const id of ['record-summary', 'next-best-action', 'reply-draft']) assert.ok(fiveIds(p).includes(id), id);
});

test('a resolved incident: wrap up (the resolution notes are the primary)', () => {
  const p = plan('incident', 'Resolved');
  assert.equal(p.primary, 'resolution-notes');
  assert.equal(p.five.find((f) => f.pain === 'close').item.feature.id, 'resolution-notes');
  assert.ok(ids(p.rest).includes('resolution-improve') && ids(p.rest).includes('kb-article-draft'));
});

test('a closed incident: no reply, no questions for the customer, no next steps (AI7)', () => {
  const p = plan('incident', 'Closed');
  for (const id of ['reply-draft', 'missing-info', 'next-best-action', 'routing-hint', 'handoff-brief', 'sentiment-risk']) assert.ok(!ids(p.items).includes(id), id);
  assert.equal(p.primary, 'record-summary');
  assert.ok(!p.five.some((f) => f.pain === 'reply'), 'no "Reply" row on a closed ticket');
});

test('the state is not known yet: the summary is the primary, and nothing is hidden because of it', () => {
  const p = plan('incident', undefined);
  assert.equal(p.stage, null);
  assert.equal(p.primary, 'record-summary');
  assert.ok(ids(p.items).includes('resolution-notes'));
  assert.ok(!ids(p.items).includes('major-incident-comms'), 'a major incident is never assumed');
});

test('five at most, one per pain point in the order of the five; every other action in the rest; nothing twice', () => {
  const order = ['understand', 'fix', 'caller', 'reply', 'close'];
  for (const [kind, state] of [['incident', 'In Progress'], ['case', 'New'], ['requested_item', 'Work in Progress'], ['problem', 'Assess'], ['change', 'Scheduled']]) {
    const p = plan(kind, state);
    assert.ok(p.five.length <= 5, kind);
    assert.deepEqual(p.five.map((f) => f.pain), order.filter((id) => p.five.some((f) => f.pain === id)), kind);
    const all = [...fiveIds(p), ...ids(p.rest)];
    assert.equal(new Set(all).size, all.length, `${kind}: no duplicates`);
    assert.equal(p.total, all.length);
    assert.deepEqual([...all].sort(), ids(p.items).sort(), `${kind}: every action is somewhere`);
    assert.ok(!p.primary || fiveIds(p).includes(p.primary), `${kind}: the primary is one of the five`);
  }
});

test('the kind decides what fills a slot: a case\'s account briefing (or the caller briefing) in "Same caller", a chat\'s replies, an article\'s one action in All tools', () => {
  const kase = plan('case', 'New');
  assert.equal(kase.primary, 'record-summary');
  assert.ok(['caller-briefing', 'account-briefing'].includes(kase.five.find((f) => f.pain === 'caller')?.item.feature.id), fiveIds(kase).join());
  const chat = plan('chat', undefined);
  assert.equal(chat.primary, 'chat-reply');
  assert.deepEqual(chat.five.map((f) => [f.pain, f.item.feature.id]).filter(([pain]) => pain === 'reply' || pain === 'close'), [['reply', 'chat-reply'], ['close', 'chat-summary']]);
  const kb = plan('knowledge', undefined, { eff: eff({ values: { profiles: ['it', 'km'] } }) });
  assert.deepEqual(ids(kb.rest), ['article-optimise']);
  assert.equal(kb.five.length, 0);
  assert.equal(kb.primary, '', 'no row, so no filled mark');
  const mpc = { eff: eff({ values: { profiles: ['it', 'mpc'] } }) };
  assert.ok(ids(plan('change', 'Assess', mpc).items).includes('change-cab-brief'));
  assert.equal(plan('problem', 'Root Cause Analysis', mpc).five.find((f) => f.pain === 'fix')?.item.feature.id, 'problem-rca');
});

test('AI15: the major incident updates are offered on a P1 incident for the major incident profile (in All tools)', () => {
  const mpc = eff({ values: { profiles: ['it', 'mpc'] } });
  const p = plan('incident', 'In Progress', { head: { priority: '1 - Critical' }, eff: mpc });
  assert.ok(ids(p.rest).includes('major-incident-comms'));
  assert.equal(p.primary, 'reply-draft');
  assert.ok(!ids(plan('incident', 'In Progress', { eff: mpc }).items).includes('major-incident-comms'));
  assert.ok(!ids(plan('incident', 'In Progress', { head: { priority: '1 - Critical' } }).items).includes('major-incident-comms'), 'outside the person\'s profiles: not shown');
});

test('profiles decide what is shown; "show everything" shows it all', () => {
  const it = offeredFeatures({ record: rec('case'), header: head('Open'), eff: eff({ values: { profiles: ['it'] } }) }).map((f) => f.id);
  assert.ok(!it.includes('account-briefing'), 'customer service only');
  const all = offeredFeatures({ record: rec('case'), header: head('Open'), eff: eff({ values: { profiles: ['it'], showEverything: true } }) }).map((f) => f.id);
  assert.ok(all.includes('account-briefing'));
});

test('a feature the organisation switched off is not offered at all', () => {
  const p = plan('incident', 'In Progress', { eff: eff({ policy: { disabledFeatures: ['reply-draft'] } }) });
  assert.ok(!ids(p.items).includes('reply-draft'));
  assert.ok(!p.five.some((f) => f.pain === 'reply'), 'no row for it');
  assert.equal(p.primary, 'next-best-action', "the next of the stage's list among the five");
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

test("a disabled action keeps its row (it says why) but is never the primary: the next of the stage's list takes the mark", () => {
  const strictReply = { ...featureById('reply-draft'), requires: { minMode: 'strict' } };
  const p = actionPlan({ record: rec('incident'), header: head('In Progress'), eff: eff(), features: [strictReply, featureById('record-summary')] });
  assert.deepEqual(fiveIds(p), ['record-summary', 'reply-draft']);
  assert.equal(p.primary, 'record-summary');
  const waiting = p.five.find((f) => f.item.feature.id === 'reply-draft').item;
  assert.match(waiting.reason, /^Needs Strict privacy mode/);
  // on an HR record the whole record needs Strict: said once (recordBlock), not on each button
  const hr = actionPlan({ record: rec('hr_case', 'sn_hr_core_case'), header: head('Ready'), eff: eff({ values: { profiles: ['hr'] }, policy: { allowHrContent: true, aiProvider: 'openai' } }) });
  assert.match(hr.block, /HR records need Strict/);
  assert.ok(hr.items.every((i) => i.reason === ''), 'no button repeats it');
});

test('cautions travel with the action: comments on a catalog task do not reach the requester', () => {
  const p = plan('catalog_task', 'Work in Progress', { table: 'sc_task' });
  const reply = p.items.find((i) => i.feature.id === 'reply-draft');
  assert.match(reply.caution, /requester does not see comments on a catalog task/);
});
