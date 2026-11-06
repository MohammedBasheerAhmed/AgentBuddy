// Arabic texts: Close well: the close code suggestion and Prepare to close (round 4, docs/round4.md). Owned by the Close well agent; see src/i18n/ar/index.js.
export const AR_CLOSE = {
  '{votes} of {of} solved look-alikes used {code}': 'استخدمت {votes} من {of} تذاكر مشابهة محلولة الرمز {code}',

  // The Close well row (src/checks/resolutionCheck.js readyLine, src/insights/closeCode.js)
  'the resolution notes need work': 'ملاحظات الحل تحتاج إلى عمل',
  'no close code chosen': 'لم يتم اختيار رمز الإغلاق',
  'the caller has not confirmed': 'لم يؤكد المتصل بعد',
  'work under it is still open': 'ما زال عمل تابع لها مفتوحا',
  'personal data in the text': 'بيانات شخصية في النص',
  'a hold reason is filled in': 'سبب التعليق ما زال معبأ',
  'Not yet: {reason}': 'ليس بعد: {reason}',
  'Not yet: {reason}, and {n} more': 'ليس بعد: {reason}، و{n} غيرها',
  'The ticket already has {code}, as {votes} of {of} look-alikes did.': 'التذكرة تحمل الرمز {code} بالفعل، كما فعلت {votes} من {of} تذاكر مشابهة.',
  'Suggested: {code}. {votes} of {of} look-alikes used it.': 'المقترح: {code}. استخدمته {votes} من {of} تذاكر مشابهة.',
  '{number} from the same caller is the same issue: link it, or raise a problem if it comes back.': 'التذكرة {number} من المتصل نفسه عن المشكلة نفسها: اربطها بها، أو افتح مشكلة إذا تكررت.',
  'close code suggested': 'رمز إغلاق مقترح',
  'looks like a repeat': 'يبدو أنها تكرار',
  'Open {number}': 'افتح {number}',

  // Prepare to close (src/features/packs/close.js, src/sidepanel/ticket/assist/answers/prepareClose.js, PrepareClose.jsx)
  'Prepare to close': 'التحضير للإغلاق',
  'Resolve check, close code and notes in one go': 'فحص الحل ورمز الإغلاق والملاحظات دفعة واحدة',
  'The resolve check and the close code come from your ServiceNow data, not from the AI, and are not sent. The AI only writes the notes.':
    'فحص الحل ورمز الإغلاق مصدرهما بياناتك في ServiceNow، لا الذكاء الاصطناعي، ولا يرسلان. الذكاء الاصطناعي يكتب الملاحظات فقط.',
  'Close code': 'رمز الإغلاق',
  'Insert the close code': 'أدرج رمز الإغلاق',
  'Insert fills {fields} on the open form. Nothing is saved until you press Save.': 'الإدراج يملأ {fields} في النموذج المفتوح. لا يحفظ شيء حتى تضغط حفظ.',
  'Insert fills {field} on the open form. Nothing is saved until you press Save.': 'الإدراج يملأ {field} في النموذج المفتوح. لا يحفظ شيء حتى تضغط حفظ.',
  'Choose the close code {code} yourself.': 'اختر رمز الإغلاق {code} بنفسك.',
  'From ServiceNow': 'من ServiceNow',
  'From look-alikes': 'من التذاكر المشابهة',
  'Written by your AI': 'كتبه الذكاء الاصطناعي لديك',
  'Repeat issue': 'مشكلة متكررة',
  "From the caller's tickets": 'من تذاكر المتصل',
  'The resolve check could not be read. Open "Close well" in Insights to see it.': 'تعذرت قراءة فحص الحل. افتح "إغلاق سليم" في الرؤى لتراه.',
  'The AI wrote no notes. Try again, or write them yourself.': 'لم يكتب الذكاء الاصطناعي أي ملاحظات. حاول مرة أخرى، أو اكتبها بنفسك.',

  // Two fields with one Insert, and Undo after every Insert (src/sidepanel/insertFlow.js, src/lib/fillable.js, InsertFindings.jsx)
  'Filled {fields}. Press Save in ServiceNow to keep them.': 'تمت تعبئة {fields}. اضغط حفظ في ServiceNow للاحتفاظ بها.',
  'Filled {field}. Press Save in ServiceNow to keep it.': 'تمت تعبئة {field}. اضغط حفظ في ServiceNow للاحتفاظ بها.',
  'Undo': 'تراجع',
  'Put back what was in the form before this insert. Nothing is saved.': 'يعيد ما كان في النموذج قبل هذا الإدراج. لا يحفظ شيء.',
  'Undone: {field} is back to what it was before. Nothing is saved.': 'تم التراجع: عاد {field} إلى ما كان عليه. لم يحفظ شيء.',
  'Undone: {fields} are back to what they were before. Nothing is saved.': 'تم التراجع: عادت {fields} إلى ما كانت عليه. لم يحفظ شيء.',
  '{field} was changed after the insert, so Agent Buddy cannot undo it safely. Change it by hand if you need to.':
    'تغير {field} بعد الإدراج، لذلك لا يستطيع Agent Buddy التراجع عنه بأمان. غيره بيدك إذا احتجت.',
  '{field} is on a form that is no longer open, so it was not put back.': '{field} في نموذج لم يعد مفتوحا، لذلك لم تتم إعادته.',
  '{field} could not be put back. {why}': 'تعذرت إعادة {field}. {why}',
  'Agent Buddy does not pick from a list on this page.': 'لا يختار Agent Buddy من قائمة في هذه الصفحة.',
  'That choice is not in the list on this form.': 'هذا الخيار غير موجود في القائمة في هذا النموذج.',
  'The box was changed after the insert, so it was left as it is.': 'تغير المربع بعد الإدراج، لذلك ترك كما هو.',
};
