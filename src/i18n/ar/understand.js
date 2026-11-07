// Arabic texts: Understand the ticket: since you last looked, translate the caller's message (round 4, docs/round4.md). Owned by the Understand agent; see src/i18n/ar/index.js.

// A text with a count (tn): the forms of Arabic (zero, one, two, few, many, other).
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_UNDERSTAND = {
  // The short label of "Translate the caller's message" on the bar on the page (src/features/quick.js)
  'Translate message': 'ترجم الرسالة',
  // ---- since you last looked (src/insights/sinceLooked.js, src/sidepanel/ticket/needsNow.js) ----
  'today {time}': 'اليوم {time}',
  'yesterday {time}': 'أمس {time}',
  'Since you last looked ({when})': 'منذ آخر مرة نظرت فيها ({when})',
  'Since you looked: {what}': 'منذ أن نظرت: {what}',
  'Nothing new since you looked ({when})': 'لا جديد منذ أن نظرت ({when})',
  'No new messages since you looked ({when})': 'لا رسائل جديدة منذ أن نظرت ({when})',
  'the caller wrote': 'كتب المتصل',
  'the caller wrote twice': 'كتب المتصل مرتين',
  'the caller wrote {n} time|the caller wrote {n} times': pl('كتب المتصل {n} مرة', 'كتب المتصل مرة واحدة', 'كتب المتصل مرتين', 'كتب المتصل {n} مرات', 'كتب المتصل {n} مرة', 'كتب المتصل {n} مرة'),
  '{n} message from the caller|{n} messages from the caller': pl('{n} رسالة من المتصل', 'رسالة واحدة من المتصل', 'رسالتان من المتصل', '{n} رسائل من المتصل', '{n} رسالة من المتصل', '{n} رسالة من المتصل'),
  '{n} reply to the caller|{n} replies to the caller': pl('{n} رد على المتصل', 'رد واحد على المتصل', 'ردان على المتصل', '{n} ردود على المتصل', '{n} ردا على المتصل', '{n} رد على المتصل'),
  '{n} new comment|{n} new comments': pl('{n} تعليق جديد', 'تعليق جديد واحد', 'تعليقان جديدان', '{n} تعليقات جديدة', '{n} تعليقا جديدا', '{n} تعليق جديد'),
  '{n} new work note|{n} new work notes': pl('{n} ملاحظة عمل جديدة', 'ملاحظة عمل جديدة واحدة', 'ملاحظتا عمل جديدتان', '{n} ملاحظات عمل جديدة', '{n} ملاحظة عمل جديدة', '{n} ملاحظة عمل جديدة'),
  'moved to {state}': 'انتقلت إلى {state}',
  'priority now {priority}': 'الأولوية الآن {priority}',
  'reassigned to {group}': 'أعيد إسنادها إلى {group}',
  reassigned: 'أعيد إسنادها',
  'not reassigned': 'لم يعد إسنادها',
  'updated {when}': 'حُدّثت {when}',
  'the ticket was updated': 'حُدّثت التذكرة',
  'state and group changes not readable': 'تغييرات الحالة والمجموعة غير مقروءة',
  'Possible outage': 'انقطاع محتمل',

  // ---- what the caller wrote last, and Translate (src/sidepanel/ticket/TicketInsights.jsx) ----
  'The caller wrote': 'كتب المتصل',
  'The caller wrote, {when}': 'كتب المتصل، {when}',
  'Opens AI Assist. You see what will be sent first.': 'يفتح مساعد الذكاء الاصطناعي. ترى ما سيرسل أولا.',

  // ---- the AI action (src/features/packs/translate.js) ----
  "Translate the caller's message": 'ترجم رسالة المتصل',
  'In your language, after the check before sending': 'بلغتك، بعد التحقق قبل الإرسال',

  // ---- Settings > Stored data (src/lib/storedData.js, src/options/data/StoredDataSection.jsx) ----
  'Tickets you opened': 'التذاكر التي فتحتها',
  'Tickets you opened: {n} (ids and times only)|Tickets you opened: {n} (ids and times only)': pl(
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)',
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)',
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)',
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)',
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)',
    'التذاكر التي فتحتها: {n} (المعرّفات والأوقات فقط)'
  ),
  'Your settings, the saved AI key, snippets, the usage and activity logs, saved dashboards, checklist ticks and the list of tickets you opened are deleted, and the ServiceNow sites you turned on are turned off. This cannot be undone.':
    'ستحذف إعداداتك ومفتاح الذكاء الاصطناعي المحفوظ والمقتطفات وسجلا الاستخدام والنشاط ولوحات المعلومات المحفوظة وعلامات قوائم المراجعة وقائمة التذاكر التي فتحتها، وتوقف مواقع ServiceNow التي شغّلتها. لا يمكن التراجع عن ذلك.',
};
