// Arabic texts of the last build wave (audit of 2026-11-07, "finish the fulfiller items": F11, F13, F14). Style and words: docs/i18n-arabic.md.
// Keys are the exact English texts. The lead wires AR_FINISH into src/i18n/ar/index.js.
//
// F11, the person in the words of the kind (src/insights/personWords.js): the requester of a request or a requested item, the employee of an
// HR case, the customer of a customer service case. The incident's "caller" sentences are the ones that were already here. Each sentence is
// written out in full per noun, so the Arabic can put its words in its own order. The three nouns are all masculine: مقدّم الطلب, الموظف, العميل.

// A text with a count (tn): the forms of Arabic (zero, one, two, few, many, other).
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_FINISH = {
  // ---- "Same caller": the row's line and the card's body (src/insights/related.js, CallerCard.jsx) -----------------------------------------
  'Could not read who the requester is': 'تعذرت قراءة من هو مقدّم الطلب',
  'Could not read who the employee is': 'تعذرت قراءة من هو الموظف',
  'Could not read who the customer is': 'تعذرت قراءة من هو العميل',
  'Could not read who this ticket is for': 'تعذرت قراءة من تخصه هذه التذكرة',
  'Nobody is named as the requester': 'لم يذكر أحد كمقدّم طلب',
  'Nobody is named as the employee': 'لم يذكر أحد كموظف',
  'Nobody is named as the customer': 'لم يذكر أحد كعميل',
  'Nobody is named on this ticket': 'لم يذكر أحد في هذه التذكرة',
  'No earlier tickets from this requester': 'لا توجد تذاكر سابقة من مقدّم الطلب هذا',
  'No earlier tickets from this employee': 'لا توجد تذاكر سابقة من هذا الموظف',
  'No earlier tickets from this customer': 'لا توجد تذاكر سابقة من هذا العميل',
  'No earlier tickets from this person': 'لا توجد تذاكر سابقة من هذا الشخص',
  'The requester could not be read, so earlier tickets were not looked up.': 'تعذرت قراءة مقدّم الطلب، لذلك لم يُبحث عن تذاكر سابقة.',
  'The employee could not be read, so earlier tickets were not looked up.': 'تعذرت قراءة الموظف، لذلك لم يُبحث عن تذاكر سابقة.',
  'The customer could not be read, so earlier tickets were not looked up.': 'تعذرت قراءة العميل، لذلك لم يُبحث عن تذاكر سابقة.',
  'The person could not be read, so earlier tickets were not looked up.': 'تعذرت قراءة الشخص، لذلك لم يُبحث عن تذاكر سابقة.',
  'Nobody is named as the requester on this ticket.': 'لم يذكر أحد كمقدّم طلب في هذه التذكرة.',
  'Nobody is named as the employee on this ticket.': 'لم يذكر أحد كموظف في هذه التذكرة.',
  'Nobody is named as the customer on this ticket.': 'لم يذكر أحد كعميل في هذه التذكرة.',
  'Nobody is named on this ticket.': 'لم يذكر أحد في هذه التذكرة.',

  // ---- since you last looked, and what the person wrote last (src/insights/sinceLooked.js) -------------------------------------------------
  'the requester wrote': 'كتب مقدّم الطلب',
  'the employee wrote': 'كتب الموظف',
  'the customer wrote': 'كتب العميل',
  'the requester wrote twice': 'كتب مقدّم الطلب مرتين',
  'the employee wrote twice': 'كتب الموظف مرتين',
  'the customer wrote twice': 'كتب العميل مرتين',
  'the requester wrote {n} time|the requester wrote {n} times': pl('كتب مقدّم الطلب {n} مرة', 'كتب مقدّم الطلب مرة واحدة', 'كتب مقدّم الطلب مرتين', 'كتب مقدّم الطلب {n} مرات', 'كتب مقدّم الطلب {n} مرة', 'كتب مقدّم الطلب {n} مرة'),
  'the employee wrote {n} time|the employee wrote {n} times': pl('كتب الموظف {n} مرة', 'كتب الموظف مرة واحدة', 'كتب الموظف مرتين', 'كتب الموظف {n} مرات', 'كتب الموظف {n} مرة', 'كتب الموظف {n} مرة'),
  'the customer wrote {n} time|the customer wrote {n} times': pl('كتب العميل {n} مرة', 'كتب العميل مرة واحدة', 'كتب العميل مرتين', 'كتب العميل {n} مرات', 'كتب العميل {n} مرة', 'كتب العميل {n} مرة'),
  '{n} message from the requester|{n} messages from the requester': pl('{n} رسالة من مقدّم الطلب', 'رسالة واحدة من مقدّم الطلب', 'رسالتان من مقدّم الطلب', '{n} رسائل من مقدّم الطلب', '{n} رسالة من مقدّم الطلب', '{n} رسالة من مقدّم الطلب'),
  '{n} message from the employee|{n} messages from the employee': pl('{n} رسالة من الموظف', 'رسالة واحدة من الموظف', 'رسالتان من الموظف', '{n} رسائل من الموظف', '{n} رسالة من الموظف', '{n} رسالة من الموظف'),
  '{n} message from the customer|{n} messages from the customer': pl('{n} رسالة من العميل', 'رسالة واحدة من العميل', 'رسالتان من العميل', '{n} رسائل من العميل', '{n} رسالة من العميل', '{n} رسالة من العميل'),
  '{n} reply to the requester|{n} replies to the requester': pl('{n} رد على مقدّم الطلب', 'رد واحد على مقدّم الطلب', 'ردان على مقدّم الطلب', '{n} ردود على مقدّم الطلب', '{n} ردا على مقدّم الطلب', '{n} رد على مقدّم الطلب'),
  '{n} reply to the employee|{n} replies to the employee': pl('{n} رد على الموظف', 'رد واحد على الموظف', 'ردان على الموظف', '{n} ردود على الموظف', '{n} ردا على الموظف', '{n} رد على الموظف'),
  '{n} reply to the customer|{n} replies to the customer': pl('{n} رد على العميل', 'رد واحد على العميل', 'ردان على العميل', '{n} ردود على العميل', '{n} ردا على العميل', '{n} رد على العميل'),
  'The requester wrote': 'كتب مقدّم الطلب',
  'The employee wrote': 'كتب الموظف',
  'The customer wrote': 'كتب العميل',
  'The requester wrote, {when}': 'كتب مقدّم الطلب، {when}',
  'The employee wrote, {when}': 'كتب الموظف، {when}',
  'The customer wrote, {when}': 'كتب العميل، {when}',

  // ---- the repeat line of "Close well" (src/insights/closeCode.js) --------------------------------------------------------------------------
  '{number} from the same requester is the same issue: link it, or raise a problem if it comes back.': 'التذكرة {number} من مقدّم الطلب نفسه عن المشكلة نفسها: اربطها بها، أو افتح مشكلة إذا تكررت.',
  '{number} from the same employee is the same issue: link it, or raise a problem if it comes back.': 'التذكرة {number} من الموظف نفسه عن المشكلة نفسها: اربطها بها، أو افتح مشكلة إذا تكررت.',
  '{number} from the same customer is the same issue: link it, or raise a problem if it comes back.': 'التذكرة {number} من العميل نفسه عن المشكلة نفسها: اربطها بها، أو افتح مشكلة إذا تكررت.',

  // ---- missing details (src/insights/missing.js) -------------------------------------------------------------------------------------------
  'No contact named': 'لا توجد جهة اتصال مذكورة',
  'No email address for the requester': 'لا يوجد عنوان بريد إلكتروني لمقدّم الطلب',
  'No email address for the employee': 'لا يوجد عنوان بريد إلكتروني للموظف',
  'No email address for the customer': 'لا يوجد عنوان بريد إلكتروني للعميل',

  // ---- the VIP marks (src/insights/risk.js, the glance) ---------------------------------------------------------------------------------------
  'The requester is a VIP but the priority is {priority}.': 'مقدّم الطلب VIP لكن الأولوية {priority}.',
  'The employee is a VIP but the priority is {priority}.': 'الموظف VIP لكن الأولوية {priority}.',
  'The customer is a VIP but the priority is {priority}.': 'العميل VIP لكن الأولوية {priority}.',
  'VIP requester': 'مقدّم طلب VIP',
  'VIP employee': 'موظف VIP',
  'VIP customer': 'عميل VIP',
  'The requester is marked VIP in ServiceNow.': 'مقدّم الطلب مصنّف VIP في ServiceNow.',
  'The employee is marked VIP in ServiceNow.': 'الموظف مصنّف VIP في ServiceNow.',
  'The customer is marked VIP in ServiceNow.': 'العميل مصنّف VIP في ServiceNow.',

  // ---- "Ready to resolve?": did the person answer? (src/checks/resolutionCheck.js) ------------------------------------------------------------
  'Check by eye whether the requester confirmed the fix or has had a chance to answer.': 'تحقق بنفسك هل أكد مقدّم الطلب الإصلاح أو أتيحت له فرصة للرد.',
  'Check by eye whether the employee confirmed the fix or has had a chance to answer.': 'تحقق بنفسك هل أكد الموظف الإصلاح أو أتيحت له فرصة للرد.',
  'No messages to or from the requester on this ticket': 'لا توجد رسائل من مقدّم الطلب أو إليه في هذه التذكرة',
  'No messages to or from the employee on this ticket': 'لا توجد رسائل من الموظف أو إليه في هذه التذكرة',
  "Could not tell which messages are the requester's": 'تعذر تحديد رسائل مقدّم الطلب',
  "Could not tell which messages are the employee's": 'تعذر تحديد رسائل الموظف',
  'Check by eye that the requester confirmed the fix or had a chance to answer.': 'تحقق بنفسك من أن مقدّم الطلب أكد الإصلاح أو أتيحت له فرصة للرد.',
  'Check by eye that the employee confirmed the fix or had a chance to answer.': 'تحقق بنفسك من أن الموظف أكد الإصلاح أو أتيحت له فرصة للرد.',
  'The requester wrote the last message': 'مقدّم الطلب كتب آخر رسالة',
  'The employee wrote the last message': 'الموظف كتب آخر رسالة',
  'Its author is shown only as a user name. Read it and check whether the requester confirmed the fix.': 'يظهر كاتبها باسم مستخدم فقط. اقرأها وتحقق هل أكد مقدّم الطلب الإصلاح.',
  'Its author is shown only as a user name. Read it and check whether the employee confirmed the fix.': 'يظهر كاتبها باسم مستخدم فقط. اقرأها وتحقق هل أكد الموظف الإصلاح.',
  'The requester has not replied to your last message ({age})': 'لم يرد مقدّم الطلب على رسالتك الأخيرة ({age})',
  'The employee has not replied to your last message ({age})': 'لم يرد الموظف على رسالتك الأخيرة ({age})',

  // ---- W-15: a group that is no longer in use is left out of the Routing card's count (src/sidepanel/ticket/cards/RoutingCard.jsx) -----------
  'Groups that are no longer in use were left out, and too few look-alikes are left to tell.': 'استُبعدت المجموعات التي لم تعد مستخدمة، وتبقّى عدد قليل جدا من الحالات المشابهة لا يكفي للحكم.',

  // ---- F13: the state is the step that closes a ticket (src/lib/fillable.js closeStep, insertFlow.js, prepareClose.js) -------------------------
  // (the names of the states are those of the form's State list: they come in as {state}, {done}... and are shown as the form writes them)
  'Set State to {state}, then save.': 'اجعل الحالة {state}، ثم احفظ.',
  'Set State to {done} (or {notDone} or {skipped}), then save.': 'اجعل الحالة {done} (أو {notDone} أو {skipped})، ثم احفظ.',
  'Move the change to {state}, then save.': 'انقل التغيير إلى الحالة {state}، ثم احفظ.',
  'Set the state your process uses to close, then save.': 'اجعل الحالة التي تستخدمها عمليتك للإغلاق، ثم احفظ.',
  'Filled {fields}.': 'تمت تعبئة {fields}.',
  'Filled {field}.': 'تمت تعبئة {field}.',
  'Insert fills {fields} on the open form. Nothing is saved.': 'الإدراج يملأ {fields} في النموذج المفتوح. لا يحفظ شيء.',
  'Insert fills {field} on the open form. Nothing is saved.': 'الإدراج يملأ {field} في النموذج المفتوح. لا يحفظ شيء.',

  // ---- F14: the incidents linked to a problem, in its glance (src/insights/linkedIncidents.js) -------------------------------------------------
  'No linked incidents that you can see': 'لا توجد حوادث مرتبطة يمكنك رؤيتها',
  '{n} linked incident that you can see|{n} linked incidents that you can see': pl(
    '{n} حادثة مرتبطة يمكنك رؤيتها',
    'حادثة واحدة مرتبطة يمكنك رؤيتها',
    'حادثتان مرتبطتان يمكنك رؤيتهما',
    '{n} حوادث مرتبطة يمكنك رؤيتها',
    '{n} حادثة مرتبطة يمكنك رؤيتها',
    '{n} حادثة مرتبطة يمكنك رؤيتها'
  ),
  'At least {n} linked incident that you can see|At least {n} linked incidents that you can see': pl(
    'ما لا يقل عن {n} حادثة مرتبطة يمكنك رؤيتها',
    'ما لا يقل عن حادثة واحدة مرتبطة يمكنك رؤيتها',
    'ما لا يقل عن حادثتين مرتبطتين يمكنك رؤيتهما',
    'ما لا يقل عن {n} حوادث مرتبطة يمكنك رؤيتها',
    'ما لا يقل عن {n} حادثة مرتبطة يمكنك رؤيتها',
    'ما لا يقل عن {n} حادثة مرتبطة يمكنك رؤيتها'
  ),
};
