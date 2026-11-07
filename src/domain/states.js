// One meaning of a ticket's state (the open decision of the 2026-11-04 audit, built for the audit of 2026-11-07, F9). Pure: no imports.
//
// Five places used to read a state's display text each their own way (the Ticket screen's stages, the Insights card order, My work,
// the Team reports and the checks), so "Pending", "Open", "Assess", "Authorize" and "Closed Incomplete" were filed differently on
// each screen. This is the one reader. docs/states.md lists every row, why it is that way, and what each screen does with it.
//
//   classifyState({ table, value, label, stage })  one of MEANINGS
//   waitsOn({ ..., holdReason, holdReasonValue })   'customer' | 'approval' | 'other' | '' (the last when the ticket does not wait)
//   isOpenState / isFinishedState / isWaitingState / finishedKind   the yes/no questions the screens ask
//   stageFor / bucketFor / reportClassFor           the meaning in the words each screen already uses
//
// How a meaning is found:
//   1. The STORED value of the state, by table. ServiceNow's own choice values are fixed (an incident's 3 is On Hold whatever the
//      site calls it, in any language), so a renamed or translated state is still understood. A table marked `sure` is believed first.
//   2. The label the person sees, by words in English, German and Arabic. It decides when there is no stored value, when the value is
//      not one this file knows (a state the site added), and, for a table not marked `sure`, when the label is recognised and the
//      value is not (those values are assumed: docs/live-questions/audit-1107-states.md).
//   3. Neither: 'unknown'. Every screen treats unknown as live work ("fail towards look at it"), never as closed or as waiting.
//   (A requested item's STAGE is read after these: "waiting for approval" moves live work to waiting, and where 1 and 2 found nothing the
//   stage decides: fulfillment and delivery are working, complete is closed, request_cancelled is cancelled, any other stage by its words.)

export const MEANINGS = Object.freeze(['new', 'working', 'waiting', 'resolved', 'closed', 'cancelled', 'unknown']);

const text = (v) => String(v ?? '').trim();

// ---- The stored values --------------------------------------------------------------------------------------------------------------
// Every row: [stored value, ServiceNow's own English label (for the docs and the tests), meaning].

const TASK = Object.freeze([
  ['-5', 'Pending', 'waiting'],
  ['1', 'Open', 'working'],
  ['2', 'Work in Progress', 'working'],
  ['3', 'Closed Complete', 'closed'],
  ['4', 'Closed Incomplete', 'cancelled'],
  ['7', 'Closed Skipped', 'cancelled'],
]);

// A change task has its own list (VERIFIED LIVE 2026-11-07, dev364920): -5, 1, 2, 3 and 4, with the words Closed and Canceled. The meanings
// are the task's, so every screen follows. The task's 7 (Closed Skipped) is not on the live list; it stays for a stored value left by an import.
const CHANGE_TASK = Object.freeze([
  ['-5', 'Pending', 'waiting'],
  ['1', 'Open', 'working'],
  ['2', 'In Progress', 'working'],
  ['3', 'Closed', 'closed'],
  ['4', 'Canceled', 'cancelled'],
  ['7', 'Closed Skipped', 'cancelled'],
]);

// A problem task has its own list too (VERIFIED LIVE 2026-11-07, dev364920): 151, 152, 154 and 157. The task values stay after them for
// a site or a release where a problem task still uses the task's own (not seen on the live instance).
const PROBLEM_TASK = Object.freeze([
  ['151', 'New', 'new'],
  ['152', 'Assess', 'working'],
  ['154', 'Work in Progress', 'working'],
  ['157', 'Closed', 'closed'],
  ...TASK,
]);

/**
 * table -> { sure, rows }. `sure`: the values are ServiceNow's base values and are believed before the label. Anything else is an
 * assumption (marked in docs/states.md) and the label wins when it is recognised and the value is not.
 */
