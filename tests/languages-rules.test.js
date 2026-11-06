import test from 'node:test';
import assert from 'node:assert/strict';
import { ARABIC_WORDS, analyseText, computeSignals } from '../src/itsm/sentiment.js';
import { riskSignals } from '../src/insights/risk.js';
import { ARABIC_RULES, missingDetails } from '../src/insights/missing.js';
import { buildChecklist, looksLikeStep, splitInstructions, stepId } from '../src/checks/checklist.js';
import { normalizeArabic } from '../src/lib/scriptDetect.js';
import { setLanguage } from '../src/i18n/index.js';

// Round 4, Phase 0 (docs/round4.md): the no-AI rules read Arabic. The risk words (anger, urgency, escalation, "again"), the missing
// details (who else is affected, the error text, the steps, a vague title) and the checklist's action words each have an Arabic list
// next to the English one; the labels and the texts shown stay ours.

const H = 3600000;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const AHMED = { role: 'caller', name: 'أحمد العتيبي', firstName: 'أحمد', email: 'ahmed@example.com' };
const BETH = { role: 'assigned_to', name: 'Beth Anglin', email: 'beth@example.com' };
const comment = (hoursAgo, by, text) => ({ when: at(NOW - hoursAgo * H), by, type: 'comment', text });
const pack = (extra = {}) => ({
  table: 'incident',
  sysId: 'c'.repeat(32),
  number: 'INC0020001',
  kind: 'incident',
  fields: { number: 'INC0020001', short_description: 'البريد لا يعمل على الهاتف', state: 'In Progress', priority: '2 - High', ...(extra.fields || {}) },
  people: extra.people || [AHMED, BETH],
  journal: extra.journal || [],
  related: {},
  access: extra.access || [{ source: 'journal', status: 'ok' }],
});

// ---- the word lists ---------------------------------------------------------------------------------------------------------

// One Arabic sample per label: each must be reported under that label, which also proves the label is one of the English lists'
// own (a label the English list does not have would never be reported).
const SAMPLES = {
  frustration: {
    frustrated: 'أنا محبطة من هذا الوضع', annoyed: 'هذا مزعج جدا', ridiculous: 'هذا سخيف', unacceptable: 'التأخير غير مقبول', terrible: 'الخدمة سيئة جدا',
    useless: 'النظام عديم الفائدة', 'fed up': 'لقد سئمت من الانتظار', angry: 'أنا غاضب', disappointed: 'أشعر بخيبة أمل', worst: 'هذه أسوأ تجربة',
    'waste of time': 'هذا مضيعة للوقت', shocking: 'رد صادم', 'poor service': 'خدمة سيئة', nonsense: 'هذا هراء',
  },
  escalation: {
    escalate: 'سأطلب تصعيد الموضوع', 'manager or executive': 'سأتحدث مع مديري', complaint: 'سأقدم شكوى رسمية', legal: 'سأتواصل مع محامي',
    cancel: 'سنلغي العقد معكم', refund: 'أريد استرداد المبلغ',
  },
  urgency: {
    urgent: 'الطلب عاجل', asap: 'أرجو الحل في أسرع وقت ممكن', immediately: 'نحتاجه فورا', critical: 'الوضع حرج', emergency: 'حالة طارئة',
    deadline: 'لدينا موعد نهائي غدا', 'right now': 'أحتاجه في الحال', 'cannot work': 'لا أستطيع العمل منذ الصباح',
    'production down': 'توقف الإنتاج بالكامل', blocked: 'حسابي محظور',
  },
  repeat: {
    again: 'انقطع الاتصال مرة أخرى', still: 'ما زالت المشكلة موجودة', 'nth time': 'أكتب للمرة الثالثة', 'every time': 'يحدث في كل مرة أفتح البرنامج',
    'once more': 'تكرر ذلك مرارا وتكرارا', 'already told': 'سبق أن أبلغت عن هذا', 'same problem': 'نفس المشكلة التي أبلغت عنها', 'many times': 'حاولت عدة مرات',
  },
};

test('every Arabic list reports its own label for an Arabic sample, and an Arabic list has no label of its own', () => {
  for (const [list, labels] of Object.entries(SAMPLES)) {
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(ARABIC_WORDS[list]).sort(), `${list}: one sample per label`);
    for (const [label, sample] of Object.entries(labels)) assert.ok(analyseText(sample)[list].includes(label), `${list} "${label}": ${sample}`);
  }
});

