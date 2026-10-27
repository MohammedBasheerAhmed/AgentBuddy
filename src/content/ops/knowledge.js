// READ operations for the Knowledge tools (see src/content/ops/index.js). All of them are GET-only through the context engine
// and are bounded; the panel's arguments are validated here as well. Names start with "kb" so they cannot collide with the
// operations in src/content/reads.js ('knowledge', 'duplicates', ...) or another area's.
import { readContextPack } from '../../context/pack.js';
import { GAP_MAX_DAYS, GAP_TABLES, readArticleLinks, readKnowledgeList, readKnowledgeScopes, readResolvedTickets } from '../../context/knowledge.js';
import { SYS_ID_RE } from '../../context/util.js';
import { buildGapRadar } from '../../knowledge/gaps.js';
import { DUPLICATE_THRESHOLD, findDuplicateClusters, pairwiseText } from '../../knowledge/similarity.js';
import { MERGE_MAX_ARTICLES } from '../../knowledge/parts.js';

// An optional sys_id argument: '' when absent, the lower-case id when valid, an error otherwise.
function optionalId(value, what) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !SYS_ID_RE.test(value)) throw new Error(`That is not a valid ${what}.`);
  return value.toLowerCase();
}

function boundedNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export default {
  /** The knowledge bases (or, for one base, its categories) that hold published articles, with counts. */
  kbScopes: async (args, { deps }) => readKnowledgeScopes({ knowledgeBase: optionalId(args?.knowledgeBase, 'knowledge base') }, deps, { memo: new Map() }),

  /** Groups of published articles in one knowledge base / category whose titles read alike. Titles and counts only. */
  kbDuplicates: async (args, { deps }) => {
    const knowledgeBase = optionalId(args?.knowledgeBase, 'knowledge base');
    const category = optionalId(args?.category, 'category');
    if (!knowledgeBase && !category) throw new Error('Choose a knowledge base or a category first.');
    const threshold = boundedNumber(args?.threshold, 0.4, 0.9, DUPLICATE_THRESHOLD);
    const list = await readKnowledgeList({ knowledgeBase, category }, deps, { memo: new Map() });
    return {
      scanned: list.articles.length,
      total: list.total,
      truncated: list.truncated,
      threshold,
      clusters: findDuplicateClusters(list.articles, { threshold }),
      access: list.access,
    };
  },

  /**
   * The text of the few articles of ONE cluster, read through the context engine (so only the kb-merge-draft columns come
   * back), and how much of their text overlaps. Two to four articles.
   */
  kbArticleTexts: async (args, { deps }) => {
    const ids = Array.isArray(args?.sysIds) ? [...new Set(args.sysIds.map((id) => String(id).toLowerCase()))] : [];
    if (ids.length < 2 || ids.length > MERGE_MAX_ARTICLES) throw new Error(`Pick two to ${MERGE_MAX_ARTICLES} articles to compare.`);
    if (ids.some((id) => !SYS_ID_RE.test(id))) throw new Error('That is not a valid article.');

    const articles = [];
    const access = [];
    const people = new Map(); // the authors, by id or name: the privacy filter must know them
    for (const sysId of ids) {
      // eslint-disable-next-line no-await-in-loop -- four small reads at most, kept sequential.
      const pack = await readContextPack({ table: 'kb_knowledge', sysId }, deps, { feature: 'kb-merge-draft', includeJournal: false });
      articles.push({
        sysId,
        number: pack.number,
        title: pack.fields.short_description || '',
        text: pack.fields.text || '',
        meta: pack.fields.meta || '',
        knowledgeBase: pack.fields.kb_knowledge_base || '',
        category: pack.fields.kb_category || '',
      });
      access.push(...pack.access.filter((a) => a.status !== 'ok'));
      for (const person of pack.people) people.set(person.sysId || person.name.toLowerCase(), person);
    }
    return { articles, people: [...people.values()], pairs: pairwiseText(articles), access };
  },

  /**
   * "Articles to write": recently resolved incidents / cases, minus the ones that have an article, grouped by wording.
   * At most 500 tickets, only short description, category, CI and the length of the resolution notes are kept.
   */
  kbGaps: async (args, { deps }) => {
    const days = Math.floor(boundedNumber(args?.days, 1, GAP_MAX_DAYS, 60));
    const asked = args?.tables === undefined ? ['incident'] : args.tables;
    const tables = Array.isArray(asked) ? asked.filter((t) => typeof t === 'string' && Object.hasOwn(GAP_TABLES, t)) : [];
    if (!tables.length) throw new Error('Choose incidents or cases.');

    const memo = new Map();
    const read = await readResolvedTickets({ days, tables }, deps, { now: Date.now(), memo });
    const links = read.tickets.length ? await readArticleLinks(read.tickets.map((t) => t.sysId), deps, { memo }) : { linked: new Set(), known: false, sources: [], access: [] };
    const radar = buildGapRadar({ tickets: read.tickets, linked: links.linked, linkKnown: links.known });
    return {
      ...radar,
      days: read.days,
      scanned: read.tickets.length,
      truncated: read.truncated,
      link: { known: links.known, sources: links.sources },
      access: [...read.access, ...links.access],
    };
  },
};
