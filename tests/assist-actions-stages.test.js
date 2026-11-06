import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featureById, featuresFor, insertsFor } from '../src/features/registry.js';
import { KINDS } from '../src/context/kinds.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { GROUPS, SUGGEST, STAGES, cautionFor, groupOf, hasCustomer, isMajorIncident, notClosed, notNew, stageOf, stageOfState, whenAllows } from '../src/features/stages.js';
import { numberedChoices, pickCauseNotes, pickFixNotes } from '../src/features/picks.js';

// The ticket's stage from its state, the groups, and the state rules of the AI Assist actions (TRACKER.md 3.5, AI1-AI22).

const rec = (kind, table = kind, extra = {}) => ({ kind, table, sysId: 'a'.repeat(32), ...extra });
const head = (state, extra = {}) => ({ number: 'INC0010001', short_description: 'VPN', state, priority: '3 - Moderate', ...extra });
const ticketFeatures = () => FEATURES.filter((f) => (f.kinds || []).length);

// ---- state -> stage ---------------------------------------------------------------------------------------------------------

test('the states of the base system map to four stages', () => {
  const cases = {
    new: ['New', 'Draft', 'Pending', 'Requested', 'Awaiting Approval', 'Awaiting Acceptance', 'Assess', '1 - New', 'Ready'],
    working: ['In Progress', 'Work in Progress', 'On Hold', 'Awaiting Info', 'Awaiting User Info', 'Open', 'Root Cause Analysis', 'Fix in Progress', 'Scheduled', 'Implement', 'Authorize', 'Suspended'],
    resolve: ['Resolved', 'Review', 'resolved'],
    closed: ['Closed', 'Closed Complete', 'Closed Incomplete', 'Closed Skipped', 'Canceled', 'Cancelled', '7 - Closed', 'Closed - Resolved by caller'],
  };
  for (const [stage, states] of Object.entries(cases)) for (const s of states) assert.equal(stageOfState(s), stage, s);
});

test('an empty or unknown state is no stage (it never hides anything); the header wins over the record', () => {
  for (const s of ['', null, undefined, 'Banana', 'Erledigt']) assert.equal(stageOfState(s), null, String(s));
  assert.equal(stageOf(rec('incident'), null), null, 'header still loading');
  assert.equal(stageOf(rec('incident', 'incident', { state: 'Closed' }), head('In Progress')), 'working');
  assert.equal(stageOf(rec('incident', 'incident', { state: 'Closed' }), null), 'closed');
  assert.deepEqual([...STAGES], ['new', 'working', 'resolve', 'closed']);
});

// ---- groups -----------------------------------------------------------------------------------------------------------------

test('every action of a ticket names one of the four groups, and the groups read as verbs of the work', () => {
  assert.deepEqual(GROUPS.map((g) => g.label), ['Understand', 'Reply', 'Work it', 'Resolve']);
  const ids = GROUPS.map((g) => g.id);
  for (const f of ticketFeatures()) {
    assert.ok(ids.includes(f.group), `${f.id}: group "${f.group}"`);
    assert.equal(groupOf(f), f.group);
  }
  assert.equal(groupOf({ id: 'made-up', group: 'nonsense' }), 'understand');
  assert.equal(groupOf({ id: 'reply-draft' }), 'reply', 'the default when a feature has none');
});

test('the brief\'s grouping: understand, reply, work it, resolve', () => {
  const g = (id) => groupOf(featureById(id));
  for (const id of ['record-summary', 'thread-summary', 'sentiment-risk', 'hr-case-brief', 'account-briefing']) assert.equal(g(id), 'understand', id);
  for (const id of ['reply-draft', 'missing-info', 'chat-reply', 'request-explain']) assert.equal(g(id), 'reply', id);
  for (const id of ['next-best-action', 'routing-hint', 'handoff-brief', 'case-eng-escalation', 'major-incident-comms', 'problem-rca', 'change-cab-brief', 'fulfilment-checklist']) assert.equal(g(id), 'work', id);
  for (const id of ['resolution-notes', 'resolution-improve', 'kb-article-draft', 'chat-summary']) assert.equal(g(id), 'resolve', id);
});