test('the Arabic words match whatever the spelling: hamza or not, ta marbuta or ha, diacritics, tatweel, a prefix', () => {
  assert.deepEqual(analyseText('غَاضِبٌ جِدًّا').frustration, ['angry']);
  assert.deepEqual(analyseText('غاضبه').frustration, ['angry']);
  assert.deepEqual(analyseText('اسوا خدمه').frustration, ['worst']);
  assert.deepEqual(analyseText('عاجـــل').urgency, ['urgent']);
  assert.deepEqual(analyseText('وبالتصعيد').escalation, ['escalate']);
  assert.deepEqual(analyseText('لا استطيع العمل').urgency, ['cannot work']);
});

test('Arabic words do not fire inside other words or on neutral text', () => {
  const calm = analyseText('شكرا على المساعدة، تم حل المشكلة والخادم الرئيسي يعمل الآن. المديرية أرسلت الملفات.');
  assert.deepEqual(calm.frustration, []);
  assert.deepEqual(calm.escalation, [], '"المديرية" is not "مدير", and "الرئيسي" is "main"');
  assert.deepEqual(calm.urgency, []);
  assert.deepEqual(calm.repeat, []);
  assert.deepEqual(analyseText('الحالات المفتوحة').urgency, [], '"حالات" is not "حالا"');
  assert.deepEqual(analyseText('وصلني خطاب من الإدارة').frustration, []);
});

test('Arabic chasers, thanks and question-mark runs are counted', () => {
  for (const text of ['هل من جديد؟', 'أي تحديث بخصوص طلبي؟', 'ما زلت أنتظر الرد', 'لم يصلني أي رد حتى الآن', 'تذكير بالطلب', 'بانتظار ردكم']) {
    assert.equal(analyseText(text).chase, true, text);
  }
  assert.equal(analyseText('تم التحديث بنجاح').chase, false);
  assert.equal(analyseText('شكراً لكم، أشكركم على المساعدة، جزاك الله خيرا').thanks, 3);
  assert.equal(analyseText('لماذا؟؟؟').exclamationRuns, 1);
  assert.equal(analyseText('هل تم الحل؟؟').exclamationRuns, 0, 'two question marks are a question');
  assert.equal(analyseText('متى!؟').exclamationRuns, 1);
});

test('a mixed message is read by both lists, in the English list\'s order, each label once', () => {
  assert.deepEqual(analyseText('This is unacceptable، أنا غاضب وهذا غير مقبول').frustration, ['unacceptable', 'angry']);
  assert.deepEqual(analyseText('URGENT عاجل').urgency, ['urgent']);
});

test('the Arabic rules stay fast on very long text', () => {
  const long = `${'ب'.repeat(200000)} عاجل ${'مرة '.repeat(50000)}`;
  const started = Date.now();
  analyseText(long);
  missingDetails(pack({ fields: { description: long } }));
  assert.ok(Date.now() - started < 3000, 'linear time');
});

// ---- the signals and the risk card ------------------------------------------------------------------------------------------

test('an angry Arabic customer raises the risk signals, named by our labels and never quoted', () => {
  const angry = pack({
    fields: { priority: '4 - Low' },
    journal: [
      comment(30, 'أحمد العتيبي', 'هذا غير مقبول! أنا غاضب جداً وسأقدم شكوى إلى مديرك.'),
      comment(20, 'Beth Anglin', 'We are looking into it.'),
      comment(5, 'أحمد العتيبي', 'للمرة الثالثة: ما زالت المشكلة موجودة، الأمر عاجل ولا أستطيع العمل. هل من جديد؟'),
    ],
  });
  const s = computeSignals(angry, { now: NOW });
  assert.equal(s.customerKnown, true);
  assert.deepEqual(s.frustrationWords, ['unacceptable', 'angry']);
  assert.deepEqual(s.escalationWords, ['manager or executive', 'complaint']);
  assert.deepEqual(s.urgencyWords, ['urgent', 'cannot work']);
  assert.deepEqual(s.repeatPhrases, ['still', 'nth time']);
  assert.ok(s.chasers >= 1);

  const r = riskSignals({ pack: angry, now: NOW });
  const ids = r.signals.map((x) => x.id);
  for (const want of ['priority-0', 'escalation', 'frustration', 'repeat']) assert.ok(ids.includes(want), `${want} in ${ids}`);
  assert.equal(r.attention, 'danger');
  assert.match(r.signals.find((x) => x.id === 'frustration').why, /"unacceptable", "angry"/);
  assert.ok(!/غاضب|مديرك|شكوى/.test(JSON.stringify(r.signals)), 'the ticket text is never quoted');

  // In Arabic, the same labels are shown in Arabic.
  setLanguage('ar');
  try {
    const ar = riskSignals({ pack: angry, now: NOW });
    assert.ok(!/unacceptable|angry/.test(ar.signals.find((x) => x.id === 'frustration').why), 'labels translated');
  } finally {
    setLanguage('en');
  }
});

