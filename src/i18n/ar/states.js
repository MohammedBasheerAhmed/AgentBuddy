// Arabic texts: one meaning of a ticket's state, and the Team report's other kinds of ticket (audit of 2026-11-07, F9, F17, F20, see
// docs/states.md and docs/live-questions/audit-1107-states.md). The English text is the key; the style and the words are in
// docs/i18n-arabic.md. Wired in src/i18n/ar/index.js (AR_STATES).
export const AR_STATES = {
  // The plain word for a state the site gave no label (src/reports/engine/common.js stateName); "New", "On hold", "Resolved" and
  // "Closed" are texts of other parts of the panel
  'In progress': 'قيد التنفيذ',
  'Cancelled': 'ملغاة',
  'Unknown state': 'حالة غير معروفة',

  // Request fulfilment (src/reports/engine/fulfilment.js, src/sidepanel/reports/FulfilmentView.jsx)
  'Other kinds of ticket': 'أنواع أخرى من التذاكر',
  'Some kinds of ticket are not counted: your organisation keeps them out of Agent Buddy.': 'لا يتم احتساب بعض أنواع التذاكر: مؤسستك تستبعدها من Agent Buddy.',
};
