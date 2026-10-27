// Helpers for showing a snippet before it is used: filled from the open record, or from examples when no record is open;
// which variables could not be filled and why; and which names in a snippet are not variables Agent Buddy knows (a typo).
// Pure: the pack is passed in, nothing is read here.

import { BUILTIN_VARIABLES, buildVariables, listVariables, renderSnippet } from './render.js';

export const KNOWN_VARIABLE_NAMES = Object.freeze(BUILTIN_VARIABLES.map((v) => v.name));

// The example column of BUILTIN_VARIABLES as the nested object renderSnippet reads.
function exampleVariables() {
  const vars = {};
  for (const v of BUILTIN_VARIABLES) {
    const [head, tail] = v.name.split('.');
    if (tail === undefined) vars[head] = v.example;
    else (vars[head] = vars[head] || {})[tail] = v.example;
  }
  return vars;
}

/**
 * The snippet text as it would be inserted.
 * @param {string} body the snippet's template
 * @param {{ pack?: object|null, agent?: object|null, now?: number|Date, examples?: boolean }} [options]
 *   pack: the open record's ContextPack (read with the 'reply-draft' feature); examples: true fills from the example values
 *   instead (used when no record is open, so the person still sees what the snippet will look like)
 * @returns {{ text: string, missing: string[], source: 'record' | 'examples' }}
 */
export function previewSnippet(body, { pack = null, agent = null, now, examples = false } = {}) {
  const vars = examples ? exampleVariables() : buildVariables(pack, agent, now);
  const { text, missing } = renderSnippet(body, vars);
  return { text, missing, source: examples ? 'examples' : 'record' };
}

const HINTS = [
  [/^caller\./, 'No caller is known for this record.'],
  [/^agent\./, 'Your name is not available on this page.'],
  [/^assigned_to\./, 'The record is not assigned to anyone.'],
  [/^sla\./, 'The record has no open service level.'],
  [/^(number|short_description|state|priority)$/, 'The record has no value for this.'],
];

/** One plain line per missing variable, so none is dropped silently. */
export function describeMissing(names) {
  return (Array.isArray(names) ? names : []).map((name) => {
    if (!KNOWN_VARIABLE_NAMES.includes(name)) return { name, hint: 'Agent Buddy does not know this variable. Check the spelling, or add a fallback after a bar: {{name | fallback}}.' };
    const hint = HINTS.find(([re]) => re.test(name));
    return { name, hint: hint ? hint[1] : 'There is no value for it.' };
  });
}

/** Variables used in a template that Agent Buddy does not know (usually a typo such as caller.firstname). */
export function unknownVariables(body) {
  return listVariables(body).filter((name) => !KNOWN_VARIABLE_NAMES.includes(name));
}
