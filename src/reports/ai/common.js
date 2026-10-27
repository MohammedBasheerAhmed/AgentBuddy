// Small pure helpers the three AI report features share: turning engine JSON into short, capped lines of text, collecting the
// people a text names, and checking that an answer came back in the shape the prompt asked for.
//
// Rules every builder in src/reports/ai keeps (docs/build-rules.md):
//  - A pack is ContextPack-shaped but is NOT a ticket: `table` is 'report' and `sysId` a label ('handover', 'coaching',
//    'insights'); both only name the audit entry. The data travels in `pack.report`, and only the feature's parts() turn it
//    into text, so it reaches the AI through the firewall like everything else.
//  - Anyone the text names goes into `pack.people`, so the firewall masks the name exactly wherever it appears.
//  - Nothing here reads anything. The builders take JSON the engine already produced.
import { SYS_ID_RE, oneLine } from '../../context/util.js';

export { oneLine };

/** The table label every report pack carries. Policy `blockedTables` can name it; the audit log shows it. */
export const REPORT_TABLE = 'report';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** A set of the policy's blocked field names, lower case. */
export const blockedSet = (names) => new Set((Array.isArray(names) ? names : []).map(lower).filter(Boolean));

/** `text` cut to `max` characters, on one line. */
export const line = (text, max = 160) => oneLine(text, max);

/** A number as text, or "not available" when it is missing (never a made-up zero). */
export const figure = (value) => (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? 'not available' : String(value));

/** Words in a text: runs of letters or digits separated by spaces. Good enough for a "at most N words" check. */
export function wordCount(text) {
  return (String(text ?? '').match(/[^\s]+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Add people to a list once each (by lower-case name), keeping the first role. Empty names are dropped.
 * @returns {{ role: string, name: string }[]}
 */
export function addPeople(list, role, names) {
  const seen = new Set(list.map((p) => lower(p.name)));
  for (const name of names) {
    const clean = oneLine(name, 80);
    // A reference shown as its raw id (its display value could not be read) is not a name.
    if (clean.length < 2 || !/[\p{L}\p{N}]/u.test(clean) || SYS_ID_RE.test(clean) || seen.has(lower(clean))) continue;
    seen.add(lower(clean));
    list.push({ role, name: clean });
  }
  return list;
}

/**
 * Does the answer start each wanted heading on a line of its own? Markdown emphasis and a leading bullet are tolerated
 * ("**Headline:** ..."). Returns the headings that are missing, in order.
 */
export function missingHeadings(text, headings) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/^[\s>*#_-]+/, '').replace(/\*+/g, '').trim().toLowerCase());
  return headings.filter((h) => !lines.some((l) => l.startsWith(h.toLowerCase())));
}

/**
 * The shape check for a finished answer: words used against the cap, and the headings that did not come back. It never changes
 * the text; the view shows a calm note and lets the person decide.
 */
export function checkAnswer(text, { headings = [], maxWords = Infinity } = {}) {
  const words = wordCount(text);
  const missing = missingHeadings(text, headings);
  return { words, tooLong: words > maxWords, missing, ok: words <= maxWords && !missing.length };
}

/**
 * "My groups (2): Service Desk, Network Ops" from an engine result's scope. `hideGroups` leaves the names out (a policy that
 * blocks the assignment group column).
 */
export function scopeText(result, { hideGroups = false } = {}) {
  const groups = hideGroups ? [] : (result?.scope?.groups || []).map((g) => line(g.name, 80)).filter(Boolean);
  return `${line(result?.scope?.label || 'Mine', 60)}${groups.length ? `: ${groups.join(', ')}` : ''}`;
}

/** The engine result's notes about what could not be read, once each and short (at most 6). */
export function resultNotes(result) {
  const all = [
    ...(result?.scope?.note ? [result.scope.note] : []),
    ...(result?.tables || []).filter((t) => t.status !== 'ok' && t.note).map((t) => t.note),
    ...(result?.access || []).map((a) => a.note),
    ...(result?.notes || []),
    ...(result?.caps || []).map((c) => c.note),
  ];
  return [...new Set(all.map((n) => line(n, 160)).filter(Boolean))].slice(0, 6);
}
