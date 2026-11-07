import { mount, click, settle, makeChrome, fakeAiFetch, fakeClipboard, type } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { useAnswers, AnswerArea, forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import RunPanel from '../src/sidepanel/RunPanel.jsx';
import { useRun } from '../src/sidepanel/useRun.js';
import { previewKey } from '../src/sidepanel/PreviewDialog.jsx';
import { featureById } from '../src/features/registry.js';
import { DEFAULT_SETTINGS, effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { forgetInserts } from '../src/sidepanel/insertFlow.js';
import { createFirewall } from '../src/pii/index.js';
import { maskMore, prepareRun } from '../src/lib/pipeline.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { AUDIT_KEY } from '../src/audit/auditLog.js';

// The check before sending belongs to ONE run (audit P1.22, P2.6). The answer area stays on screen from ticket to ticket and every
// ticket's run can have its preview waiting, so without a dialog per run the view and the "Mask this too" box of one ticket's check
// showed up on another's: a first-time full check on ticket A drew as B's short one-liner (and Send recorded it as not shown), and
// what was typed on B stood in A's box.

const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';
const INC = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' };
const INC_B = { table: 'incident', sysId: SYS_B, number: 'INC0010002', kind: 'incident' };
const NBA = featureById('next-best-action');

const effOf = (values = {}) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', ...values }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });
const pageOf = (record) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/${record.table}.do?sys_id=${record.sysId}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const packOf = (record) => ({
  version: 1,
  table: record.table,
  sysId: record.sysId,
  number: record.number,
  kind: record.kind,
  fields: { number: record.number, short_description: `VPN drops on ${record.number}`, description: 'Abel Tuter says the VPN drops.' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: {},
  access: [],
});

function setup() {
  forgetAnswers();
  forgetInserts();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Issue: the VPN drops.');
  fakeClipboard();
  fake.onRead('pack', (args) => packOf(args.sysId === SYS_B ? INC_B : INC));
  // look-alike solved tickets for "Next best actions": the check after the first time is the short one
  fake.onRead('similar', () => ({ hits: [1, 2, 3].map((i) => ({ number: `INC000964${i}`, short_description: 'VPN drops', close_notes: 'Replaced the client.', why: ['same words'], people: [] })) }));
  fake.onRead('knowledge', () => ({ hits: [] }));
  return fake;
}

function Screen({ page, eff }) {
  const assist = useAnswers({ page, eff, record: page.record });
  return (
    <div>
      <AnswerArea assist={assist} page={page} eff={eff} record={page.record} active />
      <button type="button" disabled={assist.busy} onClick={() => assist.run(featureById('record-summary'))}>Summarise</button>
      <button type="button" disabled={assist.busy} onClick={() => assist.run(NBA)}>Next best</button>
    </div>
  );
}

const maskBox = (ui) => ui.$('input.ab-input[id^="ab-mask-text-"]');
// The ticket data as the check shows it first (the readable view; the exact text is folded under "Show the exact text").
const sentView = (ui) => ui.$('.ab-sent');

// Both tickets have a check waiting: going from one to the other is where one dialog used to serve both.
test('a first-time full check on ticket A, met again after B\'s short one, is the full check and is audited as shown', async () => {
  const fake = setup();
  const eff = effOf({ previewMode: 'first', previewSeen: [NBA.previewGroup || NBA.id] });
  const ui = await mount(<Screen page={pageOf(INC)} eff={eff} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    assert.match(ui.text(), /Check before sending/, 'A: the full check, the first time');
    // the agent opens ticket B while A's check waits, and asks for next best actions: the short check
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={eff} />);
    await click(ui.button('Next best'));
    await settle(6);
    assert.match(ui.text(), /Send to the AI\?/, 'B: the short check');
    assert.match(ui.text(), /Uses 3 solved tickets from other tickets/);
    // back on A
    await ui.rerender(<Screen page={pageOf(INC)} eff={eff} />);
    assert.match(ui.text(), /Check before sending/, 'A: still the full check');
    assert.ok(!/Send to the AI\?|from other tickets/.test(ui.text()), 'not B\'s one-liner');
    assert.match(sentView(ui).textContent, /INC0010001/, 'A\'s data');
    await click(ui.button('Send to AI'));
    await settle(6);
    const log = fake.chrome.storage.local.data[AUDIT_KEY] || [];
    const sent = log.filter((e) => e.feature === 'record-summary' && e.outcome === 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].preview, 'shown', 'the person saw the full text');
    // and B: its own short check, still waiting
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={eff} />);
    assert.match(ui.text(), /Uses 3 solved tickets from other tickets/);
  } finally {
    await ui.unmount();
  }
});

