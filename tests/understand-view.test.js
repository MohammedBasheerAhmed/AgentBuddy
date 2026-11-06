import { mount, click, settle, during, makeChrome, fakeAiFetch } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import { forgetLastViewed } from '../src/sidepanel/ticket/useNeeds.js';
import { forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { LAUNCH_KEY, freshLaunch } from '../src/lib/launch.js';
import { LAST_VIEWED_KEY } from '../src/lib/lastViewed.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// "Understand the ticket" on the Ticket screen, in a small DOM (round 4): what the caller wrote last, with "Translate" (the AI mark)
// only when the message is in another script than the panel's language; "Translate" starts the AI action in AI Assist through the
// same launch path as the bar on the ServiceNow page and All tools (preview first, nothing sent from Insights); "Since you last looked"
// from the time kept in the browser (sys_id, table, time only), and nothing kept or said when the organisation turns it off.

const MIN = 60000;
const H = 60 * MIN;
const ORIGIN = 'https://acme.service-now.com';
const SYS = 'c'.repeat(32);
const KEY = 'sk-ant-test-0123456789';
const record = { table: 'incident', sysId: SYS, number: 'INC0010042', kind: 'incident' };
const page = { status: 'record', tabId: 701, href: `${ORIGIN}/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
const header = { number: 'INC0010042', short_description: 'Mail does not open', state: 'In Progress', priority: '3 - Moderate' };
const effOf = (values = {}, policy = {}, apiKey = KEY) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'], profilesConfirmed: true, provider: 'anthropic', previewMode: 'always', ...values }, policy), apiKey, keyLocked: false });
const sn = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const ARABIC = 'لا أستطيع فتح البريد منذ الصباح، أرجو المساعدة';
const ENGLISH = 'I still cannot open my mailbox since this morning, please help';

function packOf(message, { at = Date.now() - H } = {}) {
  return {
    version: 1,
    table: 'incident',
    sysId: SYS,
    number: 'INC0010042',
    kind: 'incident',
    fields: { number: 'INC0010042', short_description: 'Mail does not open', state: 'In Progress', assigned_to: 'Beth Anglin', sys_updated_on: sn(at) },
    people: [
      { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: 'b'.repeat(32) },
      { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) },
    ],
    journal: [
      { when: sn(at - 2 * H), by: 'Beth Anglin', type: 'comment', text: 'Could you restart the laptop?' },
      { when: sn(at), by: 'Abel Tuter', type: 'comment', text: message },
    ],
    related: { times: { sys_updated_on: sn(at) } },
    access: [{ source: 'journal', status: 'ok', strategy: 'sys_journal_field' }],
  };
}

function setup(message = ARABIC) {
  insightStore.clear();
  forgetAnswers();
  forgetLastViewed();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Short description: Mail does not open\nMessage: I cannot open the mail since the morning, please help.');
  const pack = packOf(message);
  fake.onRead('header', () => header);
  fake.onRead('glance', () => ({ pack, slas: { items: [], access: [{ source: 'task_sla', status: 'empty' }] }, vip: { status: 'no', access: [] }, outage: null }));
  fake.onRead('journey', () => ({ available: true, changes: [], note: '', access: [] }));
  fake.onRead('pack', () => pack);
  for (const op of ['lookalikes', 'knowledge', 'history', 'ciChanges', 'knownErrors', 'resolutionFacts']) fake.onRead(op, () => new Promise(() => {}));
  return fake;
}

const understand = (ui) => ui.$('li[data-group="understand"] > .ab-ins-group-row');
const callerFact = (ui) => ui.$('li[data-group="understand"] li[data-need="caller"]');

test('an Arabic message with an English panel: the message as it was read (dir="auto") and "Translate" with the AI mark', async () => {
  const fake = setup(ARABIC);
  const ui = await mount(<TicketView page={page} eff={effOf()} active />);
  try {
    await settle(6);
    assert.equal(callerFact(ui), null, 'inside the row: folded at first');
    await click(understand(ui));
    const fact = callerFact(ui);
    assert.ok(fact, 'the caller\'s message is one of the first facts');
    assert.match(fact.querySelector('.ab-ins-need-text').textContent, /^The caller wrote, (today|yesterday) \d\d:\d\d$/);
    const said = fact.querySelector('.ab-ins-said-text');
    assert.equal(said.textContent, ARABIC);
    assert.equal(said.getAttribute('dir'), 'auto');
    const translate = fact.querySelector('button.ab-ins-translate');
    assert.ok(translate, 'offered: another script than the panel\'s');
    assert.equal(translate.textContent.trim(), 'Translate');
    assert.ok(translate.querySelector('.ab-ai-badge'), 'the AI mark');
    assert.match(translate.getAttribute('title'), /You see what will be sent first/);
    // The first of the facts, before the urgent ones (the caller wrote last: a customer waiting).
    const ids = ui.$$('li[data-group="understand"] li[data-need]').map((li) => li.getAttribute('data-need'));
    assert.deepEqual(ids, ['caller', 'waiting']);
    assert.equal(fact.querySelector('.ab-dot').getAttribute('class'), 'ab-dot ab-dot-neutral', 'a plain fact: a grey dot, no look needed');
    assert.equal(fake.chrome.storage.session.data[LAUNCH_KEY], undefined, 'nothing asked yet');
    assert.equal(globalThis.fetch.calls.length, 0);
  } finally {
    await ui.unmount();
  }
});

test('"Translate" starts the action in AI Assist the way the bar on the page and All tools do: a launch request, then the check before sending', async () => {
  const fake = setup(ARABIC);
  const eff = effOf();
  const ui = await mount(<TicketView page={page} eff={eff} active />);
  try {
    await settle(6);
    await click(understand(ui));
    await click(callerFact(ui).querySelector('button.ab-ins-translate'));
    // A request in the panel's session storage, which useLaunch takes: the tab, the record and the action; no text, no name.
    const stored = fake.chrome.storage.session.data[LAUNCH_KEY];
    assert.deepEqual(Object.keys(stored).sort(), ['at', 'featureId', 'sysId', 'tabId', 'table']);
    assert.deepEqual([stored.tabId, stored.table, stored.sysId, stored.featureId], [page.tabId, 'incident', SYS, 'translate-message']);
    const launch = freshLaunch(stored, Date.now());
    assert.ok(launch, 'a request the panel takes');
    assert.equal(globalThis.fetch.calls.length, 0, 'Insights sent nothing');
    assert.ok(!fake.readsOf('pack').some((a) => a.feature === 'translate-message'), 'and read nothing for the AI');
    // The panel hands it to the Ticket screen (App.jsx: launch), which runs it exactly as a click in AI Assist would.
    let done = 0;
    await ui.rerender(<TicketView page={page} eff={eff} active launch={launch} onLaunchDone={() => (done += 1)} />);
    await settle(6);
    assert.equal(done, 1, 'used once');
    assert.equal(ui.$('#ab-ticket-half-tab-assist').getAttribute('aria-selected'), 'true', 'AI Assist comes forward');
    assert.ok(fake.readsOf('pack').some((a) => a.feature === 'translate-message'), 'read with its own spec');
    assert.ok(ui.$('[role="dialog"]'), 'the check before sending comes first');
    assert.equal(globalThis.fetch.calls.length, 0, 'nothing sent before the person says so');
  } finally {
    await ui.unmount();
  }
});

test('a message in the panel\'s own script: the message, no "Translate"; AI switched off by the organisation: no "Translate" either', async () => {
  setup(ENGLISH);
  const ui = await mount(<TicketView page={page} eff={effOf()} active />);
  try {
    await settle(6);
    await click(understand(ui));
    assert.equal(callerFact(ui).querySelector('.ab-ins-said-text').textContent, ENGLISH);
    assert.equal(callerFact(ui).querySelector('button.ab-ins-translate'), null);
    assert.ok(ui.$('#ab-ticket-half-panel-insights .ab-ai-badge', { all: true }) === null, 'no AI mark anywhere in Insights then');
  } finally {
    await ui.unmount();
  }
  setup(ARABIC);
  const off = await mount(<TicketView page={page} eff={effOf({}, { aiEnabled: false })} active />);
  try {
    await settle(6);
    await click(understand(off));
    assert.equal(callerFact(off).querySelector('.ab-ins-said-text').textContent, ARABIC);
    assert.equal(callerFact(off).querySelector('button.ab-ins-translate'), null);
  } finally {
    await off.unmount();
  }
});

test('since you last looked: read once when the ticket is shown, "now" kept (sys_id, table, time), the change on the row\'s line', async () => {
  const fake = setup(ARABIC);
  const before = Date.now() - 3 * H;
  await fake.chrome.storage.local.set({ [LAST_VIEWED_KEY]: { v: 1, instances: { [ORIGIN]: { [SYS]: { table: 'incident', at: new Date(before).toISOString() } } } } });
  const ui = await mount(<TicketView page={page} eff={effOf()} active />);
  try {
    await settle(8);
    const line = understand(ui).querySelector('.ab-ins-pain-line').textContent;
    // Without opening it: the change, then the most urgent fact in a few words (the caller wrote last: waiting for a reply).
    assert.equal(line, 'Since you looked: the caller wrote · Customer waiting 1h');
    await click(understand(ui));
    const fact = ui.$('li[data-group="understand"] li[data-need="since"]');
    assert.match(fact.querySelector('.ab-ins-need-text').textContent, /^Since you last looked \((today|yesterday) \d\d:\d\d\)$/);
    assert.equal(fact.querySelector('.ab-ins-need-sub').textContent, '1 message from the caller · not reassigned', 'the field history was read: "not reassigned" is a fact');
    assert.deepEqual(ui.$$('li[data-group="understand"] li[data-need]').map((li) => li.getAttribute('data-need')), ['since', 'caller', 'waiting']);
    assert.equal(fake.readsOf('journey').length, 1, 'the journey\'s own read, shared with the journey card: once');
    // What is kept now: this ticket, now; nothing else about it.
    const kept = fake.chrome.storage.local.data[LAST_VIEWED_KEY];
    assert.deepEqual(Object.keys(kept.instances[ORIGIN][SYS]).sort(), ['at', 'table']);
    assert.ok(Date.parse(kept.instances[ORIGIN][SYS].at) > before);
    assert.ok(!JSON.stringify(kept).includes('INC0010042') && !JSON.stringify(kept).includes('Abel'), 'no number, no name');
    // Drawn again for the same ticket (another language, say): not read again, so the change stays.
    await ui.rerender(<TicketView page={{ ...page }} eff={effOf()} active />);
    await settle(4);
    assert.match(ui.$('li[data-group="understand"] li[data-need="since"] .ab-ins-need-text')?.textContent || '', /^Since you last looked/);
  } finally {
    await ui.unmount();
  }
});

test('the first visit: no "since" fact, the time kept; the organisation turns it off: nothing read, nothing written, nothing said', async () => {
  const fake = setup(ENGLISH);
  const ui = await mount(<TicketView page={page} eff={effOf()} active />);
  try {
    await settle(6);
    await click(understand(ui));
    assert.equal(ui.$('li[data-need="since"]'), null);
    assert.ok(fake.chrome.storage.local.data[LAST_VIEWED_KEY]?.instances?.[ORIGIN]?.[SYS], 'kept for next time');
  } finally {
    await ui.unmount();
  }
  const offFake = setup(ENGLISH);
  const earlier = { v: 1, instances: { [ORIGIN]: { [SYS]: { table: 'incident', at: new Date(Date.now() - 3 * H).toISOString() } } } };
  await offFake.chrome.storage.local.set({ [LAST_VIEWED_KEY]: earlier });
  const off = await mount(<TicketView page={page} eff={effOf({}, { rememberLastViewed: false })} active />);
  try {
    await settle(6);
    await click(understand(off));
    assert.equal(off.$('li[data-need="since"]'), null);
    assert.ok(!/Since you looked/.test(understand(off).textContent));
    assert.deepEqual(offFake.chrome.storage.local.data[LAST_VIEWED_KEY], earlier, 'not written');
  } finally {
    await off.unmount();
  }
});

test('"Clear everything" in Settings removes the stored times: the fact held for the ticket on screen goes too', async () => {
  const fake = setup(ARABIC);
  await fake.chrome.storage.local.set({ [LAST_VIEWED_KEY]: { v: 1, instances: { [ORIGIN]: { [SYS]: { table: 'incident', at: new Date(Date.now() - 3 * H).toISOString() } } } } });
  const ui = await mount(<TicketView page={page} eff={effOf()} active />);
  try {
    await settle(8);
    assert.match(understand(ui).textContent, /Since you looked/);
    await during(() => fake.chrome.storage.local.remove(LAST_VIEWED_KEY));
    await settle(4);
    assert.ok(!/Since you looked/.test(understand(ui).textContent));
  } finally {
    await ui.unmount();
  }
});
