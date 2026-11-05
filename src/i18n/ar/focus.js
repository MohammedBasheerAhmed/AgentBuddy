// Arabic texts: the five pain points and All tools (docs/focus-layout.md). See src/i18n/ar/index.js.
export const AR_FOCUS = {
  'Understand the ticket': 'فهم التذكرة',
  'Find the fix': 'إيجاد الحل',
  'Same caller': 'المتصل نفسه',
  'Close well': 'إغلاق سليم',
  // All tools (src/sidepanel/palette): the header button, the sheet, its group headings and the line under each Insights card in it
  'All tools': 'كل الأدوات',
  'Find a tool': 'ابحث عن أداة',
  'Find a tool…': 'ابحث عن أداة…',
  'Close All tools': 'إغلاق كل الأدوات',
  'More for this ticket: Insights': 'المزيد لهذه التذكرة: الرؤى',
  'More for this ticket: AI Assist': 'المزيد لهذه التذكرة: مساعد الذكاء الاصطناعي',
  'Facts the ticket still lacks, and why they matter.': 'معلومات ما زالت تنقص التذكرة، ولماذا تهم.',
  'Which groups solved tickets like this one.': 'المجموعات التي حلت تذاكر مشابهة لهذه التذكرة.',
  'Solved look-alikes and open tickets on the same item.': 'تذاكر مشابهة تم حلها، وتذاكر مفتوحة على العنصر نفسه.',
  'Changes on the same item or service, recent and coming.': 'التغييرات على العنصر أو الخدمة نفسها، الأخيرة والقادمة.',
  'A fix or workaround that may already exist.': 'إصلاح أو حل بديل قد يكون موجودا بالفعل.',
  'Signs the ticket may escalate, each with why.': 'مؤشرات على أن التذكرة قد تتصاعد، مع سبب كل منها.',
  'Other open tickets on the same item right now.': 'تذاكر أخرى مفتوحة الآن على العنصر نفسه.',
  // Settings > Side rail (src/options/basics/RailSection.jsx). In Arabic the rail is on the left of the panel, so the text names it
  // without a side.
  'Show the side rail': 'إظهار الشريط الجانبي',
  'The five of each screen on the right of the panel, with All tools at its foot.': 'العناصر الخمسة لكل شاشة على جانب اللوحة، وفي أسفله "كل الأدوات".',
  // The Ticket screen's five (src/sidepanel/ticket): "Back" from a card shown alone, and the quiet way to All tools at the end of each
  // half. (Plural entries: the six Arabic forms, zero, one, two, few = 3 to 10, many = 11 to 99, other; every form keeps {n}.)
  Back: 'رجوع',
  'More for this ticket: {n} Insight|More for this ticket: {n} Insights': {
    zero: 'المزيد لهذه التذكرة: {n} رؤى',
    one: 'المزيد لهذه التذكرة: {n} رؤية',
    two: 'المزيد لهذه التذكرة: {n} رؤيتان',
    few: 'المزيد لهذه التذكرة: {n} رؤى',
    many: 'المزيد لهذه التذكرة: {n} رؤية',
    other: 'المزيد لهذه التذكرة: {n} رؤية',
  },
  'More for this ticket: {n} AI action|More for this ticket: {n} AI actions': {
    zero: 'المزيد لهذه التذكرة: {n} إجراءات للذكاء الاصطناعي',
    one: 'المزيد لهذه التذكرة: {n} إجراء للذكاء الاصطناعي',
    two: 'المزيد لهذه التذكرة: {n} إجراءان للذكاء الاصطناعي',
    few: 'المزيد لهذه التذكرة: {n} إجراءات للذكاء الاصطناعي',
    many: 'المزيد لهذه التذكرة: {n} إجراء للذكاء الاصطناعي',
    other: 'المزيد لهذه التذكرة: {n} إجراء للذكاء الاصطناعي',
  },
  // The card "Caller's other tickets" (the "Same caller" row) and its one line (src/insights/related.js callerSummary)
  "Caller's other tickets": 'تذاكر المتصل الأخرى',
  'Nobody is named as the caller': 'لم يذكر أحد كمتصل',
  'No earlier tickets from this caller': 'لا توجد تذاكر سابقة من هذا المتصل',
  'Looks like a repeat': 'يبدو أنها تكرار',
  '{n} earlier ticket|{n} earlier tickets': {
    zero: '{n} تذاكر سابقة',
    one: '{n} تذكرة سابقة',
    two: '{n} تذكرتان سابقتان',
    few: '{n} تذاكر سابقة',
    many: '{n} تذكرة سابقة',
    other: '{n} تذكرة سابقة',
  },
};
