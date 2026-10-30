import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProseNames, isStopWord, looksLikeName, NAME_STOP_WORDS } from '../src/pii/names.js';
import { NAMED, UNCUED, TRAPS } from './fixtures/pii-names-corpus.js';

const values = (text, mode) => detectProseNames(text, { mode }).map((f) => f.value);

// Scores the detector over the corpus. A finding counts as right only when its text is exactly one of the expected names; a
// finding that is longer or shorter counts as wrong AND the name it should have been counts as missed.
function score(mode) {
  let expected = 0;
  let found = 0;
  let right = 0;
  const misses = [];
  const wrong = [];
  for (const c of [...NAMED, ...TRAPS.map((t) => ({ ...t, names: [] }))]) {
    const got = values(c.text, mode);
    const want = [...c.names];
    expected += want.length;
    found += got.length;
    for (const g of got) {
      const at = want.indexOf(g);
      if (at === -1) wrong.push(`${c.id}: "${g}"`);
      else {
        right++;
        want.splice(at, 1);
      }
    }
    for (const w of want) misses.push(`${c.id}: "${w}"`);
  }
  const trapsClean = TRAPS.filter((t) => values(t.text, mode).length === 0).length;
  return { expected, found, right, precision: right / found, recall: right / expected, misses, wrong, trapsClean };
}

// ---- the corpus ----------------------------------------------------------------------------------------------------------

test('the corpus is sizeable and well formed', () => {
  assert.ok(NAMED.length >= 120, `${NAMED.length} named cases`);
  assert.ok(TRAPS.length >= 120, `${TRAPS.length} traps`);
  const ids = [...NAMED, ...UNCUED, ...TRAPS].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const c of [...NAMED, ...UNCUED]) {
    assert.ok(c.names.length >= 1, c.id);
    for (const n of c.names) assert.ok(c.text.includes(n), `${c.id}: "${n}" is in the text`);
  }
});

test('Standard mode: precision and recall over the corpus (cue-driven names), and the traps stay clean', (t) => {
  const s = score('standard');
  t.diagnostic(`standard: ${s.right} right of ${s.expected} names, ${s.found} found; precision ${s.precision.toFixed(3)}, recall ${s.recall.toFixed(3)}; traps clean ${s.trapsClean}/${TRAPS.length}`);
  if (s.misses.length) t.diagnostic(`missed: ${s.misses.join('; ')}`);
  if (s.wrong.length) t.diagnostic(`wrong: ${s.wrong.join('; ')}`);
  assert.ok(s.precision >= 0.97, `precision ${s.precision.toFixed(3)}: ${s.wrong.join('; ')}`);
  assert.ok(s.recall >= 0.95, `recall ${s.recall.toFixed(3)}: ${s.misses.join('; ')}`);
  assert.ok(s.trapsClean / TRAPS.length >= 0.98, `only ${s.trapsClean} of ${TRAPS.length} traps are clean: ${s.wrong.join('; ')}`);
});

test('Strict mode finds at least what Standard finds, plus most names that have no cue', (t) => {
  const standard = score('standard');
  const strict = score('strict');
  let uncuedFound = 0;
  let uncuedTotal = 0;
  for (const c of UNCUED) {
    const got = values(c.text, 'strict');
    uncuedTotal += c.names.length;
    uncuedFound += c.names.filter((n) => got.includes(n)).length;
    assert.deepEqual(values(c.text, 'standard').filter((v) => c.names.includes(v)), [], `${c.id}: Standard is cue-driven and leaves it`);
  }
  t.diagnostic(`strict: precision ${strict.precision.toFixed(3)}, recall ${strict.recall.toFixed(3)}, traps clean ${strict.trapsClean}/${TRAPS.length}; names with no cue found ${uncuedFound}/${uncuedTotal}`);
  if (strict.wrong.length) t.diagnostic(`strict wrong: ${strict.wrong.join('; ')}`);
  assert.ok(strict.recall >= standard.recall, 'Strict never finds fewer of the named cases');
  assert.ok(uncuedFound / uncuedTotal >= 0.8, `Strict found ${uncuedFound} of ${uncuedTotal} names with no cue`);
  // Strict masks more and is allowed to be wrong more often, but not wildly.
  assert.ok(strict.precision >= 0.85, `strict precision ${strict.precision.toFixed(3)}: ${strict.wrong.join('; ')}`);
  assert.equal(values('Carol Diaz joined.', 'local-only').join(), 'Carol Diaz', 'Local-only is at least as strict as Strict');
});

// ---- the grammar of a name -----------------------------------------------------------------------------------------------

