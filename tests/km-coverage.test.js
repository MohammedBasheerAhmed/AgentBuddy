import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_KM } from '../src/i18n/ar/km.js';
import { MAX_GROUPS, MAX_TITLES, duplicatesCoverage, groupWhy, groupsShown, lookedAtText, scopeText, topicBacking } from '../src/sidepanel/knowledge/coverage.js';
import { afterPage } from '../src/sidepanel/knowledge/DuplicatesPanel.jsx';

// Wave 6, knowledge manager: what the Duplicates and Gaps tools say about how much they looked at. "No duplicates found." is said only
// when everything in the scope was compared; a total that is not known, a page that ended early and a cap are each said in words.

test.afterEach(() => setLanguage('en'));

const base = { base: 'IT Knowledge Base' };

test('compared of how many, in which scope: the line is always there, with the names the person chose from', () => {
  assert.equal(duplicatesCoverage({ compared: 300, total: 1240, truncated: true, next: 300, ...base }).line, 'Compared 300 of 1,240 articles in IT Knowledge Base.');
  assert.equal(duplicatesCoverage({ compared: 1, total: 1, ...base }).line, 'Compared 1 of 1 article in IT Knowledge Base.');
  assert.equal(duplicatesCoverage({ compared: 12, total: 12, ...base, category: 'VPN' }).line, 'Compared 12 of 12 articles in IT Knowledge Base, category VPN.');
  assert.equal(duplicatesCoverage({ compared: 300, total: null, truncated: true, next: 300, ...base }).line, 'Compared 300 of an unknown number of articles in IT Knowledge Base.');
  assert.equal(scopeText(), 'all knowledge bases', 'no scope named: all of them');
  assert.equal(scopeText({ category: 'VPN' }), 'category VPN');
  // the count is the instance's own: it is never smaller than what was compared
  assert.equal(duplicatesCoverage({ compared: 305, total: 300, ...base }).line, 'Compared 305 of 305 articles in IT Knowledge Base.');
});

test('"No duplicates found." only when everything in the scope was compared; otherwise "among the N compared"', () => {
  const none = (extra) => duplicatesCoverage({ compared: 300, groups: 0, ...base, ...extra });
  assert.equal(none({ total: 300 }).verdict, 'No duplicates found.');
  assert.equal(none({ total: 300 }).complete, true);
  assert.equal(none({ total: 1240, truncated: true, next: 300 }).verdict, 'No duplicates among the 300 compared.');
  assert.equal(none({ total: null }).verdict, 'No duplicates among the 300 compared.', 'an unknown total is never complete');
  assert.equal(none({ total: null, truncated: true, next: 300 }).verdict, 'No duplicates among the 300 compared.');
  assert.equal(none({ total: 1000, truncated: false }).verdict, 'No duplicates among the 300 compared.', 'the pages ended short of the count');
  assert.equal(none({ total: 4000, truncated: true, next: null }).verdict, 'No duplicates among the 300 compared.', 'capped');
  assert.equal(duplicatesCoverage({ compared: 0, total: 0, ...base }).verdict, 'There was nothing to compare.');
  assert.equal(duplicatesCoverage({ compared: 0, total: null, ...base }).verdict, 'There was nothing to compare.');
  assert.equal(duplicatesCoverage({ compared: 300, total: 1240, groups: 3, truncated: true, next: 300, ...base }).verdict, '3 groups read alike.');
  assert.equal(duplicatesCoverage({ compared: 5, total: 5, groups: 1, ...base }).verdict, '1 group read alike.');
});

test('the invariant: whatever the numbers, a clean "No duplicates found." never comes with an unread article', () => {
  const totals = [null, 0, 1, 5, 299, 300, 301, 1240, 5000];
  const compared = [0, 1, 5, 299, 300, 600, 1500];
  const nexts = [null, 300, 600];
  for (const total of totals) {
    for (const n of compared) {
      for (const truncated of [true, false]) {
        for (const next of nexts) {
          for (const ended of [true, false]) {
            const out = duplicatesCoverage({ compared: n, total, truncated, next, ended, groups: 0, ...base });
            if (out.verdict === 'No duplicates found.') {
              assert.ok(Number.isFinite(total) && n >= total && n > 0 && !out.more, JSON.stringify({ total, n, truncated, next }));
            }
            // a continue button exists only while the count says more follow and there is somewhere to go
            assert.equal(Boolean(out.more), Boolean(truncated && next !== null), JSON.stringify({ total, n, truncated, next }));
            // a stop that is not the end of the base is always explained
            if (truncated && next === null) assert.ok(out.capped && out.hints.length === 1);
          }
        }
      }
    }
  }
});

