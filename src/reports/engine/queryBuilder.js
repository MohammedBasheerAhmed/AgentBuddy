// Builds ServiceNow encoded queries from a small closed vocabulary, so nothing a person (or the instance) typed is ever
// pasted into a query as it is. A condition is a plain object { op, field, value|values|ms }; buildQuery checks every part:
//   - a field is a plain identifier (letters, digits, underscore, dots for dot-walking)
//   - a sys_id value is 32 hex characters, an IN-list holds only safe tokens
//   - a text value has control characters refused and every caret doubled (a caret ends a condition in an encoded query)
//   - dates are numbers (ms) turned into the stored UTC format here, never text
// Pure and tested (tests/reports-query.test.js). The same function builds the drill-down address the panel opens.
import { SYS_ID_RE } from '../../context/util.js';
import { snLiteral, DAY } from './time.js';

export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
  }
}

const FIELD_RE = /^[a-z][a-z0-9_]{0,60}(\.[a-z][a-z0-9_]{0,60}){0,2}$/;
const TOKEN_RE = /^[A-Za-z0-9_.\-]{1,100}$/;
// eslint-disable-next-line no-control-regex -- the point is to refuse control characters.
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const MAX_TEXT = 200;
const MAX_LIST = 100;

export const isField = (name) => FIELD_RE.test(String(name || ''));

/** A text value for an `eq`/`ne` condition: control characters refused, carets doubled (the encoded-query escape). */
export function escapeValue(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new QueryError('A condition needs a value.');
  if (text.length > MAX_TEXT) throw new QueryError('That value is too long for a filter.');
  if (CONTROL_RE.test(text)) throw new QueryError('That value has characters a filter cannot hold.');
  // ServiceNow runs a value that starts with "javascript:" as a server-side script when it evaluates the query.
  if (/javascript\s*:/i.test(text)) throw new QueryError('That value has characters a filter cannot hold.');
  return text.replace(/\^/g, '^^');
}

function needField(c) {
  if (!isField(c.field)) throw new QueryError('That is not a valid column.');
  return c.field;
}

function listValues(c) {
  const values = Array.isArray(c.values) ? c.values : [];
  if (!values.length) throw new QueryError('A list filter needs at least one value.');
  if (values.length > MAX_LIST) throw new QueryError('That list is too long for a filter.');
  return values.map((v) => {
    const text = String(v ?? '').trim();
    if (!(SYS_ID_RE.test(text) || TOKEN_RE.test(text))) throw new QueryError('A list value has characters a filter cannot hold.');
    return text;
  });
}

function needMs(c) {
  if (!Number.isFinite(c.ms)) throw new QueryError('A date filter needs a date.');
  return snLiteral(c.ms);
}

