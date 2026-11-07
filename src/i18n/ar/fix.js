// Arabic texts: Find the fix: error codes and who solved it before (round 4, docs/round4.md). Owned by the Find the fix agent; see src/i18n/ar/index.js.

// The six plural forms of Arabic (zero, one, two, few = 3 to 10, many = 11 to 99, other).
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_FIX = {
  // "Steps that worked before" (src/sidepanel/ticket/cards/StepsCard.jsx): the error code the ticket quotes and its one search
  'Error {code} found': 'عثر على الخطأ {code}',
  'Error code in the short description': 'رمز الخطأ في الوصف المختصر',
  'Error code in the description': 'رمز الخطأ في الوصف',
  'Error code in the notes': 'رمز الخطأ في الملاحظات',
  'Error codes in the ticket': 'رموز الخطأ في التذكرة',
  'Search articles and solved tickets': 'ابحث في المقالات والتذاكر المحلولة',
  'Articles: {articles}. Solved tickets: {tickets}.': 'المقالات: {articles}. التذاكر المحلولة: {tickets}.',
  'Mentions {code}': 'يذكر {code}',

  // "Solved before by" (src/insights/solvedBy.js): the group most solved look-alikes went to, and who in it solved most of them
  'Solved before by': 'حلتها من قبل',
  'Solved before by {groups}': 'حلتها من قبل {groups}',
  'solved before by {groups}': 'حلتها من قبل {groups}',
  'Solved {n} time before by {group}|Solved {n} times before by {group}': pl(
    'حلتها {group} من قبل {n} مرة',
    'حلتها {group} من قبل مرة واحدة',
    'حلتها {group} من قبل مرتين',
    'حلتها {group} من قبل {n} مرات',
    'حلتها {group} من قبل {n} مرة',
    'حلتها {group} من قبل {n} مرة'
  ),
  'solved {n} time before by {group}|solved {n} times before by {group}': pl(
    'حلتها {group} من قبل {n} مرة',
    'حلتها {group} من قبل مرة واحدة',
    'حلتها {group} من قبل مرتين',
    'حلتها {group} من قبل {n} مرات',
    'حلتها {group} من قبل {n} مرة',
    'حلتها {group} من قبل {n} مرة'
  ),
  '{group}: {n} solved look-alike|{group}: {n} solved look-alikes': pl(
    '{group}: {n} تذكرة مشابهة محلولة',
    '{group}: تذكرة مشابهة محلولة واحدة',
    '{group}: تذكرتان مشابهتان محلولتان',
    '{group}: {n} تذاكر مشابهة محلولة',
    '{group}: {n} تذكرة مشابهة محلولة',
    '{group}: {n} تذكرة مشابهة محلولة'
  ),
  '{groups}: {n} solved look-alike each|{groups}: {n} solved look-alikes each': pl(
    '{groups}: {n} تذكرة مشابهة محلولة لكل منها',
    '{groups}: تذكرة مشابهة محلولة واحدة لكل منها',
    '{groups}: تذكرتان مشابهتان محلولتان لكل منها',
    '{groups}: {n} تذاكر مشابهة محلولة لكل منها',
    '{groups}: {n} تذكرة مشابهة محلولة لكل منها',
    '{groups}: {n} تذكرة مشابهة محلولة لكل منها'
  ),
  '{name} solved {n} of them|{name} solved {n} of them': pl(
    'حل {name} {n} منها',
    'حل {name} واحدة منها',
    'حل {name} اثنتين منها',
    'حل {name} {n} منها',
    'حل {name} {n} منها',
    'حل {name} {n} منها'
  ),
};
