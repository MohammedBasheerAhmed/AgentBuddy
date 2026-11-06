// Signals about a customer's mood, counted locally with plain rules (word lists, capital letters, counts, order of
// messages). Pure: no browser, no network, no AI. The numbers are handed to the model as one labelled part, so its answer
// about mood and escalation risk is grounded in things anyone can check, not only in its own reading of the thread.
//
// Honest limits, stated where the person reads them (see signalsText): these are word and count rules. They read English and
// Arabic (round 4: the Arabic lists below give the same labels), miss sarcasm, other languages and polite anger, and a word list
// over-counts ("manager" can be a neutral mention). They are evidence for the model and the agent, never a verdict.
//
// Nothing here quotes ticket text. The output holds counts and labels from our own word lists only, so the signals part
// cannot carry a name or number of its own.

import { authorRole, identities } from '../context/identity.js';
import { parseSnTime } from '../context/util.js';
import { arabicFolded, arabicRule } from '../lib/similar.js';

// Kept here as before for the modules that import them from this file (src/itsm/parts.js, src/insights/glance.js and journey.js).
export { identities };

// ---- Word lists ---------------------------------------------------------------------------------------
// [label, pattern]: the label is what the signals part says; the pattern is matched case-insensitively, whole words only.

const FRUSTRATION = [
  ['frustrated', /\bfrustrat(?:ed|ing|ion)\b/i],
  ['annoyed', /\bannoy(?:ed|ing|s)\b/i],
  ['ridiculous', /\bridiculous(?:ly)?\b/i],
  ['unacceptable', /\bunacceptable\b/i],
  ['terrible', /\b(?:terrible|terribly|awful|horrible|horrendous|appalling|atrocious|dreadful)\b/i],
  ['useless', /\b(?:useless|pointless|incompetent|pathetic|rubbish|hopeless)\b/i],
  ['fed up', /\b(?:fed up|sick of|tired of|had enough|sick and tired)\b/i],
  ['angry', /\b(?:angry|furious|livid|outraged|outrageous|infuriating|disgusted|disgusting)\b/i],
  ['disappointed', /\b(?:disappoint(?:ed|ing|ment)|dissatisfied|unhappy|not happy|upset)\b/i],
  ['worst', /\bworst\b/i],
  ['waste of time', /\bwaste of (?:my |our )?(?:time|money)\b/i],
  ['shocking', /\bshocking\b/i],
  ['poor service', /\b(?:poor|bad|lousy) (?:service|support|experience)\b/i],
  ['nonsense', /\b(?:nonsense|farce|shambles)\b/i],
];

// Words that bring in someone with authority, or talk about leaving. A neutral "my manager approved it" counts too.
const ESCALATION = [
  ['escalate', /\bescalat(?:e|ed|es|ing|ion)\b/i],
  ['manager or executive', /\b(?:manager|supervisor|director|vp|ceo|cio|cto|executive|senior management|higher up|higher-ups)\b/i],
  ['complaint', /\bcomplain(?:t|ts|ing|ed)?\b/i],
  ['legal', /\b(?:legal|lawyer|solicitor|lawsuit|regulator|ombudsman|sue you|sue us)\b/i],
  ['cancel', /\bcancel(?:l?ing|l?ed)?\b.{0,20}\b(?:contract|subscription|account|service|licen[cs]e)\b/i],
  ['refund', /\b(?:refund|compensation)\b/i],
];