export const STATE_TABLES = Object.freeze({
  incident: { sure: true, rows: [['1', 'New', 'new'], ['2', 'In Progress', 'working'], ['3', 'On Hold', 'waiting'], ['6', 'Resolved', 'resolved'], ['7', 'Closed', 'closed'], ['8', 'Canceled', 'cancelled']] },
  problem: { sure: true, rows: [['101', 'New', 'new'], ['102', 'Assess', 'working'], ['103', 'Root Cause Analysis', 'working'], ['104', 'Fix in Progress', 'working'], ['106', 'Resolved', 'resolved'], ['107', 'Closed', 'closed']] },
  change_request: { sure: true, rows: [['-5', 'New', 'new'], ['-4', 'Assess', 'working'], ['-3', 'Authorize', 'waiting'], ['-2', 'Scheduled', 'working'], ['-1', 'Implement', 'working'], ['0', 'Review', 'working'], ['3', 'Closed', 'closed'], ['4', 'Canceled', 'cancelled']] },
  change_task: { sure: true, rows: CHANGE_TASK },
  incident_task: { sure: true, rows: TASK },
  problem_task: { sure: true, rows: PROBLEM_TASK },
  sc_task: { sure: true, rows: TASK },
  // A requested item has the task states, and a stage of its own (see STAGES).
  sc_req_item: { sure: true, rows: TASK },
  // A request: the task states, and its own request state (text values).
  sc_request: {
    sure: false,
    rows: [
      ...TASK,
      ['requested', 'Requested', 'new'],
      ['approved', 'Approved', 'working'],
      ['in_process', 'In Process', 'working'],
      ['closed_complete', 'Closed Complete', 'closed'],
      ['closed_incomplete', 'Closed Incomplete', 'cancelled'],
      ['closed_cancelled', 'Closed Cancelled', 'cancelled'],
      ['closed_rejected', 'Closed Rejected', 'cancelled'],
      ['closed_skipped', 'Closed Skipped', 'cancelled'],
    ],
  },
  sn_customerservice_case: { sure: false, rows: [['1', 'New', 'new'], ['10', 'Open', 'working'], ['18', 'Awaiting Info', 'waiting'], ['6', 'Resolved', 'resolved'], ['3', 'Closed', 'closed'], ['7', 'Cancelled', 'cancelled']] },
  sn_customerservice_task: { sure: false, rows: TASK },
  // (an HR case keeps its other states, New, Draft, Ready, Awaiting Triage..., to the label)
  sn_hr_core_case: { sure: false, rows: [['2', 'Work in Progress', 'working'], ['18', 'Awaiting Info', 'waiting'], ['6', 'Resolved', 'resolved'], ['3', 'Closed Complete', 'closed'], ['4', 'Closed Incomplete', 'cancelled'], ['7', 'Cancelled', 'cancelled']] },
  sn_hr_core_task: { sure: false, rows: TASK },
  // The base table of all of them, or a kind of task: the task states, believed second.
  task: { sure: false, rows: TASK },
});

// The kinds of src/context/kinds.js, so a screen that knows the kind of the ticket and not its table can still ask.
const KIND_TABLE = Object.freeze({
  change: 'change_request',
  request: 'sc_request',
  requested_item: 'sc_req_item',
  catalog_task: 'sc_task',
  case: 'sn_customerservice_case',
  hr_case: 'sn_hr_core_case',
});

// Families of tables (the child tables of an HR case, a case task of another product area): they have the states of their family.
const FAMILIES = [
  [/^sn_hr_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, 'sn_hr_core_task'],
  [/^sn_hr_(?:[a-z0-9]+_)*case(?:_[a-z0-9]+)*$/, 'sn_hr_core_case'],
  [/^sn_customerservice_(?:[a-z0-9]+_)*task(?:_[a-z0-9]+)*$/, 'sn_customerservice_task'],
];

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The key of the table whose values apply, or ''. A table we know nothing about (a custom class) has none. */
function tableKey(table) {
  const name = text(table).toLowerCase();
  if (!name) return '';
  if (has(STATE_TABLES, name)) return name;
  if (has(KIND_TABLE, name)) return KIND_TABLE[name];
  const family = FAMILIES.find(([re]) => re.test(name));
  return family ? family[1] : '';
}

/** A stored value as a key: '03' and '3' and ' 3 ' are the same; text values are lower case. */
function valueKey(value) {
  const v = text(value).toLowerCase();
  if (/^[+-]?\d+$/.test(v)) return String(Number(v));
  return v;
}

const VALUES = new Map(); // table -> Map(value -> meaning)
for (const [table, { rows }] of Object.entries(STATE_TABLES)) VALUES.set(table, new Map(rows.map(([value, , meaning]) => [value, meaning])));

