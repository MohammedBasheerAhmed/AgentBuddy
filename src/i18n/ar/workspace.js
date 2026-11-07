// Arabic texts: the Workspace pages (audit of 2026-11-07, part 9). Insert is not offered for a box the page does not have, a composer set
// to the other kind of note blocks it, and a composer that could not be read is said to be unread. Style: docs/i18n-arabic.md.
// (box = المربع, as in the other Insert texts of src/i18n/ar/shell.js)
export const AR_WORKSPACE = {
  // ---- src/sidepanel/insertFlow.js: said BEFORE the click, under the buttons; Copy leads, Insert is off ----------------------------
  "This page's box can't be filled automatically. Copy and paste.": 'لا يمكن ملء مربع هذه الصفحة تلقائيا. انسخ النص والصقه.',
  "Two boxes on this page look alike, so Agent Buddy can't tell which one to fill. Copy and paste.": 'في هذه الصفحة مربعان متشابهان، لذلك لا يستطيع Agent Buddy تحديد أيهما يملأ. انسخ النص والصقه.',
  'This page is too big for Agent Buddy to search for the box. Copy and paste.': 'هذه الصفحة أكبر من أن يبحث Agent Buddy فيها عن المربع. انسخ النص والصقه.',
  'The box on this page is set to customer comments. Switch it to Work notes, then insert, or use Copy.': 'المربع في هذه الصفحة مضبوط على تعليقات العميل. حوّله إلى ملاحظات العمل ثم أدرج النص، أو استخدم نسخ.',
  'The box on this page is set to Work notes. Switch it to Additional comments, then insert, or use Copy.': 'المربع في هذه الصفحة مضبوط على ملاحظات العمل. حوّله إلى تعليقات إضافية ثم أدرج النص، أو استخدم نسخ.',
  // ---- src/lib/fillable.js: after the click, and after an insert ---------------------------------------------------------------
  'This page is too big for Agent Buddy to find the box.': 'هذه الصفحة أكبر من أن يجد Agent Buddy المربع فيها.',
  'The box on this page is set to the other kind of note. Switch it, then try again.': 'المربع في هذه الصفحة مضبوط على النوع الآخر من الملاحظات. حوّله ثم أعد المحاولة.',
  'Check the box says Work notes before you post.': 'تأكد أن المربع مضبوط على ملاحظات العمل قبل النشر.',
};
