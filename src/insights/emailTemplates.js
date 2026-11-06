// N20, a plain email template per kind of email (no AI), filled from the ticket: the person's first name, the ticket number and
// its title, the agent's name. What only the agent knows stays a [placeholder in brackets] for them to fill. Pure.
//
// The six kinds are the ones src/compose/emailRecommend.js recommends (EMAIL_TYPES); this file never changes which one fits.
//
// Languages (round 4): every template is written in English and in Arabic. The templates are what the CUSTOMER reads, so they are
// data with a version per language, not panel texts: the panel's language never changes them by itself. Which one is used follows
// the rule of the AI answers (Settings > Language of AI answers, src/prompts/rules.js): by default the language of the ticket, that
// is the language the customer writes in (emailLanguage below); with "the language of the panel", the panel's language.

import { EMAIL_TYPES } from '../compose/emailRecommend.js';
import { CUSTOMER_ROLES, authorRole, identities } from '../context/identity.js';
import { scriptOf } from '../lib/scriptDetect.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const MAX_TITLE = 120;
const PLACEHOLDER = /\[[^\]\n]{2,80}\]/g;
const TOKEN = /\{(greeting|number|title|agent|state)\}/g;

/** The languages a template is written in. */
export const EMAIL_LANGUAGES = Object.freeze(['en', 'ar']);

// Per language: what stands in a value's place when the ticket (or the panel) does not give it (a placeholder for the agent), the
// greeting with and without a first name, and the word in front of the subject when the email is copied as one text.
const WORDING = Object.freeze({
  en: {
    fallback: { number: '[ticket number]', title: '[short description]', agent: '[your name]', state: '[state]' },
    hello: (name) => (name ? `Hello ${name},` : 'Hello,'),
    subject: 'Subject',
  },
  ar: {
    fallback: { number: '[رقم التذكرة]', title: '[الوصف المختصر]', agent: '[اسمك]', state: '[الحالة]' },
    hello: (name) => (name ? `مرحبا ${name}،` : 'مرحبا،'),
    subject: 'الموضوع',
  },
});

