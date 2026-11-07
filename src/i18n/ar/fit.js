// Arabic texts of the "kind fit" pass (audit of 2026-11-07, root cause 6: the panel was incident-first): what a request, a catalog task,
// a change, an HR case and a problem show and say. Style and words: docs/i18n-arabic.md. Keys are the exact English texts.
export const AR_FIT = {
  // ---- the Request card: who it is for and what was ordered (src/checks/requestView.js forLine) -----------------------------------------
  'For {name}': 'لأجل {name}',
  'Quantity {n}': 'الكمية {n}',

  // ---- the answers of the request form on a catalog task (src/context/related.js) ---------------------------------------------------------
  'This task has no requested item that you can see, so the answers to its request questions are not included.':
    'لا يوجد لهذه المهمة عنصر مطلوب يمكنك رؤيته، لذلك لم تُضمَّن إجابات أسئلة الطلب.',

  // ---- "Ready to resolve?" in the words of the kind (src/checks/resolutionCheck.js, src/insights/fixes.js) -----------------------------------
  'the requester has not confirmed': 'لم يؤكد مقدّم الطلب',
  'the employee has not confirmed': 'لم يؤكد الموظف',
  'the customer has not confirmed': 'لم يؤكد العميل',
  'the close notes need work': 'ملاحظات الإغلاق تحتاج إلى عمل',
  'No close notes yet': 'لا توجد ملاحظات إغلاق بعد',
  'Say what was delivered or done, and anything the requester still has to do. These notes are what the next person finds when the same request comes in again.':
    'اذكر ما تم تسليمه أو إنجازه، وما يلزم أن يفعله مقدّم الطلب. هذه الملاحظات هي ما يجده الشخص التالي عند ورود الطلب نفسه مرة أخرى.',
  'Say whether the change worked, what was done and how it was checked. These notes are what the next person finds when a similar change comes up.':
    'اذكر هل نجح التغيير، وما الذي تم، وكيف جرى التحقق. هذه الملاحظات هي ما يجده الشخص التالي عند ورود تغيير مشابه.',
  'Say what was done and how it ended.': 'اذكر ما تم وكيف انتهى.',
  'Say what was done and what it produced.': 'اذكر ما تم وما نتج عنه.',
  'Could not read the saved close notes': 'تعذرت قراءة ملاحظات الإغلاق المحفوظة',
  'Check on the form whether they are filled in.': 'تحقق في النموذج من تعبئتها.',
  'The close notes are very short': 'ملاحظات الإغلاق قصيرة جدا',
  'A sentence on what was delivered and one on anything left for the requester makes them far more useful to the next person.':
    'جملة عمّا تم تسليمه وجملة عمّا بقي على مقدّم الطلب تجعلانها أنفع بكثير للشخص التالي.',
  'A sentence on what was done and one on how it ended makes them far more useful to the next person.':
    'جملة عمّا تم وجملة عن كيف انتهى تجعلانها أنفع بكثير للشخص التالي.',
  'Close notes are filled in': 'ملاحظات الإغلاق معبأة',
  'Pick the code that says how the change went. Reports and trends use it.': 'اختر الرمز الذي يصف كيف سار التغيير. تستخدمه التقارير والاتجاهات.',
  'Close notes are on the form, usually under Closure information.': 'ملاحظات الإغلاق في النموذج، عادة تحت معلومات الإغلاق.',
  'When the notes are in, set the state to {done} (or {notDone} if it was not delivered), then press Save.':
    'بعد كتابة الملاحظات، اجعل الحالة {done} (أو {notDone} إن لم يُسلَّم)، ثم اضغط حفظ.',

  // ---- a change at a glance (src/insights/changeLine.js) and what a task is part of (Glance.jsx) ---------------------------------------------
  '{type} change': 'تغيير {type}',
  '{risk} risk': 'مخاطر {risk}',
  'from {when}': 'من {when}',
  'until {when}': 'حتى {when}',
  'Approval: {state}': 'الموافقة: {state}',
  'Requested by': 'طُلب بواسطة',
  'Part of': 'جزء من',

  // ---- a problem's workaround, in "Steps that worked before" (StepsCard.jsx) ----------------------------------------------------------------
  'Workaround recorded': 'سُجّل حل بديل',
  'Known error, workaround': 'خطأ معروف، الحل البديل',
  'None recorded yet': 'لا شيء مسجّل بعد',

  // ---- the journey and "Since you last looked", when a state or a priority has no name to give (src/insights/journey.js, sinceLooked.js) ----
  'State changed': 'تغيّرت الحالة',
  'Priority changed': 'تغيّرت الأولوية',
  'a state': 'حالة',
  'priority changed': 'تغيّرت الأولوية',
};
