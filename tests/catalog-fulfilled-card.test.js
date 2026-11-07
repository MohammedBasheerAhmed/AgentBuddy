import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/content/ops/index.js';
import { checkRecord } from '../src/content/ops/validate.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import TicketInsights, { cardsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { PAIN_POINTS, focusCards, painOfCard } from '../src/features/focus.js';
import { insightGroups } from '../src/sidepanel/ticket/focusView.js';
import { openFor, rankFor } from '../src/insights/order.js';
import { fulfilledRow, fulfilledView, tookText } from '../src/insights/fulfilledBefore.js';
import { spanWords } from '../src/insights/time.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { getLanguage, registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_CATALOG } from '../src/i18n/ar/catalog.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { BETH, ABEL } from './fixtures/sn-users.js';

// Wave 6, the catalog fulfiller: "Fulfilled before" as a card in the "Find the fix" row. The words (src/insights/fulfilledBefore.js), the
// registration (the fix group, the catalog kinds and profiles, the order), and the card driven in the small DOM on the real read over a
// fake instance: rows that open in a new tab, the honest lines for none / could not check / blocked, no AI and nothing sent.

registerCatalogue('ar', AR_CATALOG); // (until the lead wires it into src/i18n/ar/index.js)
test.afterEach(() => setLanguage('en'));

const hex = (prefix, n) => `${prefix}${String(n).padStart(2, '0')}`.padEnd(32, '0');
const ITEM = 'c1a2b3c4d5e64f708192a3b4c5d6e7f8';
const OPEN_RITM = 'e3f4a5b6c7d84e9fa0b1c2d3e4f5a6b7';
const OPEN_TASK = 'c0ffee00c0ffee00c0ffee00c0ffee01';
const NOW = Date.UTC(2026, 10, 7, 12);

const done = (n, closed, opened, who, notes) => ({
  sys_id: v(hex('a1', n)),
  number: v(`SCTASK00200${String(n).padStart(2, '0')}`),
  short_description: v(`Prepare laptop ${n}`),
  state: v('3', 'Closed Complete'),
  assigned_to: who ? v(who.sysId, who.name) : v('', ''),
  opened_at: v(opened),
  closed_at: v(closed),
  close_notes: v(notes),
  request_item: v(hex('b1', n), `RITM00300${n}`),
  'request_item.cat_item': v(ITEM, 'Standard Laptop'),
});
const tables = ({ earlier = true } = {}) => ({
  sc_task: [
    { ...done(0, '', '2026-11-06 09:00:00'), sys_id: v(OPEN_TASK), number: v('SCTASK0020000'), state: v('2', 'Work in Progress'), request_item: v(OPEN_RITM, 'RITM0030000') },
    ...(earlier
      ? [
          done(1, '2026-11-05 10:00:00', '2026-11-03 10:00:00', BETH, 'Re-imaged and enrolled the laptop in Intune. Handed over to the user.'),
          done(2, '2026-11-04 11:30:00', '2026-11-04 11:00:00', ABEL, ''),
        ]
      : []),
  ],
  sc_req_item: [{ sys_id: v(OPEN_RITM), number: v('RITM0030000'), cat_item: v(ITEM, 'Standard Laptop') }],
});

const record = { table: 'sc_task', sysId: OPEN_TASK, number: 'SCTASK0020000', kind: 'catalog_task' };
let tab = 800;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/sc_task.do?sys_id=${OPEN_TASK}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = (profiles = ['req']) => ({ ready: true, values: { profiles }, locked: {}, policy: normalizePolicy({}) });
const header = { number: 'SCTASK0020000', short_description: 'Prepare laptop', state: 'Work in Progress', stateValue: '2', priority: '3 - Moderate' };

async function setup(tablesIn = tables(), behaviour = {}, answer = null) {
  insightStore.clear();
  const deps = () => Object.assign(fakeDeps(tablesIn, behaviour), { now: () => NOW });
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const created = [];
  fake.chrome.tabs.create = async (props) => created.push(props);
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  fake.onRead('fulfilledBefore', (args) => (answer ? answer(args) : OPS.fulfilledBefore(args, { deps: deps(), checkRecord, allowSensitive: false })));
  return { fake, created };
}

