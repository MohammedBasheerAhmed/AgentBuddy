import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewDialog from '../src/sidepanel/PreviewDialog.jsx';
import { destinationOf, fieldRows, hiddenCounts, maskedPieces, noteOf, parseSent, sectionTexts, selectionTouches } from '../src/sidepanel/previewView.js';
import { splitPreview } from '../src/sidepanel/runLogic.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall } from '../src/pii/index.js';
import { maskMore, prepareRun } from '../src/lib/pipeline.js';
import { effectiveSettings, normalizePolicy, DEFAULT_SETTINGS } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

// The check before sending, as a person reads it (the redesign): the ticket data cut into the blocks the firewall built, the record's
// fields as lines, the notes as messages, every placeholder a chip. It only DRAWS the text of the request: what is sent is the sealed
// request (shown character for character under "Show the exact text"), and nothing of it may be missing from the view.

const SYS = 'a'.repeat(32);
const pack = {
  version: 1,
  table: 'incident',
  sysId: SYS,
  number: 'INC0010001',
  kind: 'incident',
  fields: {
    number: 'INC0010001',
    short_description: 'VPN keeps disconnecting for Abel Tuter',
    description: 'Hi, my VPN drops every 10 minutes since Monday.\nPlease call me on +1 555 201 7788. Use <b>bold</b> if needed.',
    state: 'In Progress',
  },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }, { role: 'assignee', name: 'Beth Anglin' }],
  journal: [
    { type: 'comment', when: '2026-10-26 07:58:03', by: 'Abel Tuter', text: 'It dropped again at 09:50. Same as yesterday.' },
    { type: 'work_note', when: '2026-10-26 08:25:00', by: 'Beth Anglin', text: 'Gateway EU-2 shows 14 session resets.\nChecking the certificate.' },
    { type: 'comment', when: '2026-10-26 09:30:00', by: 'Abel Tuter', text: 'The password: Welcome12! still fails, mail abel.tuter@example.com' },
  ],
  related: {},
  access: [],
};
const e = effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', piiMode: 'standard' }, normalizePolicy({}));
const prepare = (feature = 'record-summary', p = pack) => prepareRun({ feature: featureById(feature), pack: p, values: e.values, policy: e.policy, config: resolveProviderConfig(e.values, 'sk-ant-test'), createFirewall });

// What the view shows, as one text, against the request's ticket data without the wrappers (and the blank lines between blocks).
const shownText = (sections) => sections.flatMap(sectionTexts).join('');
const bare = (data) =>
  data
    .replace(/<ticket_data field="([^"\n]*)"(?: label="([^"\n]*)")?>\n([\s\S]*?)\n<\/ticket_data>/g, (all, field, label = '', body) => `${label}${body}`)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, '');

test('a real request reads as sections: the fields, the long text under its label, the notes as messages, the task', () => {
  const split = splitPreview(prepare());
  assert.equal(split.ok, true);
  const { whole, sections } = parseSent(split.data);
  assert.equal(whole, false);
  const kinds = sections.map((s) => s.kind);
  assert.equal(kinds[0], 'fields', 'the record\'s short columns come first, as sent');
  assert.ok(kinds.includes('notes'));
  assert.equal(kinds[kinds.length - 1], 'task', 'the instruction after the last block');
  const fields = sections[0].rows;
  assert.deepEqual(fields.find((r) => r.label === 'Number'), { label: 'Number', value: 'INC0010001' });
  assert.match(fields.find((r) => r.label === 'Short description').value, /^VPN keeps disconnecting for \[PERSON_1\]$/);
  // the description has two lines, so it has a block of its own, with its label, and its angle brackets as they were written
  const description = sections.find((s) => s.kind === 'block' && s.label === 'Description');
  assert.ok(description, kinds.join(','));
  assert.match(description.text, /\[PHONE_1\]/);
  assert.match(description.text, /<b>bold<\/b>/);
  // three notes in a row are one list, in the order sent, each with its time, its author (a chip) and its text
  const notes = sections.filter((s) => s.kind === 'notes');
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].items.map((n) => [n.field, n.when, n.by]), [
    ['comments', '2026-10-26 07:58:03', '[PERSON_1]'],
    ['work_notes', '2026-10-26 08:25:00', '[PERSON_2]'],
    ['comments', '2026-10-26 09:30:00', '[PERSON_1]'],
  ]);
  assert.match(notes[0].items[1].text, /^Gateway EU-2 shows 14 session resets\.\nChecking the certificate\.$/);
  assert.match(notes[0].items[2].text, /\[SECRET_1\][\s\S]*\[EMAIL_1\]/);
  // nothing of the request is missing from the view, and no real value is in it
  assert.equal(shownText(sections).replace(/\s+/g, ''), bare(split.data));
  for (const real of ['Abel', 'Tuter', 'Beth', 'Anglin', 'Welcome12', 'abel.tuter@example.com', '201 7788']) assert.ok(!shownText(sections).includes(real), real);
});

