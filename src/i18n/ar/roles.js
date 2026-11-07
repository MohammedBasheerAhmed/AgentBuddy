// Arabic texts: roles, the channel of a reply, and locked boxes (the audit of 2026-11-07, W-01 to W-08 and W-13, see
// docs/live-questions/audit-1107-roles.md). The English text is the key; the style and the words are in docs/i18n-arabic.md.
// The old English texts these replace were taken out of the catalogue files when this file was wired in (nothing uses them any more).
export const AR_ROLES = {
  // The channel follows the kind (src/features/packs/core.js, checks.js, src/lib/fillable.js describeInsert, src/features/stages.js)
  'Insert as a comment (the requester may not see it)': 'أدرج كتعليق (قد لا يراه مقدّم الطلب)',
  'Replaces what is in {into}, which the requester may not see.': 'يستبدل ما في {into}، وقد لا يظهر لمقدّم الطلب.',
  'Goes below what is in {into}, which the requester may not see.': 'يضاف أسفل ما في {into}، وقد لا يظهر لمقدّم الطلب.',
  'Then press Save. The customer may be emailed.': 'ثم اضغط حفظ. قد يتلقى العميل رسالة بريد إلكتروني.',
  'The requester may not see comments on a task. Check who can see them.': 'قد لا يرى مقدّم الطلب التعليقات على المهمة. تحقق ممن يستطيع رؤيتها.',

  // A locked box, read back after the write (src/lib/fillable.js, src/page/bridge.js)
  'This field is locked on this form.': 'هذا الحقل مقفل في هذا النموذج.',

  // Prepare to close (src/sidepanel/insertFlow.js)
  'Check the state and the other required fields, then save.': 'تحقق من الحالة ومن الحقول المطلوبة الأخرى، ثم احفظ.',
  'The close code {code} is already filled on the form. Undo puts it back.': 'رمز الإغلاق {code} معبأ بالفعل في النموذج. التراجع يعيده إلى ما كان.',

  // A page that has no form of its own and where the box was not found (src/sidepanel/insertFlow.js applyFieldStates)
  'This page may not take it. If it does not, your text is copied instead.': 'قد لا تقبل هذه الصفحة النص. إن لم تقبله، ينسخ نصك بدلا من ذلك.',

  // A kind of ticket Agent Buddy does not know (src/features/focus.js limitedKindNote)
  'Agent Buddy does not know this kind of ticket, so only the basics are shown.': 'لا يعرف Agent Buddy هذا النوع من التذاكر، لذلك لا تظهر إلا الأساسيات.',
};

