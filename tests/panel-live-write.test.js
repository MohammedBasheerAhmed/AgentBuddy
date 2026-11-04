import { mount, click, type, choose, settle, focused, makeChrome, fakeAiFetch, fakeClipboard, FakeEvent, document, deferred, during } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { WriteAssist, WriteInsights } from '../src/sidepanel/write/index.js';
import SafeSendCheck from '../src/sidepanel/write/SafeSendCheck.jsx';
import { stillFromForm } from '../src/sidepanel/compose/RewritePanel.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { MSG } from '../src/lib/messages.js';
import { SNIPPETS_KEY } from '../src/lib/storage.js';

// The Write screen driven like a person would (round 3: Insights and AI Assist): a rewrite inserted through the shared insert flow
// (record binding, review, one insert per click), a rewrite not offered for another ticket, "Check my comment" on what was typed,
// organisation snippets, a snippet into a field of choice, a snippet file added, the snippet editor's focus, a blank form opened
// for Notes to ticket, and the way to Settings.

const ORIGIN = 'https://acme.service-now.com';
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const pageOf = (sysId, number, over = {}) => ({ status: 'record', tabId: 7, href: `${ORIGIN}/incident.do?sys_id=${sysId}`, surface: 'classic', portal: null, record: { table: 'incident', sysId, number, kind: 'incident' }, newRecord: null, user: { name: 'Beth Anglin' }, ...over });
const eff = (apiKey = 'sk-ant-test-0123456789', policy = {}) => ({ ready: true, ...effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', previewMode: 'never', profiles: ['it'] }, policy), apiKey, keyLocked: false });

function setup() {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fakeAiFetch('Thanks for waiting. The VPN works again.');
  const copied = fakeClipboard();
  fake.onRead('header', () => ({ number: 'INC0010001', short_description: 'VPN keeps disconnecting', state: 'In Progress', priority: '2 - High' }));
  fake.onRead('pack', (args) => ({
    version: 1,
    table: 'incident',
    sysId: args.sysId,
    number: args.sysId === A ? 'INC0010001' : 'INC0010002',
    kind: 'incident',
    fields: { short_description: 'VPN drops' },
    people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
    journal: [{ when: '2026-10-29 09:00:00', by: 'Beth Anglin', type: 'work_note', text: 'Internal: the finance share for the Q3 restructuring is the cause here.' }],
    related: {},
    access: [],
  }));
  fake.onFill(async () => ({ ok: true, method: 'g_form' }));
  return { fake, copied };
}

async function rewrite(ui) {
  await type(ui.field('Text to rewrite'), 'thx for waiting, vpn is back now');
  await click(ui.button('Shorter'));
  await settle(6);
}

test('the tools name their ticket', async () => {
  setup();
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  assert.match(ui.text(), /For INC0010001 . VPN keeps disconnecting/);
  await ui.unmount();
});

test('a rewrite goes into the form through the shared insert flow: the record it was made for, added below, once', async () => {
  const { fake } = setup();
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await rewrite(ui);
  assert.match(ui.text(), /Thanks for waiting\. The VPN works again\./);
  assert.match(ui.text(), /Goes into: Customer comment of INC0010001/);
  await click(ui.button('Add below'));
  const fills = fake.fills();
  assert.equal(fills.length, 1);
  assert.equal(fills[0].type, MSG.FILL_FIELD);
  assert.equal(fills[0].field, 'comments');
  assert.equal(fills[0].mode, 'append');
  assert.deepEqual(fills[0].expect, { table: 'incident', sysId: A }, 'bound to the record the rewrite was made on');
  assert.equal(ui.button('Inserted').disabled, true, 'the button says it is done and cannot add the text twice');
  await click(ui.button('Inserted', { all: true }));
  assert.equal(fake.fills().length, 1);
  await ui.unmount();
});

test('a rewrite made on one ticket is not offered for another: the buttons are off and the panel says which ticket it is for', async () => {
  const { fake } = setup();
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await rewrite(ui);
  await ui.rerender(<WriteAssist page={pageOf(B, 'INC0010002')} eff={eff()} active />);
  assert.match(ui.text(), /This was written for INC0010001/);
  assert.equal(ui.button('Add below').disabled, true);
  assert.equal(ui.button('Replace what is in the form').disabled, true);
  await click(ui.button('Copy'));
  assert.equal(fake.fills().length, 0, 'Copy works; nothing went into the other ticket');
  await ui.unmount();
});

// (Rewrite and Notes are open sections now, nothing folds them away: what was typed must survive the page moving on instead, as it
// does when "Open a blank incident" changes the tab.)
test('what was typed in Rewrite and Notes survives another record opening in the tab; both stay on screen as sections', async () => {
  setup();
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  assert.deepEqual(ui.$$('[data-card]').map((s) => s.getAttribute('data-card')), ['write-rewrite', 'write-notes']);
  await type(ui.field('Text to rewrite'), 'half a draft');
  await type(ui.field('Rough notes from the call, chat or visit'), 'vpn down since 9');
  await ui.rerender(<WriteAssist page={pageOf(B, 'INC0010002')} eff={eff()} active />);
  assert.equal(ui.field('Text to rewrite').value, 'half a draft');
  assert.equal(ui.field('Rough notes from the call, chat or visit').value, 'vpn down since 9');
  await ui.unmount();
});

test('"Check my comment" checks what was typed in the form: a password, an internal phrase of the organisation, copied work-note words', async () => {
  const { fake } = setup();
  fake.onRead('formValues', (args) => ({ available: true, values: { [args.names[0]]: 'Hi Abel, the finance share for the Q3 restructuring is the cause here. Project Falcon will fix it. Your new password: Winter2026!x' } }));
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff(undefined, { internalPhrases: ['Project Falcon'] })} active />);
  await click(ui.button('Check my comment'));
  assert.deepEqual(fake.readsOf('formValues')[0], { names: ['comments'], expect: { table: 'incident', sysId: A } }, 'only the comment field of this record');
  const text = ui.text();
  assert.match(text, /Your customer comment: check before sending\./);
  assert.match(text, /password, key or token/);
  assert.match(text, /meant to stay internal/, 'the organisation\'s phrase is flagged');
  assert.match(text, /also in an internal work note/);
  assert.ok(!text.includes('Winter2026!x'), 'the finding never shows the value');
  assert.match(text, /Safe-to-send check \d+ to check before sending/, 'the card says it needs a look');
  assert.equal(fake.fills().length, 0, 'a check never writes anything');
  await ui.unmount();
});