test('names: Unicode letters, hyphens, apostrophes, Mc/Mac/O\', particles and initials', () => {
  assert.deepEqual(values("manager is María-José O'Neil."), ["María-José O'Neil"]);
  assert.deepEqual(values('spoke with Ludwig van Beethoven and Leonardo da Vinci'), ['Ludwig van Beethoven', 'Leonardo da Vinci']);
  assert.deepEqual(values('spoke with Fiona McDonald, then with Ewan MacKenzie'), ['Fiona McDonald', 'Ewan MacKenzie']);
  assert.deepEqual(values('spoke to J. R. R. Tolkien'), ['J. R. R. Tolkien']);
  assert.deepEqual(values("asked D'Arcy Mbeki and d'Artagnan"), ["D'Arcy Mbeki", "d'Artagnan"], "d' and al- may start a name");
  assert.deepEqual(values('asked de la Cruz'), [], 'a particle never starts a name');
  assert.deepEqual(values('spoke with Anna van'), ['Anna'], 'a particle at the end is not part of the name');
  assert.deepEqual(values('spoke with Łukasz Żółć'), ['Łukasz Żółć']);
  assert.deepEqual(values('spoke with Zoë Müller-Schmidt'), ['Zoë Müller-Schmidt']);
  assert.deepEqual(values('spoke with Renée Dubois'), ['Renée Dubois']);
});

test('the span stops before a possessive and never takes the honorific', () => {
  const [f] = detectProseNames("Dr. Okonkwo's laptop");
  assert.equal(f.value, 'Okonkwo');
  assert.equal("Dr. Okonkwo's laptop".slice(f.start, f.end), 'Okonkwo');
  assert.deepEqual(values("spoke with Anna's manager"), ['Anna']);
  assert.deepEqual(values("spoke with Jones' team"), ['Jones']);
});

test('a name is at most four words and never runs over a line break or into vocabulary', () => {
  assert.deepEqual(values('cc: Anna Maria Louisa Schmidt Becker'), ['Anna Maria Louisa Schmidt']);
  assert.deepEqual(values('spoke with Anna\nSchmidt'), ['Anna']);
  assert.deepEqual(values('spoke with Anna Schmidt Monday'), ['Anna Schmidt']);
  assert.deepEqual(values('per Anna Outlook'), ['Anna']);
});

test('camelCase words, ALL CAPS words and words glued to an @ are not names', () => {
  assert.deepEqual(values('called GetUserInfo, PowerShell and LaTeX'), []);
  assert.deepEqual(values('spoke with VPN TEAM'), []);
  assert.deepEqual(values('spoke with Anna@example.com'), []);
});

test('scripts without capital letters are names after a strong cue only, and a no-space script only when short', () => {
  assert.deepEqual(values('spoke with 李明 today'), ['李明']);
  assert.deepEqual(values('spoke with 李明说网络坏了'), [], 'a whole sentence written without spaces is not a name');
  assert.deepEqual(values('New laptop for 李明'), [], 'a weak cue needs a capitalised full name');
  assert.deepEqual(values('spoke with راهول شارما'), ['راهول شارما']);
});

test('every finding is a PERSON finding over the original text, marked as coming from prose', () => {
  const text = 'Hi Tom,\ncc: Jean-Luc Picard';
  for (const f of detectProseNames(text)) {
    assert.deepEqual(Object.keys(f).sort(), ['confidence', 'end', 'kind', 'source', 'start', 'value']);
    assert.equal(f.kind, 'PERSON');
    assert.equal(f.source, 'prose');
    assert.equal(text.slice(f.start, f.end), f.value);
    assert.ok(f.confidence >= 0.5 && f.confidence < 0.85, 'a guess: above the minimum, below "high"');
  }
});

// ---- cues --------------------------------------------------------------------------------------------------------------

test('salutations count at the start of a line, a sentence, a quoted line or after "Name:", not in the middle of a sentence', () => {
  assert.deepEqual(values('Hi Tom,'), ['Tom']);
  assert.deepEqual(values('Done. Hi Tom, it works.'), ['Tom']);
  assert.deepEqual(values('Support: Hi Tom, it works.'), ['Tom']);
  assert.deepEqual(values('> Hello Sunita,'), ['Sunita']);
  assert.deepEqual(values('he said hi Tom would not mind'), []);
});

test('sign-offs take a name on the next line (one blank line allowed) or at the end of the same line only', () => {
  assert.deepEqual(values('Regards,\nAnna Schmidt'), ['Anna Schmidt']);
  assert.deepEqual(values('Regards,\n\nAnna Schmidt'), ['Anna Schmidt']);
  assert.deepEqual(values('Regards,\r\nAnna Schmidt\r\nIT'), ['Anna Schmidt']);
  assert.deepEqual(values('Regards, Anna'), ['Anna']);
  assert.deepEqual(values('Regards,\nAnna Schmidt | Service Desk'), ['Anna Schmidt']);
  assert.deepEqual(values('Regards,\nAnna Schmidt will call you'), [], 'a sentence is not a signature');
  assert.deepEqual(values('Best,\nRestart the router'), []);
});

