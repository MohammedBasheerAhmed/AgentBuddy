import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { BOUNDARY_TEXT } from '../src/sidepanel/ErrorBoundary.jsx';
import { HEADER_DENIED, HEADER_LOADING, HEADER_NO_TITLE, describeHeader, headerPhase } from '../src/sidepanel/recordHeader.js';
import { aiNeeds, aiNeedsText, isAiReady } from '../src/sidepanel/aiReady.js';
import { describeAccess, plainNote, plainSource } from '../src/sidepanel/plainAccess.js';
import { compareLocked, compareStillCurrent, selectionKey } from '../src/sidepanel/knowledge/duplicatesState.js';
import { FOCUSABLE, dialogKeyAction, inertOutside } from '../src/sidepanel/dialogKeys.js';
import PreviewDialog from '../src/sidepanel/PreviewDialog.jsx';
import Notes from '../src/sidepanel/knowledge/Notes.jsx';
import { normalizePolicy } from '../src/policy/policy.js';

// ---- M9: the error boundary --------------------------------------------------------------------------------------------------

test('M9: the boundary draws its children until one of them throws, then a plain message with a way to Settings', () => {
  assert.equal(renderToStaticMarkup(<ErrorBoundary><p>fine</p></ErrorBoundary>), '<p>fine</p>');
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(new Error('boom')), { failed: true });
  const boundary = new ErrorBoundary({ children: <p>fine</p> });
  boundary.state = { failed: true };
  const markup = renderToStaticMarkup(boundary.render());
  assert.ok(markup.includes(BOUNDARY_TEXT));
  assert.equal(BOUNDARY_TEXT, 'Something went wrong in this part of Agent Buddy. Try again, or reload the panel.');
  assert.match(markup, /<button[^>]*>Try again<\/button>/);
  assert.match(markup, /<button[^>]*>Open Settings<\/button>/);
  assert.ok(!markup.includes('fine'), 'the broken part is not drawn again');
});

test('M9: the boundary says nothing about the error (no console output, nothing stored)', () => {
  const boundary = new ErrorBoundary({});
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args);
  try {
    boundary.componentDidCatch(new Error('ticket text: Abel Tuter'), { componentStack: 'at X' });
  } finally {
    console.error = original;
  }
  assert.deepEqual(lines, []);
});

test('M9: a boundary gets another try when its key changes (another record), and only then', () => {
  const boundary = new ErrorBoundary({ resetKey: 'a' });
  const states = [];
  boundary.setState = (next) => states.push(next);
  boundary.state = { failed: true };
  boundary.componentDidUpdate({ resetKey: 'a' });
  assert.deepEqual(states, [], 'same key: stays failed');
  boundary.componentDidUpdate({ resetKey: 'b' });
  assert.deepEqual(states, [{ failed: false }]);
  const fine = new ErrorBoundary({ resetKey: 'x' });
  fine.setState = (next) => states.push(next);
  fine.state = { failed: false };
  fine.componentDidUpdate({ resetKey: 'y' });
  assert.equal(states.length, 1, 'nothing to reset when nothing failed');
});

// ---- M5: the record header ---------------------------------------------------------------------------------------------------

