import test from 'node:test';
import assert from 'node:assert/strict';
import { needsNow, MAX_NEEDS } from '../src/sidepanel/ticket/needsNow.js';
import { arrangeRows } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { levelOf } from '../src/sidepanel/ticket/cardReports.js';
import { readFully } from '../src/sidepanel/ticket/cards/useInsight.js';
import { metaLine } from '../src/sidepanel/ticket/cards/Glance.jsx';
import { nextStep } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The top of the Ticket screen, worked out without React: "Needs you now" (built only from what the screen already has, the most
// urgent first, nothing when nothing needs a look), the order of the Insights rows (the cards that need a look first, the ones with
// nothing to report under "All clear"), the line under the chips, and the one main step.

const H = 3600000;
const D = 24 * H;
const CARDS = [
  { id: 'steps', title: 'Steps that worked before' },
  { id: 'related', title: 'Related tickets' },
  { id: 'knowledge', title: 'Knowledge for this ticket' },
  { id: 'risk', title: 'Risk signals' },
  { id: 'outage', title: 'Outage spotter' },
];

test('nothing needs a look: no items (the block is not drawn)', () => {
  assert.deepEqual(needsNow({ glance: null }), []);
  assert.deepEqual(needsNow({ glance: { sla: { kind: 'running', tone: '', leftMs: 5 * H }, waiting: { waiting: false }, outage: null }, cards: CARDS, reports: { steps: { summary: '3 fixes', attention: 'ok' }, knowledge: { attention: 'clear' } } }), []);
});

test('a breached SLA, a customer waiting and a possible outage: in that order of urgency, each with its own line', () => {
  const items = needsNow({
    glance: {
      sla: { kind: 'breached', tone: 'danger', leftMs: -8 * D, name: 'P2 resolution (8 hour)' },
      waiting: { waiting: true, sinceMs: 9 * D, approx: false, messages: 2 },
      outage: { line: '4 open tickets on VPN Gateway EU' },
    },
    cards: CARDS,
    reports: {},
  });
  assert.deepEqual(items.map((i) => i.id), ['sla', 'outage', 'waiting'], 'danger before warn');
  assert.match(items[0].text, /^The SLA was due 8 d ago$/);
  assert.equal(items[0].sub, 'P2 resolution (8 hour)');
  assert.equal(items[1].text, 'Possible outage: 4 open tickets on VPN Gateway EU');
  assert.equal(items[1].card, 'outage', 'the outage item opens its card');
  assert.match(items[2].text, /^The customer has waited 9 d for a reply$/);
  assert.equal(items[2].sub, '2 messages without a reply');
  assert.equal(items[2].card, '', 'the customer item has no card to open');
});

test('the Insights cards that report attention join, the outage card is not said twice, and at most three are shown', () => {
  const reports = {
    steps: { summary: '3 fixes', attention: 'ok' },
    related: { summary: '10 earlier · 5 still open', attention: 'warn' },
    risk: { summary: 'Angry wording · Chasers', attention: 'danger' },
    outage: { summary: '4 open tickets', attention: 'danger' },
  };
  const items = needsNow({ glance: { sla: { kind: 'running', tone: 'warn', leftMs: 40 * 60000, name: 'P3' } }, cards: CARDS, reports });
  assert.deepEqual(items.map((i) => i.id), ['card:risk', 'sla', 'card:related']);
  assert.equal(items[0].text, 'Angry wording · Chasers');
  assert.equal(items[0].cardTitle, 'Risk signals');
  assert.match(items[1].text, /^The SLA is due in 40 min$/);
  assert.ok(items.length <= MAX_NEEDS);
  assert.ok(!items.some((i) => i.id === 'card:outage'));
  // A card the record does not show is never linked.
  const noCard = needsNow({ glance: { outage: { line: '3 open' } }, cards: [], reports: {} });
  assert.equal(noCard[0].card, '');
});

test('with no room for all, the plain facts of the ticket come before the cards (whose rows below are marked anyway)', () => {
  const items = needsNow({
    glance: { sla: { kind: 'breached', leftMs: null, name: '' }, waiting: { waiting: true, sinceMs: D, messages: 1 }, outage: { line: '4 open' } },
    cards: CARDS,
    reports: { risk: { summary: 'Angry wording', attention: 'danger' } },
  });
  assert.deepEqual(items.map((i) => i.id), ['sla', 'outage', 'waiting']);
  assert.equal(items[0].text, 'The SLA is breached');
});

test('a customer waiting whose time is not known, or known only roughly, is said honestly', () => {
  assert.equal(needsNow({ glance: { waiting: { waiting: true, sinceMs: null, messages: 1 } } })[0].text, 'The customer is waiting for a reply');
  assert.match(needsNow({ glance: { waiting: { waiting: true, sinceMs: 3 * D, approx: true, messages: 1 } } })[0].text, /^The customer has waited about 3 d for a reply$/);
});

test('rows: the cards that need a look first (danger, then warn), the rest in their order, nothing-to-report ones apart', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const { rows, clear } = arrangeRows(cards, { b: { attention: 'warn' }, c: { attention: 'clear' }, d: { attention: 'danger' }, e: { attention: 'ok' } });
  assert.deepEqual(rows.map((c) => c.id), ['d', 'b', 'a', 'e']);
  assert.deepEqual(clear.map((c) => c.id), ['c']);
  assert.deepEqual(arrangeRows(cards).rows.map((c) => c.id), ['a', 'b', 'c', 'd', 'e'], 'before any report: the card order');
});

