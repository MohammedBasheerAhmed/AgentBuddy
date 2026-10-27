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

// Fixed vocabulary for what a read came back with. Anything else becomes 'error'.
const STATUSES = new Set(['ok', 'empty', 'empty-or-hidden', 'denied', 'skipped', 'error']);

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

/** A solved look-alike ticket, rebuilt from an untrusted hit. Returns null when it cannot be cited (no valid number). */
export function cleanTicketHit(hit) {
  if (!hit || typeof hit !== 'object' || typeof hit.number !== 'string' || !NUMBER_RE.test(hit.number)) return null;
  return {
    number: hit.number.toUpperCase(),
    short_description: text(hit.short_description, 300),
    close_notes: text(hit.close_notes, 600),
    close_code: text(hit.close_code, 60),
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

const statusFromError = (err) => (err?.code === 'ACCESS_DENIED' || /\b403\b|not allowed|denied/i.test(String(err?.message || '')) ? 'denied' : 'error');

/**
 * Add reference material to a pack for a run.
 * @param {object} pack ContextPack (not changed; a copy is returned)
 * @param {{ read: (op: string, args: object) => Promise<object>, allowSensitive?: boolean }} context from useRun
 * @param {{ similar?: 'similar' | 'routingLookalikes' | null, knowledge?: boolean }} wanted which reads to make
 * @returns {Promise<object>} the pack with `reference` = { similar?: {status, hits}, knowledge?: {status, hits} } and the reads'
 *   access entries appended to `access`
 */
export async function addReference(pack, { read, allowSensitive = false } = {}, { similar = null, knowledge = false } = {}) {
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
    if (Array.isArray(result.answer?.access)) access.push(...result.answer.access.filter((a) => a && typeof a === 'object'));
    if (result.error) access.push({ source: key === 'similar' ? 'similar tickets' : 'knowledge', status: reference[key].status, note: reference[key].status === 'denied' ? 'Your user cannot read this.' : 'Could not be read.' });
  };
  settle('similar', t, cleanTicketHit, SIMILAR_LIMIT);
  settle('knowledge', k, cleanArticleHit, KNOWLEDGE_LIMIT);
  return { ...pack, reference, access };
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
    default:
      return 'could not be read';
  }
}
