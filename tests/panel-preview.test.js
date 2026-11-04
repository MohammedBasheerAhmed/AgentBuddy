import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewDialog, { maskSummary } from '../src/sidepanel/PreviewDialog.jsx';
import { focusToRestore, outsideKeyAction, selectedTextIn, dialogKeyAction } from '../src/sidepanel/dialogKeys.js';
import { maskMessage, startedOnAfter } from '../src/sidepanel/runLogic.js';
import { sendFlow } from '../src/sidepanel/runFlow.js';
import { executeRun, maskMore, prepareRun } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

globalThis.React = React;

// The preview step: "Mask this too", the keys that work before the dialog has the focus, where the focus goes afterwards, the
// record an answer is bound to, and the send step's stop button and notice.

// ---- keys and focus --------------------------------------------------------------------------------------------------------

test('Escape cancels even before the dialog has taken the focus; Tab brings the focus in', () => {
  const visible = { visible: true, inside: false, count: 4 };
  assert.deepEqual(outsideKeyAction({ key: 'Escape' }, visible), { type: 'cancel' });
  assert.deepEqual(outsideKeyAction({ key: 'Tab' }, visible), { type: 'focus', index: 0 });
  assert.deepEqual(outsideKeyAction({ key: 'Tab', shiftKey: true }, visible), { type: 'focus', index: 3 });
  for (const key of ['Enter', 'a', ' ', 'ArrowDown']) assert.equal(outsideKeyAction({ key }, visible), null, key);
});

test('a key is left alone when the dialog is hidden, when it came from inside (handled there), or when it was already handled', () => {
  assert.equal(outsideKeyAction({ key: 'Escape' }, { visible: false, inside: false, count: 4 }), null, 'a preview waiting in a hidden section is not cancelled');
  assert.equal(outsideKeyAction({ key: 'Escape' }, { visible: true, inside: true, count: 4 }), null, 'the dialog handles its own keys');
  assert.equal(outsideKeyAction({ key: 'Escape', defaultPrevented: true }, { visible: true, inside: false, count: 4 }), null);
  assert.equal(outsideKeyAction({ key: 'Tab' }, { visible: true, inside: false, count: 0 }), null);
  // inside, the existing trap still cycles through the controls (the new box and button are among them)
  assert.deepEqual(dialogKeyAction({ key: 'Tab' }, 5, 4), { type: 'focus', index: 0 });
});

test('the focus goes back to the control that opened the dialog, if it is still there and the focus is now nowhere', () => {
  const body = { name: 'body' };
  const opener = { isConnected: true, focus() {} };
  assert.equal(focusToRestore(opener, body, body), opener);
  assert.equal(focusToRestore(opener, null, body), opener);
  assert.equal(focusToRestore(opener, { name: 'another control' }, body), null, 'the person already moved on');
  assert.equal(focusToRestore({ isConnected: false, focus() {} }, body, body), null, 'the button went away');
  assert.equal(focusToRestore(null, body, body), null);
  assert.equal(focusToRestore({ isConnected: true }, body, body), null, 'not focusable');
});

test('the text selected in the preview is taken only when the whole selection is inside it', () => {
  const inner = { name: 'text node' };
  const container = { contains: (n) => n === inner };
  const sel = (over) => ({ isCollapsed: false, rangeCount: 1, anchorNode: inner, focusNode: inner, toString: () => '  Carol Diaz \n', ...over });
  assert.equal(selectedTextIn(container, sel()), 'Carol Diaz');
  assert.equal(selectedTextIn(container, sel({ isCollapsed: true })), '');
  assert.equal(selectedTextIn(container, sel({ rangeCount: 0 })), '');
  assert.equal(selectedTextIn(container, sel({ focusNode: { name: 'outside' } })), '', 'a selection that runs out of the preview');
  assert.equal(selectedTextIn(container, sel({ anchorNode: null })), '');
  assert.equal(selectedTextIn(null, sel()), '');
  assert.equal(selectedTextIn(container, null), '');
  assert.equal(selectedTextIn(container, sel({ toString: () => 'x'.repeat(5000) })).length, 1000, 'capped');
});

// ---- messages --------------------------------------------------------------------------------------------------------------