const Fulfilled = INSIGHT_CARDS.find((c) => c.id === 'fulfilled').Card;
const mountCard = (page, report = {}) =>
  mount(<Fulfilled page={page} eff={eff()} record={record} header={header} active setSummary={(s) => (report.summary = s)} setAttention={(a) => (report.attention = a)} />);

// ---- time in words ---------------------------------------------------------------------------------------------------------------------

test('a time taken or waited is said in words, one unit, never more than was', () => {
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  assert.equal(spanWords(20 * 1000), 'under a minute');
  assert.equal(spanWords(MIN), '1 minute');
  assert.equal(spanWords(30 * MIN), '30 minutes');
  assert.equal(spanWords(HOUR), '1 hour');
  assert.equal(spanWords(5 * HOUR + 59 * MIN), '5 hours');
  assert.equal(spanWords(DAY), '1 day');
  assert.equal(spanWords(2 * DAY), '2 days');
  assert.equal(spanWords(3 * DAY + 23 * HOUR), '3 days');
  assert.equal(spanWords(-1), '');
  assert.equal(spanWords(NaN), '');
  assert.equal(spanWords(undefined), '');
});

test('how long a task took: opened to closed, from the stored times; nothing when either is missing or they are the wrong way round', () => {
  assert.equal(tookText({ openedUtc: '2026-11-03 10:00:00', closedUtc: '2026-11-05 10:00:00' }), '2 days');
  assert.equal(tookText({ openedUtc: '2026-11-04 11:00:00', closedUtc: '2026-11-04 16:30:00' }), '5 hours');
  assert.equal(tookText({ openedUtc: '2026-11-04 11:00:00', closedUtc: '2026-11-04 11:30:00' }), '30 minutes');
  assert.equal(tookText({ openedUtc: '', closedUtc: '2026-11-05 10:00:00' }), '');
  assert.equal(tookText({ openedUtc: '2026-11-03 10:00:00', closedUtc: '' }), '');
  assert.equal(tookText({ openedUtc: '2026-11-06 10:00:00', closedUtc: '2026-11-05 10:00:00' }), '');
  assert.equal(tookText(null), '');
});

// ---- the words of the card -----------------------------------------------------------------------------------------------------------------

const item = (over = {}) => ({
  table: 'sc_task',
  sysId: hex('a1', 1),
  number: 'SCTASK0020001',
  short_description: 'Prepare laptop 1',
  who: BETH.name,
  notes: 'Re-imaged and enrolled the laptop in Intune. Handed over to the user.',
  notesUnread: false,
  openedUtc: '2026-11-03 10:00:00',
  closedUtc: '2026-11-05 10:00:00',
  people: [BETH.name],
  ...over,
});

test('a row: who, how long, when, and the first sentences of the notes; each part only when it is known', () => {
  const row = fulfilledRow(item(), NOW);
  assert.equal(row.number, 'SCTASK0020001');
  assert.equal(row.line, 'Beth Anglin · took 2 days · closed 2 d ago');
  assert.equal(row.extra, 'Re-imaged and enrolled the laptop in Intune. Handed over to the user.');
  assert.equal(fulfilledRow(item({ who: '' }), NOW).line, 'took 2 days · closed 2 d ago', 'a name that cannot be read is left out, not replaced by "nobody"');
  assert.equal(fulfilledRow(item({ who: '', openedUtc: '', closedUtc: '' }), NOW).line, '');
  assert.equal(fulfilledRow(item({ notes: '' }), NOW).extra, 'No close notes.');
  assert.equal(fulfilledRow(item({ notes: '', notesUnread: true }), NOW).extra, 'Close notes are not shown to you.');
  const long = fulfilledRow(item({ notes: `${'Word '.repeat(80)}end.` }), NOW).extra;
  assert.ok(long.length <= 200 && long.endsWith('…'), 'a very long note is cut');
});