// The stage of a requested item (sc_req_item.stage) says what its state does not: a request that still waits for its approval has
// the state Open on many sites. "Waiting for approval" moves live or unknown work to waiting. The other stages are read only where the
// state says nothing (no stored value this file knows, no label it understands): then the stage decides. VERIFIED LIVE 2026-11-07
// (dev364920): the stages are waiting_for_approval, fulfillment and delivery, then complete or request_cancelled at the end (the
// closed_* spellings are the request state's, and are read the same). A stage that is none of these falls back to the words of its label.
const STAGE_WAITING_APPROVAL = /^(waiting[ _]for[ _]approval|awaiting[ _]approval)$/;
// (the keys are a stage as norm() writes it: lower case, underscores and hyphens made spaces)
const STAGE_MEANINGS = Object.freeze({
  __proto__: null,
  delivery: 'working',
  fulfillment: 'working',
  complete: 'closed',
  'closed complete': 'closed',
  'request cancelled': 'cancelled',
  'closed cancelled': 'cancelled',
});

// ---- The words of a label -----------------------------------------------------------------------------------------------------------

// Arabic is compared without the marks and the spelling variants that do not change the word.
const arabic = (s) => s.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

function norm(label) {
  const s = text(label)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*-?\d+\s+-\s+/, '') // "7 - Closed" (a choice list that shows its value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return arabic(s);
}

// A word of Latin letters (English, German) is a whole word; \p{L} knows the umlauts.
const latin = (list) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'u');
// An Arabic word is found inside the text (the article, "and" and "by" are written onto it).
const arabicHas = (entries) => {
  const list = entries.map(arabic);
  return (s) => list.some((w) => s.includes(w));
};

function wordsOf(en, de, ar) {
  const l = latin([...en, ...de]);
  const a = arabicHas(ar);
  return (s) => l.test(s) || a(s);
}

// Checked in this order: "Closed Incomplete" is cancelled, not closed; "Pending Closure" is resolved, not waiting.
const LABEL_RULES = [
  [
    'cancelled',
    wordsOf(
      ['cancel+ed', 'cancel', 'cancellation', 'skipped', 'incomplete', 'rejected', 'withdrawn', 'abandoned', 'declined', 'retired', 'obsolete'],
      ['storniert', 'abgebrochen', 'abgelehnt', 'übersprungen', 'uebersprungen', 'unvollständig', 'unvollstaendig', 'zurückgezogen', 'zurueckgezogen', 'abgesagt', 'verworfen'],
      ['ملغي', 'ملغاة', 'ملغى', 'الغاء', 'مرفوض', 'غير مكتمل', 'تم التخطي', 'متخطى', 'مسحوب', 'مستبعد']
    ),
  ],
  [
    // A label that STARTS with "closed" is closed even when it goes on to say how ("Closed - Resolved by caller"): checked before 'resolved'.
    'closed',
    (s) => /^(closed|geschlossen|abgeschlossen)\b/.test(s) || s.startsWith('مغلق'),
  ],
  [
    'resolved',
    wordsOf(
      ['resolved', 'solved', 'fixed', 'resolution proposed', 'solution proposed', 'awaiting closure', 'pending closure', 'ready to close'],
      ['gelöst', 'geloest', 'behoben', 'lösung vorgeschlagen', 'loesung vorgeschlagen'],
      ['تم الحل', 'تم حل', 'محلول', 'حل مقترح', 'تمت المعالجة', 'تم الإصلاح']
    ),
  ],
  [
    'closed',
    wordsOf(
      ['closed', 'complete', 'completed', 'fulfilled', 'delivered', 'done', 'finished'],
      ['geschlossen', 'abgeschlossen', 'erledigt', 'fertig', 'beendet', 'geliefert'],
      ['مغلق', 'مغلقة', 'مكتمل', 'اكتمل', 'اكتمال', 'منجز', 'تم التسليم', 'تم الإغلاق', 'تم الاكمال']
    ),
  ],
  [
    'waiting',
    wordsOf(
      ['on hold', 'onhold', 'hold', 'pending', 'awaiting', 'waiting', 'suspended', 'deferred', 'paused', 'parked', 'blocked', 'authori[sz]e', 'authori[sz]ation'],
      ['wartend', 'wartet', 'warten', 'wartestellung', 'warteschleife', 'angehalten', 'ausstehend', 'zurückgestellt', 'zurueckgestellt', 'pausiert', 'genehmigung', 'freigabe'],
      ['قيد الانتظار', 'في الانتظار', 'بانتظار', 'منتظر', 'ينتظر', 'معلق', 'موقوف', 'مؤجل', 'ايقاف مؤقت', 'مجمد', 'قيد الايقاف']
    ),
  ],
  [
    'new',
    wordsOf(['new', 'draft', 'not started', 'not yet started', 'unassigned', 'submitted', 'requested', 'ready', 'created'], ['neu', 'entwurf', 'nicht begonnen', 'angefordert', 'bereit'], ['جديد', 'جديدة', 'مسودة', 'لم يبدأ', 'غير مبدوء', 'تم الطلب']),
  ],
  [
    'working',
    wordsOf(
      ['in progress', 'progress', 'wip', 'open', 'active', 'working', 'assess', 'assessing', 'assessment', 'investigating', 'investigation', 'implement', 'implementing', 'implementation', 'root cause', 'root cause analysis', 'fix in progress', 'scheduled', 'assigned', 'accepted', 'approved', 'authori[sz]ed', 'processing', 'in process', 'review', 'reviewing', 'escalated', 'analysis', 'development', 'testing', 'started'],
      ['in bearbeitung', 'bearbeitung', 'in arbeit', 'offen', 'aktiv', 'laufend', 'in prüfung', 'geplant', 'genehmigt', 'zugewiesen', 'implementierung', 'analyse', 'untersuchung', 'in ausführung'],
      ['قيد التقدم', 'قيد التنفيذ', 'قيد المعالجة', 'قيد العمل', 'قيد الاجراء', 'جاري', 'مفتوح', 'مفتوحة', 'نشط', 'نشطة', 'قيد المراجعة', 'مجدول', 'تمت الموافقة']
    ),
  ],
];