test('"Check my comment": a clean comment, an empty field, and a page whose form cannot be read (paste instead)', async () => {
  const { fake } = setup();
  let answer = { available: true, values: { comments: 'Hello Abel, the VPN works again. Please let us know if it drops.' } };
  fake.onRead('formValues', () => answer);
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Check my comment'));
  assert.match(ui.text(), /nothing to worry about found/);
  answer = { available: true, values: { comments: '' } };
  await click(ui.button('Check my comment'));
  assert.match(ui.text(), /The customer comment field is empty/);
  answer = { available: false, values: {} };
  await click(ui.button('Check my comment'));
  assert.match(ui.text(), /cannot read the form on this page/);
  await type(ui.field('Text to check'), 'Call me on +1 555 0134 9988 any time.');
  await click(ui.button('Check this text'));
  assert.match(ui.text(), /The pasted text: check before sending\./);
  await ui.unmount();
});

test('"Check my comment": another field chosen while the comment is read drops that read; the comment\'s findings never show as the other field\'s', async () => {
  const { fake } = setup();
  const held = deferred();
  fake.onRead('formValues', (args) => (args.names[0] === 'comments' ? held.promise : { available: true, values: { [args.names[0]]: 'Restarted the VPN client.' } }));
  const ui = await mount(<SafeSendCheck page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Check my comment'));
  await choose(ui.$('#ab-check-field'), 'close_notes');
  await during(() => held.resolve({ available: true, values: { comments: 'Your new password: Winter2026!x' } }));
  assert.ok(!/check before sending/.test(ui.text()), 'the comment\'s findings are not shown under "Your resolution notes"');
  assert.equal(ui.button('Check my resolution notes').disabled, false, 'the field chosen can be checked at once');
  await click(ui.button('Check my resolution notes'));
  assert.deepEqual(fake.readsOf('formValues').map((a) => a.names), [['comments'], ['close_notes']]);
  assert.match(ui.text(), /Your resolution notes: nothing to worry about found/);
  await ui.unmount();
});

test('Rewrite, "Use what I typed in the form": only from the form of the ticket open here; another form on the page is said, not read', async () => {
  const { fake } = setup();
  fake.onRead('formValues', (args) => (args.expect ? { available: false, values: {}, wrongForm: true } : { available: true, values: { comments: 'thx, vpn is back' } }));
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Use what I typed in the form'));
  assert.deepEqual(fake.readsOf('formValues')[0], { names: ['comments'], expect: { table: 'incident', sysId: A } });
  assert.match(ui.text(), /The form on the page is not INC0010001\. Open that ticket again, or paste the text here\./);
  assert.equal(ui.field('Text to rewrite').value, '', 'nothing was taken');
  await ui.unmount();
  // A blank form has no record to name: the form is read as it is.
  const blank = await mount(<WriteAssist page={pageOf(A, '', { status: 'new-record', href: `${ORIGIN}/incident.do?sys_id=-1`, record: null, newRecord: { table: 'incident' } })} eff={eff()} active />);
  await click(blank.button('Use what I typed in the form'));
  assert.deepEqual(fake.readsOf('formValues')[1], { names: ['comments'] });
  assert.equal(blank.field('Text to rewrite').value, 'thx, vpn is back');
  await blank.unmount();
});

test('Rewrite: text read from a form stays bound to its ticket until it is typed over; then it is the person\'s own text', async () => {
  const { fake } = setup();
  fake.onRead('formValues', () => ({ available: true, values: { comments: 'thx for waiting, vpn is back now' } }));
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Use what I typed in the form'));
  assert.equal(ui.field('Text to rewrite').value, 'thx for waiting, vpn is back now');
  await ui.rerender(<WriteAssist page={pageOf(B, 'INC0010002')} eff={eff()} active />);
  await click(ui.button('Shorter'));
  assert.match(ui.text(), /This text was read from INC0010001\. Open that ticket again, or paste the text here\./);
  assert.equal(globalThis.fetch.calls.length, 0, 'not sent for the other ticket');
  // Edited (a typo corrected): still the first ticket's text, still refused here.
  await type(ui.field('Text to rewrite'), 'thx for waiting, VPN is back now');
  await click(ui.button('Shorter'));
  assert.match(ui.text(), /This text was read from INC0010001\./);
  assert.equal(globalThis.fetch.calls.length, 0, 'an edit does not make it the person\'s own text');
  // Pasted over (never empty in between): it is no longer the form's text.
  await type(ui.field('Text to rewrite'), 'Dear customer, the VPN is back.');
  await click(ui.button('Shorter'));
  await settle(6);
  assert.ok(!/This text was read from/.test(ui.text()));
  assert.equal(globalThis.fetch.calls.length, 1);
  assert.match(ui.text(), /Thanks for waiting\. The VPN works again\./);
  await ui.unmount();
});

test('stillFromForm: an edit anywhere keeps the text bound to the form it was read from; typed over, it is not', () => {
  const read = 'thx for waiting, vpn is back now';
  assert.equal(stillFromForm(read, read), true);
  assert.equal(stillFromForm(read, 'thx for waiting, VPN is back now'), true, 'a word changed in the middle');
  assert.equal(stillFromForm(read, 'Thx for waiting, vpn is back now!'), true, 'the first and the last character changed');
  assert.equal(stillFromForm(read, 'Dear customer, the VPN is back.'), false, 'pasted over');
  assert.equal(stillFromForm(read, ''), false);
  assert.equal(stillFromForm('', 'anything'), false);
  assert.equal(stillFromForm('ok', 'ok then'), true, 'a short text counts as one piece');
});

test('organisation snippets are listed, marked and read-only; a snippet goes into the field chosen', async () => {
  const { fake } = setup();
  const policy = { orgSnippets: [{ title: 'Password reset steps', body: 'Hello {{caller.first_name | there}}, open the portal and choose Reset password.', shortcut: 'pw' }] };
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff(undefined, policy)} active />);
  assert.match(ui.text(), /Snippets 1 snippet · 1 from your organisation/);
  assert.match(ui.text(), /Password reset steps pw From your organisation/);
  await click(ui.$('[data-snippet]'));
  assert.ok(!ui.hasButton('Edit') && !ui.hasButton('Delete'), 'cannot be changed here');
  assert.match(ui.text(), /From your organisation: it cannot be changed here\./);
  const target = ui.field('Insert into');
  assert.deepEqual(target.querySelectorAll('option').map((o) => o.value), ['comments', 'work_notes', 'close_notes', 'description']);
  await choose(target, 'work_notes');
  await click(ui.button('Insert'));
  const fills = fake.fills();
  assert.equal(fills.length, 1);
  assert.equal(fills[0].field, 'work_notes');
  assert.equal(fills[0].label, 'Work notes');
  assert.equal(fills[0].mode, 'append');
  assert.equal(fills[0].value, 'Hello Abel, open the portal and choose Reset password.');
  assert.ok(ui.hasButton('Inserted'));
  await ui.unmount();
});

