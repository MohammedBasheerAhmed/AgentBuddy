const test = require('node:test');
const assert = require('node:assert/strict');
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runReport, createRuntime } from '../src/reports/engine/index.js';
import HandoverView, { HandoverAi, HandoverBody, noteChecks } from '../src/sidepanel/reports/HandoverView.jsx';
import CoachingView, { CoachingSample, coachingGate, coachingNeeds } from '../src/sidepanel/reports/CoachingView.jsx';
import InsightsView, { InsightsInputs, insightChecks } from '../src/sidepanel/reports/InsightsView.jsx';
import { AiResult, RunProgress } from '../src/sidepanel/reports/aiShared.jsx';
import ReportsDashboard from '../src/sidepanel/reports/ReportsDashboard.jsx';
import { sectionById } from '../src/sidepanel/reports/sections.js';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { createLoadedStore } from '../src/reports/ai/loaded.js';
import { USER, NOW, GROUP_A, dashboardWorld, handoverWorld } from './reports-ai-fixtures.js';

// Some shared components (RunPanel...) use JSX without importing React; the build uses the automatic runtime, this bundle uses
// the classic one. Providing React globally makes the same code render here.
globalThis.React = React;

// First render only (effects do not run in a static render): enough to catch a broken import, a typo in a render path, and to
// look at the structure and the safety of the markup. The views' behaviour after the first read is covered by the pure-module
// tests; none of this replaces using the panel in a real browser.
const h = React.createElement;
const html = (node) => renderToStaticMarkup(node);
const eff = (over = {}, policy = {}) => ({
  ready: true,
  values: { provider: 'anthropic', piiMode: 'standard', previewMode: 'always', previewSeen: [], models: {}, ...(over.values || {}) },
  locked: {},
  policy: normalizePolicy(policy),
  apiKey: 'sk-ant-test',
  keyLocked: false,
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'values')),
});
const page = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic', record: null, newRecord: null, user: { name: 'Beth Anglin' } };
const env = (over = {}) => ({ page, scope: { kind: 'groups' }, scopeKind: 'groups', tables: ['incident'], blocked: [], refreshKey: 0, mask: false, setMask() {}, canEdit: true, openList() {}, openTicket() {}, noteRead() {}, myGroups: [], groupsNote: '', ...over });

const TABLES = ['incident', 'sc_req_item', 'sc_task'];
const section = (name, inst, scope = { kind: 'groups' }) => runReport({ section: name, scope, tables: TABLES, params: {} }, { deps: inst.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 });

