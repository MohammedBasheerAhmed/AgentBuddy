import test from 'node:test';
import assert from 'node:assert/strict';
import { agoText, noteInstant, relativeText, shortSpan, tzOffsetMs } from '../src/insights/time.js';
import { buildGlance, customerWaiting, ownerText, glanceSlaLine, waitingText } from '../src/insights/glance.js';
import { outageSignal } from '../src/insights/outage.js';
import { levelOf, priorityMismatch, riskSignals } from '../src/insights/risk.js';
import { routingVote } from '../src/insights/routing.js';
import { missingDetails } from '../src/insights/missing.js';
import { articleSteps, firstSentences, stepsThatWorked } from '../src/insights/steps.js';
import { buildJourney, groupPath, journeySummary } from '../src/insights/journey.js';
import { EMAIL_TEMPLATES, emailAsText, fillEmailTemplate, recipientOf } from '../src/insights/emailTemplates.js';
import { EMAIL_TYPES } from '../src/compose/emailRecommend.js';
import { openFor, rankFor, stateBucket } from '../src/insights/order.js';
import { chaseLine, fixFor } from '../src/insights/fixes.js';
import { arrangeChanges, arrangeProblems, changeTiming } from '../src/insights/changes.js';
import { articleShareUrl } from '../src/insights/links.js';
import { callerSummary, historyLine, relatedSummary, repeatLine } from '../src/insights/related.js';
import { createInsightStore } from '../src/insights/cache.js';
import { chatOverviewOf } from '../src/insights/chat.js';
import insightOps from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID, NOW } from './fixtures/sn-incident.js';

const H = 3600000;
const D = 24 * H;
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ABEL = { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', firstName: 'Abel', lastName: 'Tuter', sysId: 'a'.repeat(32) };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com', sysId: 'b'.repeat(32) };
const comment = (hoursAgo, by, text = 'Hello') => ({ when: at(NOW - hoursAgo * H), by, type: 'comment', text });
const pack = (extra = {}) => ({
  table: 'incident',
  sysId: 'c'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High', assigned_to: 'Beth Anglin', ...(extra.fields || {}) },
  people: extra.people || [ABEL, BETH],
  journal: extra.journal || [],
  related: extra.related || {},
  access: extra.access || [{ source: 'journal', status: 'ok', strategy: 'sys_journal_field' }],
  ...(extra.sensitive ? { sensitive: true } : {}),
});

// ---- time ----------------------------------------------------------------------------------------------------------------------

test('time: short spans and "ago" are coarse and never negative', () => {
  assert.equal(shortSpan(130 * 60000), '2h 10m');
  assert.equal(shortSpan(13 * H + 5 * 60000), '13h');
  assert.equal(shortSpan(35 * 60000), '35 min');
  assert.equal(shortSpan(4 * D + H), '4 d');
  assert.equal(shortSpan(-5), 'under 1 min');
  assert.equal(shortSpan(NaN), '');
  assert.equal(agoText(30000), 'just now');
  assert.equal(agoText(3 * H), '3 h ago');
  assert.equal(agoText(3 * D), '3 d ago');
  assert.equal(relativeText(NOW + 3 * D, NOW), 'in 3 d');
  assert.equal(relativeText(NOW - 2 * H, NOW), '2 h ago');
});

test('time: the reader\'s offset comes from a date the pack has both ways; local note times are put right with it', () => {
  const local = pack({
    fields: { sys_updated_on: '2026-10-26 10:25:00' },
    related: { times: { sys_updated_on: '2026-10-26 08:25:00' } },
    access: [{ source: 'journal', status: 'ok', strategy: 'record-fields' }],
  });
  assert.equal(tzOffsetMs(local), 2 * H);
  assert.deepEqual(noteInstant({ when: '2026-10-26 10:00:00' }, local), { ms: Date.UTC(2026, 9, 26, 8, 0, 0), approx: false });
  // UTC notes are taken as they are
  assert.equal(noteInstant({ when: '2026-10-26 10:00:00' }, pack()).ms, Date.UTC(2026, 9, 26, 10, 0, 0));
  // a display format that is not ISO: the offset cannot be told, and the time is marked approximate
  const odd = pack({ fields: { sys_updated_on: '26/10/2026 10:25' }, related: { times: { sys_updated_on: '2026-10-26 08:25:00' } }, access: [{ source: 'journal', status: 'ok', strategy: 'record-fields' }] });
  assert.equal(tzOffsetMs(odd), null);
  assert.equal(noteInstant({ when: '2026-10-26 10:00:00' }, odd).approx, true);
  assert.equal(tzOffsetMs(pack({ fields: { sys_updated_on: '2026-10-29 10:25:00' }, related: { times: { sys_updated_on: '2026-10-26 08:25:00' } } })), null, 'no real zone is 3 days off');
});

