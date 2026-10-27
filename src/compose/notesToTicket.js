// Notes to ticket: reading the AI's proposal and deciding, strictly, what may be put into a blank ticket form.
//
// The AI answers with labelled lines (Short description:, Description:, Impact:, ...). This module reads those lines
// locally. Only five form fields can ever be filled - short_description, description, impact, urgency, contact_type -
// and only with values this file has checked: High/Medium/Low become the choice values 1/2/3, a few contact types become
// their choice values, and anything else is kept for display ("Category hint", "Questions still to ask") or dropped.
// A value the AI made up is never passed on to the form.

/** The only form fields Notes to ticket may fill, in the order they are filled. */
export const FILLABLE_FIELDS = Object.freeze(['short_description', 'description', 'impact', 'urgency', 'contact_type']);

/** How a Workspace control is named (its aria-label), for the page bridge's fallback when there is no g_form. */
export const FIELD_LABELS = Object.freeze({
  short_description: 'Short description',
  description: 'Description',
  impact: 'Impact',
  urgency: 'Urgency',
  contact_type: 'Contact type',
});

// Choice values on the base-system incident form: 1 High, 2 Medium, 3 Low.
export const LEVELS = Object.freeze([
  Object.freeze({ label: 'High', value: '1' }),
  Object.freeze({ label: 'Medium', value: '2' }),
  Object.freeze({ label: 'Low', value: '3' }),
]);

// Choice values of the base-system incident form's Channel (contact_type).
export const CONTACT_TYPES = Object.freeze([
  Object.freeze({ label: 'Phone', value: 'phone' }),
  Object.freeze({ label: 'Self-service', value: 'self-service' }),
  Object.freeze({ label: 'Email', value: 'email' }),
  Object.freeze({ label: 'Walk-in', value: 'walk-in' }),
]);

/** Blank ticket forms the fill is offered on. Impact, urgency and channel exist on incidents; cases name fewer of them. */
const TICKET_KINDS = new Set(['incident', 'case']);
/** The channel choices above belong to the incident form; a case form has its own list, so it is not filled there. */
const CONTACT_TYPE_TABLES = new Set(['incident']);

const MAX_SHORT = 160; // the short_description column
const MAX_DESCRIPTION = 4000;

// ---- Reading the AI's lines ----------------------------------------------------------------------------------------

const LABELS = [
  ['short_description', 'short description'],
  ['description', 'description'],
  ['impact', 'impact'],
  ['urgency', 'urgency'],
  ['category_hint', 'category hint'],
  ['category_hint', 'category'],
  ['contact_type', 'contact type'],
  ['questions', 'questions still to ask'],
  ['questions', 'questions'],
];

