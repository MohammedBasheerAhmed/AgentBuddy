// Arabic texts: Reply: the checks before a reply is sent (round 4, docs/round4.md). Owned by the Reply agent; see src/i18n/ar/index.js.
export const AR_REPLY = {
  // The safe-to-send hints (src/safeSend/replyChecks.js)
  'Say what happens next, or when you will write again.': 'اذكر ما سيحدث بعد ذلك، أو متى ستكتب مرة أخرى.',
  'This can sound like blame or impatience. Rephrase or leave out:': 'قد يبدو هذا لوما أو نفاد صبر. أعد صياغته أو احذفه:',
  'A long run of capital letters reads as shouting. Write it in normal case:': 'الأحرف الكبيرة المتتالية تبدو كالصراخ. اكتبها بأحرف عادية:',
  'Three or more exclamation marks can read as shouting. One is enough.': 'ثلاث علامات تعجب أو أكثر قد تبدو كالصراخ. تكفي علامة واحدة.',

  // Write > Check my comment (src/sidepanel/write/SafeSendCheck.jsx)
  'Checks what you typed for personal data, passwords, internal wording, a next step and the tone before the customer sees it.':
    'يفحص ما كتبته بحثا عن بيانات شخصية وكلمات مرور وصياغة داخلية، وعن ذكر الخطوة التالية والنبرة، قبل أن يراه العميل.',

  // The Reply row: which email fits (src/sidepanel/ticket/cards/EmailCard.jsx, src/compose/emailRecommend.js)
  'Before it is sent': 'قبل الإرسال',
  'Checked: internal words · a next step · the tone': 'يتحقق من: الكلمات الداخلية · ذكر الخطوة التالية · النبرة',
  'The caller writes in Arabic.': 'يكتب المتصل بالعربية.',
  'The caller writes in English.': 'يكتب المتصل بالإنجليزية.',
  'The caller writes in Arabic. Draft a reply writes in Arabic too, unless you choose English.':
    'يكتب المتصل بالعربية. وتكون مسودة الرد بالعربية أيضا، ما لم تختر الإنجليزية.',
  'The caller writes in English. Draft a reply writes in English too, unless you choose Arabic.':
    'يكتب المتصل بالإنجليزية. وتكون مسودة الرد بالإنجليزية أيضا، ما لم تختر العربية.',
  'The caller writes in Arabic. Draft a reply writes in English (your setting).': 'يكتب المتصل بالعربية. وتكون مسودة الرد بالإنجليزية (حسب إعدادك).',
  'The caller writes in English. Draft a reply writes in Arabic (your setting).': 'يكتب المتصل بالإنجليزية. وتكون مسودة الرد بالعربية (حسب إعدادك).',
  'the caller writes in Arabic': 'المتصل يكتب بالعربية',
  'the caller writes in English': 'المتصل يكتب بالإنجليزية',
};
