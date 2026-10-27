// The parts (untrusted data for the firewall) and the packs of the three knowledge AI features, built from plain data.
// A part is { label, field, text }: the label is fixed trusted wording, the text is data and is masked by the firewall.
// Names, when there are any, appear only inside part text. Pure.

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
};

const ZERO_ID = '0'.repeat(32);

function add(parts, label, field, text, max = 6000) {
  const value = clip(text, max);
  if (value) parts.push({ label, field, text: value });
}

// ---- C5: improve this article --------------------------------------------------------------------------

/** The article on screen: title, text, keywords, category, format and dates. The field names are the columns they came from. */
export function articleParts(pack) {
  const f = pack?.fields || {};
  const parts = [];
  add(parts, 'Article title', 'short_description', f.short_description, 300);
  add(parts, 'Article text (plain text made from the HTML, so headings and formatting are gone)', 'text', f.text);
  add(parts, 'Search keywords', 'meta', f.meta, 500);
  add(parts, 'Category', 'kb_category', f.kb_category, 200);
  add(parts, 'Article format', 'article_type', f.article_type, 40);
  add(parts, 'First published', 'published', f.published, 40);
  add(parts, 'Valid until', 'valid_to', f.valid_to, 40);
  add(parts, 'Last changed', 'sys_updated_on', f.sys_updated_on, 40);
  return parts;
}

// ---- C6: merge near-duplicate articles ----------------------------------------------------------------------

export const MERGE_MAX_ARTICLES = 4;
export const MERGE_TEXT_CHARS = 3500;

/** 2 to 4 articles, each with its number and title and its text. The KB number leads each title so the answer can name it. */
export function mergeParts(pack) {
  const articles = (pack?.related?.articles || []).slice(0, MERGE_MAX_ARTICLES);
  const parts = [];
  articles.forEach((a, i) => {
    add(parts, `Article ${i + 1} title`, 'short_description', `${a.number}: ${a.title}`, 400);
    add(parts, `Article ${i + 1} text`, 'text', a.text, MERGE_TEXT_CHARS);
    add(parts, `Article ${i + 1} keywords`, 'meta', a.meta, 400);
  });
  return parts;
}

/** A ContextPack-shaped object for the merge draft. Published content: no people, no notes. */
export function mergePack(articles, access = []) {
  const picked = (articles || []).slice(0, MERGE_MAX_ARTICLES).map((a) => ({ number: a.number, title: a.title, text: a.text, meta: a.meta || '' }));
  const first = articles?.[0] || {};
  return {
    version: 1,
    table: 'kb_knowledge',
    sysId: first.sysId || ZERO_ID,
    number: first.number || '',
    kind: 'knowledge',
    fields: {},
    people: [],
    journal: [],
    related: { articles: picked },
    access,
  };
}

// ---- C7: outline an article for a gap -------------------------------------------------------------------------

/**
 * What the outline is based on: the words the tickets share, how many there were, category and CI. Deliberately NOT the ticket
 * titles: a title can name a person, and the firewall can only mask names it was told about.
 */
export function gapParts(pack) {
  const g = pack?.related?.gap || {};
  const parts = [];
  add(parts, 'Topic (words the tickets share)', 'short_description', g.label, 200);
  add(parts, 'Volume', 'volume', g.volume, 200);
  add(parts, 'Category', 'category', g.category, 100);
  add(parts, 'Configuration item', 'cmdb_ci', g.ci, 100);
  return parts;
}

/** A ContextPack-shaped object for one cluster of the radar (cluster as built by src/knowledge/gaps.js). */
export function gapPack(cluster, { days = 60 } = {}) {
  const example = cluster?.examples?.[0] || {};
  const tickets = cluster.count === 1 ? 'ticket' : 'tickets';
  return {
    version: 1,
    table: cluster?.tables?.[0] || 'incident',
    sysId: example.sysId || ZERO_ID,
    number: example.number || '',
    kind: 'other',
    fields: {},
    people: [],
    journal: [],
    related: {
      gap: {
        label: cluster.label || '',
        volume: `${cluster.count} resolved ${tickets} in the last ${days} days, ${cluster.withFix} with written resolution notes`,
        category: cluster.category || '',
        ci: cluster.ci || '',
      },
    },
    access: [],
  };
}
