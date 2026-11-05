import { mount, click, makeChrome, fakeClipboard, settle, document } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy } from '../src/policy/policy.js';
import { Glance, INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import TicketInsights, { cardsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import insightOps from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { findSimilarTickets, searchKnowledge } from '../src/context/similar.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { shownFor } from '../src/profiles/profiles.js';

// The Ticket screen's Insights half, driven in a small DOM: the Glance and the cards share one read, a folded card reads nothing,
// links never replace the ticket being worked on, refusals are said plainly, and no Insights element carries the AI mark.

const record = { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' };
let tab = 100;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/incident.do?sys_id=${INCIDENT_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = (profiles = ['it']) => ({ ready: true, values: { profiles }, locked: {}, policy: normalizePolicy({}) });
const header = { number: 'INC0010001', short_description: 'VPN keeps disconnecting for Abel Tuter', state: 'In Progress', priority: '2 - High' };

// Real answers: the content-script reads run on the fake instance, the panel gets what they return.
const deps = () => Object.assign(fakeDeps(buildInstance()), { now: () => Date.UTC(2026, 9, 26, 12) });
const glanceAnswer = () => insightOps.glance({ table: 'incident', sysId: INCIDENT_ID }, { deps: deps(), checkRecord, checkPack });

async function setup({ glance } = {}) {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const created = [];
  fake.chrome.tabs.create = async (props) => created.push(props);
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  const answer = glance || (await glanceAnswer());
  fake.onRead('glance', () => answer);
  fake.onRead('lookalikes', (args) => findSimilarTickets(args.pack, deps(), { resolvedOnly: true, routing: true }));
  fake.onRead('knowledge', (args) => searchKnowledge(args.pack, deps(), { limit: 5 }));
  fake.onRead('history', () => ({ items: [], signals: { openCount: 0 }, access: [] }));
  fake.onRead('journey', () => ({ available: false, changes: [], note: '', access: [] }));
  fake.onRead('ciChanges', () => ({ items: [], keys: ['cmdb_ci'], access: [{ source: 'change_request', status: 'empty' }] }));
  fake.onRead('knownErrors', () => ({ items: [], keys: ['cmdb_ci'], access: [{ source: 'problem', status: 'empty' }] }));
  fake.onRead('pack', () => ({ table: 'incident', sysId: INCIDENT_ID, kind: 'incident', fields: { state: 'In Progress' }, people: [], journal: [], related: {}, access: [] }));
  fake.onRead('resolutionFacts', () => ({ form: null, links: null }));
  return { fake, created, answer };
}

const cardProps = (page, extra = {}) => ({ page, eff: eff(), record, header, active: true, setSummary: () => {}, setAttention: () => {}, ...extra });
const card = (id) => INSIGHT_CARDS.find((c) => c.id === id);

test('Glance: compact, from the header and one glance read: the number and priority, the title on one line, chips; the rest in "Ticket details"', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const ui = await mount(<Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" />);
  try {
    const text = ui.text();
    assert.match(text, /^INC0010001 Priority 2 - High VPN keeps disconnecting for Abel Tuter In Progress/);
    const title = ui.$('h2.ab-glance-title');
    assert.equal(title?.textContent, 'VPN keeps disconnecting for Abel Tuter', 'the title is the heading');
    assert.equal(title.getAttribute('title'), 'VPN keeps disconnecting for Abel Tuter', 'the whole title on hover (it is cut to one line)');
    assert.equal(ui.$('[data-chip="state"]')?.textContent, 'In Progress');
    assert.ok(!ui.$('[data-chip="unassigned"]'), 'Beth Anglin has it');
    assert.ok(!/VIP/.test(text), 'the fixture caller is not marked VIP');
    assert.ok(!/Beth Anglin/.test(text), 'who has it waits in "Ticket details"');
    assert.ok(!ui.$('.ab-card'), 'no box around the ticket');
    // "Ticket details": a chevron that says so, and what it opens.
    const more = ui.$('button.ab-glance-more');
    assert.equal(more.getAttribute('aria-label'), 'Ticket details');
    assert.equal(more.getAttribute('aria-expanded'), 'false');
    await click(more);
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    const details = ui.$(`#${more.getAttribute('aria-controls')}`);
    assert.ok(details, 'the chevron names what it opens');
    assert.match(details.textContent, /Assigned to\s*Beth Anglin/);
    assert.match(details.textContent, /Updated/);
    assert.equal(fake.readsOf('glance').length, 1);
    assert.deepEqual(fake.readsOf('glance')[0], { table: 'incident', sysId: INCIDENT_ID, allowSensitive: false });
  } finally {
    await ui.unmount();
  }
  // Remembered while the panel is open: the next ticket shows the details the same way (and they are folded again for the next test).
  const again = await mount(<Glance page={pageFor()} eff={eff()} record={record} header={header} headPhase="ready" />);
  try {
    assert.equal(again.$('button.ab-glance-more').getAttribute('aria-expanded'), 'true');
    await click(again.$('button.ab-glance-more'));
  } finally {
    await again.unmount();
  }
});

test('Glance: the VIP mark; nobody assigned is a chip; nothing else of the ticket is read', async () => {
  const answer = await glanceAnswer();
  answer.vip = { status: 'yes', access: [] };
  answer.pack = { ...answer.pack, fields: { ...answer.pack.fields, assigned_to: '' } };
  const { fake } = await setup({ glance: answer });
  const ui = await mount(<Glance page={pageFor()} eff={eff()} record={record} header={header} headPhase="ready" />);
  try {
    assert.equal(ui.$('.ab-glance-vip')?.textContent, 'VIP');
    assert.equal(ui.$('[data-chip="unassigned"]')?.textContent, 'Unassigned');
    assert.equal(fake.readsOf('glance').length, 1, 'no read of its own');
  } finally {
    await ui.unmount();
  }
});

test('Insights: five rows, one per pain point; what needs the agent now leads "Understand the ticket" (its line, its dot, its first rows)', async () => {
  await setup();
  const needs = [
    { id: 'sla', level: 'danger', text: 'The SLA was due 2 h ago', sub: 'P2 resolution' },
    { id: 'waiting', level: 'warn', text: 'The customer has waited 2 d for a reply', sub: '' },
  ];
  const ui = await mount(<TicketInsights page={pageFor()} eff={eff(['it'])} record={record} header={header} active needs={needs} />);
  try {
    await settle(6);
    const rows = ui.$$('ul.ab-ins-groups > li[data-group]');
    assert.deepEqual(rows.map((li) => li.getAttribute('data-group')), ['understand', 'fix', 'caller', 'reply', 'close']);
    const understand = rows[0].querySelector('button.ab-ins-group-row');
    assert.equal(understand.querySelector('.ab-ins-pain-title').textContent, 'Understand the ticket');
    assert.equal(understand.querySelector('.ab-ins-pain-line').textContent, 'The SLA was due 2 h ago', 'the most urgent fact is its line');
    assert.ok(understand.querySelector('.ab-ins-tile .ab-ins-tile-dot.is-danger'), 'a dot on its tile');
    assert.match(understand.textContent, /Needs a look\./, 'said in words too');
    assert.equal(understand.getAttribute('aria-expanded'), 'false', 'the rows start folded');
    assert.equal(ui.$('[data-need="sla"]'), null, 'the facts are inside the row');
    await click(understand);
    const items = ui.$$('li[data-group="understand"] li[data-need]');
    assert.deepEqual(items.map((li) => li.getAttribute('data-need')), ['sla', 'waiting']);
    const sla = items[0];
    assert.ok(sla.querySelector('.ab-dot-danger'));
    assert.equal(sla.querySelector('.ab-ins-need-sub')?.textContent, 'P2 resolution');
    assert.equal(sla.querySelector('button, a'), null, 'nothing to click');
    assert.equal(items[1].querySelector('.ab-ins-need-sub'), null, 'no empty line');
    assert.ok(ui.$('li[data-group="understand"] [data-card="journey"]'), 'then its card, straight in the row (it is the only one)');
    assert.equal(ui.$('.ab-ai-badge', { all: true }), null);
  } finally {
    await ui.unmount();
  }
});

test('the cards share the Glance read: risk, missing details, email, journey and outage ask nothing more of the ticket', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const ui = await mount(
    <div>
      <Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" />
      {['risk', 'missing', 'email', 'outage'].map((id) => {
        const C = card(id).Card;
        return <C key={id} {...cardProps(page)} />;
      })}
    </div>
  );
  await settle();
  assert.equal(fake.readsOf('glance').length, 1, 'one read for all of them');
  assert.match(ui.text(), /Counted with word and count rules/);
  assert.match(ui.text(), /Kind of email/);
  await ui.unmount();
});

test('a folded card (not active) reads nothing but still reports its summary from what is in memory', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const summaries = {};
  const Risk = card('risk').Card;
  const Related = card('related').Card;
  const Caller = card('caller').Card;
  const ui2 = await mount(
    <div>
      <Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" />
      <Risk {...cardProps(page, { active: false, setSummary: (s) => (summaries.risk = s) })} />
      <Related {...cardProps(page, { active: false, setSummary: (s) => (summaries.related = s) })} />
      <Caller {...cardProps(page, { active: false, setSummary: (s) => (summaries.caller = s) })} />
    </div>
  );
  await settle();
  assert.ok(summaries.risk, 'risk drew its summary from the glance read');
  assert.equal(fake.readsOf('lookalikes').length + fake.readsOf('history').length, 0, 'the folded related and caller cards read nothing');
  await ui2.unmount();
});

test('Related tickets: look-alikes and what is open on the same item (the caller\'s tickets are a card of their own); a ticket opens in a NEW tab', async () => {
  const { fake, created } = await setup();
  const page = pageFor();
  let summary = '';
  const Related = card('related').Card;
  const ui = await mount(<Related {...cardProps(page, { setSummary: (s) => (summary = s) })} />);
  await settle();
  assert.match(summary, /^\d+ solved/);
  assert.ok(!/earlier/.test(summary) && !/Earlier tickets/.test(ui.text()), 'nothing about the caller here: nothing shown twice');
  assert.equal(fake.readsOf('history').length, 0, 'no read of the caller\'s history either');
  await click(ui.button(/Solved look-alikes/));
  const link = ui.$$('a.ab-ins-item').find((a) => /INC0009640/.test(a.textContent));
  assert.ok(link, ui.text().slice(0, 400));
  assert.equal(link.getAttribute('target'), '_blank');
  await click(link);
  await settle();
  assert.equal(created.length, 1);
  assert.match(created[0].url, /^https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=incident\.do/);
  assert.equal(fake.updates.length, 0, 'the ticket tab was not navigated');
  await ui.unmount();
});

test('a read the person may not do says "not available to you", not an error and not "none"', async () => {
  const { fake } = await setup();
  fake.onRead('lookalikes', () => {
    const err = new Error('Your user is not allowed to read this (403)');
    err.code = 'ACCESS_DENIED';
    throw err;
  });
  const page = pageFor();
  const Routing = card('routing').Card;
  const ui = await mount(<Routing {...cardProps(page)} />);
  await settle();
  assert.match(ui.text(), /not available to you/);
  assert.ok(!/403/.test(ui.text()));
  assert.equal(ui.$('.ab-note-danger'), null);
  await ui.unmount();
});

test('Which email fits: a template filled from the ticket, copied as plain text', async () => {
  await setup();
  const copied = fakeClipboard();
  const page = pageFor();
  const Email = card('email').Card;
  const ui = await mount(<Email {...cardProps(page)} />);
  await settle();
  const pre = ui.$('pre.ab-ins-email');
  assert.ok(pre, ui.text().slice(0, 300));
  assert.match(pre.textContent, /INC0010001/);
  assert.match(pre.textContent, /Beth Anglin/);
  await click(ui.button('Copy email'));
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^Subject: /);
  await ui.unmount();
});

test('Ready to resolve?: reads the check and the form, and reads again when shown again', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const Resolve = card('resolve').Card;
  const ui = await mount(<Resolve {...cardProps(page)} />);
  await settle();
  assert.match(ui.text(), /Checked the saved ticket only/);
  assert.equal(fake.readsOf('resolutionFacts').length, 1);
  await ui.rerender(<Resolve {...cardProps(page, { active: false })} />);
  await ui.rerender(<Resolve {...cardProps(page, { active: true })} />);
  assert.equal(fake.readsOf('resolutionFacts').length, 2, 'the form may have changed');
  assert.ok(ui.hasButton('Check again'));
  await ui.unmount();
});

