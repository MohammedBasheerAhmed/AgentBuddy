import test from 'node:test';
import assert from 'node:assert/strict';
import { arabicFolded, arabicRule, matchKey, queryTerm, rankSimilar, similarKeywords, similarQuery, textHas, withoutArabicArticle } from '../src/lib/similar.js';
import { findSimilarTickets, searchKeywords, searchKnowledge } from '../src/context/similar.js';
import { knowledgeSearchQuery, searchKnowledgeText, searchTerms } from '../src/context/knowledge.js';
import { arabicStem, keywordsOf, stem, stemsOf, wordsOf } from '../src/knowledge/text.js';
import { findDuplicateClusters, textSimilarity, titleSimilarity } from '../src/knowledge/similarity.js';
import { clusterTickets } from '../src/knowledge/gaps.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';

// Round 4, Phase 0 (docs/round4.md): the no-AI search understands words of any script that writes spaces between words, Arabic first.
// The query sent to ServiceNow keeps every letter as it was written (minus an Arabic article or ending); the ranking in the panel
// compares folded text (normalizeArabic, no accents). No query operator can get into a term.

const SYS = (c) => c.repeat(32);

// ---- keywords -------------------------------------------------------------------------------------------------------------

test('Arabic keywords: function words and ticket filler are dropped, the article and a common ending come off, nothing is folded', () => {
  assert.deepEqual(similarKeywords('البريد الإلكتروني لا يعمل على هاتفي منذ الصباح'), /* longest first, then alphabetical */ ['إلكترون', 'بريد', 'صباح', 'هاتف']);
  // "إعادة" keeps its hamza (the stored text has it), loses its ta marbuta (a piece of the word as written); "كلمة" is too short to cut.
  assert.deepEqual(similarKeywords('لا أستطيع إعادة تعيين كلمة المرور'), ['تعيين', 'إعاد', 'كلمة', 'مرور']);
  assert.deepEqual(similarKeywords('هل يمكنكم مساعدتي في مشكلة الطابعة؟'), ['طابع']);
  assert.deepEqual(similarKeywords('الذي والتي هذا في من على إلى'), [], 'only filler');
  // The same word with and without the article, with a preposition, and with tatweel or short vowels is one keyword.
  assert.deepEqual(similarKeywords('البريد بالبريد والبريد للبريد بَرِيد البـريـد'), ['بريد']);
  assert.deepEqual(similarKeywords('للمستخدمين الجدد'), ['مستخدمين', 'جدد']);
});

test('mixed, accented and other scripts: acronyms first, accents kept in the query form, Cyrillic works, no-space scripts are skipped', () => {
  assert.deepEqual(similarKeywords('VPN لا يعمل بعد التحديث'), ['vpn', 'تحديث']);
  assert.deepEqual(similarKeywords('Outlook يتوقف عند فتح المرفقات'), ['outlook', 'يتوقف', 'مرفق', 'فتح']);
  assert.deepEqual(similarKeywords('La impresora no imprime después de la actualización'), ['actualización', 'impresora', 'después', 'imprime']);
  assert.deepEqual(similarKeywords('Не работает принтер в офисе'), ['работает', 'принтер', 'офисе']);
  // Chinese and Japanese write no spaces: a whole sentence would be one "word", so those letters are left out.
  assert.deepEqual(similarKeywords('VPN接続できない'), ['vpn']);
  assert.deepEqual(similarKeywords('打印机无法连接网络'), []);
  // English is as before.
  assert.deepEqual(similarKeywords('VPN keeps disconnecting every ten minutes'), ['vpn', 'disconnecting', 'minutes', 'keeps']);
});

test('the article comes off only when 3 letters remain, an ending only when 4 remain', () => {
  assert.equal(withoutArabicArticle('البريد'), 'بريد');
  assert.equal(withoutArabicArticle('وال'), 'وال');
  assert.equal(withoutArabicArticle('الذي'), 'الذي', 'two letters would remain');
  assert.equal(withoutArabicArticle('بالحساب'), 'حساب');
  assert.equal(withoutArabicArticle('VPN'), 'VPN');
  assert.deepEqual(similarKeywords('حسابي'), ['حساب']);
  assert.deepEqual(similarKeywords('الطابعات'), ['طابع']);
  assert.deepEqual(similarKeywords('شبكة'), ['شبكة'], 'three letters would remain');
});

