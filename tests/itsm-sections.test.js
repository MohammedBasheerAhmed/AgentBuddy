import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_LABELS, parseSections, pickArticleBody, pickArticleTitle, similarArticleLine } from '../src/itsm/sections.js';
import { parseSafeText, toPlainText } from '../src/render/safeText.js';

const DRAFT = [
  'Title: VPN disconnects every few minutes',
  'Symptoms: The VPN drops about every ten minutes.',
  'Cause: The gateway certificate had expired.',
  'Resolution: Replace the certificate and restart the gateway service.',
  'Steps:',
  '1. Open the gateway console.',
  '2. Install the new certificate.',
  '3. Restart the service.',
  'Applies to: VPN client 5.x and the EU gateway',
].join('\n');

const BODY = DRAFT.split('\n').slice(1).join('\n');

// What ResultView hands to pick(): the model's text after parseSafeText and toPlainText.
const plainOf = (text) => toPlainText(parseSafeText(text));

// ---- parseSections ------------------------------------------------------------------------------------

test('parseSections splits on known labels and keeps the text between them', () => {
  const { preamble, sections } = parseSections(DRAFT, ARTICLE_LABELS);
  assert.equal(preamble, '');
  assert.deepEqual(sections.map((s) => s.label), ['Title', 'Symptoms', 'Cause', 'Resolution', 'Steps', 'Applies to']);
  assert.equal(sections[0].text, 'VPN disconnects every few minutes');
  assert.equal(sections[4].text, '1. Open the gateway console.\n2. Install the new certificate.\n3. Restart the service.');
  assert.equal(sections[0].inline, true);
  assert.equal(sections[4].inline, false);
});

test('labels may be in any case, with extra spaces, bold, a colon outside the bold, or as headings', () => {
  const text = ['title :   Shouted label', '**SYMPTOMS:** bold with the colon inside', '**Cause**: bold with the colon outside', '## Resolution', 'heading with text below', '- applies   TO: bullet and odd spacing'].join('\n');
  const { sections } = parseSections(text, ARTICLE_LABELS);
  assert.deepEqual(sections.map((s) => [s.label, s.text]), [
    ['Title', 'Shouted label'],
    ['Symptoms', 'bold with the colon inside'],
    ['Cause', 'bold with the colon outside'],
    ['Resolution', 'heading with text below'],
    ['Applies to', 'bullet and odd spacing'],
  ]);
});

test('a line that merely starts with a label word is text, not a header', () => {
  const text = 'Title: x\nSymptoms: The user sees an error.\nSteps taken so far were many.\nSteps to reproduce: open it.\nCause: unknown';
  const { sections } = parseSections(text, ARTICLE_LABELS);
  assert.deepEqual(sections.map((s) => s.label), ['Title', 'Symptoms', 'Cause']);
  assert.equal(sections[1].text, 'The user sees an error.\nSteps taken so far were many.\nSteps to reproduce: open it.');
});

test('text before the first label is the preamble; a missing label is simply absent', () => {
  const { preamble, sections } = parseSections('Some intro\nmore intro\nCause: unknown\n', ARTICLE_LABELS);
  assert.equal(preamble, 'Some intro\nmore intro');
  assert.deepEqual(sections.map((s) => s.label), ['Cause']);
  assert.deepEqual(parseSections('', ARTICLE_LABELS), { preamble: '', sections: [] });
  assert.deepEqual(parseSections(undefined, ARTICLE_LABELS), { preamble: '', sections: [] });
  assert.deepEqual(parseSections('no labels here', ARTICLE_LABELS).sections, []);
  assert.deepEqual(parseSections(null, ['A']).sections, []);
});

test('labels with regex characters and Windows line endings are handled', () => {
  const { sections } = parseSections('Who (owns): Beth\r\nNext+1: call\r\n', ['Who (owns)', 'Next+1']);
  assert.deepEqual(sections.map((s) => [s.label, s.text]), [['Who (owns)', 'Beth'], ['Next+1', 'call']]);
});

test('a repeated label gives two sections; blank lines inside a section are kept (but not three in a row)', () => {
  const { sections } = parseSections('Cause: a\n\n\n\n\nmore\nCause: b', ['Cause']);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].text, 'a\n\nmore');
});

// ---- pickArticleTitle ---------------------------------------------------------------------------------

test('pickArticleTitle returns just the title', () => {
  assert.equal(pickArticleTitle(DRAFT), 'VPN disconnects every few minutes');
});

test('pickArticleTitle strips bold, quotes and code marks, takes the first line only, and is empty when missing', () => {
  assert.equal(pickArticleTitle('**Title:** "How to fix the VPN"\nSymptoms: x'), 'How to fix the VPN');
  assert.equal(pickArticleTitle('Title: `Reset your password`'), 'Reset your password');
  assert.equal(pickArticleTitle(`Title: ${String.fromCharCode(0x201c)}Curly quoted${String.fromCharCode(0x201d)}`), 'Curly quoted');
  assert.equal(pickArticleTitle('## Title\n\nHeading style title\nSymptoms: x'), 'Heading style title');
  assert.equal(pickArticleTitle('Title:\nSymptoms: x'), '', 'a label with nothing under it');
  assert.equal(pickArticleTitle('Symptoms: only a body'), '');
  assert.equal(pickArticleTitle(''), '');
  assert.equal(pickArticleTitle(undefined), '');
  const long = pickArticleTitle(`Title: ${'word '.repeat(80)}`);
  assert.ok(long.length <= 160, 'the form takes 160 characters');
  assert.ok(long.endsWith(String.fromCharCode(0x2026)));
});