function assertClean(markup, label) {
  for (const bad of ['NaN', 'undefined', '[object', 'Infinity']) assert.ok(!markup.includes(bad), `${label}: markup contains ${bad}`);
  assert.ok(!/<(img|script|iframe)\b/i.test(markup), `${label}: a hostile tag came through`);
  assert.ok(!/\sstyle="/.test(markup), `${label}: inline style attribute (blocked by the extension CSP)`);
  assert.ok(!/\son[a-z]+="/i.test(markup), `${label}: inline event handler`);
}

const idleRun = (over = {}) => ({ phase: 'idle', busy: false, active: null, result: null, people: [], scan: null, error: '', lastPack: null, prepared: null, run() {}, again() {}, reset() {}, confirmPreview() {}, cancelPreview() {}, ...over });
const doneRun = (featureId, result, over = {}) => idleRun({ phase: 'done', active: featureById(featureId), result, lastPack: { table: 'report', sysId: 'x' }, ...over });

// ---- The hand-over page ---------------------------------------------------------------------------------------------------

test('the hand-over page: figures, what needs attention, what waits, what happened, the oldest; text only, nothing hostile', async () => {
  const hostile = '<img src=x onerror=alert(1)> printer';
  const inst = handoverWorld({ rules: [{ when: (c) => c.kind === 'query' && c.table === 'task' && c.query.includes('sys_idIN'), then: (c) => c.query.split('IN')[1].split(',').map((x, i) => ({ sys_id: { value: x, display_value: x }, number: { value: `INC${i + 1}`, display_value: `INC${i + 1}` }, short_description: { value: hostile, display_value: hostile }, priority: { value: '1', display_value: '1 - Critical' }, state: { value: '2', display_value: 'In Progress' }, assigned_to: { value: 'u', display_value: 'Ann <b>Lee</b>' }, assignment_group: { value: GROUP_A, display_value: 'Service Desk' }, sys_class_name: { value: 'incident', display_value: 'incident' } })) }] });
  const r = await section('handover', inst);
  const markup = html(h(HandoverBody, { d: r.data, env: env() }));
  assertClean(markup, 'handover');
  for (const text of ['Open', 'Breached', 'At risk', 'Due soon', 'Needs attention now', 'Waiting on others', 'On the customer', 'On an approval', 'Priority 1-2 opened', 'Priority 1-2 resolved', 'SLAs breached', 'Handed over 3+ times and touched', 'Oldest open']) {
    assert.ok(markup.includes(text), text);
  }
  assert.match(markup, /Awaiting Caller/);
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt; printer'), 'the hostile title is shown as text');
  assert.match(markup, /<button type="button" class="ab-chart-link">INC1<\/button>/, 'a ticket number opens the ticket');
});

test('the hand-over page tells the truth when SLAs cannot be read: tiles say so, no zero, no empty claims', async () => {
  const r = await section('handover', handoverWorld({ denied: ['task_sla'] }));
  const markup = html(h(HandoverBody, { d: r.data, env: env() }));
  assertClean(markup, 'handover without SLA');
  assert.ok((markup.match(/Not available to you/g) || []).length >= 3, 'breached, at risk, due soon');
  assert.match(markup, /SLA information is not available to you/);
  assert.match(markup, /SLAs breached<\/h3>\s*<p class="ab-note">Not available to you/);
  assert.ok(!markup.includes('No SLA is breached'), 'it must not claim all is well');
});

test('an empty hand-over says "None" for each list and that no SLA is at risk; it does not look broken', () => {
  const none = { available: false, total: 0, items: [], partial: false, capped: false };
  const empty = { available: true, total: 0, items: [], partial: false, capped: false };
  const d = {
    available: true, hours: 8, since: 0, until: 1,
    snapshot: { open: 0, unassigned: 0, stale: 0, staleDays: 3, waiting: 0, breached: 0, atRisk: 0, dueSoon: 0, dueSoonHours: 4, partial: [] },
    sla: { available: true, counts: { breached: 0, atRisk: 0, dueSoon: 0 }, ticketsAtIssue: 0, top: [] },
    waiting: { total: 0, customer: 0, approval: 0, other: 0, byState: [], approvals: { mine: 0, team: undefined }, oldest: [] },
    events: { opened: empty, resolved: empty, breaches: none, reassigned: empty },
    oldest: [],
  };
  const markup = html(h(HandoverBody, { d, env: env() }));
  assertClean(markup, 'empty handover');
  assert.match(markup, /No SLA is breached or at risk right now/);
  assert.equal((markup.match(/None in the last 8 hours\./g) || []).length, 3);
  assert.match(markup, /Nothing to show\./);
  assert.ok(!markup.includes('Waiting for you to approve') || /Waiting for you to approve/.test(markup));
});

test('the hours picker offers 8, 12 and 24 with 12 pressed, and the section reads while it loads', () => {
  const markup = html(h(HandoverView, { widget: { id: 'w1', type: 'section', section: 'handover' }, env: env(), eff: eff() }));
  assertClean(markup, 'handover view');
  assert.match(markup, /Shift handover/);
  for (const hrs of [8, 12, 24]) assert.ok(markup.includes(`>${hrs} hours</button>`), String(hrs));
  assert.match(markup, /aria-pressed="true">12 hours<\/button>/);
  assert.match(markup, /aria-pressed="false">8 hours<\/button>/);
  assert.match(markup, /Reading the numbers/);
  assert.match(markup, /role="group" aria-label="Period"/);
});

// ---- The hand-over note ---------------------------------------------------------------------------------------------------------

test('the note block says plainly what is sent, that a name only in a title is not masked, and that the preview shows it all', async () => {
  const result = await section('handover', handoverWorld());
  const markup = html(h(HandoverAi, { result, page, eff: eff(), hours: 12 }));
  assertClean(markup, 'note block');
  assert.match(markup, /Write the hand-over note/);
  assert.match(markup, /up to 15 notable tickets/);
  assert.match(markup, /A person named only inside a ticket title is not masked/);
  assert.match(markup, /it shows exactly what will be sent/);
  assert.match(markup, /<button[^>]*class="ab-btn ab-btn-sm ab-btn-primary"[^>]*>Write the hand-over note<\/button>/);
  assert.doesNotMatch(markup, /class="ab-btn ab-btn-sm ab-btn-primary"[^>]*disabled/);
});

test('the note button is disabled without an AI key, and replaced by a calm line when the organisation switched it off', async () => {
  const result = await section('handover', handoverWorld());
  const noKey = html(h(HandoverAi, { result, page, eff: eff({ apiKey: '' }), hours: 12 }));
  assert.match(noKey, /Add an AI key in Settings to use this\./);
  assert.match(noKey, /class="ab-btn ab-btn-sm ab-btn-primary"[^>]*disabled=""[^>]*>Write the hand-over note/);
  const off = html(h(HandoverAi, { result, page, eff: eff({}, { disabledFeatures: ['shift-handover'] }), hours: 12 }));
  assert.match(off, /switched off by your organisation/);
  assert.match(off, /The page above still works/);
  assert.doesNotMatch(off, /<button[^>]*>Write the hand-over note<\/button>/);
});

test('the finished note has Copy and Print only (no Insert), the text is shown as safe text, and Try again and Close are there', () => {
  const text = 'Headline: A quiet shift.\nNeeds attention now:\n- INC1 <img src=x onerror=alert(1)>\nWaiting on others: Not stated\nWatch during the next shift: Not stated\nNotes for the incoming team: Not stated';
  const markup = html(h(AiResult, { run: doneRun('shift-handover', text), eff: eff(), featureId: 'shift-handover', heading: 'Hand-over note, last 12 hours' }));
  assertClean(markup, 'note result');
  assert.match(markup, />Copy<\/button>/);
  assert.match(markup, />Print<\/button>/);
  assert.match(markup, />Try again<\/button>/);
  assert.match(markup, />Close<\/button>/);
  assert.doesNotMatch(markup, /Insert|Add to work notes|Open a new/);
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.match(markup, /AI can be wrong\. Check the text before you use it\./);
  assert.match(markup, /Hand-over note, last 12 hours/);
});

test('the result card shows nothing for another feature\'s run or an unfinished one', () => {
  const other = html(h(AiResult, { run: doneRun('dashboard-insights', 'x'), eff: eff(), featureId: 'shift-handover', heading: 'H' }));
  assert.equal(other, '');
  assert.equal(html(h(AiResult, { run: idleRun(), eff: eff(), featureId: 'shift-handover', heading: 'H' })), '');
  assert.equal(html(h(AiResult, { run: doneRun('shift-handover', null), eff: eff(), featureId: 'shift-handover', heading: 'H' })), '');
});

test('RunProgress hides the finished result (the card above draws it) but still shows progress and errors', () => {
  const done = html(h(RunProgress, { run: doneRun('shift-handover', 'Headline: x'), eff: eff(), page }));
  assert.equal(done, '', 'no second result card');
  const reading = html(h(RunProgress, { run: idleRun({ phase: 'reading' }), eff: eff(), page, readingText: 'Getting ready…' }));
  assert.match(reading, /Getting ready…/);
  const failed = html(h(RunProgress, { run: idleRun({ phase: 'error', error: 'Your organisation has switched this feature off.' }), eff: eff(), page }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /switched this feature off/);
});

test('the note\'s own checks: too long, and headings that did not come back', () => {
  assert.deepEqual(noteChecks('Headline: x\nNeeds attention now: x\nWaiting on others: x\nWatch during the next shift: x\nNotes for the incoming team: x'), []);
  const short = noteChecks('Headline: all quiet');
  assert.equal(short.length, 1);
  assert.match(short[0], /left out 4 headings: Needs attention now: Waiting on others: Watch during the next shift: Notes for the incoming team:/);
  const long = noteChecks(`Headline: x\nNeeds attention now: x\nWaiting on others: x\nWatch during the next shift: x\nNotes for the incoming team: ${'word '.repeat(240)}`);
  assert.match(long[0], /words; the aim was 220/);
});

// ---- Coaching ------------------------------------------------------------------------------------------------------------------

const coachingEnv = () => env({ myGroups: [{ id: GROUP_A, name: 'Service Desk' }, { id: 'b'.repeat(32), name: 'Network Ops' }] });
const coachingPolicy = { coachingEnabled: true };
const strict = { values: { piiMode: 'strict' } };

test('coaching is off unless the organisation switched it on: a calm line, no controls, nothing read', () => {
  const markup = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff() }));
  assertClean(markup, 'coaching off');
  assert.match(markup, /Your organisation has not switched coaching on\./);
  assert.doesNotMatch(markup, /<input|<select|<button/);
  const disabled = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff({}, { coachingEnabled: true, disabledFeatures: ['coaching-snapshot'] }) }));
  assert.match(disabled, /Your organisation has turned the coaching snapshot off\./);
  assert.doesNotMatch(disabled, /<input|<select|<button/);
  assert.equal(coachingGate(eff()), 'not-enabled');
  assert.equal(coachingGate(eff({}, { coachingEnabled: true, disabledFeatures: ['coaching-snapshot'] })), 'off');
  assert.equal(coachingGate(eff({}, coachingPolicy)), '');
});

