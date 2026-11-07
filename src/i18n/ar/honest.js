// Arabic texts: "honest reads" (audit of 2026-11-07, part 3). Where the panel used to state an absence as a fact ("no earlier tickets",
// "no other open tickets", "nobody is named", "no warning signs") it now says so only when the read for it completed, and otherwise says
// plainly that it could not check. The English text is the key. Style: docs/i18n-arabic.md; the lead wires this file into
// src/i18n/ar/index.js (spread AR_HONEST into AR).
const forms = (one, two, few, many) => ({ zero: many, one, two, few, many, other: many });

export const AR_HONEST = {
  // ---- src/context: what the read could not see ------------------------------------------------------------------------------------
  '{thing}: part of this ticket is hidden from you, so this could not be looked up.': '{thing}: جزء من هذه التذكرة مخفي عنك، لذلك تعذر البحث عن هذا.',
  'No notes or comments that you can see.': 'لا توجد ملاحظات أو تعليقات تراها.',
  'Internal notes': 'الملاحظات الداخلية',
  'Comments to the customer': 'التعليقات الموجهة إلى العميل',
  'some may be hidden from you': 'قد يكون بعضها مخفيا عنك',
  'Some internal notes may be hidden from you.': 'قد تكون بعض الملاحظات الداخلية مخفية عنك.',
  'Some comments to the customer may be hidden from you.': 'قد تكون بعض التعليقات الموجهة إلى العميل مخفية عنك.',
  '{n} of {total} people have an email address that you cannot read.': '{n} من {total} أشخاص لديهم بريد إلكتروني لا تستطيع قراءته.',

  // ---- src/insights: the lines of the cards ----------------------------------------------------------------------------------------
  'Could not check solved tickets': 'تعذر التحقق من التذاكر المحلولة',
  'Could not read who the caller is': 'تعذرت قراءة من هو المتصل',
  'Could not check all earlier tickets': 'تعذر التحقق من كل التذاكر السابقة',
  'some could not be checked': 'تعذر التحقق من بعضها',
  'At least {n} earlier ticket|At least {n} earlier tickets': forms('{n} تذكرة سابقة على الأقل', '{n} تذكرتان سابقتان على الأقل', '{n} تذاكر سابقة على الأقل', '{n} تذكرة سابقة على الأقل'),
  'No other open tickets found on {target} in the last {hours}': 'لم تُوجد تذاكر مفتوحة أخرى على {target} خلال آخر {hours}',
  'Could not check other open tickets on this item': 'تعذر التحقق من تذاكر مفتوحة أخرى على هذا العنصر',
  'At least {n} other open ticket on {target} in the last {hours}|At least {n} other open tickets on {target} in the last {hours}': forms(
    '{n} تذكرة مفتوحة أخرى على الأقل على {target} خلال آخر {hours}',
    '{n} تذكرتان مفتوحتان أخريان على الأقل على {target} خلال آخر {hours}',
    '{n} تذاكر مفتوحة أخرى على الأقل على {target} خلال آخر {hours}',
    '{n} تذكرة مفتوحة أخرى على الأقل على {target} خلال آخر {hours}'
  ),
  'the SLA': 'اتفاقية مستوى الخدمة',
  'the VIP flag': 'علامة VIP',
  'other open tickets on the same item': 'التذاكر المفتوحة الأخرى على العنصر نفسه',
  'the notes': 'الملاحظات',
  'how often it was reopened or reassigned': 'عدد مرات إعادة فتحها أو إعادة إسنادها',
  'No warning signs found; could not check {list}': 'لم تُوجد علامات تحذير؛ وتعذر التحقق من {list}',
  'Chase: the owner (not shown to you)': 'تابع مع: المسؤول (غير ظاهر لك)',
  '{group} (owner not shown to you)': '{group} (المسؤول غير ظاهر لك)',
  'Owner not shown to you': 'المسؤول غير ظاهر لك',

  // ---- src/sidepanel/ticket/cards ---------------------------------------------------------------------------------------------------
  '(short description not shown to you)': '(الوصف المختصر غير ظاهر لك)',
  'The account of this case could not be read.': 'تعذرت قراءة حساب هذه الحالة.',
  'No approvals that you can see are recorded.': 'لا توجد موافقات مسجلة تراها.',
  'None that you can see.': 'لا شيء تراه.',
  'The caller could not be read, so earlier tickets were not looked up.': 'تعذرت قراءة المتصل، لذلك لم يُبحث عن تذاكر سابقة.',
  'No earlier tickets found, but some could not be checked.': 'لم تُوجد تذاكر سابقة، لكن تعذر التحقق من بعضها.',
  'Could not check changes': 'تعذر التحقق من التغييرات',
  'Could not check problems': 'تعذر التحقق من المشكلات',
  'Could not check articles': 'تعذر التحقق من المقالات',
  'Could not check everything': 'تعذر التحقق من كل شيء',
  'No published article found, but some could not be checked. Try the Knowledge screen to search yourself.': 'لم يُعثر على مقال منشور، لكن تعذر التحقق من بعضها. جرّب شاشة المعرفة للبحث بنفسك.',
  'No published article found among the newest matches for the words of this ticket. Try the Knowledge screen to search yourself.':
    'لم يُعثر على مقال منشور بين أحدث المقالات المطابقة لكلمات هذه التذكرة. جرّب شاشة المعرفة للبحث بنفسك.',
  "Copy the article's address. Check that the customer can open it.": 'انسخ عنوان المقال. تأكد أن العميل يستطيع فتحه.',
  'Nothing obvious missing; could not check {list}': 'لا شيء واضح ناقص؛ وتعذر التحقق من {list}',
  'Could not check: {list}. That part of the ticket is hidden from you.': 'تعذر التحقق من: {list}. هذا الجزء من التذكرة مخفي عنك.',
  'No similar solved tickets found, but some could not be checked.': 'لم تُوجد تذاكر محلولة مشابهة، لكن تعذر التحقق من بعضها.',
  'No similar solved ticket found among the newest matches.': 'لم تُوجد تذكرة محلولة مشابهة بين أحدث التذاكر المطابقة.',
  'Could not check {list}, so a risk there would not show.': 'تعذر التحقق من {list}، لذلك قد لا يظهر خطر يتعلق بها.',
  'No solved look-alikes were found, but some could not be checked.': 'لم تُوجد تذاكر محلولة مشابهة، لكن تعذر التحقق من بعضها.',
  'No article or solved ticket found that mentions {code}.': 'لم يُعثر على مقال أو تذكرة محلولة تذكر {code}.',
  'Nothing found that mentions {code}, but some could not be checked.': 'لم يُعثر على ما يذكر {code}، لكن تعذر التحقق من بعضه.',
  'No solved ticket or article with written steps found, but some could not be checked.': 'لم يُعثر على تذكرة محلولة أو مقال بخطوات مكتوبة، لكن تعذر التحقق من بعضها.',

  // ---- src/checks: the checks before resolving ------------------------------------------------------------------------------------
  'This task is open. Who has it is not shown to you.': 'هذه المهمة مفتوحة. من يتولاها غير ظاهر لك.',
  'In progress. Nothing is blocking it; who has it is not shown to you{caution}.': 'قيد التنفيذ. لا شيء يعيقه؛ ومن يتولاه غير ظاهر لك{caution}.',
  'Could not read the saved resolution notes': 'تعذرت قراءة ملاحظات الحل المحفوظة',
  'ServiceNow did not send them to you. Check on the form whether they are filled in.': 'لم يرسلها ServiceNow إليك. تحقق في النموذج هل هي معبأة.',
  'Could not read the saved close code': 'تعذرت قراءة رمز الإغلاق المحفوظ',
  'ServiceNow did not send it to you. Check on the form whether one is chosen.': 'لم يرسله ServiceNow إليك. تحقق في النموذج هل تم اختيار رمز.',
  'No {things} that you can see under this ticket': 'لا شيء من {things} ظاهر لك تحت هذه التذكرة',

  // ---- src/reports/engine: names the person may not see ----------------------------------------------------------------------------
  'A person you cannot see': 'شخص لا يمكنك رؤيته',
  'A group you cannot see': 'مجموعة لا يمكنك رؤيتها',
  'Not shown to you': 'غير ظاهر لك',
  // My work: a risk fact that could not be read (src/mywork/risk.js ticketsWithUnreadFacts, src/sidepanel/mywork/cards.jsx)
  '{n} ticket has facts that could not be read, so At risk may be incomplete.|{n} tickets have facts that could not be read, so At risk may be incomplete.': {
    zero: '{n} تذاكر فيها بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
    one: '{n} تذكرة فيها بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
    two: '{n} تذكرتان فيهما بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
    few: '{n} تذاكر فيها بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
    many: '{n} تذكرة فيها بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
    other: '{n} تذكرة فيها بيانات تعذرت قراءتها، لذلك قد يكون «معرض للخطر» ناقصا.',
  },
};