// {first_name} {number} {title} {agent} {state}: filled from the ticket. [Brackets]: left for the agent.
export const EMAIL_TEMPLATES = Object.freeze({
  'ask-info': {
    subject: '{number}: we need a little more information',
    body: [
      '{greeting}',
      '',
      'Thank you for contacting us about "{title}" ({number}).',
      '',
      'To move this forward, could you please send us:',
      '- [what you need, for example the exact error message or a screenshot]',
      '- [when it started, and whether anyone else is affected]',
      '',
      'As soon as we have this, we will continue.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  'status-update': {
    subject: 'Update on {number}: {title}',
    body: [
      '{greeting}',
      '',
      'A short update on your ticket {number} ("{title}").',
      '',
      'Where it stands: [what has been done so far].',
      'Next step: [what happens next, and when you expect it].',
      '',
      'We will update you again by [date].',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  resolution: {
    subject: '{number} is resolved: {title}',
    body: [
      '{greeting}',
      '',
      'Good news: your ticket {number} ("{title}") has been resolved.',
      '',
      'What we did: [the fix, in one or two plain sentences].',
      '',
      'Could you please check that everything works for you and let us know? If we do not hear back, the ticket will close automatically after [number] days.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  'approval-nudge': {
    subject: 'Approval waiting for {number}: {title}',
    body: [
      'Hello [approver name],',
      '',
      'The request {number} ("{title}") is waiting for your approval.',
      '',
      'You can approve or reject it in [where to approve]. The person is waiting for it to go ahead.',
      '',
      'Thank you,',
      '{agent}',
    ],
  },
  apology: {
    subject: 'Sorry for the wait on {number}',
    body: [
      '{greeting}',
      '',
      'I am sorry that your ticket {number} ("{title}") is taking longer than it should.',
      '',
      'What we are doing: [the current step].',
      'When to expect news: [date or time].',
      '',
      'Thank you for your patience.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
  closure: {
    subject: '{number} is closed: {title}',
    body: [
      '{greeting}',
      '',
      'Your ticket {number} ("{title}") is now closed.',
      '',
      'If the problem comes back, reply to this message or open a new ticket and mention {number}.',
      '',
      'Kind regards,',
      '{agent}',
    ],
  },
});

// The same emails in Modern Standard Arabic: the same kinds, the same {values} and as many [brackets] as the English, so the agent
// has the same parts to fill whatever the language. No diacritics; record numbers and names stay as they are written.
export const EMAIL_TEMPLATES_AR = Object.freeze({
  'ask-info': {
    subject: '{number}: نحتاج إلى بعض المعلومات الإضافية',
    body: [
      '{greeting}',
      '',
      'شكرا لتواصلك معنا بخصوص «{title}» ({number}).',
      '',
      'حتى نتمكن من المتابعة، نرجو أن ترسل إلينا:',
      '- [ما تحتاجه، مثل نص رسالة الخطأ كما يظهر أو لقطة شاشة]',
      '- [متى بدأت المشكلة، وهل يواجهها أحد غيرك]',
      '',
      'سنواصل العمل على طلبك فور وصول هذه المعلومات.',
      '',
      'مع أطيب التحيات،',
      '{agent}',
    ],
  },
  'status-update': {
    subject: 'مستجدات {number}: {title}',
    body: [
      '{greeting}',
      '',
      'نود إطلاعك على آخر مستجدات تذكرتك {number} («{title}»).',
      '',
      'ما قمنا به حتى الآن: [ما تم إنجازه حتى الآن].',
      'الخطوة التالية: [ما سيحدث بعد ذلك، ومتى تتوقعه].',
      '',
      'سنوافيك بالمستجدات مرة أخرى بحلول [التاريخ].',
      '',
      'مع أطيب التحيات،',
      '{agent}',
    ],
  },
  resolution: {
    subject: 'تم حل {number}: {title}',
    body: [
      '{greeting}',
      '',
      'يسعدنا إبلاغك بأنه تم حل تذكرتك {number} («{title}»).',
      '',
      'ما قمنا به: [الحل، في جملة أو جملتين واضحتين].',
      '',
      'نرجو أن تتأكد من أن كل شيء يعمل لديك كما ينبغي وأن تبلغنا بذلك. إذا لم يصلنا رد منك، فستغلق التذكرة تلقائيا بعد [عدد] أيام.',
      '',
      'مع أطيب التحيات،',
      '{agent}',
    ],
  },
  'approval-nudge': {
    subject: 'موافقة مطلوبة على {number}: {title}',
    body: [
      'مرحبا [اسم المعتمد]،',
      '',
      'الطلب {number} («{title}») بانتظار موافقتك.',
      '',
      'يمكنك الموافقة عليه أو رفضه من [مكان الموافقة]. صاحب الطلب ينتظر موافقتك للمضي قدما.',
      '',
      'شكرا لك،',
      '{agent}',
    ],
  },
  apology: {
    subject: 'نعتذر عن التأخير في {number}',
    body: [
      '{greeting}',
      '',
      'أعتذر لأن تذكرتك {number} («{title}») تستغرق وقتا أطول مما ينبغي.',
      '',
      'ما نعمل عليه الآن: [الخطوة الحالية].',
      'متى تصلك المستجدات: [التاريخ أو الوقت].',
      '',
      'شكرا لصبرك وتفهمك.',
      '',
      'مع أطيب التحيات،',
      '{agent}',
    ],
  },
  closure: {
    subject: 'تم إغلاق {number}: {title}',
    body: [
      '{greeting}',
      '',
      'تم إغلاق تذكرتك {number} («{title}»).',
      '',
      'إذا عادت المشكلة، يمكنك الرد على هذه الرسالة أو فتح تذكرة جديدة مع ذكر الرقم {number}.',
      '',
      'مع أطيب التحيات،',
      '{agent}',
    ],
  },
});

const TEMPLATES = Object.freeze({ en: EMAIL_TEMPLATES, ar: EMAIL_TEMPLATES_AR });

// What the customer wrote, newest first: their newest customer-visible comment (only when the customer can be told apart from
// support: otherwise it may be the agent's own reply), then the short description and description.
function customerTexts(pack) {
  const ids = identities(pack);
  const journal = Array.isArray(pack?.journal) ? pack.journal : [];
  const theirs = ids.known ? journal.filter((e) => e?.type === 'comment' && text(e.text) && authorRole(e.by, ids) === 'customer') : [];
  const f = pack?.fields || {};
  return [theirs.length ? text(theirs[theirs.length - 1].text) : '', `${text(f.short_description)}\n${text(f.description)}`];
}

/**
 * The language of a customer email, chosen the way AI answers choose theirs (Settings > Language of AI answers):
 *  - answerLanguage 'panel' (the language of the panel): the panel's language, when a template is written in it;
 *  - otherwise ('ticket', the default): the language the customer writes in, from their newest comment, else the short description
 *    and description: Arabic when it is written in Arabic, or in Arabic mixed with Latin words (product names, codes: scriptOf says
 *    'mixed' only when a large part of the letters are Arabic); English for Latin text, any other script, or no text.
 * @param {object} pack ContextPack
 * @param {{ answerLanguage?: string, panelLanguage?: string }} [options] settings.answerLanguage, and the panel's language ('en' | 'ar')
 * @returns {'en' | 'ar'}
 */
export function emailLanguage(pack, { answerLanguage = 'ticket', panelLanguage = '' } = {}) {
  if (answerLanguage === 'panel' && EMAIL_LANGUAGES.includes(panelLanguage)) return panelLanguage;
  for (const sample of customerTexts(pack)) {
    const script = scriptOf(sample);
    if (script === 'arabic' || script === 'mixed') return 'ar';
    if (script === 'latin') return 'en';
  }
  return 'en';
}

/**
 * The person the email is for: the caller (or requester, contact, consumer, the employee of an HR case) on the pack, in the order of
 * CUSTOMER_ROLES, as { firstName, name }; null when nobody is named.
 */
export function recipientOf(pack) {
  const people = Array.isArray(pack?.people) ? pack.people : [];
  for (const role of CUSTOMER_ROLES) {
    const p = people.find((x) => x?.role === role && text(x.name));
    if (p) return { firstName: text(p.firstName) || text(p.name).split(/\s+/)[0], name: text(p.name) };
  }
  return null;
}

/**
 * A filled template.
 * @param {string} typeId one of EMAIL_TYPES' ids
 * @param {{ pack: object, agentName?: string, number?: string, language?: 'en' | 'ar' }} input
 *   language: the language to write in (emailLanguage); when it is missing or not one of EMAIL_LANGUAGES, the ticket's language
 * @returns {{ subject: string, body: string, placeholders: number, language: 'en' | 'ar' } | null} null for an unknown kind
 */
export function fillEmailTemplate(typeId, { pack, agentName = '', number = '', language = '' } = {}) {
  const lang = EMAIL_LANGUAGES.includes(language) ? language : emailLanguage(pack);
  const template = TEMPLATES[lang][typeId];
  if (!template || !EMAIL_TYPES.some((t) => t.id === typeId)) return null;
  const { fallback, hello } = WORDING[lang];
  const who = recipientOf(pack);
  let title = text(pack?.fields?.short_description).replace(/\s+/g, ' ');
  if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1).trimEnd()}…`;
  const given = {
    greeting: hello(who?.firstName || ''),
    number: text(pack?.fields?.number) || text(pack?.number) || text(number),
    title,
    agent: text(agentName),
    state: text(pack?.fields?.state),
  };
  // One pass over the template: a value that itself contains "{...}" (a title with braces) is never filled in again.
  const fill = (line) => line.replace(TOKEN, (_, k) => given[k] || fallback[k]);
  const subject = fill(template.subject);
  const body = template.body.map(fill).join('\n');
  // What is left for the agent: the template's own [brackets] and the ones that stand for a value the ticket did not give. Brackets
  // in the ticket's own text ("[URGENT] VPN down") are not something to fill in.
  const open = (line) => line.replace(TOKEN, (_, k) => (given[k] ? '' : fallback[k]));
  const placeholders = (`${open(template.subject)}\n${template.body.map(open).join('\n')}`.match(PLACEHOLDER) || []).length;
  return { subject, body, placeholders, language: lang };
}

/** Subject and body as one text for the clipboard ("Subject:" in the email's own language). */
export const emailAsText = (filled) => (filled ? `${(WORDING[filled.language] || WORDING.en).subject}: ${filled.subject}\n\n${filled.body}` : '');
