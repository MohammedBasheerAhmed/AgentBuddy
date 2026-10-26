import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictionary, fold, COMMON_WORDS } from '../src/pii/dictionary.js';
import { resolveOverlaps } from '../src/pii/detectors.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const PEOPLE = [
  { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: A },
  { role: 'assigned_to', name: 'Beth Anglin', email: 'beth.anglin@example.com', sysId: B },
];

// [value, entity] pairs, longest match per place, in text order.
const hits = (dict, text, options) =>
  resolveOverlaps(dict.find(text, options)).map((f) => [f.value, f.entity ?? null]);
const values = (dict, text, options) => hits(dict, text, options).map(([v]) => v);

test('full names, in either order, in any case', () => {
  const d = createDictionary(PEOPLE);
  assert.deepEqual(values(d, 'Abel Tuter called.'), ['Abel Tuter']);
  assert.deepEqual(values(d, 'ABEL TUTER called.'), ['ABEL TUTER']);
  assert.deepEqual(values(d, 'abel tuter called.'), ['abel tuter']);
  assert.deepEqual(values(d, 'Tuter, Abel called.'), ['Tuter, Abel']);
  assert.deepEqual(values(d, 'Tuter Abel called.'), ['Tuter Abel']);
  assert.deepEqual(values(d, 'Abel  Tuter and Beth Anglin'), ['Abel  Tuter', 'Beth Anglin']);
});

test('a record name written "Last, First" matches the same ways', () => {
  const d = createDictionary([{ name: 'Anglin, Beth', sysId: B }]);
  assert.deepEqual(values(d, 'Beth Anglin and Anglin, Beth'), ['Beth Anglin', 'Anglin, Beth']);
  assert.deepEqual(values(d, 'Beth said'), ['Beth']);
});

test('first and last names stand alone, with possessives, but only as whole words', () => {
  const d = createDictionary(PEOPLE);
  assert.deepEqual(values(d, 'Abel says hi, Tuter too'), ['Abel', 'Tuter']);
  assert.deepEqual(values(d, "Abel's laptop and Tuter's phone"), ['Abel', 'Tuter']);
  const curly = String.fromCharCode(0x2019);
  assert.deepEqual(values(d, `Abel${curly}s laptop`), ['Abel'], 'typographic apostrophe');
  assert.deepEqual(values(d, "Abel's"), ['Abel']);
  assert.deepEqual(values(d, 'Abelian groups, Tutermann, Cabel and abelard'), []);
  assert.deepEqual(values(d, 'Abel-Tuter and Abel_Tuter'), ['Abel-Tuter'], 'a hyphen separates words, an underscore does not');
  // spans stop before the possessive
  const [f] = d.find("Abel's laptop");
  assert.equal(text(f, "Abel's laptop"), 'Abel');
});
const text = (f, s) => s.slice(f.start, f.end);

test('names shorter than three letters are not matched alone', () => {
  const d = createDictionary([{ name: 'Al Wu', sysId: A }]);
  assert.deepEqual(values(d, 'Al and Wu met, Al Wu signed'), ['Al Wu'], 'only the full name');
});

test('hyphenated and apostrophe names', () => {
  const d = createDictionary([
    { name: 'Mary-Jane Watson', sysId: A },
    { name: "Sean O'Brien", sysId: B },
    { name: "Priya D'Souza", sysId: 'c'.repeat(32) },
  ]);
  assert.deepEqual(values(d, 'Mary-Jane Watson, Mary Jane Watson and Jane'), ['Mary-Jane Watson', 'Mary Jane Watson', 'Jane']);
  assert.deepEqual(values(d, "O'Brien and Sean O'Brien's desk"), ["O'Brien", "Sean O'Brien"]);
  assert.deepEqual(values(d, 'Souza arrived'), ['Souza']);
});

test('accents and case are ignored, in both directions', () => {
  const plain = createDictionary([{ name: 'Jose Garcia', sysId: A }]);
  assert.deepEqual(values(plain, 'José García llamó'), ['José García']);
  const accented = createDictionary([{ name: 'José García', sysId: A }]);
  assert.deepEqual(values(accented, 'JOSE GARCIA llamo, jose garcia'), ['JOSE GARCIA', 'jose garcia']);
  const combining = String.fromCharCode(0x301);
  assert.deepEqual(values(accented, `Jose${combining} Garcia${combining}`), [`Jose${combining} Garcia${combining}`], 'decomposed accents');
  assert.equal(fold('JOSÉ'), 'jose');
});

