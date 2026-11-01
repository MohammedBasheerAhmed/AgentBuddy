// Reference material for a ticket: solved look-alike tickets and knowledge articles, asked of the content script with the
// READ operations that already exist ('similar', 'knowledge') or the one this area adds ('routingLookalikes').
//
// What comes back is untrusted: it was written by other people, and the answer travels through the page's world. So every
// hit is rebuilt field by field (strings only, capped, a record number in the shape of a record number or the hit is
// dropped) before it can reach a prompt. It reaches the AI only through feature.parts() and the firewall, like all ticket
// text. Nothing here is stored: the result lives on the pack for one run.
//
// A read that is refused or fails never stops the feature. It becomes a status ('denied', 'error', ...) that the prompt
// is told about, so the model says it worked from the record alone instead of pretending.

export const SIMILAR_LIMIT = 3;
export const KNOWLEDGE_LIMIT = 3;

// Fixed vocabulary for what a read came back with. Anything else becomes 'error'. 'blocked' is the organisation's rule (blockedTables).
const STATUSES = new Set(['ok', 'empty', 'empty-or-hidden', 'denied', 'skipped', 'error', 'blocked']);

// The people named on the rows of the other tickets and articles (display names only). They go on the pack's people list, so the
// firewall masks them exactly wherever the wording of those tickets mentions them.
export const MAX_HIT_PEOPLE = 8;
export const MAX_REFERENCE_PEOPLE = 40;
const namesOf = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((n) => typeof n === 'string')
    .map((n) => text(n, 100))
    .filter((n) => n && !/^[0-9a-f]{32}$/i.test(n))
    .slice(0, MAX_HIT_PEOPLE);

// A record number: letters then digits (INC0010123, KB0010004, SCTASK0000999, CS0001234).
const NUMBER_RE = /^[A-Za-z]{2,12}\d{4,12}$/;

// An article is a "strong" match when most of what we searched for is in its title. The score is the one the 'knowledge'
// read gives (src/context/similar.js scoreArticle: 2 points per keyword in the title, 1 per keyword in the text, as a
// percentage of the maximum). 60 and a title match means about three of five search words are in the title.
export const STRONG_SCORE = 60;