test('"Compare the next N": 300 at most, the rest when fewer remain, 300 when the total is not known', () => {
  assert.deepEqual(duplicatesCoverage({ compared: 300, total: 1240, truncated: true, next: 300 }).more, { next: 300, count: 300 });
  assert.deepEqual(duplicatesCoverage({ compared: 900, total: 1000, truncated: true, next: 900 }).more, { next: 900, count: 100 });
  assert.deepEqual(duplicatesCoverage({ compared: 300, total: null, truncated: true, next: 300 }).more, { next: 300, count: 300 });
  // the window counts raw positions: a short page (hidden rows) still leaves a full window to go
  assert.deepEqual(duplicatesCoverage({ compared: 200, total: 1000, truncated: true, next: 300 }).more, { next: 300, count: 300 });
  assert.equal(duplicatesCoverage({ compared: 300, total: 300, truncated: false, next: null }).more, null);
});

test('a page that cannot be advanced further says so: the cap, a category that is too big, the count not reached, an empty page', () => {
  const capped = duplicatesCoverage({ compared: 1500, total: 4200, truncated: true, next: null, ...base });
  assert.equal(capped.capped, true);
  assert.deepEqual(capped.hints, ['Only the 1,500 most recently changed articles were compared (of 4,200). Choose a category to narrow it.']);
  assert.deepEqual(duplicatesCoverage({ compared: 1500, total: null, truncated: true, next: null, ...base }).hints, ['Only the 1,500 most recently changed articles were compared. Choose a category to narrow it.']);
  assert.deepEqual(duplicatesCoverage({ compared: 1500, total: 4200, truncated: true, next: null, ...base, category: 'VPN' }).hints, ['A category this large cannot be compared in full.']);
  // the instance counts 1,000; this person could read 650 of them
  const short = duplicatesCoverage({ compared: 650, total: 1000, truncated: false, next: null, ended: true, ...base });
  assert.deepEqual(short.hints, ['There are no more articles to compare.', 'The other 350 could not be read; your role may hide them.']);
  assert.deepEqual(duplicatesCoverage({ compared: 650, total: 1000, truncated: false, next: null, ...base }).hints, ['The other 350 could not be read; your role may hide them.']);
  assert.deepEqual(duplicatesCoverage({ compared: 650, total: null, truncated: false, next: null, ended: true, ...base }).hints, ['There are no more articles to compare.']);
  assert.deepEqual(duplicatesCoverage({ compared: 300, total: 300, ...base }).hints, [], 'nothing to explain when everything was compared');
  assert.deepEqual(duplicatesCoverage({ compared: 300, total: 1240, truncated: true, next: 300, ...base }).hints, [], 'and nothing while there is a button');
  assert.equal(MAX_TITLES, 1500);
  assert.equal(MAX_GROUPS, 100);
});

test('the groups on screen are not all that were found: it says so', () => {
  assert.equal(groupsShown(100, 161), 'Showing the 100 biggest of 161 groups.');
  assert.equal(groupsShown(25, 25), '');
  assert.equal(groupsShown(3, 3), '');
});

// ---- the answer of one page, kept with the pages before it -------------------------------------------------------------------

