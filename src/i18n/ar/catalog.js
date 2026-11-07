// Arabic texts: the catalog fulfiller pass (wave 6): "Fulfilled before" (the last completed tasks for the same catalog item), "Waiting on Dana
// Lee for 3 days" in the Request card, and the exact words about whether the requester can read the comments on a catalog task. Owned by the
// catalog fulfiller builder; the lead wires AR_CATALOG into src/i18n/ar/index.js. The texts that already had an entry (the days, hours and
// minutes of a span, "Refresh") are not repeated here. See docs/i18n-arabic.md.

// The six plural forms of Arabic (zero, one, two, few = 3 to 10, many = 11 to 99, other).
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_CATALOG = {
  // ---- Fulfilled before (src/insights/fulfilledBefore.js, src/sidepanel/ticket/cards/FulfilledCard.jsx) ---------------------------------
  'Fulfilled before': 'نُفذ من قبل',
  'earlier tasks for this item': 'المهام السابقة لهذا العنصر',
  'Done before': 'نُفذ من قبل',
  'Last done {when}, took {span}': 'آخر تنفيذ {when}، واستغرق {span}',
  'Last done {when}': 'آخر تنفيذ {when}',
  'took {span}': 'استغرقت {span}',
  'closed {when}': 'أُغلقت {when}',
  'under a minute': 'أقل من دقيقة',
  'Close notes are not shown to you.': 'ملاحظات الإغلاق غير ظاهرة لك.',
  'No close notes.': 'لا توجد ملاحظات إغلاق.',
  'Could not check earlier tasks for this item': 'تعذر التحقق من المهام السابقة لهذا العنصر',
  'No earlier tasks for this item that you can see': 'لا توجد مهام سابقة لهذا العنصر تستطيع رؤيتها',
  // (the two sentences of the read in src/content/ops/fix.js, shown through plainNote)
  'Earlier tasks are looked up for requested items and catalog tasks only.': 'يُبحث عن المهام السابقة للعناصر المطلوبة ومهام الكتالوج فقط.',
  'This ticket has no catalog item, so earlier tasks for it were not looked up.': 'ليس لهذه التذكرة عنصر كتالوج، لذلك لم يُبحث عن مهام سابقة له.',

  // ---- The approval chase (src/checks/approvalChase.js, RequestCard.jsx) -----------------------------------------------------------------
  'Waiting on {who} for {span}.': 'بانتظار {who} منذ {span}.',
  'Waiting on {who}.': 'بانتظار {who}.',
  '{n} other approval is also waiting.|{n} other approvals are also waiting.': pl(
    'لا موافقات أخرى بانتظار الرد.',
    'موافقة أخرى واحدة بانتظار الرد أيضا.',
    'موافقتان أخريان بانتظار الرد أيضا.',
    '{n} موافقات أخرى بانتظار الرد أيضا.',
    '{n} موافقة أخرى بانتظار الرد أيضا.',
    '{n} موافقة أخرى بانتظار الرد أيضا.'
  ),
  // ('waiting {span}', after the name to chase in the Request card's one line, is the My work text that already has its entry)

  // ---- Can the requester read the comments on a catalog task (src/lib/fillable.js, src/features/packs/kinds.js) -----------------------
  'The requester can read comments on this task.': 'يستطيع مقدّم الطلب قراءة التعليقات على هذه المهمة.',
  'The requester may not see this. Use the requested item to reach them.': 'قد لا يراه مقدّم الطلب. استخدم العنصر المطلوب للوصول إليه.',
  'Replaces what is in {into}, which the requester can read.': 'يستبدل ما في {into}، ويستطيع مقدّم الطلب قراءته.',
  'Goes below what is in {into}, which the requester can read.': 'يضاف أسفل ما في {into}، ويستطيع مقدّم الطلب قراءته.',
  'Insert as a comment (the requester can read it)': 'أدرج كتعليق (يستطيع مقدّم الطلب قراءته)',
};
