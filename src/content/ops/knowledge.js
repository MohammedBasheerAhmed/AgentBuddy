// READ operations for the Knowledge tools (see src/content/ops/index.js). All of them are GET-only through the context engine
// and are bounded; the panel's arguments are validated here as well. Names start with "kb" so they cannot collide with the
// operations in src/content/reads.js ('knowledge', 'duplicates', ...) or another area's.
import { readContextPack } from '../../context/pack.js';
import {
  GAP_MAX_DAYS, GAP_TABLES, KB_MAX_OFFSET, cleanCategory, readArticleLinks, readGapCategories, readKnowledgeList, readKnowledgeScopes, readMyGroups,
  readResolvedTickets, searchKnowledgeText,
} from '../../context/knowledge.js';
import { STATUS, entry as accessEntry, tm } from '../../context/access.js';
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

// A count the panel passes back is only ever shown and compared with a window, never put into a read: still bounded.
const MAX_COUNT = 10000000;

function boundedNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const tablesOf = (asked) => {
  const list = asked === undefined ? ['incident'] : asked;
  const tables = Array.isArray(list) ? list.filter((t) => typeof t === 'string' && Object.hasOwn(GAP_TABLES, t)) : [];
  if (!tables.length) throw new Error(tm('Choose incidents or cases.'));
  return [...new Set(tables)];
};

// The radar's scope as the panel asks for it: 'all' (default), 'mine' (my groups) or 'category' with a choice value.
function scopeOf(args) {
  const kind = args?.scope === undefined ? 'all' : args.scope;
  if (kind === 'all' || kind === 'mine') return { kind };
  if (kind === 'category') {
    const category = cleanCategory(args?.category);
    if (!category) throw new Error('That is not a category Agent Buddy can look for.');
    return { kind, category };
  }
  throw new Error('That is not a scope Agent Buddy knows.');
}

export default {
  /** The knowledge bases (or, for one base, its categories) that hold published articles, with counts. */
  kbScopes: async (args, { deps }) => readKnowledgeScopes({ knowledgeBase: optionalId(args?.knowledgeBase, 'knowledge base') }, deps, { memo: new Map() }),

  /**
   * Knowledge search (N23): published articles that match the words typed, ranked like the ticket's "Knowledge that may help".
   * The words are reduced to plain keywords (or one article number) before anything is asked; the text read is cut to a short
   * excerpt at once.
   */
  kbSearch: async (args, { deps }) => {
    const query = typeof args?.query === 'string' ? args.query.slice(0, 200) : '';
    if (!query.trim()) throw new Error(tm('Type a few words to search for.'));
    return searchKnowledgeText({ query }, deps, { now: Date.now(), memo: new Map() });
  },

  /**
   * Published articles of one knowledge base / category, 300 titles at a time (`offset` pages on: 0, 300, 600 ...), and the groups
   * among them whose titles read alike. Titles and counts only. The panel keeps the pages it read and compares them all together.
   * `total` (optional) is the count the first page answered with: a later page passes it back so the scope is counted once.
   * Answers `total` (how many articles the scope holds; null when it could not be counted), `truncated` (more follow) and `next` (the
   * offset to ask for them; null when there are none or one scan cannot go further).
   */
  kbDuplicates: async (args, { deps }) => {
    const knowledgeBase = optionalId(args?.knowledgeBase, 'knowledge base');
    const category = optionalId(args?.category, 'category');
    if (!knowledgeBase && !category) throw new Error(tm('Choose a knowledge base or a category first.'));
    const threshold = boundedNumber(args?.threshold, 0.4, 0.9, DUPLICATE_THRESHOLD);
    const offset = Math.floor(boundedNumber(args?.offset, 0, KB_MAX_OFFSET, 0));
    const total = Number.isInteger(args?.total) && args.total >= 0 ? Math.min(args.total, MAX_COUNT) : undefined;
    const list = await readKnowledgeList({ knowledgeBase, category, offset, total }, deps, { memo: new Map() });
    return {
      scanned: list.articles.length,
      total: list.total,
      truncated: list.truncated,
      next: list.next,
      offset: list.offset,
      threshold,
      articles: list.articles,
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
    const tables = tablesOf(args?.tables);
    const scope = scopeOf(args);

    const memo = new Map();
    let groups = null;
    const scopeAccess = [];
    if (scope.kind === 'mine') {
      const mine = await readMyGroups(deps);
      scopeAccess.push(...mine.access.filter((a) => a.status !== STATUS.OK));
      groups = mine.groups;
      if (!groups.length) {
        return {
          ...buildGapRadar({ tickets: [] }),
          days,
          scanned: 0,
          total: 0,
          truncated: false,
          scope: { kind: 'mine', groups: 0 },
          link: { known: false, sources: [] },
          access: scopeAccess.length ? scopeAccess : [accessEntry('sys_user_grmember', STATUS.EMPTY, tm('You are not a member of any group that you can see.'))],
        };
      }
    }
    const readScope = scope.kind === 'mine' ? { groups: groups.map((g) => g.id) } : scope.kind === 'category' ? { category: scope.category } : null;
    const read = await readResolvedTickets({ days, tables, scope: readScope }, deps, { now: Date.now(), memo });
    const links = read.tickets.length ? await readArticleLinks(read.tickets.map((t) => t.sysId), deps, { memo }) : { linked: new Set(), known: false, sources: [], access: [] };
    const radar = buildGapRadar({ tickets: read.tickets, linked: links.linked, linkKnown: links.known });
    return {
      ...radar,
      days: read.days,
      scanned: read.tickets.length,
      total: read.total,
      truncated: read.truncated,
      scope: scope.kind === 'mine' ? { kind: 'mine', groups: groups.length } : scope.kind === 'category' ? { kind: 'category', category: scope.category } : { kind: 'all' },
      link: { known: links.known, sources: links.sources },
      access: [...scopeAccess, ...read.access, ...links.access],
    };
  },

  /**
   * What the radar's scope picker offers: the categories of the tickets resolved in the window, with how many each, plus the total.
   * Counts and names only, no ticket is transferred. The person's groups are read only when "My groups" is used (kbGaps).
   */
  kbGapScopes: async (args, { deps }) => {
    const days = Math.floor(boundedNumber(args?.days, 1, GAP_MAX_DAYS, 60));
    const tables = tablesOf(args?.tables);
    const counts = await readGapCategories({ days, tables }, deps, { now: Date.now() });
    return { days, total: counts.total, categories: counts.categories, access: counts.access };
  },
};