test('caller names are not search words, in any spelling: with or without hamza, with the article', () => {
  const pack = {
    fields: { short_description: 'أحمد العتيبي: احمد لا يستطيع فتح عتيبي Outlook على الجهاز' },
    people: [{ role: 'caller', name: 'أحمد العتيبي', firstName: 'أحمد', lastName: 'العتيبي' }],
  };
  const words = searchKeywords(pack, { max: 6 });
  assert.deepEqual(words, ['outlook', 'يستطيع', 'جهاز', 'فتح']);
  assert.ok(!words.some((w) => /حمد|عتيب/.test(w)), words.join(','));
  // English names as before.
  assert.deepEqual(searchKeywords({ fields: { short_description: 'Abel Tuter cannot open Outlook' }, people: [{ name: 'Abel Tuter' }] }), ['outlook', 'open']);
});

// ---- the query --------------------------------------------------------------------------------------------------------------

test('the encoded query uses the words as written, never their folded spelling', () => {
  const keywords = similarKeywords('لا يمكن إعادة تعيين كلمة المرور على البريد');
  const query = similarQuery(keywords, { excludeSysId: SYS('a') });
  assert.equal(query, `short_descriptionLIKEتعيين^ORshort_descriptionLIKEإعاد^ORshort_descriptionLIKEبريد^ORshort_descriptionLIKEكلمة^sys_id!=${SYS('a')}^ORDERBYDESCsys_updated_on`);
  assert.ok(!query.includes('اعاد'), 'not the folded "اعاد"');
  assert.ok(!query.includes('كلمه'), 'not the folded "كلمه"');
});

test('no query operator gets into a term: carets, equals signs, at signs, colons, line breaks, invisible and full-width marks', () => {
  // Invisible and look-alike characters are built from code points, so the source shows what they are.
  const ch = (...codes) => String.fromCharCode(...codes);
  const RLM = ch(0x200f);
  const LINE_SEP = ch(0x2028);
  const nasty = [
    'بريد^ORsys_idISNOTEMPTY', 'البريد=javascript:alert(1)', 'بريد\nORDERBYsys_id', 'بريد@evil.example', `بريد${RLM}^${RLM}NQactive=true`,
    `طابعة${ch(0xff3e)}ORnumber${ch(0xff1d)}x`, `رسالة${ch(0x61b)}خطأ${ch(0x60c)}^ORDERBY`, 'cafe^ORsys_id!=x', 'Принтер^NQ', `vpn${LINE_SEP}^ORactive=false`,
    `بريد${ch(0)}^x`, `ja${ch(0x200b)}vascript:alert(1)`,
  ];
  for (const text of nasty) {
    const keywords = similarKeywords(text, 10);
    for (const w of keywords) {
      assert.match(w, /^[\p{L}\p{M}\p{N}_-]+$/u, `${JSON.stringify(text)} -> ${JSON.stringify(w)}`);
      assert.equal(queryTerm(w), w);
    }
    const query = similarQuery(keywords, { excludeSysId: SYS('b') });
    if (!query) continue;
    // Exactly the conditions we wrote: one LIKE per keyword, the exclusion and the order. Nothing else.
    const parts = query.split('^');
    assert.equal(parts.length, keywords.length + 2, query);
    parts.slice(0, keywords.length).forEach((p, i) => assert.equal(p, `${i ? 'OR' : ''}short_descriptionLIKE${keywords[i]}`));
    const rest = query.replace(`sys_id!=${SYS('b')}`, '');
    for (const bad of ['=', '@', ':', '\n', '\r', LINE_SEP, RLM, ch(0)]) assert.ok(!rest.includes(bad), `${JSON.stringify(bad)} in ${query}`);
  }
  assert.equal(queryTerm(`ب${ch(0x64e)}ر${ch(0x650)}يـد`), 'بريد', 'short vowels and tatweel go');
  assert.equal(queryTerm('a^b=c@d:e\nf g'), 'abcdefg');
  assert.equal(queryTerm(`e${ch(0x301)}`), ch(0xe9), 'composed (NFC), as stored text usually is');
  assert.equal(similarQuery(['^', '==', RLM]), '');
});