test('what was typed in B\'s "Hide something else" box never shows in A\'s check, and what one check said stays with it', async () => {
  setup();
  const eff = effOf({ previewMode: 'always' });
  const ui = await mount(<Screen page={pageOf(INC)} eff={eff} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    assert.match(sentView(ui).textContent, /INC0010001/);
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={eff} />);
    await click(ui.button('Summarise'));
    await settle(6);
    assert.match(sentView(ui).textContent, /INC0010002/);
    await type(maskBox(ui), 'typed on B');
    await click(ui.button('Show the exact text'));
    assert.ok(ui.$('pre.ab-preview-exact'), 'B: the exact text');
    assert.match(ui.$('pre.ab-preview').textContent, /^\[system\][\s\S]*INC0010002/, 'B: the request character for character');
    // back on A, whose check was waiting
    await ui.rerender(<Screen page={pageOf(INC)} eff={eff} />);
    assert.equal(maskBox(ui).value, '', 'A\'s box is empty');
    assert.ok(sentView(ui) && !ui.$('pre.ab-preview-exact'), 'A shows the ticket data first, not where B was left');
    assert.match(sentView(ui).textContent, /INC0010001/);
    // "Hide something else" on A: the same run sealed again keeps its dialog (what it said stays), and the hidden text is gone
    await type(maskBox(ui), 'VPN drops on INC0010001');
    await click(ui.button('Hide'));
    assert.match(ui.text(), /Masked in 1 place/);
    assert.equal(maskBox(ui).value, '');
    assert.ok(!sentView(ui).textContent.includes('VPN drops on INC0010001'));
    assert.match(sentView(ui).textContent, /Hidden 1/, 'what the person hid is a chip like the others');
    await click(ui.button('Show the exact text'));
    assert.ok(!ui.$('pre.ab-preview').textContent.includes('VPN drops on INC0010001') && /\[MASKED_1\]/.test(ui.$('pre.ab-preview').textContent), 'and gone from the exact text');
    // B's check: nothing of A's in it
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={eff} />);
    assert.ok(!/Masked in 1 place/.test(ui.text()), 'A\'s status is not shown on B');
    assert.match(sentView(ui).textContent, /INC0010002/);
  } finally {
    await ui.unmount();
  }
});

test('the dialog\'s key: one per prepared run, the same after "Mask this too", another for the next run', () => {
  const e = effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', piiMode: 'standard' }, normalizePolicy({}));
  const prepare = () => prepareRun({ feature: featureById('record-summary'), pack: packOf(INC), values: e.values, policy: e.policy, config: resolveProviderConfig(e.values, 'sk-ant-test'), createFirewall });
  const first = prepare();
  const masked = maskMore(first, 'VPN drops');
  assert.equal(masked.ok, true);
  assert.equal(previewKey(masked.prepared), previewKey(first), 'the same run sealed again');
  assert.notEqual(previewKey(prepare()), previewKey(first), 'a new run');
  assert.equal(previewKey(null), 'preview');
  const plain = { preview: 'x' };
  assert.equal(previewKey(plain), previewKey(plain));
});

function RunScreen({ page, eff }) {
  const run = useRun({ page, eff, record: page.record });
  return (
    <div>
      <RunPanel run={run} eff={eff} page={page} />
      <button type="button" disabled={run.busy} onClick={() => run.run(featureById('record-summary'))}>Summarise</button>
    </div>
  );
}

test('RunPanel: a new run opens a new check, never the last one\'s box', async () => {
  setup();
  const eff = effOf({ previewMode: 'always' });
  const ui = await mount(<RunScreen page={pageOf(INC)} eff={eff} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    await type(maskBox(ui), 'left behind');
    await click(ui.button('Cancel'));
    await settle(6);
    await click(ui.button('Summarise'));
    await settle(6);
    assert.match(ui.text(), /Check before sending/);
    assert.equal(maskBox(ui).value, '');
  } finally {
    await ui.unmount();
  }
});