test('when it is on: the reminder, what it reads, one group, the days, the size, and nothing can run before a group is chosen', () => {
  const markup = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff(strict, coachingPolicy) }));
  assertClean(markup, 'coaching on');
  assert.match(markup, /This is a coaching aid for the team lead only, not a performance rating\./);
  assert.match(markup, /not to name, score or rank people/);
  assert.match(markup, /Nothing is stored/);
  assert.match(markup, /close notes, close code and the customer-visible comments/);
  assert.match(markup, /Choose one group\./);
  assert.match(markup, />Service Desk<\/button>/);
  for (const id of ['ab-coach-group-search', 'ab-coach-from', 'ab-coach-to', 'ab-coach-size']) {
    assert.ok(markup.includes(`id="${id}"`), `${id} exists`);
    assert.ok(markup.includes(`for="${id}"`), `${id} has a label`);
  }
  assert.match(markup, /class="ab-btn ab-btn-sm"[^>]*disabled=""[^>]*>\s*Pick the sample/);
  assert.match(markup, /class="ab-btn ab-btn-sm ab-btn-primary"[^>]*disabled=""[^>]*>\s*Write the coaching snapshot/);
  assert.match(markup, /<option value="8" selected="">8<\/option>/);
  assert.doesNotMatch(markup, /<option value="11"|<option value="20"/);
  assert.match(markup, /type="date"/);
});

