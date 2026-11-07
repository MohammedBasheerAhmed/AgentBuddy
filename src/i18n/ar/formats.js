// Arabic texts: how AI answers are written (TRACKER R11): the editor in Settings and under an action in the panel
// (src/formats/FormatEditor.jsx, src/options/FormatsSection.jsx). See src/i18n/ar/index.js.
export const AR_FORMATS = {
  'How AI answers are written': 'كيف تُكتب إجابات الذكاء الاصطناعي',
  'Choose the sections, the style and the length of a summary, or add a few sentences of your own to any action. You can read exactly what is sent, and the rules about facts, privacy and customers always stay on.':
    'اختر أقسام الملخص وأسلوبه وطوله، أو أضف بضع جمل من عندك إلى أي إجراء. يمكنك قراءة ما يُرسل بالضبط، وتبقى القواعد الخاصة بالوقائع والخصوصية والعملاء مفعّلة دائمًا.',
  'Summaries and notes you can lay out': 'ملخصات وملاحظات يمكنك ترتيب أقسامها',
  'Other AI actions: extra instructions': 'إجراءات الذكاء الاصطناعي الأخرى: تعليمات إضافية',
  'Set by your organisation': 'حددته مؤسستك',
  "Your organisation's format": 'تنسيق مؤسستك',
  'Your format': 'تنسيقك',
  'Your choice: the standard format': 'اختيارك: التنسيق القياسي',
  'Change format': 'غيّر التنسيق',
  'See format': 'اعرض التنسيق',

  'Set by your organisation. You can read this format, but not change it.': 'حددته مؤسستك. يمكنك قراءة هذا التنسيق لكن لا يمكنك تغييره.',
  "This is your organisation's format. Save your own to use it instead.": 'هذا تنسيق مؤسستك. احفظ تنسيقك الخاص لاستخدامه بدلًا منه.',
  "You chose the standard format over your organisation's.": 'اخترت التنسيق القياسي بدلًا من تنسيق مؤسستك.',
  'The panel reads this answer back, so its headings stay as they are. Extra instructions can still change the tone and the length.':
    'تقرأ اللوحة هذه الإجابة لاحقًا، لذا تبقى عناوينها كما هي. ما زال بإمكان التعليمات الإضافية تغيير النبرة والطول.',
  "The customer reads this text. Agent Buddy's rules about internal notes, names and gaps to fill in stay on, whatever you add.":
    'يقرأ العميل هذا النص. تبقى قواعد Agent Buddy الخاصة بالملاحظات الداخلية والأسماء والفراغات المطلوب ملؤها مفعّلة مهما أضفت.',

  'Start from a layout': 'ابدأ من تخطيط جاهز',
  'Choose a layout…': 'اختر تخطيطًا…',
  'The standard layout': 'التخطيط القياسي',
  'Issue, key actions, outcome': 'المشكلة، الإجراءات الرئيسية، النتيجة',
  'Situation, background, assessment, recommendation': 'الوضع، الخلفية، التقييم، التوصية',
  'Issue, key actions, open items, do first': 'المشكلة، الإجراءات الرئيسية، البنود المفتوحة، ما يُنفَّذ أولًا',
  'Decisions, open questions, next': 'القرارات، الأسئلة المفتوحة، الخطوة التالية',
  'Sections, in the order they are written': 'الأقسام بالترتيب الذي تُكتب به',
  'Section {n}: heading': 'القسم {n}: العنوان',
  'Section {n}: what goes in it (optional)': 'القسم {n}: ما الذي يوضع فيه (اختياري)',
  'Heading, for example Key actions performed': 'العنوان، مثل: الإجراءات الرئيسية المنفّذة',
  'What goes in it (optional)': 'ما الذي يوضع فيه (اختياري)',
  'Move section {n} up': 'انقل القسم {n} إلى الأعلى',
  'Move section {n} down': 'انقل القسم {n} إلى الأسفل',
  'Remove section {n}': 'احذف القسم {n}',
  'Add a section': 'أضف قسمًا',
  'Each section is': 'كل قسم يكون',
  'A line or two of text': 'سطرًا أو سطرين من النص',
  'Short bullet points': 'نقاطًا قصيرة',
  'At most this many words': 'أقصى عدد من الكلمات',
  '{min} to {max}. The standard is {n}.': 'من {min} إلى {max}. القيمة القياسية {n}.',
  'Extra instructions (optional)': 'تعليمات إضافية (اختياري)',
  'Tone, length or wording, for example "Use plain words" or "Put the SLA date last". They never remove a rule: facts only, no guessing, no internal names for a customer.':
    'النبرة أو الطول أو الصياغة، مثل «استخدم كلمات بسيطة» أو «ضع تاريخ اتفاقية مستوى الخدمة في النهاية». لا تُلغي أي قاعدة: الوقائع فقط، وبلا تخمين، وبلا أسماء داخلية للعميل.',
  '{n} of {max} characters': '{n} من {max} حرفًا',
  'Show the instructions this sends': 'اعرض التعليمات التي تُرسل',
  'The instructions this format sends': 'التعليمات التي يرسلها هذا التنسيق',
  'The ticket itself is added after these, masked, and you still see the whole request before it is sent.':
    'تُضاف التذكرة نفسها بعد هذه التعليمات بعد إخفاء البيانات الشخصية، وما زلت ترى الطلب كاملًا قبل إرساله.',

  'Add at least one section, or use the standard format.': 'أضف قسمًا واحدًا على الأقل، أو استخدم التنسيق القياسي.',
  'Two sections have the same name. Each name can be used once.': 'لقسمين الاسم نفسه. يمكن استخدام كل اسم مرة واحدة.',
  'The length must be between {min} and {max} words.': 'يجب أن يكون الطول بين {min} و{max} كلمة.',

  'Save format': 'احفظ التنسيق',
  'Use the standard format': 'استخدم التنسيق القياسي',
  "Use my organisation's format": 'استخدم تنسيق مؤسستي',
  'Copy for your administrator': 'انسخ لمسؤول النظام',
  'Saved. The next answer uses this format.': 'تم الحفظ. ستستخدم الإجابة التالية هذا التنسيق.',
  'Saved. This action uses its standard format again.': 'تم الحفظ. يعود هذا الإجراء إلى تنسيقه القياسي.',
  "Saved. This action uses its standard format, not your organisation's.": 'تم الحفظ. يستخدم هذا الإجراء تنسيقه القياسي لا تنسيق مؤسستك.',
  'This action uses its standard format again.': 'يعود هذا الإجراء إلى تنسيقه القياسي.',
  "Back to your organisation's format.": 'عاد إلى تنسيق مؤسستك.',
  'The browser did not copy that. Select the text under "Show the instructions this sends" instead.':
    'لم ينسخ المتصفح ذلك. حدّد النص تحت «اعرض التعليمات التي تُرسل» بدلًا من ذلك.',
};