const URGENCY = [
  ['urgent', /\burgent(?:ly)?\b/i],
  ['asap', /\basap\b|\bas soon as possible\b/i],
  ['immediately', /\bimmediate(?:ly)?\b/i],
  ['critical', /\bcritical\b/i],
  ['emergency', /\bemergency\b/i],
  ['deadline', /\bdeadline\b/i],
  ['right now', /\bright now\b/i],
  ['cannot work', /\b(?:cannot|can't|cant|unable to) (?:work|do my job|log ?in|access)\b/i],
  ['production down', /\bproduction (?:is )?down\b/i],
  ['blocked', /\b(?:blocked|blocking)\b/i],
];

// "again", "still" and friends: the problem came back or was not fixed.
const REPEAT = [
  ['again', /\bagain\b/i],
  ['still', /\bstill\b/i],
  ['nth time', /\b(?:second|third|fourth|fifth|sixth|2nd|3rd|[4-9]th|\d{2,}th|umpteenth|nth) time\b/i],
  ['every time', /\bevery (?:single )?time\b/i],
  ['once more', /\b(?:yet again|once more|over and over)\b/i],
  ['already told', /\balready (?:told|said|sent|explained|provided|tried|mentioned|asked|reported)\b/i],
  ['same problem', /\b(?:same|recurring|repeated|repeat) (?:issue|problem|error|fault)\b/i],
  ['many times', /\b(?:twice|several times|multiple times|many times|how many times|three times|four times)\b/i],
];

// A message that asks where things are. (A second message with no reply in between counts as a chaser too.)
const CHASE = [
  /\b(?:any|an) updates?\b/i,
  /\bupdate (?:please|pls|on this)\b/i,
  /\bfollow(?:ing)?[- ]?up\b/i,
  /\bchas(?:e|ing|ed)\b/i,
  /\breminder\b/i,
  /\bstill waiting\b/i,
  /\bwaiting (?:for|on) (?:a |an |your |any |some )?(?:reply|response|update|answer|call|callback|news)\b/i,
  /\b(?:haven't|have not|hasn't|has not|not yet) (?:heard|had|received)\b/i,
  /\b(?:heard nothing|no news)\b/i,
  /\b(?:no|nobody|no one) (?:has )?(?:reply|replied|response|responded|update|answer)\b/i,
  /\bany (?:news|progress|luck)\b/i,
  /\bhello\?+/i,
];

const THANKS = /\b(?:thanks|thank you|thx|appreciat(?:e|ed|es|ion)|cheers|grateful)\b/gi;

// ---- The same lists in Arabic ---------------------------------------------------------------------------
// { label: entries }: the labels are the English lists' own labels (so the card and the signals part name them the same way);
// each entry is regular-expression source in plain Arabic, matched as a whole word in the text folded with normalizeArabic, with
// "و", "ف", "ب", "ل", "ك" and the article allowed in front (src/lib/similar.js arabicRule). Modern Standard Arabic first, and the
// few everyday words customers write in every dialect. A space stands for any run of spaces.

export const ARABIC_WORDS = Object.freeze({
  frustration: {
    frustrated: ['محبط(?:ة|ين)?', 'إحباط'],
    annoyed: ['منزعج(?:ة|ين)?', 'انزعاج', 'مزعج(?:ة)?', 'إزعاج'],
    ridiculous: ['سخيف(?:ة)?', 'سخافة'],
    unacceptable: ['غير مقبول(?:ة)?', 'لا يقبل', 'لا يمكن قبوله'],
    terrible: ['سيئ(?:ة)? جدا', 'سيء(?:ة)? جدا', 'فظيع(?:ة)?', 'مروع(?:ة)?', 'كارثي(?:ة)?', 'كارثة', 'مزري(?:ة)?'],
    useless: ['بلا فائدة', 'لا فائدة', 'عديم(?:ة)? الفائدة', 'غير مجد(?:ي|ية)?', 'فاشل(?:ة|ين)?'],
    'fed up': ['سئمت', 'مللت', 'طفح الكيل', 'زهقت', 'تعبت من', 'ضقت ذرعا'],
    angry: ['غاضب(?:ة|ين)?', 'غضب', 'مستفز(?:ة)?', 'حانق(?:ة)?'],
    disappointed: ['خيبة أمل', 'مخيب(?:ة)? للآمال', 'مستاء(?:ة|ين)?', 'استياء', 'غير راض(?:ي|ية)?', 'غير سعيد(?:ة)?', 'زعلان(?:ة)?'],
    worst: ['أسوأ'],
    'waste of time': ['مضيعة (?:لل)?وقت', 'إضاعة (?:لل|ال)?وقت', 'هدر (?:لل|ال)?وقت', 'تضييع (?:لل|ال)?وقت'],
    shocking: ['صادم(?:ة)?'],
    'poor service': ['(?:خدمة|دعم|تجربة) (?:سيئة|سيئ|سيء|رديئة|رديء|ضعيفة|ضعيف)', 'سوء (?:ال)?خدمة'],
    nonsense: ['هراء', 'مهزلة', 'كلام فارغ'],
  },
  escalation: {
    escalate: ['تصعيد', 'سأصعد', 'سنصعد', 'أصعد (?:الموضوع|الأمر|المشكلة)'],
    // ("رئيسي" is left out: it is also "main", as in the main server.)
    'manager or executive': ['مدير(?:ي|نا|ك|كم|ه|هم)?', 'مشرف(?:ي|نا|ك|كم)?', 'رئيس القسم', 'الرئيس التنفيذي', 'الإدارة العليا', 'نائب الرئيس'],
    complaint: ['شكوى', 'شكاوى', 'شكاوي', 'أشتكي', 'سأشتكي', 'نشتكي', 'سنشتكي'],
    legal: ['محام(?:ي|ين)?', 'محكمة', 'دعوى قضائية', 'قضائي(?:ة)?', 'قانوني(?:ة|ا)?'],
    cancel: ['(?:إلغاء|ألغي|سألغي|نلغي|سنلغي).{0,20}(?:عقد|اشتراك|حساب|خدمة|ترخيص)(?:نا|ي|كم|ه)?'],
    refund: ['استرداد', 'استرجاع (?:ال)?مبلغ', 'رد (?:ال)?مبلغ', 'تعويض'],
  },
  urgency: {
    urgent: ['عاجل(?:ة|ا)?', 'مستعجل(?:ة)?', 'ضروري جدا'],
    asap: ['أسرع وقت(?: ممكن)?', 'أقرب وقت(?: ممكن)?', 'أقصى سرعة'],
    immediately: ['فورا', 'فوري(?:ة)?', 'حالا', 'على الفور'],
    critical: ['حرج(?:ة)?', 'بالغ(?:ة)? الأهمية'],
    emergency: ['طوارئ', 'طارئ(?:ة)?'],
    deadline: ['موعد نهائي', 'آخر موعد', 'مهلة نهائية'],
    'right now': ['في الحال', 'في هذه اللحظة'],
    'cannot work': [
      '(?:لا|لم) (?:أستطيع|أقدر|يمكنني|أتمكن من|نستطيع|يمكننا|نتمكن من)(?: على)? (?:العمل|أعمل|الدخول|تسجيل الدخول|الوصول|أداء عملي|إنجاز عملي)',
      '(?:عملي|العمل) متوقف',
    ],
    'production down': ['(?:توقف|تعطل) (?:بيئة )?الإنتاج', '(?:بيئة )?الإنتاج (?:متوقف(?:ة)?|معطل(?:ة)?|واقف(?:ة)?)'],
    blocked: ['محظور(?:ة)?', 'محجوب(?:ة)?'],
  },
  repeat: {
    // ("هل من جديد" is "any news?", a chaser, not "again".)
    again: ['مرة أخرى', 'مرة ثانية', 'مجددا', '(?<!هل\\s+)من جديد'],
    still: ['(?:ما|لا)\\s*(?:زال|زالت|زلت|زلنا|يزال|تزال|أزال|نزال)'],
    'nth time': ['مرة ال(?:ثانية|ثالثة|رابعة|خامسة|سادسة|سابعة|ثامنة|تاسعة|عاشرة|عشرين|مليون)', '(?:ثاني|ثالث|رابع|خامس|سادس|عاشر) مرة', 'مرة [0-9٠-٩]+'],
    'every time': ['كل مرة'],
    'once more': ['مرة تلو الأخرى', 'مرارا(?: وتكرارا)?', 'مرة بعد مرة'],
    'already told': [
      'سبق (?:أن |وأن |و)?(?:أبلغت|أخبرت|ذكرت|أرسلت|شرحت|طلبت|جربت|قلت|أوضحت)(?:كم|ك)?',
      'كما (?:ذكرت|قلت|أخبرتكم|أوضحت)',
      '(?:ذكرت|أبلغت|أرسلت|أخبرتكم|شرحت|قلت) (?:لكم )?(?:سابقا|من قبل)',
    ],
    'same problem': ['نفس (?:ال)?(?:مشكلة|خطأ|عطل)', '(?:مشكلة|خطأ|عطل) (?:نفسه|نفسها|ذاته|ذاتها)', '(?:مشكلة|عطل|خطأ) متكرر(?:ة)?'],
    'many times': ['مرتين', 'عدة مرات', 'مرات عديدة', 'مرات كثيرة', 'أكثر من مرة', 'كم مرة', '(?:ثلاث|أربع|خمس) مرات'],
  },
  chase: [
    'أي (?:تحديث|جديد|أخبار|مستجدات)',
    'هل من (?:جديد|تحديث|أخبار|مستجدات)',
    'هل (?:هناك|يوجد) (?:أي )?(?:تحديث|جديد|أخبار|مستجدات)',
    'ما (?:الجديد|الأخبار|المستجدات)',
    'متابعة',
    'أتابع',
    'تذكير',
    '(?:ما|لا)\\s*(?:زلت|زلنا|أزال|نزال) (?:أنتظر|ننتظر|بانتظار|في انتظار)',
    '(?:بانتظار|في انتظار) (?:الرد|ردكم|ردك|رد|التحديث)',
    '(?:لم|ما) (?:يصلني|يصلنا|أتلق|نتلق|أستلم|نستلم) (?:أي )?(?:رد|جواب|تحديث)',
    '(?:لم|لا) (?:يرد|يتم الرد|يوجد رد)',
    'لا (?:أحد|يوجد أحد) (?:يرد|رد)',
  ],
  thanks: ['شكرا', 'أشكرك(?:م)?', 'نشكرك(?:م)?', 'مشكور(?:ين|ة)?', 'ممتن(?:ة|ين)?', 'جزاك(?:م)? الله(?: خيرا)?'],
});

const arabicList = (spec) => Object.entries(spec).map(([label, entries]) => [label, arabicRule(entries)]);
const AR_FRUSTRATION = arabicList(ARABIC_WORDS.frustration);
const AR_ESCALATION = arabicList(ARABIC_WORDS.escalation);
const AR_URGENCY = arabicList(ARABIC_WORDS.urgency);
const AR_REPEAT = arabicList(ARABIC_WORDS.repeat);
const AR_CHASE = arabicRule(ARABIC_WORDS.chase);
const AR_THANKS = arabicRule(ARABIC_WORDS.thanks, 'gu');

// Capital words that are normal in IT writing: not shouting.
const ACRONYMS = new Set(
  (
    'VPN SAP LDAP DNS DHCP HTTP HTTPS HTML SSL TLS MFA SSO SMS SMTP IMAP POP SQL WIFI WLAN LAN WAN OTP CSV PDF USB HDMI API JSON XML RDP ' +
    'CPU GPU RAM SSD HDD BIOS URL FAQ ASAP FYI ETA SLA KPI CEO CIO CTO CFO COO INC REQ RITM CHG PRB KB UTC GMT EST PST CET AWS GCP VDI ERP ' +
    'CRM HRIS SIM APN PIN IOS MAC PC TV OK'
  ).split(' ')
);

// ---- Text analysis ------------------------------------------------------------------------------------

// Curly apostrophes (U+2018, U+2019, U+02BC) become plain ones so "can't" matches. Written as numbers: this file stays plain ASCII.
const CURLY_APOSTROPHES = new RegExp(`[${String.fromCharCode(0x2018, 0x2019, 0x2bc)}]`, 'g');
const plainQuotes = (text) => String(text ?? '').replace(CURLY_APOSTROPHES, "'");
// The labels found, in the English list's order: by the English pattern in the text, or by the Arabic one in the folded text.
const labelsFound = (list, text, arList, folded) => {
  const arabic = folded ? new Set(arList.filter(([, re]) => re.test(folded)).map(([label]) => label)) : null;
  return list.filter(([label, re]) => re.test(text) || Boolean(arabic?.has(label))).map(([label]) => label);
};

/**
 * What one piece of text shows. Labels come from the word lists above, never from the text itself.
 * @returns {{ frustration: string[], escalation: string[], urgency: string[], repeat: string[], chase: boolean,
 *   shoutedWords: number, shouting: boolean, exclamationRuns: number, thanks: number }}
 */
export function analyseText(text) {
  const t = plainQuotes(text);
  // The text folded for the Arabic lists ('' when it has no Arabic letter: those lists are skipped).
  const ar = arabicFolded(t);
  const shouted = (t.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !ACRONYMS.has(w));
  // A message shouts when two words are in capitals, or one long word (URGENT) is. (Arabic has no capital letters.)
  const shouting = shouted.length >= 2 || shouted.some((w) => w.length >= 6);
  // The Arabic question mark counts like "?".
  const runs = (t.match(/[!?؟]{2,}/g) || []).filter((r) => r.includes('!') || r.length >= 3);
  return {
    frustration: labelsFound(FRUSTRATION, t, AR_FRUSTRATION, ar),
    escalation: labelsFound(ESCALATION, t, AR_ESCALATION, ar),
    urgency: labelsFound(URGENCY, t, AR_URGENCY, ar),
    repeat: labelsFound(REPEAT, t, AR_REPEAT, ar),
    chase: CHASE.some((re) => re.test(t)) || (ar !== '' && AR_CHASE.test(ar)),
    shoutedWords: shouted.length,
    shouting,
    exclamationRuns: runs.length,
    thanks: (t.match(THANKS) || []).length + (ar ? (ar.match(AR_THANKS) || []).length : 0),
  };
}

// ---- Who is the customer? -----------------------------------------------------------------------------
// src/context/identity.js: the caller, requester, contact, consumer, or on an HR case the employee; names in any script, logins
// and email addresses all match the person.

/**
 * Who wrote a journal entry: 'customer', 'support' (the assignee, or a display name that is not a customer's), 'unknown' (no
 * customer could be identified, the entry has no author, or a login that matches no one, so its role cannot be told), or 'note'
 * for an internal work note.
 */
export function roleOfEntry(entry, ids) {
  if (!entry || entry.type !== 'comment') return 'note';
  return authorRole(entry.by, ids);
}

// ---- Time ---------------------------------------------------------------------------------------------

const HOUR = 3600000;

/** "about 5 hours", "about 3 days", "less than an hour". Never more precise than the time zone allows. */
export function approxAge(hours) {
  if (!Number.isFinite(hours)) return '';
  const h = Math.max(0, hours);
  if (h < 1) return 'less than an hour';
  if (h < 48) {
    const n = Math.round(h);
    return `about ${n} hour${n === 1 ? '' : 's'}`;
  }
  return `about ${Math.round(h / 24)} days`;
}

// ---- The signals --------------------------------------------------------------------------------------

const countOf = (value) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const union = (lists) => [...new Set(lists.flat())];

/**
 * Count the signals in a pack. Only the newest `depth` notes are looked at: the same ones the model is shown.
 * @param {object} pack ContextPack
 * @param {{ now?: number, depth?: number }} [options] now: milliseconds (tests pass it); depth: how many notes
 */
export function computeSignals(pack, { now = Date.now(), depth = 20 } = {}) {
  const fields = pack?.fields || {};
  const journal = (Array.isArray(pack?.journal) ? pack.journal : []).filter((e) => e && String(e.text ?? '').trim()).slice(-Math.max(1, depth));
  const ids = identities(pack);
  const comments = journal.filter((e) => e.type === 'comment').map((e) => ({ e, role: roleOfEntry(e, ids), at: parseSnTime(e.when), found: analyseText(e.text) }));

  // Messages that count as "the customer's": theirs when we know who they are, every customer-visible comment when we do not.
  const theirs = ids.known ? comments.filter((c) => c.role === 'customer') : comments;
  const replies = ids.known ? comments.filter((c) => c.role === 'support') : [];

  // A chaser: a customer message that asks where things are, or that follows another customer message nobody answered.
  // When the customer is not known, "follows another message" would count support replies too, so only the wording counts.
  let run = 0;
  let chasers = 0;
  for (const c of comments) {
    if (!ids.known) {
      if (c.found.chase) chasers += 1;
      continue;
    }
    if (c.role === 'unknown') continue; // an entry whose author cannot be told is neither a reply nor a chaser
    if (c.role !== 'customer') {
      run = 0;
      continue;
    }
    if (run >= 1 || c.found.chase) chasers += 1;
    run += 1;
  }
  const last = comments[comments.length - 1];
  const awaitingReply = ids.known && last ? last.role === 'customer' : false;

  const hoursSince = (at) => (Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, (now - at) / HOUR) : null);
  const newest = (list) => list.reduce((best, c) => (Number.isFinite(c.at) && (best === null || c.at > best) ? c.at : best), null);
  const lastCustomerAt = newest(theirs);
  const lastSupportAt = newest(replies);

  const opening = analyseText(`${fields.short_description || ''}\n${fields.description || ''}`);
  const slas = Array.isArray(pack?.related?.slas) ? pack.related.slas : null;

  return {
    customerKnown: ids.known,
    commentsRead: comments.length,
    customerMessages: theirs.length,
    supportReplies: replies.length,
    chasers,
    unansweredCustomerMessages: ids.known ? run : null,
    awaitingReply,
    hoursSinceCustomerMessage: hoursSince(lastCustomerAt),
    hoursSinceSupportReply: hoursSince(lastSupportAt),
    frustrationWords: union(theirs.map((c) => c.found.frustration)),
    escalationWords: union(theirs.map((c) => c.found.escalation)),
    urgencyWords: union(theirs.map((c) => c.found.urgency)),
    repeatPhrases: union(theirs.map((c) => c.found.repeat)),
    repeatMessages: theirs.filter((c) => c.found.repeat.length).length,
    shoutingMessages: theirs.filter((c) => c.found.shouting).length,
    shoutedWords: theirs.reduce((sum, c) => sum + c.found.shoutedWords, 0),
    exclamationRuns: theirs.reduce((sum, c) => sum + c.found.exclamationRuns, 0),
    thanks: theirs.reduce((sum, c) => sum + c.found.thanks, 0),
    opening: {
      frustrationWords: opening.frustration,
      escalationWords: opening.escalation,
      urgencyWords: opening.urgency,
      repeatPhrases: opening.repeat,
      shouting: opening.shouting,
      exclamationRuns: opening.exclamationRuns,
    },
    reopenCount: countOf(fields.reopen_count),
    reassignmentCount: countOf(fields.reassignment_count),
    priority: String(fields.priority || '').trim(),
    state: String(fields.state || '').trim(),
    slas: slas ? { total: slas.length, breached: slas.filter((s) => s && s.breached === 'true').length } : null,
  };
}

// ---- The part the model reads ----------------------------------------------------------------------------

const list = (words) => (words.length ? words.join(', ') : 'none');
const times = (n) => (n === 1 ? '1 time' : `${n} times`);

/** The signals as short labelled lines. Counts and our own labels only. */
export function signalsText(s) {
  const lines = ['Counted by simple word and count rules, not a judgement. They can miss sarcasm and other languages.'];
  if (!s.commentsRead) {
    lines.push('Customer-visible comments read: 0 (nothing has been written to the customer yet, or the comments could not be read).');
  } else if (s.customerKnown) {
    lines.push(`Customer-visible comments read: ${s.commentsRead} (customer ${s.customerMessages}, support ${s.supportReplies}).`);
  } else {
    lines.push(`Customer-visible comments read: ${s.commentsRead}. The customer could not be identified, so all of them are counted together and the counts below may include support staff.`);
  }
  if (s.customerKnown) {
    lines.push(`Customer chasers (asking for news, or writing again with no reply in between): ${s.chasers}.`);
    lines.push(`Customer messages in a row with no reply from support: ${s.unansweredCustomerMessages}.`);
    lines.push(`The newest customer-visible comment is from the customer (waiting for an answer): ${s.awaitingReply ? 'yes' : 'no'}.`);
  } else {
    lines.push(`Messages that ask where things are, or repeat an earlier message: ${s.chasers}.`);
  }
  const since = approxAge(s.hoursSinceCustomerMessage);
  const sinceWhat = s.customerKnown ? "the customer's last message" : 'the newest customer-visible comment';
  lines.push(`Time since ${sinceWhat}: ${since ? `${since} (approximate: the time zone of the notes is not known)` : 'not known'}.`);
  const sinceSupport = approxAge(s.hoursSinceSupportReply);
  if (s.customerKnown) lines.push(`Time since the last reply from support: ${sinceSupport ? `${sinceSupport} (approximate)` : 'no reply, or not known'}.`);
  lines.push(`Frustration words in the customer's messages: ${list(s.frustrationWords)}.`);
  lines.push(`Escalation words (manager, complaint, cancel, legal...): ${list(s.escalationWords)}.`);
  lines.push(`Urgency words: ${list(s.urgencyWords)}.`);
  lines.push(`Repeat phrases ("again", "still", "third time"...): ${list(s.repeatPhrases)}, in ${s.repeatMessages} message${s.repeatMessages === 1 ? '' : 's'}.`);
  lines.push(`Shouting (words in capital letters): ${s.shoutingMessages} message${s.shoutingMessages === 1 ? '' : 's'}, ${s.shoutedWords} capitalised word${s.shoutedWords === 1 ? '' : 's'}.`);
  lines.push(`Runs of exclamation or question marks: ${s.exclamationRuns}.`);
  lines.push(`Thank-you words: ${s.thanks}.`);

  const o = s.opening;
  const openingBits = [];
  if (o.frustrationWords.length) openingBits.push(`frustration words: ${o.frustrationWords.join(', ')}`);
  if (o.escalationWords.length) openingBits.push(`escalation words: ${o.escalationWords.join(', ')}`);
  if (o.urgencyWords.length) openingBits.push(`urgency words: ${o.urgencyWords.join(', ')}`);
  if (o.repeatPhrases.length) openingBits.push(`repeat phrases: ${o.repeatPhrases.join(', ')}`);
  if (o.shouting) openingBits.push('capital letters');
  if (o.exclamationRuns) openingBits.push(`${o.exclamationRuns} run${o.exclamationRuns === 1 ? '' : 's'} of exclamation marks`);
  lines.push(`In the short description and description: ${openingBits.length ? openingBits.join('; ') : 'nothing notable'}.`);

  lines.push(`Reopened: ${s.reopenCount === null ? 'not stated' : times(s.reopenCount)}.`);
  lines.push(`Reassigned between groups or people: ${s.reassignmentCount === null ? 'not stated' : times(s.reassignmentCount)}.`);
  lines.push(`Priority: ${s.priority || 'not stated'}.`);
  lines.push(`State: ${s.state || 'not stated'}.`);
  if (s.slas) lines.push(`SLAs: ${s.slas.breached} breached of ${s.slas.total}.`);
  return lines.join('\n');
}
