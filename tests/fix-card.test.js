import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePolicy } from '../src/policy/policy.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import TicketInsights from '../src/sidepanel/ticket/TicketInsights.jsx';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import insightOps from '../src/content/ops/insights.js';
import fixOps from '../src/content/ops/fix.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { findSimilarTickets, searchKnowledge } from '../src/context/similar.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { ABEL, BETH } from './fixtures/sn-users.js';

// Find the fix (round 4) in "Steps that worked before", driven in the small DOM with the real reads on the fake instance: the error code
// the ticket quotes and its one search (asked for by the agent, answered in place, links that open next to the ticket), "solved before
// by", and the card's line, which leads the "Find the fix" row ("Error 0x800CCC0F found · solved 3 times before by Service Desk – Email").

const record = { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' };
let tab = 500;
const pageFor = () => ({ status: 'record', tabId: (tab += 1), href: `https://acme.service-now.com/incident.do?sys_id=${INCIDENT_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const eff = () => ({ ready: true, values: { profiles: ['it'] }, locked: {}, policy: normalizePolicy({}) });
const header = { number: 'INC0010001', short_description: 'VPN keeps disconnecting for Abel Tuter', state: 'In Progress', priority: '2 - High' };
const EMAIL_GROUP = v('ee25dccec0a8016700a222a0f7900d07', 'Service Desk – Email');
const LINE = 'Error 0x800CCC0F found · solved 3 times before by Service Desk – Email';

/**
 * The fixture instance, with: the ticket quoting 0x800CCC0F in its description (next to a phone number, which is no code); three of its
 * solved look-alikes with Service Desk – Email, two of them solved by Beth Anglin; and (`found`) one article and one solved incident
 * that mention the code.
 */
function tables({ code = true, groups = true, found = true } = {}) {
  const t = buildInstance();
  t.incident = t.incident.map((row) => {
    if (row.sys_id.value === INCIDENT_ID) {
      return code ? { ...row, description: v('<p>Since the password change Outlook on my phone says 0x800CCC0F.</p><p>Please call me on +1 555-0134.</p>') } : row;
    }
    const number = row.number.value;
    if (groups && ['INC0009001', 'INC0009150', 'INC0009640'].includes(number)) {
      return { ...row, assignment_group: EMAIL_GROUP, assigned_to: number === 'INC0009640' ? v(ABEL.sysId, ABEL.name) : v(BETH.sysId, BETH.name) };
    }
    return row;
  });
  if (found) {
    t.incident.push({
      sys_id: v('1c0f00000000000000000000000000a1'),
      number: v('INC0010021'),
      short_description: v('Mail on the phone stopped after a password change'),
      description: v('Outlook: 0x800CCC0F'),
      close_notes: v('Removed the mail account on the phone and added it again.'),
      state: v('7', 'Closed'),
      resolved_at: v('2026-11-05 09:00:00', '2026-11-05 09:00:00'),
      closed_at: v('', ''),
      sys_updated_on: v('2026-11-05 09:00:00'),
      category: v('email', 'Email'),
    });
    t.kb_knowledge.push({
      sys_id: v('cb0000000000000000000000000000a2'),
      number: v('KB0000032'),
      short_description: v('Mail on a phone after a password change'),
      text: v('<p>If Outlook shows <b>0x800CCC0F</b>, remove the mail account on the phone and add it again.</p>'),
      workflow_state: v('published', 'Published'),
      kb_knowledge_base: v('kbb9', 'IT Knowledge Base'),
      valid_to: v('2027-12-31'),
      sys_updated_on: v('2026-10-01 10:00:00'),
    });
  }
  return t;
}

async function setup(shape) {
  insightStore.clear();
  const t = tables(shape);
  const deps = () => Object.assign(fakeDeps(t), { now: () => Date.UTC(2026, 10, 6, 12) });
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const created = [];
  fake.chrome.tabs.create = async (props) => created.push(props);
  fake.chrome.tabs.get = async (id) => ({ id, index: 0, windowId: 1 });
  const glance = await insightOps.glance({ table: 'incident', sysId: INCIDENT_ID }, { deps: deps(), checkRecord, checkPack });
  fake.onRead('glance', () => glance);
  fake.onRead('lookalikes', (args) => findSimilarTickets(args.pack, deps(), { resolvedOnly: true, limit: 8, routing: true }));
  fake.onRead('knowledge', (args) => searchKnowledge(args.pack, deps(), { limit: 5 }));
  fake.onRead('fixCodeSearch', (args) => fixOps.fixCodeSearch(args, { deps: deps(), checkRecord, checkPack, allowSensitive: false }));
  fake.onRead('history', () => ({ items: [], signals: { openCount: 0 }, access: [] }));
  fake.onRead('journey', () => ({ available: false, changes: [], note: '', access: [] }));
  fake.onRead('pack', () => ({ table: 'incident', sysId: INCIDENT_ID, kind: 'incident', fields: { state: 'In Progress' }, people: [], journal: [], related: {}, access: [] }));
  fake.onRead('resolutionFacts', () => ({ form: null, links: null }));
  return { fake, created };
}

const Steps = INSIGHT_CARDS.find((c) => c.id === 'steps').Card;

async function mountSteps(page, report = {}) {
  return mount(<Steps page={page} eff={eff()} record={record} header={header} active setSummary={(s) => (report.summary = s)} setAttention={(a) => (report.attention = a)} />);
}

test('the error code and who solved it before are facts in the card, and its line reads like the approved row line', async () => {
  const { fake } = await setup();
  const report = {};
  const ui = await mountSteps(pageFor(), report);
  try {
    await settle(6);
    assert.equal(report.summary, LINE);
    assert.equal(report.attention, 'ok', 'fixes that worked before are still good news');
    const fact = ui.$('[data-fact="error-code"]');
    assert.ok(fact, ui.text().slice(0, 300));
    assert.equal(fact.querySelector('dt').textContent, 'Error code in the description');
    assert.equal(fact.querySelector('dd').textContent, '0x800CCC0F', 'the phone number next to it is not a code');
    const solved = ui.$('[data-fact="solved-by"]');
    assert.equal(solved.querySelector('dt').textContent, 'Solved before by');
    assert.equal(solved.querySelector('dd').textContent, 'Service Desk – Email: 3 solved look-alikes (Beth Anglin solved 2 of them)');
    // The steps list is still there, between the two facts.
    assert.ok(ui.$$('.ab-ins-step').length > 0);
    // One quiet button; the screen's primary button is not in a card. Nothing is searched until it is pressed.
    assert.equal(fake.readsOf('fixCodeSearch').length, 0);
    assert.equal(ui.$('[data-card] .ab-btn-primary, .ab-btn-primary'), null);
    assert.equal(ui.$('.ab-ai-badge', { all: true }), null, 'no AI here');
  } finally {
    await ui.unmount();
  }
});

test('one search lists, in place, the articles and solved tickets that mention the code; a link opens next to the ticket', async () => {
  const { fake, created } = await setup();
  const ui = await mountSteps(pageFor());
  try {
    await settle(6);
    await click(ui.button('Search articles and solved tickets'));
    await settle(6);
    assert.deepEqual(fake.readsOf('fixCodeSearch'), [{ table: 'incident', sysId: INCIDENT_ID, codes: ['800CCC0F'], allowSensitive: false }]);
    const fact = ui.$('[data-fact="error-code"]');
    assert.match(fact.textContent, /Articles: 1\. Solved tickets: 1\./);
    const links = [...fact.querySelectorAll('a.ab-ins-item')];
    assert.deepEqual(links.map((a) => a.querySelector('.ab-record-number').textContent), ['KB0000032', 'INC0010021']);
    assert.match(links[0].textContent, /Article · IT Knowledge Base/);
    assert.match(links[0].textContent, /remove the mail account/);
    assert.match(links[1].textContent, /Solved ticket · Closed/);
    assert.match(links[1].textContent, /Removed the mail account on the phone and added it again\./);
    assert.ok(!/INC0010001/.test(fact.textContent), 'never the ticket itself');
    assert.equal(links[1].getAttribute('target'), '_blank');
    await click(links[1]);
    await settle();
    assert.equal(created.length, 1);
    assert.match(created[0].url, /^https:\/\/acme\.service-now\.com\/nav_to\.do\?uri=incident\.do/);
    assert.equal(fake.updates.length, 0, 'the ticket tab was not navigated');
    // Pressed again: one more read (the answer is kept in panel memory otherwise).
    await click(ui.button('Search articles and solved tickets'));
    await settle(6);
    assert.equal(fake.readsOf('fixCodeSearch').length, 2);
  } finally {
    await ui.unmount();
  }
});

test('nothing mentions the code: said plainly, only when both could be read', async () => {
  const { fake } = await setup({ found: false });
  const ui = await mountSteps(pageFor());
  try {
    await settle(6);
    await click(ui.button('Search articles and solved tickets'));
    await settle(6);
    assert.match(ui.$('[data-fact="error-code"]').textContent, /No article or solved ticket found that mentions 0x800CCC0F\./);
    // Knowledge refused: no "none", the refusal instead.
    fake.onRead('fixCodeSearch', () => ({ codes: ['800CCC0F'], articles: [], tickets: [], access: [{ source: 'kb_knowledge', status: 'denied', note: 'Your user cannot read kb_knowledge.' }, { source: 'incident', status: 'empty', note: '' }] }));
    await click(ui.button('Search articles and solved tickets'));
    await settle(6);
    const text = ui.$('[data-fact="error-code"]').textContent;
    assert.ok(!/No article or solved ticket found that mentions/.test(text), text);
    assert.ok(!/kb_knowledge/.test(text), 'no table name');
  } finally {
    await ui.unmount();
  }
});

test('no code and look-alikes of one group: no code fact, the line says who solved it before; nothing at all: the line as before', async () => {
  await setup({ code: false, groups: false, found: false });
  const report = {};
  const ui = await mountSteps(pageFor(), report);
  try {
    await settle(6);
    assert.equal(ui.$('[data-fact="error-code"]'), null);
    assert.equal(report.summary, 'Solved 5 times before by Network Support');
    assert.equal(ui.$('[data-fact="solved-by"] dd').textContent, 'Network Support: 5 solved look-alikes');
  } finally {
    await ui.unmount();
  }

  const { fake } = await setup({ code: false, groups: false, found: false });
  fake.onRead('lookalikes', () => ({ hits: [], keywords: [], access: [{ source: 'incident', status: 'empty' }] }));
  const plain = {};
  const ui2 = await mountSteps(pageFor(), plain);
  try {
    await settle(6);
    assert.equal(ui2.$('[data-fact="solved-by"]'), null);
    assert.match(plain.summary, /^\d+ (fix|fixes) from solved tickets and articles$|^None found$/);
  } finally {
    await ui2.unmount();
  }
});

test('through the Ticket screen: the "Find the fix" row\'s line starts with the approved words, and the card keeps them on its own row', async () => {
  await setup();
  const ui = await mount(<TicketInsights page={pageFor()} eff={eff()} record={record} header={header} active />);
  try {
    await settle(8);
    const row = ui.$('li[data-group="fix"] > button.ab-ins-group-row');
    const line = row.querySelector('.ab-ins-pain-line')?.textContent || '';
    assert.ok(line.startsWith(LINE), line);
    await click(row);
    const steps = ui.$('li[data-group="fix"] li[data-card="steps"] .ab-ins-card-summary');
    assert.equal(steps?.textContent, LINE);
  } finally {
    await ui.unmount();
  }
});