test('afterPage: pages add up, the count of the first page stays, the next offset follows the answer', () => {
  const a = (n) => ({ sysId: String(n).padStart(32, '0'), number: `KB${n}`, title: `T${n}` });
  const first = afterPage(null, { articles: [a(1), a(2)], total: 700, truncated: true, next: 300, access: [] }, 0);
  assert.deepEqual([first.pages.length, first.total, first.truncated, first.next, first.ended], [1, 700, true, 300, false]);
  const second = afterPage(first, { articles: [a(3)], total: 700, truncated: true, next: 600 }, 300);
  assert.deepEqual([second.pages.length, second.total, second.next], [2, 700, 600]);
  const third = afterPage(second, { articles: [a(4)], truncated: false, next: null }, 600);
  assert.deepEqual([third.pages.length, third.total, third.next, third.truncated], [3, 700, null, false], 'a later answer without a count keeps the first one');
  const empty = afterPage(third, { articles: [], truncated: false, next: null }, 900);
  assert.equal(empty.ended, true, 'an empty page past the first is the end');
  const restart = afterPage(third, { articles: [a(9)], total: 1, truncated: false, next: null }, 0);
  assert.deepEqual([restart.pages.length, restart.total], [1, 1], 'a first page starts the pages over');
  // an answer from a script that has no `next`: the next page starts after this one; past the cap there is none
  assert.equal(afterPage(null, { articles: [a(1), a(2)], truncated: true }, 0).next, 2);
  assert.equal(afterPage(null, { articles: [a(1)], truncated: true, next: null }, 0).next, null, 'an explicit null is the cap: it is not guessed');
  assert.equal(afterPage(null, { articles: [a(1)], truncated: true, next: 1500 }, 1200).next, null, 'past the offsets one scan can ask for');
  assert.equal(afterPage(null, { articles: Array.from({ length: 300 }, (_, i) => a(i)), truncated: true }, 1200).next, null);
  // nothing the page says can crash it
  assert.deepEqual(afterPage(null, null, 0).pages, [[]]);
  assert.deepEqual(afterPage(null, 'not an answer', 0).pages, [[]]);
  assert.deepEqual(afterPage(null, 42, 0).pages, [[]]);
  assert.equal(afterPage(null, { articles: 'x', total: 'y', truncated: 1 }, 0).total, null);
});

// ---- why a group is a group ----------------------------------------------------------------------------------------------------

const art = (category) => ({ sysId: category + Math.random(), category });

test('a group says why it is one, from what the grouping uses: the words of the titles', () => {
  assert.equal(groupWhy({ exactTitle: true, score: 1, sharedWords: ['reset', 'vpn'], articles: [] }), 'The titles use the same words.');
  assert.equal(groupWhy({ exactTitle: false, score: 0.72, sharedWords: ['reset', 'vpn', 'password'], articles: [] }), 'The titles share reset, vpn, password and are about 72% alike.');
  assert.equal(groupWhy({ exactTitle: false, score: 0.6, sharedWords: [], articles: [] }), 'The titles are about 60% alike.');
  assert.equal(groupWhy({ exactTitle: false, score: 0.6, sharedWords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], articles: [] }), 'The titles share a, b, c, d, e, f and are about 60% alike.', 'six words at most');
  assert.equal(groupWhy({}), 'The titles are about 0% alike.', 'nothing the group lacks can crash it');
  // never a reason the grouping does not use
  for (const c of [{ exactTitle: true }, { score: 0.7, sharedWords: ['vpn', 'reset'] }, { score: 0.7 }]) assert.ok(!/text|paragraph|author|view/i.test(groupWhy(c)));
});

test('the category is a plain fact beside it (not a reason), and only when the scan is not already by category', () => {
  const same = { exactTitle: true, articles: [art('VPN'), art('VPN')] };
  assert.equal(groupWhy(same), 'The titles use the same words. All are in the category VPN.');
  assert.equal(groupWhy({ ...same, articles: [art('VPN'), art('Email')] }), 'The titles use the same words. They are in different categories.');
  assert.equal(groupWhy(same, { showCategory: false }), 'The titles use the same words.');
  assert.equal(groupWhy({ ...same, articles: [art('VPN'), art('')] }), 'The titles use the same words.', 'an article with no category: nothing is said');
});

// ---- the gaps line ---------------------------------------------------------------------------------------------------------------

