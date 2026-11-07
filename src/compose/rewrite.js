// Pure helpers for the Write section's two "text in, text out" tools: Rewrite and Notes to ticket.
//
// The text the agent pasted (or read from the form) is the ONLY data these features send. It travels as a feature part, so the
// firewall masks and wraps it like any ticket text; it is never put into a prompt. This file builds the ContextPack-shaped
// object those runs use, the parts, the list of presets and languages, and the "names to hide" list.

import { FORM_FIELD_NAMES, MAX_FORM_TEXT } from './formFields.js';
import { isSensitiveByPolicy, isTableAllowed } from '../policy/policy.js';
import { TABLE_RE } from '../context/util.js';
import { isolate, t, tm } from '../i18n/index.js';
import { tableLabel } from '../lib/tableLabels.js';

export { MAX_FORM_TEXT };

// label (the button) and title (the heading of the result) are shown to the person: marked with tm(), shown with t().
export const REWRITE_PRESETS = Object.freeze([
  Object.freeze({ id: 'short', featureId: 'rewrite-short', label: tm('Shorter'), title: tm('Shorter version') }),
  Object.freeze({ id: 'friendly', featureId: 'rewrite-friendly', label: tm('Friendlier'), title: tm('Friendlier version') }),
  Object.freeze({ id: 'plain', featureId: 'rewrite-plain', label: tm('Plain language'), title: tm('Plain-language version') }),
  Object.freeze({ id: 'formal', featureId: 'rewrite-formal', label: tm('More formal'), title: tm('More formal version') }),
  Object.freeze({ id: 'fix', featureId: 'rewrite-fix', label: tm('Fix spelling and grammar'), title: tm('Corrected version') }),
  Object.freeze({ id: 'translate', featureId: 'rewrite-translate', label: tm('Translate to'), title: tm('Translation'), needsLanguage: true }),
  Object.freeze({ id: 'bilingual', featureId: 'rewrite-bilingual', label: tm('Bilingual (original and translation)'), title: tm('Original and translation'), needsLanguage: true }),
]);

export const rewritePresetById = (id) => REWRITE_PRESETS.find((p) => p.id === id) || null;

/**
 * The picker. The name (not the code) is what the instruction says, and only names from this list ever reach a prompt: the English
 * name stays in `name` for the instruction (languageName), and the picker shows it translated.
 */
export const LANGUAGES = Object.freeze(
  [
    ['en', tm('English')], ['es', tm('Spanish')], ['fr', tm('French')], ['de', tm('German')], ['pt', tm('Portuguese')], ['it', tm('Italian')],
    ['nl', tm('Dutch')], ['pl', tm('Polish')], ['hi', tm('Hindi')], ['ar', tm('Arabic')], ['zh', tm('Chinese (Simplified)')], ['ja', tm('Japanese')],
  ].map(([code, name]) => Object.freeze({ code, name }))
);

export const languageName = (code) => LANGUAGES.find((l) => l.code === code)?.name || '';

/**
 * A copy of a translate / bilingual feature whose instruction names the chosen language. The name comes from LANGUAGES, never
 * from free text. Returns null for an unknown language (the caller must not run without one).
 */
export function withLanguage(feature, code) {
  const name = languageName(code);
  if (!name || typeof feature?.instructionFor !== 'function') return null;
  return { ...feature, instruction: feature.instructionFor(name) };
}

// ---- The pack ------------------------------------------------------------------------------------------------------

/** The text, cut to the longest length the tools handle. */
export const clipComposeText = (value) => String(value ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_FORM_TEXT);

/**
 * People to mask by name, from what the agent typed in "Names to hide" ("Abel Tuter, Priya Raman"). Free text is the one place
 * the firewall cannot find a name by pattern, so the agent can name them. At most ten, each 2 to 60 characters with a letter.
 */
export function peopleFromNames(input) {
  const seen = new Set();
  const out = [];
  for (const piece of String(input ?? '').split(/[,;\n]+/)) {
    const name = piece.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60 || !/\p{L}/u.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: 'named', name });
    if (out.length >= 10) break;
  }
  return out;
}

