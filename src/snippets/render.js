// Snippet templates: `{{caller.first_name}}` placeholders filled from plain data.
//
// This is a fill-in-the-blanks engine, not a template language. A placeholder is `{{ name }}` or `{{ name | fallback }}`
// where name is dotted letters/digits/underscore/dash. There is no eval, no expressions, no function calls, and values
// are never expanded again (a value that contains `{{x}}` is inserted as written). Lookups only read own data
// properties of the variables object, so `{{constructor}}` or a getter can never run anything.
//
// Names are case-sensitive. A name with no value and no fallback is left visible as `{{name}}` and listed in `missing`
// so the agent can see what still needs filling in. An empty or whitespace-only value counts as no value.

import { stripUnsafeChars } from '../render/safeText.js';
import { parseSnTime } from '../context/util.js';
import { CUSTOMER_ROLES } from '../context/identity.js';
import { tm } from '../i18n/index.js';

const MAX_INNER = 1000; // longest text between the braces; longer is left as plain text
const MAX_NAME = 100;
const MAX_VALUE = 2000; // longest single value inserted
const MAX_OUTPUT = 100000; // longest rendered text
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The variables the app fills in from the open record and the signed-in agent. `description` is shown to the person, and so are the
 * three examples that are words (the others are names, a number and dates): marked with tm(), shown with t().
 */
export const BUILTIN_VARIABLES = Object.freeze([
  { name: 'caller.first_name', description: tm("The caller's first name (requester, contact or subject of the ticket)"), example: 'Abel' },
  { name: 'caller.last_name', description: tm("The caller's last name"), example: 'Tuter' },
  { name: 'caller.name', description: tm("The caller's full name"), example: 'Abel Tuter' },
  { name: 'number', description: tm('Ticket number'), example: 'INC0010001' },
  { name: 'short_description', description: tm('Short description of the ticket'), example: tm('Cannot connect to VPN') },
  { name: 'state', description: tm('State of the ticket (display value)'), example: tm('In Progress') },
  { name: 'priority', description: tm('Priority of the ticket (display value)'), example: tm('2 - High') },
  { name: 'assigned_to.name', description: tm('Who the ticket is assigned to'), example: 'Beth Anglin' },
  { name: 'agent.first_name', description: tm('Your first name'), example: 'Beth' },
  { name: 'agent.name', description: tm('Your full name'), example: 'Beth Anglin' },
  { name: 'sla.due', description: tm('When the next SLA is due'), example: '2026-10-27 09:00:00' },
  { name: 'today', description: tm("Today's date (YYYY-MM-DD)"), example: '2026-10-26' },
]);

// ---- Template reading ----------------------------------------------------------------------------------------------

function parsePlaceholder(inner) {
  const bar = inner.indexOf('|');
  const name = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  if (!name || name.length > MAX_NAME || !NAME.test(name)) return null;
  return { name, fallback: bar < 0 ? null : inner.slice(bar + 1).trim() };
}

// Splits a template into literal text and placeholders: [{ text } | { name, fallback }]. Each scan moves forward only,
// so the cost is linear however many braces the template holds. Anything that is not a well-formed placeholder
// (`{{ 1 + 1 }}`, `{{ a b }}`, an unclosed `{{`) stays literal text.
function readTemplate(template) {
  const s = typeof template === 'string' ? template : template == null ? '' : String(template);
  const parts = [];
  let i = 0;
  let lit = 0;
  let closeAt = -1;
  while (i < s.length) {
    const open = s.indexOf('{{', i);
    if (open < 0) break;
    if (closeAt < open + 2) {
      closeAt = s.indexOf('}}', open + 2);
      if (closeAt < 0) break;
    }
    const nested = s.indexOf('{{', open + 2);
    if (nested >= 0 && nested < closeAt) {
      i = nested; // an inner `{{` starts the real placeholder; this one is literal
      continue;
    }
    const parsed = closeAt - open - 2 <= MAX_INNER ? parsePlaceholder(s.slice(open + 2, closeAt)) : null;
    if (!parsed) {
      i = open + 1;
      continue;
    }
    if (open > lit) parts.push({ text: s.slice(lit, open) });
    parts.push(parsed);
    i = closeAt + 2;
    lit = i;
  }
  if (lit < s.length) parts.push({ text: s.slice(lit) });
  return parts;
}