test('Looked at: the read, the count it was cut from, and "an unknown number" when the read was cut and could not be counted', () => {
  assert.equal(lookedAtText({ scanned: 500, total: 12400, days: 60 }, 'in your 3 groups'), 'Looked at 500 of 12,400 tickets resolved in the last 60 days in your 3 groups.');
  assert.equal(lookedAtText({ scanned: 500, total: 12400, days: 60 }), 'Looked at 500 of 12,400 tickets resolved in the last 60 days.');
  assert.equal(lookedAtText({ scanned: 4, total: 4, days: 30 }), 'Looked at 4 tickets resolved in the last 30 days.');
  assert.equal(lookedAtText({ scanned: 1, total: 1, days: 30 }, 'in category Network'), 'Looked at 1 ticket resolved in the last 30 days in category Network.');
  assert.equal(lookedAtText({ scanned: 500, total: null, truncated: true, days: 60 }), 'Looked at the newest 500 of an unknown number of tickets resolved in the last 60 days.');
  assert.equal(lookedAtText({ scanned: 500, total: null, truncated: true, days: 60 }, 'in your group'), 'Looked at the newest 500 of an unknown number of tickets resolved in the last 60 days in your group.');
  assert.equal(lookedAtText({ scanned: 7, total: null, truncated: false, days: 60 }), 'Looked at 7 tickets resolved in the last 60 days.', 'a read that was not cut is complete even when it could not be counted');
  assert.equal(lookedAtText({ scanned: 0, total: null, truncated: true, days: 60 }), 'Looked at 0 tickets resolved in the last 60 days.');
});

test('how many tickets stand behind a topic, and how many of them hold a written fix: always on screen, zero included', () => {
  assert.equal(topicBacking({ count: 3, withFix: 2 }), '3 tickets, 2 with a written fix');
  assert.equal(topicBacking({ count: 1, withFix: 1 }), '1 ticket, 1 with a written fix');
  assert.equal(topicBacking({ count: 5, withFix: 0 }), '5 tickets, 0 with a written fix');
  assert.equal(topicBacking({ count: 1200, withFix: 80 }), '1200 tickets, 80 with a written fix'.replace('1200', '1200'));
  assert.equal(topicBacking({}), '0 tickets, 0 with a written fix');
});

// ---- in Arabic ---------------------------------------------------------------------------------------------------------------------

test('the lines read in Arabic (digits stay ASCII, names stay whole, nothing is left in English)', () => {
  registerCatalogue('ar', AR_KM);
  setLanguage('ar');
  const line = duplicatesCoverage({ compared: 300, total: 1240, truncated: true, next: 300, groups: 0, base: 'IT Knowledge Base' });
  assert.match(line.line, /^تمت مقارنة 300 من 1,240 مقالة في ⁨IT Knowledge Base⁩\.$/);
  assert.equal(line.verdict, 'لم يتم العثور على مكررات بين المقالات التي تمت مقارنتها (300).');
  assert.equal(duplicatesCoverage({ compared: 2, total: 2 }).line, 'تمت مقارنة 2 من مقالتين في كل قواعد المعرفة.');
  assert.equal(duplicatesCoverage({ compared: 1, total: 1, base: 'X' }).line.includes('مقالة واحدة'), true);
  assert.equal(duplicatesCoverage({ compared: 300, total: 300, base: 'X' }).verdict, 'لم يتم العثور على مكررات.');
  assert.equal(duplicatesCoverage({ compared: 650, total: 1000, base: 'X' }).hints[0], 'تعذرت قراءة الـ 350 الأخرى؛ فقد يخفيها دورك.');
  assert.equal(duplicatesCoverage({ compared: 650, total: null, truncated: true, next: 300, base: 'X' }).line.startsWith('تمت مقارنة 650 من عدد غير معروف'), true);
  assert.equal(duplicatesCoverage({ compared: 300, total: 900, truncated: true, next: 300, base: 'X' }).more.count, 300);
  assert.equal(groupWhy({ exactTitle: false, score: 0.5, sharedWords: ['vpn'], articles: [] }), 'تشترك العناوين في ⁨vpn⁩ وهي متشابهة بنسبة 50% تقريبا.');
  assert.equal(topicBacking({ count: 3, withFix: 2 }), '3 تذاكر، منها 2 بحل مكتوب');
  assert.equal(topicBacking({ count: 2, withFix: 0 }), 'تذكرتان، منها 0 بحل مكتوب');
  assert.equal(topicBacking({ count: 11, withFix: 4 }), '11 تذكرة، منها 4 بحل مكتوب');
  assert.equal(lookedAtText({ scanned: 500, total: null, truncated: true, days: 60 }), 'تم النظر في أحدث 500 من عدد غير معروف من التذاكر المحلولة في آخر 60 يوما.');
});