const lower = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Two people lists as one, without repeats; entries with neither a name nor an email are dropped. A person is a repeat when
 * the email was seen, or (for someone with no email) the name was. Put the richer list first: a name-only entry such as one
 * typed under "Names to hide" then gives way to the record's person with the same name.
 */
export function mergePeople(...lists) {
  const emails = new Set();
  const names = new Set();
  const out = [];
  for (const list of lists) {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object') continue;
      const email = lower(p.email);
      const name = lower(p.name);
      if (!email && !name) continue;
      if (email ? emails.has(email) : names.has(name)) continue;
      if (email) emails.add(email);
      if (name) names.add(name);
      out.push(p);
    }
  }
  return out;
}

// Part names a compose pack may use. A text read from a form field keeps that field's name, so a policy that blocks the field
// (blockedFields) blocks the text too; pasted text is 'text'; call notes are 'notes'.
const COMPOSE_FIELDS = new Set([...FORM_FIELD_NAMES, 'text', 'notes']);

/** The table of the page the person is on ('' when there is no record and no blank form). */
export const pageTable = (page) => String(page?.record?.table || page?.newRecord?.table || '');

/**
 * A ContextPack-shaped object for a run whose only data is the text the agent supplied.
 *
 * `table` is the REAL table of the page the person is on (page.record.table or page.newRecord.table; see pageTable), so the
 * table policy (blockedTables), the HR gate and the Strict-mode HR rule apply to a rewrite exactly as they do to an action on
 * that record. Without a page table it stays 'compose' (text pasted with no ticket open). `sysId` is always synthetic: the
 * pack stands for the supplied text, not for a record, and nothing is read with it.
 * `field` names the form field the text came from (comments, work_notes, close_notes, description, short_description) so
 * blockedFields applies; 'text' for pasted text. `compose` is the transient field the feature's parts() reads.
 */
export function buildComposePack({ text, people = [], label = 'Text to rewrite', field = 'text', table = '' } = {}) {
  const realTable = TABLE_RE.test(String(table || '')) ? String(table) : 'compose';
  return {
    version: 1,
    table: realTable,
    sysId: 'compose',
    number: '',
    kind: 'other',
    fields: {},
    people: mergePeople(people),
    journal: [],
    related: {},
    access: [],
    compose: { text: clipComposeText(text), label, field: COMPOSE_FIELDS.has(field) ? field : 'text' },
  };
}

/**
 * Why text may not be read from the open form into a rewrite ('' when it may): the organisation blocks the table, or it is an
 * HR table and HR content is not allowed, or the field itself is blocked. The same rules the run would hit later, said up front.
 * `instanceLabel`: what the instance calls this kind of record, when the caller has read it (the display value of sys_class_name).
 */
export function formReadRefusal(table, field, policy, instanceLabel = '') {
  // (the table is said as a plain noun in the plural: 'HR cases', 'requested items', never its name)
  if (table && !isTableAllowed(table, policy)) return t('Your organisation does not allow Agent Buddy to use {type}.', { type: tableLabel(table, { plural: true, instanceLabel }) });
  // (the policy's own sensitive prefixes count too, as they do when the run is prepared: src/lib/pipeline.js)
  if (table && isSensitiveByPolicy(table, policy) && !policy?.allowHrContent) return t('HR case content is not sent to an AI model unless your organisation allows it. Ask your administrator.');
  if (field && (policy?.blockedFields || []).includes(String(field).toLowerCase())) return t('Your organisation does not allow the {field} field to be sent to an AI model.', { field: isolate(field) });
  return '';
}

/** The one part a rewrite or notes run sends: the supplied text. Nothing else. */
export function composeParts(pack) {
  const c = pack?.compose;
  const text = String(c?.text ?? '').trim();
  if (!text) return [];
  return [{ label: String(c.label || 'Text to rewrite'), field: String(c.field || 'text'), text }];
}
