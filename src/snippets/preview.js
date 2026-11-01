// Helpers for showing a snippet before it is used: filled from the open record, or from examples when no record is open;
// which variables could not be filled and why; and which names in a snippet are not variables Agent Buddy knows (a typo).
// Pure: the pack is passed in, nothing is read here.

import { BUILTIN_VARIABLES, buildVariables, listVariables, renderSnippet } from './render.js';
import { t, t as tr } from '../i18n/index.js';

export const KNOWN_VARIABLE_NAMES = Object.freeze(BUILTIN_VARIABLES.map((v) => v.name));

/**
 * The context spec the Snippets panel reads the open record with (src/context/specs/compose.js): exactly the columns the
 * built-in variables use, the people and the SLAs, and no notes.
 */
export const SNIPPET_FEATURE = 'snippet-fill';

// The example column of BUILTIN_VARIABLES as the nested object renderSnippet reads (the examples that are words in the panel's language).
function exampleVariables() {
  const vars = {};
  for (const v of BUILTIN_VARIABLES) {
    const [head, tail] = v.name.split('.');
    const example = tr(v.example);
    if (tail === undefined) vars[head] = example;
    else (vars[head] = vars[head] || {})[tail] = example;
  }
  return vars;
}

/**
 * The snippet text as it would be inserted.
 * @param {string} body the snippet's template
 * @param {{ pack?: object|null, agent?: object|null, now?: number|Date, examples?: boolean }} [options]
 *   pack: the open record's ContextPack (read with SNIPPET_FEATURE); examples: true fills from the example values
 *   instead (used when no record is open, so the person still sees what the snippet will look like)
 * @returns {{ text: string, missing: string[], source: 'record' | 'examples' }}
 */
export function previewSnippet(body, { pack = null, agent = null, now, examples = false } = {}) {
  const vars = examples ? exampleVariables() : buildVariables(pack, agent, now);
  const { text, missing } = renderSnippet(body, vars);
  return { text, missing, source: examples ? 'examples' : 'record' };
}

// Why a known variable has no value, said in the panel's language.
function missingHint(name) {
  if (/^caller\./.test(name)) return t('No caller is known for this record.');
  if (/^agent\./.test(name)) return t('Your name is not available on this page.');
  if (/^assigned_to\./.test(name)) return t('The record is not assigned to anyone.');
  if (/^sla\./.test(name)) return t('The record has no open service level.');
  if (/^(number|short_description|state|priority)$/.test(name)) return t('The record has no value for this.');
  return t('There is no value for it.');
}

/** One plain line per missing variable, so none is dropped silently. */
export function describeMissing(names) {
  return (Array.isArray(names) ? names : []).map((name) => {
    if (!KNOWN_VARIABLE_NAMES.includes(name)) return { name, hint: t('Agent Buddy does not know this variable. Check the spelling, or add a fallback after a bar: {example}.', { example: '{{name | fallback}}' }) };
    return { name, hint: missingHint(name) };
  });
}

/** Variables used in a template that Agent Buddy does not know (usually a typo such as caller.firstname). */
export function unknownVariables(body) {
  return listVariables(body).filter((name) => !KNOWN_VARIABLE_NAMES.includes(name));
}