test('non-Latin names: Cyrillic, Greek, Devanagari, Arabic', () => {
  const d = createDictionary([
    { name: 'Иван Петров', sysId: A },
    { name: 'Γιώργος Παπαδόπουλος', sysId: B },
    { name: 'प्रिया शर्मा', sysId: 'c'.repeat(32) },
    { name: 'محمد علي', sysId: 'd'.repeat(32) },
  ]);
  assert.deepEqual(values(d, 'Иван Петров сказал; петров ушёл; ИВАН ПЕТРОВ'), ['Иван Петров', 'Петров'.toLowerCase(), 'ИВАН ПЕТРОВ']);
  assert.deepEqual(values(d, 'ΓΙΏΡΓΟΣ ΠΑΠΑΔΌΠΟΥΛΟΣ και Γιώργος'), ['ΓΙΏΡΓΟΣ ΠΑΠΑΔΌΠΟΥΛΟΣ', 'Γιώργος']);
  assert.deepEqual(values(d, 'प्रिया शर्मा ने कहा, प्रिया आई'), ['प्रिया शर्मा', 'प्रिया']);
  assert.deepEqual(values(d, 'قال محمد علي إن علي حضر'), ['محمد علي', 'علي']);
});

test('names in scripts without spaces fall back to substring matching', () => {
  const d = createDictionary([
    { name: '田中 太郎', sysId: A },
    { name: '김민수', sysId: B },
  ]);
  assert.deepEqual(values(d, '田中太郎さんから連絡がありました'), ['田中太郎']);
  assert.deepEqual(values(d, '田中 太郎'), ['田中 太郎']);
  assert.deepEqual(values(d, '김민수님이 요청했습니다'), ['김민수']);
  assert.deepEqual(values(d, '田中さん'), ['田中']);
});

test('common words that are also names are masked only when capitalised mid-sentence', () => {
  const d = createDictionary([{ name: 'Mark Twain', sysId: A }, { name: 'Will Smith', sysId: B }]);
  assert.ok(COMMON_WORDS.has('mark') && COMMON_WORDS.has('will'));
  assert.deepEqual(values(d, 'please mark this as done and it will work'), [], 'ordinary words stay');
  assert.deepEqual(values(d, 'Mark the ticket resolved. Will you check?'), [], 'sentence starts stay');
  assert.deepEqual(values(d, 'Ask Mark about it, then call Will tomorrow'), ['Mark', 'Will']);
  assert.deepEqual(values(d, 'Mark Twain and Will Smith'), ['Mark Twain', 'Will Smith'], 'full names always');
  assert.deepEqual(values(d, 'Ask Mark about it', { unconditionalOnly: true }), []);
  assert.deepEqual(values(d, 'MARK TWAIN'), ['MARK TWAIN']);
  assert.deepEqual(values(d, 'He said: "Will it work?" Mark'), [], 'a quote opener or sentence end means a sentence start');
});

test('email addresses and local parts', () => {
  const d = createDictionary(PEOPLE);
  const found = d.find('write to ABEL.TUTER@EXAMPLE.COM or user abel.tuter on the server');
  const kinds = found.map((f) => [f.kind, f.value]);
  assert.ok(kinds.some(([k, v]) => k === 'EMAIL' && v === 'ABEL.TUTER@EXAMPLE.COM'));
  assert.ok(kinds.some(([k, v]) => k === 'PERSON' && v === 'abel.tuter'));
  // the local part inside the address is not reported as a separate person hit once overlaps are resolved against the email
  const resolved = resolveOverlaps(found.map((f) => (f.kind === 'EMAIL' ? { ...f, confidence: 0.99 } : f)));
  assert.deepEqual(resolved.map((f) => f.value), ['ABEL.TUTER@EXAMPLE.COM', 'abel.tuter']);
  assert.ok(!values(d, 'xabel.tutery and abel.tuters').some((v) => v.includes('.')), 'a local part needs word boundaries on both sides');
  assert.deepEqual(values(d, 'xabel.tutery'), [], 'and so does the first name inside it');
  assert.equal(values(createDictionary([{ name: 'Help Desk', email: 'helpdesk@example.com' }]), 'the helpdesk replied').length, 0, 'shared mailboxes are not people');
  assert.equal(values(createDictionary([{ name: 'Sam Roe', email: 'info@example.com' }]), 'send to info please').length, 0);
});