test('rows: a card the person opened in the list keeps its place when it then reports nothing (it does not vanish into "All clear")', () => {
  const cards = [{ id: 'a' }, { id: 'kb' }, { id: 'c' }];
  const reports = { kb: { attention: 'clear' }, c: { attention: 'clear' } };
  const kept = arrangeRows(cards, reports, new Set(['kb']));
  assert.deepEqual(kept.rows.map((c) => c.id), ['a', 'kb']);
  assert.deepEqual(kept.clear.map((c) => c.id), ['c']);
});

test('readFully: a card says "nothing to report" only after reads that saw everything', () => {
  assert.equal(readFully([{ status: 'ok' }, { status: 'empty' }, { status: 'skipped' }]), true);
  assert.equal(readFully(undefined, []), true);
  for (const status of ['denied', 'error', 'blocked', 'empty-or-hidden']) assert.equal(readFully([{ status: 'ok' }], [{ status }]), false, status);
});

test('a card status other than the known ones counts as plain', () => {
  for (const level of ['danger', 'warn', 'ok', 'clear']) assert.equal(levelOf(level), level);
  for (const level of ['', 'red', undefined, null, 3]) assert.equal(levelOf(level), '');
});

test('the line under the chips: the assignee and the group, then when it changed; the customer waiting is said above instead', () => {
  const g = { line3: ['Beth Anglin', 'Customer waiting 9 d', 'Updated 9 d ago'], waiting: { waiting: true, sinceMs: 9 * D, approx: false } };
  assert.deepEqual(metaLine(g, { assigned_to: 'Beth Anglin', assignment_group: 'Network Support' }), ['Beth Anglin', 'Network Support', 'Updated 9 d ago']);
  // No one assigned: the owner text already names the group.
  const g2 = { line3: ['Network Support (no one assigned)', 'Updated 1 h ago'], waiting: { waiting: false } };
  assert.deepEqual(metaLine(g2, { assignment_group: 'Network Support' }), ['Network Support (no one assigned)', 'Updated 1 h ago']);
});

test('the main step is the first suggestion of AI Assist, and nothing when every AI action is stopped on the record', () => {
  const eff = (policy = {}) => ({ ready: true, apiKey: 'k', values: { piiMode: 'standard', profiles: ['it'] }, locked: {}, policy: normalizePolicy(policy) });
  const record = { kind: 'incident', table: 'incident', sysId: 'a'.repeat(32) };
  assert.equal(nextStep({ record, header: { state: 'In Progress' }, eff: eff() })?.id, 'reply-draft');
  assert.equal(nextStep({ record, header: { state: 'New' }, eff: eff() })?.id, 'record-summary');
  assert.equal(nextStep({ record, header: { state: 'Resolved' }, eff: eff() })?.id, 'resolution-notes');
  assert.equal(nextStep({ record, header: { state: 'In Progress' }, eff: eff({ blockedTables: ['incident'] }) }), null);
  assert.equal(nextStep({ record, header: { state: 'In Progress' }, eff: eff({ disabledFeatures: ['reply-draft'] }) })?.id !== 'reply-draft', true);
});
