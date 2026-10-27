// Put the answer of the `accountCases` read (src/content/ops/domain.js) onto a ContextPack, for the account briefing's enrich().
// The answer comes from the page's side of the extension, so it is treated as untrusted data: only the expected keys are kept,
// every value becomes a short plain string, the list is capped, and a status we do not know becomes an error.

import { oneLine } from '../context/util.js';

const MAX_CASES = 10;
const STATUSES = new Set(['ok', 'empty', 'empty-or-hidden', 'denied', 'error', 'skipped', 'blocked']);
const MAX_PEOPLE = 30;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (v, max) => oneLine(typeof v === 'string' || typeof v === 'number' ? String(v) : '', max);

/** The cases of an answer, cleaned. Never more than 10, never a case without a number or a description. */
export function cleanCases(list) {
  return (Array.isArray(list) ? list : [])
    .filter(isObject)
    .map((row) => ({
      number: text(row.number, 40),
      short_description: text(row.short_description, 300),
      state: text(row.state, 40),
      priority: text(row.priority, 40),
      opened_at: text(row.opened_at, 40),
      resolved_at: text(row.resolved_at, 40),
      // The people named on the case (display names): they go on the pack's people, they are not part of the text.
      people: (Array.isArray(row.people) ? row.people : []).map((n) => text(n, 100)).filter(Boolean).slice(0, 4),
    }))
    .filter((c) => c.number || c.short_description)
    .slice(0, MAX_CASES);
}

/**
 * @param {object} pack ContextPack
 * @param {{ cases?: object[], more?: number|null, access?: object[] }} answer what the `accountCases` read returned
 * @returns {object} a new pack: `related.accountCases` (a list, possibly empty, only when the read worked and the answer is a
 *   fact), `related.accountCasesSummary` ({ more } when the list is cut short) and the read's `access` entries added.
 */
export function mergeAccountCases(pack, answer) {
  const access = (Array.isArray(answer?.access) ? answer.access : [])
    .filter(isObject)
    .slice(0, 4)
    .map((a) => ({ source: text(a.source, 80) || 'account cases', status: STATUSES.has(a.status) ? a.status : 'error', note: text(a.note, 240) }));
  const worked = access.some((a) => a.status === 'ok' || a.status === 'empty');
  const related = { ...(pack.related || {}) };
  let people = pack.people;
  let reference = false;
  if (worked && Array.isArray(answer?.cases)) {
    const cases = cleanCases(answer.cases);
    // Other customers' cases: their people are masked by name, and the person sees what is sent every time.
    people = [...(Array.isArray(pack.people) ? pack.people : [])];
    const known = new Set(people.map((p) => String(p?.name || '').toLowerCase()).filter(Boolean));
    let added = 0;
    for (const name of cases.flatMap((c) => c.people)) {
      if (known.has(name.toLowerCase()) || added >= MAX_PEOPLE) continue;
      known.add(name.toLowerCase());
      added += 1;
      people.push({ role: 'reference_person', name, email: '', sysId: '' });
    }
    related.accountCases = cases.map(({ people: _names, ...rest }) => rest);
    reference = cases.length > 0;
    const more = answer.more === null ? null : Number.isFinite(answer.more) && answer.more > 0 ? Math.floor(answer.more) : 0;
    if (more !== 0) related.accountCasesSummary = { more };
  }
  return { ...pack, ...(people ? { people } : {}), related, access: [...(pack.access || []), ...access], ...(reference ? { requirePreview: true } : {}) };
}

/** The entry added when the read itself failed (the content script did not answer): fixed text, no error message. */
export function accountCasesFailed(pack) {
  return {
    ...pack,
    access: [...(pack.access || []), { source: 'sn_customerservice_case', status: 'error', note: "The account's other cases could not be read." }],
  };
}
