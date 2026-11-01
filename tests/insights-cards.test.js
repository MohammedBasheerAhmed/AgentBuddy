import { mount, click, makeChrome, fakeClipboard, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
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

test('Glance: the three lines from the header and one glance read, then the quick bar inside it', async () => {
  const { fake } = await setup();
  const page = pageFor();
  const ui = await mount(<Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" quickBar={<div className="qb">QUICK</div>} />);
  const text = ui.text();
  assert.match(text, /INC0010001 VPN keeps disconnecting for Abel Tuter/);
  assert.match(text, /In Progress 2 - High/);
  assert.match(text, /Beth Anglin/);
  assert.match(text, /QUICK/);
  assert.ok(!/VIP/.test(text), 'the fixture caller is not marked VIP');
  assert.equal(fake.readsOf('glance').length, 1);
  assert.deepEqual(fake.readsOf('glance')[0], { table: 'incident', sysId: INCIDENT_ID, allowSensitive: false });
  await ui.unmount();
});

test('Glance: VIP mark and the outage banner, which opens the outage card', async () => {
  const answer = await glanceAnswer();
  answer.vip = { status: 'yes', access: [] };
  answer.outage = { hits: [0.3, 0.8, 1.5].map((h, i) => ({ table: 'incident', sysId: String(i + 1).repeat(32), number: `INC00200${i}`, hoursAgo: h, same: ['cmdb_ci'], state: 'New' })), windowHours: 24, access: [{ source: 'incident', status: 'ok' }] };
  await setup({ glance: answer });
  const page = pageFor();
  const shown = [];
  const ui = await mount(<Glance page={page} eff={eff()} record={record} header={header} headPhase="ready" onShowCard={(id) => shown.push(id)} />);
  assert.match(ui.text(), /VIP/);
  const banner = ui.button(/3 other open tickets on VPN Gateway EU in the last 2 h/);
  await click(banner);
  assert.deepEqual(shown, ['outage']);
  await ui.unmount();
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
  await settle(6);
  assert.equal(ui.$('.ab-ai-badge', { all: true }), null, 'no Insights element carries the AI mark');
  assert.ok(ui.$$('[data-card]').length >= 10);
  await ui.unmount();
});
