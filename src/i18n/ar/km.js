// Arabic texts: the knowledge manager's coverage lines (wave 6 of 2026-11-07; docs/live-questions/audit-1107-km.md). The Duplicates and
// Gaps tools say how much they looked at ("Compared 300 of 1,240 articles in ..."), why a group is a group, and how many tickets stand
// behind a topic. The English text is the key; the six plural forms of Arabic follow src/i18n/ar/write.js.
//
// The FIRST export is the table (tests/i18n.test.js reads each file's first export). AR_KM_RETIRED lists the old English texts these
// replace: no text uses them any more, so withKm drops them from the catalogue (they live in write.js). Apply it LAST:
//
//   export const AR = withKm(withFinish2(withWords({ ...AR_LANGUAGE, ..., ...AR_FINISH })));   // src/i18n/ar/index.js

// The six plural forms of Arabic, in this order.
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_KM = {
  // ---- The scope of a comparison, by its names ----
  '{base}, category {category}': '{base}، الفئة {category}',
  'category {category}': 'الفئة {category}',
  'all knowledge bases': 'كل قواعد المعرفة',

  // ---- The Duplicates line: how many were compared of how many ----
  'Compared {n} of {total} article in {scope}.|Compared {n} of {total} articles in {scope}.': pl(
    'تمت مقارنة {n} من {total} مقالة في {scope}.',
    'تمت مقارنة {n} من مقالة واحدة في {scope}.',
    'تمت مقارنة {n} من مقالتين في {scope}.',
    'تمت مقارنة {n} من {total} مقالات في {scope}.',
    'تمت مقارنة {n} من {total} مقالة في {scope}.',
    'تمت مقارنة {n} من {total} مقالة في {scope}.'
  ),
  'Compared {n} of an unknown number of articles in {scope}.': 'تمت مقارنة {n} من عدد غير معروف من المقالات في {scope}.',
  'There was nothing to compare.': 'لم يكن هناك ما يمكن مقارنته.',
  'No duplicates found.': 'لم يتم العثور على مكررات.',
  'No duplicates among the {n} compared.': 'لم يتم العثور على مكررات بين المقالات التي تمت مقارنتها ({n}).',
  'A category this large cannot be compared in full.': 'لا يمكن مقارنة فئة بهذا الحجم كاملة.',
  'The other {m} could not be read; your role may hide them.': 'تعذرت قراءة الـ {m} الأخرى؛ فقد يخفيها دورك.',
  'Showing the {shown} biggest of {total} groups.': 'عرض أكبر {shown} مجموعة من أصل {total}.',
  'Compare the next {n}': 'قارن المقالات التالية ({n})',
  '{n} smaller category is not listed.|{n} smaller categories are not listed.': pl(
    '{n} فئة أصغر غير مدرجة.',
    'فئة أصغر واحدة غير مدرجة.',
    'فئتان أصغر غير مدرجتين.',
    '{n} فئات أصغر غير مدرجة.',
    '{n} فئة أصغر غير مدرجة.',
    '{n} فئة أصغر غير مدرجة.'
  ),
  '{n} smaller knowledge base is not listed.|{n} smaller knowledge bases are not listed.': pl(
    '{n} قاعدة معرفة أصغر غير مدرجة.',
    'قاعدة معرفة أصغر واحدة غير مدرجة.',
    'قاعدتا معرفة أصغر غير مدرجتين.',
    '{n} قواعد معرفة أصغر غير مدرجة.',
    '{n} قاعدة معرفة أصغر غير مدرجة.',
    '{n} قاعدة معرفة أصغر غير مدرجة.'
  ),

  // ---- Why a group is a group (the grouping looks at the words of the titles, nothing else) ----
  'The titles use the same words.': 'تستخدم العناوين الكلمات نفسها.',
  'The titles share {words} and are about {percent} alike.': 'تشترك العناوين في {words} وهي متشابهة بنسبة {percent} تقريبا.',
  'The titles are about {percent} alike.': 'العناوين متشابهة بنسبة {percent} تقريبا.',
  'All are in the category {category}.': 'كلها في الفئة {category}.',
  'They are in different categories.': 'هي في فئات مختلفة.',

  // ---- The Gaps line when the read was cut and the total could not be counted ----
  'Looked at the newest {n} of an unknown number of tickets resolved in the last {days} days {scope}.': 'تم النظر في أحدث {n} من عدد غير معروف من التذاكر المحلولة في آخر {days} يوما {scope}.',
  'Looked at the newest {n} of an unknown number of tickets resolved in the last {days} days.': 'تم النظر في أحدث {n} من عدد غير معروف من التذاكر المحلولة في آخر {days} يوما.',

  // ---- How many tickets stand behind a topic ----
  '{n} ticket, {m} with a written fix|{n} tickets, {m} with a written fix': pl(
    '{n} تذكرة، منها {m} بحل مكتوب',
    'تذكرة واحدة، منها {m} بحل مكتوب',
    'تذكرتان، منها {m} بحل مكتوب',
    '{n} تذاكر، منها {m} بحل مكتوب',
    '{n} تذكرة، منها {m} بحل مكتوب',
    '{n} تذكرة، منها {m} بحل مكتوب'
  ),
};

// The English texts these replace (in write.js): "Compared 300 of 1,240 titles.", "Compared 12 titles.", "Compare 300 more",
// "No near-duplicates found." and the chip "2 with a written fix" (now part of the line under the topic).
export const AR_KM_RETIRED = [
  'Compared {n} of {total} titles.',
  'Compared {n} title.|Compared {n} titles.',
  'Compare {count} more',
  'No near-duplicates found.',
  '{withFix} with a written fix',
];

/** The catalogue with these texts added and the retired ones removed (also from the files that were merged before it). */
export function withKm(base) {
  const out = { ...base, ...AR_KM };
  for (const key of AR_KM_RETIRED) delete out[key];
  return Object.freeze(out);
}