test('snippets are added from a file: checked, merged, and every skipped entry named; the backup is saved as a file', async () => {
  const { fake } = setup();
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Back up or share'));
  const input = ui.$('#ab-snip-file', { all: true });
  const json = JSON.stringify({ format: 'agent-buddy-snippets', version: 1, snippets: [{ title: 'Greeting', shortcut: 'hi', body: 'Hello {{caller.first_name}}' }, { title: '', body: 'no title' }] });
  const pick = async (file) => {
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    });
    await settle(4);
  };
  await pick({ name: 'notes.txt', size: 10, type: 'text/plain', text: async () => json });
  assert.match(ui.text(), /Choose a \.json file saved by Agent Buddy/);
  await pick({ name: 'agent-buddy-snippets.json', size: json.length + 1, type: 'application/json', text: async () => `${String.fromCharCode(0xfeff)}${json}` });
  assert.match(ui.text(), /Added 1, skipped 1\./);
  assert.match(ui.text(), /Snippet 2: A title is needed\./);
  const stored = (await fake.chrome.storage.local.get(SNIPPETS_KEY))[SNIPPETS_KEY];
  assert.deepEqual(stored.map((s) => s.title), ['Greeting']);
  // Saving a backup hands a JSON file to the browser's download (an <a download> on a blob: address), nothing else.
  const made = [];
  const realUrl = URL.createObjectURL;
  const realElement = document.createElement;
  const clicked = [];
  URL.createObjectURL = (blob) => {
    made.push(blob);
    return 'blob:test';
  };
  // (the small test DOM has no element.remove(); the download link needs it)
  document.createElement = function create(tag) {
    const el = realElement.call(document, tag);
    if (tag === 'a') {
      el.remove = () => el.parentNode?.removeChild(el);
      el.click = () => clicked.push({ href: el.href, download: el.download });
    }
    return el;
  };
  try {
    await click(ui.button('Save to a file'));
  } finally {
    URL.createObjectURL = realUrl;
    document.createElement = realElement;
  }
  assert.equal(clicked.length, 1);
  assert.match(clicked[0].download, /^agent-buddy-snippets-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(made.length, 1);
  assert.match(ui.text(), /Saved 1 snippet to a file/);
  await ui.unmount();
});