test('people of different roles stay distinct; the same human in two roles is one person', () => {
  const d = createDictionary([
    { role: 'caller', name: 'Abel Tuter', sysId: A },
    { role: 'assigned_to', name: 'Beth Anglin', sysId: B },
    { role: 'opened_by', name: 'Abel Tuter', sysId: A },
    { role: 'watcher', name: 'Cora Stone', email: 'cora@example.com' },
    { role: 'approver', name: 'Cora Stone', email: 'cora@example.com' },
  ]);
  assert.equal(d.size, 3);
  const h = hits(d, 'Abel Tuter, Beth Anglin, Cora Stone, Abel and Anglin');
  const entities = h.map(([, e]) => e);
  assert.equal(entities[0], entities[3], 'Abel Tuter and Abel are the same person');
  assert.equal(entities[1], entities[4], 'Beth Anglin and Anglin are the same person');
  assert.equal(new Set(entities).size, 3);
});

test('a token two people share is ambiguous: it gets its own entity, not a guess', () => {
  const d = createDictionary([{ name: 'Beth Anglin', sysId: A }, { name: 'Beth Jones', sysId: B }]);
  const h = hits(d, 'Beth Anglin, Beth Jones and Beth');
  assert.equal(h[0][1] === h[1][1], false);
  assert.ok(h[2][1].startsWith('amb:'), 'the bare first name is ambiguous');
  assert.equal(hits(d, 'Anglin')[0][1], h[0][1], 'a unique last name is still attributed');
});

test('adjacent parts of one person are merged into a single hit', () => {
  const d = createDictionary([{ name: 'Mary Ann Smith', sysId: A }]);
  assert.deepEqual(values(d, 'Mary Smith and Smith, Mary and Mary Ann Smith'), ['Mary Smith', 'Smith, Mary', 'Mary Ann Smith']);
  const d2 = createDictionary([{ name: 'Abel Tuter', sysId: A }]);
  assert.deepEqual(values(d2, 'Abel M. Tuter'), ['Abel', 'Tuter'], 'a middle initial in the way keeps them apart, both still masked');
});

test('system accounts and junk entries are not people', () => {
  const d = createDictionary([
    { name: 'System Administrator', sysId: A },
    { name: 'admin', sysId: B },
    null,
    5,
    {},
    { name: '   ' },
    { name: '...' },
    { email: 'solo@example.com' },
  ]);
  assert.equal(d.size, 1, 'only the email-only entry is a person');
  assert.deepEqual(values(d, 'the System Administrator and admin fixed it'), []);
  assert.deepEqual(values(createDictionary(undefined), 'anything'), []);
  assert.deepEqual(values(createDictionary(), ''), []);
});

test('a dictionary never exposes the names it holds', () => {
  const d = createDictionary(PEOPLE);
  assert.equal(JSON.stringify(d), '{"people":2}');
  assert.ok(!JSON.stringify(Object.keys(d)).includes('Abel'));
});

test('matching 200k characters against a dozen people is fast', () => {
  const people = Array.from({ length: 12 }, (_, i) => ({ name: `Person${String.fromCharCode(97 + i)} Surname${String.fromCharCode(97 + i)}`, email: `p${i}@example.com`, sysId: String(i).repeat(32).slice(0, 32) }));
  const d = createDictionary(people);
  const text = 'Personb Surnameb wrote to p3@example.com about the printer and Persona said hi. '.repeat(2600).slice(0, 200000);
  const started = performance.now();
  const found = d.find(text);
  assert.ok(found.length > 2000);
  assert.ok(performance.now() - started < 500);
  const noise = 'word '.repeat(40000);
  const t2 = performance.now();
  d.find(noise);
  assert.ok(performance.now() - t2 < 500);
});