test('in Standard privacy mode coaching says it needs Strict and both buttons are off', () => {
  const markup = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff({}, coachingPolicy) }));
  assert.match(markup, /Coaching needs Strict privacy mode\. Change it in Settings\./);
  assert.match(markup, /disabled=""[^>]*>\s*Pick the sample/);
  assert.match(coachingNeeds(eff({}, coachingPolicy)), /Strict privacy mode/);
  assert.equal(coachingNeeds(eff(strict, coachingPolicy)), '');
  assert.equal(coachingNeeds(eff({ values: { piiMode: 'local-only' } }, coachingPolicy)), '');
});

test('a policy that blocks the fields coaching needs is said before anything is read', () => {
  const markup = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff(strict, { coachingEnabled: true, blockedFields: ['close_notes'] }) }));
  assert.match(markup, /Your organisation blocks the close notes field that coaching needs/);
  assert.match(markup, /disabled=""[^>]*>\s*Pick the sample/);
});

test('without an AI key the snapshot button says so', () => {
  const markup = html(h(CoachingView, { widget: { id: 'c' }, env: coachingEnv(), eff: eff({ ...strict, apiKey: '' }, coachingPolicy) }));
  assert.match(markup, /Add an AI key in Settings to use this\./);
});

test('the sample summary: numbers and ticket numbers only, what was read and what was not, and every outcome', () => {
  const ok = {
    ok: true, group: { name: 'Service Desk' }, candidates: 12, notes: ['One note.'], access: [{ note: 'INC2: comments could not be read' }],
    tickets: [{ number: 'INC1', comments: [{ text: 'x' }] }, { number: 'INC2', comments: [] }],
  };
  const markup = html(h(CoachingSample, { result: ok, dayLabel: 'between 2026-10-13 and 2026-10-27' }));
  assertClean(markup, 'sample');
  assert.match(markup, /Service Desk resolved 12 tickets between 2026-10-13 and 2026-10-27\. 2 were picked, spread evenly over those days, whoever worked on them/);
  assert.match(markup, /INC1, INC2/);
  assert.match(markup, /Work notes and descriptions were not read\./);
  assert.match(markup, /1 ticket had no such comment\./);
  assert.match(markup, /One note\./);
  assert.match(markup, /INC2: comments could not be read/);
  const refused = html(h(CoachingSample, { result: { ok: false, code: 'GROUP_TOO_SMALL', reason: 'This group has one person you can see.' }, dayLabel: '' }));
  assert.match(refused, /role="alert"[^>]*>This group has one person you can see\./);
  const empty = html(h(CoachingSample, { result: { ok: true, group: { name: 'Desk' }, candidates: 0, tickets: [], notes: [], access: [] }, dayLabel: '' }));
  assert.match(empty, /there is nothing to review/);
  assert.equal(html(h(CoachingSample, { result: null, dayLabel: '' })), '');
});

