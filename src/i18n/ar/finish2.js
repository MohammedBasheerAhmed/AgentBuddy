// Arabic texts for the last build wave of the audit of 2026-11-07, builder Q2 (profiles per person, leftover plain words J35 and J37).
// The English text is the key. AR_FINISH2_RETIRED lists the old English texts these replace: no text uses them any more, so the
// catalogue drops them. They live in other files (shell.js, words.js), so withFinish2 is applied AFTER everything else is merged:
//
//   export const AR = withFinish2(withWords({ ...AR_LANGUAGE, ..., ...AR_STATES }));   // src/i18n/ar/index.js
export const AR_FINISH2 = {
  // First run, the step "Open a ticket": no list of ticket types (J35).
  'Any ticket you work on will do. Agent Buddy offers help for it here.': 'تكفي أي تذكرة تعمل عليها. يقدم Agent Buddy المساعدة بشأنها هنا.',
  // The Ticket screen on a portal page that is not a ticket (J35).
  'Open a ticket on this portal and Agent Buddy offers help for it here.': 'افتح تذكرة في هذه البوابة وسيقدم Agent Buddy المساعدة بشأنها هنا.',
  // Settings > Stored data: the settings also hold a scrambled code for who chose the work profiles (W-18).
  'Your choices: AI service and model, privacy mode, which ServiceNow sites you turned on, what you work on, and a scrambled code for who chose it.':
    'اختياراتك: خدمة الذكاء الاصطناعي ونموذجها، ووضع الخصوصية، ومواقع ServiceNow التي شغّلتها، وما تعمل عليه، ورمز مشفر لمن اختار ذلك.',
};

export const AR_FINISH2_RETIRED = [
  'An incident, request, catalog task or case. Agent Buddy offers help for it here.',
  'Open a ticket, request or case on this portal and Agent Buddy offers help for it here.',
  'Your choices: AI service and model, privacy mode, which ServiceNow sites you turned on.',
];

/** The catalogue with these texts added and the retired ones removed (also from the files that were merged before it). */
export function withFinish2(base) {
  const out = { ...base, ...AR_FINISH2 };
  for (const key of AR_FINISH2_RETIRED) delete out[key];
  return Object.freeze(out);
}