test('Arabic words in the title or description alone give the "strong words in the description" line', () => {
  const r = riskSignals({ pack: pack({ fields: { short_description: 'خدمة سيئة وغير مقبولة', priority: '3 - Moderate' } }), now: NOW });
  assert.ok(r.signals.some((x) => x.id === 'opening'), JSON.stringify(r.signals));
  const calm = riskSignals({ pack: pack({ journal: [comment(5, 'أحمد العتيبي', 'شكرا جزيلا على المساعدة'), comment(4, 'Beth Anglin', 'You are welcome')] }), now: NOW });
  assert.deepEqual(calm.signals, []);
});

// ---- missing details ----------------------------------------------------------------------------------------------------------

const ids = (p) => missingDetails(p).items.map((i) => i.id);
const filled = { cmdb_ci: 'Exchange', category: 'Email' };

test('an Arabic ticket that says who is affected, quotes the error and gives steps is not missing those', () => {
  const full = pack({
    fields: {
      ...filled,
      short_description: 'لا يمكن فتح المرفقات في Outlook على أجهزة القسم',
      description: 'عندما أحاول فتح أي مرفق تظهر رسالة الخطأ «الملف تالف ولا يمكن فتحه». زملائي في القسم لديهم نفس المشكلة منذ تحديث أمس.',
    },
  });
  assert.deepEqual(ids(full), []);
});

test('an Arabic ticket without those facts is missing them, as an English one is', () => {
  const thin = pack({ fields: { ...filled, short_description: 'البريد الإلكتروني لا يفتح على الهاتف المحمول منذ أمس', description: 'لا يفتح البريد على هاتفي المحمول منذ صباح أمس ولا أعرف السبب حتى الآن.' } });
  assert.deepEqual(ids(thin), ['impact', 'error', 'steps']);
});

test('each Arabic phrasing counts: who else (all users, 5 employees, only me), the error (code, failed, screenshot), the steps', () => {
  const desc = (description) => ids(pack({ fields: { ...filled, short_description: 'مشكلة في تسجيل الدخول إلى بوابة الموارد البشرية', description } }));
  const base = 'يظهر هذا عند فتح البوابة صباحا ثم تتوقف الصفحة عن التحميل تماما بعد دقيقة.';
  for (const who of ['جميع المستخدمين في الفرع', 'يواجه 5 موظفين نفس الأمر', 'أنا فقط من يواجه ذلك', 'لا أحد غيري', 'الفريق كله', 'زملائي أيضا', '١٢ مستخدم']) {
    assert.ok(!desc(`${base} ${who}`).includes('impact'), who);
  }
  for (const error of ['رمز الخطأ 0x80070005', 'فشل تسجيل الدخول', 'أرفقت لقطة شاشة', 'تظهر رسالة', 'انتهت المهلة', 'الرمز ٤٠٣', 'تم رفض الوصول']) {
    assert.ok(!desc(`${base} ${error}`).includes('error'), error);
  }
  assert.ok(desc(base).includes('error'));
  for (const steps of ['الخطوات: افتح البوابة ثم اضغط دخول', 'عندما أضغط على زر الدخول', 'حاولت مرة أخرى', 'كلما فتحت الصفحة', 'في كل مرة أفتح البوابة']) {
    assert.ok(!ids(pack({ fields: { ...filled, short_description: 'مشكلة في تسجيل الدخول إلى بوابة الموارد', description: `الصفحة لا تعمل جيدا هذا الأسبوع. ${steps}` } })).includes('steps'), steps);
  }
  assert.ok(!ids(pack({ fields: { ...filled, short_description: 'مشكلة في تسجيل الدخول إلى البوابة', description: '١. افتح البوابة\n٢. أدخل اسم المستخدم\n٣. تظهر صفحة بيضاء' } })).includes('steps'));
});