test('a coaching answer that seems to rate people is held back behind a warning; a clean one is shown with Copy and Print', () => {
  const clean = 'Ticket INC1\nClarity: Strong - clear.\nGroup themes:\n- Notes skip the cause.\nWhat the group does well:\n- Friendly openings.';
  const shown = html(h(AiResult, { run: doneRun('coaching-snapshot', clean), eff: eff(strict, coachingPolicy), featureId: 'coaching-snapshot', heading: 'Coaching snapshot' }));
  assert.match(shown, />Copy<\/button>/);
  assert.match(shown, />Print<\/button>/);
  assert.match(shown, /Notes skip the cause/);
  const withhold = { note: 'The AI\'s answer may rank, score or name individual people.', findings: [{ kind: 'person-rating', excerpt: 'Priya Raman scored best on tone.' }, { kind: 'ranking', excerpt: 'Here is the ranking.' }] };
  const held = html(h(AiResult, { run: doneRun('coaching-snapshot', 'Priya Raman scored best on tone.'), eff: eff(strict, coachingPolicy), featureId: 'coaching-snapshot', heading: 'Coaching snapshot', withhold }));
  assertClean(held, 'held');
  assert.match(held, /role="alert"/);
  assert.match(held, /rates a named person: <span class="ab-mono">Priya Raman scored best on tone\.<\/span>/);
  assert.match(held, /ranks people/);
  assert.match(held, />Show the answer anyway<\/button>/);
  assert.doesNotMatch(held, />Copy<\/button>|>Print<\/button>/, 'nothing to copy or print until the person chooses to see it');
  assert.ok(!held.includes('class="ab-output"'), 'the text itself is not in the page');
});