test('through the shell: the cards an IT agent sees on an incident, in order, the five rows and the rest, none with an AI mark', async () => {
  await setup();
  const page = pageFor();
  const it = cardsFor(INSIGHT_CARDS, record, header, eff(['it'])).map((c) => c.id);
  for (const id of ['missing', 'routing', 'steps', 'related', 'caller', 'knowledge', 'changes', 'knownErrors', 'risk', 'email', 'journey', 'outage', 'resolve']) assert.ok(it.includes(id), `${id} in ${it}`);
  assert.ok(!it.includes('account') && !it.includes('request') && !it.includes('chat'));
  assert.equal(it[0], 'steps', 'in progress: the fixes first');
  const newOrder = cardsFor(INSIGHT_CARDS, record, { ...header, state: 'New' }, eff(['it'])).map((c) => c.id);
  assert.deepEqual(newOrder.slice(0, 2), ['missing', 'routing']);
  const csm = cardsFor(INSIGHT_CARDS, { ...record, table: 'sn_customerservice_case', kind: 'case' }, header, eff(['csm'])).map((c) => c.id);
  assert.ok(csm.includes('account') && csm.includes('caller') && !csm.includes('changes'));
  for (const c of INSIGHT_CARDS) assert.ok(Array.isArray(c.profiles) && c.profiles.length && typeof c.order === 'function' && typeof c.Card === 'function', c.id);
  assert.equal(shownFor(card('article').profiles, eff(['it'])), false);
  // Caller's other tickets: every ticket kind, every profile.
  assert.deepEqual(card('caller').kinds, card('related').kinds);
  assert.deepEqual(card('caller').profiles, ['all']);
  assert.equal(card('caller').title, "Caller's other tickets");

  const ui = await mount(<TicketInsights page={page} eff={eff(['it'])} record={record} header={header} active />);
  try {
    await settle(6);
    assert.equal(ui.$('.ab-ai-badge', { all: true }), null, 'no Insights element carries the AI mark');
    // The cards of the five are mounted (folded rows still read, for their lines); the rest are not, until they are asked for.
    const mounted = ui.$$('[data-card]', { all: true }).map((el) => el.getAttribute('data-card'));
    assert.deepEqual([...mounted].sort(), ['caller', 'email', 'journey', 'knowledge', 'resolve', 'steps']);
    // One list of rows: a tile, the pain point and its one line, a chevron that says whether it is open; no card frame.
    assert.ok(ui.$('ul.ab-rows.ab-ins-cards'));
    assert.equal(ui.$('.ab-cardx'), null);
    assert.equal(ui.$('.ab-ins-clear-toggle', { all: true }), null, 'no "All clear" row any more');
    const fix = ui.$('li[data-group="fix"] > button.ab-ins-group-row');
    assert.ok(fix.querySelector('.ab-ins-tile .ab-icon') && fix.querySelector('.ab-ins-pain-title') && fix.querySelector('.ab-chevron'));
    assert.equal(fix.getAttribute('aria-expanded'), 'false');
    assert.match(fix.querySelector('.ab-ins-pain-line')?.textContent || '', /\d+ (fix|fixes) from solved tickets and articles|None found|matching article/, 'its cards\' lines without opening it');
    await click(fix);
    assert.equal(fix.getAttribute('aria-expanded'), 'true');
    const body = ui.$(`#${fix.getAttribute('aria-controls')}`);
    assert.ok(body, 'the chevron names what it opens');
    // Several cards: today's card rows inside it, each opening in place.
    const rows = ui.$$('li[data-group="fix"] li[data-card] > button.ab-ins-card-toggle');
    assert.deepEqual(rows.map((b) => b.parentElement.getAttribute('data-card')).sort(), ['knowledge', 'steps']);
    assert.ok(rows.every((b) => b.querySelector('.ab-ins-card-title') && b.querySelector('.ab-dot')));
    await click(rows[0]);
    assert.equal(rows[0].getAttribute('aria-expanded'), 'true');
    assert.ok(ui.$(`#${rows[0].getAttribute('aria-controls')}`));
    // One card: its content straight in the row.
    await click(ui.$('li[data-group="reply"] > button.ab-ins-group-row'));
    assert.ok(ui.$('li[data-group="reply"] div[data-card="email"] pre.ab-ins-email'));
    assert.equal(ui.$('li[data-group="reply"] .ab-ins-card-toggle'), null, 'no row inside a row');
    // The way to the rest.
    const rest = it.filter((id) => !['steps', 'knowledge', 'caller', 'email', 'journey', 'resolve'].includes(id)).length;
    assert.equal(ui.$('li > button.ab-more-tools')?.textContent, `More for this ticket: ${rest} Insights`);
  } finally {
    await ui.unmount();
  }
});

