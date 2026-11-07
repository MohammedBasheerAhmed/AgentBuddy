import { mount, click, choose, makeChrome, fakeAiFetch } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeInsights } from '../src/sidepanel/knowledgeScreen/index.js';
import { clearShared } from '../src/sidepanel/knowledgeScreen/shared.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { MSG } from '../src/lib/messages.js';
import { KB_IT, answerFrom, kbBase, kbDeps } from './km-fixtures.js';

// Wave 6, knowledge manager (item 4): the Knowledge screen's Insights half works the same on a classic form, in a Workspace, on a portal
// page and when no ticket is open at all. The tools read through the tab the panel is attached to and nothing else: no form, no record,
// no g_form, and what they open is always an address built from the page's own origin.

const ORIGIN = 'https://acme.service-now.com';
const eff = (profiles = ['it', 'km']) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', profiles }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });
const A = 'a'.repeat(32);
const record = (table, kind, number = 'INC0010001') => ({ table, sysId: A, number, kind });

const SURFACES = {
  'a classic ticket form': { status: 'record', surface: 'classic', href: `${ORIGIN}/incident.do?sys_id=${A}`, record: record('incident', 'incident') },
  'a Workspace ticket': { status: 'record', surface: 'workspace', href: `${ORIGIN}/now/sow/record/incident/${A}`, record: record('incident', 'incident') },
  'a portal ticket page': { status: 'record', surface: 'portal', portal: { base: '/sp' }, href: `${ORIGIN}/sp?id=ticket&table=incident&sys_id=${A}`, record: record('incident', 'incident') },
  'a knowledge article form': { status: 'record', surface: 'classic', href: `${ORIGIN}/kb_knowledge.do?sys_id=${A}`, record: record('kb_knowledge', 'article', 'KB0000001') },
  'the classic home page, no ticket': { status: 'no-record', surface: 'classic', href: `${ORIGIN}/now/nav/ui/classic/params/target/home`, record: null },
  'a Workspace list, no ticket': { status: 'no-record', surface: 'workspace', href: `${ORIGIN}/now/sow/list/params/list-id/x`, record: null },
  'a portal home page, no ticket': { status: 'no-record', surface: 'portal', portal: { base: '/esc' }, href: `${ORIGIN}/esc`, record: null },
};
const pageFor = (shape) => ({ tabId: 7, newRecord: null, user: { name: 'Beth Anglin', userId: 'u1' }, ...shape });

function setup() {
  clearShared();
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('x');
  const deps = kbDeps(kbBase(40, { titles: { 30: 'Reset your VPN password', 33: 'Reset your VPN password' } }));
  answerFrom(fake, deps);
  fake.onRead('kbGapScopes', () => ({ categories: [], total: 9, access: [] }));
  fake.onRead('kbGaps', () => ({ scanned: 9, total: 9, days: 60, withArticle: 0, link: { known: true }, clusters: [], access: [], truncated: false, note: '' }));
  fake.onRead('kbSearch', () => ({ hits: [], keywords: [], more: false, access: [] }));
  fake.onRead('header', () => ({ number: 'INC0010001', short_description: 'VPN drops', state: 'New', priority: '3' }));
  return { fake };
}
const open = async (ui, title) => click(ui.$$('.ab-wk-toggle').find((b) => b.textContent.includes(title)));

