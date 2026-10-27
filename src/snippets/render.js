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

const MAX_INNER = 1000; // longest text between the braces; longer is left as plain text
const MAX_NAME = 100;
const MAX_VALUE = 2000; // longest single value inserted
const MAX_OUTPUT = 100000; // longest rendered text
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** The variables the app fills in from the open record and the signed-in agent. */
export const BUILTIN_VARIABLES = Object.freeze([
  { name: 'caller.first_name', description: "The caller's first name (requester, contact or subject of the record)", example: 'Abel' },
  { name: 'caller.last_name', description: "The caller's last name", example: 'Tuter' },
  { name: 'caller.name', description: "The caller's full name", example: 'Abel Tuter' },
  { name: 'number', description: 'Record number', example: 'INC0010001' },
  { name: 'short_description', description: 'Short description of the record', example: 'Cannot connect to VPN' },
  { name: 'state', description: 'State of the record (display value)', example: 'In Progress' },
  { name: 'priority', description: 'Priority of the record (display value)', example: '2 - High' },
  { name: 'assigned_to.name', description: 'Who the record is assigned to', example: 'Beth Anglin' },
  { name: 'agent.first_name', description: 'Your first name', example: 'Beth' },
  { name: 'agent.name', description: 'Your full name', example: 'Beth Anglin' },
  { name: 'sla.due', description: 'When the next SLA is due', example: '2026-10-27 09:00:00' },
  { name: 'today', description: "Today's date (YYYY-MM-DD)", example: '2026-10-26' },
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

// Who the record is "for", by role. The first role found wins.
const CALLER_ROLES = ['caller', 'requested_for', 'contact', 'affected_user', 'opened_for', 'subject_person', 'requester'];

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
// column-style names (due, has_breached, planned_end_time) are understood too.
function slaDue(pack) {
  const fromField = text(pack.fields && pack.fields.sla_due);
  if (fromField) return fromField;
  const rel = pack.related && typeof pack.related === 'object' ? pack.related : {};
  const list = [rel.slas, rel.sla, rel.task_sla].find(Array.isArray) || [];
  const dues = list
    .filter((s) => s && typeof s === 'object' && !/^true$/i.test(text(s.has_breached)) && !/^true$/i.test(text(s.breached)) && !/^(completed|cancelled)$/i.test(text(s.stage)))
    .map((s) => text(s.due) || text(s.plannedEnd) || text(s.planned_end_time) || text(s.breach_time))
    .filter(Boolean)
    .sort();
  return dues[0] || '';
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
    const { first, last } = splitName(caller.name);
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
