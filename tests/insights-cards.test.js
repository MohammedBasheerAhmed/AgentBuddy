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

test('Insights: what needs the agent now leads the list, as plain rows (a dot, a sentence, a quiet line), before the cards', async () => {
  await setup();
  const needs = [
    { id: 'sla', level: 'danger', text: 'The SLA was due 2 h ago', sub: 'P2 resolution' },
    { id: 'waiting', level: 'warn', text: 'The customer has waited 2 d for a reply', sub: '' },
  ];
  const ui = await mount(<TicketInsights page={pageFor()} eff={eff(['it'])} record={record} header={header} active needs={needs} />);
  try {
    await settle(6);
    const items = ui.$$('ul.ab-ins-cards > li');
    assert.deepEqual(items.slice(0, 2).map((li) => li.getAttribute('data-need')), ['sla', 'waiting']);
    assert.ok(items[2].hasAttribute('data-card'), 'then the cards');
    const sla = items[0];
    assert.ok(sla.querySelector('.ab-dot-danger'));
    assert.match(sla.textContent, /The SLA was due 2 h ago/);
    assert.equal(sla.querySelector('.ab-ins-need-sub')?.textContent, 'P2 resolution');
    assert.equal(sla.querySelector('button, a'), null, 'nothing to click');
    assert.equal(items[1].querySelector('.ab-ins-need-sub'), null, 'no empty line');
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
  const ui2 = await mount(
    <div>
      <Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" />
      <Risk {...cardProps(page, { active: false, setSummary: (s) => (summaries.risk = s) })} />
      <Related {...cardProps(page, { active: false, setSummary: (s) => (summaries.related = s) })} />
    </div>
  );
  await settle();
  assert.ok(summaries.risk, 'risk drew its summary from the glance read');
  assert.equal(fake.readsOf('lookalikes').length + fake.readsOf('history').length, 0, 'the folded related card read nothing');
  await ui2.unmount();
});

test('Related tickets: folded groups with counts; a ticket opens in a NEW tab, the ticket being worked on stays', async () => {
  const { fake, created } = await setup();
  const page = pageFor();
  let summary = '';
  const Related = card('related').Card;
  const ui = await mount(<Related {...cardProps(page, { setSummary: (s) => (summary = s) })} />);
  await settle();
  assert.match(summary, /0 earlier · \d+ solved/);
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

test('through the shell: the cards an IT agent sees on an incident, in order, none with an AI mark', async () => {
  await setup();
  const page = pageFor();
  const it = cardsFor(INSIGHT_CARDS, record, header, eff(['it'])).map((c) => c.id);
  for (const id of ['missing', 'routing', 'steps', 'related', 'knowledge', 'changes', 'knownErrors', 'risk', 'email', 'journey', 'outage', 'resolve']) assert.ok(it.includes(id), `${id} in ${it}`);
  assert.ok(!it.includes('account') && !it.includes('request') && !it.includes('chat'));
  assert.equal(it[0], 'steps', 'in progress: the fixes first');
  const newOrder = cardsFor(INSIGHT_CARDS, record, { ...header, state: 'New' }, eff(['it'])).map((c) => c.id);
  assert.deepEqual(newOrder.slice(0, 2), ['missing', 'routing']);
  const csm = cardsFor(INSIGHT_CARDS, { ...record, table: 'sn_customerservice_case', kind: 'case' }, header, eff(['csm'])).map((c) => c.id);
  assert.ok(csm.includes('account') && !csm.includes('changes'));
  for (const c of INSIGHT_CARDS) assert.ok(Array.isArray(c.profiles) && c.profiles.length && typeof c.order === 'function' && typeof c.Card === 'function', c.id);
  assert.equal(shownFor(card('article').profiles, eff(['it'])), false);

  const ui = await mount(<TicketInsights page={page} eff={eff(['it'])} record={record} header={header} active />);
  try {
    await settle(6);
    assert.equal(ui.$('.ab-ai-badge', { all: true }), null, 'no Insights element carries the AI mark');
    assert.ok(ui.$$('[data-card]', { all: true }).length >= 10, 'every card is there (the all-clear ones inside their row)');
    // One list of rows: a dot, the title and its one line, a chevron that says whether it is open; no card frame with a border.
    const list = ui.$('ul.ab-rows.ab-ins-cards');
    assert.ok(list);
    assert.equal(ui.$('.ab-cardx'), null);
    const first = ui.$('li[data-card] > button.ab-ins-card-toggle');
    assert.ok(first.querySelector('.ab-dot') && first.querySelector('.ab-ins-card-title') && first.querySelector('.ab-chevron'));
    assert.equal(first.getAttribute('aria-expanded'), 'false', 'rows start folded, their one line showing');
    // The cards with nothing to report (no change on the CI, no known error here) wait under "All clear in ...", which opens to list them.
    const clear = ui.button(/^All clear in /);
    assert.match(clear.textContent, /Recent changes on this CI or service/);
    assert.equal(ui.$('[data-card="changes"]'), null, 'folded away');
    await click(clear);
    assert.ok(ui.$('[data-card="changes"]'), 'listed once the row is opened');
    // A row opens its card in place.
    await click(first);
    assert.equal(first.getAttribute('aria-expanded'), 'true');
    assert.ok(ui.$(`#${first.getAttribute('aria-controls')}`));
  } finally {
    await ui.unmount();
  }
});

test('one card alone (the side rail, the bar on the page, another card): open, under "All insights"; back to the list, the focus on its row', async () => {
  await setup();
  const page = pageFor();
  const needs = [{ id: 'waiting', level: 'warn', text: 'The customer is waiting for a reply', sub: '' }];
  let back = 0;
  const draw = (focus) => <TicketInsights page={page} eff={eff(['it'])} record={record} header={header} active needs={needs} focus={focus} onBack={() => (back += 1)} />;
  const ui = await mount(draw(null));
  try {
    await settle(6);
    assert.equal(ui.$('[data-card="knownErrors"]'), null, 'nothing to report: under "All clear"');
    assert.equal(ui.$('.ab-ins-back'), null);
    // A card that waits under "All clear" is shown alone all the same.
    await ui.rerender(draw({ id: 'knownErrors', at: 1, from: null }));
    await settle();
    const shown = ui.$$('ul.ab-ins-cards > li');
    assert.deepEqual(shown.map((li) => li.getAttribute('data-card')), ['knownErrors'], 'that card alone: no other card, no fact row, no "All clear" row');
    const card = shown[0];
    const heading = card.querySelector('h3.ab-ins-focus-title');
    assert.equal(heading?.textContent, 'Known errors and open problems');
    assert.equal(card.querySelector('.ab-ins-card-toggle'), null, 'a heading, not a row that folds');
    assert.ok(ui.$(`#${card.id}-body`), 'its content open');
    assert.equal(document.activeElement, heading, 'the focus on its name');
    assert.equal(ui.$$('[data-card]', { all: true }).length, cardsFor(INSIGHT_CARDS, record, header, eff(['it'])).length, 'every other card still mounted (hidden): it keeps reporting');
    await click(ui.button('All insights'));
    assert.equal(back, 1, 'the way back is the screen\'s');
    // Back to the list: the card's row takes the focus (its "All clear" row opened for it).
    await ui.rerender(draw({ id: null, at: 2, from: 'knownErrors' }));
    await settle();
    assert.equal(ui.$('.ab-ins-back'), null);
    assert.ok(ui.$('[data-need="waiting"]'), 'the list again, its first rows too');
    const row = ui.$('[data-card="knownErrors"] > .ab-ins-card-toggle');
    assert.ok(row, 'the All clear row opened');
    assert.equal(document.activeElement, row);
    // A card this record does not show is no focus at all: the list stays.
    await ui.rerender(draw({ id: 'article', at: 3, from: null }));
    assert.equal(ui.$('.ab-ins-back'), null);
  } finally {
    await ui.unmount();
  }
});