for (const [name, shape] of Object.entries(SURFACES)) {
  test(`a knowledge manager gets search, duplicates and gaps on ${name}, and both tools read through the tab only`, async () => {
    const { fake } = setup();
    const page = pageFor(shape);
    const ui = await mount(<KnowledgeInsights page={page} eff={eff()} active />);
    for (const title of ['Knowledge search', 'Duplicate articles', 'Articles to write']) assert.match(ui.text(), new RegExp(title), title);
    assert.equal(ui.errors.length, 0, 'nothing logged while drawing');

    await open(ui, 'Duplicate articles');
    await choose(ui.field('Knowledge base'), KB_IT);
    await click(ui.button('Find duplicates'));
    assert.match(ui.$('[data-coverage="duplicates"]').textContent, /^Compared 40 of 40 articles in IT Knowledge Base\. 1 group read alike\.$/);
    // what a group opens is an address on this ServiceNow site, the same on every surface (the authoring form, in a new tab)
    const links = ui.$$('a.ab-kb-open').map((a) => a.getAttribute('href'));
    assert.equal(links.length, 2);
    assert.ok(links.every((href) => href.startsWith(`${ORIGIN}/nav_to.do?uri=kb_knowledge.do`)), links.join(' '));
    assert.ok(ui.$$('a.ab-kb-open').every((a) => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel'))));

    await open(ui, 'Articles to write');
    await click(ui.button('Find topics'));
    assert.match(ui.text(), /Looked at 9 tickets resolved in the last 60 days\./);

    // every message went to this tab as a READ: no form was asked, nothing was filled, no page state was needed
    assert.ok(fake.sent.length > 0);
    assert.ok(fake.sent.every((s) => s.tabId === 7 && s.message.type === MSG.READ), [...new Set(fake.sent.map((s) => s.message.type))].join(', '));
    assert.equal(globalThis.fetch.calls.length, 0, 'no AI in Insights');
    await ui.unmount();
  });
}

test('with no ticket open the screen says where to start and still searches; with a ticket open it starts with the ticket\'s articles', async () => {
  const { fake } = setup();
  const none = await mount(<KnowledgeInsights page={pageFor(SURFACES['the classic home page, no ticket'])} eff={eff()} active />);
  assert.match(none.text(), /Open a ticket to see the articles that match it here, or search below\./);
  assert.equal(fake.readsOf('kbSearch').length, 0, 'nothing is searched until the person types');
  assert.equal(fake.readsOf('header').length, 0, 'and no ticket is read');
  await none.unmount();
  const ticket = await mount(<KnowledgeInsights page={pageFor(SURFACES['a Workspace ticket'])} eff={eff()} active />);
  assert.match(ticket.text(), /Articles for INC0010001/);
  await ticket.unmount();
});

test('moving from a ticket to no ticket (or to another surface) keeps the tools working and starts the scan over only for another site', async () => {
  const { fake } = setup();
  const ui = await mount(<KnowledgeInsights page={pageFor(SURFACES['a classic ticket form'])} eff={eff()} active />);
  await open(ui, 'Duplicate articles');
  await choose(ui.field('Knowledge base'), KB_IT);
  await click(ui.button('Find duplicates'));
  assert.match(ui.text(), /Compared 40 of 40/);
  // the same tab and site, the agent leaves the ticket: what was found stays (the knowledge bases did not change)
  await ui.rerender(<KnowledgeInsights page={pageFor(SURFACES['the classic home page, no ticket'])} eff={eff()} active />);
  assert.match(ui.text(), /Compared 40 of 40/);
  await ui.rerender(<KnowledgeInsights page={pageFor(SURFACES['a Workspace list, no ticket'])} eff={eff()} active />);
  assert.match(ui.text(), /Compared 40 of 40/);
  assert.equal(fake.readsOf('kbDuplicates').length, 1, 'no read was repeated by moving around');
  await ui.unmount();
});

test('everyone else gets search only: no duplicates, no gaps, no reads for them', async () => {
  const { fake } = setup();
  const ui = await mount(<KnowledgeInsights page={pageFor(SURFACES['the classic home page, no ticket'])} eff={eff(['it'])} active />);
  assert.ok(!/Duplicate articles|Articles to write/.test(ui.text()));
  assert.equal(fake.readsOf('kbScopes').length + fake.readsOf('kbDuplicates').length + fake.readsOf('kbGapScopes').length, 0);
  await ui.unmount();
});
