// Arabic texts: the notes and errors a person reads when something could not be read (audit of 2026-11-07, workstream "notes and errors").
// The engine (src/context, src/content/ops) writes these English sentences as fixed texts without the name of a table; the panel shows
// them in Arabic through src/sidepanel/plainAccess.js (plainNote, accessLine) and src/reports/shown.js. Style: docs/i18n-arabic.md.
export const AR_NOTES = {
  // ---- src/context/access.js: the reasons, said once for every read ----------------------------------------------------------------
  'Not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.': 'غير متاح لك. قيّدته مؤسستك. اسأل مسؤول ServiceNow إن كنت بحاجة إليه.',
  'ServiceNow did not send the information. Sign in again, or try later (it may be down for maintenance).':
    'لم يرسل ServiceNow المعلومات. سجل الدخول مجددا، أو حاول لاحقا (ربما يكون قيد الصيانة).',
  'You are signed out of ServiceNow. Sign in again, then try again.': 'تم تسجيل خروجك من ServiceNow. سجل الدخول مجددا ثم أعد المحاولة.',
  'That cannot be read. Choose another option.': 'تتعذر قراءة هذا. اختر خيارا آخر.',
  'Not available to you with your role.': 'غير متاح لك بدورك الحالي.',
  'Not available to you.': 'غير متاح لك.',
  'This does not exist on this ServiceNow site.': 'هذا غير موجود في موقع ServiceNow هذا.',
  'You can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.':
    'لا ترى منها شيئا، لذلك لا يستطيع Agent Buddy معرفة هل هي غير موجودة أم أن دورك يخفيها.',
  'Could not be read just now. Try again in a moment.': 'تعذرت القراءة الآن. أعد المحاولة بعد قليل.',
  'Your organisation does not let Agent Buddy read this.': 'لا تسمح مؤسستك لـ Agent Buddy بقراءة هذا.',
  'ServiceNow did not narrow the results as asked, so they were left out.': 'لم يحصر ServiceNow النتائج كما طُلب، لذلك لم تُستخدم.',
  'This ticket holds sensitive data, so other tickets are not searched unless sensitive data is allowed.':
    'تحتوي هذه التذكرة على بيانات حساسة، لذلك لا يُبحث في تذاكر أخرى ما لم يُسمح بالبيانات الحساسة.',
  'This ticket holds sensitive data, so this is not looked up unless sensitive data is allowed.':
    'تحتوي هذه التذكرة على بيانات حساسة، لذلك لا يُبحث عن هذا ما لم يُسمح بالبيانات الحساسة.',
  // the same reasons about one thing ({thing} is "Earlier tickets", "SLAs"...)
  '{thing}: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.':
    '{thing}: غير متاح لك. قيّدته مؤسستك. اسأل مسؤول ServiceNow إن كنت بحاجة إليه.',
  '{thing}: does not exist on this ServiceNow site.': '{thing}: غير موجود في موقع ServiceNow هذا.',
  '{thing}: you can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.':
    '{thing}: لا ترى منها شيئا، لذلك لا يستطيع Agent Buddy معرفة هل هي غير موجودة أم أن دورك يخفيها.',
  '{thing}: could not be read just now. Try again in a moment.': '{thing}: تعذرت القراءة الآن. أعد المحاولة بعد قليل.',

  // ---- src/context/chat.js -----------------------------------------------------------------------------------------------------------
  'This chat has no messages that you can see.': 'لا تحتوي هذه المحادثة على رسائل يمكنك رؤيتها.',
  'The messages found held no text.': 'لم يكن في الرسائل التي وُجدت أي نص.',
  'Times are UTC.': 'الأوقات بالتوقيت العالمي UTC.',
  'Showing the newest {n} messages.': 'عرض أحدث {n} رسالة.',
  'You cannot see the chat messages. Your role may not allow it, so the chat may not be empty.':
    'لا يمكنك رؤية رسائل المحادثة. ربما لا يسمح بذلك دورك، لذلك قد لا تكون المحادثة فارغة.',

  // ---- src/context/history.js --------------------------------------------------------------------------------------------------------
  'No caller was found on this ticket.': 'لم يُعثر على متصل في هذه التذكرة.',
  'HR cases are only included when sensitive data is allowed.': 'لا تُضمَّن حالات الموارد البشرية إلا عند السماح بالبيانات الحساسة.',

  // ---- src/context/journal.js --------------------------------------------------------------------------------------------------------
  'Some notes could not be read the usual way, so they were read from the ticket itself. Times are in your time zone.':
    'تعذرت قراءة بعض الملاحظات بالطريقة المعتادة، لذلك قُرئت من التذكرة نفسها. الأوقات بمنطقتك الزمنية.',
  'Some notes were read from the ticket itself.': 'قُرئت بعض الملاحظات من التذكرة نفسها.',
  'Their times are in your time zone, so their order among the other notes may be off by a few hours.':
    'أوقاتها بمنطقتك الزمنية، لذلك قد يختلف ترتيبها بين الملاحظات الأخرى ببضع ساعات.',
  'Showing the newest {n} entries.': 'عرض أحدث {n} من الإدخالات.',
  'You cannot read the notes and comments, and the ticket itself shows none, so there may be notes you cannot see.':
    'لا يمكنك قراءة الملاحظات والتعليقات، ولا تُظهر التذكرة نفسها أي شيء منها، لذلك قد توجد ملاحظات لا يمكنك رؤيتها.',
  'You cannot read the notes and comments of this ticket.': 'لا يمكنك قراءة الملاحظات والتعليقات في هذه التذكرة.',
  'No notes or comments were found. You may not be able to read them, so this does not prove there are none.':
    'لم يُعثر على ملاحظات أو تعليقات. ربما لا يمكنك قراءتها، لذلك لا يعني هذا أنها غير موجودة.',

  // ---- src/context/knowledge.js ------------------------------------------------------------------------------------------------------
  'Choose a knowledge base or a category first.': 'اختر قاعدة معرفة أو فئة أولا.',
  'Type a few words that describe the problem, or an article number.': 'اكتب بضع كلمات تصف المشكلة، أو رقم مقالة.',
  'Choose incidents or cases.': 'اختر الحوادث أو الحالات.',
  'There is nothing in that scope to look at.': 'لا يوجد في هذا النطاق ما يمكن النظر فيه.',
  'Type a few words to search for.': 'اكتب بضع كلمات للبحث عنها.',
  'No published articles here.': 'لا توجد مقالات منشورة هنا.',
  'There are no more articles to compare.': 'لا توجد مقالات أخرى للمقارنة.',
  'No published articles in this scope.': 'لا توجد مقالات منشورة في هذا النطاق.',
  'Only the {n} most recently changed articles were compared (of {total}). Choose a category to narrow it.':
    'قورنت أحدث {n} مقالة تغيرا فقط (من أصل {total}). اختر فئة لتضييق النطاق.',
  'Only the {n} most recently changed articles were compared. Choose a category to narrow it.': 'قورنت أحدث {n} مقالة تغيرا فقط. اختر فئة لتضييق النطاق.',
  'Could not tell which groups are yours, so the radar was not limited to them.': 'تعذر معرفة مجموعاتك، لذلك لم يقتصر الرادار عليها.',
  'You are not a member of any group that you can see.': 'لست عضوا في أي مجموعة يمكنك رؤيتها.',
  'No tickets were resolved in that time.': 'لم تُحل أي تذاكر في تلك المدة.',
  'ServiceNow did not apply the date range as asked, so only tickets inside it were used.': 'لم يطبق ServiceNow النطاق الزمني كما طُلب، لذلك استُخدمت التذاكر داخله فقط.',
  'Only the newest {n} were read.': 'قُرئ أحدث {n} فقط.',
  'This ServiceNow site stores article links differently, so they could not be used.': 'يخزن موقع ServiceNow هذا روابط المقالات بطريقة مختلفة، لذلك تعذر استخدامها.',

  // ---- src/context/pack.js and people.js ---------------------------------------------------------------------------------------------
  'This ticket was not found, or it is not available to you.': 'لم يُعثر على هذه التذكرة، أو أنها غير متاحة لك.',
  'This ticket was opened as a general task and its real type could not be looked up, so it is treated as sensitive: free text and identities were not read.':
    'فُتحت هذه التذكرة كمهمة عامة وتعذر معرفة نوعها الحقيقي، لذلك عوملت كتذكرة حساسة: لم تُقرأ النصوص الحرة ولا الهويات.',
  'This kind of ticket holds sensitive data, so free text and identities were not read.': 'هذا النوع من التذاكر يحتوي على بيانات حساسة، لذلك لم تُقرأ النصوص الحرة ولا الهويات.',
  'Notes and comments on sensitive tickets are not read unless sensitive data is allowed.': 'لا تُقرأ الملاحظات والتعليقات في التذاكر الحساسة ما لم يُسمح بالبيانات الحساسة.',
  'You cannot read the details of the people on this ticket, so email addresses are not included.': 'لا يمكنك قراءة بيانات الأشخاص في هذه التذكرة، لذلك لا تتضمن عناوين البريد الإلكتروني.',
  'The details of the people on this ticket could not be read, so email addresses are not included.': 'تعذرت قراءة بيانات الأشخاص في هذه التذكرة، لذلك لا تتضمن عناوين البريد الإلكتروني.',
  '{n} of {total} people have no email address that you can read.': 'لا يوجد عنوان بريد إلكتروني يمكنك قراءته لـ {n} من أصل {total} من الأشخاص.',

  // ---- src/context/related.js --------------------------------------------------------------------------------------------------------
  'Showing the first {n}.': 'عرض أول {n}.',
  'Showing the first {n} of {total}.': 'عرض أول {n} من أصل {total}.',
  'Showing the oldest {n} of {total}.': 'عرض أقدم {n} من أصل {total}.',
  'Showing the oldest {n} of more than {total}.': 'عرض أقدم {n} من أكثر من {total}.',
  'Showing the oldest {n} and the newest {m} of {total}.': 'عرض أقدم {n} وأحدث {m} من أصل {total}.',
  'Showing the oldest {n} and the newest {m} of more than {total}.': 'عرض أقدم {n} وأحدث {m} من أكثر من {total}.',
  'You cannot read the questions of this request, so the answers could not be labelled.': 'لا يمكنك قراءة أسئلة هذا الطلب، لذلك تعذر وضع عنوان لكل إجابة.',
  'Some answers could not be shown because their lists are blocked by your organisation.': 'تعذر عرض بعض الإجابات لأن قوائمها محظورة من مؤسستك.',
  'Some answers could not be shown because their lists are not ones Agent Buddy reads.': 'تعذر عرض بعض الإجابات لأن قوائمها ليست مما يقرؤه Agent Buddy.',
  'Some answers could not be shown because their lists could not be read.': 'تعذر عرض بعض الإجابات لأن قوائمها تعذرت قراءتها.',
  'Some answers could not be shown.': 'تعذر عرض بعض الإجابات.',
  'The change has no planned start and end, so schedule conflicts were not checked.': 'ليس للتغيير بداية ونهاية مخططتان، لذلك لم تُفحص تعارضات الجدول.',
  'The change has no configuration item or business service, so schedule conflicts were not checked.': 'ليس للتغيير عنصر تهيئة ولا خدمة أعمال، لذلك لم تُفحص تعارضات الجدول.',
  'One of the two checks (configuration item or business service) could not be read.': 'تعذرت قراءة أحد الفحصين (عنصر التهيئة أو خدمة الأعمال).',
  'ServiceNow returned a very long list for this window, so some changes may not be listed.': 'أعاد ServiceNow قائمة طويلة جدا لهذه الفترة، لذلك قد لا تظهر بعض التغييرات.',
  'The case has no configuration item, so recent changes were not looked up.': 'ليس للحالة عنصر تهيئة، لذلك لم يُبحث عن التغييرات الأخيرة.',
  'This kind of ticket has no configuration item or service.': 'هذا النوع من التذاكر ليس له عنصر تهيئة ولا خدمة.',
  'This ticket has no configuration item or service, so changes on it were not looked up.': 'ليس لهذه التذكرة عنصر تهيئة ولا خدمة، لذلك لم يُبحث عن التغييرات عليها.',

  // ---- src/context/similar.js --------------------------------------------------------------------------------------------------------
  'The short description has no words worth searching for.': 'الوصف المختصر لا يحتوي كلمات تصلح للبحث.',
  'This ticket has no configuration item or business service to compare.': 'ليس لهذه التذكرة عنصر تهيئة ولا خدمة أعمال للمقارنة.',
  'This ticket has no words worth searching for.': 'لا تحتوي هذه التذكرة كلمات تصلح للبحث.',

  // ---- src/content/ops ---------------------------------------------------------------------------------------------------------------
  'You cannot see whether a problem is linked to this ticket.': 'لا يمكنك معرفة ما إذا كانت مشكلة مرتبطة بهذه التذكرة.',
  'The problem link could not be read.': 'تعذرت قراءة رابط المشكلة.',
  'The problem link could not be checked just now.': 'تعذر فحص رابط المشكلة الآن.',
  'The problem link could not be checked.': 'تعذر فحص رابط المشكلة.',
  'You cannot see which articles are linked to this ticket.': 'لا يمكنك معرفة المقالات المرتبطة بهذه التذكرة.',
  'Agent Buddy cannot tell whether an article is linked: you can see none of the links at all.': 'لا يستطيع Agent Buddy معرفة هل ترتبط مقالة بالتذكرة: لا ترى أي رابط منها.',
  'Your organisation does not let Agent Buddy read the article links.': 'لا تسمح مؤسستك لـ Agent Buddy بقراءة روابط المقالات.',
  'The article links could not be checked just now.': 'تعذر فحص روابط المقالات الآن.',
  'The article link could not be checked.': 'تعذر فحص رابط المقالة.',
  'This ticket is not part of a catalog request.': 'هذه التذكرة ليست جزءا من طلب من الكتالوج.',
  'The requested item this task belongs to could not be read just now. Showing the task on its own.': 'تعذرت قراءة العنصر المطلوب الذي تتبعه هذه المهمة الآن. تعرض المهمة وحدها.',
  'This task has no requested item you can see. Showing the task on its own.': 'ليس لهذه المهمة عنصر مطلوب يمكنك رؤيته. تعرض المهمة وحدها.',
  "This case has no account, so the account's other cases were not looked up.": 'ليس لهذه الحالة حساب، لذلك لم يُبحث عن الحالات الأخرى للحساب.',
  'No other cases for this account that you can see.': 'لا توجد حالات أخرى لهذا الحساب يمكنك رؤيتها.',
  'More cases exist for this account than are shown.': 'توجد حالات لهذا الحساب أكثر مما هو معروض.',
  '{n} more case exists for this account.': '{n} حالة أخرى لهذا الحساب.',
  '{n} more cases exist for this account.': '{n} حالات أخرى لهذا الحساب.',
  'Solved tickets are looked up for tickets only.': 'يُبحث عن التذاكر المحلولة للتذاكر فقط.',
  'There is no error code to search for.': 'لا يوجد رمز خطأ للبحث عنه.',
  'The VIP flag of the caller could not be read.': 'تعذرت قراءة علامة VIP للمتصل.',
  'The history of this ticket is not available to you, so the path between groups is not shown.': 'سجل هذه التذكرة غير متاح لك، لذلك لا يُعرض المسار بين المجموعات.',
  'Showing the newest {n} changes.': 'عرض أحدث {n} من التغييرات.',
  'This ticket has no configuration item or service, so problems on it were not looked up.': 'ليس لهذه التذكرة عنصر تهيئة ولا خدمة، لذلك لم يُبحث عن المشكلات عليها.',
  'One of the two checks (configuration item or service) could not be read.': 'تعذرت قراءة أحد الفحصين (عنصر التهيئة أو الخدمة).',
  'Changes are looked up for incidents, problems, changes and cases.': 'يُبحث عن التغييرات للحوادث والمشكلات والتغييرات والحالات.',
  'Problems are looked up for incidents, problems, changes and cases.': 'يُبحث عن المشكلات للحوادث والمشكلات والتغييرات والحالات.',
  'a group you cannot see': 'مجموعة لا يمكنك رؤيتها',
  'The assignment group and priority of the look-alike tickets could not be read.': 'تعذرت قراءة مجموعة الإسناد والأولوية للتذاكر المشابهة.',

  // ---- src/sidepanel/plainAccess.js (a source that is not a table) ------------------------------------------------------------------
  'similar tickets': 'تذاكر مشابهة',
  "Agent Buddy could not read from this ServiceNow page. Reload the page (sign in again if it asks), then try again.": "تعذرت على Agent Buddy القراءة من صفحة ServiceNow هذه. أعد تحميل الصفحة (سجل الدخول من جديد إن طلبت ذلك)، ثم حاول مرة أخرى.",
  // (a standard note of src/context/access.js NOTE_TEXT, added with the honest-reads work)
  'Part of this ticket is hidden from you, so this could not be looked up.': 'جزء من هذه التذكرة مخفي عنك، لذلك تعذر البحث عن هذا.',
};