test('the view follows the request sealed again after "Hide something else"', () => {
  const first = prepare();
  const hidden = maskMore(first, 'session resets');
  assert.equal(hidden.ok, true);
  const { sections } = parseSent(splitPreview(hidden.prepared).data);
  const text = shownText(sections);
  assert.ok(!text.includes('session resets'));
  assert.match(text, /shows 14 \[MASKED_1\]\./);
});

test('a text with no block is shown whole; text between blocks is kept; only blank lines between blocks are not drawn', () => {
  assert.deepEqual(parseSent('Rewrite this: [PERSON_1] is late.'), { whole: true, sections: [{ kind: 'text', text: 'Rewrite this: [PERSON_1] is late.' }] });
  assert.deepEqual(parseSent(''), { whole: true, sections: [] });
  assert.deepEqual(parseSent(null), { whole: true, sections: [] });
  const data = 'Before\n\n<ticket_data field="text" label="Question from the agent">\nWhy?\n</ticket_data>\n\nBetween\n\n<ticket_data field="sla">\n- P2 &lt;8h&gt;\n</ticket_data>\n\nSummarise it.';
  assert.deepEqual(parseSent(data).sections, [
    { kind: 'text', text: 'Before' },
    { kind: 'block', field: 'text', label: 'Question from the agent', text: 'Why?' },
    { kind: 'text', text: 'Between' },
    { kind: 'block', field: 'sla', label: '', text: '- P2 <8h>' },
    { kind: 'task', text: 'Summarise it.' },
  ]);
  // a block that is not closed is not a block: its text stays, as text
  const open = '<ticket_data field="fields">\nNumber: INC1\n</ticket_data>\n\n<ticket_data field="description">\nno end';
  const cut = parseSent(open).sections;
  assert.equal(cut[0].kind, 'fields');
  assert.deepEqual(cut[1], { kind: 'task', text: '<ticket_data field="description">\nno end' });
});

test('fields and notes: read when they are written as the firewall writes them, else shown whole', () => {
  assert.deepEqual(fieldRows('Number: INC1\nTitle: VPN: down\nno label here\n: starts with a colon'), [
    { label: 'Number', value: 'INC1' },
    { label: 'Title', value: 'VPN: down' },
    { label: '', value: 'no label here' },
    { label: '', value: ': starts with a colon' },
  ]);
  assert.deepEqual(noteOf('[2026-10-26 07:58:03] [PERSON_1]: It dropped: again.'), { when: '2026-10-26 07:58:03', by: '[PERSON_1]', text: 'It dropped: again.' });
  assert.deepEqual(noteOf('[] Unknown: hello'), { when: '', by: 'Unknown', text: 'hello' });
  assert.equal(noteOf('Just a note without an author'), null);
  assert.equal(noteOf('[[DOB_1]] [PERSON_1]: x'), null, 'an odd time is not taken apart');
  const notes = parseSent('<ticket_data field="comments" label="Customer-visible comment">\nplain text, no author\n</ticket_data>').sections;
  assert.deepEqual(notes, [{ kind: 'notes', items: [{ field: 'comments', label: 'Customer-visible comment', when: '', by: '', text: 'plain text, no author' }] }]);
});