/** The meaning the words of a label give, or '' when the label says nothing we know. */
function byLabel(label) {
  const s = norm(label);
  if (!s) return '';
  for (const [meaning, test] of LABEL_RULES) if (test(s)) return meaning;
  return '';
}

// ---- classifyState ------------------------------------------------------------------------------------------------------------------

/**
 * What a ticket's state means.
 * @param {{ table?: string, value?: string|number, label?: string, stage?: string }} [args] `table`: the ticket's own table, or its kind;
 *   `value`: the STORED value of the state ('3'); `label`: what the person sees ('On Hold', 'Wartend', 'قيد الانتظار'); `stage`: the stage
 *   of a requested item (stored or shown), which can say it waits for its approval.
 * @returns {'new'|'working'|'waiting'|'resolved'|'closed'|'cancelled'|'unknown'}
 */
export function classifyState({ table = '', value = '', label = '', stage = '' } = {}) {
  const key = tableKey(table);
  const entry = key ? STATE_TABLES[key] : null;
  const v = valueKey(value);
  const stored = entry && v !== '' && VALUES.get(key).has(v) ? VALUES.get(key).get(v) : '';
  const fromLabel = byLabel(label);
  let meaning;
  if (stored && (entry.sure || !fromLabel)) meaning = stored;
  else meaning = fromLabel || stored || 'unknown';
  // A requested item waiting for its approval is waiting, whatever its state says; a finished one is finished.
  if (key === 'sc_req_item' || key === 'sc_request') {
    if ((meaning === 'working' || meaning === 'new' || meaning === 'unknown') && STAGE_WAITING_APPROVAL.test(norm(stage))) meaning = 'waiting';
    // The state said nothing: the stage does (its own words first, then the words of any other stage).
    else if (meaning === 'unknown') meaning = STAGE_MEANINGS[norm(stage)] || byLabel(stage) || 'unknown';
  }
  return meaning;
}

const FINISHED = new Set(['resolved', 'closed', 'cancelled']);

/** Is the ticket finished (resolved, closed or cancelled)? An unknown state is not: it fails towards "look at it". */
export const isFinishedState = (args) => FINISHED.has(classifyState(args));

/** Is the ticket still live work: not finished? (A new, working, waiting or unknown state.) */
export const isOpenState = (args) => !isFinishedState(args);

/** Is the ticket on hold, pending or awaiting something? */
export const isWaitingState = (args) => classifyState(args) === 'waiting';

/**
 * 'done' (resolved or closed after the work was done), 'ended' (closed without being done: cancelled, skipped, incomplete, rejected)
 * or '' (not finished, or not a state we know).
 */
export function finishedKind(args) {
  const meaning = classifyState(args);
  if (meaning === 'resolved' || meaning === 'closed') return 'done';
  return meaning === 'cancelled' ? 'ended' : '';
}

// ---- Who a waiting ticket waits for -------------------------------------------------------------------------------------------------

