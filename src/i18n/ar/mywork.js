// Arabic texts: My work: tickets at risk (round 4, docs/round4.md). Owned by the My work agent; see src/i18n/ar/index.js.
// The "At risk" chip and filter, the reasons on a row (src/mywork/risk.js) and the follow-up draft (src/mywork/followups.js). A text
// with a count is an object with the six plural forms of Arabic (zero, one, two, few = 3 to 10, many = 11 to 99, other).

const pl = (zero, one, two, few, many, other) => ({ zero, one, two, few, many, other });

export const AR_MYWORK = {
  // ---- tickets at risk: the reason line (the chip and the filter say "At risk", whose Arabic is in reports.js) ----
  'reopened twice': 'أعيد فتحها مرتين',
  'reopened once|reopened {n} times': pl(
    'أعيد فتحها {n} مرة',
    'أعيد فتحها مرة واحدة',
    'أعيد فتحها مرتين',
    'أعيد فتحها {n} مرات',
    'أعيد فتحها {n} مرة',
    'أعيد فتحها {n} مرة'
  ),
  'reassigned {n} time|reassigned {n} times': pl(
    'أعيد إسنادها {n} مرة',
    'أعيد إسنادها مرة واحدة',
    'أعيد إسنادها مرتين',
    'أعيد إسنادها {n} مرات',
    'أعيد إسنادها {n} مرة',
    'أعيد إسنادها {n} مرة'
  ),
  'waiting on you {n} day|waiting on you {n} days': pl(
    'بانتظارك منذ {n} يوم',
    'بانتظارك منذ يوم واحد',
    'بانتظارك منذ يومين',
    'بانتظارك منذ {n} أيام',
    'بانتظارك منذ {n} يوما',
    'بانتظارك منذ {n} يوم'
  ),
  'SLA nearly used': 'اتفاقية مستوى الخدمة أوشكت على النفاد',
  'priority account': 'حساب ذو أولوية',

  // ---- follow-ups due: the draft to copy ----
  'Copy draft': 'انسخ المسودة',
  'Copy draft for {number}': 'انسخ المسودة لـ {number}',
  'A quick update on {about}: we are still working on it, and it has not been forgotten.': 'تحديث سريع بخصوص {about}: ما زلنا نعمل عليها، ولم ننسها.',
  'We will write again as soon as there is news. If anything has changed on your side, just reply to this message.':
    'سنكتب إليك مجددا فور وجود جديد. وإذا تغير أي شيء من جهتك، فيكفي أن ترد على هذه الرسالة.',
};