test('what "Mask" says: plain, short, never the text itself', () => {
  assert.equal(maskMessage({ ok: true, masked: 1 }), 'Masked in 1 place. Read the text again before you send.');
  assert.equal(maskMessage({ ok: true, masked: 3 }), 'Masked in 3 places. Read the text again before you send.');
  for (const problem of ['EMPTY', 'SHORT', 'LONG', 'PLACEHOLDER', 'NOT_FOUND', 'PART_OF_WORD', 'NOT_DATA', 'FAILED', 'GONE']) {
    const text = maskMessage({ ok: false, problem });
    assert.ok(text.length > 10 && text.length < 80, `${problem}: ${text}`);
    assert.ok(!/[[\]{}<>]/.test(text), problem);
  }
  assert.equal(maskMessage({ ok: false, problem: 'WHO_KNOWS' }), maskMessage({ ok: false, problem: 'FAILED' }));
  assert.equal(maskMessage(undefined), maskMessage({ ok: false, problem: 'FAILED' }));
});

// ---- the dialog ------------------------------------------------------------------------------------------------------------

const prepared = (over = {}) => ({ preview: 'Summarise [PERSON_1]', stats: { counts: { PERSON: 1 } }, ...over });
const dialog = (props) => renderToStaticMarkup(<PreviewDialog feature={{ title: 'Summarise this ticket' }} prepared={prepared()} config={{ provider: 'anthropic', baseUrl: '' }} canSkipNext={false} onSend={() => {}} onCancel={() => {}} {...props} />);

test('with onMask the dialog offers "Mask this too": a labelled box, a hint, a button and a status line', () => {
  const markup = dialog({ onMask: () => ({ ok: true, masked: 1 }) });
  // (the ids are the dialog's own, see the test below: the label, the hint and the status line point at this dialog's box)
  const box = markup.match(/<label class="ab-label" for="(ab-mask-text-[\w-]+)">Mask this too<\/label>/)?.[1];
  assert.ok(box, 'a labelled box');
  const described = markup.match(new RegExp(`<input id="${box}" class="ab-input" type="text"[^>]*aria-describedby="(ab-mask-hint-[\\w-]+) (ab-mask-status-[\\w-]+)"`));
  assert.ok(described, 'the box is described by the hint and the status line');
  assert.ok(markup.includes(`id="${described[1]}">Select words above, or type them here. Every place they appear is masked.`));
  assert.match(markup, /<button type="button" class="ab-btn" disabled="">Mask<\/button>/, 'nothing to mask yet');
  assert.ok(markup.includes(`id="${described[2]}" role="status"`));
  assert.match(markup, /mask anything you still see/);
  // narrow panels: the box shrinks and the row and the footer wrap
  assert.match(markup, /min-width:0/);
  assert.match(markup, /class="ab-dialog-foot" style="flex-wrap:wrap"/);
});

test('without onMask there is no box (a caller that cannot re-seal never pretends it can)', () => {
  const markup = dialog();
  assert.ok(!markup.includes('ab-mask-text'));
  assert.ok(!markup.includes('mask anything you still see'));
});

test('two dialogs on the page never share an id, and each one\'s label and descriptions point into itself', () => {
  const one = { feature: { title: 'Summarise this ticket' }, prepared: prepared(), config: { provider: 'anthropic', baseUrl: '' }, canSkipNext: false, onSend: () => {}, onCancel: () => {}, onMask: () => ({}) };
  const markup = renderToStaticMarkup(
    <>
      <PreviewDialog {...one} />
      <PreviewDialog {...one} short others="3 solved tickets" />
    </>
  );
  const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 6, 'full: title, hint, box, status; short: title, its line');
  assert.equal(new Set(ids).size, ids.length, `no id twice: ${ids.join(', ')}`);
  const refs = [...markup.matchAll(/ (?:for|aria-labelledby|aria-describedby)="([^"]+)"/g)].flatMap((m) => m[1].split(' '));
  assert.equal(refs.length, 6, 'full: dialog title, label, hint + status; short: dialog title + line');
  for (const ref of refs) assert.ok(ids.includes(ref), `${ref} points at an element`);
  for (const id of ids) assert.match(id, /^ab-(prev|mask)-[a-z]+-[\w-]+$/, 'usable in a selector (no colons)');
});

test('the dialog shows the sealed request\'s own preview (what Send sends) and counts what the person added', () => {
  const markup = dialog({ prepared: prepared({ preview: 'STALE COPY', request: { preview: 'Exact [MASKED_1] text' }, stats: { counts: { PERSON: 1, MANUAL: 2 } } }), onMask: () => ({}) });
  assert.ok(markup.includes('Exact <span class="ab-ph">[MASKED_1]</span> text'));
  assert.ok(!markup.includes('STALE COPY'));
  assert.match(markup, /masked: 1 name, 2 added by you/);
});

