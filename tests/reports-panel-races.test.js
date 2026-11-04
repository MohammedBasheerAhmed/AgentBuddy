import { mount, click, makeChrome, deferred, during, settle, fakeAiFetch } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AiResult } from '../src/sidepanel/reports/aiShared.jsx';
import { CoachingTool } from '../src/sidepanel/reports/CoachingView.jsx';
import { useReport } from '../src/sidepanel/reports/useReport.js';
import { useDashboards } from '../src/sidepanel/reports/hooks.js';
import { renameDashboard } from '../src/reports/dashboards.js';
import { featureById } from '../src/features/registry.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';

// The report and team tools when things happen in another order than planned: a second AI answer after "Show the answer anyway",
// a sample that arrives after another group was chosen, a read that fails after the scope changed, a save that works after one
// that did not.

const page = { tabId: 7, href: 'https://acme.service-now.com/nav_to.do', surface: 'classic', portal: null, record: null, newRecord: null };
const GROUP_A = 'a'.repeat(32);
const GROUP_B = 'b'.repeat(32);
const coachEff = () => ({
  ready: true,
  ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', piiMode: 'strict', previewMode: 'always', profiles: ['it', 'lead'] }, { coachingEnabled: true }),
  apiKey: 'sk-ant-test-0123456789',
  keyLocked: false,
});
const env = { page, tables: ['incident'], blocked: [], myGroups: [{ id: GROUP_A, name: 'Service Desk' }, { id: GROUP_B, name: 'Network Team' }], groupsNote: '' };
const sampleOf = (args) => ({
  ok: true,
  group: { id: args.groupId, name: args.groupName },
  candidates: 5,
  tickets: [
    { number: 'INC0010001', kind: 'incident', closeCode: 'Solved', closeNotes: 'Restarted the VPN client and checked the logs.', comments: [{ when: '2026-10-20 10:00:00', text: 'Hello, the VPN works again.' }] },
    { number: 'INC0010002', kind: 'incident', closeCode: 'Solved', closeNotes: 'Replaced the toner.', comments: [] },
  ],
  notes: [],
  access: [],
});

// Every mounted view is unmounted after its test, failed or not (timers would keep the run alive).
const mounted = [];
const show = async (element) => {
  const ui = await mount(element);
  mounted.push(ui);
  return ui;
};
test.afterEach(async () => {
  while (mounted.length) {
    try {
      await mounted.pop().unmount();
    } catch {
      /* already unmounted by the test */
    }
  }
});

/** Pick the sample of `group`, then write the snapshot and send it after the check. */
async function writeSnapshot(ui, group) {
  await click(ui.button(group));
  await click(ui.button('Pick the sample'));
  await click(ui.button(/Write the coaching snapshot/));
  await settle(6);
  await click(ui.button('Send to AI'));
  await settle(8);
}

test('coaching: an answer that rates people is held back every time, also after "Show the answer anyway" on the one before', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('coachingSample', (args) => sampleOf(args));
  globalThis.fetch = fakeAiFetch((n) => (n === 1 ? 'Ticket INC0010001\nClarity: Strong.\nHere is the ranking of the agents.' : 'Ticket INC0010001\nAgent B scored best on tone.'));
  const ui = await show(<CoachingTool env={env} eff={coachEff()} needs="" bare />);
  await writeSnapshot(ui, 'Service Desk');
  assert.equal(globalThis.fetch.calls.length, 1);
  assert.ok(ui.hasButton('Show the answer anyway'), 'the first answer is held back');
  await click(ui.button('Show the answer anyway'));
  assert.match(ui.text(), /Here is the ranking of the agents\./);
  // Try again: a new answer, which rates a person by a label. It is held back like the first one was.
  await click(ui.button('Try again'));
  await settle(6);
  await click(ui.button('Send to AI'));
  await settle(8);
  assert.equal(globalThis.fetch.calls.length, 2);
  assert.ok(ui.hasButton('Show the answer anyway'), 'the second answer is held back too');
  assert.equal(ui.$('.ab-output'), null, 'its text is not on screen (only the line that was flagged, as a finding)');
  assert.match(ui.text(), /rates a person by a label such as "Agent A": Agent B scored best on tone\./);
  assert.ok(!ui.hasButton('Copy'), 'nothing to copy until the lead chooses to see it');
});