const record = { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001' };

test('M5: loading says so; a refused read says the details are not available; neither stays "Loading…"', () => {
  const loading = describeHeader({ phase: 'loading', header: null }, record);
  assert.equal(loading.title, HEADER_LOADING);
  assert.equal(loading.number, 'INC0010001');
  const denied = describeHeader({ phase: 'failed', header: null }, record);
  assert.equal(denied.title, 'Details are not available to you.');
  assert.equal(denied.titleKind, 'denied');
  assert.equal(denied.number, 'INC0010001', 'the number the page told us is still shown');
  assert.notEqual(denied.title, HEADER_LOADING);
});

test('M5: a ready header shows its title and tags; a blank title is said, not left as "Loading…"', () => {
  const ready = describeHeader({ phase: 'ready', header: { number: 'INC0010001', short_description: 'VPN fails', state: 'In Progress', priority: '2 - High' } }, record);
  assert.equal(ready.title, 'VPN fails');
  assert.deepEqual(ready.tags, ['incident', 'In Progress', '2 - High']);
  const blank = describeHeader({ phase: 'ready', header: { number: 'INC0010001', short_description: '  ', state: '', priority: '' } }, record);
  assert.equal(blank.title, HEADER_NO_TITLE);
  assert.equal(HEADER_NO_TITLE, '(no short description)');
  assert.equal(blank.titleKind, 'missing');
  assert.deepEqual(blank.tags, ['incident']);
});

test('M5: the number falls back to the header, then the table', () => {
  assert.equal(describeHeader({ phase: 'ready', header: { number: 'KB0001' } }, { table: 'kb_knowledge', sysId: 'x' }).number, 'KB0001');
  assert.equal(describeHeader({ phase: 'loading', header: null }, { table: 'kb_knowledge', sysId: 'x' }).number, 'kb_knowledge');
});

test('M5: what the content script answered decides ready or failed: a row of empty columns is "not available to you"', () => {
  assert.equal(headerPhase({ number: 'INC1', short_description: 'x', state: '', priority: '' }), 'ready');
  assert.equal(headerPhase({ number: '', short_description: '', state: 'New', priority: '' }), 'ready');
  assert.equal(headerPhase({ number: '', short_description: '', state: '', priority: '' }), 'failed', 'a 200 with every column blank (an ACL)');
  assert.equal(headerPhase({}), 'failed');
  for (const odd of [null, undefined, 'text', 5]) assert.equal(headerPhase(odd), 'failed');
});

// ---- L5: one answer to "is the AI ready" -------------------------------------------------------------------------------------

const eff = (values = {}, over = {}) => ({ values: { provider: 'anthropic', ...values }, apiKey: '', keyLocked: false, policy: normalizePolicy({}), ...over });

test('L5: a key makes it ready; so does a key the organisation provides', () => {
  assert.equal(isAiReady(eff({}, { apiKey: 'sk-ant-1' })), true);
  assert.equal(isAiReady(eff({ providedApiKey: 'sk-org' })), true);
  assert.equal(isAiReady(eff()), false);
  assert.equal(isAiReady({}), false);
  assert.equal(isAiReady(null), false);
});

test('L5: a provider that needs no key is ready without one: Ollama, and an OpenAI-compatible server on this computer', () => {
  assert.equal(isAiReady(eff({ provider: 'ollama' })), true);
  assert.equal(isAiReady(eff({ provider: 'custom', baseUrls: { custom: 'http://localhost:1234/v1' } })), true, 'LM Studio');
  assert.equal(isAiReady(eff({ provider: 'custom', baseUrls: { custom: 'https://ai.example.com/v1' } })), false, 'a remote server needs its key');
  assert.equal(isAiReady(eff({ provider: 'custom' })), false);
  assert.equal(isAiReady(eff({ provider: 'openai' })), false);
});

test('L5: what to tell the person: unlock, add a key, or nothing', () => {
  assert.equal(aiNeeds(eff({}, { keyLocked: true })), 'unlock');
  assert.equal(aiNeeds(eff()), 'add-key');
  assert.equal(aiNeeds(eff({}, { apiKey: 'k' })), '');
  assert.equal(aiNeedsText(eff({}, { keyLocked: true })), 'Your AI key is locked. Unlock it in Settings.');
  assert.equal(aiNeedsText(eff(), 'these actions'), 'Add an AI key in Settings to use these actions.');
  assert.equal(aiNeedsText(eff({}, { apiKey: 'k' })), '');
});

// ---- L7: no table names in what a person reads -------------------------------------------------------------------------------

test('L7: sources and notes are put into plain words', () => {
  assert.equal(plainSource('kb_use'), 'Article links');
  assert.equal(plainSource('m2m_kb_task'), 'Article links');
  assert.equal(plainSource('task_sla'), 'SLAs');
  assert.equal(plainSource('journal'), 'Notes and comments');
  assert.equal(plainSource('sn_customerservice_case'), 'Customer service cases');
  assert.equal(plainSource('x_acme_widget'), 'Some information', 'a table nobody can act on');
  assert.equal(plainNote('Your user cannot read kb_use.'), 'You cannot read article links.');
  assert.equal(plainNote('kb_use did not apply the filter on this ticket, so it was not used.'), 'Article links did not apply the filter on this ticket, so it was not used.');
  assert.equal(plainNote('Could not read sc_item_option_mtom: HTTP 500'), 'Could not read request answers: HTTP 500');
  assert.equal(plainNote('Your user may not be able to read notes.'), 'You may not be able to read notes.');
});

test('L7: ordinary words that are also table names are left alone inside a sentence', () => {
  const sentence = 'This task has no requested item you can see. The incident could not be read. No chat messages.';
  assert.equal(plainNote(sentence), sentence);
  assert.equal(plainNote(''), '');
  assert.equal(plainNote(undefined), '');
});

test('L7: only what could not be read is listed, as text, with no table names', () => {
  const lines = describeAccess([
    { source: 'kb_use', status: 'denied', note: 'Your user cannot read kb_use.' },
    { source: 'm2m_kb_task', status: 'ok', note: '' },
    { source: 'chat', status: 'empty-or-hidden', note: '<img src=x onerror=alert(1)> No chat messages are available to you.' },
    { source: 'x_acme_widget', status: 'error', note: '' },
    { source: 'journal', status: 'skipped', note: 'not read on purpose' },
    { source: 'sys_journal_field', status: 'blocked', note: 'Your organisation does not allow reading sys_journal_field.' },
  ]);
  assert.deepEqual(lines, [
    'Article links: You cannot read article links.',
    'Chat messages: <img src=x onerror=alert(1)> No chat messages are available to you.',
    'Some information: not available to you.',
    'Notes and comments: Your organisation does not allow reading notes and comments.',
  ]);
  const markup = renderToStaticMarkup(<Notes access={[{ source: 'chat', status: 'empty-or-hidden', note: '<img src=x onerror=alert(1)>' }]} />);
  assert.ok(!markup.includes('<img'), 'shown as text, never as markup');
  assert.deepEqual(describeAccess(undefined), []);
  assert.equal(renderToStaticMarkup(<Notes access={[{ source: 'a', status: 'ok' }]} />), '');
});

// ---- M4: Duplicates, a late answer ---------------------------------------------------------------------------------------------

const picked = (over = {}) => ({ cluster: { id: 'c1' }, selected: new Set(['a', 'b']), phase: 'loading', ...over });

test('M4: the selection key is the group with exactly these articles ticked, in any order', () => {
  assert.equal(selectionKey('c1', ['b', 'a']), selectionKey('c1', new Set(['a', 'b'])));
  assert.notEqual(selectionKey('c1', ['a', 'b']), selectionKey('c2', ['a', 'b']));
  assert.notEqual(selectionKey('c1', ['a', 'b']), selectionKey('c1', ['a', 'b', 'c']));
});

test('M4: an answer is applied only when it is still for this group, these ticks and this request', () => {
  const request = { token: 4, key: selectionKey('c1', ['a', 'b']) };
  assert.equal(compareStillCurrent(request, { token: 4, picked: picked() }), true);
  assert.equal(compareStillCurrent(request, { token: 5, picked: picked() }), false, 'a newer Compare was started');
  assert.equal(compareStillCurrent(request, { token: 4, picked: picked({ selected: new Set(['a']) }) }), false, 'an article was unticked');
  assert.equal(compareStillCurrent(request, { token: 4, picked: picked({ cluster: { id: 'c2' } }) }), false, 'another group was picked');
  assert.equal(compareStillCurrent(request, { token: 4, picked: picked({ phase: 'choosing' }) }), false, 'the ticks were changed after the read began');
  assert.equal(compareStillCurrent(request, { token: 4, picked: null }), false, 'the group was dropped (a new search)');
});

test('M4: while a read is on its way the controls it depends on are off', () => {
  assert.equal(compareLocked(picked()), true);
  assert.equal(compareLocked(picked({ phase: 'choosing' })), false);
  assert.equal(compareLocked(picked({ phase: 'compared' })), false);
  assert.equal(compareLocked(null), false);
});

// ---- L4: the preview dialog ----------------------------------------------------------------------------------------------------

test('L4: Escape cancels; Tab stays inside the dialog and wraps; other keys are left alone', () => {
  assert.deepEqual(dialogKeyAction({ key: 'Escape' }, 3, 1), { type: 'cancel' });
  assert.deepEqual(dialogKeyAction({ key: 'Tab' }, 3, 2), { type: 'focus', index: 0 }, 'after the last comes the first');
  assert.deepEqual(dialogKeyAction({ key: 'Tab' }, 3, 0), { type: 'focus', index: 1 });
  assert.deepEqual(dialogKeyAction({ key: 'Tab', shiftKey: true }, 3, 0), { type: 'focus', index: 2 }, 'before the first comes the last');
  assert.deepEqual(dialogKeyAction({ key: 'Tab', shiftKey: true }, 3, 2), { type: 'focus', index: 1 });
  assert.deepEqual(dialogKeyAction({ key: 'Tab' }, 3, -1), { type: 'focus', index: 0 }, 'focus outside the dialog comes back in');
  assert.deepEqual(dialogKeyAction({ key: 'Tab', shiftKey: true }, 3, -1), { type: 'focus', index: 2 });
  assert.equal(dialogKeyAction({ key: 'Tab' }, 0, -1), null);
  for (const key of ['Enter', ' ', 'a', 'ArrowRight']) assert.equal(dialogKeyAction({ key }, 3, 1), null, key);
  assert.ok(FOCUSABLE.includes('button'));
});

// A tiny stand-in for the DOM: enough to see which elements are made inert and put back.
const el = (name, children = []) => {
  const node = { name, children, parentElement: null, attrs: new Set(), hasAttribute: (a) => node.attrs.has(a), setAttribute: (a) => node.attrs.add(a), removeAttribute: (a) => node.attrs.delete(a) };
  children.forEach((c) => (c.parentElement = node));
  return node;
};

test('L4: everything around the dialog is made inert and put back afterwards; the dialog and its ancestors are not', () => {
  const dialog = el('dialog');
  const pane = el('pane', [el('other-card'), dialog]);
  const hiddenPane = el('hidden-pane');
  const main = el('main', [pane, hiddenPane]);
  const header = el('header');
  const root = el('root', [header, main]);
  const body = el('body', [root]);
  const restore = inertOutside(dialog);
  const names = (nodes) => nodes.filter((n) => n.attrs.has('inert')).map((n) => n.name).sort();
  assert.deepEqual(names([header, main, pane, hiddenPane, root, body, dialog, pane.children[0]]), ['header', 'hidden-pane', 'other-card']);
  restore();
  for (const n of [header, hiddenPane, pane.children[0]]) assert.ok(!n.attrs.has('inert'));
});

test('L4: an element that was already inert is left as it was', () => {
  const dialog = el('dialog');
  const sibling = el('sibling');
  sibling.attrs.add('inert');
  const parent = el('parent', [sibling, dialog]);
  const restore = inertOutside(dialog);
  restore();
  assert.ok(sibling.attrs.has('inert'), 'not ours to clear');
  assert.ok(parent);
});

const prepared = (over = {}) => ({ preview: 'Summarise [PERSON_1]', stats: { counts: { PERSON: 1 } }, ...over });
const dialog = (props) => renderToStaticMarkup(<PreviewDialog feature={{ title: 'Summarise this ticket' }} prepared={prepared()} config={{ provider: 'anthropic', baseUrl: '' }} canSkipNext={false} onSend={() => {}} onCancel={() => {}} {...props} />);

test('L4: the dialog is a labelled modal that takes key presses itself', () => {
  const markup = dialog();
  const title = markup.match(/role="dialog" aria-modal="true" aria-labelledby="(ab-prev-title-[\w-]+)"/)?.[1];
  assert.ok(title && markup.includes(`id="${title}">Check what will be sent</h2>`), 'labelled by its own title');
  assert.match(markup, /class="ab-backdrop" role="presentation" tabindex="-1"/);
  assert.ok(markup.includes('Check what will be sent'));
});

test('SEC-05: a preview that is shown because it includes other tickets says so instead of "you will not be asked again"', () => {
  assert.match(dialog({ canSkipNext: true }), /You will not be asked again for this action\./);
  const always = dialog({ canSkipNext: true, prepared: prepared({ pack: { requirePreview: true } }) });
  assert.ok(!always.includes('not be asked again'));
  assert.match(always, /This one includes other tickets, so you are always asked\./);
  assert.ok(!/asked/.test(dialog({ canSkipNext: false }).replace(/masked/g, '')), 'neither line when it is not the "first" mode');
});

// Found by the end-to-end run (k): with an AI server on this computer a LOCKED saved key was ignored, the actions stayed on, the request
// went out with no Authorization header and the panel said "rejected the API key" instead of "locked".
test('L5: a locked saved key keeps the AI off even for a server that needs no key', () => {
  const local = { provider: 'custom', baseUrls: { custom: 'http://localhost:1234/v1' } };
  assert.equal(isAiReady(eff(local)), true, 'no key saved: the local server is used as it is');
  assert.equal(isAiReady(eff(local, { keyLocked: true })), false, 'a key is saved and locked: unlock it first');
  assert.equal(aiNeeds(eff(local, { keyLocked: true })), 'unlock');
  assert.equal(aiNeedsText(eff(local, { keyLocked: true })), 'Your AI key is locked. Unlock it in Settings.');
  assert.equal(isAiReady(eff({ provider: 'ollama' }, { keyLocked: true })), false);
  // unlocked (the key is there) or provided by the organisation: ready
  assert.equal(isAiReady(eff(local, { keyLocked: true, apiKey: 'k' })), true);
  assert.equal(isAiReady(eff({ ...local, providedApiKey: 'org' }, { keyLocked: true })), true);
});