test('names start with a verb and the two summaries are clearly different (AI1, AI2)', () => {
  const VERBS = /^(Summarise|Catch|Check|Brief|Draft|Ask|Tell|Suggest|Write|Prepare|Improve|Translate)\b/;
  for (const f of ticketFeatures()) assert.match(f.title, VERBS, f.id);
  assert.equal(featureById('record-summary').title, 'Summarise this ticket');
  assert.equal(featureById('thread-summary').title, 'Catch up on the discussion');
  assert.notEqual(featureById('record-summary').description, featureById('thread-summary').description);
  assert.match(featureById('missing-info').title + featureById('missing-info').description, /customer/, 'AI8 says the questions go to the customer');
});

test('every SUGGEST list names real actions, once each', () => {
  for (const [stage, ids] of Object.entries(SUGGEST)) {
    assert.equal(new Set(ids).size, ids.length, stage);
    for (const id of ids) assert.ok(featureById(id), `${stage}: ${id}`);
  }
});

// ---- primary: copy first for notes to self -------------------------------------------------------------------------------------

test('primary: copy for notes to self, insert for text that belongs on the form; a feature with no insert is copy', () => {
  for (const f of ticketFeatures()) {
    assert.ok(['copy', 'insert'].includes(f.primary), `${f.id}: primary`);
    if (!insertsFor(f).length) assert.equal(f.primary, 'copy', `${f.id} has nothing to insert`);
  }
  for (const id of ['record-summary', 'thread-summary', 'sentiment-risk', 'next-best-action', 'routing-hint', 'hr-case-brief', 'account-briefing', 'change-cab-brief', 'chat-reply']) assert.equal(featureById(id).primary, 'copy', id);
  for (const id of ['handoff-brief', 'reply-draft', 'resolution-notes', 'resolution-improve', 'problem-rca']) assert.equal(featureById(id).primary, 'insert', id);
});

test('AI3: the mood is never inserted (copy only) and is not offered on internal tasks', () => {
  const f = featureById('sentiment-risk');
  assert.deepEqual(insertsFor(f), []);
  for (const kind of ['catalog_task', 'task', 'hr_case']) assert.ok(!f.kinds.includes(kind), kind);
  assert.ok(!featuresFor('catalog_task', normalizePolicy({})).some((x) => x.id === 'sentiment-risk'));
});

// ---- when rules -------------------------------------------------------------------------------------------------------------

test('AI7: no draft reply on a closed ticket, nor on a task of a problem or a change; it stays while the state is unknown', () => {
  const f = featureById('reply-draft');
  assert.equal(whenAllows(f, rec('incident'), head('In Progress')), true);
  assert.equal(whenAllows(f, rec('incident'), head('Closed')), false);
  assert.equal(whenAllows(f, rec('incident'), head('Canceled')), false);
  assert.equal(whenAllows(f, rec('incident'), null), true, 'unknown state: shown');
  assert.equal(whenAllows(f, rec('task', 'change_task'), head('Open')), false);
  assert.equal(whenAllows(f, rec('task', 'problem_task'), head('Open')), false);
  assert.equal(whenAllows(f, rec('task', 'incident_task'), head('Open')), true);
  assert.equal(hasCustomer(rec('task', 'CHANGE_TASK')), false);
  assert.equal(whenAllows(featureById('missing-info'), rec('incident'), head('Closed')), false);
});

test('AI7: a catalog task warns that the requester does not see its comments; an incident does not', () => {
  for (const id of ['reply-draft', 'missing-info', 'request-explain']) assert.match(cautionFor(featureById(id), rec('catalog_task', 'sc_task')), /requester does not see/, id);
  assert.equal(cautionFor(featureById('reply-draft'), rec('incident')), '');
  assert.equal(cautionFor(featureById('record-summary'), rec('catalog_task', 'sc_task')), '', 'only text for the customer gets the caution');
});

test('AI15: major incident updates only on a major incident', () => {
  const f = featureById('major-incident-comms');
  assert.deepEqual(f.kinds, ['incident']);
  const inc = rec('incident');
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '1 - Critical' })), true, 'priority 1 stands in when the state is not read');
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '2 - High' })), false);
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '2 - High', major_incident_state: 'Accepted' })), true);
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '2 - High', major_incident_state: 'Proposed' })), true);
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '1 - Critical', major_incident_state: '' })), false, 'the column is read and empty: not a major one');
  assert.equal(isMajorIncident(inc, head('In Progress', { priority: '1 - Critical', major_incident_state: 'Rejected' })), false);
  assert.equal(isMajorIncident(inc, null), false, 'unknown: not offered');
  assert.equal(isMajorIncident(rec('problem'), head('New', { priority: '1 - Critical' })), false);
  assert.equal(whenAllows(f, inc, head('In Progress', { priority: '1 - Critical' })), true);
  assert.equal(whenAllows(f, inc, head('In Progress')), false);
});

