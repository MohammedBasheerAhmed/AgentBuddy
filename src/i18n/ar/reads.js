// Arabic texts: what a card says when the instance will not let it read (round 4, docs/round4.md). Owned by the Read safety agent; see src/i18n/ar/index.js.
export const AR_READS = {
  // src/context/access.js READ_TEXT: the fixed sentences of the reasons (also the messages of the read layer's errors)
  'ServiceNow is limiting requests. Try again in a minute.': 'يحد ServiceNow من الطلبات الآن. أعد المحاولة بعد دقيقة.',
  'ServiceNow is busy or under maintenance. Try again in a few minutes.': 'ServiceNow مشغول أو قيد الصيانة. أعد المحاولة بعد بضع دقائق.',
  'ServiceNow did not answer in time. Try again in a moment.': 'لم يرد ServiceNow في الوقت المحدد. أعد المحاولة بعد قليل.',
  // src/context/access.js: one thing that could not be read ({thing} is "Earlier tickets", "SLAs"...)
  '{thing}: not available to you with your role.': '{thing}: غير متاح لك بدورك الحالي.',
};