// The words that say the wait is for the person who raised it (a hold reason, or the state itself: "Awaiting Caller", "Pending customer
// response", "Awaiting user info", "Awaiting acceptance"). Found inside the text, as the hold reasons have always been read.
const CUSTOMER_EN = /(caller|customer|user|requester|requestor|requested for|employee|info|information|response|reply|feedback|acceptance|contact|confirmation)/;
const CUSTOMER_DE = /(anrufer|kunde|kunden|benutzer|nutzer|antragsteller|mitarbeiter|rückmeldung|rueckmeldung|rückfrage|rueckfrage|auskunft|informationen|antwort|bestätigung|bestaetigung|annahme)/;
const CUSTOMER_AR = arabicHas(['المتصل', 'العميل', 'المستخدم', 'مقدم الطلب', 'الموظف', 'معلومات', 'الرد', 'القبول', 'تأكيد', 'جهة الاتصال']);
const customerWords = (s) => CUSTOMER_EN.test(s) || CUSTOMER_DE.test(s) || CUSTOMER_AR(s);
const APPROVAL_WORDS = (s) => /(approv|authori[sz])/.test(s) || /(genehmig|freigabe)/.test(s) || arabicHas(['الموافقة', 'اعتماد'])(s);

// Hold reasons and states that are the customer's by their stored value.
const CUSTOMER_HOLD_REASONS = { incident: ['1'] };
const CUSTOMER_STATE_VALUES = { sn_customerservice_case: ['18'], sn_hr_core_case: ['18'] };
const APPROVAL_STATE_VALUES = { change_request: ['-3'] };

/**
 * Who a waiting ticket waits for: 'customer' (the caller, requester or contact: more information, an answer, an acceptance),
 * 'approval' (a decision someone has to make) or 'other' (a vendor, a change, a problem, an earlier task, nothing said); '' when the
 * ticket does not wait. The STATE decides whether it waits; the hold reason only says for whom (a hold reason left filled in after the
 * ticket went back to work is stale and never hides live work).
 * @param {{ table?: string, value?: string|number, label?: string, stage?: string, holdReason?: string, holdReasonValue?: string|number }} [args]
 */
export function waitsOn(args = {}) {
  if (classifyState(args) !== 'waiting') return '';
  const key = tableKey(args.table);
  const v = valueKey(args.value);
  const reasonText = norm(args.holdReason);
  const reason = /^(none|-- none --|بلا|لا شيء|keine|-- keine --)$/.test(reasonText) ? '' : reasonText;
  if ((CUSTOMER_HOLD_REASONS[key] || []).includes(valueKey(args.holdReasonValue))) return 'customer';
  if ((CUSTOMER_STATE_VALUES[key] || []).includes(v)) return 'customer';
  const label = norm(args.label);
  const stage = norm(args.stage);
  if (reason) {
    if (customerWords(reason)) return 'customer';
    return APPROVAL_WORDS(reason) ? 'approval' : 'other';
  }
  if (STAGE_WAITING_APPROVAL.test(stage) || (APPROVAL_STATE_VALUES[key] || []).includes(v)) return 'approval';
  if (APPROVAL_WORDS(label)) return 'approval';
  return customerWords(label) ? 'customer' : 'other';
}

// ---- The meaning in the words each screen already uses ------------------------------------------------------------------------------

/** The Ticket screen's stage: 'new' | 'working' | 'resolve' | 'closed', or null when the state is not known (src/features/stages.js). */
export function stageFor(args) {
  switch (classifyState(args)) {
    case 'new':
      return 'new';
    case 'working':
    case 'waiting':
      return 'working';
    case 'resolved':
      return 'resolve';
    case 'closed':
    case 'cancelled':
      return 'closed';
    default:
      return null;
  }
}

/** The Insights card order's bucket: 'new' | 'progress' | 'hold' | 'resolved' | 'closed' ('progress' when unknown: src/insights/order.js). */
export function bucketFor(args) {
  switch (classifyState(args)) {
    case 'new':
      return 'new';
    case 'waiting':
      return 'hold';
    case 'resolved':
      return 'resolved';
    case 'closed':
    case 'cancelled':
      return 'closed';
    default:
      return 'progress';
  }
}

/** The Team reports' class: 'new' | 'working' | 'waiting' | 'resolved' (finished but still active) | 'other' (src/reports/engine/common.js). */
export function reportClassFor(args) {
  switch (classifyState(args)) {
    case 'new':
      return 'new';
    case 'working':
      return 'working';
    case 'waiting':
      return 'waiting';
    case 'resolved':
    case 'closed':
    case 'cancelled':
      return 'resolved';
    default:
      return 'other';
  }
}