test('the card\'s line: how the last one went', () => {
  const view = fulfilledView({ items: [item(), item({ sysId: hex('a1', 2), number: 'SCTASK0020002' })], access: [{ source: 'sc_task', status: 'ok', note: '' }] }, { now: NOW });
  assert.equal(view.state, 'rows');
  assert.equal(view.items.length, 2);
  assert.equal(view.summary, 'Last done 2 d ago, took 2 days');
  assert.equal(view.attention, 'ok');
  const ok = [{ source: 'sc_task', status: 'ok' }];
  assert.equal(fulfilledView({ items: [item({ openedUtc: '' })], access: ok }, { now: NOW }).summary, 'Last done 2 d ago');
  assert.equal(fulfilledView({ items: [item({ closedUtc: '' })], access: ok }, { now: NOW }).summary, 'Done before', 'no closing time: neither when nor how long');
});

test('honest: none is said only after the read saw everything; a refusal is "could not check"; the organisation\'s rule has no line', () => {
  const none = fulfilledView({ items: [], access: [{ source: 'sc_task', status: 'empty', note: '' }] }, { now: NOW });
  assert.deepEqual([none.state, none.summary, none.attention], ['none', 'No earlier tasks for this item that you can see', 'clear']);
  for (const status of ['denied', 'error', 'empty-or-hidden']) {
    const view = fulfilledView({ items: [], access: [{ source: 'sc_task', status, note: 'x' }] }, { now: NOW });
    assert.deepEqual([view.state, view.summary, view.attention], ['unseen', 'Could not check earlier tasks for this item', ''], status);
  }
  const blocked = fulfilledView({ items: [], access: [{ source: 'sc_task', status: 'blocked', note: 'x' }] }, { now: NOW });
  assert.deepEqual([blocked.state, blocked.summary, blocked.attention], ['blocked', '', '']);
  const skipped = fulfilledView({ items: [], access: [{ source: 'sc_task', status: 'skipped', note: 'This ticket has no catalog item, so earlier tasks for it were not looked up.' }] }, { now: NOW });
  assert.deepEqual([skipped.state, skipped.summary, skipped.attention], ['skipped', '', '']);
  assert.match(skipped.note, /no catalog item/);
  assert.equal(fulfilledView(null).state, 'pending');
  assert.equal(fulfilledView({ items: [], access: [] }).state, 'skipped', 'an answer that says nothing is not "none"');
});

test('in Arabic: the lines, the span and the notes follow the language', () => {
  setLanguage('ar');
  assert.equal(getLanguage(), 'ar');
  const view = fulfilledView({ items: [item({ notes: '' })], access: [{ source: 'sc_task', status: 'ok' }] }, { now: NOW });
  assert.match(view.summary, /^آخر تنفيذ/);
  assert.match(view.items[0].line, /استغرقت/);
  assert.match(view.items[0].line, /أُغلقت/);
  assert.equal(view.items[0].extra, 'لا توجد ملاحظات إغلاق.');
  assert.equal(fulfilledView({ items: [], access: [{ source: 'sc_task', status: 'empty' }] }).summary, 'لا توجد مهام سابقة لهذا العنصر تستطيع رؤيتها');
  assert.equal(fulfilledView({ items: [], access: [{ source: 'sc_task', status: 'denied' }] }).summary, 'تعذر التحقق من المهام السابقة لهذا العنصر');
  assert.equal(spanWords(20 * 1000), 'أقل من دقيقة');
});

// ---- where the card is --------------------------------------------------------------------------------------------------------------------