test('one card alone (All tools, the rail, the bar on the page, another card): open under "Back"; back to the five, the focus where it was', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const needs = [{ id: 'waiting', level: 'warn', text: 'The customer is waiting for a reply', sub: '' }];
  let back = 0;
  const draw = (focus) => <TicketInsights page={page} eff={eff(['it'])} record={record} header={header} active needs={needs} focus={focus} onBack={() => (back += 1)} />;
  const ui = await mount(draw(null));
  try {
    await settle(6);
    assert.equal(ui.$('[data-card="knownErrors"]', { all: true }), null, 'a card of the rest: not mounted');
    assert.equal(fake.readsOf('knownErrors').length, 0);
    assert.equal(ui.$('.ab-ins-back'), null);
    // A card of the rest, alone.
    await ui.rerender(draw({ id: 'knownErrors', at: 1, from: null }));
    await settle();
    assert.deepEqual(ui.$$('[data-card]').map((el) => el.getAttribute('data-card')), ['knownErrors'], 'that card alone: no other card, no row, no fact');
    assert.equal(ui.$$('li[data-group]').length, 0);
    const shown = ui.$('li[data-card="knownErrors"]');
    const heading = shown.querySelector('h3.ab-ins-focus-title');
    assert.equal(heading?.textContent, 'Known errors and open problems');
    assert.equal(shown.querySelector('.ab-ins-card-toggle'), null, 'a heading, not a row that folds');
    assert.ok(ui.$(`#${shown.id}-body`), 'its content open');
    assert.equal(document.activeElement, heading, 'the focus on its name');
    assert.equal(fake.readsOf('knownErrors').length, 1, 'it reads now');
    await click(ui.button('Back'));
    assert.equal(back, 1, 'the way back is the screen\'s');
    // Back to the five: the card stays mounted (hidden), the focus goes to the way back to it.
    await ui.rerender(draw({ id: null, at: 2, from: 'knownErrors' }));
    await settle();
    assert.equal(ui.$('.ab-ins-back'), null);
    assert.equal(ui.$$('li[data-group]').length, 5);
    assert.ok(ui.$('[data-card="knownErrors"]', { all: true }), 'still mounted, so it keeps reporting and what was typed in it');
    assert.equal(document.activeElement, ui.$('.ab-more-tools'));

    // A card of the five with others in its row, alone: its row steps aside; back, the row is open and the card's row has the focus.
    await ui.rerender(draw({ id: 'knowledge', at: 3, from: null }));
    await settle();
    assert.deepEqual(ui.$$('[data-card]').map((el) => el.getAttribute('data-card')), ['knowledge']);
    assert.equal(ui.$('li[data-group="fix"] > .ab-ins-group-row'), null);
    assert.equal(document.activeElement, ui.$('[data-card="knowledge"] h3.ab-ins-focus-title'));
    await ui.rerender(draw({ id: null, at: 4, from: 'knowledge' }));
    await settle();
    assert.equal(ui.$('li[data-group="fix"] > .ab-ins-group-row').getAttribute('aria-expanded'), 'true', 'its row opened for it');
    assert.equal(document.activeElement, ui.$('li[data-card="knowledge"] > .ab-ins-card-toggle'));

    // The only card of a row, alone; back: that row's button.
    await ui.rerender(draw({ id: 'email', at: 5, from: null }));
    await settle();
    assert.equal(ui.$('div[data-card="email"] h3.ab-ins-focus-title')?.textContent, 'Which email fits');
    assert.equal(ui.$('[data-need="waiting"]'), null, 'no fact either');
    await ui.rerender(draw({ id: null, at: 6, from: 'email' }));
    await settle();
    assert.equal(document.activeElement, ui.$('li[data-group="reply"] > .ab-ins-group-row'));
    assert.equal(ui.$('div[data-card="email"] h3'), null);

    // The rail asked for a row: it opens and takes the focus.
    await ui.rerender(draw({ id: null, at: 7, from: null, group: 'close' }));
    await settle();
    assert.equal(ui.$('li[data-group="close"] > .ab-ins-group-row').getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, ui.$('li[data-group="close"] > .ab-ins-group-row'));

    // A card this record does not show is no focus at all: the five stay.
    await ui.rerender(draw({ id: 'article', at: 8, from: null }));
    assert.equal(ui.$('.ab-ins-back'), null);
  } finally {
    await ui.unmount();
  }
});