// ---- N1 glance -------------------------------------------------------------------------------------------------------------------

test('glance SLA: breached, running with time left, paused, past due, finished; unknown when it could not be read', () => {
  const end = (h) => at(NOW + h * H);
  assert.deepEqual(glanceSlaLine(null, NOW).kind, 'unknown');
  assert.equal(glanceSlaLine([], NOW).text, '');
  const running = glanceSlaLine([{ name: 'P2 resolution', stage: 'In progress', stageValue: 'in_progress', breached: false, plannedEndUtc: end(2 + 1 / 6) }], NOW);
  assert.equal(running.text, 'SLA 2h 10m');
  assert.equal(running.tone, '');
  assert.equal(glanceSlaLine([{ stage: 'In progress', breached: false, plannedEndUtc: end(0.5) }], NOW).tone, 'warn');
  assert.equal(glanceSlaLine([{ stage: 'In progress', breached: true, plannedEndUtc: end(-1) }], NOW).text, 'SLA breached');
  assert.equal(glanceSlaLine([{ stage: 'In progress', breached: false, plannedEndUtc: end(-1) }], NOW).text, 'SLA past due');
  assert.equal(glanceSlaLine([{ stage: 'Paused', stageValue: 'paused', breached: false, plannedEndUtc: end(1) }], NOW).text, 'SLA paused');
  assert.equal(glanceSlaLine([{ stage: 'Completed', breached: true }], NOW).text, 'SLA was breached');
  assert.equal(glanceSlaLine([{ stage: 'Achieved', breached: false }], NOW).text, '');
  assert.equal(glanceSlaLine([{ stage: 'Cancelled', breached: true }], NOW).kind, 'none');
  // the soonest of two running SLAs
  assert.equal(glanceSlaLine([{ stage: 'In progress', plannedEndUtc: end(8) }, { stage: 'In progress', plannedEndUtc: end(1.5) }], NOW).text, 'SLA 1h 30m');
});

test('glance: customer waiting runs from the first unanswered customer message; not when support wrote last or the customer is unknown', () => {
  const waiting = customerWaiting(pack({ journal: [comment(100, 'Beth Anglin'), comment(96, 'Abel Tuter'), comment(50, 'Abel Tuter')] }), NOW);
  assert.equal(waiting.waiting, true);
  assert.equal(Math.round(waiting.sinceMs / H), 96);
  assert.equal(waitingText(waiting), 'Customer waiting 4 d');
  assert.equal(customerWaiting(pack({ journal: [comment(5, 'Abel Tuter'), comment(2, 'Beth Anglin')] }), NOW).waiting, false);
  const unknown = customerWaiting(pack({ people: [BETH], journal: [comment(5, 'Abel Tuter')] }), NOW);
  assert.equal(unknown.waiting, false);
  assert.equal(unknown.known, false);
  // an author that cannot be told apart stops the run
  assert.equal(customerWaiting(pack({ journal: [comment(5, 'Abel Tuter'), comment(4, '')] }), NOW).waiting, false);
  // local note times and no known offset: said in days only
  const approx = customerWaiting(pack({ journal: [comment(30, 'Abel Tuter')], access: [{ source: 'journal', status: 'ok', strategy: 'record-fields' }] }), NOW);
  assert.equal(approx.approx, true);
  assert.equal(waitingText(approx), 'Customer waiting about 1 d');
  assert.equal(waitingText({ ...approx, sinceMs: 3 * H }), 'Customer waiting today');
});

