// Arabic texts: what a card says when the instance will not let it read (round 4, docs/round4.md). Owned by the Read safety agent; see src/i18n/ar/index.js.
export const AR_READS = {
  // src/context/access.js READ_TEXT: the fixed sentences of the reasons (also the messages of the read layer's errors)
  'Your organisation blocks this kind of read for your role. Ask your ServiceNow admin.': 'تمنع مؤسستك هذا النوع من القراءة لدورك. اسأل مسؤول ServiceNow.',
  'ServiceNow is limiting requests. Try again in a minute.': 'يحد ServiceNow من الطلبات الآن. أعد المحاولة بعد دقيقة.',
  'ServiceNow is busy or under maintenance. Try again in a few minutes.': 'ServiceNow مشغول أو قيد الصيانة. أعد المحاولة بعد بضع دقائق.',
  'ServiceNow answered with a page instead of data: sign in again, or the instance may be under maintenance.':
    'رد ServiceNow بصفحة بدلا من البيانات: سجل الدخول مجددا، أو ربما يكون النظام قيد الصيانة.',
  'ServiceNow did not answer in time. Try again in a moment.': 'لم يرد ServiceNow في الوقت المحدد. أعد المحاولة بعد قليل.',
  'Your ServiceNow session has expired. Sign in to ServiceNow again (reload the page), then try again.':
    'انتهت جلستك في ServiceNow. سجل الدخول إلى ServiceNow مجددا (أعد تحميل الصفحة)، ثم أعد المحاولة.',
  // src/context/access.js: one thing that could not be read ({thing} is "Earlier tickets", "SLAs"...)
  '{thing}: not available to you with your role.': '{thing}: غير متاح لك بدورك الحالي.',
  '{thing}: your organisation blocks this kind of read for your role. Ask your ServiceNow admin.': '{thing}: تمنع مؤسستك هذا النوع من القراءة لدورك. اسأل مسؤول ServiceNow.',
  '{thing}: not on this ServiceNow instance.': '{thing}: غير موجود في نظام ServiceNow هذا.',
};