test('the snippet editor takes the focus when it opens and gives it back when it closes; "Shortcut" is now "Search word"', async () => {
  setup();
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  // No snippets yet: the empty state says what a snippet is for and offers one step (three examples); "New snippet" is below it.
  assert.match(ui.text(), /No snippets yet\. A snippet is a reply you write once and reuse/);
  assert.ok(ui.hasButton('Add three examples'));
  await click(ui.button('New snippet'));
  assert.equal(focused().id, 'ab-snip-title', 'the focus is in the Title box');
  assert.ok(ui.field('Search word (optional)'));
  await click(ui.button('Cancel'));
  assert.equal(focused().textContent, 'New snippet', 'the focus is back where the editor was opened from');
  await ui.unmount();
});

test('snippets are rows that open in place: the row says it is open, the snippet\'s part is under it, a second click closes it', async () => {
  setup();
  const policy = { orgSnippets: [{ title: 'Password reset steps', body: 'Hello {{caller.first_name | there}},\nopen the portal.', shortcut: 'pw' }] };
  const ui = await mount(<WriteInsights page={pageOf(A, 'INC0010001')} eff={eff(undefined, policy)} active />);
  const row = ui.$('[data-snippet]');
  assert.equal(row.getAttribute('aria-expanded'), 'false');
  assert.match(row.textContent, /Hello \{\{caller\.first_name \| there\}\},$/, 'the row shows the first line of the text');
  await click(row);
  assert.equal(ui.$('[data-snippet]').getAttribute('aria-expanded'), 'true');
  const part = ui.$('[aria-label="Snippet: Password reset steps"]');
  assert.ok(part && part.parentNode === ui.$('[data-snippet]').parentNode, 'the snippet opens under its own row');
  await click(ui.$('[data-snippet]'));
  assert.equal(ui.$('[aria-label="Snippet: Password reset steps"]'), null);
  await ui.unmount();
});

test('Notes to ticket on a saved ticket opens a blank incident form in the same tab', async () => {
  const { fake } = setup();
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff()} active />);
  await click(ui.button('Open a blank incident'));
  assert.deepEqual(fake.updates, [{ tabId: 7, props: { url: `${ORIGIN}/nav_to.do?uri=${encodeURIComponent('incident.do?sys_id=-1')}` } }]);
  assert.match(ui.text(), /The blank form opens in this tab/);
  await ui.unmount();
});

test('without an AI key the AI half says so once and offers the way to Settings', async () => {
  const { fake } = setup();
  const ui = await mount(<WriteAssist page={pageOf(A, 'INC0010001')} eff={eff('')} active />);
  assert.match(ui.text(), /Add an AI key in Settings to use Rewrite and Notes to ticket\./);
  await click(ui.button('Open Settings'));
  assert.equal(fake.optionsOpened, 1);
  await ui.unmount();
});
