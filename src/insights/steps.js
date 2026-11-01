// N12, steps that worked before: the fixes written on solved look-alike tickets and the steps of matching knowledge articles, as
// one list, best first. No AI: the text is what colleagues wrote, cut to its first sentences. Pure.

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const MAX_FIX = 240;

/** The first sentence or two of a note, at most `max` characters. */
export function firstSentences(value, max = MAX_FIX) {
  const flat = text(value).replace(/\s+/g, ' ');
  if (!flat) return '';
  // A full stop ends a sentence only before a space or the end: "client v5.2", "e.g." and "10.0.0.1" stay whole.
  const sentences = flat.match(/(?:[^.!?]|[.!?](?!\s|$))+(?:[.!?]+(?=\s|$)|$)/g) || [flat];
  let out = '';
  for (const s of sentences) {
    const next = `${out}${s.trim()}`.trim();
    if (out && next.length > max) break;
    out = `${next} `;
    if (out.length >= max * 0.6) break;
  }
  out = out.trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** The steps of an article excerpt: its list lines when it has some ("- Check the client version"), else its first sentences. */
export function articleSteps(excerpt, max = MAX_FIX) {
  const lines = text(excerpt)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(?:-|\*|\d+[.)])\s+\S/.test(l))
    .map((l) => l.replace(/^(?:-|\*|\d+[.)])\s+/, ''));
  if (lines.length) {
    const joined = lines.slice(0, 4).join('; ');
    return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}…` : joined;
  }
  return firstSentences(excerpt, max);
}

const fold = (s) => text(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * @param {{ lookalikes?: object[], articles?: object[] }} input solved look-alikes (with close_notes) and knowledge hits
 * @returns {{ items: { kind: 'ticket'|'article', table: string, sysId: string, number: string, title: string, fix: string,
 *   why: string, score: number }[] }}
 */
export function stepsThatWorked({ lookalikes = [], articles = [] } = {}) {
  const items = [];
  for (const hit of Array.isArray(lookalikes) ? lookalikes : []) {
    const fix = firstSentences(hit?.close_notes);
    if (!fix || !text(hit?.number)) continue;
    items.push({
      kind: 'ticket',
      table: text(hit.table),
      sysId: text(hit.sysId),
      number: text(hit.number),
      title: text(hit.short_description),
      fix,
      why: [text(hit.close_code), Array.isArray(hit.why) ? hit.why[0] : ''].filter(Boolean).join(' · '),
      score: Number.isFinite(hit.score) ? hit.score : 0,
    });
  }
  for (const hit of Array.isArray(articles) ? articles : []) {
    const fix = articleSteps(hit?.excerpt);
    if (!fix || !text(hit?.number)) continue;
    items.push({
      kind: 'article',
      table: 'kb_knowledge',
      sysId: text(hit.sysId),
      number: text(hit.number),
      title: text(hit.short_description),
      fix,
      why: Array.isArray(hit.why) ? text(hit.why[0]) : '',
      score: Number.isFinite(hit.score) ? hit.score : 0,
    });
  }
  // The same fix written twice (two tickets closed with the same note) is shown once, the better match kept.
  const seen = new Set();
  const unique = items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.score - a.x.score || a.i - b.i)
    .map((e) => e.x)
    .filter((x) => {
      const k = fold(x.fix);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return { items: unique };
}
