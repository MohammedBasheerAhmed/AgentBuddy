// Arabic texts: the five-row first screens of My work and Team (round 5, docs/round5.md). See src/i18n/ar/index.js.
// A text with a count is an object with the six plural forms of Arabic (zero, one, two, few = 3 to 10, many = 11 to 99, other).

const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });
// The same words for every count but 1 and 2 (the number stays in the text): "{n} close to breaching".
const same = (one, two, rest) => pl(rest, one, two, rest, rest, rest);

export const AR_ROWS = {
  // ---- My work: the five rows ----
  'Needs you now': 'تحتاج إليك الآن',
  'At risk today': 'معرّضة للخطر اليوم',
  'Replied to you': 'ردّوا عليك',
  'Same cause?': 'سبب واحد؟',
  'My week': 'أسبوعي',
  'Where your week went': 'أين ذهب أسبوعك',
  '{n} or more open tickets.': '{n} تذكرة مفتوحة أو أكثر.',
  'Nothing is open for you.': 'لا شيء مفتوح لك.',
  'Nothing needs you first.': 'لا شيء يحتاج إليك أولا.',
  '{n} open ticket.|{n} open tickets.': pl('{n} تذكرة مفتوحة.', 'تذكرة مفتوحة واحدة.', 'تذكرتان مفتوحتان.', '{n} تذاكر مفتوحة.', '{n} تذكرة مفتوحة.', '{n} تذكرة مفتوحة.'),
  '{n} needs you first.|{n} need you first.': same('واحدة تحتاج إليك أولا.', 'اثنتان تحتاجان إليك أولا.', '{n} تحتاج إليك أولا.'),
  'All {n} or more open tickets, with filters': 'كل {n} تذكرة مفتوحة أو أكثر، مع التصفيات',
  'All {n} open ticket, with filters|All {n} open tickets, with filters': pl('كل {n} تذكرة مفتوحة، مع التصفيات', 'التذكرة المفتوحة، مع التصفيات', 'التذكرتان المفتوحتان، مع التصفيات', 'كل {n} تذاكر مفتوحة، مع التصفيات', 'كل {n} تذكرة مفتوحة، مع التصفيات', 'كل {n} تذكرة مفتوحة، مع التصفيات'),
  '{n} SLA breached|{n} SLAs breached': pl('{n} اتفاقية SLA متجاوزة', 'اتفاقية SLA واحدة متجاوزة', 'اتفاقيتا SLA متجاوزتان', '{n} اتفاقيات SLA متجاوزة', '{n} اتفاقية SLA متجاوزة', '{n} اتفاقية SLA متجاوزة'),
  '{n} customer waiting for your answer|{n} customers waiting for your answer': pl('{n} عميل ينتظرون ردك', 'عميل واحد ينتظر ردك', 'عميلان ينتظران ردك', '{n} عملاء ينتظرون ردك', '{n} عميلا ينتظرون ردك', '{n} عميل ينتظرون ردك'),
  'customers waiting could not be checked': 'تعذر التحقق من العملاء المنتظرين',
  'Nothing is breached. Customers waiting could not be checked.': 'لا شيء متجاوز. تعذر التحقق من العملاء المنتظرين.',
  'Nothing is breached and no customer is waiting.': 'لا شيء متجاوز ولا عميل ينتظر.',
  '{n} close to breaching|{n} close to breaching': same('واحدة قريبة من التجاوز', 'اثنتان قريبتان من التجاوز', '{n} قريبة من التجاوز'),
  '{n} reopened or handed on often|{n} reopened or handed on often': same('واحدة أعيد فتحها أو إسنادها كثيرا', 'اثنتان أعيد فتحهما أو إسنادهما كثيرا', '{n} أعيد فتحها أو إسنادها كثيرا'),
  '{n} for an important customer|{n} for an important customer': same('واحدة لعميل مهم', 'اثنتان لعميل مهم', '{n} لعميل مهم'),
  'No ticket is at risk in what could be read.': 'لا تذكرة معرّضة للخطر فيما أمكن قراءته.',
  'No ticket is at risk today.': 'لا تذكرة معرّضة للخطر اليوم.',
  '{n} customer wrote back after your last comment|{n} customers wrote back after your last comment': pl('{n} عميل كتبوا بعد تعليقك الأخير', 'عميل واحد كتب بعد تعليقك الأخير', 'عميلان كتبا بعد تعليقك الأخير', '{n} عملاء كتبوا بعد تعليقك الأخير', '{n} عميلا كتبوا بعد تعليقك الأخير', '{n} عميل كتبوا بعد تعليقك الأخير'),
  '{n} new comment from someone else|{n} new comments from others': pl('{n} تعليق جديد من آخرين', 'تعليق جديد واحد من شخص آخر', 'تعليقان جديدان من آخرين', '{n} تعليقات جديدة من آخرين', '{n} تعليقا جديدا من آخرين', '{n} تعليق جديد من آخرين'),
  'Replies could not be read.': 'تعذرت قراءة الردود.',
  'No one has written back since your last comment.': 'لم يكتب أحد منذ تعليقك الأخير.',
  '{n} ticket, waiting longest {span}|{n} tickets, waiting longest {span}': pl('{n} تذكرة، أطول انتظار {span}', 'تذكرة واحدة، أطول انتظار {span}', 'تذكرتان، أطول انتظار {span}', '{n} تذاكر، أطول انتظار {span}', '{n} تذكرة، أطول انتظار {span}', '{n} تذكرة، أطول انتظار {span}'),
  'Nothing is waiting on others.': 'لا شيء بانتظار الآخرين.',
  'None of your tickets are on the same item.': 'لا تذكرتان من تذاكرك على العنصر نفسه.',

  // ---- Team: the five rows ----
  'Weekly report': 'التقرير الأسبوعي',
  'One click. Ready to send to your manager.': 'بنقرة واحدة. جاهز لإرساله إلى مديرك.',
  'All team charts and tables': 'كل مخططات الفريق وجداوله',
  'No ticket type is turned on for this view.': 'لم يُشغَّل أي نوع من التذاكر لهذا العرض.',
  'Open tickets could not be counted.': 'تعذر عدّ التذاكر المفتوحة.',
  'Nothing needs a lead today.': 'لا شيء يحتاج إلى قائد الفريق اليوم.',
  '{n} needs a lead today.|{n} need a lead today.': same('واحدة تحتاج إلى قائد الفريق اليوم.', 'اثنتان تحتاجان إلى قائد الفريق اليوم.', '{n} تحتاج إلى قائد الفريق اليوم.'),
  'Show the other {n}|Show the other {n}': same('اعرض الأخرى', 'اعرض الاثنتين الأخريين', 'اعرض الـ {n} الأخرى'),

  // 1. Needs attention now
  'breached could not be counted': 'تعذر عدّ المتجاوزة',
  'about to breach could not be counted': 'تعذر عدّ القريبة من التجاوز',
  'Nothing is breached or about to breach.': 'لا شيء متجاوز أو قريب من التجاوز.',
  'at least {n} breached|at least {n} breached': same('واحدة على الأقل متجاوزة', 'اثنتان على الأقل متجاوزتان', 'ما لا يقل عن {n} متجاوزة'),
  '{n} breached|{n} breached': same('واحدة متجاوزة', 'اثنتان متجاوزتان', '{n} متجاوزة'),
  'at least {n} about to breach|at least {n} about to breach': same('واحدة على الأقل قريبة من التجاوز', 'اثنتان على الأقل قريبتان من التجاوز', 'ما لا يقل عن {n} قريبة من التجاوز'),
  '{n} about to breach|{n} about to breach': same('واحدة قريبة من التجاوز', 'اثنتان قريبتان من التجاوز', '{n} قريبة من التجاوز'),

  // 2. Getting old
  'Getting old': 'تتقادم',
  'Open tickets by age': 'التذاكر المفتوحة حسب العمر',
  'Nothing has been open for more than 7 days.': 'لا شيء مفتوح منذ أكثر من 7 أيام.',
  'some ticket types could not be aged': 'تعذر حساب عمر بعض أنواع التذاكر',
  '{n} open for more than 7 days|{n} open for more than 7 days': same('واحدة مفتوحة منذ أكثر من 7 أيام', 'اثنتان مفتوحتان منذ أكثر من 7 أيام', '{n} مفتوحة منذ أكثر من 7 أيام'),
  '{n} for 15 days or more|{n} for 15 days or more': same('واحدة منذ 15 يوما أو أكثر', 'اثنتان منذ 15 يوما أو أكثر', '{n} منذ 15 يوما أو أكثر'),

  // 3. Who is carrying the load
  'Who is carrying the load': 'من يحمل العبء',
  'Open tickets by person': 'التذاكر المفتوحة حسب الشخص',
  'Only your own tickets are in this view.': 'في هذا العرض تذاكرك أنت فقط.',
  'Nothing is open.': 'لا شيء مفتوح.',
  'No open ticket is assigned to a person.': 'لا تذكرة مفتوحة مسندة إلى شخص.',
  'The busiest person holds {percent}% of the open tickets|The busiest {n} people hold {percent}% of the open tickets': pl(
    'أكثر {n} أشخاص انشغالا يحملون {percent}% من التذاكر المفتوحة',
    'أكثر شخص انشغالا يحمل {percent}% من التذاكر المفتوحة',
    'أكثر شخصين انشغالا يحملان {percent}% من التذاكر المفتوحة',
    'أكثر {n} أشخاص انشغالا يحملون {percent}% من التذاكر المفتوحة',
    'أكثر {n} شخصا انشغالا يحملون {percent}% من التذاكر المفتوحة',
    'أكثر {n} شخص انشغالا يحملون {percent}% من التذاكر المفتوحة'
  ),
  '{n} more person in All team charts and tables.|{n} more people in All team charts and tables.': pl(
    '{n} شخص آخر في كل مخططات الفريق وجداوله.',
    'شخص آخر واحد في كل مخططات الفريق وجداوله.',
    'شخصان آخران في كل مخططات الفريق وجداوله.',
    '{n} أشخاص آخرين في كل مخططات الفريق وجداوله.',
    '{n} شخصا آخر في كل مخططات الفريق وجداوله.',
    '{n} شخص آخر في كل مخططات الفريق وجداوله.'
  ),
  '{n} ticket has nobody assigned.|{n} tickets have nobody assigned.': pl('{n} تذكرة بلا مسند إليه.', 'تذكرة واحدة بلا مسند إليه.', 'تذكرتان بلا مسند إليه.', '{n} تذاكر بلا مسند إليه.', '{n} تذكرة بلا مسند إليه.', '{n} تذكرة بلا مسند إليه.'),

  // 4. Coming back again
  'Coming back again': 'تعود من جديد',
  '{name}: {n} tickets in the last {days} days. One cause?': '{name}: {n} تذكرة في آخر {days} يوما. هل السبب واحد؟',
  'No cause stands out in the last {days} days.': 'لا سبب بارز في آخر {days} يوما.',
  'Configuration items with the most tickets': 'عناصر التهيئة الأكثر تذاكر',
  'Callers with {min} or more tickets': 'متصلون لديهم {min} تذاكر أو أكثر',
  'Callers': 'المتصلون',
  '{n} caller has {min} or more tickets in the last {days} days|{n} callers have {min} or more tickets in the last {days} days': pl(
    '{n} متصل لدى كل منهم {min} تذاكر أو أكثر في آخر {days} يوما',
    'متصل واحد لديه {min} تذاكر أو أكثر في آخر {days} يوما',
    'متصلان لدى كل منهما {min} تذاكر أو أكثر في آخر {days} يوما',
    '{n} متصلين لدى كل منهم {min} تذاكر أو أكثر في آخر {days} يوما',
    '{n} متصلا لدى كل منهم {min} تذاكر أو أكثر في آخر {days} يوما',
    '{n} متصل لدى كل منهم {min} تذاكر أو أكثر في آخر {days} يوما'
  ),

  // 5. How well tickets are closed
  'How well tickets are closed': 'جودة إغلاق التذاكر',
  'Resolved in the last {days} days': 'حُلّت في آخر {days} يوما',
  'Every ticket closed this week has a fix note.': 'لكل تذكرة أُغلقت هذا الأسبوع ملاحظة حل.',
  'Reopens could not be read for these ticket types.': 'تعذرت قراءة إعادة الفتح لأنواع التذاكر هذه.',
  'No ticket opened in the last {days} days was reopened.': 'لم يُعد فتح أي تذكرة فُتحت في آخر {days} يوما.',
  'Closing without a fix note is not counted here yet.': 'الإغلاق دون ملاحظة حل غير محسوب هنا بعد.',
  '{n} of {total} closed this week has no fix note|{n} of {total} closed this week have no fix note': same('واحدة من {total} أُغلقت هذا الأسبوع بلا ملاحظة حل', 'اثنتان من {total} أُغلقتا هذا الأسبوع بلا ملاحظة حل', '{n} من {total} أُغلقت هذا الأسبوع بلا ملاحظة حل'),
  '{n} of {total} tickets opened in the last {days} days was reopened|{n} of {total} tickets opened in the last {days} days were reopened': same('أعيد فتح واحدة من {total} تذكرة فُتحت في آخر {days} يوما', 'أعيد فتح اثنتين من {total} تذكرة فُتحت في آخر {days} يوما', 'أعيد فتح {n} من {total} تذكرة فُتحت في آخر {days} يوما'),
};
