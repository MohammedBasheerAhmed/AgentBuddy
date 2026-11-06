import { mount, click, settle, makeChrome, fakeAiFetch, fakeClipboard } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { useAnswers, AnswerArea, forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { featureById } from '../src/features/registry.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { forgetInserts } from '../src/sidepanel/insertFlow.js';
import { insightStore } from '../src/sidepanel/ticket/cards/useInsight.js';
import { MSG } from '../src/lib/messages.js';

// "Prepare to close" driven like a person would (round 4, docs/round4.md), through the real answer area and the real useRun flow
// (policy, privacy filter, a fake provider over fetch): one answer with its sections, each saying where it came from; Insert fills
// the close code (by its value) and then the resolution notes, one FILL_FIELD each, never a save; Undo after the Insert puts both
// back, the notes first, and leaves alone a box the agent changed since.

const SYS = 'a'.repeat(32);
const CALLER = 'c'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';
const INC = { table: 'incident', sysId: SYS, number: 'INC0010100', kind: 'incident' };
const AI_NOTES = 'Cause: the VPN profile cache was corrupt.\nFix: cleared the cache and reinstalled the client.\nVerification: the user confirmed the VPN stays up.\nSuggested close code: Workaround';

const effOf = () => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never' }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });
const pageOf = (over = {}) => ({ status: 'record', tabId: 9, href: `${ORIGIN}/incident.do?sys_id=${SYS}`, surface: 'classic', portal: null, record: INC, newRecord: null, formStamp: '500:0', user: { name: 'Beth Anglin' }, ...over });
const fields = { number: INC.number, short_description: 'VPN drops every hour', description: 'Abel Tuter says the VPN drops every hour.', category: 'Network', state: 'In Progress', close_notes: '', close_code: '' };
const pack = (extra = {}) => ({ version: 1, table: 'incident', sysId: SYS, number: INC.number, kind: 'incident', fields, people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: CALLER }], journal: [], related: {}, access: [], ...extra });
const LOOKALIKES = { hits: [1, 2, 3, 4, 5].map((n) => ({ table: 'incident', sysId: `${n}`.repeat(32), number: `INC002000${n}`, short_description: 'VPN drops', close_code: n < 5 ? 'Solved (Work Around)' : 'Solved (Permanently)', close_code_value: n < 5 ? 'workaround' : 'permanent' })), keywords: [], access: [] };
const HISTORY = { items: [{ table: 'incident', sysId: 'e'.repeat(32), number: 'INC0010019', short_description: 'VPN drops every hour again', category: 'Network', state: 'Resolved' }], signals: {}, access: [{ source: 'incident', status: 'ok' }] };

function setup({ form = { close_code: '', close_notes: 'my draft' }, surface = 'classic', fieldStates = { close_notes: 'editable', close_code: 'editable' } } = {}) {
  forgetAnswers();
  forgetInserts();
  insightStore.clear();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch(AI_NOTES);
  const copied = fakeClipboard();
  fake.onRead('pack', () => pack());
  fake.onRead('glance', () => ({ pack: pack(), slas: [], vip: null, outage: null }));
  fake.onRead('resolutionFacts', () => ({ form: null, links: { problem: { status: 'yes' }, knowledge: { status: 'yes' } } }));
  fake.onRead('lookalikes', () => LOOKALIKES);
  fake.onRead('history', () => HISTORY);
  fake.onRead('insertTargets', (args) => ({ form: surface === 'classic' ? 'gform' : surface, match: true, fields: Object.fromEntries((args.fields || []).map((f) => [f.name, { state: fieldStates[f.name] || 'unknown' }])) }));
  // The open form, as the content script answers for it: what each box held before, what it holds after, and Undo's check.
  fake.onFill((message) => {
    if (message.mode === 'undo') {
      if (form[message.field] !== message.current) return { ok: false, reason: 'changed' };
      form[message.field] = message.value;
      return { ok: true, method: 'gform' };
    }
    if (message.field === 'close_code' && surface !== 'classic') return { ok: false, reason: 'choice-by-hand' };
    const previous = form[message.field] ?? '';
    form[message.field] = message.value;
    return { ok: true, method: 'gform', undo: { previous, after: message.value } };
  });
  return { fake, copied, form };
}