test('lists after a cue: commas only where a list is expected, "and" anywhere', () => {
  assert.deepEqual(values('cc: Anna Schmidt, Tom Baker; Raj Patel'), ['Anna Schmidt', 'Tom Baker', 'Raj Patel']);
  assert.deepEqual(values('spoke with Anna and Tom'), ['Anna', 'Tom']);
  assert.deepEqual(values('spoke with Anna, Restarted the router'), ['Anna'], 'after a verb cue a comma ends the name');
  assert.deepEqual(values('Hi Tom, Will you check?'), ['Tom'], 'a comma list item must look like one');
  assert.deepEqual(values('spoke with Anna and Finance'), ['Anna']);
});

test('weak cues need a full name in Standard mode, one word in Strict', () => {
  assert.deepEqual(values('New laptop for Anna'), []);
  assert.deepEqual(values('New laptop for Anna', 'strict'), ['Anna']);
  assert.deepEqual(values('New laptop for Anna Schmidt'), ['Anna Schmidt']);
  assert.deepEqual(values('Request for Go Live'), [], 'the first word is an everyday word');
  assert.deepEqual(values('Approval for Annual Leave'), []);
});

test('honorifics must be capitalised and followed by a space', () => {
  assert.deepEqual(values('Mr Smith and Dr. Watson-Crick'), ['Smith', 'Watson-Crick']);
  assert.deepEqual(values('mr smith'), []);
  assert.deepEqual(values('Dr.Smith'), []);
  assert.deepEqual(values('Dear Sir,'), []);
});

test('@mentions: names and handles, never an email, a domain or a group', () => {
  assert.deepEqual(values('@Kevin Lee please check'), ['Kevin Lee']);
  assert.deepEqual(values('ping @kevin.lee, thanks'), ['kevin.lee']);
  assert.deepEqual(values('mail kevin@example.com'), []);
  assert.deepEqual(values('mail @example.com and @here and @channel and @all'), []);
  assert.deepEqual(values('@2x icons'), []);
});

// ---- vocabulary --------------------------------------------------------------------------------------------------------

test('vocabulary is folded and checked whole, without the possessive, and by hyphenated part', () => {
  assert.ok(NAME_STOP_WORDS.has('servicenow') && NAME_STOP_WORDS.has('outlook') && NAME_STOP_WORDS.has('monday') && NAME_STOP_WORDS.has('december'));
  for (const w of ['Service', 'Desk', 'Teams', 'Outlook', 'Active', 'Directory', "Microsoft's", 'Wi-Fi', 'WiFi', 'Monday', 'June', 'ServiceNow', 'Buddy']) assert.ok(isStopWord(w), w);
  for (const w of ['Anna', 'Schmidt', "O'Neil", 'María-José', 'Baker', 'Grace', 'Will']) assert.ok(!isStopWord(w), w);
});

test('looksLikeName: one to four capitalised name words and nothing else', () => {
  for (const s of ['Tom', 'Anna Schmidt', "María-José O'Neil", 'Pieter van der Berg', '李明', ' Anna ']) assert.ok(looksLikeName(s), s);
  for (const s of ['', 'project falcon', 'Service Desk', 'Anna Schmidt laptop', 'INC0010001', 'Anna, Tom', 'x'.repeat(100), null]) assert.ok(!looksLikeName(s), String(s));
});

test('bad input gives nothing', () => {
  for (const bad of [undefined, null, '', 42, {}, []]) assert.deepEqual(detectProseNames(bad), []);
});

// ---- cost -----------------------------------------------------------------------------------------------------------------

test('200k characters of cue-heavy and capitalised text finish quickly in both modes', () => {
  const chunk = 'Hi Tom, spoke with Anna Schmidt and Raj, cc: Jean-Luc Picard, Bo Ray; Regards,\nAnna Schmidt\nCapital Words Everywhere Here ';
  const text = chunk.repeat(Math.ceil(200000 / chunk.length)).slice(0, 200000);
  for (const mode of ['standard', 'strict']) {
    const started = performance.now();
    const found = detectProseNames(text, { mode });
    const ms = performance.now() - started;
    assert.ok(found.length > 1000);
    assert.ok(ms < 2500, `${mode}: ${ms.toFixed(0)} ms`);
  }
  // adversarial: long runs of capitals, apostrophes and hyphens with no end
  for (const bad of ['A'.repeat(100000), "O'".repeat(50000), 'Ab-'.repeat(50000), 'spoke with '.repeat(20000), '@'.repeat(100000), 'Hi '.repeat(50000)]) {
    const started = performance.now();
    detectProseNames(bad, { mode: 'strict' });
    assert.ok(performance.now() - started < 2500);
  }
});