test('the result card: a new answer is a new card, even when no render came between the two answers', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const withhold = { note: 'Held back.', findings: [{ kind: 'ranking', excerpt: 'Here is the ranking.' }] };
  const done = (result) => ({ phase: 'done', busy: false, active: featureById('coaching-snapshot'), result, people: [], lastPack: { table: 'report', sysId: 'coaching' }, again() {}, reset() {} });
  const card = (result) => <AiResult run={done(result)} eff={coachEff()} featureId="coaching-snapshot" heading="Coaching snapshot" withhold={withhold} />;
  const ui = await show(card('Here is the ranking.'));
  await click(ui.button('Show the answer anyway'));
  assert.match(ui.text(), /Here is the ranking\./);
  await ui.rerender(card('Here is the ranking, again.'));
  assert.ok(ui.hasButton('Show the answer anyway'));
  assert.equal(ui.$('.ab-output'), null);
});

test('coaching: a sample still being read for one group is dropped when another group is chosen', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const held = deferred();
  fake.onRead('coachingSample', (args) => (args.groupId === GROUP_A ? held.promise : sampleOf(args)));
  const ui = await show(<CoachingTool env={env} eff={coachEff()} needs="" bare />);
  await click(ui.button('Service Desk'));
  await click(ui.button('Pick the sample'));
  assert.match(ui.text(), /Reading the sample with your session/);
  await click(ui.button('Network Team'));
  await during(() => held.resolve(sampleOf({ groupId: GROUP_A, groupName: 'Service Desk' })));
  const text = ui.text();
  assert.match(text, /Chosen: Network Team/);
  assert.ok(!/Service Desk resolved/.test(text), 'the other group\'s sample is not shown');
  assert.equal(ui.button(/Write the coaching snapshot/).disabled, true, 'and cannot be sent to the AI');
  // The chosen group's own sample still works.
  await click(ui.button('Pick the sample'));
  assert.match(ui.text(), /Network Team resolved 5 tickets/);
  assert.equal(fake.readsOf('coachingSample').length, 2);
});

function ReportProbe({ request, refreshKey = 0 }) {
  const state = useReport({ tabId: 7, request, refreshKey });
  return <p className="probe">{`${state.phase}|${state.result ? state.result.scope : 'none'}`}</p>;
}
const reportRequest = (kind) => ({ kind: 'section', section: 'overview', scope: { kind }, tables: ['incident'], params: {}, blocked: [] });

test('a report read that fails after the scope changed shows no numbers of the old scope; a failed refresh keeps the last ones', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const failing = new Set();
  fake.onRead('reportRun', (args) => {
    if (failing.has(args.scope.kind)) throw new Error('This report could not be read.');
    return { scope: args.scope.kind };
  });
  const ui = await show(<ReportProbe request={reportRequest('mine')} />);
  assert.equal(ui.$('.probe').textContent, 'ready|mine');
  failing.add('groups');
  await ui.rerender(<ReportProbe request={reportRequest('groups')} />);
  assert.equal(ui.$('.probe').textContent, 'error|none', 'My groups failed: Mine\'s numbers are not kept under it');
  // A refresh of the same scope that fails keeps what was read last for it (marked by the error).
  await ui.rerender(<ReportProbe request={reportRequest('mine')} />);
  assert.equal(ui.$('.probe').textContent, 'ready|mine');
  failing.add('mine');
  await ui.rerender(<ReportProbe request={reportRequest('mine')} refreshKey={1} />);
  assert.equal(ui.$('.probe').textContent, 'error|mine');
});

test('dashboards: "could not be saved" goes away once a later change is saved', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const realSet = fake.chrome.storage.local.set;
  let refuse = false;
  fake.chrome.storage.local.set = async (obj) => {
    if (refuse) throw new Error('QUOTA_BYTES quota exceeded');
    return realSet(obj);
  };
  let api = null;
  function Dash() {
    api = useDashboards({ instance: 'https://acme.service-now.com' });
    return <p className="probe">{api.ready ? `saveFailed=${api.saveFailed}` : 'loading'}</p>;
  }
  const ui = await show(<Dash />);
  assert.equal(ui.$('.probe').textContent, 'saveFailed=false');
  refuse = true;
  await during(() => api.update((s) => renameDashboard(s, s.activeId, 'First name')));
  assert.equal(ui.$('.probe').textContent, 'saveFailed=true');
  refuse = false;
  await during(() => api.update((s) => renameDashboard(s, s.activeId, 'Second name')));
  assert.equal(ui.$('.probe').textContent, 'saveFailed=false', 'the newest change is saved: no warning');
});