// A line that starts a labelled section: optional list/markdown marks, the label, optional marks, a colon, the value.
const LINE = /^[\s#>*_-]*([A-Za-z][A-Za-z ]{2,40}?)[\s*_]*:[\s*_]*(.*)$/;

function labelOf(line) {
  const m = LINE.exec(line);
  if (!m) return null;
  const name = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
  const hit = LABELS.find(([, label]) => label === name);
  return hit ? { key: hit[0], rest: m[2].replace(/[\s*_]+$/, '').trim() } : null;
}

// Labels of other form fields a model may add on its own. They end the section above and are dropped: only the labels in
// LABELS are ever read.
const OTHER_FIELD = /^[\s#>*_-]*(assignment group|assigned to|priority|subcategory|state|status|caller|configuration item|business service|service|location|group|sys[ _]?id|number|resolution|close notes|work notes|comments|additional comments)[\s*_]*:/i;

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const NOT_STATED = /^(not stated|none|n\/a|unknown|-+|not specified|unspecified)\.?$/i;

/** "High", "2 - Medium", "moderate", "1" -> the matching entry of LEVELS, or null. */
export function normalizeLevel(input) {
  const t = oneLine(input).toLowerCase();
  if (!t || NOT_STATED.test(t)) return null;
  const word = /\b(high|medium|moderate|low)\b/.exec(t);
  if (word) return LEVELS.find((l) => l.label.toLowerCase() === (word[1] === 'moderate' ? 'medium' : word[1])) || null;
  const digit = /^([123])\b/.exec(t);
  return digit ? LEVELS.find((l) => l.value === digit[1]) : null;
}

const CONTACT_WORDS = [
  ['phone', /\b(phone|telephone|call(ed)?|calls?|voice|mobile)\b/],
  ['walk-in', /\b(walk[- ]?in|walked in|in person|in-person|face to face|desk visit)\b/],
  ['email', /\b(e-?mail)\b/],
  ['self-service', /\b(self[- ]?service|portal|web form)\b/],
];

/** "Phone", "walk in", "E-mail" -> the matching entry of CONTACT_TYPES, or null (chat, social, anything else). */
export function normalizeContactType(input) {
  const t = oneLine(input).toLowerCase();
  if (!t || NOT_STATED.test(t)) return null;
  const hit = CONTACT_WORDS.find(([, re]) => re.test(t));
  return hit ? CONTACT_TYPES.find((c) => c.value === hit[0]) : null;
}

// "1." / "2)" / "-" / "*" / a bullet dot (written as a code so this file stays plain ASCII)
const LIST_MARK = new RegExp(`^[\\s*_>-]*(?:\\d+[.)]|[-*${String.fromCharCode(0x2022)}])?\\s*`);

/** Numbered or bulleted questions as a clean list (at most 8). */
function questionList(lines) {
  return lines
    .map((l) => l.replace(LIST_MARK, '').replace(/[\s*_]+$/, '').trim())
    .filter((l) => l && !NOT_STATED.test(l))
    .slice(0, 8);
}

/**
 * Reads the AI's answer.
 * @returns {{
 *   shortDescription: string, description: string,
 *   impact: string, urgency: string, contactType: string,   // choice VALUES ('1'..'3', 'phone'...), '' when absent or not recognised
 *   impactText: string, urgencyText: string, contactTypeText: string,   // what the AI wrote, for display
 *   categoryHint: string, questions: string[], found: string[]
 * }}
 */
export function parseTicketProposal(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const sections = new Map(); // key -> lines
  let current = null;
  for (const line of lines) {
    const label = labelOf(line);
    if (label) {
      current = label.key;
      // A label seen twice keeps the first one; later text under it is ignored rather than mixed in.
      if (!sections.has(current)) sections.set(current, label.rest ? [label.rest] : []);
      else current = null;
    } else if (OTHER_FIELD.test(line)) {
      current = null;
    } else if (current) {
      sections.get(current).push(line);
    }
  }
  const block = (key) => (sections.get(key) || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // A one-line field is its first line; anything under it is not part of it.
  const single = (key) => oneLine((sections.get(key) || []).find((l) => l.trim()) || '');

  const rawImpact = single('impact');
  const rawUrgency = single('urgency');
  const rawContact = single('contact_type');
  const clean = (s) => (NOT_STATED.test(s) ? '' : s);
  return {
    shortDescription: clean(single('short_description')).slice(0, MAX_SHORT),
    description: clean(block('description')).slice(0, MAX_DESCRIPTION),
    impact: normalizeLevel(rawImpact)?.label || '',
    urgency: normalizeLevel(rawUrgency)?.label || '',
    contactType: normalizeContactType(rawContact)?.value || '',
    impactText: clean(rawImpact),
    urgencyText: clean(rawUrgency),
    contactTypeText: clean(rawContact),
    categoryHint: clean(single('category_hint')),
    questions: questionList(sections.get('questions') || []),
    found: [...sections.keys()],
  };
}

// ---- Deciding what to fill -----------------------------------------------------------------------------------------

/**
 * What a "Fill the form" press would do, from the (possibly edited) values and the page state.
 * @param {{ shortDescription?: string, description?: string, impact?: string, urgency?: string, contactType?: string }} values
 *   impact/urgency are 'High' | 'Medium' | 'Low' (or ''), contactType is a choice value (or '')
 * @param {{ table: string, kind: string } | null | undefined} newRecord page.newRecord: set only on a blank form
 * @returns {{ canFill: boolean, reason: string, fields: {field: string, value: string, label: string}[] }}
 *   `fields` holds only whitelisted fields with checked values; it is empty whenever canFill is false.
 */
export function planFill(values, newRecord) {
  if (!newRecord || typeof newRecord !== 'object') {
    return { canFill: false, reason: 'Fill is only offered on a blank ticket form (a new incident or case on the classic screen). Open one, or copy the text instead.', fields: [] };
  }
  if (!TICKET_KINDS.has(newRecord.kind)) {
    return { canFill: false, reason: `The blank form that is open (${String(newRecord.table || 'unknown').slice(0, 40)}) is not an incident or case form. Copy the text instead.`, fields: [] };
  }
  const given = values && typeof values === 'object' ? values : {};
  // Own properties only: nothing inherited can become a value.
  const v = {};
  for (const key of ['shortDescription', 'description', 'impact', 'urgency', 'contactType']) {
    if (Object.prototype.hasOwnProperty.call(given, key)) v[key] = given[key];
  }
  const fields = [];
  const add = (field, value) => {
    if (value) fields.push({ field, value, label: FIELD_LABELS[field] });
  };
  add('short_description', oneLine(v.shortDescription).slice(0, MAX_SHORT));
  add('description', String(v.description ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_DESCRIPTION));
  // Impact and urgency are fields of the incident form (the choice values above are its). A case form does not have them, so
  // nothing is offered for it: otherwise every case fill would end with "Not filled: Impact, Urgency".
  if (newRecord.kind !== 'case') {
    add('impact', normalizeLevel(v.impact)?.value || '');
    add('urgency', normalizeLevel(v.urgency)?.value || '');
  }
  // A choice value only counts when it is on the list above, and only on the form those values belong to.
  const channel = CONTACT_TYPES.find((c) => c.value === v.contactType);
  if (channel && CONTACT_TYPE_TABLES.has(newRecord.table)) add('contact_type', channel.value);
  if (!fields.length) return { canFill: false, reason: 'There is nothing to fill yet.', fields: [] };
  // Order is fixed by FILLABLE_FIELDS no matter how the values arrived.
  fields.sort((a, b) => FILLABLE_FIELDS.indexOf(a.field) - FILLABLE_FIELDS.indexOf(b.field));
  return { canFill: true, reason: '', fields };
}
