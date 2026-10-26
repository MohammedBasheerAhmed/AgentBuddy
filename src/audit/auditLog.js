// The local audit log: who-did-what accountability WITHOUT content. An entry says that feature X ran on table Y with
// provider/model Z, how many items were masked and what happened. It never holds ticket text, names, prompts or replies,
// and the record id is stored as a salted hash, so the log can be exported for a security review without being a copy of
// the data. Pure functions here; the panel persists the list (src/lib/storage.js) under a Web Lock.

export const AUDIT_KEY = 'agentbuddy_audit';
export const AUDIT_SALT_KEY = 'agentbuddy_audit_salt';
export const AUDIT_LIMIT = 1000;

const OUTCOMES = ['sent', 'blocked', 'error', 'cancelled', 'inserted', 'copied'];

/** Short salted hash of a record id: enough to see "the same record again", useless for finding the record. */
export async function hashRecordId(sysId, salt) {
  if (!sysId) return '';
  const data = new TextEncoder().encode(`${salt}:${sysId}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/**
 * @param {object} e { feature, table, recordHash, provider, model, host, mode, preview, stats:{total,counts}, usage:{input,output}, outcome, ms, reason }
 * Only whitelisted fields are copied, and `counts` keeps numbers only, so nothing else can slip into the log.
 */
export function makeAuditEntry(e = {}, now = new Date()) {
  const counts = {};
  Object.entries(e.stats?.counts || {}).forEach(([kind, n]) => {
    if (/^[A-Z_]{2,20}$/.test(kind) && count(n)) counts[kind] = count(n);
  });
  return {
    time: new Date(now).toISOString(),
    feature: String(e.feature || '').slice(0, 40),
    table: String(e.table || '').slice(0, 80),
    record: String(e.recordHash || '').slice(0, 16),
    provider: String(e.provider || '').slice(0, 40),
    model: String(e.model || '').slice(0, 80),
    host: String(e.host || '').slice(0, 120),
    piiMode: ['standard', 'strict', 'local-only'].includes(e.mode) ? e.mode : '',
    preview: ['shown', 'skipped'].includes(e.preview) ? e.preview : '',
    masked: count(e.stats?.total),
    counts,
    inputTokens: count(e.usage?.input),
    outputTokens: count(e.usage?.output),
    outcome: OUTCOMES.includes(e.outcome) ? e.outcome : 'error',
    ms: count(e.ms),
    // A short machine reason such as BLOCKED_FIELD or NOT_LOCAL; never an error message that could echo content.
    reason: /^[A-Z_]{2,30}$/.test(String(e.reason || '')) ? e.reason : '',
  };
}

/** Append, keeping the newest `limit` entries (stored oldest first). */
export function appendAudit(log, entry, limit = AUDIT_LIMIT) {
  const next = [...(Array.isArray(log) ? log : []), entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function auditToCsv(log) {
  const header = ['time', 'feature', 'table', 'record', 'provider', 'model', 'host', 'pii_mode', 'preview', 'masked_items', 'masked_detail', 'input_tokens', 'output_tokens', 'outcome', 'reason', 'ms'];
  const rows = (Array.isArray(log) ? log : []).map((e) => [
    e.time, e.feature, e.table, e.record, e.provider, e.model, e.host, e.piiMode, e.preview, e.masked,
    Object.entries(e.counts || {}).map(([k, n]) => `${k}:${n}`).join(' '),
    e.inputTokens, e.outputTokens, e.outcome, e.reason, e.ms,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