test('AI19 and AI21: no resolution notes or article on a ticket that has just come in; both later', () => {
  for (const id of ['resolution-notes', 'resolution-improve', 'kb-article-draft']) {
    const f = featureById(id);
    assert.equal(whenAllows(f, rec('incident'), head('New')), false, id);
    assert.equal(whenAllows(f, rec('incident'), head('In Progress')), true, id);
    assert.equal(whenAllows(f, rec('incident'), head('Resolved')), true, id);
    assert.equal(whenAllows(f, rec('incident'), null), true, `${id}: unknown state`);
  }
  assert.equal(notNew(rec('incident'), head('New')), false);
  assert.equal(notClosed(rec('incident'), head('Closed Complete')), false);
});

test('a rule that throws does not hide the action', () => {
  assert.equal(whenAllows({ when: () => { throw new Error('x'); } }, rec('incident'), null), true);
  assert.equal(whenAllows({}, rec('incident'), null), true);
  assert.equal(whenAllows({ when: () => false }, rec('incident'), null), false);
});

// ---- the right box per kind (F5) ------------------------------------------------------------------------------------------

test('resolution notes: Resolution notes on incidents and cases, Close notes on request forms, fix and cause notes on a problem; all replace', () => {
  const specs = insertsFor(featureById('resolution-notes'));
  const forKind = (kind) => specs.filter((s) => s.kinds.includes(kind)).map((s) => `${s.field}:${s.fieldLabel}`);
  assert.deepEqual(forKind('incident'), ['close_notes:Resolution notes']);
  assert.deepEqual(forKind('case'), ['close_notes:Resolution notes']);
  assert.deepEqual(forKind('catalog_task'), ['close_notes:Close notes']);
  assert.deepEqual(forKind('problem'), ['fix_notes:Fix notes', 'cause_notes:Cause notes']);
  assert.ok(specs.every((s) => s.mode === 'replace'));
  // every kind the feature lists has a box
  for (const kind of featureById('resolution-notes').kinds) assert.ok(forKind(kind).length, kind);
});

test('the problem split: the cause goes to cause notes, the fix and the check to fix notes, never the close-code advice', () => {
  const answer = 'Cause: The VPN certificate expired.\nFix: Renewed the certificate.\nRestarted the gateway.\nVerification: The customer connected.\nSuggested close code: Solved (permanently)';
  assert.equal(pickCauseNotes(answer), 'The VPN certificate expired.');
  assert.equal(pickFixNotes(answer), 'Fix: Renewed the certificate.\nRestarted the gateway.\nVerification: The customer connected.');
  assert.equal(pickCauseNotes('Cause: Not confirmed\nFix: x'), '');
  assert.equal(pickCauseNotes('no labels here'), '');
  assert.equal(pickCauseNotes('**Cause:** Disk full\n**Fix:** Cleared it'), 'Disk full');
});

test('the three chat replies come apart, each on its own; an intro and a closing remark are left out', () => {
  const answer = 'Here are three replies:\n1. Try signing out and in again.\n2) Which error do you see?\nIt helps to know.\n3. I am checking this now.\n\nLet me know if you need more.';
  assert.deepEqual(numberedChoices(answer), ['Try signing out and in again.', 'Which error do you see? It helps to know.', 'I am checking this now.']);
  assert.deepEqual(numberedChoices('no numbers at all'), []);
  assert.equal(numberedChoices('1. a\n2. b\n3. c\n4. d').length, 3);
  assert.equal(typeof featureById('chat-reply').choices, 'function');
});

test('every kind keeps at least one action, and no action lists a kind that does not exist', () => {
  for (const f of ticketFeatures()) for (const k of f.kinds) assert.ok(KINDS.includes(k), `${f.id}: ${k}`);
  for (const kind of KINDS) assert.ok(featuresFor(kind, normalizePolicy({})).length > 0, kind);
});