test('glance: three short lines from the header and the glance read; nothing claimed from a read that failed', () => {
  const record = { table: 'incident', sysId: 'c'.repeat(32), number: 'INC0010001', kind: 'incident' };
  const header = { number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High' };
  const answer = {
    pack: pack({ journal: [comment(30, 'Abel Tuter')], related: { times: { sys_updated_on: at(NOW - 3 * H) } } }),
    slas: { items: [{ name: 'P2', stage: 'In progress', breached: false, plannedEndUtc: at(NOW + 130 * 60000) }], access: [{ status: 'ok' }] },
    vip: { status: 'yes' },
    outage: { hits: [1, 2, 3].map((n) => ({ number: `INC00000${n}`, hoursAgo: n / 2, same: ['cmdb_ci'] })), windowHours: 24, access: [{ status: 'ok' }] },
  };
  answer.pack.fields.cmdb_ci = 'VPN Gateway EU';
  const g = buildGlance({ record, header, headPhase: 'ready', answer, now: NOW });
  assert.equal(g.number, 'INC0010001');
  assert.equal(g.title, 'VPN keeps disconnecting');
  assert.equal(g.vip, true);
  assert.deepEqual(g.line2.map((b) => b.text), ['In Progress', '2 - High', 'SLA 2h 10m']);
  assert.deepEqual(g.line3, ['Beth Anglin', 'Customer waiting 30h', 'Updated 3 h ago']);
  assert.equal(g.outage.line, '3 other open tickets on VPN Gateway EU in the last 2 h');
  // while the read is on its way: the header only
  const early = buildGlance({ record, header, headPhase: 'ready', answer: null, now: NOW });
  assert.deepEqual(early.line2.map((b) => b.text), ['In Progress', '2 - High']);
  assert.deepEqual(early.line3, []);
  assert.equal(early.vip, false);
  // SLAs the user cannot see are left out, not "no SLA"
  const hidden = buildGlance({ record, header, headPhase: 'ready', answer: { ...answer, slas: { items: [], access: [{ status: 'empty-or-hidden' }] } }, now: NOW });
  assert.deepEqual(hidden.line2.map((b) => b.text), ['In Progress', '2 - High']);
  // the header failed: the glance read still gives the title
  const failed = buildGlance({ record, header: null, headPhase: 'failed', answer, now: NOW });
  assert.equal(failed.title, 'VPN keeps disconnecting');
  assert.equal(ownerText({ assignment_group: 'Network' }), 'Network (no one assigned)');
  assert.equal(ownerText({}), 'Unassigned');
});

test('glance on the fake instance: the op answer drawn end to end', async () => {
  const deps = Object.assign(fakeDeps(buildInstance()), { now: () => NOW });
  const answer = await insightOps.glance({ table: 'incident', sysId: INCIDENT_ID }, { deps, checkRecord, checkPack });
  const g = buildGlance({ record: { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' }, header: null, headPhase: 'loading', answer, now: NOW });
  assert.equal(g.title, 'VPN keeps disconnecting for Abel Tuter (abel.tuter@example.com)');
  assert.ok(g.line2.some((b) => b.text === 'SLA 5h 55m'), JSON.stringify(g.line2));
  assert.equal(g.line3[0], 'Beth Anglin');
  assert.ok(!g.line3.some((x) => /waiting/.test(x)), 'Beth answered last');
  assert.equal(g.outage, null, 'two other tickets in 24 h is not an outage');
});

// ---- N29 outage ----------------------------------------------------------------------------------------------------------------

test('outage: three or more other open tickets in two hours; a read that failed is never "no outage"', () => {
  const p = pack({ fields: { cmdb_ci: 'VPN Gateway EU', business_service: 'Remote Access' } });
  const hits = (hours, same = ['cmdb_ci']) => hours.map((h, i) => ({ number: `INC${i}`, hoursAgo: h, same }));
  const over = outageSignal({ hits: hits([0.2, 1, 1.9, 5]), windowHours: 24, access: [{ status: 'ok' }] }, p);
  assert.equal(over.over, true);
  assert.equal(over.count, 3);
  assert.equal(over.line, '3 other open tickets on VPN Gateway EU in the last 2 h');
  const calm = outageSignal({ hits: hits([0.5, 3]), windowHours: 24, access: [{ status: 'ok' }] }, p);
  assert.equal(calm.over, false);
  assert.equal(calm.line, '2 other open tickets on VPN Gateway EU in the last 24 h');
  assert.equal(outageSignal({ hits: hits([0.5, 1, 1.5], ['business_service']), access: [{ status: 'ok' }] }, p).target, 'Remote Access');
  const denied = outageSignal({ hits: [], access: [{ status: 'denied' }] }, p);
  assert.equal(denied.readable, false);
  assert.equal(denied.line, '');
  assert.equal(outageSignal({ hits: [], access: [{ status: 'empty' }] }, p).line, 'No other open tickets on VPN Gateway EU in the last 24 h');
  assert.equal(outageSignal({ hits: [], access: [{ status: 'skipped', note: 'No CI.' }] }, p).note, 'No CI.');
});

// ---- N9 risk -------------------------------------------------------------------------------------------------------------------

test('risk: each signal says why, with our own word labels; priority mismatches for VIP, impact and outage', () => {
  assert.equal(levelOf('4 - Low'), 4);
  assert.equal(levelOf('Low'), null);
  assert.deepEqual(priorityMismatch({ fields: { priority: '4 - Low' }, vip: true }), ['The caller is a VIP but the priority is 4 - Low.']);
  assert.equal(priorityMismatch({ fields: { priority: '3 - Moderate', impact: '1 - High' } }).length, 1);
  assert.equal(priorityMismatch({ fields: { priority: '3 - Moderate' }, outageCount: 4 }).length, 1);
  assert.deepEqual(priorityMismatch({ fields: { priority: '1 - Critical' }, vip: true }), []);
  assert.deepEqual(priorityMismatch({ fields: {} , vip: true }), [], 'no priority, no claim');

  const angry = pack({
    fields: { priority: '4 - Low', reopen_count: '2', reassignment_count: '4' },
    journal: [comment(60, 'Abel Tuter', 'This is UNACCEPTABLE. I am fed up and will escalate to my manager.'), comment(55, 'Abel Tuter', 'Any update? It happened again!!')],
  });
  const r = riskSignals({ pack: angry, vip: true, slas: [{ name: 'P4', stage: 'In progress', breached: true }], now: NOW });
  const ids = r.signals.map((s) => s.id);
  for (const want of ['vip', 'priority-0', 'sla', 'waiting', 'escalation', 'frustration', 'reopened', 'reassigned']) assert.ok(ids.includes(want), `${want} in ${ids}`);
  assert.equal(r.attention, 'danger');
  assert.match(r.signals.find((s) => s.id === 'frustration').why, /"unacceptable"/);
  assert.ok(!JSON.stringify(r.signals).includes('my manager'), 'the ticket text is never quoted');
  assert.equal(r.signals[0].level, 'high', 'high first');

  const calm = riskSignals({ pack: pack({ journal: [comment(5, 'Abel Tuter', 'Thanks for the help'), comment(4, 'Beth Anglin', 'You are welcome')] }), now: NOW });
  assert.deepEqual(calm.signals, []);
  assert.equal(calm.summary, 'No warning signs');
  assert.equal(calm.attention, '');
});

// ---- N10 routing ---------------------------------------------------------------------------------------------------------------

test('routing: "4 of 5 went to Network Support"; too few or a split vote says so', () => {
  const hit = (group, category = 'Network', number = 'INC1') => ({ number, assignment_group: group, category });
  const vote = routingVote([hit('Network Support'), hit('Network Support'), hit('network support'), hit('Network Support'), hit('Desktop', 'Hardware')], { group: 'Service Desk' });
  assert.equal(vote.enough, true);
  assert.equal(vote.line, '4 of 5 solved look-alikes went to Network Support, category Network');
  assert.equal(vote.strong, true);
  assert.equal(vote.matchesGroup, false);
  assert.equal(vote.detail, 'This ticket is with Service Desk.');
  assert.equal(routingVote([hit('A'), hit('A')], { group: 'a' }).detail, 'This ticket is already with A.');
  const split = routingVote([hit('A'), hit('B')]);
  assert.equal(split.strong, false);
  assert.match(split.line, /different groups/);
  assert.equal(routingVote([hit('A'), { number: 'x' }]).enough, false);
  assert.equal(routingVote(null).enough, false);
});

// ---- N11 missing ---------------------------------------------------------------------------------------------------------------

test('missing details: empty or vague key fields, each with why; HR text is not judged; requests are not checked', () => {
  const thin = missingDetails(pack({ fields: { short_description: 'Issue', description: 'It broke.' } }));
  const ids = thin.items.map((i) => i.id);
  for (const want of ['title', 'description', 'ci', 'impact', 'error', 'steps', 'category']) assert.ok(ids.includes(want), `${want} in ${ids}`);
  assert.ok(thin.items.every((i) => i.why && i.short));
  const good = missingDetails(
    pack({
      fields: {
        short_description: 'VPN drops every 10 minutes on the London profile',
        description: 'Since Monday the VPN client shows error 619 and disconnects. Only me, my team is fine. Steps: 1. connect 2. wait ten minutes',
        cmdb_ci: 'VPN Gateway EU',
        category: 'Network',
      },
    })
  );
  assert.deepEqual(good.items, []);
  assert.deepEqual(missingDetails(pack({ fields: {}, people: [] })).items.find((i) => i.id === 'contact').title, 'No caller or contact');
  const noEmail = missingDetails(pack({ people: [{ ...ABEL, email: '' }] }));
  assert.ok(noEmail.items.some((i) => i.title === 'No email address for the caller'));
  const unreadable = missingDetails(pack({ people: [{ ...ABEL, email: '' }], access: [{ source: 'sys_user', status: 'denied' }] }));
  assert.ok(!unreadable.items.some((i) => i.id === 'contact'), 'an email that could not be read is not missing');
  const hr = missingDetails({ ...pack({ fields: {} }), sensitive: true });
  assert.equal(hr.textRead, false);
  assert.ok(!hr.items.some((i) => ['title', 'description', 'error', 'steps', 'contact'].includes(i.id)));
  assert.equal(missingDetails({ kind: 'requested_item', fields: {} }).applicable, false);
});

// ---- N12 steps -----------------------------------------------------------------------------------------------------------------

test('steps that worked: fixes and article steps in one list, best first, the same fix once', () => {
  assert.equal(firstSentences('Reset the token. User re-enrolled MFA. Verified.', 30), 'Reset the token.');
  assert.equal(articleSteps('Symptoms\n- Check the client version\n- Switch the profile to TCP mode\nMore text'), 'Check the client version; Switch the profile to TCP mode');
  assert.equal(articleSteps('Just one sentence here. And another.'), 'Just one sentence here. And another.');
  const { items } = stepsThatWorked({
    lookalikes: [
      { number: 'INC1', table: 'incident', sysId: '1', close_notes: 'Replaced the expired gateway certificate on EU-2.', score: 80, why: ['shares vpn'] },
      { number: 'INC2', table: 'incident', sysId: '2', close_notes: 'Replaced the expired gateway certificate on EU-2.', score: 60 },
      { number: 'INC3', table: 'incident', sysId: '3', close_notes: '', score: 99 },
    ],
    articles: [{ number: 'KB1', sysId: 'k1', short_description: 'VPN', excerpt: '- Check the client version', score: 90 }],
  });
  assert.deepEqual(items.map((x) => x.number), ['KB1', 'INC1']);
  assert.equal(items[1].kind, 'ticket');
  assert.deepEqual(stepsThatWorked().items, []);
});

// ---- N24 journey ---------------------------------------------------------------------------------------------------------------

test('journey: opened, the group path, the conversation, SLA events, resolved; without the field history it says so', () => {
  assert.deepEqual(groupPath([{ field: 'assignment_group', from: 'Service Desk', to: 'Network' }, { field: 'state', to: 'x' }, { field: 'assignment_group', from: 'Network', to: 'Desktop' }]), ['Service Desk', 'Network', 'Desktop']);
  const p = pack({
    fields: { reassignment_count: '2', reopen_count: '1', assignment_group: 'Desktop' },
    people: [ABEL, BETH, { role: 'opened_by', name: 'Charlie W' }],
    related: { times: { opened_at: at(NOW - 3 * D), resolved_at: at(NOW - H) } },
    journal: [comment(60, 'Abel Tuter'), comment(50, 'Beth Anglin'), comment(20, 'Abel Tuter')],
  });
  const audit = { available: true, changes: [{ field: 'assignment_group', from: 'Service Desk', to: 'Network', atUtc: at(NOW - 2 * D) }, { field: 'assignment_group', from: 'Network', to: 'Desktop', atUtc: at(NOW - D) }, { field: 'state', from: 'New', to: 'In Progress', atUtc: at(NOW - 2 * D) }] };
  const j = buildJourney({ pack: p, audit, slas: [{ name: 'P2', stage: 'In progress', breached: true, plannedEndUtc: at(NOW - 2 * H) }], now: NOW });
  assert.deepEqual(j.path, ['Service Desk', 'Network', 'Desktop']);
  assert.equal(j.reassignments, 2);
  assert.equal(j.reopens, 1);
  const labels = j.events.map((e) => e.label);
  assert.equal(labels[0], 'Opened');
  for (const want of ['Assigned to Network', 'Assigned to Desktop', 'State: In Progress', 'First reply to the customer', 'Last message from the customer', 'SLA breached: P2', 'Resolved']) assert.ok(labels.includes(want), `${want} in ${labels}`);
  assert.equal(labels[labels.length - 1], 'Resolved');
  assert.equal(journeySummary(j), 'Reassigned 2 times · reopened 1 time · Service Desk > Network > Desktop');
  const none = buildJourney({ pack: p, audit: { available: false, note: '' }, now: NOW });
  assert.match(none.note, /not readable/);
  assert.deepEqual(none.path, []);
  assert.equal(journeySummary(none), 'Reassigned 2 times · reopened 1 time · now with Desktop');
});

// ---- N20 email templates -------------------------------------------------------------------------------------------------------

test('email templates: one per kind the recommender knows, filled from the ticket, the rest left [in brackets]', () => {
  assert.deepEqual(Object.keys(EMAIL_TEMPLATES).sort(), EMAIL_TYPES.map((t) => t.id).sort());
  const p = pack();
  const filled = fillEmailTemplate('resolution', { pack: p, agentName: 'Beth Anglin' });
  assert.equal(filled.subject, 'INC0010001 is resolved: VPN keeps disconnecting');
  assert.match(filled.body, /^Hello Abel,/);
  assert.match(filled.body, /Beth Anglin$/);
  assert.ok(filled.placeholders >= 1);
  assert.match(emailAsText(filled), /^Subject: INC0010001 is resolved/);
  const anon = fillEmailTemplate('status-update', { pack: pack({ people: [] }) });
  assert.match(anon.body, /^Hello,/);
  assert.match(anon.body, /\[your name\]/);
  // a title with braces is not filled in again
  const braces = fillEmailTemplate('closure', { pack: pack({ fields: { short_description: 'Broken {agent} {number}' } }), agentName: 'Beth' });
  assert.match(braces.body, /"Broken \{agent\} \{number\}"/);
  assert.equal(fillEmailTemplate('nope', { pack: p }), null);
  assert.equal(recipientOf(pack({ people: [{ role: 'requested_for', name: 'Jane Doe' }] })).firstName, 'Jane');
});

// ---- order -----------------------------------------------------------------------------------------------------------------------

test('order: what matters for the state comes first, and only those cards open', () => {
  assert.equal(stateBucket('New'), 'new');
  assert.equal(stateBucket('On Hold'), 'hold');
  assert.equal(stateBucket('Awaiting Caller'), 'hold');
  assert.equal(stateBucket('Resolved'), 'resolved');
  assert.equal(stateBucket('Closed Complete'), 'closed');
  assert.equal(stateBucket('Work in Progress'), 'progress');
  assert.equal(stateBucket(''), 'progress');
  const sorted = (state) => ['missing', 'routing', 'steps', 'resolve', 'email', 'journey'].sort((a, b) => rankFor(a, { state }) - rankFor(b, { state }));
  assert.deepEqual(sorted('New').slice(0, 2), ['missing', 'routing']);
  assert.equal(sorted('Resolved')[0], 'resolve');
  assert.equal(sorted('On Hold')[0], 'email');
  assert.equal(sorted('In Progress')[0], 'steps');
  assert.equal(openFor('resolve', { state: 'Resolved' }), true);
  assert.equal(openFor('resolve', { state: 'New' }), false);
  assert.equal(rankFor('unknown-card', {}), 100);
});

// ---- N4 / N5 helpers -------------------------------------------------------------------------------------------------------------

test('fixes and chase line', () => {
  assert.deepEqual(fixFor({ id: 'customer', status: 'warn' }), { card: 'email', label: 'Which email fits' });
  assert.equal(fixFor({ id: 'customer', status: 'ok' }), null);
  assert.match(fixFor({ id: 'notes', status: 'warn' }).where, /Resolution/);
  assert.equal(fixFor({ id: 'pii', status: 'warn' }), null);
  assert.deepEqual(chaseLine({ state: 'approval', owner: 'Fred Luddy' }), { text: 'Chase: Fred Luddy (approval)', tone: 'warn' });
  assert.equal(chaseLine({ state: 'done' }).tone, 'ok');
  assert.equal(chaseLine({ state: 'task', owner: '' }).text, 'Nobody is named to chase yet.');
  assert.equal(chaseLine({ state: 'approval', owner: '' }).text, 'Chase: the approver (not visible to you)');
});

// ---- N25 / N26 -------------------------------------------------------------------------------------------------------------------

test('changes: running now first, then the latest ended, then upcoming; problems with a workaround first', () => {
  const c = (n, s, e) => ({ number: `CHG${n}`, startUtc: at(NOW + s * H), endUtc: at(NOW + e * H) });
  assert.equal(changeTiming(c(1, -30, -28), NOW).line, 'ended 28 h ago');
  assert.equal(changeTiming(c(1, -1, 1), NOW).line, 'in its window now');
  assert.equal(changeTiming(c(1, 50, 52), NOW).line, 'starts in 2 d');
  const { items, recent, summary } = arrangeChanges([c(1, -100, -98), c(2, 50, 52), c(3, -1, 1), c(4, -30, -28)], NOW);
  assert.deepEqual(items.map((x) => x.number), ['CHG3', 'CHG4', 'CHG1', 'CHG2']);
  assert.equal(recent, 2);
  assert.equal(summary, '2 in the last 3 days');
  assert.equal(arrangeChanges([], NOW).summary, '');
  assert.deepEqual(arrangeProblems([{ number: 'P1' }, { number: 'P2', knownError: true }, { number: 'P3', workaround: 'Do x' }]).map((p) => p.number), ['P3', 'P2', 'P1']);
});

// ---- N3 link ---------------------------------------------------------------------------------------------------------------------

test('article link: the article reader on the same instance, built from a checked number', () => {
  const classic = { href: 'https://acme.service-now.com/incident.do?sys_id=x', surface: 'classic' };
  assert.equal(articleShareUrl(classic, { number: 'KB0010001' }), 'https://acme.service-now.com/kb_view.do?sysparm_article=KB0010001');
  const portal = { href: 'https://acme.service-now.com/esc?id=ticket', surface: 'portal', portal: { base: '/esc', pageId: 'ticket' } };
  assert.equal(articleShareUrl(portal, { number: 'kb0010001' }), 'https://acme.service-now.com/esc?id=kb_article_view&sysparm_article=KB0010001');
  assert.equal(articleShareUrl(classic, { number: 'KB1&x=1', sysId: 'a'.repeat(32) }), `https://acme.service-now.com/kb_view.do?sys_kb_id=${'a'.repeat(32)}`);
  assert.equal(articleShareUrl(classic, { number: 'nope' }), '');
  assert.equal(articleShareUrl({ href: 'javascript:alert(1)' }, { number: 'KB0010001' }), '');
});

// ---- N2 summary ------------------------------------------------------------------------------------------------------------------

test('related summary: the look-alikes and what is open on the same item; a part not read is left out, never 0; nothing of the caller', () => {
  const s = relatedSummary({ lookalikes: [{}, {}], open: [{}] });
  assert.equal(s.line, '2 solved · 1 open on the same item');
  assert.deepEqual([s.solved, s.open], [2, 1]);
  assert.equal(relatedSummary({ lookalikes: [] }).line, '0 solved');
  assert.equal(relatedSummary({ lookalikes: null, open: [] }).line, '', 'nothing read yet, and nothing open: no line');
  assert.equal(relatedSummary().line, '');
  assert.ok(!('repeat' in s) && !('earlier' in s), 'the caller\'s tickets are a card of their own');
  assert.equal(historyLine({ state: 'Closed', opened_at: '2026-10-12 08:00:00' }), 'Closed · opened 2026-10-12');
});

test('caller summary: the repeat first, then the counts; nothing earlier, or nobody named, said so; not read yet, no line', () => {
  const s = callerSummary({ history: { items: [{}, {}, {}], signals: { openCount: 1, reopenedHint: { later: 'INC2', earlier: 'INC1', days: 3 } } } });
  assert.equal(s.line, 'Looks like a repeat · 3 earlier tickets · 1 still open');
  assert.equal(s.repeat, 'Looks like a repeat: INC2 came 3 days after INC1 was resolved.');
  assert.deepEqual([s.earlier, s.stillOpen, s.noCaller], [3, 1, false]);
  assert.equal(callerSummary({ history: { items: [{}], signals: { openCount: 0 } } }).line, '1 earlier ticket', 'one, and none still open');
  assert.equal(callerSummary({ history: { items: [], signals: null } }).line, 'No earlier tickets from this caller');
  assert.equal(callerSummary({ history: { items: [], signals: null, noCaller: true } }).line, 'Nobody is named as the caller');
  assert.equal(callerSummary({ history: { items: [], signals: { reopenedHint: { later: 'INC2' } } } }).line, 'Looks like a repeat', 'reopened, with nothing else listed');
  assert.deepEqual(callerSummary({ history: null }), { line: '', earlier: null, stillOpen: null, repeat: '', noCaller: false });
  assert.equal(callerSummary().line, '');
  assert.equal(repeatLine({ later: 'INC2' }), 'Looks like a repeat: INC2 was reopened.');
  assert.equal(repeatLine({ later: 'INC2', earlier: 'INC1', days: 1 }), 'Looks like a repeat: INC2 came 1 day after INC1 was resolved.');
  assert.equal(repeatLine(null), '');
  assert.equal(repeatLine({ earlier: 'INC1' }), '');
});

// ---- the shared store ------------------------------------------------------------------------------------------------------------

test('store: one read per key, joined while on its way, fresh values reused, errors keep the last value', async () => {
  let clock = 1000;
  const store = createInsightStore({ now: () => clock, max: 3 });
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { n: calls };
  };
  const [a, b] = await Promise.all([store.get('k', load), store.get('k', load)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal((await store.get('k', load, { maxAgeMs: 500 })).n, 1);
  clock += 1000;
  assert.equal((await store.get('k', load, { maxAgeMs: 500 })).n, 2, 'stale: read again');
  assert.equal((await store.get('k', load, { force: true })).n, 3);
  const seen = [];
  const off = store.subscribe('k', (e) => seen.push(e && !e.pending));
  await assert.rejects(store.get('k', async () => { throw new Error('boom'); }, { force: true }), /boom/);
  assert.equal(store.peek('k').value.n, 3, 'the last good value stays');
  assert.equal(store.peek('k').error.message, 'boom');
  off();
  assert.ok(seen.length >= 2);
  for (const k of ['x', 'y', 'z']) await store.get(k, load);
  assert.equal(store.size(), 3, 'oldest dropped');
  assert.equal(store.peek('k'), null);
  store.clear();
  assert.equal(store.size(), 0);
});

test('chat overview: an answer that is not an overview is an error, numbers are checked', () => {
  assert.throws(() => chatOverviewOf({}), /could not be read/);
  const o = chatOverviewOf({ overview: { count: 'x', waitingMinutes: 7, participants: [{ name: 'A' }, null] } });
  assert.equal(o.overview.count, 0);
  assert.equal(o.overview.waitingMinutes, 7);
  assert.equal(o.overview.participants.length, 1);
});
