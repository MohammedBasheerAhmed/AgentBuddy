import test from 'node:test';
import assert from 'node:assert/strict';
import { isArabicText, normalizeArabic, scriptOf } from '../src/lib/scriptDetect.js';
import { closeCodeVote } from '../src/insights/closeCode.js';

test('scriptOf tells Arabic, Latin, mixed and too-short text apart', () => {
  assert.equal(scriptOf('لا يزال البريد لا يعمل على هاتفي'), 'arabic');
  assert.equal(scriptOf('Email still does not work on my phone'), 'latin');
  assert.equal(scriptOf('Outlook على الهاتف لا يعمل'), 'arabic');
  assert.equal(scriptOf('Wi-Fi شبكة'), 'mixed');
  assert.equal(scriptOf('Привет мир'), 'other');
  assert.equal(scriptOf('ok'), '');
  assert.equal(scriptOf('INC0010023 12:30'), 'latin');
  assert.equal(scriptOf(''), '');
  assert.equal(scriptOf(null), '');
  assert.equal(isArabicText('هل من جديد؟'), true);
  assert.equal(isArabicText('Any news?'), false);
});

test('normalizeArabic folds the forms writers use inconsistently, for matching only', () => {
  assert.equal(normalizeArabic('أحمد'), normalizeArabic('احمد'));
  assert.equal(normalizeArabic('إعادة'), 'اعاده');
  assert.equal(normalizeArabic('مُسْتَشْفَى'), 'مستشفي');
  assert.equal(normalizeArabic('كلمـــة'), 'كلمه');
  assert.equal(normalizeArabic('Password reset'), 'Password reset');
  assert.equal(normalizeArabic(undefined), '');
});

const hit = (code, value = '', number = 'INC1') => ({ close_code: code, close_code_value: value, number });

test('closeCodeVote suggests the code most solved look-alikes used, by value', () => {
  const vote = closeCodeVote([
    hit('Solved (Work Around)', 'Solved (Work Around)', 'INC1'),
    hit('Solved (Work Around)', '', 'INC2'),
    hit('solved (work around)', '', 'INC3'),
    hit('Solved (Permanently)', 'Solved (Permanently)', 'INC4'),
    hit('', '', 'INC5'),
  ]);
  assert.equal(vote.enough, true);
  assert.equal(vote.of, 4);
  assert.equal(vote.votes, 3);
  assert.equal(vote.label, 'Solved (Work Around)');
  assert.equal(vote.value, 'Solved (Work Around)');
  assert.deepEqual(vote.numbers, ['INC1', 'INC2', 'INC3']);
  assert.match(vote.line, /3 of 4 solved look-alikes used/);
  assert.equal(vote.matchesCurrent, null);
});

test('closeCodeVote says nothing on a tie, a single vote or no codes', () => {
  assert.equal(closeCodeVote([hit('A'), hit('B')]).enough, false);
  assert.equal(closeCodeVote([hit('A'), hit('A'), hit('B'), hit('B')]).enough, false);
  assert.equal(closeCodeVote([hit('A')]).enough, false);
  assert.equal(closeCodeVote([]).enough, false);
  assert.equal(closeCodeVote(null).enough, false);
});

test('closeCodeVote compares with the code already on the ticket and falls back to the label as value', () => {
  const vote = closeCodeVote([hit('Duplicate', 'dup', 'INC1'), hit('Duplicate', 'dup', 'INC2')], { current: 'dup' });
  assert.equal(vote.value, 'dup');
  assert.equal(vote.matchesCurrent, true);
  const labelOnly = closeCodeVote([hit('Known error'), hit('Known error')], { current: 'Duplicate' });
  assert.equal(labelOnly.value, 'Known error');
  assert.equal(labelOnly.matchesCurrent, false);
});
