import { mount, settle, makeChrome, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import TicketView from '../src/sidepanel/ticket/TicketView.jsx';
import TicketInsights from '../src/sidepanel/ticket/TicketInsights.jsx';
import { Glance } from '../src/sidepanel/ticket/cards/index.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import insightOps from '../src/content/ops/insights.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { makeLaunch } from '../src/lib/launch.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { fakeDeps } from './fixtures/sn-fakeDeps.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';

// The Ticket screen is not drawn anew for every record (what was typed and opened stays), so what it holds about a record is kept
// WITH that record's key and is not shown for another one: the header (audit P2.2) and the Insights cards' one-line summaries
// (audit P2.3).

const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';
const eff = { ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, profiles: ['it'], profilesConfirmed: true }, {}), apiKey: '', keyLocked: false };
const pageOf = (sysId) => ({
  status: 'record',
  tabId: 7,
  href: `${ORIGIN}/incident.do?sys_id=${sysId}`,
  surface: 'classic',
  portal: null,
  record: { table: 'incident', sysId, number: sysId === SYS ? 'INC0010001' : 'INC0010002', kind: 'incident' },
  newRecord: null,
  user: { name: 'Beth Anglin' },
});
const headerOf = (sysId, state = 'In Progress') => ({ number: sysId === SYS ? 'INC0010001' : 'INC0010002', short_description: sysId === SYS ? 'TITLE OF A' : 'TITLE OF B', state, priority: '3 - Moderate' });

// ---- the header (P2.2) -------------------------------------------------------------------------------------------------------

test('the header read again when the screen comes back (ticket A) answers after the tab moved to B: B keeps its own header', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  let slowA = null;
  fake.onRead('header', (args) => (args.sysId === SYS && slowA ? slowA.promise.then(() => headerOf(SYS)) : headerOf(args.sysId)));
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  const ui = await mount(<TicketView page={pageOf(SYS)} eff={eff} active={false} />);
  try {
    assert.match(ui.text(), /TITLE OF A/);
    shift = 61000; // the person was on another screen for a minute
    slowA = deferred();
    await ui.rerender(<TicketView page={pageOf(SYS)} eff={eff} active />); // back: A's header is read again (slowly)
    assert.equal(fake.readsOf('header').length, 2);
    await ui.rerender(<TicketView page={pageOf(SYS_B)} eff={eff} active />); // meanwhile the tab moved on to B
    await settle();
    assert.match(ui.text(), /TITLE OF B/);
    await during(async () => slowA.resolve()); // A's answer comes in late
    assert.match(ui.text(), /TITLE OF B/, 'B keeps its own header');
    assert.ok(!/TITLE OF A/.test(ui.text()));
  } finally {
    Date.now = realNow;
    await ui.unmount();
  }
});

test('before its own header has answered, a new record shows "Loading…", not the last record\'s header', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const slowB = deferred();
  fake.onRead('header', (args) => (args.sysId === SYS ? headerOf(SYS) : slowB.promise.then(() => headerOf(SYS_B))));
  const ui = await mount(<TicketView page={pageOf(SYS)} eff={eff} />);
  try {
    assert.match(ui.text(), /TITLE OF A/);
    await ui.rerender(<TicketView page={pageOf(SYS_B)} eff={eff} />);
    assert.ok(!/TITLE OF A/.test(ui.text()), 'A\'s title is gone');
    assert.match(ui.text(), /Loading…/);
    await during(async () => slowB.resolve());
    assert.match(ui.text(), /TITLE OF B/);
  } finally {
    await ui.unmount();
  }
});

test('an action asked for on B right as the tab moves from A to B is checked against B, not against A\'s header', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  // A is closed (no reply on a closed ticket), B is being worked on.
  fake.onRead('header', (args) => headerOf(args.sysId, args.sysId === SYS ? 'Closed' : 'In Progress'));
  let done = 0;
  const onLaunchDone = () => (done += 1);
  const ui = await mount(<TicketView page={pageOf(SYS)} eff={eff} onLaunchDone={onLaunchDone} />);
  try {
    assert.match(ui.text(), /Closed/);
    const launch = makeLaunch({ tabId: 7, table: 'incident', sysId: SYS_B, featureId: 'reply-draft', now: Date.now() });
    await ui.rerender(<TicketView page={pageOf(SYS_B)} eff={eff} launch={launch} onLaunchDone={onLaunchDone} />);
    assert.equal(done, 1, 'the request was taken');
    assert.ok(!/That action is not available for this record/.test(ui.text()), 'not refused because A is closed');
    // (This test has no AI key: the action is offered, and the note asks for the AI to be set up.)
    assert.match(ui.$('.ab-note-warn[role="status"]')?.textContent || '', /AI/);
  } finally {
    await ui.unmount();
  }
});

// ---- the Insights summaries (P2.3) -----------------------------------------------------------------------------------------------

const record = { table: 'incident', sysId: INCIDENT_ID, number: 'INC0010001', kind: 'incident' };
const page = { status: 'record', tabId: 501, href: `${ORIGIN}/incident.do?sys_id=${INCIDENT_ID}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } };
const header = { number: 'INC0010001', short_description: 'VPN', state: 'In Progress', priority: '2 - High' };
const deps = () => Object.assign(fakeDeps(buildInstance()), { now: () => Date.UTC(2026, 9, 26, 12) });

async function insightsChrome() {
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const answer = await insightOps.glance({ table: 'incident', sysId: INCIDENT_ID }, { deps: deps(), checkRecord, checkPack });
  fake.onRead('glance', (args) => (args.sysId === INCIDENT_ID ? answer : new Promise(() => {})));
  for (const op of ['lookalikes', 'knowledge', 'history', 'journey', 'ciChanges', 'knownErrors', 'pack', 'resolutionFacts']) fake.onRead(op, () => new Promise(() => {}));
  return fake;
}

const summaryOf = (ui, id) => ui.container.querySelector(`[data-card="${id}"] .ab-ins-card-summary`)?.textContent || '';

test('Insights opened after the Glance has read the facts (AI Assist was the half on show): the folded cards keep their summary', async () => {
  await insightsChrome();
  const glance = await mount(<Glance page={page} eff={eff} record={record} header={header} headPhase="ready" />);
  await settle(6);
  const ui = await mount(<TicketInsights page={page} eff={eff} record={record} header={header} active />);
  await settle(6);
  try {
    assert.ok(summaryOf(ui, 'risk'), 'the risk card reported its summary from memory, and it stayed');
    assert.ok(summaryOf(ui, 'missing'));
  } finally {
    await ui.unmount();
    await glance.unmount();
  }
});

test('another record: the last record\'s summaries are not shown on it', async () => {
  await insightsChrome();
  const ui = await mount(<TicketInsights page={page} eff={eff} record={record} header={header} active />);
  await settle(6);
  try {
    assert.ok(summaryOf(ui, 'risk'));
    const other = { ...record, sysId: SYS_B, number: 'INC0010002' };
    await ui.rerender(<TicketInsights page={{ ...page, href: `${ORIGIN}/incident.do?sys_id=${SYS_B}`, record: other }} eff={eff} record={other} header={{ ...header, number: 'INC0010002' }} active />);
    await settle(6);
    assert.equal(summaryOf(ui, 'risk'), '', 'B has not been read (its glance never answers here): nothing, not A\'s line');
    assert.equal(summaryOf(ui, 'missing'), '');
  } finally {
    await ui.unmount();
  }
});