function Screen({ page, eff }) {
  const assist = useAnswers({ page, eff, record: page.record });
  return (
    <div>
      <AnswerArea assist={assist} page={page} eff={eff} record={page.record} active />
      <button type="button" data-feature="prepare-close" disabled={assist.busy} onClick={() => assist.run(featureById('prepare-close'))}>Prepare to close</button>
      <button type="button" data-feature="reply-draft" disabled={assist.busy} onClick={() => assist.run(featureById('reply-draft'))}>Draft reply</button>
    </div>
  );
}

const section = (ui, id) => ui.$(`.ab-close-sec[data-section="${id}"]`);
const fills = (fake) => fake.fills().filter((m) => m.type === MSG.FILL_FIELD);

test('one answer with its sections, each saying where it came from; the AI is sent the notes request only', async () => {
  const { fake } = setup();
  const ui = await mount(<Screen page={pageOf()} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    const answer = ui.$('section.ab-answer');
    assert.ok(answer, 'an answer');
    assert.match(answer.textContent, /Prepare to close/);
    assert.deepEqual(ui.$$('.ab-close-sec').map((s) => s.getAttribute('data-section')), ['ready', 'code', 'notes', 'repeat']);
    assert.match(section(ui, 'ready').textContent, /Ready to resolve\?\s*From ServiceNow/);
    assert.match(section(ui, 'ready').textContent, /No close code chosen/);
    assert.match(section(ui, 'code').textContent, /From look-alikes.*Suggested: Solved \(Work Around\)\. 4 of 5 look-alikes used it\./);
    assert.match(section(ui, 'notes').textContent, /Written by your AI/);
    assert.match(section(ui, 'notes').textContent, /cleared the cache and reinstalled the client/);
    assert.doesNotMatch(section(ui, 'notes').textContent, /Suggested close code/, 'the AI\'s own code line is not shown: the code comes from ServiceNow');
    assert.match(section(ui, 'repeat').textContent, /INC0010019 from the same caller is the same issue: link it, or raise a problem if it comes back\./);
    const open = section(ui, 'repeat').querySelector('a[data-ab-link="record"]');
    assert.equal(open.textContent, 'Open INC0010019');
    assert.equal(open.getAttribute('target'), '_blank');
    // the line before Insert, and Insert leads
    assert.match(ui.text(), /Insert fills Close code and Resolution notes on the open form\. Nothing is saved until you press Save\./);
    assert.equal(answer.querySelector('.ab-answer-main').textContent, 'Insert');
    // what the AI was sent: the resolution-notes request, none of the sections
    const body = JSON.stringify(globalThis.fetch.calls[0].body);
    for (const local of ['Solved (Work Around)', 'workaround', 'INC0010019', 'INC0020001', 'look-alike', 'From ServiceNow', 'Ready to resolve', 'No close code chosen']) assert.ok(!body.includes(local), `not sent: ${local}`);
    assert.ok(body.includes('VPN drops every hour'), 'the ticket itself is');
    assert.equal(fills(fake).length, 0, 'nothing filled before the click');
  } finally {
    await ui.unmount();
  }
});

test('Insert: the close code by its value, then the notes; the status names both; Undo puts both back, the notes first', async () => {
  const { fake, form } = setup();
  const ui = await mount(<Screen page={pageOf()} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    assert.deepEqual(fills(fake).map((m) => [m.field, m.value, m.mode]), [
      ['close_code', 'workaround', 'replace'],
      ['close_notes', 'Cause: the VPN profile cache was corrupt.\nFix: cleared the cache and reinstalled the client.\nVerification: the user confirmed the VPN stays up.', 'replace'],
    ]);
    for (const m of fills(fake)) assert.deepEqual(m.expect, { table: 'incident', sysId: SYS });
    assert.match(ui.text(), /Filled Close code and Resolution notes\. Press Save in ServiceNow to keep them\./);
    assert.equal(ui.$('section.ab-answer .ab-answer-main').textContent, 'Inserted');
    await click(ui.button('Undo'));
    await settle(4);
    const undo = fills(fake).slice(2);
    assert.deepEqual(undo.map((m) => [m.mode, m.field, m.value]), [['undo', 'close_notes', 'my draft'], ['undo', 'close_code', '']]);
    assert.deepEqual(form, { close_code: '', close_notes: 'my draft' });
    assert.match(ui.text(), /Undone: Close code and Resolution notes are back to what they were before\. Nothing is saved\./);
    assert.equal(ui.$$('.ab-insert-undo').length, 0, 'Undo is gone once used');
    assert.equal(ui.$('section.ab-answer .ab-answer-main').textContent, 'Insert', 'and Insert can be pressed again');
  } finally {
    await ui.unmount();
  }
});