test('a vague Arabic title is vague: "problem", "not working", "X is not working", "a problem with X"', () => {
  for (const title of ['مشكلة', 'مساعدة!', 'الطابعة لا تعمل', 'Outlook لا يعمل', 'مشكلة في البريد', 'عطل في الشبكة', 'عاجل']) {
    assert.ok(ids(pack({ fields: { ...filled, short_description: title } })).includes('title'), title);
  }
  for (const title of ['الطابعة في الطابق الثالث لا تطبع الصفحات الملونة', 'لا يمكن فتح المرفقات في Outlook بعد التحديث']) {
    assert.ok(!ids(pack({ fields: { ...filled, short_description: title } })).includes('title'), title);
  }
});

test('the Arabic rule lists are written as plain Arabic and folded once; nothing in them is folded twice', () => {
  for (const [name, entries] of Object.entries(ARABIC_RULES)) {
    assert.ok(entries.length > 0, name);
    for (const e of entries) assert.ok(normalizeArabic(normalizeArabic(e)) === normalizeArabic(e), `${name}: ${e}`);
  }
});

// ---- checklist ----------------------------------------------------------------------------------------------------------------

test('Arabic lists in Arabic-Indic digits, "الخطوة 1:", "١-" and "أ)" become steps', () => {
  assert.deepEqual(splitInstructions('١. أنشئ حساب المستخدم في Active Directory\n٢) أضفه إلى مجموعة VPN\n٣- أرسل بريد الترحيب'), [
    'أنشئ حساب المستخدم في Active Directory',
    'أضفه إلى مجموعة VPN',
    'أرسل بريد الترحيب',
  ]);
  assert.deepEqual(splitInstructions('الخطوة 1: جهز الجهاز\nخطوة ٢: سلم الجهاز للموظف'), ['جهز الجهاز', 'سلم الجهاز للموظف']);
  assert.deepEqual(splitInstructions('أ) الجهاز مشفر\nب) الحقيبة مع الجهاز'), ['الجهاز مشفر', 'الحقيبة مع الجهاز'], 'a marked item is a step even without a verb');
  assert.deepEqual(splitInstructions('1- Create the account'), [], 'in English "1-" stays prose, as before');
});

test('Arabic prose: imperatives and verbal nouns are steps, "please" and "do" are left out, then / after that / finally split', () => {
  assert.deepEqual(
    splitInstructions('يرجى إنشاء الحساب ثم إضافة المستخدم إلى المجموعة، وبعد ذلك قم بإرسال البريد. الموظف الجديد يبدأ يوم الأحد. أخيراً سلّم الجهاز.'),
    ['إنشاء الحساب', 'إضافة المستخدم إلى المجموعة', 'إرسال البريد', 'سلّم الجهاز']
  );
  assert.deepEqual(splitInstructions('جهاز محمول جديد للموظف يوم الجمعة.\nالرجاء القيام بما يلي:\nتحقق من الهوية؛ ثبت البرامج القياسية'), ['تحقق من الهوية', 'ثبت البرامج القياسية']);
  assert.deepEqual(splitInstructions('إذا كان القرص ممتلئا، احذف الملفات المؤقتة ثم أعد التشغيل'), ['إذا كان القرص ممتلئا، احذف الملفات المؤقتة ثم أعد التشغيل'], 'a condition is kept whole');
  assert.deepEqual(splitInstructions('حدث خطأ أثناء التثبيت. عطل في الطابعة.'), [], '"happened" and "a fault" are not instructions');
});

test('looksLikeStep reads Arabic: a verb first, or after "please", "you must", "and"; a context sentence is not a step', () => {
  for (const s of ['أنشئ الحساب', 'يرجى التحقق من الهوية', 'يجب إرسال التقرير', 'وأرسل البريد', 'قم بإنشاء الحساب', 'أرسله إلى المدير', 'أَنْشِئ الحساب', 'التحقق من الهوية']) {
    assert.ok(looksLikeStep(s), s);
  }
  for (const s of ['الموظف الجديد يبدأ يوم الأحد', 'جهاز محمول جديد', 'حدث خطأ']) assert.ok(!looksLikeStep(s), s);
});

test('an Arabic step keeps its id when it is written with or without short vowels, and a repeat in a later text is dropped', () => {
  assert.equal(stepId('أنشئ الحساب'), stepId('أَنْشِئ الحساب.'));
  const list = buildChecklist([{ label: 'a', text: '١. أنشئ الحساب\n٢. أرسل البريد' }, { label: 'b', text: 'أنشئ الحساب' }]);
  assert.deepEqual(list.map((s) => s.text), ['أنشئ الحساب', 'أرسل البريد']);
});