// One line, whitespace squeezed, capped. Line breaks are removed on purpose: text from another ticket cannot then start a new
// line that looks like one of our own labels ("Match strength: STRONG").
const text = (value, max) => {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}...` : clean;
};

const whyText = (why) => (Array.isArray(why) ? why.filter((w) => typeof w === 'string').slice(0, 5).map((w) => text(w, 120)).filter(Boolean).join('; ') : '');
const scoreOf = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0);

/**
 * A solved look-alike ticket, rebuilt from an untrusted hit. Returns null when it cannot be cited (no valid number).
 * `closeNotes: false` leaves the resolution text and code out (the routing hint needs group, priority and category only).
 */
export function cleanTicketHit(hit, { closeNotes = true } = {}) {
  if (!hit || typeof hit !== 'object' || typeof hit.number !== 'string' || !NUMBER_RE.test(hit.number)) return null;
  return {
    number: hit.number.toUpperCase(),
    short_description: text(hit.short_description, 300),
    close_notes: closeNotes ? text(hit.close_notes, 600) : '',
    close_code: closeNotes ? text(hit.close_code, 60) : '',
    people: namesOf(hit.people),
    category: text(hit.category, 100),
    subcategory: text(hit.subcategory, 100),
    cmdb_ci: text(hit.cmdb_ci, 100),
    assignment_group: text(hit.assignment_group, 100),
    priority: text(hit.priority, 40),
    why: whyText(hit.why),
  };
}

/** A knowledge article hit, rebuilt from an untrusted one. `strong` is true for a close match on the title. */
export function cleanArticleHit(hit) {
  if (!hit || typeof hit !== 'object' || typeof hit.number !== 'string' || !NUMBER_RE.test(hit.number)) return null;
  const score = scoreOf(hit.score);
  const why = whyText(hit.why);
  return {
    number: hit.number.toUpperCase(),
    short_description: text(hit.short_description, 300),
    excerpt: text(hit.excerpt, 600),
    knowledgeBase: text(hit.knowledgeBase, 100),
    people: namesOf(hit.people),
    score,
    why,
    strong: score >= STRONG_SCORE && /\btitle\b/i.test(why),
  };
}

/** The strongest existing article, or null when none is a close match. */
export const strongArticle = (hits) => (Array.isArray(hits) ? hits.find((h) => h && h.strong) || null : null);

// The status of one read from its answer: hits mean 'ok'; otherwise the first access entry that says something else.
function statusOf(answer, hits) {
  if (hits.length) return 'ok';
  const entries = Array.isArray(answer?.access) ? answer.access : [];
  const found = entries.map((a) => String(a?.status || '')).find((s) => STATUSES.has(s) && s !== 'ok');
  return found || 'empty';
}

// What the panel passes to a read: the table, id and the few fields a search uses. People are included only so their names
// are kept out of the search words; the pack goes to the content script on this computer, never to the AI.
export function packForSearch(pack) {
  const f = pack?.fields || {};
  const fields = {};
  for (const name of ['short_description', 'description', 'cmdb_ci', 'category', 'subcategory', 'cat_item', 'product', 'business_service']) {
    if (typeof f[name] === 'string' && f[name]) fields[name] = name === 'description' ? f[name].slice(0, 300) : f[name];
  }
  return {
    table: pack.table,
    sysId: pack.sysId,
    number: pack.number,
    fields,
    people: (Array.isArray(pack.people) ? pack.people : []).map((p) => ({ name: p?.name || '', firstName: p?.firstName || '', lastName: p?.lastName || '' })),
  };
}

// A lost session is the person's to fix (log in again); every other failure of a reference read is a status.
async function attempt(promise) {
  try {
    return { answer: await promise };
  } catch (err) {
    if (err?.code === 'SESSION_EXPIRED') throw err;
    return { error: err };
  }
}

const statusFromError = (err) => {
  if (err?.code === 'BLOCKED_TABLE') return 'blocked'; // the organisation's rule, not the person's access
  return err?.code === 'ACCESS_DENIED' || /\b403\b|not allowed|denied/i.test(String(err?.message || '')) ? 'denied' : 'error';
};

/**
 * Add reference material to a pack for a run.
 * @param {object} pack ContextPack (not changed; a copy is returned)
 * @param {{ read: (op: string, args: object) => Promise<object>, allowSensitive?: boolean }} context from useRun
 * @param {{ similar?: 'similar' | 'routingLookalikes' | null, knowledge?: boolean, closeNotes?: boolean }} wanted which reads to make;
 *   closeNotes: false drops the look-alikes' resolution text (the routing hint)
 * @returns {Promise<object>} the pack with `reference` = { similar?: {status, hits}, knowledge?: {status, hits} }, the reads'
 *   access entries appended to `access`, the people named on the other tickets added to `people` (role 'reference_person'), and
 *   `requirePreview: true` when any other ticket or article is part of it (the person sees the outgoing text every time)
 */
export async function addReference(pack, { read, allowSensitive = false } = {}, { similar = null, knowledge = false, closeNotes = true } = {}) {
  const args = { pack: packForSearch(pack), allowSensitive: allowSensitive === true };
  const ask = (op, extra = {}) => (typeof read === 'function' ? attempt(Promise.resolve().then(() => read(op, { ...args, ...extra }))) : Promise.resolve({ error: new Error('no reader') }));

  const [t, k] = await Promise.all([
    similar ? ask(similar, { resolvedOnly: true }) : null,
    knowledge ? ask('knowledge') : null,
  ]);

  const reference = {};
  const access = [...(Array.isArray(pack.access) ? pack.access : [])];
  const settle = (key, result, clean, limit) => {
    if (!result) return;
    const raw = Array.isArray(result.answer?.hits) ? result.answer.hits : [];
    const hits = raw.map(clean).filter(Boolean).slice(0, limit);
    reference[key] = { status: result.error ? statusFromError(result.error) : statusOf(result.answer, hits), hits };
    // `reference: true`: the "Reference material status" part already tells the model what this read found, so the shared
    // "Not available" part (src/features/parts.js) does not say it again (a similar-ticket search on incident is not "Linked incidents").
    if (Array.isArray(result.answer?.access)) access.push(...result.answer.access.filter((a) => a && typeof a === 'object').map((a) => ({ ...a, reference: true })));
    if (result.error) access.push({ source: key === 'similar' ? 'similar tickets' : 'knowledge', status: reference[key].status, note: reference[key].status === 'denied' ? 'Your user cannot read this.' : reference[key].status === 'blocked' ? 'Your organisation does not allow Agent Buddy to read this.' : 'Could not be read.', reference: true });
  };
  settle('similar', t, (hit) => cleanTicketHit(hit, { closeNotes }), SIMILAR_LIMIT);
  settle('knowledge', k, cleanArticleHit, KNOWLEDGE_LIMIT);

  // The people on the other tickets: exact masking for their names. Display names only; no email, no other table.
  const people = [...(Array.isArray(pack.people) ? pack.people : [])];
  const known = new Set(people.map((p) => String(p?.name || '').toLowerCase()).filter(Boolean));
  let added = 0;
  for (const hit of [...(reference.similar?.hits || []), ...(reference.knowledge?.hits || [])]) {
    for (const name of hit.people || []) {
      if (known.has(name.toLowerCase()) || added >= MAX_REFERENCE_PEOPLE) continue;
      known.add(name.toLowerCase());
      added += 1;
      people.push({ role: 'reference_person', name, email: '', sysId: '' });
    }
  }
  const anyHit = (reference.similar?.hits?.length || 0) + (reference.knowledge?.hits?.length || 0) > 0;
  return { ...pack, reference, access, people, ...(anyHit ? { requirePreview: true } : {}) };
}

/** The plain-language state of one read, for the status part the model is shown. */
export function statusSentence(entry) {
  if (!entry) return 'not looked for';
  switch (entry.status) {
    case 'ok':
      return `${entry.hits.length} found`;
    case 'empty':
      return 'none found';
    case 'empty-or-hidden':
      return 'none found (the user may not be allowed to see any)';
    case 'denied':
      return 'could not be read (no access)';
    case 'skipped':
      return 'not searched';
    case 'blocked':
      return 'not allowed by the organisation';
    default:
      return 'could not be read';
  }
}
