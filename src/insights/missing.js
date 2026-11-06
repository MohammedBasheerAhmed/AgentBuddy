// N11, missing details: the key facts a ticket usually needs before work can start, checked with plain rules (no AI). Empty or
// vague: the configuration item, how many people are affected, the error text, who to contact, the steps that lead to the problem.
// Each item says why it matters. Pure.
//
// A field the pack could not read is not "missing": on a sensitive (HR) record free text is not read at all, and then the text
// rules are skipped instead of reporting every text as empty.

import { customersOf } from '../context/identity.js';
import { isolate, t } from '../i18n/index.js';
import { arabicFolded, arabicRule } from '../lib/similar.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// Kinds where a fault is being worked (a request or a change has other key facts).
export const MISSING_KINDS = Object.freeze(['incident', 'problem', 'case', 'task']);

const VAGUE_TITLE = /^(?:(?:it|issue|issues|problem|problems|help|urgent|error|not working|doesn'?t work|broken|question|request|ticket|please help|asap|fix|support|na|n\/a|test|[a-z]+ (?:issue|problem|not working|broken))[\s!.?]*)$/i;
const SCOPE = /\b(?:only me|just me|everyone|everybody|all (?:users|staff|of us)|whole (?:team|office|site|floor|department)|several|many users|multiple users|\d+\s*(?:users|people|colleagues|staff)|my team|our team|the team|nobody else|no one else|others|colleagues|department|site[- ]wide|company[- ]wide)\b/i;
const ERROR_TEXT = /\berror\b|\bcode\b|\bmessage\b|\bexception\b|\bfail(?:s|ed|ure|ing)?\b|\bdenied\b|\btime[- ]?out\b|\bcrash(?:es|ed)?\b|0x[0-9a-f]{3,}|\b\d{3,5}\b|["'][^"'\n]{6,}["']/i;
const STEPS = /\bsteps?\b|\breproduce\b|^\s*(?:\d+[.)]|[-*])\s+\S|\bwhen i\b|\bafter i\b|\bwhenever\b|\bevery time\b|\beach time\b|\bi tried\b|\btried to\b|\bthen\b.{0,40}\bthen\b/im;

// ---- The same rules in Arabic (round 4) -----------------------------------------------------------------------------
// Matched in the text folded with normalizeArabic, next to the English rules (a ticket may mix both). Each list is regular-expression
// source in plain Arabic, matched as whole words with "و", "ف", "ب", "ل", "ك" and the article allowed in front (src/lib/similar.js
// arabicRule); a space stands for any run of spaces. "Since when" has no rule here because the English rules have none either.
export const ARABIC_RULES = Object.freeze({
  // A title that is only "problem", "help", "not working", "X is not working", "a problem with X"...
  vagueTitle: [
    'مشكلة', 'مشاكل', 'مساعدة', 'ساعدوني', 'عاجل', 'خطأ', 'عطل', 'لا يعمل', 'لا تعمل', 'لا يشتغل', 'لا تشتغل', 'معطل(?:ة)?', 'استفسار',
    'سؤال', 'طلب', 'تذكرة', 'اختبار', 'تجربة', 'دعم', 'إصلاح',
    '[\\p{L}\\p{N}-]+ (?:لا يعمل|لا تعمل|لا يشتغل|لا تشتغل|معطل(?:ة)?|متوقف(?:ة)?)', '(?:مشكلة|عطل|خطأ) (?:في|ب)\\s*[\\p{L}\\p{N}-]+',
  ],
  // Who else is affected: "only me", "everyone", "all users", "the whole team", "5 users", "my colleagues"...
  scope: [
    'أنا فقط', 'فقط أنا', 'لوحدي', 'وحدي', 'الجميع', 'كل (?:المستخدمين|الموظفين|الزملاء|الفريق|القسم|المكتب|الشركة)',
    'جميع (?:المستخدمين|الموظفين|الزملاء)', '(?:الفريق|القسم|المكتب|الطابق|المبنى|الفرع) (?:كله|كامل|بالكامل|بأكمله)',
    'كامل (?:الفريق|القسم|المكتب|الطابق|المبنى|الفرع)', 'عدة (?:مستخدمين|موظفين|أشخاص|زملاء)', 'عدد من (?:المستخدمين|الموظفين|الزملاء)',
    'بعض (?:المستخدمين|الموظفين|الزملاء)', 'مستخدمين آخرين', '[0-9٠-٩]+\\s*(?:مستخدم(?:ين)?|موظف(?:ين)?|أشخاص|شخص|زملاء)',
    '(?:مستخدم|موظف) واحد', 'فريقي', 'فريقنا', 'لا أحد غيري', 'لا يوجد أحد غيري', 'غيري', 'زملائي', 'الزملاء', 'الآخرين', 'الآخرون',
    'القسم', 'الإدارة', 'على مستوى (?:الشركة|المؤسسة|الموقع)',
  ],
  // The error text, or a screenshot of it (the item's own advice says "or a screenshot"): "error", "message", "code", "failed",
  // "denied", "timed out", "crashed", "screenshot".
  error: [
    'خطأ', 'أخطاء', 'رسالة', 'رسائل', 'رمز', 'كود', 'فشل', 'يفشل', 'تفشل', 'فشلت', 'مرفوض(?:ة)?', 'رفض', 'انتهت المهلة', 'انتهاء المهلة',
    'تعطل', 'يتعطل', 'انهار', 'ينهار', 'لقطة (?:ال)?شاشة', 'صورة (?:لل|ال)?شاشة', 'سكرين\\s*شوت', 'اسكرين\\s*شوت',
  ],
  // Steps: "steps", "when I open", "after", "whenever", "every time", "I tried", "then ... then".
  steps: [
    'خطوات', 'خطوة', 'إعادة (?:إنتاج|تكرار) المشكلة', 'عندما', 'عند (?:فتح|الضغط|النقر|محاولة|تشغيل|الدخول|تسجيل|الاتصال|إرسال|طباعة|استخدام)',
    'بعدما', 'بعد ما', 'كلما', 'كل مرة', 'حاولت', 'جربت', 'قمت', 'ثم.{0,40}ثم',
  ],
});

const AR_VAGUE_TITLE = new RegExp(`^\\s*(?:${arabicRule(ARABIC_RULES.vagueTitle).source})[\\s!.?\\u061f]*$`, 'u');
const AR_SCOPE = arabicRule(ARABIC_RULES.scope);
// Arabic-Indic digits are a code or a number just as ASCII digits are; «quotes» hold a quoted message.
const AR_ERROR = new RegExp(`${arabicRule(ARABIC_RULES.error).source}|(?<![0-9\\u0660-\\u0669])[\\u0660-\\u0669]{3,5}(?![0-9\\u0660-\\u0669])|\\u00ab[^\\u00bb\\n]{6,}\\u00bb`, 'u');
// A numbered list in Arabic-Indic digits counts as steps, as "1." does.
const AR_STEPS = new RegExp(`${arabicRule(ARABIC_RULES.steps).source}|^\\s*[\\u0660-\\u0669]+[.)\\-]\\s+\\S`, 'mu');

// A word or two per item, for the card's one-line summary.
// (Getters, so the words follow the language when they are read.)
export const SHORT = Object.freeze({
  get title() {
    return t('title');
  },
  get description() {
    return t('description');
  },
  get ci() {
    return t('CI');
  },
  get impact() {
    return t('who is affected');
  },
  get error() {
    return t('error text');
  },
  get contact() {
    return t('contact');
  },
  get steps() {
    return t('steps');
  },
  get category() {
    return t('category');
  },
});

const item = (id, title, why) => ({ id, title, why, short: SHORT[id] || id });

/**
 * @param {object} pack ContextPack read with the 'insights-ticket' spec
 * @returns {{ applicable: boolean, items: { id, title, why }[], textRead: boolean }}
 */
export function missingDetails(pack) {
  const kind = text(pack?.kind);
  if (!MISSING_KINDS.includes(kind)) return { applicable: false, items: [], textRead: false };
  const f = pack?.fields || {};
  // A minimised pack (HR, or a task whose class is unknown) has no free text by design.
  const textRead = !pack?.sensitive && !(Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.status === 'skipped' && /free text/i.test(text(a?.note)));
  const title = text(f.short_description);
  const body = text(f.description);
  const all = `${title}\n${body}`;
  // The same texts folded for the Arabic rules ('' when there is no Arabic letter in them).
  const arTitle = arabicFolded(title);
  const arAll = arabicFolded(all);
  const arBody = arabicFolded(body);
  const items = [];

  if (textRead) {
    const words = title.split(/\s+/).filter(Boolean);
    const vague = VAGUE_TITLE.test(title) || (arTitle !== '' && AR_VAGUE_TITLE.test(arTitle));
    if (!title) items.push(item('title', t('No short description'), t('A clear title is what the next person and the search for look-alikes start from.')));
    else if (words.length < 3 || vague) items.push(item('title', t('The short description is vague'), t('Say what fails and where, for example "VPN drops every 10 minutes on the London profile".')));
    if (!body) items.push(item('description', t('No description'), t('Ask what happened, since when, and what the person was doing.')));
    else if (body.length < 40) items.push(item('description', t('The description is very short'), t('A few more sentences save a round trip to the customer.')));
  }
  if (['incident', 'problem', 'case'].includes(kind) && !text(f.cmdb_ci) && !text(f.asset) && !text(f.product)) {
    items.push(item('ci', t('No configuration item'), t('Without it, outages, recent changes and known errors on the same item cannot be checked.')));
  }
  if (textRead && ['incident', 'case', 'task'].includes(kind) && !SCOPE.test(all) && !(arAll && AR_SCOPE.test(arAll))) {
    items.push(item('impact', t('Not clear who else is affected'), `${t('Ask whether colleagues have the same problem.')}${text(f.impact) ? ` ${t('The impact is set to {impact}.', { impact: isolate(text(f.impact)) })}` : ''}`));
  }
  if (textRead && ['incident', 'problem', 'case'].includes(kind) && (title || body) && !ERROR_TEXT.test(all) && !(arAll && AR_ERROR.test(arAll))) {
    items.push(item('error', t('No error message quoted'), t('The exact error text (or a screenshot) is often the fastest way to the fix.')));
  }
  // The caller, requester, contact or consumer (src/context/identity.js).
  const [customer] = customersOf(pack);
  // An email that could not be read (sys_user refused) is not an email that is missing.
  const usersRead = !(Array.isArray(pack?.access) ? pack.access : []).some((a) => a?.source === 'sys_user' && a?.status !== 'ok' && a?.status !== 'empty');
  if (textRead && kind !== 'problem') {
    if (!customer) items.push(item('contact', t('No caller or contact'), t('Nobody is named as the person to keep informed.')));
    else if (!text(customer.email) && usersRead) items.push(item('contact', t('No email address for the caller'), t('Check how to reach them before you promise an update.')));
  }
  if (textRead && ['incident', 'problem', 'case'].includes(kind) && body && !STEPS.test(body) && !(arBody && AR_STEPS.test(arBody))) {
    items.push(item('steps', t('No steps to reproduce'), t('Ask what they do just before it happens, so you can see it yourself.')));
  }
  if (['incident', 'problem', 'case'].includes(kind) && !text(f.category)) {
    items.push(item('category', t('No category'), t('The category drives routing and reports.')));
  }
  return { applicable: true, items, textRead };
}