// ---- Caller's other tickets ----------------------------------------------------------------------------------------------------

const CALLER = 'c'.repeat(32);
const withPeople = async (people) => {
  const answer = await glanceAnswer();
  answer.pack = { ...answer.pack, people };
  return answer;
};
const earlier = (n) => Array.from({ length: n }, (_, i) => ({ table: 'incident', sysId: String(i + 1).padStart(32, '0'), number: `INC000${9640 + i}`, short_description: `Earlier ${i + 1}`, state: 'Closed', opened_at: '2026-10-12 08:00:00' }));

test('Caller\'s other tickets: the caller\'s earlier tickets, the repeat flag and the last fix that worked; a repeat needs a look', async () => {
  const { fake, created } = await setup({ glance: await withPeople([{ role: 'caller', name: 'Abel Tuter', sysId: CALLER }]) });
  fake.onRead('history', () => ({
    items: earlier(2),
    signals: { openCount: 1, lastResolved: { number: 'INC0009640', close_notes: 'Reinstalled the VPN client. Then it worked.' }, reopenedHint: { later: 'INC0010001', earlier: 'INC0009640', days: 3 } },
    access: [{ source: 'incident', status: 'ok' }],
  }));
  const page = pageFor();
  const said = {};
  const Caller = card('caller').Card;
  const ui = await mount(<Caller {...cardProps(page, { setSummary: (s) => (said.summary = s), setAttention: (a) => (said.attention = a) })} />);
  try {
    await settle();
    assert.deepEqual(fake.readsOf('history').map((a) => a.callerSysId), [CALLER], 'the history of the person named as the caller');
    assert.equal(said.summary, 'Looks like a repeat · 2 earlier tickets · 1 still open');
    assert.equal(said.attention, 'warn');
    assert.match(ui.$('.ab-note-warn').textContent, /^Looks like a repeat: INC0010001 came 3 days after INC0009640 was resolved\.$/);
    assert.match(ui.text(), /Earlier tickets from Abel Tuter 2/);
    assert.match(ui.$('.ab-ins-fix').textContent, /^Last fix that worked \(INC0009640\): Reinstalled the VPN client\./);
    const link = ui.$$('a.ab-ins-item').find((a) => /INC0009640/.test(a.textContent));
    assert.equal(link.getAttribute('target'), '_blank');
    await click(link);
    await settle();
    assert.equal(created.length, 1, 'it opens in a new tab');
    assert.equal(fake.updates.length, 0, 'the ticket tab was not navigated');
    assert.equal(ui.$('.ab-ins-group-toggle'), null, 'one list, nothing to unfold');
  } finally {
    await ui.unmount();
  }
});