test('what was masked reads as plain English: one, several, nothing', () => {
  assert.equal(maskSummary({ counts: { PERSON: 12, EMAIL: 1, PHONE: 3, EMPLOYEE_ID: 1, CARD: 1, SECRET: 1 } }), '12 names, 1 email address, 3 phone numbers, 1 employee ID, 1 card number, 1 secret');
  assert.equal(maskSummary({ counts: { EMAIL: 2, MANUAL: 1 } }), '2 email addresses, 1 added by you');
  assert.equal(maskSummary({ counts: { WHATEVER: 1 } }), '1 whatever');
  assert.equal(maskSummary({ counts: {} }), 'nothing needed masking');
  assert.equal(maskSummary(null), 'nothing needed masking');
});

// ---- the record an answer is bound to ----------------------------------------------------------------------------------------

test('the record a run is about is taken once, as it starts reading, and kept while the person opens other records', () => {
  let open = 'INC0010001';
  const take = () => ({ number: open });
  let previous = null;
  let current = null;
  const render = (phase) => {
    current = startedOnAfter(previous, phase, current, take);
    previous = phase;
    return current;
  };
  assert.equal(render('idle'), null);
  assert.deepEqual(render('reading'), { number: 'INC0010001' });
  open = 'INC0020002'; // the person opens another record while the ticket is read
  assert.deepEqual(render('reading'), { number: 'INC0010001' }, 'a re-render while reading does not re-bind');
  assert.deepEqual(render('preview'), { number: 'INC0010001' });
  assert.deepEqual(render('sending'), { number: 'INC0010001' });
  assert.deepEqual(render('done'), { number: 'INC0010001' }, 'the answer is for the record it was written for');
  assert.deepEqual(render('reading'), { number: 'INC0020002' }, 'a new run takes the record open now');
  // a panel that mounts while a run is already reading takes it then
  assert.deepEqual(startedOnAfter(null, 'reading', null, take), { number: 'INC0020002' });
});

// ---- the send step: stop and notice ------------------------------------------------------------------------------------------

const PACK = { version: 1, table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident', fields: { short_description: 'VPN fails', description: 'Carol Diaz is affected.' }, people: [], journal: [], related: {}, access: [] };
const values = () => effectiveSettings({ provider: 'anthropic' }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const ready = () => prepareRun({ feature: featureById('record-summary'), pack: PACK, values: values(), policy: normalizePolicy({}), config: config(), createFirewall });

test('sendFlow hands the stop signal to the provider and returns the notice about a cut-short answer', async () => {
  const controller = new AbortController();
  let seen = null;
  const deps = { executeRun, logAudit: async () => {}, sendChat: async (cfg, request, opts) => ((seen = opts.signal), { content: 'Half an answer', truncated: true, stopReason: 'max_tokens' }) };
  const out = await sendFlow({ prepared: ready(), config: config(), values: values(), host: '', previewShown: true, signal: controller.signal, isCurrent: () => true, deps });
  assert.equal(seen, controller.signal);
  assert.equal(out.status, 'done');
  assert.match(out.notice, /cut short/);
  const whole = await sendFlow({ prepared: ready(), config: config(), values: values(), host: '', previewShown: true, isCurrent: () => true, deps: { ...deps, sendChat: async () => ({ content: 'All of it' }) } });
  assert.deepEqual(whole, { status: 'done', text: 'All of it', notice: '' });
});

test('a request the person stopped is abandoned quietly (audited as cancelled), not shown as an error', async () => {
  const audits = [];
  const deps = { executeRun, logAudit: async (e) => audits.push(e), sendChat: async () => { throw Object.assign(new Error('Cancelled. Nothing was sent.'), { code: 'CANCELLED' }); } };
  const out = await sendFlow({ prepared: ready(), config: config(), values: values(), host: '', previewShown: true, isCurrent: () => true, deps });
  assert.deepEqual(out, { status: 'abandoned' });
  assert.equal(audits[0].outcome, 'cancelled');
  const failing = { ...deps, sendChat: async () => { throw Object.assign(new Error('The AI service is busy.'), { code: 'BUSY' }); } };
  const failed = await sendFlow({ prepared: ready(), config: config(), values: values(), host: '', previewShown: true, isCurrent: () => true, deps: failing });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'BUSY');
});

test('Send after "Mask this too" sends the request that was sealed again, with the masked text gone', async () => {
  const first = ready();
  const masked = maskMore(first, 'Carol Diaz');
  assert.equal(masked.ok, true);
  let sent = null;
  const deps = { executeRun, logAudit: async () => {}, sendChat: async (cfg, request) => ((sent = request), { content: 'ok' }) };
  await sendFlow({ prepared: masked.prepared, config: config(), values: values(), host: '', previewShown: true, isCurrent: () => true, deps });
  assert.equal(sent, masked.prepared.request);
  assert.ok(!sent.messages.some((m) => m.content.includes('Carol')));
});