// ---- Explain this dashboard -----------------------------------------------------------------------------------------------------

test('the explainer with nothing loaded says what to add, and its button is off', () => {
  const markup = html(h(InsightsView, { widget: { id: 'i' }, env: env({ loaded: createLoadedStore() }), eff: eff() }));
  assertClean(markup, 'insights');
  assert.match(markup, /There are no numbers to explain yet\./);
  assert.match(markup, /class="ab-btn ab-btn-sm ab-btn-primary"[^>]*disabled=""[^>]*>\s*Explain these numbers/);
  assert.match(markup, /No ticket titles, descriptions or notes are sent/);
  assert.match(markup, /The preview shows exactly what will be sent\./);
});

test('the explainer says what it rests on and what is missing, and a switched-off one says so', async () => {
  const inst = dashboardWorld();
  const entries = [
    { id: 'a', section: 'overview', result: await section('overview', inst) },
    { id: 'b', section: 'sla', result: await section('sla', inst) },
  ];
  const markup = html(h(InsightsInputs, { entries }));
  assertClean(markup, 'insights inputs');
  assert.match(markup, /Based on what is on this dashboard now: Overview and SLA risk radar, read at/);
  assert.match(markup, /Not on this dashboard, so they are not part of the explanation: Workload and ageing, Quality and trend and Request fulfilment\./);
  const off = html(h(InsightsView, { widget: { id: 'i' }, env: env(), eff: eff({}, { disabledFeatures: ['dashboard-insights'] }) }));
  assert.match(off, /Your organisation has turned this off\./);
  assert.doesNotMatch(off, /Explain these numbers/);
  const noKey = html(h(InsightsView, { widget: { id: 'i' }, env: env(), eff: eff({ apiKey: '' }) }));
  assert.match(noKey, /Add an AI key in Settings to use this\./);
});

test('the explainer\'s answer checks', () => {
  assert.deepEqual(insightChecks('What stands out:\n- a\nLikely reasons (hypotheses):\n- Hypothesis: b\nSuggested actions:\n- c'), []);
  assert.match(insightChecks('What stands out:\n- a')[0], /left out: Likely reasons \(hypotheses\): Suggested actions:/);
});

test('the reports policy id still hides the whole Team tab, sections and all', () => {
  const off = html(h(ReportsDashboard, { page, eff: eff({}, { disabledFeatures: ['reports'] }), layout: 'panel' }));
  assert.match(off, /Your organisation has turned reports off./);
  assert.doesNotMatch(off, /Shift handover|Explain this dashboard|Coaching/);
  const on = html(h(ReportsDashboard, { page, eff: eff(), layout: 'panel' }));
  assert.match(on, /Loading your dashboards/);
});

// ---- The registry and the CSS ---------------------------------------------------------------------------------------------------

test('the three views are the registry\'s views and take the settings (the AI needs them)', () => {
  assert.equal(sectionById('handover').View, HandoverView);
  assert.equal(sectionById('coaching').View, CoachingView);
  assert.equal(sectionById('insights').View, InsightsView);
});

test('the new CSS uses theme tokens only (no hard-coded colours) and the print rule drops the buttons', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'areas', 'reports.css'), 'utf8');
  const mine = css.slice(css.indexOf('the AI sections: shift handover'));
  assert.ok(mine.length > 200);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(mine), 'colours come from --ab-* tokens');
  assert.match(mine, /@media print[\s\S]*\.ab-ai-actions[\s\S]*display: none/);
});
