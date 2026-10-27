import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyAnswer, pickSection, sectionPicker, splitSections, tidy } from '../src/domain/sections.js';
import { PROBLEM_HEADINGS } from '../src/features/packs/domain.js';
import { parseSafeText, toPlainText } from '../src/render/safeText.js';

const H = PROBLEM_HEADINGS;

const ANSWER = [
  'Problem statement: Users in the EU cannot reach the gateway about twice a day since 1 October.',
  'Timeline:',
  '- 2026-10-01: INC001001 first report',
  '- 2026-10-02: INC001002 second report',
  'Probable cause: Hypothesis: the TLS bundle update on gw-eu-1 broke session reuse.',
  'Workaround: Restart the pool.',
  'Permanent fix options:',
  '- Roll back the bundle',
  '- Fix session reuse',
  'Open questions: Did the first report follow the bundle update?',
].join('\n');

test('every section is found, with its text on the heading line or under it', () => {
  const s = splitSections(ANSWER, H);
  assert.deepEqual(Object.keys(s), H);
  assert.equal(s['Problem statement'], 'Users in the EU cannot reach the gateway about twice a day since 1 October.');
  assert.equal(s.Timeline, '- 2026-10-01: INC001001 first report\n- 2026-10-02: INC001002 second report');
  assert.equal(s['Probable cause'], 'Hypothesis: the TLS bundle update on gw-eu-1 broke session reuse.');
  assert.equal(s.Workaround, 'Restart the pool.');
  assert.equal(s['Permanent fix options'], '- Roll back the bundle\n- Fix session reuse');
});

test('the section ends at the next heading, so the cause never carries the workaround', () => {
  const cause = pickSection(ANSWER, 'Probable cause', H);
  assert.ok(!/restart/i.test(cause));
  assert.ok(/^Hypothesis:/.test(cause), 'the hypothesis label is part of what is inserted');
});

test('headings are matched in any letter case and with odd spacing', () => {
  const text = 'PROBLEM   STATEMENT : Shouting.\n\nworkaround:   restart it   \nOPEN QUESTIONS:\nwhy?';
  assert.equal(pickSection(text, 'Problem statement', H), 'Shouting.');
  assert.equal(pickSection(text, 'Workaround', H), 'restart it');
  assert.equal(pickSection(text, 'Open questions', H), 'why?');
});

test('markdown the model adds anyway does not stop it: bold, hashes, numbers, a note in brackets', () => {
  const text = [
    '## Problem statement',
    'Gateway drops sessions.',
    '',
    '**Probable cause (hypothesis):** TLS bundle.',
    '',
    '2. **Workaround**: restart the pool',
    '3) Permanent fix options: roll back',
    '__Open questions__',
    'why now?',
  ].join('\n');
  assert.equal(pickSection(text, 'Problem statement', H), 'Gateway drops sessions.');
  assert.equal(pickSection(text, 'Probable cause', H), 'TLS bundle.');
  assert.equal(pickSection(text, 'Workaround', H), 'restart the pool');
  assert.equal(pickSection(text, 'Permanent fix options', H), 'roll back');
  assert.equal(pickSection(text, 'Open questions', H), 'why now?');
});

test('a missing section, an empty heading and an empty input give nothing, never a guess', () => {
  assert.equal(pickSection('Problem statement: only this', 'Workaround', H), '');
  assert.equal(pickSection('Workaround:\nProbable cause: x', 'Workaround', H), '');
  assert.equal(pickSection('', 'Workaround', H), '');
  assert.equal(pickSection(null, 'Workaround', H), '');
  assert.equal(pickSection(undefined, 'Workaround', undefined), '');
  assert.deepEqual(splitSections('no headings here at all', H), {});
});