test('ranking compares folded text: hamza, alef maqsura, ta marbuta, diacritics and accents do not hide a shared word', () => {
  const rows = [
    { sys_id: '1', short_description: 'اعادة تعيين كلمة السر', sys_updated_on: '2026-01-01' },
    { sys_id: '2', short_description: 'إعادة التعيين', sys_updated_on: '2026-01-02' },
    { sys_id: '3', short_description: 'Impresora sin conexion', sys_updated_on: '2026-01-03' },
    { sys_id: '4', short_description: 'شيء آخر تماما', sys_updated_on: '2026-01-04' },
  ];
  const ranked = rankSimilar(rows, ['إعاد', 'تعيين', 'كلمة']);
  assert.deepEqual(ranked.map((r) => [r.row.sys_id, r.shared]), [['1', 3], ['2', 2]]);
  assert.deepEqual(rankSimilar(rows, ['conexión']).map((r) => r.row.sys_id), ['3']);
  assert.equal(matchKey('إعادة Café'), matchKey('اعاده CAFE'));
  assert.equal(matchKey('مُسْتَشْفَى'), 'مستشفي');
  assert.ok(textHas('الإلكترونيّ', 'الكتروني'));
  assert.ok(!textHas('شيء', ''));
});

// ---- end to end on the fake instance -----------------------------------------------------------------------------------------

const arabicIncidents = () => ({
  incident: [
    { sys_id: v(SYS('1')), number: v('INC0020001'), short_description: v('البريد الإلكتروني لا يعمل على الهاتف'), state: v('7', 'Closed'), close_notes: v('أعيد ضبط حساب البريد على الهاتف.'), close_code: v('Solved', 'تم الحل'), category: v('email', 'Email'), sys_updated_on: v('2026-10-01 10:00:00') },
    { sys_id: v(SYS('2')), number: v('INC0020002'), short_description: v('لا يصل البريد إلى صندوق الوارد'), state: v('7', 'Closed'), close_notes: v(''), category: v('email', 'Email'), sys_updated_on: v('2026-10-02 10:00:00') },
    { sys_id: v(SYS('3')), number: v('INC0020003'), short_description: v('الطابعة في الطابق الثالث معطلة'), state: v('7', 'Closed'), close_notes: v('تم تغيير الحبر'), category: v('hardware', 'Hardware'), sys_updated_on: v('2026-10-03 10:00:00') },
    { sys_id: v(SYS('4')), number: v('INC0020004'), short_description: v('Email not syncing on phone'), state: v('7', 'Closed'), close_notes: v('Re-added the account'), category: v('email', 'Email'), sys_updated_on: v('2026-10-04 10:00:00') },
    { sys_id: v(SYS('9')), number: v('INC0020009'), short_description: v('بريدي لا يعمل على هاتفي'), state: v('2', 'In Progress'), close_notes: v(''), category: v('email', 'Email'), sys_updated_on: v('2026-10-09 10:00:00') },
  ],
});

test('an Arabic ticket finds its Arabic look-alikes through the query it builds, never itself', async () => {
  const pack = { table: 'incident', sysId: SYS('9'), fields: { short_description: 'بريدي لا يعمل على هاتفي', category: 'Email' }, people: [] };
  const deps = fakeDeps(arabicIncidents());
  const { hits, keywords, access } = await findSimilarTickets(pack, deps);
  assert.deepEqual(keywords, ['بريد', 'هاتف']);
  assert.deepEqual(hits.map((h) => h.number), ['INC0020001', 'INC0020002']);
  assert.equal(hits[0].close_notes, 'أعيد ضبط حساب البريد على الهاتف.');
  assert.ok(hits[0].score > hits[1].score, 'two shared words and a fix beat one');
  assert.deepEqual(access.map((a) => a.status), ['ok']);
  const asked = deps.calls.find((c) => c.table === 'incident').query;
  assert.ok(asked.startsWith('short_descriptionLIKEبريد^ORshort_descriptionLIKEهاتف^'), asked);
  assert.ok(asked.includes(`sys_id!=${SYS('9')}`));
});

