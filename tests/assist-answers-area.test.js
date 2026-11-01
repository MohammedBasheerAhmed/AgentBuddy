import { mount, click, settle, focused, makeChrome, fakeAiFetch, fakeClipboard, deferred, during, type, FakeEvent } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { useAnswers, AnswerArea, AskBox, forgetAnswers } from '../src/sidepanel/ticket/assist/answers/index.js';
import { featureById } from '../src/features/registry.js';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { forgetInserts } from '../src/sidepanel/insertFlow.js';

// The answer area driven like a person would (TRACKER.md AI0.4, AI0.5, AI23): several answers per ticket, kept when the agent
// looks at another ticket and comes back, a run that carries on for the ticket it was started on, refine, edit before Insert, the
// question box, errors with their next step, and where the focus goes. Every run goes through the real useRun flow (policy,
// privacy filter, preview decision, a fake provider over fetch, re-hydration).

const SYS = 'a'.repeat(32);
const SYS_B = 'b'.repeat(32);
const ORIGIN = 'https://acme.service-now.com';
const INC = { table: 'incident', sysId: SYS, number: 'INC0010001', kind: 'incident' };
const INC_B = { table: 'incident', sysId: SYS_B, number: 'INC0010002', kind: 'incident' };

const effOf = (values = {}) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', ...values }, {}), apiKey: 'sk-ant-test-0123456789', keyLocked: false });
const pageOf = (record) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/${record.table}.do?sys_id=${record.sysId}`, surface: 'classic', portal: null, record, newRecord: null, user: { name: 'Beth Anglin' } });
const packOf = (record, extra = {}) => ({
  version: 1,
  table: record.table,
  sysId: record.sysId,
  number: record.number,
  kind: record.kind,
  fields: { number: record.number, short_description: 'VPN drops every hour', description: 'Abel Tuter says the VPN drops.' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: {},
  access: [],
  ...extra,
});

function setup({ answer = 'An answer from the AI.', pack = {} } = {}) {
  forgetAnswers();
  forgetInserts();
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch(answer);
  const copied = fakeClipboard();
  fake.onRead('pack', (args) => packOf(args.sysId === SYS_B ? INC_B : INC, pack));
  fake.onRead('insertTargets', (args) => ({ form: 'classic', fields: Object.fromEntries((args.fields || []).map((f) => [f.name, { state: 'ok' }])) }));
  fake.onFill(() => ({ ok: true, method: 'g_form', label: 'Additional comments' }));
  return { fake, copied };
}

// What the lead's TicketAssist draws (src/sidepanel/ticket/TicketAssist.jsx), with two action buttons standing in for the groups.
function Screen({ page, eff }) {
  const assist = useAnswers({ page, eff, record: page.record });
  return (
    <div>
      <AnswerArea assist={assist} page={page} eff={eff} record={page.record} active />
      <AskBox assist={assist} page={page} eff={eff} record={page.record} />
      <button type="button" data-feature="record-summary" disabled={assist.busy} onClick={() => assist.run(featureById('record-summary'))}>Summarise</button>
      <button type="button" data-feature="reply-draft" disabled={assist.busy} onClick={() => assist.run(featureById('reply-draft'))}>Draft reply</button>
    </div>
  );
}

const answers = (ui) => ui.$$('section.ab-answer');
const openAnswers = (ui) => ui.$$('section.ab-answer:not(.is-folded)');
const lastBody = () => globalThis.fetch.calls?.[globalThis.fetch.calls.length - 1]?.body || null;

test('several answers per ticket: the newest is open, the earlier ones fold to one line; Copy leads a summary, Insert a reply', async () => {
  setup({ answer: (n) => (n === 1 ? 'Issue: the VPN drops.' : 'Hi Abel, please restart the client.') });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    assert.equal(answers(ui).length, 1);
    const summary = answers(ui)[0];
    assert.match(summary.textContent, /Summarise this ticket/);
    assert.match(summary.textContent, /AI/, 'the AI mark is on the answer');
    const main = summary.querySelector('.ab-btn-ai');
    assert.equal(main.textContent, 'Copy', 'a summary is a note to self');
    await click(ui.button('Draft reply'));
    await settle(6);
    assert.equal(answers(ui).length, 2);
    assert.equal(openAnswers(ui).length, 1, 'only the newest is open');
    assert.match(openAnswers(ui)[0].textContent, /please restart/);
    assert.match(ui.text(), /Earlier: Summarise this ticket · just now/);
    assert.match(openAnswers(ui)[0].querySelector('.ab-btn-ai').textContent, /customer/i, 'a reply leads with Insert');
    // at most four buttons in the row
    assert.ok(openAnswers(ui)[0].querySelectorAll('.ab-answer-actions > button').length <= 4);
    // the earlier one opens with one click
    await click(ui.$('.ab-answer-fold'));
    assert.equal(openAnswers(ui).length, 2);
  } finally {
    await ui.unmount();
  }
});

test('an answer made without something says so in one line under it ("Made without: ...")', async () => {
  setup({ answer: 'Issue: the VPN drops.', pack: { access: [{ source: 'task_sla', status: 'denied', note: '' }, { source: 'sys_user', status: 'denied', note: '' }] } });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    const line = ui.$('.ab-answer-gaps');
    assert.ok(line, ui.text().slice(0, 300));
    assert.match(line.textContent, /^Made without: SLAs/);
    assert.ok(!/people|sys_user/i.test(line.textContent), 'a people lookup is not worth a line');
  } finally {
    await ui.unmount();
  }
});

test('answers stay with their ticket: another ticket shows none of them, and coming back shows them again', async () => {
  setup({ answer: 'Issue: the VPN drops.' });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    assert.equal(answers(ui).length, 1);
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={effOf()} />);
    assert.equal(answers(ui).length, 0, 'never shown on another ticket');
    assert.equal(ui.$('.ab-output'), null);
    await ui.rerender(<Screen page={pageOf(INC)} eff={effOf()} />);
    assert.equal(answers(ui).length, 1, 'kept in memory for the ticket it was made for');
    assert.match(ui.text(), /Issue: the VPN drops/);
  } finally {
    await ui.unmount();
  }
});

test('a run in flight carries on for its ticket: the answer is kept there, said on the other ticket, never shown or inserted there', async () => {
  const { fake } = setup();
  const held = deferred();
  globalThis.fetch = async (...args) => {
    await held.promise;
    return fakeAiFetch('Answer for the FIRST ticket.')(...args);
  };
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    assert.match(ui.text(), /Waiting for the AI/);
    await ui.rerender(<Screen page={pageOf(INC_B)} eff={effOf()} />);
    assert.ok(!/Waiting for the AI/.test(ui.text()), 'the other ticket is not busy');
    assert.ok(!ui.button('Summarise').disabled, 'its actions can be used');
    assert.match(ui.text(), /INC0010001: answer on its way\./);
    await during(() => held.resolve());
    assert.ok(!/FIRST ticket/.test(ui.text()), 'not shown on the other ticket');
    assert.match(ui.text(), /INC0010001: an answer is ready\./);
    assert.equal(fake.fills().length, 0);
    await ui.rerender(<Screen page={pageOf(INC)} eff={effOf()} />);
    assert.match(ui.text(), /Answer for the FIRST ticket/, 'kept for the ticket it was made for');
    assert.ok(!/an answer is ready/.test(ui.text()));
  } finally {
    await ui.unmount();
  }
});

test('Stop waiting drops the run, and the focus goes back to the action that started it', async () => {
  setup();
  const held = deferred();
  globalThis.fetch = async (...args) => {
    await held.promise;
    return fakeAiFetch('Late answer.')(...args);
  };
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    const start = ui.button('Summarise');
    start.focus();
    await click(start);
    await click(ui.button('Stop waiting'));
    await during(() => held.resolve());
    assert.ok(!/Late answer/.test(ui.text()));
    assert.equal(focused(), ui.button('Summarise'));
  } finally {
    await ui.unmount();
  }
});

test('a new answer takes the focus; Close gives it to the next answer, then back to the action', async () => {
  setup({ answer: (n) => `Answer number ${n}.` });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    assert.ok(focused()?.classList?.contains('ab-answer-toggle') || /ab-answer-toggle/.test(focused()?.className || ''), 'the title of the new answer');
    await click(ui.button('Draft reply'));
    await settle(6);
    await click(openAnswers(ui)[0].querySelector('.ab-answer-close'));
    await settle(3);
    assert.equal(answers(ui).length, 1);
    assert.match(focused()?.className || '', /ab-answer-(toggle|fold)/, 'the next answer');
    assert.equal(openAnswers(ui).length, 1, 'the one left is now the newest, so it is open');
    await click(openAnswers(ui)[0].querySelector('.ab-answer-close'));
    await settle(3);
    assert.equal(answers(ui).length, 0);
    assert.equal(focused(), ui.button('Summarise'), 'back to the action that made it');
  } finally {
    await ui.unmount();
  }
});

test('Ask about this ticket: the question goes out as data (masked), the answer shows it, and nothing can be inserted', async () => {
  setup({ answer: 'Yes, on 29 October.' });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    const box = ui.field(/Ask about this ticket/);
    await type(box, 'Did Abel Tuter already try the new client?');
    await act(async () => {
      box.closest('form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    });
    await settle(6);
    const body = lastBody();
    const [system, user] = [body.system, body.messages?.find((m) => m.role === 'user')];
    const systemText = typeof system === 'string' ? system : JSON.stringify(system);
    const userText = JSON.stringify(user);
    assert.ok(!systemText.includes('new client'), 'not in the prompt');
    assert.match(userText, /Question from the agent/);
    assert.match(userText, /already try the new client/);
    assert.ok(!userText.includes('Abel Tuter'), 'masked');
    assert.match(ui.text(), /Answer to your question/);
    assert.match(ui.text(), /You asked: Did Abel Tuter already try the new client\?/);
    assert.match(ui.text(), /Yes, on 29 October/);
    assert.equal(answers(ui)[0].querySelector('.ab-btn-ai').textContent, 'Copy');
    assert.equal(box.value, '', 'the box is ready for the next question');
  } finally {
    await ui.unmount();
  }
});

test('a question that says nothing is not sent', async () => {
  setup();
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    const box = ui.field(/Ask about this ticket/);
    await type(box, 'why');
    await act(async () => {
      box.closest('form').dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
    });
    await settle(3);
    assert.equal(globalThis.fetch.calls.length, 0);
    assert.match(ui.text(), /Say a little more/);
  } finally {
    await ui.unmount();
  }
});

test('Refine > Shorter rewrites the answer with names masked again; the result is a new answer that still inserts as a reply', async () => {
  const { fake } = setup({ answer: (n) => (n === 1 ? 'Hi Abel Tuter, thanks for trying the new client. Please restart it and tell us if the VPN drops again.' : 'Hi Abel Tuter, please restart the client.') });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Draft reply'));
    await settle(6);
    await click(ui.button(/^Refine/));
    await click(ui.button('Shorter'));
    await settle(6);
    const body = JSON.stringify(lastBody());
    assert.match(body, /Text to rewrite/);
    assert.ok(!body.includes('Abel Tuter'), 'the name the answer got back is masked again');
    assert.equal(answers(ui).length, 2);
    const refined = openAnswers(ui)[0];
    assert.match(refined.textContent, /· Shorter/);
    assert.match(refined.textContent, /please restart the client/);
    await click(refined.querySelector('.ab-btn-ai'));
    const fills = fake.fills();
    assert.equal(fills.length, 1);
    assert.equal(fills[0].field, 'comments', 'still a reply to the customer');
    assert.equal(fills[0].expect?.sysId, SYS, 'into the ticket it was written for');
  } finally {
    await ui.unmount();
  }
});

test('Edit before inserting: the edited text goes in, in the mode chosen, after the review runs on the edited text', async () => {
  const { fake } = setup({ answer: 'Hi Abel, please restart the client.' });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Draft reply'));
    await settle(6);
    await click(ui.button(/^More/));
    await click(ui.button('Edit before inserting'));
    const box = ui.field(/^Text for /);
    assert.equal(box.value, 'Hi Abel, please restart the client.');
    // a password typed into the box is caught before anything is written
    await type(box, 'Hi Abel, your new password is Hunter2Secret!. Please restart.');
    assert.match(ui.text(), /Check this before you insert/);
    await click(ui.button(/^Insert into /));
    assert.equal(fake.fills().length, 0, 'the review stopped it');
    assert.match(ui.text(), /Insert anyway/);
    await click(ui.button('Keep editing'));
    await type(box, 'Hi Abel, please restart the client and tell us how it goes.');
    await click(ui.$('input[type="radio"][value="replace"]'));
    await click(ui.button(/^Replace /));
    const fills = fake.fills();
    assert.equal(fills.length, 1);
    assert.equal(fills[0].value, 'Hi Abel, please restart the client and tell us how it goes.');
    assert.equal(fills[0].mode, 'replace');
    assert.match(ui.text(), /Inserted|Press Save|Save/);
  } finally {
    await ui.unmount();
  }
});

test('an error says what happened and offers the step that can fix it', async () => {
  setup();
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }), headers: { get: () => null } });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf()} />);
  try {
    await click(ui.button('Summarise'));
    await settle(6);
    const note = ui.$('.ab-runerror');
    assert.ok(note, ui.text().slice(0, 200));
    assert.ok(ui.hasButton('Open Settings'), 'a key problem is fixed in Settings');
    assert.ok(!ui.hasButton('Try again'), 'the same key would fail again');
    // a page that does not answer: Try again
    globalThis.fetch = fakeAiFetch('Second time lucky.');
    await click(ui.button('Dismiss'));
    assert.equal(ui.$('.ab-runerror'), null);
  } finally {
    await ui.unmount();
  }
});

test('the check before sending, inside the answer area: ticket data first, then Send; the answer follows', async () => {
  setup({ answer: 'Issue: the VPN drops.' });
  const ui = await mount(<Screen page={pageOf(INC)} eff={effOf({ previewMode: 'always' })} />);
  try {
    await click(ui.button('Summarise'));
    await settle(4);
    assert.ok(ui.$('.ab-dialog'), 'the check comes first');
    assert.equal(globalThis.fetch.calls.length, 0, 'nothing sent yet');
    assert.match(ui.$('.ab-preview').textContent, /^<ticket_data/, 'the ticket data is what shows');
    await click(ui.button('Show the exact text'));
    assert.match(ui.$('.ab-preview').textContent, /^\[system\]/);
    await click(ui.button('Send to AI'));
    await settle(6);
    assert.equal(globalThis.fetch.calls.length, 1);
    assert.match(ui.text(), /Issue: the VPN drops/);
  } finally {
    await ui.unmount();
  }
});
