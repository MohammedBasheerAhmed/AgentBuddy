// G6, fulfilment checklist: turn the written instructions of a catalog task or requested item into steps the agent can tick
// off, without an AI. Pure: no I/O, no storage (see checklistStore.js for the ticks).
//
// The splitter reads, in this order of trust:
//   1. numbered and bulleted lists ("1.", "2)", "Step 3:", "-", "*", "[ ]"), with indented lines joined to the item above;
//   2. other lines and sentences that start with an action word ("Create the account", "Please send the invoice");
//   3. one sentence with "then" / "after that" / "finally" in it, split into its parts.
// Lines that are only context ("New starter laptop for Friday.") are not steps. A heading that ends in a colon is skipped.
//
// A step's id is a short hash of its normalised text, so the same step keeps the same id each time the task is opened
// (and a reworded step is a new, unticked one). Only these ids are ever stored, never the text.
//
// Arabic instructions (round 4) are read the same way: lists in Arabic-Indic digits and "الخطوة 1:", lines that start with an
// imperative or a verbal noun ("أنشئ الحساب", "إنشاء الحساب", "يرجى إرسال..."), and "ثم" / "بعد ذلك" / "أخيرا" splits.

import { t } from '../i18n/index.js';
import { normalizeArabic } from '../lib/scriptDetect.js';
import { withoutArabicArticle } from '../lib/similar.js';

export const MAX_STEPS = 40;
export const MAX_STEP_CHARS = 200;

// ---- words ---------------------------------------------------------------------------------------------------------

// Action words that start a step. Plain verbs a fulfiller does; kept long on purpose, so prose still splits well.
const VERBS = new Set(
  ('accept activate add allocate apply approve archive ask assign attach back backup book call cancel capture change charge check clean clear close collect ' +
    'complete configure confirm connect contact convert copy create decommission delete deliver deploy disable document download draft email enable ensure ' +
    'enter escalate establish export extract fill find fix follow forward gather generate get give grant hand identify image import inform install inspect ' +
    'issue join label link load locate lock log look make map migrate monitor move notify obtain open order pack pair perform pick place plan power ' +
    'prepare print process provide provision purchase put raise reassign receive record reboot register reject release remind remove rename reorder repair ' +
    'replace reply report request reserve reset resolve restart restore retrieve return review revoke run save schedule scan search select send set setup ' +
    'sign ship shut speak start stop store submit swap switch tag take talk test text tick tidy track transfer turn uninstall unlock update upgrade upload ' +
    'use validate verify visit wait wipe write fulfil fulfill').split(' ')
);
// Two-word starts ("make sure", "set up", "hand over").
const TWO_WORD = new Set(['make sure', 'set up', 'hand over', 'log in', 'sign in', 'follow up', 'double check', 'check in', 'back up', 'look up', 'carry out', 'sign off', 'reach out', 'hook up']);
// Words that may come in front of the action word.
const LEAD = new Set(['please', 'then', 'and', 'also', 'next', 'finally', 'lastly', 'now', 'first', 'second', 'third', 'afterwards', 'once', 'done', 'ok', 'okay', 'you', 'must', 'should', 'need', 'needs', 'to', 'will', 'can', 'could', 'kindly', 'remember', 'do', 'not', 'dont', "don't"]);