test('"steps that worked before" (resolved only) works for an Arabic ticket too', async () => {
  const pack = { table: 'incident', sysId: SYS('9'), fields: { short_description: 'مشكلة في البريد على الهاتف' }, people: [] };
  const { hits } = await findSimilarTickets(pack, fakeDeps(arabicIncidents()), { resolvedOnly: true });
  assert.deepEqual(hits.map((h) => h.number), ['INC0020001']);
});

const arabicArticles = () => ({
  kb_knowledge: [
    { sys_id: v(SYS('c')), number: v('KB0030001'), short_description: v('إعادة تعيين كلمة المرور'), text: v('<p>افتح بوابة الخدمة الذاتية واختر إعادة تعيين كلمة المرور.</p>'), workflow_state: v('published'), sys_updated_on: v('2026-09-01 10:00:00'), view_count: v('40') },
    { sys_id: v(SYS('d')), number: v('KB0030002'), short_description: v('إعداد البريد على الهاتف'), text: v('<p>أضف حساب البريد من الإعدادات.</p>'), workflow_state: v('published'), sys_updated_on: v('2026-09-02 10:00:00'), view_count: v('12') },
    { sys_id: v(SYS('e')), number: v('KB0030003'), short_description: v('Reset your password'), text: v('<p>Open the portal.</p>'), workflow_state: v('published'), sys_updated_on: v('2026-09-03 10:00:00'), view_count: v('99') },
  ],
});

test('knowledge that may help: an Arabic ticket finds Arabic articles; a typed Arabic search does too', async () => {
  const pack = { table: 'incident', sysId: SYS('9'), fields: { short_description: 'نسيت كلمة المرور', description: 'أحتاج إلى إعادة تعيين كلمة المرور الخاصة بي' }, people: [] };
  const found = await searchKnowledge(pack, fakeDeps(arabicArticles()), { now: Date.UTC(2026, 10, 6) });
  assert.equal(found.hits[0].number, 'KB0030001');
  assert.ok(!found.hits.some((h) => h.number === 'KB0030003'), 'the English article shares no word');

  assert.deepEqual(searchTerms('كيف أعيد تعيين كلمة المرور؟'), { number: '', keywords: ['تعيين', 'أعيد', 'كلمة', 'مرور'] });
  assert.equal(knowledgeSearchQuery({ keywords: ['بريد', 'هاتف'] }), 'workflow_state=published^short_descriptionLIKEبريد^ORtextLIKEبريد^short_descriptionLIKEهاتف^ORtextLIKEهاتف^ORDERBYDESCsys_updated_on');
  const typed = await searchKnowledgeText({ query: 'البريد على الهاتف' }, fakeDeps(arabicArticles()), { now: Date.UTC(2026, 10, 6) });
  assert.deepEqual(typed.hits.map((h) => h.number), ['KB0030002']);
  for (const nasty of ['بريد^ORsys_idISNOTEMPTY', 'كلمة=javascript:alert(1)', 'مرور\n^NQ']) {
    for (const w of searchTerms(nasty).keywords) assert.match(w, /^[\p{L}\p{M}\p{N}_-]+$/u, `${nasty} -> ${w}`);
  }
});

// ---- the knowledge tools: duplicate finder and gap radar ------------------------------------------------------------------------

test('knowledge words: Arabic marks stay inside the word, filler goes, and the stem makes spellings and forms meet', () => {
  assert.deepEqual(wordsOf('مُشْكِلَة في البـريد'), ['مُشْكِلَة', 'في', 'البـريد']);
  assert.equal(stem('الطابعات'), stem('طابعة'));
  assert.equal(stem('إلكتروني'), stem('الإلكتروني'));
  assert.equal(stem('الالكتروني'), stem('إلكتروني'), 'written without hamza');
  assert.equal(stem('مستخدمين'), stem('المستخدم'));
  assert.equal(arabicStem('تخزين'), 'تخزين', '"ين" is not a plural ending when 3 letters would remain');
  assert.equal(stem('حسابي'), stem('الحساب'));
  assert.deepEqual(stemsOf('كيفية إعادة تعيين كلمة المرور'), stemsOf('اعادة تعيين كلمات المرور'));
  assert.deepEqual(stemsOf('دليل استخدام الطابعة'), [stem('الطابعة')], '"guide" and "use" are title filler');
  const words = keywordsOf('مشكلة: لا أستطيع الدخول إلى البريد الإلكتروني يرجى المساعدة');
  assert.deepEqual(words.map((w) => w.form), ['الإلكتروني', 'البريد', 'الدخول'], 'forms are the words as written');
});