test('Caller\'s other tickets: nothing earlier is nothing to report, but only when the history could be read in full', async () => {
  const { fake } = await setup({ glance: await withPeople([{ role: 'caller', name: 'Abel Tuter', sysId: CALLER }]) });
  let access = [{ source: 'incident', status: 'ok' }];
  fake.onRead('history', () => ({ items: [], signals: { openCount: 0 }, access }));
  const page = pageFor();
  const said = {};
  const Caller = card('caller').Card;
  let ui = await mount(<Caller {...cardProps(page, { setSummary: (s) => (said.summary = s), setAttention: (a) => (said.attention = a) })} />);
  await settle();
  assert.equal(said.summary, 'No earlier tickets from this caller');
  assert.equal(said.attention, 'clear');
  assert.match(ui.text(), /No earlier tickets from this person\./);
  await ui.unmount();

  insightStore.clear();
  access = [{ source: 'incident', status: 'denied' }];
  ui = await mount(<Caller {...cardProps(pageFor(), { setSummary: (s) => (said.summary = s), setAttention: (a) => (said.attention = a) })} />);
  await settle();
  assert.equal(said.attention, '', 'some of them could not be read: not "nothing"');
  await ui.unmount();
});

test('Caller\'s other tickets: the caller as the caller briefing finds them (an HR case\'s employee under subject_person); nobody named, no read', async () => {
  const { fake } = await setup({ glance: await withPeople([{ role: 'subject_person', name: 'Ann Lee', sysId: CALLER }]) });
  fake.onRead('history', () => ({ items: earlier(1), signals: { openCount: 0 }, access: [] }));
  const Caller = card('caller').Card;
  const said = {};
  let ui = await mount(<Caller {...cardProps(pageFor(), { setSummary: (s) => (said.summary = s) })} />);
  await settle();
  assert.deepEqual(fake.readsOf('history').map((a) => a.callerSysId), [CALLER]);
  assert.match(ui.text(), /Earlier tickets from Ann Lee/);
  assert.equal(said.summary, '1 earlier ticket');
  await ui.unmount();

  const none = await setup({ glance: await withPeople([{ role: 'assigned_to', name: 'Beth Anglin', sysId: CALLER }]) });
  ui = await mount(<Caller {...cardProps(pageFor(), { setSummary: (s) => (said.summary = s), setAttention: (a) => (said.attention = a) })} />);
  await settle();
  assert.equal(none.fake.readsOf('history').length, 0, 'nobody to read for');
  assert.equal(said.summary, 'Nobody is named as the caller');
  assert.equal(said.attention, 'clear');
  assert.match(ui.text(), /Nobody is named as the caller on this ticket\./);
  await ui.unmount();
});

test('Caller\'s other tickets: a history that could not be read is said plainly and is no line, never "none"', async () => {
  const { fake } = await setup({ glance: await withPeople([{ role: 'caller', name: 'Abel Tuter', sysId: CALLER }]) });
  fake.onRead('history', () => {
    const err = new Error('Your user is not allowed to read this (403)');
    err.code = 'ACCESS_DENIED';
    throw err;
  });
  const said = { summary: 'x', attention: 'x' };
  const Caller = card('caller').Card;
  const ui = await mount(<Caller {...cardProps(pageFor(), { setSummary: (s) => (said.summary = s), setAttention: (a) => (said.attention = a) })} />);
  await settle();
  assert.match(ui.text(), /not available to you/);
  assert.equal(said.summary, '');
  assert.equal(said.attention, '');
  await ui.unmount();
});
