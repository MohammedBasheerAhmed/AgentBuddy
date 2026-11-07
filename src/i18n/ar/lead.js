// Arabic texts: the Team lead's "Needs attention now" and the Team overview's folds (wave 6, team lead). The English text is the key; the
// style and the words are in docs/i18n-arabic.md. Wired in src/i18n/ar/index.js (AR_LEAD).
const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_LEAD = {
  // Needs attention now (src/reports/engine/attention.js, src/sidepanel/reports/AttentionView.jsx, sections.js)
  'Waiting for approval': 'بانتظار موافقة',
  'Open {n} day|Open {n} days': pl('مفتوحة منذ {n} يوم', 'مفتوحة منذ {n} يوم', 'مفتوحة منذ {n} يوم', 'مفتوحة منذ {n} أيام', 'مفتوحة منذ {n} يوما', 'مفتوحة منذ {n} يوم'),
  'Reason': 'السبب',
  'The tickets that need you most, each with the reason.': 'التذاكر التي تحتاج إليك أكثر، مع سبب كل منها.',
  'The few tickets that need you most, each with one reason: breached, closest to breaking, waiting for approval, reassigned often, open longest.':
    'القليل من التذاكر التي تحتاج إليك أكثر، ولكل منها سبب واحد: تجاوز الاتفاقية، أو الاقتراب من التجاوز، أو انتظار موافقة، أو كثرة إعادة الإسناد، أو طول مدة الفتح.',
  'Based on what you can see; some data could not be read.': 'بناء على ما يظهر لك؛ تعذرت قراءة بعض البيانات.',
  'Nothing needs attention right now.': 'لا شيء يحتاج إلى اهتمام الآن.',
  'No ticket stands out in what could be read.': 'لا توجد تذكرة بارزة فيما أمكن قراءته.',
  'Showing {shown} of at least {total}.': 'عرض {shown} من {total} على الأقل.',
  '+{n} more reason|+{n} more reasons': pl('+{n} سبب آخر', '+{n} سبب آخر', '+{n} سببان آخران', '+{n} أسباب أخرى', '+{n} سببا آخر', '+{n} سبب آخر'),
  'No ticket type can be read with your access, so there is nothing to look at.': 'لا يمكن قراءة أي نوع من أنواع التذاكر بصلاحياتك، لذا لا يوجد ما يمكن النظر فيه.',

  // The numbers a lead can trust: what the engine now says when a count is only "at least" or a ticket type was left out
  '{hint}. At least this many: not every SLA could be read.': '{hint}. هذا هو الحد الأدنى: تعذرت قراءة كل اتفاقيات مستوى الخدمة.',
  'Some ticket types could not be aged, so the ageing leaves them out.': 'تعذر حساب عمر بعض أنواع التذاكر، لذا يستبعدها حساب الأعمار.',
  'Some ticket types could not be checked for hand-offs, so the number of tickets handed over often may be low.':
    'تعذر فحص عمليات التحويل في بعض أنواع التذاكر، لذا قد يكون عدد التذاكر التي حُولت كثيرا أقل من الفعلي.',
  '{n} ticket type could not be aged and is left out of this count.|{n} ticket types could not be aged and are left out of this count.': pl(
    'تعذر حساب عمر {n} نوع من التذاكر وهي مستبعدة من هذا العدد.',
    'تعذر حساب عمر {n} نوع من التذاكر وهو مستبعد من هذا العدد.',
    'تعذر حساب عمر {n} نوعين من التذاكر وهما مستبعدان من هذا العدد.',
    'تعذر حساب عمر {n} أنواع من التذاكر وهي مستبعدة من هذا العدد.',
    'تعذر حساب عمر {n} نوعا من التذاكر وهي مستبعدة من هذا العدد.',
    'تعذر حساب عمر {n} نوع من التذاكر وهي مستبعدة من هذا العدد.'
  ),

  // The folds of the Team overview (src/sidepanel/reports/folds.js): the titles that were not on the screen before
  'Open work by person and group': 'العمل المفتوح حسب الشخص والمجموعة',
  'By state': 'حسب الحالة',
  'Tickets by kind': 'التذاكر حسب النوع',
};