test('duplicate articles in Arabic group together, and the shared words are shown as written, not as stems', () => {
  const article = (n, title, views) => ({ sysId: `id${n}`, number: `KB${n}`, title, views, updated: '2026-01-01 00:00:00' });
  const clusters = findDuplicateClusters([
    article(1, 'كيفية إعادة تعيين كلمة المرور', 300),
    article(2, 'إعادة تعيين كلمات المرور', 20),
    article(3, 'اعادة تعيين كلمة المرور', 5),
    article(4, 'إعداد الطابعة في المكتب', 50),
  ]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].articles.map((a) => a.number), ['KB1', 'KB2', 'KB3']);
  assert.deepEqual([...clusters[0].sharedWords].sort(), ['إعادة', 'المرور', 'تعيين', 'كلمة'].sort());
  assert.equal(titleSimilarity('إعادة تعيين كلمة المرور', 'اعاده تعيين كلمه المرور').score, 1);
  const body = 'افتح الإعدادات ثم اختر الحساب ثم اضغط على إعادة التعيين';
  assert.equal(textSimilarity(body, 'افتح الاعدادات ثم اختر الحساب ثم اضغط على اعادة التعيين').containment, 1);
});

test('the gap radar groups Arabic tickets by their words; the caller\'s name and Arabic-Indic phone numbers never become a label', () => {
  let n = 0;
  const ticket = (title, who = []) => {
    n += 1;
    return { table: 'incident', sysId: `s${n}`, number: `INC${n}`, title, who, category: '', ci: '', fixLength: 0 };
  };
  const clusters = clusterTickets([
    ticket('لا يعمل البريد الإلكتروني على الهاتف'),
    ticket('مشكلة في البريد على هاتفي'),
    ticket('البريد لا يفتح على الهاتف المحمول'),
    ticket('أحمد العتيبي لا يستطيع الطباعة', ['أحمد العتيبي']),
    ticket('احمد عتيبي الطابعة لا تعمل', ['أحمد العتيبي']),
    ticket('اتصل على ٠٥٠١٢٣٤٥٦٧ بخصوص الشاشة'),
    ticket('اتصل على ٠٥٠١٢٣٤٥٦٧ بخصوص الفأرة'),
  ]);
  assert.equal(clusters[0].count, 3);
  assert.match(clusters[0].label, /البريد/);
  assert.match(clusters[0].label, /الهاتف|هاتفي/);
  for (const c of clusters) {
    assert.ok(!/حمد|عتيب|٠٥٠/.test(c.label), c.label);
  }
});

// ---- the shared Arabic rule builder ----------------------------------------------------------------------------------------

test('arabicRule: whole words in folded text, with the article and a one-letter prefix allowed, never inside another word', () => {
  const re = arabicRule(['خطأ', 'رسالة الخطأ']);
  assert.ok(re.test(arabicFolded('ظهرت رسالة الخطأ')));
  assert.ok(re.test(arabicFolded('وبالخطأ نفسه')));
  assert.ok(re.test(arabicFolded('خطأٌ')), 'tanween is folded away');
  assert.ok(!re.test(arabicFolded('وصلني خطاب')), '"خطاب" (a letter) is another word');
  assert.ok(!re.test(arabicFolded('أخطاء كثيرة')), 'only what the list names');
  assert.equal(arabicFolded('English only'), '', 'nothing to match');
  const counted = arabicRule(['شكرا'], 'gu');
  assert.equal((arabicFolded('شكراً، شكرا جزيلا').match(counted) || []).length, 2);
});