// The same in Arabic, written normally and folded with normalizeArabic when the sets are built. Arabic instructions use the
// imperative ("أنشئ") or the verbal noun ("إنشاء"), so both are listed. A word is also recognised with "و" / "ف" in front, with
// "ب" after "قم" ("قم بإنشاء"), and a verbal noun with the article ("التحقق من الهوية"). Left out on purpose: imperatives that are
// also everyday nouns or past tenses ("حدث" happened, "عطل" a fault, "جدول" a table, "اتصال" a connection); their verbal nouns
// (تحديث، تعطيل، جدولة) are in.
const AR_VERBS = new Set(
  ('أنشئ إنشاء أضف إضافة أرسل إرسال تحقق افحص فحص راجع مراجعة تأكد اتصل تواصل ثبت تثبيت تنصيب أزل إزالة ألغ إلغاء احذف ' +
    'حذف أعد إعادة فعل تفعيل تعطيل أوقف إيقاف امنح منح اسحب سحب سلم تسليم اطلب طلب جهز تجهيز تحديث انقل نقل اربط ربط ' +
    'توصيل افتح فتح أغلق إغلاق وافق موافقة اعتمد اعتماد ارفض رفض أبلغ إبلاغ أخبر أخطر إخطار أعلم أشعر إشعار حدد تحديد اختر اختيار ' +
    'اطبع طباعة امسح مسح انسخ نسخ احفظ حفظ سجل تسجيل أسند إسناد عين تعيين اضبط ضبط هيئ تهيئة إعداد اختبر اختبار جرب تجربة ارفع ' +
    'رفع تحميل نزل تنزيل أرفق إرفاق استبدل استبدال أصلح إصلاح أرجع إرجاع استلم استلام اجمع جمع اكتب كتابة وثق توثيق صعد تصعيد ' +
    'احجز حجز أقفل قفل استخدم استخدام شغل تشغيل انتظر انتظار أكمل إكمال أتم إتمام قدم تقديم اشحن شحن أدخل إدخال املأ تعبئة تابع ' +
    'متابعة ابحث بحث جدولة راقب مراقبة وفر توفير أعط إعطاء خذ أطفئ إطفاء وقع توقيع اشتر شراء أصدر إصدار أكد تأكيد زيارة')
    .split(' ')
    .map(normalizeArabic)
);
const AR_LEAD = new Set(
  ('يرجى الرجاء رجاء برجاء نرجو من فضلك لطفا قم قومي قوموا ثم و أيضا كذلك بعد ذلك بعدها أخيرا أولا ثانيا ثالثا رابعا الآن يجب ' +
    'عليك عليكم أن لا تنس يتم يمكنك ينبغي يلزم تحتاج ستحتاج إلى')
    .split(' ')
    .map(normalizeArabic)
);
const ARABIC = /\p{Script=Arabic}/u;

// The ways an Arabic word may be one of the listed words: as it is, without "و" / "ف" in front, without "ب" in front ("بإنشاء"), a
// verbal noun without its article, or an imperative without its object pronoun ("أرسله", "أضفها", "أبلغهم").
function arabicForms(word) {
  const out = [word];
  if (/^[وفب]/.test(word) && word.length > 2) out.push(word.slice(1));
  for (const w of [...out]) {
    const bare = withoutArabicArticle(w);
    if (bare !== w) out.push(bare);
  }
  for (const w of [...out]) {
    const m = /^(.{2,}?)(?:ها|هم|ه)$/u.exec(w);
    if (m) out.push(m[1]);
  }
  return out;
}
const isVerb = (word) => VERBS.has(word) || (ARABIC.test(word) && arabicForms(word).some((w) => AR_VERBS.has(w)));
const isLead = (word) => LEAD.has(word) || (ARABIC.test(word) && arabicForms(word).some((w) => AR_LEAD.has(w)));