test('placeholders are cut out of a text exactly; look-alikes from ticket text are not', () => {
  assert.deepEqual(maskedPieces('Hi [PERSON_1], mail [EMAIL_12] (PERSON_2) [lower_1] [MASKED_1]'), [
    { text: 'Hi ' },
    { token: '[PERSON_1]', label: 'PERSON', n: 1 },
    { text: ', mail ' },
    { token: '[EMAIL_12]', label: 'EMAIL', n: 12 },
    { text: ' (PERSON_2) [lower_1] ' },
    { token: '[MASKED_1]', label: 'MASKED', n: 1 },
  ]);
  assert.deepEqual(maskedPieces(''), []);
  const s = 'a [CARD_1] b [SECRET_2]';
  assert.equal(maskedPieces(s).map((p) => p.token || p.text).join(''), s);
});

test('the counts for the chips: above 0 only, kinds that read the same added up, numbers only', () => {
  assert.deepEqual(hiddenCounts({ counts: { PERSON: 12, EMAIL: 0, NATIONAL_ID: 1, ID: 1, URL_CREDENTIALS: 2, SECRET: 1 } }), [
    { kind: 'PERSON', n: 12 },
    { kind: 'ID', n: 2 },
    { kind: 'SECRET', n: 3 },
  ]);
  assert.deepEqual(hiddenCounts({ counts: { PERSON: 'x', CARD: -1 } }), []);
  assert.deepEqual(hiddenCounts(undefined), []);
});

test('where it goes: the provider by its name, a gateway or a local server by its address, with the model', () => {
  assert.deepEqual(destinationOf({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), { name: 'DeepSeek', model: 'deepseek-chat' });
  assert.deepEqual(destinationOf({ provider: 'anthropic', baseUrl: '' }), { name: 'Anthropic', model: '' });
  assert.deepEqual(destinationOf({ provider: 'custom', baseUrl: 'http://localhost:51810/v1', model: 'test-model' }), { name: 'localhost:51810', model: 'test-model' });
  assert.deepEqual(destinationOf({ provider: 'openai', baseUrl: 'https://ai.corp.example/v1', model: 'gpt-5-mini' }), { name: 'ai.corp.example', model: 'gpt-5-mini' }, 'a company gateway is named by its address');
  assert.deepEqual(destinationOf({ provider: 'custom', baseUrl: 'not a url' }), { name: 'custom', model: '' });
  assert.deepEqual(destinationOf(undefined), { name: '', model: '' });
});

test('a selection across a chip is not text that can be hidden', () => {
  const chip = { name: 'chip' };
  const other = { name: 'other chip' };
  const selection = (touched) => ({ containsNode: (node, partly) => partly === true && touched.includes(node) });
  assert.equal(selectionTouches(selection([chip]), [other, chip]), true);
  assert.equal(selectionTouches(selection([]), [other, chip]), false);
  assert.equal(selectionTouches(selection([chip]), []), false);
  assert.equal(selectionTouches(null, [chip]), false);
  assert.equal(selectionTouches({}, [chip]), false);
});

test('the dialog draws the view with text only: a value that looks like markup stays text, and the chips carry the placeholder', () => {
  const prepared = prepare();
  const markup = renderToStaticMarkup(<PreviewDialog feature={{ title: 'Summarise this ticket' }} prepared={prepared} config={{ provider: 'anthropic', baseUrl: '' }} canSkipNext={false} onSend={() => {}} onCancel={() => {}} />);
  assert.ok(markup.includes('Use &lt;b&gt;bold&lt;/b&gt; if needed.'), 'the angle brackets are text, not an element');
  assert.ok(!markup.includes('<b>'));
  assert.match(markup, /<span class="ab-mask-chip" title="\[PHONE_1\]">Phone 1<\/span>/);
  assert.match(markup, /<span class="ab-sent-by"><span class="ab-mask-chip" title="\[PERSON_2\]">Person 2<\/span><\/span><span>2026-10-26 08:25:00<\/span><span>Work note<\/span>/);
  assert.match(markup, /<h4 class="ab-sent-title">Notes and comments<\/h4>/);
  assert.match(markup, /<h4 class="ab-sent-title">The task<\/h4>/);
  assert.match(markup, /Summarise this ticket · to Anthropic</);
});
