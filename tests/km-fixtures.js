// Fixtures for the knowledge manager's tests of wave 6: a published knowledge base of any size (newest = highest number), and a
// fake content script that answers the Knowledge screen's reads from it through the real operations. Not a test file: tests/run.js
// only runs *.test.js.
import knowledgeOps from '../src/content/ops/knowledge.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { KB_IT, id } from './knowledge-fixtures.js';

export const CAT_VPN = id(0xa01);
export const CAT_MAIL = id(0xa02);

/**
 * n published articles of KB_IT, changed one minute apart (the newest has the highest number). Every third is in the category Email,
 * the rest in VPN. `titles` maps a number to a title (to plant near-duplicates); every other title has its own words, so none read alike.
 */
export function kbBase(n, { same = false, titles = {} } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    sys_id: v(id(0x3000 + i)),
    number: v(`KB${String(1000000 + i)}`),
    short_description: v(titles[i] || `Topic${i.toString(36)}z notes ${i}`),
    workflow_state: v('published', 'Published'),
    kb_knowledge_base: v(KB_IT, 'IT Knowledge Base'),
    kb_category: i % 3 === 0 ? v(CAT_MAIL, 'Email') : v(CAT_VPN, 'VPN'),
    sys_updated_on: v(same ? '2026-09-01 08:00:00' : `2026-09-${String(1 + Math.floor(i / 1440) % 28).padStart(2, '0')} ${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
    sys_view_count: v(String(1 + (i % 7))),
  }));
}

const group = (field, value, name, count) => ({ stats: { count: String(count) }, groupby_fields: [{ field, value, display_value: name }] });

/** The deps of a knowledge base of `rows`: the Aggregate API answers with the knowledge base and its two categories. */
export function kbDeps(rows, behaviour) {
  const deps = fakeDeps({ kb_knowledge: rows }, behaviour);
  const inCategory = (cat) => rows.filter((r) => r.kb_category.value === cat).length;
  deps.countByColumn = async (table, query, column) =>
    column === 'kb_category'
      ? [group('kb_category', CAT_VPN, 'VPN', inCategory(CAT_VPN)), group('kb_category', CAT_MAIL, 'Email', inCategory(CAT_MAIL))].filter((g) => Number(g.stats.count) > 0)
      : [group('kb_knowledge_base', KB_IT, 'IT Knowledge Base', rows.length)];
  return deps;
}

/** Make a fake content script (tests/fixtures/panel-dom.js makeChrome) answer kbScopes and kbDuplicates from `deps`, through the real operations. */
export function answerFrom(fake, deps) {
  fake.onRead('kbScopes', (args) => knowledgeOps.kbScopes(args, { deps }));
  fake.onRead('kbDuplicates', (args) => knowledgeOps.kbDuplicates(args, { deps }));
}

export { KB_IT };