/** Variable names used by a template, once each, in order of first appearance. */
export function listVariables(template) {
  const seen = new Set();
  const names = [];
  for (const p of readTemplate(template)) {
    if (p.name !== undefined && !seen.has(p.name)) {
      seen.add(p.name);
      names.push(p.name);
    }
  }
  return names;
}

// ---- Values --------------------------------------------------------------------------------------------------------

// One value as text, or null when there is nothing usable (absent, empty, an object or function).
function toValueText(value) {
  let text = null;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : null;
  else if (typeof value === 'boolean' || typeof value === 'bigint') text = String(value);
  else if (Array.isArray(value)) {
    const items = value.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
    text = items.length ? items.join(', ') : null;
  }
  if (text === null) return null;
  const clean = stripUnsafeChars(text.length > MAX_VALUE * 2 ? text.slice(0, MAX_VALUE * 2) : text);
  if (!clean.trim()) return null;
  return clean.length > MAX_VALUE ? clean.slice(0, MAX_VALUE) : clean;
}

// Walks a dotted path through own data properties only.
function lookup(variables, name) {
  let cur = variables;
  for (const key of name.split('.')) {
    if (cur === null || typeof cur !== 'object' || BLOCKED_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(cur, key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(cur, key);
    if (!descriptor || !('value' in descriptor)) return null; // never run a getter
    cur = descriptor.value;
  }
  return toValueText(cur);
}

/**
 * Fills a template. Returns { text, missing } where missing lists (once, in order) the names that had no value and no
 * fallback; those stay in the text as `{{name}}`.
 */
export function renderSnippet(template, variables) {
  const missing = [];
  const seen = new Set();
  const out = [];
  let size = 0;
  for (const p of readTemplate(template)) {
    let piece;
    if (p.name === undefined) piece = p.text;
    else {
      const value = lookup(variables, p.name);
      if (value !== null) piece = value;
      else if (p.fallback !== null) piece = p.fallback;
      else {
        piece = `{{${p.name}}}`;
        if (!seen.has(p.name)) {
          seen.add(p.name);
          missing.push(p.name);
        }
      }
    }
    if (size + piece.length > MAX_OUTPUT) {
      out.push(piece.slice(0, MAX_OUTPUT - size));
      break;
    }
    out.push(piece);
    size += piece.length;
  }
  return { text: out.join(''), missing };
}

// ---- Variables from the open record --------------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// "Abel Tuter" -> Abel / Tuter, "Tuter, Abel" -> Abel / Tuter, "Madonna" -> Madonna / ''.
function splitName(full) {
  const name = text(full);
  if (!name) return { first: '', last: '' };
  const comma = name.indexOf(',');
  if (comma > 0 && comma < name.length - 1) return { first: name.slice(comma + 1).trim(), last: name.slice(0, comma).trim() };
  const words = name.split(/\s+/);
  return { first: words[0], last: words.slice(1).join(' ') };
}

// The caller's first and last name: the ones sys_user holds (the pack's firstName / lastName, src/context/people.js) when there are
// some, so "Mary Ann Smith" is greeted as Mary Ann and "Yamada Taro" as Taro. Where sys_user could not be read, people.js fills them
// by cutting the display name at its first space, which reads "Tuter, Abel" as "Tuter,": a pair that is only that cut is replaced by
// splitName, which knows the comma form.
function callerNames(person) {
  const split = splitName(person.name);
  const first = text(person.firstName);
  const last = text(person.lastName);
  if (!first && !last) return split;
  const words = text(person.name).split(/\s+/);
  const onlyTheCut = first === words[0] && last === words.slice(1).join(' ');
  return onlyTheCut ? split : { first, last };
}

// Who the record is "for", by role: the customer roles every check uses (src/context/identity.js), in their order; the first role
// found wins. A customer service case names a contact (business customers) or a consumer (private customers): both are the person a
// reply is written to.
const CALLER_ROLES = CUSTOMER_ROLES;

function findPerson(people, roles) {
  if (!Array.isArray(people)) return null;
  for (const role of roles) {
    const hit = people.find((p) => p && typeof p === 'object' && p.role === role && text(p.name));
    if (hit) return hit;
  }
  return null;
}

// The next SLA due time: the record's own sla_due field, else the earliest open one in related SLAs (if present).
// The context engine's SLA rows (src/context/related.js) are { name, stage, breached, percentage, plannedEnd }; the older
// column-style names (due, has_breached, planned_end_time) are understood too. What is inserted is the time as the person sees it
// (the display value); which one is earliest is decided on times, never on that text ("11/04/2026" sorts after "02/05/2027" as
// text): the stored UTC value when the row carries it (plannedEndUtc), else the shown one when it is in ServiceNow's own
// YYYY-MM-DD form. A time that cannot be read comes after every one that can, in the order the rows were given.
function slaDue(pack) {
  const fromField = text(pack.fields && pack.fields.sla_due);
  if (fromField) return fromField;
  const rel = pack.related && typeof pack.related === 'object' ? pack.related : {};
  const list = [rel.slas, rel.sla, rel.task_sla].find(Array.isArray) || [];
  const dues = list
    .filter((s) => s && typeof s === 'object' && !/^true$/i.test(text(s.has_breached)) && !/^true$/i.test(text(s.breached)) && !/^(completed|cancelled)$/i.test(text(s.stage)))
    .map((s) => {
      const shown = text(s.due) || text(s.plannedEnd) || text(s.planned_end_time) || text(s.breach_time);
      const stored = parseSnTime(text(s.plannedEndUtc));
      return { shown, at: Number.isFinite(stored) ? stored : parseSnTime(shown) };
    })
    .filter((d) => d.shown)
    .sort((a, b) => (Number.isFinite(a.at) ? (Number.isFinite(b.at) ? a.at - b.at : -1) : Number.isFinite(b.at) ? 1 : 0));
  return dues[0]?.shown || '';
}

function localDate(now) {
  const d = now instanceof Date ? now : new Date(now === undefined ? Date.now() : now);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Sets a nested key only when the value is not empty, so a missing piece of data stays "missing" in the template.
function put(target, path, value) {
  const v = text(value);
  if (!v) return;
  const [head, tail] = path.split('.');
  if (tail === undefined) target[head] = v;
  else (target[head] = target[head] || {})[tail] = v;
}

/**
 * ContextPack (see docs/contracts.md) plus the signed-in agent { name, first_name } to the nested variables object
 * that renderSnippet reads. Tolerates a missing pack, missing fields and missing people. `now` is for tests.
 */
export function buildVariables(pack, agent, now) {
  const vars = {};
  const p = pack && typeof pack === 'object' ? pack : {};
  const fields = p.fields && typeof p.fields === 'object' ? p.fields : {};

  const caller = findPerson(p.people, CALLER_ROLES);
  if (caller) {
    const { first, last } = callerNames(caller);
    put(vars, 'caller.first_name', first);
    put(vars, 'caller.last_name', last);
    put(vars, 'caller.name', caller.name);
  }

  put(vars, 'number', p.number);
  put(vars, 'short_description', fields.short_description);
  put(vars, 'state', fields.state);
  put(vars, 'priority', fields.priority);

  const assignee = findPerson(p.people, ['assigned_to']);
  put(vars, 'assigned_to.name', assignee ? assignee.name : fields.assigned_to);
  put(vars, 'sla.due', slaDue(p));

  const a = agent && typeof agent === 'object' ? agent : {};
  const known = splitName(a.name);
  const first = text(a.first_name) || known.first;
  put(vars, 'agent.first_name', first);
  put(vars, 'agent.name', text(a.name) || [first, text(a.last_name)].filter(Boolean).join(' '));

  put(vars, 'today', localDate(now));
  return vars;
}