test('"Not stated", "None" and friends are not inserted, unless asked to keep them', () => {
  for (const nothing of ['Not stated', 'not stated.', 'None', 'N/A', 'Not applicable', '-', 'Unknown', 'None found']) {
    assert.equal(isEmptyAnswer(nothing), true, nothing);
    assert.equal(pickSection(`Workaround: ${nothing}\nOpen questions: x`, 'Workaround', H), '', nothing);
  }
  assert.equal(pickSection('Workaround: Not stated', 'Workaround', H, { keepEmptyAnswer: true }), 'Not stated');
  assert.equal(isEmptyAnswer('Not stated in the data, but the restart helped'), false);
  assert.equal(isEmptyAnswer('Restart the pool'), false);
});

test('a line that only starts with a heading name is content, and a bullet is never a heading', () => {
  const text = [
    'Timeline:',
    '- Workaround: restarted the pool at 10:00',
    'Workaround is to restart the pool and wait.',
    'Workaround: the real one',
  ].join('\n');
  const s = splitSections(text, H);
  assert.equal(s.Timeline, '- Workaround: restarted the pool at 10:00\nWorkaround is to restart the pool and wait.');
  assert.equal(s.Workaround, 'the real one');
});

test('the first occurrence of a heading counts', () => {
  assert.equal(pickSection('Workaround: first\nOpen questions: q\nWorkaround: second', 'Workaround', H), 'first');
});

test('odd whitespace, windows line breaks and invisible characters are cleaned', () => {
  const nbsp = String.fromCharCode(0xa0);
  const zwsp = String.fromCharCode(0x200b);
  const text = `Problem statement:${nbsp}Two${nbsp}words${zwsp}.\r\nWorkaround:\r\n\r\n\r\n\r\nstep one   \r\nstep two`;
  assert.equal(pickSection(text, 'Problem statement', H), 'Two words.');
  assert.equal(pickSection(text, 'Workaround', H), 'step one\nstep two');
  assert.equal(tidy('a\n\n\n\n\nb  \n'), 'a\n\nb');
});

test('a heading with a full-width colon is found', () => {
  assert.equal(pickSection(`Workaround${String.fromCharCode(0xff1a)} restart`, 'Workaround', H), 'restart');
});

test('a section asked for that is not in the heading list still ends at the next known heading', () => {
  const text = 'Extra: abc\nline two\nWorkaround: w';
  assert.equal(pickSection(text, 'Extra', ['Workaround']), 'abc\nline two');
});

test('headings with regular-expression characters are safe', () => {
  assert.equal(pickSection('Cost (USD)? : 5', 'Cost (USD)?', ['Cost (USD)?']), '5');
  assert.equal(pickSection('a.b: 1\naxb: 2', 'a.b', ['a.b', 'axb']), '1');
});

test('sectionPicker returns a function of the answer text, as the Insert button calls it', () => {
  const pick = sectionPicker('Workaround', H);
  assert.equal(pick(ANSWER), 'Restart the pool.');
  assert.equal(pick('nothing'), '');
});

test('it works on what the result view shows: the plain text of the safe renderer', () => {
  const model = [
    '**Problem statement:** Users cannot log in.',
    '',
    '**Timeline:**',
    '- 2026-10-01: first report',
    '',
    'Probable cause (hypothesis): cert expired',
    '',
    '## Workaround',
    'Restart the pool.',
    '',
    '**Open questions:** 1. Why now?',
  ].join('\n');
  const plain = toPlainText(parseSafeText(model));
  assert.equal(pickSection(plain, 'Problem statement', H), 'Users cannot log in.');
  assert.equal(pickSection(plain, 'Probable cause', H), 'cert expired');
  assert.equal(pickSection(plain, 'Workaround', H), 'Restart the pool.');
  assert.equal(pickSection(plain, 'Timeline', H), '- 2026-10-01: first report');
});

test('a very long answer is handled in linear time', () => {
  const big = `Workaround: ${'x '.repeat(200000)}\nOpen questions: q`;
  const started = Date.now();
  assert.equal(pickSection(big, 'Open questions', H), 'q');
  assert.ok(Date.now() - started < 2000);
});
