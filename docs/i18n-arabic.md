# Agent Buddy in Arabic: how the texts are written

The panel, the Settings page and the Team page can be shown in English or Arabic (Settings > Language; "Same as the browser" follows the
browser). This page is for whoever adds or changes a text. The mechanism is `src/i18n/index.js`; the Arabic texts are in
`src/i18n/ar/*.js`; `node scripts/i18n-check.js [folder]` lists what is missing, and `tests/i18n.test.js` fails the build when a text has
no Arabic entry.

## Rules for the code

- Every text a person reads goes through `t('English text')`. The English text is the key: write it out in full where it is passed
  (`t('Open')`, not `t(label)`, not `t('Open ' + x)`).
- A value that changes is a `{name}`, never part of the key: `t('Showing {shown} of {total}', { shown, total })`.
- A text with a count uses `tn(count, '{n} ticket', '{n} tickets')`; its Arabic entry is an object with the six plural forms.
- A text kept in a table and shown later is marked where it is written, `tm('Open')`, and shown with `t(TABLE[key])`.
- Data from a ticket (a record number, a name, a title, an email, a field value) and anything the AI wrote is shown as it is. When one of
  them goes into a sentence, pass it through `isolate(value)` so the right-to-left sentence keeps it whole:
  `t('Assigned to {name}', { name: isolate(person) })`.
- Fixed prompts for the AI (`src/features`), the text sent to the AI, field names read from ServiceNow, log lines and developer errors
  are not translated.
- Layout uses logical properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `text-align: start`), never `left`
  and `right`. An arrow or a chevron that points a way flips in right-to-left: use the class `ab-flip`.

## How the Arabic is written

- Modern Standard Arabic, plain and short, the way a good product writes for people at work. No dialect, no slang, no jargon where an
  everyday word exists. Same rule as the English: say what is happening and what to do next.
- Buttons and menu items start with a verb in the imperative (singular): افتح، انسخ، أرسل، أضف، احفظ. Views are nouns: التذاكر المرتبطة.
- Address the person as "you" in the singular masculine form where the English says "you" ("لا يمكنك..."), or avoid the pronoun.
- Digits are the ASCII digits (0 to 9), as in ServiceNow and in record numbers. Keep `{name}` exactly as written. Keep brand and
  product names in Latin letters: Agent Buddy, ServiceNow, Chrome, Edge, DeepSeek, OpenAI, Anthropic, Azure. Keep the badge `AI` as `AI`.
- No emoji, no exclamation marks the English does not have, no tashkeel (diacritics).
- Keep a text about as short as the English so a button still fits in a 320 px panel.

## Words

| English | Arabic |
|---|---|
| Insights | الرؤى |
| AI Assist | مساعد الذكاء الاصطناعي |
| AI (in a sentence) | الذكاء الاصطناعي |
| ticket | تذكرة (التذاكر) |
| record | سجل |
| incident | حادثة |
| request / requested item | طلب / عنصر مطلوب |
| change / change request | تغيير / طلب تغيير |
| problem | مشكلة |
| task | مهمة |
| case (customer service) | حالة |
| HR case | حالة موارد بشرية |
| knowledge article | مقال معرفي |
| knowledge base / knowledge | قاعدة المعرفة / المعرفة |
| SLA | اتفاقية مستوى الخدمة (SLA) |
| assignment group | مجموعة الإسناد |
| assigned to | المُسند إليه |
| caller / requester | المتصل / مقدّم الطلب |
| customer | العميل |
| priority / state / impact / urgency | الأولوية / الحالة / التأثير / الإلحاح |
| work notes | ملاحظات العمل |
| additional comments (customer-visible) | تعليقات إضافية (ظاهرة للعميل) |
| resolution notes / close notes | ملاحظات الحل / ملاحظات الإغلاق |
| configuration item (CI) | عنصر التهيئة (CI) |
| Team / My work / Write / Knowledge / Ticket (screens) | الفريق / عملي / الكتابة / المعرفة / التذكرة |
| Settings | الإعدادات |
| preview (before sending) | معاينة |
| send | إرسال |
| masked (personal details hidden) | مُخفاة |
| personal data | البيانات الشخصية |
| your organisation | مؤسستك |
| administrator | مسؤول النظام |
| policy | سياسة |
| draft | مسودة |
| reply | رد |
| summary / summarise | ملخص / لخّص |
| rewrite | أعد الصياغة |
| snippet | مقتطف |
| insert (into the form) | أدرج |
| copy | انسخ |
| save | احفظ |
| dismiss | تجاهل |
| refresh | حدّث |
| open / close | افتح / أغلق |
| turn on / turn off | شغّل / أوقف |
| AI key | مفتاح الذكاء الاصطناعي |
| privacy mode: Standard / Strict / Local only | وضع الخصوصية: عادي / صارم / محلي فقط |
| dashboard / report / widget | لوحة المعلومات / تقرير / مكوّن |
| workload / backlog | حجم العمل / الأعمال المتراكمة |
| breached / due / overdue | متجاوز / مستحق / متأخر |
| today / yesterday / ago | اليوم / أمس / منذ |

When a term is not here, use the word ServiceNow itself uses in its Arabic interface if you know it, otherwise the plainest Arabic word.
Add the term to this table so the next text uses the same one.