// ---- pickArticleBody ----------------------------------------------------------------------------------

test('pickArticleBody returns Symptoms through Applies to, labels included, without the title', () => {
  assert.equal(pickArticleBody(DRAFT), BODY);
  assert.ok(!pickArticleBody(DRAFT).includes('Title'));
});

test('a first line "Similar article exists" is not part of the body or the title', () => {
  const text = `Similar article exists: KB0010001 Troubleshooting VPN disconnects. Consider updating it instead.\n\n${DRAFT}`;
  assert.equal(pickArticleBody(text), BODY);
  assert.equal(pickArticleTitle(text), 'VPN disconnects every few minutes');
});

test('a missing section does not break the body', () => {
  const noCause = DRAFT.replace(/Cause:.*\n/, '');
  const body = pickArticleBody(noCause);
  assert.ok(body.startsWith('Symptoms:'));
  assert.ok(!body.includes('Cause'));
  assert.ok(body.includes('Applies to:'));
  const onlyResolution = pickArticleBody('Title: T\nResolution: Reboot it.');
  assert.equal(onlyResolution, 'Resolution: Reboot it.');
  assert.equal(pickArticleBody('Title: only a title'), '');
  assert.equal(pickArticleBody('just some prose'), '');
  assert.equal(pickArticleBody(''), '');
  assert.equal(pickArticleBody(null), '');
});

test('a closing remark after the last section stays out of the body', () => {
  assert.equal(pickArticleBody(`${DRAFT}\n\nLet me know if you want a shorter version.`), BODY);
  // ... but a list in the last section is kept when there is no Applies to
  const noApplies = `Title: T\nSymptoms: s\nSteps:\n1. a\n\n2. b`;
  assert.equal(pickArticleBody(noApplies), 'Symptoms: s\nSteps:\n1. a\n\n2. b');
});

test('the body keeps working when the model uses bold labels, headings and extra spaces', () => {
  const messy = ['**Title:** A', '', '**Symptoms:**  s  ', '', '**Resolution**: r', '', '## Applies to', '', 'All users', '', 'Thanks!'].join('\n');
  const body = pickArticleBody(messy);
  assert.ok(body.startsWith('**Symptoms:**'), 'text is kept as written from the first body label');
  assert.ok(body.includes('All users'));
  assert.ok(!body.includes('Thanks!'));
  assert.ok(!body.includes('**Title'));
});

test('a title written after the body does not end up in the body', () => {
  const text = 'Symptoms: s\nResolution: r\nTitle: Late title';
  assert.equal(pickArticleBody(text), 'Symptoms: s\nResolution: r');
  assert.equal(pickArticleTitle(text), 'Late title');
});

test('through the real renderer: the plain text ResultView builds gives the right title and body', () => {
  const markdown = [
    'Similar article exists: KB0010001 Troubleshooting VPN disconnects. Consider updating it instead.',
    '',
    '**Title:** VPN disconnects every few minutes',
    '',
    '## Symptoms',
    'The VPN drops about every ten minutes.',
    '',
    '## Cause',
    'The gateway certificate had expired.',
    '',
    '## Resolution',
    'Replace the certificate.',
    '',
    '## Steps',
    '1. Open the console.',
    '2. Install the certificate.',
    '',
    '## Applies to',
    'VPN client 5.x',
  ].join('\n');
  const plain = plainOf(markdown);
  assert.equal(pickArticleTitle(plain), 'VPN disconnects every few minutes');
  const body = pickArticleBody(plain);
  assert.ok(body.startsWith('Symptoms'));
  assert.ok(body.includes('The VPN drops about every ten minutes.'));
  assert.ok(body.includes('1. Open the console.\n2. Install the certificate.'));
  assert.ok(body.endsWith('VPN client 5.x'));
  assert.ok(!body.includes('Similar article') && !body.includes('Title'));
  assert.deepEqual(similarArticleLine(plain), { number: 'KB0010001', title: 'Troubleshooting VPN disconnects' });
});

test('placeholders in the answer are left alone by the pickers (the pipeline keeps them masked)', () => {
  const body = pickArticleBody('Title: T\nSymptoms: [PERSON_1] cannot log in.\nApplies to: all');
  assert.ok(body.includes('[PERSON_1]'));
});

// ---- similarArticleLine -------------------------------------------------------------------------------

test('similarArticleLine reads the number and title from the first line', () => {
  assert.deepEqual(similarArticleLine('Similar article exists: KB0010004 How to reset your password. Consider updating it instead.\nTitle: x'), { number: 'KB0010004', title: 'How to reset your password' });
  assert.deepEqual(similarArticleLine('\n  similar article exists: kb0010004 Reset. Consider updating it instead'), { number: 'KB0010004', title: 'Reset' });
  assert.deepEqual(similarArticleLine('Similar article exists: KB0010005 Fix v2.1. Remove old drivers. Consider updating it instead.'), { number: 'KB0010005', title: 'Fix v2.1. Remove old drivers' });
});

test('similarArticleLine is null for anything else, including the line further down', () => {
  assert.equal(similarArticleLine('Title: x'), null);
  assert.equal(similarArticleLine('Title: x\nSimilar article exists: KB0010004 A. Consider updating it instead.'), null);
  assert.equal(similarArticleLine('Similar article exists: not a number. Consider updating it instead.'), null);
  assert.equal(similarArticleLine(''), null);
  assert.equal(similarArticleLine(undefined), null);
});