test('the card is inside the "Find the fix" row, between the checklist and the look-alike fixes, for a requested item and a catalog task only', () => {
  const fix = PAIN_POINTS.find((p) => p.id === 'fix');
  assert.deepEqual([...fix.cards], ['checklist', 'fulfilled', 'steps', 'knowledge']);
  assert.equal(painOfCard('fulfilled'), 'fix');
  assert.equal(PAIN_POINTS.flatMap((p) => p.cards).filter((id) => id === 'fulfilled').length, 1, 'in one row only');
  const card = INSIGHT_CARDS.find((c) => c.id === 'fulfilled');
  assert.deepEqual([...card.kinds].sort(), ['catalog_task', 'requested_item']);
  assert.equal(card.title, 'Fulfilled before');
  assert.equal(card.defaultOpen, false, 'folded: its line answers at a look');
  const idsFor = (kind, table, profiles = ['req']) => cardsFor(INSIGHT_CARDS, { table, kind }, header, eff(profiles)).map((c) => c.id);
  for (const [kind, table] of [['catalog_task', 'sc_task'], ['requested_item', 'sc_req_item']]) {
    assert.ok(idsFor(kind, table).includes('fulfilled'), kind);
    assert.ok(idsFor(kind, table, ['it']).includes('fulfilled'), `${kind} for an IT fulfiller`);
  }
  for (const [kind, table] of [['incident', 'incident'], ['request', 'sc_request'], ['case', 'sn_customerservice_case'], ['change', 'change_request'], ['task', 'incident_task']]) assert.ok(!idsFor(kind, table, ['req', 'it', 'csm']).includes('fulfilled'), kind);
  // the order of the row: checklist, this, steps
  const ids = idsFor('catalog_task', 'sc_task');
  assert.ok(ids.indexOf('checklist') < ids.indexOf('fulfilled') && ids.indexOf('fulfilled') < ids.indexOf('steps'), ids.join(','));
  assert.ok(rankFor('checklist') < rankFor('fulfilled') && rankFor('fulfilled') < rankFor('steps'));
  assert.equal(openFor('fulfilled', header, record), false);
  const { groups, rest } = focusCards(cardsFor(INSIGHT_CARDS, record, header, eff()));
  assert.deepEqual(groups.find((g) => g.id === 'fix').cards.map((c) => c.id), ['checklist', 'fulfilled', 'steps', 'knowledge']);
  assert.ok(!rest.some((c) => c.id === 'fulfilled'));
  assert.ok(insightGroups({ cards: cardsFor(INSIGHT_CARDS, record, header, eff()) }).groups.find((g) => g.id === 'fix').cards.some((c) => c.id === 'fulfilled'));
});

// ---- the card, on the real read --------------------------------------------------------------------------------------------------------

test('rows open the task in a new tab; the line and the dot say how the last one went; no AI, nothing but one read', async () => {
  const { fake, created } = await setup();
  const report = {};
  const ui = await mountCard(pageFor(), report);
  try {
    await settle(6);
    assert.match(report.summary, /^Last done \d+ d ago, took 2 days$/);
    assert.equal(report.attention, 'ok');
    const rows = ui.$$('[data-fulfilled="row"]');
    assert.equal(rows.length, 2);
    const links = rows.map((r) => r.querySelector('a.ab-ins-item'));
    assert.deepEqual(links.map((a) => a.querySelector('.ab-record-number').textContent), ['SCTASK0020001', 'SCTASK0020002']);
    assert.match(links[0].textContent, /Beth Anglin · took 2 days · closed \d+ d ago/);
    assert.match(links[0].textContent, /Re-imaged and enrolled the laptop in Intune\. Handed over to the user\./);
    assert.match(links[1].textContent, /Abel Tuter · took 30 minutes/);
    assert.match(links[1].textContent, /No close notes\./, 'a note that was not written is said so');
    assert.equal(links[0].getAttribute('target'), '_blank');
    assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
    await click(links[0]);
    await settle();
    assert.equal(created.length, 1);
    assert.match(created[0].url, /^https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=sc_task\.do/);
    assert.equal(fake.updates.length, 0, 'the ticket tab was not navigated');
    assert.deepEqual(fake.readsOf('fulfilledBefore'), [{ table: 'sc_task', sysId: OPEN_TASK, allowSensitive: false }]);
    assert.equal(ui.$('.ab-ai-badge', { all: true }), null, 'no AI here');
    assert.equal(ui.$('.ab-btn-primary'), null);
    assert.ok(!/sc_task|sc_req_item|sys_id|\b40\d\b/.test(ui.text()), 'no table name, no id, no code');
  } finally {
    await ui.unmount();
  }
});