test('Undo after the agent typed in the notes: the notes are left alone and it says so; the code goes back', async () => {
  const { fake, form } = setup();
  const ui = await mount(<Screen page={pageOf()} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    form.close_notes += '\nCalled the user to confirm.';
    await click(ui.button('Undo'));
    await settle(4);
    assert.match(form.close_notes, /Called the user to confirm\.$/);
    assert.equal(form.close_code, '');
    assert.match(ui.text(), /Resolution notes was changed after the insert, so Agent Buddy cannot undo it safely\./);
    assert.equal(fills(fake).filter((m) => m.mode === 'undo').length, 2);
  } finally {
    await ui.unmount();
  }
});

test('Undo is offered only while the record is open and not saved since; any feature\'s Insert offers it', async () => {
  setup();
  const page = pageOf();
  const ui = await mount(<Screen page={page} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    assert.equal(ui.$$('.ab-insert-undo').length, 1);
    await ui.rerender(<Screen page={{ ...page, formStamp: '900:0' }} eff={effOf()} />);
    assert.equal(ui.$$('.ab-insert-undo').length, 0, 'saved: no Undo');
  } finally {
    await ui.unmount();
  }
});

test('Undo after any Insert: a reply in the customer comment goes back to what was typed there before', async () => {
  const { fake, form } = setup({ form: { comments: 'Hi Abel,' }, fieldStates: { comments: 'editable' } });
  globalThis.fetch = fakeAiFetch('Thanks for waiting: the VPN client is reinstalled. Please try again and tell us if it drops.');
  const ui = await mount(<Screen page={pageOf()} eff={effOf()} />);
  try {
    await click(ui.button('Draft reply'));
    await settle(8);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    assert.equal(fills(fake)[0].field, 'comments');
    assert.match(ui.text(), /Inserted\. Review it\. Then press Save\. Saving sends the comment to the customer\./, 'the single-field line is the one it always was');
    await click(ui.button('Undo'));
    await settle(4);
    assert.deepEqual(fills(fake).slice(1).map((m) => [m.mode, m.field, m.value]), [['undo', 'comments', 'Hi Abel,']]);
    assert.equal(form.comments, 'Hi Abel,');
    assert.match(ui.text(), /Undone: Additional comments is back to what it was before\. Nothing is saved\./);
  } finally {
    await ui.unmount();
  }
});

test('a Workspace: only the notes go in, and the status says which close code to choose by hand', async () => {
  const { fake } = setup({ surface: 'workspace', fieldStates: { close_notes: 'editable' } });
  const ui = await mount(<Screen page={pageOf({ surface: 'workspace', href: `${ORIGIN}/now/sow/record/incident/${SYS}` })} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    assert.match(ui.text(), /Insert fills Resolution notes on the open form\. Nothing is saved until you press Save\. Choose the close code Solved \(Work Around\) yourself\./);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    assert.deepEqual(fills(fake).map((m) => m.field), ['close_notes'], 'the code is never tried there');
    assert.match(ui.text(), /Filled Resolution notes\. Press Save in ServiceNow to keep it\. Choose the close code Solved \(Work Around\) yourself\./);
  } finally {
    await ui.unmount();
  }
});

test('the notes box is not on the page: the answer stays, the notes are copied instead and the panel says why; Copy copies the notes', async () => {
  const { fake, copied } = setup();
  fake.onFill((message) => (message.field === 'close_notes' ? { ok: false, reason: 'no-form' } : { ok: false, reason: 'no-such-choice' }));
  const ui = await mount(<Screen page={pageOf()} eff={effOf()} />);
  try {
    await click(ui.button('Prepare to close'));
    await settle(10);
    await click(ui.$('section.ab-answer .ab-answer-main'));
    await settle(4);
    assert.match(ui.text(), /Agent Buddy could not reach a form field on this page\. Copied to the clipboard instead\./);
    assert.equal(copied.length, 1);
    assert.doesNotMatch(copied[0], /Suggested close code/);
    assert.ok(ui.$('.ab-close-answer'), 'the answer is still there');
    await click(ui.button('Copy'));
    assert.equal(copied[1], copied[0], 'Copy copies the notes Insert would put in the box');
  } finally {
    await ui.unmount();
  }
});
