import test from 'node:test';
import assert from 'node:assert/strict';
import { needsCount, needsNow } from '../src/sidepanel/ticket/needsNow.js';
import { arrangeRows } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { levelOf } from '../src/sidepanel/ticket/cardReports.js';
import { readFully } from '../src/sidepanel/ticket/cards/useInsight.js';
import { glanceChips, glanceDetails } from '../src/sidepanel/ticket/cards/Glance.jsx';

// The Ticket screen worked out without React (the 2026-11-05 layout): what needs the agent now, as the first rows of Insights (built
// only from what the screen already has, the most urgent first, nothing when nothing needs a look, the cards not repeated), the number
// on the Insights tab, the order of the Insights rows, and the compact ticket at the top (its chips and "Ticket details").

const H = 3600000;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 5, 12);
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const CARDS = [
  { id: 'steps', title: 'Steps that worked before' },
  { id: 'related', title: 'Related tickets' },
  { id: 'knowledge', title: 'Knowledge for this ticket' },
  { id: 'risk', title: 'Risk signals' },
];

test('nothing needs a look: no rows', () => {
  assert.deepEqual(needsNow({ glance: null }), []);
  assert.deepEqual(needsNow({ glance: { sla: { kind: 'running', tone: '', leftMs: 5 * H }, waiting: { waiting: false }, outage: null }, cards: CARDS }), []);
});

test('a breached SLA, a customer waiting and a possible outage: in that order of urgency, each with its own line', () => {
  const items = needsNow({
    glance: {
      sla: { kind: 'breached', tone: 'danger', leftMs: -8 * D, name: 'P2 resolution (8 hour)' },
      waiting: { waiting: true, sinceMs: 9 * D, approx: false, messages: 2 },
      outage: { line: '4 open tickets on VPN Gateway EU' },
    },
    cards: CARDS,
  });
  assert.deepEqual(items.map((i) => i.id), ['sla', 'outage', 'waiting'], 'danger before warn');
  assert.deepEqual(items.map((i) => i.level), ['danger', 'danger', 'warn']);
  assert.match(items[0].text, /^The SLA was due 8 d ago$/);
  assert.equal(items[0].sub, 'P2 resolution (8 hour)');
  assert.equal(items[1].text, 'Possible outage: 4 open tickets on VPN Gateway EU');
  assert.match(items[2].text, /^The customer has waited 9 d for a reply$/);
  assert.equal(items[2].sub, '2 messages without a reply');
});

test('the cards are not repeated: a card that needs a look is no row here, and the outage is said by its card when the record shows it', () => {
  const glance = { sla: { kind: 'running', tone: 'warn', leftMs: 40 * 60000, name: 'P3' }, outage: { line: '3 open' } };
  const items = needsNow({ glance, cards: CARDS });
  assert.deepEqual(items.map((i) => i.id), ['outage', 'sla']);
  assert.match(items[1].text, /^The SLA is due in 40 min$/);
  // The Outage spotter is one of this record's cards: its own row (first among the cards, red) says the same line from the same read.
  assert.deepEqual(needsNow({ glance, cards: [...CARDS, { id: 'outage', title: 'Outage spotter' }] }).map((i) => i.id), ['sla']);
});

test('a customer waiting whose time is not known, or known only roughly, is said honestly', () => {
  assert.equal(needsNow({ glance: { waiting: { waiting: true, sinceMs: null, messages: 1 } } })[0].text, 'The customer is waiting for a reply');
  assert.match(needsNow({ glance: { waiting: { waiting: true, sinceMs: 3 * D, approx: true, messages: 1 } } })[0].text, /^The customer has waited about 3 d for a reply$/);
  assert.equal(needsNow({ glance: { sla: { kind: 'breached', leftMs: null, name: '' } } })[0].text, 'The SLA is breached');
});

test('the number on the Insights tab: the rows that need a look (these facts and the cards that said danger or warn)', () => {
  const needs = needsNow({ glance: { waiting: { waiting: true, sinceMs: D, messages: 1 } } });
  const reports = { related: { attention: 'warn' }, risk: { attention: 'danger' }, steps: { attention: 'ok' }, knowledge: { attention: 'clear' }, gone: { attention: 'danger' } };
  assert.equal(needsCount({ needs, cards: CARDS, reports }), 3, 'a report of a card the record does not show is not counted');
  assert.equal(needsCount({ needs: [], cards: CARDS, reports: {} }), 0);
  assert.equal(needsCount(), 0);
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

// ---- the ticket at the top -----------------------------------------------------------------------------------------------------

const pack = (fields = {}, more = {}) => ({ sysId: 'a'.repeat(32), fields, related: { times: { opened_at: at(NOW - 2 * D), sys_updated_on: at(NOW - 12 * 60000) } }, ...more });

test('the chips: the state, the SLA in its tone, "Unassigned" when nobody is, then the marks', () => {
  const g = { sla: { text: 'SLA 1h 20m', tone: 'warn' }, vip: true };
  const chips = glanceChips({ g, state: 'In Progress', pack: pack({ assignment_group: 'Service Desk' }), priorityAccount: false });
  assert.deepEqual(chips.map((c) => [c.key, c.text, c.tone]), [
    ['state', 'In Progress', 'neutral'],
    ['sla', 'SLA 1h 20m', 'warn'],
    ['unassigned', 'Unassigned', 'warn'],
    ['vip', 'VIP', 'warn'],
  ]);
  assert.deepEqual(glanceChips({ g: { sla: { text: '' } }, state: 'New', pack: pack({ assigned_to: 'Beth Anglin' }) }).map((c) => c.key), ['state'], 'someone has it');
  assert.deepEqual(glanceChips({ g: {}, state: 'New', pack: null }).map((c) => c.key), ['state'], 'never "Unassigned" before the record could be read');
  assert.deepEqual(glanceChips({ g: {}, state: 'New', pack: pack({}, { sensitive: true }) }).map((c) => c.key), ['state'], 'nor on an HR record, whose people are not shown');
});

test('"Ticket details": who has it, the caller, when it was opened and changed, the service and the CI; only what the read brought', () => {
  const rows = glanceDetails(pack({ assignment_group: 'Service Desk', caller_id: 'Abel Tuter', business_service: 'Email', cmdb_ci: 'EXCH-SD-05' }), NOW);
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ['Assigned to', 'Nobody yet'],
    ['Group', 'Service Desk'],
    ['Caller', 'Abel Tuter'],
    ['Opened', '2 d ago'],
    ['Updated', '12 min ago'],
    ['Service', 'Email'],
    ['Configuration item', 'EXCH-SD-05'],
  ]);
  // A request names the person it is for; an HR record shows no people at all.
  assert.deepEqual(glanceDetails(pack({ assigned_to: 'Beth Anglin', requested_for: 'Abel Tuter' }), NOW).slice(0, 2).map((r) => [r.label, r.value]), [['Assigned to', 'Beth Anglin'], ['Requested for', 'Abel Tuter']]);
  assert.deepEqual(glanceDetails(pack({ assigned_to: 'Beth Anglin', caller_id: 'Abel Tuter' }, { sensitive: true }), NOW).map((r) => r.key), ['opened', 'updated']);
  assert.deepEqual(glanceDetails(null, NOW), [], 'nothing before the read');
});