test('none: "No earlier tasks for this item that you can see", and a green nothing-to-report', async () => {
  await setup(tables({ earlier: false }));
  const report = {};
  const ui = await mountCard(pageFor(), report);
  try {
    await settle(6);
    assert.equal(report.summary, 'No earlier tasks for this item that you can see');
    assert.equal(report.attention, 'clear');
    assert.match(ui.text(), /No earlier tasks for this item that you can see/);
    assert.equal(ui.$$('[data-fulfilled="row"]').length, 0);
  } finally {
    await ui.unmount();
  }
});

test('a refused read is "could not check", never "none", and the reason is in plain words', async () => {
  await setup(tables(), { denied: ['sc_task'] });
  const report = {};
  const ui = await mountCard(pageFor(), report);
  try {
    await settle(6);
    assert.equal(report.summary, 'Could not check earlier tasks for this item');
    assert.equal(report.attention, '');
    const text = ui.text();
    assert.ok(!/No earlier tasks/.test(text), text);
    assert.match(text, /not available to you with your role/);
    assert.ok(!/sc_task|sc_req_item|403/.test(text));
  } finally {
    await ui.unmount();
  }
});

test('the organisation\'s block: no line of its own, no dot, the usual note under the card', async () => {
  await setup(tables(), {}, () => ({ items: [], access: [{ source: 'sc_task', status: 'blocked', note: 'Your organisation does not let Agent Buddy read this.' }] }));
  const report = {};
  const ui = await mountCard(pageFor(), report);
  try {
    await settle(6);
    assert.equal(report.summary, '');
    assert.equal(report.attention, '');
    assert.match(ui.text(), /your organisation does not let Agent Buddy read this/i);
  } finally {
    await ui.unmount();
  }
});

test('a ticket with no catalog item says it was not looked up; a read that fails shows the error with a way to try again', async () => {
  await setup(tables(), {}, () => ({ items: [], access: [{ source: 'sc_task', status: 'skipped', note: 'This ticket has no catalog item, so earlier tasks for it were not looked up.' }] }));
  const report = {};
  const ui = await mountCard(pageFor(), report);
  try {
    await settle(6);
    assert.match(ui.text(), /This ticket has no catalog item, so earlier tasks for it were not looked up\./);
    assert.equal(report.summary, '');
  } finally {
    await ui.unmount();
  }

  await setup(tables(), {}, () => {
    throw Object.assign(new Error('The ServiceNow session has ended.'), { code: 'SESSION_EXPIRED' });
  });
  const failed = await mountCard(pageFor());
  try {
    await settle(6);
    assert.ok(failed.hasButton(/Try again/i), failed.text());
  } finally {
    await failed.unmount();
  }
});

test('through the Ticket screen: a catalog task\'s "Find the fix" row holds the card, and it reads only when the row is opened', async () => {
  const { fake } = await setup();
  const ui = await mount(<TicketInsights page={pageFor()} eff={eff()} record={record} header={header} active />);
  try {
    await settle(8);
    const row = ui.$('li[data-group="fix"] > button.ab-ins-group-row');
    assert.ok(row, 'the Find the fix row is there');
    await click(row);
    await settle(6);
    const card = ui.$('li[data-group="fix"] li[data-card="fulfilled"]');
    assert.ok(card, 'the card is a row of its own inside it');
    assert.equal(card.querySelector('.ab-ins-card-title').textContent, 'Fulfilled before');
    assert.match(card.querySelector('.ab-ins-card-summary').textContent, /^Last done \d+ d ago, took 2 days$/);
    assert.ok(fake.readsOf('fulfilledBefore').length >= 1);
    assert.deepEqual(fake.readsOf('fulfilledBefore')[0], { table: 'sc_task', sysId: OPEN_TASK, allowSensitive: false });
  } finally {
    await ui.unmount();
  }
});