function needNumber(c) {
  const n = Number(c.value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new QueryError('A number filter needs a number.');
  return String(n);
}

// op -> how it is written. Each returns the encoded text of one condition.
const OPS = {
  true: (c) => `${needField(c)}=true`,
  false: (c) => `${needField(c)}=false`,
  eq: (c) => `${needField(c)}=${SYS_ID_RE.test(String(c.value)) ? String(c.value) : escapeValue(c.value)}`,
  ne: (c) => `${needField(c)}!=${SYS_ID_RE.test(String(c.value)) ? String(c.value) : escapeValue(c.value)}`,
  like: (c) => `${needField(c)}LIKE${escapeValue(c.value)}`,
  in: (c) => `${needField(c)}IN${listValues(c).join(',')}`,
  notIn: (c) => `${needField(c)}NOT IN${listValues(c).join(',')}`,
  empty: (c) => `${needField(c)}ISEMPTY`,
  notEmpty: (c) => `${needField(c)}ISNOTEMPTY`,
  since: (c) => `${needField(c)}>=${needMs(c)}`,
  after: (c) => `${needField(c)}>${needMs(c)}`,
  before: (c) => `${needField(c)}<${needMs(c)}`,
  until: (c) => `${needField(c)}<=${needMs(c)}`,
  gte: (c) => `${needField(c)}>=${needNumber(c)}`,
  lte: (c) => `${needField(c)}<=${needNumber(c)}`,
  gt: (c) => `${needField(c)}>${needNumber(c)}`,
};

export const QUERY_OPS = Object.freeze(Object.keys(OPS));

/**
 * @param {{op:string, field:string, value?:any, values?:any[], ms?:number}[]} conditions all joined with AND
 * @param {{ orderBy?: string, descending?: boolean }} [options]
 * @returns {string} an encoded query
 */
export function buildQuery(conditions, { orderBy = '', descending = false } = {}) {
  const parts = [];
  for (const c of conditions || []) {
    if (!c || typeof c !== 'object') continue;
    const write = Object.prototype.hasOwnProperty.call(OPS, c.op) ? OPS[c.op] : null;
    if (!write) throw new QueryError('That filter is not supported.');
    parts.push(write(c));
  }
  if (orderBy) {
    if (!isField(orderBy)) throw new QueryError('That is not a valid column to sort by.');
    parts.push(`ORDERBY${descending ? 'DESC' : ''}${orderBy}`);
  }
  return parts.join('^');
}

/** Join already-built query pieces with AND, skipping empty ones. */
export const andQuery = (...pieces) => pieces.filter(Boolean).join('^');

// ---- Presets for the report builder -------------------------------------------------------------------------------
// A preset is a name from this list. It turns into conditions here, so the panel never writes query text.

export const FILTER_PRESETS = Object.freeze([
  { id: 'open', label: 'Open' },
  { id: 'assigned_to_me', label: 'Assigned to me' },
  { id: 'my_groups', label: 'In my groups' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'breached', label: 'SLA breached' },
  { id: 'last_7', label: 'Opened in the last 7 days', exclusive: 'window' },
  { id: 'last_30', label: 'Opened in the last 30 days', exclusive: 'window' },
  { id: 'last_90', label: 'Opened in the last 90 days', exclusive: 'window' },
]);

export const PRESET_IDS = Object.freeze(FILTER_PRESETS.map((p) => p.id));

const WINDOW_DAYS = { last_7: 7, last_30: 30, last_90: 90 };

/** Keep only known presets, at most one "opened in the last N days". Unknown names are dropped. */
export function normalizePresets(presets) {
  const out = [];
  let windowSeen = false;
  for (const id of Array.isArray(presets) ? presets : []) {
    if (!PRESET_IDS.includes(id) || out.includes(id)) continue;
    if (WINDOW_DAYS[id]) {
      if (windowSeen) continue;
      windowSeen = true;
    }
    out.push(id);
  }
  return out;
}

/**
 * Conditions for the presets that can be written without reading anything else. 'breached' is NOT here: it needs the
 * list of breached tickets first, which the builder runner reads and adds as an `in` condition.
 */
export function presetConditions(presets, { userId = '', groupIds = [], now = Date.now() } = {}) {
  const out = [];
  for (const id of normalizePresets(presets)) {
    if (id === 'open') out.push({ op: 'true', field: 'active' });
    else if (id === 'assigned_to_me') {
      if (!SYS_ID_RE.test(userId)) throw new QueryError('Agent Buddy could not tell who is signed in.');
      out.push({ op: 'eq', field: 'assigned_to', value: userId });
    } else if (id === 'my_groups') {
      if (!groupIds.length) throw new QueryError('You are not in any group that Agent Buddy can see.');
      out.push({ op: 'in', field: 'assignment_group', values: groupIds });
    } else if (id === 'unassigned') out.push({ op: 'empty', field: 'assigned_to' });
    else if (WINDOW_DAYS[id]) out.push({ op: 'since', field: 'opened_at', ms: now - WINDOW_DAYS[id] * DAY });
  }
  return out;
}

export const windowDaysOf = (presets) => {
  const id = normalizePresets(presets).find((p) => WINDOW_DAYS[p]);
  return id ? WINDOW_DAYS[id] : 0;
};