// The words of a sentence, lower case; Arabic folded (its marks would otherwise cut a word in two).
const wordsIn = (sentence) => normalizeArabic(String(sentence).toLowerCase()).replace(/[^\p{L}\p{N}'\s-]/gu, ' ').split(/\s+/).filter(Boolean);

/** Does this sentence start like an instruction ("Create...", "Please send...", "You need to check...", "يرجى إرسال...")? */
export function looksLikeStep(sentence) {
  const words = wordsIn(sentence);
  for (let i = 0; i < Math.min(words.length, 5); i += 1) {
    const two = `${words[i]} ${words[i + 1] || ''}`;
    if (TWO_WORD.has(two)) return true;
    if (isVerb(words[i])) return true;
    if (!isLead(words[i])) return false;
  }
  return false;
}

// ---- cleaning ------------------------------------------------------------------------------------------------------

// A list marker at the start of a line; the last group is the item text. Digits may be Arabic-Indic (١، ٢، ٣) and "step" may be
// "خطوة" / "الخطوة".
const STEP_WORD = '(?:step|(?:\\u0627\\u0644)?\\u062e\\u0637\\u0648[\\u0629\\u0647])'; // step, خطوة, الخطوة
const DIGITS = '[\\d\\u0660-\\u0669]{1,3}';
const MARKER = new RegExp(
  '^\\s*(?:' +
    '(?:[-*\\u2022\\u00b7\\u25aa\\u25e6\\u2013\\u2014]\\s+)?\\[\\s?[xX\\u2713\\u2714 ]?\\s?\\]\\s+|' + // [ ] / - [x]
    '[\\u2610\\u2611\\u2713\\u2714]\\s*|' + // check-box characters
    '[-*\\u2022\\u00b7\\u25aa\\u25e6\\u2013\\u2014]\\s+|' + // bullets
    `(?:${STEP_WORD}\\s*)?\\(?(?:${DIGITS}|[a-hA-H])\\s*[.):]\\s+|` + // 1.  2)  (3)  step 4:  a)  ١.  الخطوة ٢:
    `(?:${STEP_WORD}\\s+${DIGITS}\\s*[-\\u2013\\u2014]\\s+)|` + // step 5 - ...
    `${DIGITS}\\s+[-\\u2013\\u2014]\\s+|` + // 6 - ...
    `${DIGITS}\\s*[-\\u2013\\u2014]\\s*(?=[\\u0621-\\u064a])|` + // ١- before an Arabic word ("1-" in English stays prose)
    '[\\u0623\\u0628\\u062c\\u062f]\\s*\\)\\s+' + // أ)  ب)  ج)  د)
    ')(\\S.*)$',
  'i'
);

const tidy = (s) => String(s).replace(/\s+/g, ' ').replace(/(\*\*|__|`)/g, '').replace(/^#+\s*/, '').trim();

function finishStep(s) {
  let out = tidy(s).replace(/[\s,;:،؛]+$/, '').replace(/\.+$/, '');
  if (!out) return '';
  out = out[0].toUpperCase() + out.slice(1);
  if (out.length > MAX_STEP_CHARS) out = `${out.slice(0, MAX_STEP_CHARS - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

// "Create the account, then add it to group X. After that, send the welcome email." -> three pieces. A sentence may also end with
// the Arabic question mark, and the next one start with an Arabic letter or digit (Arabic has no capital letters).
// (Marks and Arabic punctuation are written as \u escapes in these patterns, so the source shows what they are.)
const SENTENCE_END = new RegExp('(?<=[.!?\\u061f])\\s+(?=[A-Z0-9"\'(\\u201c\\u0621-\\u064a\\u0660-\\u0669\\u00ab])');
const THEN = /\s*(?:[,;]\s*)?\b(?:and\s+then|then|after\s+that|afterwards|after\s+this|finally|lastly)\b\s*[,:]?\s+/i;
const CONDITIONAL = /^(?:if|when|unless|in\s+case|should|whenever)\b/i;

// The Arabic "then", "after that", "afterwards", "finally", "in the end", with or without "و" ("and") in front. Matched in the text
// as written, so the hamza and the tanween of "أخيراً" are optional.
const FINALLY = '[أا]خير\\u064b?ا\\u064b?'; // أخيراً، اخيرا
const AR_THEN = new RegExp(
  `\\s*(?:[,;\\u060c\\u061b]\\s*)?(?<![\\p{L}\\p{M}])(?:و\\s*)?(?:ثم|من\\s+ثم|بعد\\s+ذلك|بعدها|${FINALLY}|في\\s+النهاي[ةه])(?![\\p{L}\\p{M}])\\s*[,:\\u060c]?\\s+`,
  'u'
);
// "If", "when", "in case", "unless" in Arabic.
const AR_CONDITIONAL = /^(?:[إا]ذا|إن|لو|عندما|في\s+حال[ةه]?|ما\s+لم)(?![\p{L}\p{M}])/u;

// "Please", "you need to", "then" in front of the action word say nothing about the action: leave them out of the step.
const FILLER_LEAD = /^(?:(?:please|kindly|then|and|also|next|finally|lastly|now|afterwards|remember to|don't forget to|do not forget to|you (?:need|have|will|must|should) to|you (?:must|should|will)|(?:needs?|has|have) to|must|should)\b[\s,:]*)+/i;
// The same in Arabic: "please" (يرجى، الرجاء، من فضلك), "do" before a verbal noun (قم بـ), "also", "then", "you must".
const AR_FILLER_LEAD = new RegExp(
  '^(?:(?:ي\\u064f?رج[ىي]|الرجاء|رجاء|برجاء|نرجو|من\\s+فضلك|لطفا|ثم|و|[أا]يضا|كذلك|بعد\\s+ذلك|بعدها|' +
    `${FINALLY}|يجب(?:\\s+[أا]ن)?|عليك(?:م)?(?:\\s+[أا]ن)?)(?![\\p{L}\\p{M}])[\\s,:\\u060c]*|قوموا\\s+ب|قومي\\s+ب|قم\\s+ب)+`,
  'u'
);

function withoutLead(piece) {
  const rest = piece.trim().replace(FILLER_LEAD, '').replace(AR_FILLER_LEAD, '');
  return rest && looksLikeStep(rest) ? rest : piece;
}

// "If the disk is full, delete it" is an instruction with a condition: a step when an action word follows the "if".
const conditionalIsStep = (part) => wordsIn(part).slice(1).some(isVerb);

function proseSteps(line) {
  const out = [];
  for (const sentence of line.split(SENTENCE_END)) {
    for (const part of sentence.split(/\s*[;؛]\s*/)) {
      if (CONDITIONAL.test(part.trim()) || AR_CONDITIONAL.test(part.trim())) {
        // A condition is kept whole; it is not cut at "then".
        if (conditionalIsStep(part)) out.push(part);
        continue;
      }
      for (const piece of part.split(THEN).flatMap((p) => p.split(AR_THEN))) if (looksLikeStep(piece)) out.push(withoutLead(piece));
    }
  }
  return out;
}

/**
 * The steps written in `raw` (a description or instructions text), in order. Plain strings, cleaned, no ids yet.
 * @param {string} raw
 * @returns {string[]}
 */
export function splitInstructions(raw) {
  const lines = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n');
  const items = [];
  let sawMarker = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = MARKER.exec(line);
    if (m) {
      items.push({ text: m[1], marked: true });
      sawMarker = true;
    } else if (sawMarker && items.length && /^(\s{2,}|\t)/.test(line)) {
      items[items.length - 1].text += ` ${line.trim()}`; // an indented line belongs to the item above
    } else {
      items.push({ text: line.trim(), marked: false });
    }
  }

  const steps = [];
  for (const item of items) {
    if (item.marked) {
      steps.push(item.text);
      continue;
    }
    if (/:\s*$/.test(item.text)) continue; // "Steps:", "Please do the following:"
    steps.push(...proseSteps(item.text));
  }
  return steps.map(finishStep).filter(Boolean);
}

// ---- ids -------------------------------------------------------------------------------------------------------------

/** Lower case, letters and digits only, single spaces: "Create the account." and "create the account" are one step. */
export const normaliseStep = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 8 hex characters from the normalised text; `occurrence` (2, 3, ...) tells apart a step that is written twice. */
export function stepId(text, occurrence = 1) {
  const norm = normaliseStep(text);
  return fnv1a(occurrence > 1 ? `${norm}#${occurrence}` : norm).toString(16).padStart(8, '0');
}

/**
 * Steps from several texts (the task's description, its special instructions...). A step that appears in an earlier text is
 * not repeated; a step written twice inside one text keeps both, with different ids.
 * @param {{ label?: string, text: string }[]} sources
 * @returns {{ id: string, text: string, from: string }[]}
 */
export function buildChecklist(sources) {
  const earlier = new Set();
  const steps = [];
  for (const source of sources) {
    const within = new Map();
    for (const text of splitInstructions(source?.text)) {
      const norm = normaliseStep(text);
      if (!norm || earlier.has(norm)) continue;
      const occurrence = (within.get(norm) || 0) + 1;
      within.set(norm, occurrence);
      if (steps.length >= MAX_STEPS) return steps;
      steps.push({ id: stepId(text, occurrence), text, from: source?.label || '' });
    }
    within.forEach((_, norm) => earlier.add(norm));
  }
  return steps;
}

// ---- ticks ---------------------------------------------------------------------------------------------------------

/**
 * "3 of 7 done". Ticks for steps that are no longer in the list (the instructions were reworded) are ignored.
 * @param {{ id: string }[]} steps
 * @param {Iterable<string>} doneIds
 */
export function checklistProgress(steps, doneIds) {
  const done = new Set(doneIds || []);
  const total = steps.length;
  const n = steps.filter((s) => done.has(s.id)).length;
  return { done: n, total, percent: total ? Math.round((n / total) * 100) : 0, complete: total > 0 && n === total, text: total ? t('{n} of {total} done', { n, total }) : t('No steps') };
}

/** The steps written on a task or requested item: its description first, then its special instructions. */
export function stepsFromPack(pack) {
  return buildChecklist([
    { label: 'Task instructions', text: pack?.fields?.description },
    { label: 'Special instructions', text: pack?.fields?.special_instructions },
  ]);
}
