import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, contextFor, featureById, featuresFor, insertsFor, partsFor } from '../src/features/registry.js';
import { FEATURES as SPEC_IDS, FEATURE_FIELDS, FEATURE_JOURNAL, FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { KINDS } from '../src/context/kinds.js';
import { detect } from '../src/pii/index.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { sectionOf, sectionOrAll } from '../src/knowledge/sections.js';
import { articleParts, gapPack, gapParts, mergePack, mergeParts } from '../src/knowledge/parts.js';
import { toPlainText, parseSafeText } from '../src/render/safeText.js';
import { POOR_PACK } from './knowledge-fixtures.js';

const MINE = ['article-optimise', 'kb-merge-draft', 'kb-gap-outline', 'chat-summary', 'chat-reply'];
const f = (id) => featureById(id);
const policy = normalizePolicy({});

// ---- the contract ---------------------------------------------------------------------------------------------------

test('feature ids are unique across ALL packs, and mine are all registered', () => {
  const ids = FEATURES.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
  for (const id of MINE) assert.ok(ids.includes(id), id);
});

test('kinds are real record kinds or []: the article and chat features list their kind, the Knowledge tab runs the other two', () => {
  for (const id of MINE) for (const kind of f(id).kinds) assert.ok(KINDS.includes(kind), `${id}: ${kind}`);
  assert.deepEqual(f('article-optimise').kinds, ['knowledge']);
  assert.deepEqual(f('chat-summary').kinds, ['chat']);
  assert.deepEqual(f('chat-reply').kinds, ['chat']);
  assert.deepEqual(f('kb-merge-draft').kinds, []);
  assert.deepEqual(f('kb-gap-outline').kinds, []);
  assert.deepEqual(featuresFor('knowledge', policy).map((x) => x.id).filter((id) => MINE.includes(id)), ['article-optimise']);
  assert.deepEqual(featuresFor('chat', policy).map((x) => x.id).filter((id) => MINE.includes(id)).sort(), ['chat-reply', 'chat-summary']);
  for (const kind of KINDS.filter((k) => !['knowledge', 'chat'].includes(k))) {
    assert.ok(!featuresFor(kind, policy).some((x) => MINE.includes(x.id)), `${kind} must not offer a knowledge or chat feature`);
  }
});

test('each feature has a title, a description, a wave, a prompt, an instruction and a context spec that exists', () => {
  for (const id of MINE) {
    const feature = f(id);
    assert.ok(feature.title && feature.description, id);
    assert.ok([1, 2, 3].includes(feature.wave), id);
    assert.ok(feature.system.length > 200 && feature.instruction.length > 10, id);
    assert.ok(SPEC_IDS.includes(contextFor(feature)), `${id}: spec "${contextFor(feature)}"`);
    assert.equal(typeof feature.parts, 'function', `${id} builds its parts itself`);
  }
});

test('columns: every spec list stays inside the display ceiling, with the record number', () => {
  for (const id of [...MINE, 'article-check']) {
    for (const kind of KINDS) {
      const list = FEATURE_FIELDS[contextFor(f(id) || { id })][kind];
      for (const name of list) assert.ok(FIELDS_BY_KIND[kind].includes(name), `${id}/${kind}: ${name}`);
      assert.ok(list.includes('number'), `${id}/${kind}`);
    }
  }
  assert.equal(FEATURE_JOURNAL['chat-summary'], true);
  assert.equal(FEATURE_JOURNAL['chat-reply'], true);
  for (const id of ['article-check', 'article-optimise', 'kb-merge-draft', 'kb-gap-outline']) assert.equal(FEATURE_JOURNAL[id], false, id);
});

test('prompts are fixed text: no template holes, no ids, no ticket numbers, nothing the detectors find, and they talk about "the data"', () => {
  for (const id of MINE) {
    const text = `${f(id).system}\n${f(id).instruction}`;
    assert.ok(!/\{\{|\$\{|\}\}/.test(text), `${id}: template hole`);
    assert.deepEqual(detect(text), [], `${id}: the detectors find personal data in the prompt`);
    assert.ok(!/[0-9a-f]{32}/i.test(text), `${id}: an id in the prompt`);
    assert.ok(!/\b(?:INC|REQ|RITM|SCTASK|CHG|PRB)\d{5,}/.test(text), `${id}: a ticket number`);
    assert.match(f(id).system, /the data/i, id);
  }
});

test('each prompt asks for exactly the headings the brief names', () => {
  const has = (id, ...parts) => parts.forEach((p) => assert.ok(f(id).system.includes(p), `${id}: ${p}`));
  has('article-optimise', 'Title:', 'Keywords:', 'Structure:', 'Clarity:', 'Missing:', 'Looks outdated:');
  has('kb-merge-draft', 'Merged title:', 'Merged article:', 'Retire:', 'What changed:');
  has('kb-gap-outline', 'Suggested title:', 'Outline:', 'Facts to collect first:');
  has('chat-summary', 'Summary:', 'Outcome:', 'Follow-ups:', 'Suggested ticket notes:');
  has('chat-reply', 'numbered 1 to 3', 'Never promise');
  assert.match(f('chat-reply').system, /most recent message/);
  assert.match(f('article-optimise').system, /Do not invent/);
  assert.match(f('kb-merge-draft').system, /Never invent/);
});

test('published content stays masked (keepMasked); the agent\'s own chat helpers get real names back', () => {
  assert.equal(f('kb-merge-draft').keepMasked, true);
  assert.equal(f('kb-gap-outline').keepMasked, true);
  assert.ok(!f('chat-summary').keepMasked && !f('chat-reply').keepMasked && !f('article-optimise').keepMasked);
});

test('inserts: only the chat summary inserts (its ticket notes, into work notes); everything else is Copy only', () => {
  for (const id of ['article-optimise', 'kb-merge-draft', 'kb-gap-outline', 'chat-reply']) assert.deepEqual(insertsFor(f(id)), [], id);
  const [insert] = insertsFor(f('chat-summary'));
  assert.equal(insert.field, 'work_notes');
  assert.ok(insert.label && insert.fieldLabel);
  assert.equal(typeof insert.pick, 'function');
  const answer = 'Summary: Customer could not connect.\n\nOutcome: Resolved\n\nFollow-ups: None\n\nSuggested ticket notes:\nIssue: VPN\nFix: reset profile\nNext: none';
  assert.equal(insert.pick(answer), 'Issue: VPN\nFix: reset profile\nNext: none');
  assert.equal(insert.pick('The model ignored the format.'), 'The model ignored the format.', 'an answer without the heading is still usable');
});

test('the picked notes survive the safe-text round trip the result view does', () => {
  const markdown = '**Summary:** Fine.\n\n**Suggested ticket notes:**\n- Issue: VPN\n- Fix: reset';
  const plain = toPlainText(parseSafeText(markdown));
  assert.match(f('chat-summary').insert.pick(plain), /^- Issue: VPN\n- Fix: reset$/);
});

// ---- sections -----------------------------------------------------------------------------------------------------------

test('sectionOf: finds a heading in the usual shapes and stops at the next one', () => {
  const H = ['Summary', 'Outcome', 'Notes'];
  assert.equal(sectionOf('Summary: one\nmore\nOutcome: two', 'Summary', H), 'one\nmore');
  assert.equal(sectionOf('**Summary:** one\n**Outcome:** two', 'Summary', H), 'one');
  assert.equal(sectionOf('## Summary\nline a\nline b\n## Outcome\nx', 'Summary', H), 'line a\nline b');
  assert.equal(sectionOf('1. Summary: first\n2. Outcome: second', 'Outcome', H), 'second');
  assert.equal(sectionOf('summary: lower case works', 'Summary', H), 'lower case works');
  assert.equal(sectionOf('Outcome: x\nNotes:\n- a\n- b', 'Notes', H), '- a\n- b');
});

test('sectionOf: a sentence that merely starts with the heading word is not a heading, and a missing heading gives ""', () => {
  assert.equal(sectionOf('Summary of the call was short.\nOutcome: x', 'Summary', ['Outcome']), '');
  assert.equal(sectionOf('nothing here', 'Summary'), '');
  assert.equal(sectionOf('', 'Summary'), '');
  assert.equal(sectionOf(undefined, 'Summary'), '');
  assert.equal(sectionOrAll('free text', 'Summary'), 'free text');
  assert.equal(sectionOrAll('Summary: s', 'Summary'), 's');
  assert.equal(sectionOf('Summary: (a+b)*c? [x] ^$', 'Summary'), '(a+b)*c? [x] ^$', 'text with regex characters is safe');
  assert.equal(sectionOf('Wei(rd): x', 'Wei(rd)'), 'x', 'a heading with regex characters is safe');
});

// ---- parts ---------------------------------------------------------------------------------------------------------------

test('article parts carry title, text, keywords, category, format and dates, in fixed wording, and nothing else', () => {
  const parts = partsFor(f('article-optimise'), {
    fields: { short_description: 'Reset VPN', text: 'Body', meta: 'vpn', kb_category: 'VPN', article_type: 'html', published: '2026-01-10', valid_to: '2027-01-01', sys_updated_on: '2026-10-01 09:00:00', sys_view_count: '99', workflow_state: 'Published' },
  });
  assert.deepEqual(parts.map((p) => p.field), ['short_description', 'text', 'meta', 'kb_category', 'article_type', 'published', 'valid_to', 'sys_updated_on']);
  assert.ok(!JSON.stringify(parts).includes('99'), 'the view count is not sent');
  assert.deepEqual(articleParts({ fields: {} }), []);
  assert.deepEqual(articleParts(undefined), []);
  assert.equal(articleParts(POOR_PACK)[0].text, 'VPN');
});

test('merge parts: two to four articles, each with its KB number leading the title, long texts clipped', () => {
  const articles = Array.from({ length: 6 }, (_, i) => ({ sysId: `s${i}`, number: `KB000${i}`, title: `Title ${i}`, text: 'x'.repeat(5000), meta: i ? '' : 'a, b' }));
  const pack = mergePack(articles);
  assert.equal(pack.related.articles.length, 4, 'at most four');
  assert.equal(pack.table, 'kb_knowledge');
  assert.equal(pack.sysId, 's0');
  assert.equal(pack.number, 'KB0000');
  assert.deepEqual(pack.people, []);
  assert.deepEqual(pack.journal, []);
  const parts = mergeParts(pack);
  assert.equal(parts[0].text, 'KB0000: Title 0');
  assert.equal(parts[1].label, 'Article 1 text');
  assert.ok(parts[1].text.length <= 3500, 'clipped');
  assert.equal(parts.filter((p) => p.field === 'meta').length, 1, 'only the article that has keywords');
});

test('gap parts: the topic words, volume, category and CI; never ticket titles or numbers', () => {
  const cluster = { label: 'vpn + disconnecting', count: 3, withFix: 2, category: 'Network', ci: 'VPN Gateway EU', tables: ['incident'], examples: [{ table: 'incident', sysId: 'a'.repeat(32), number: 'INC0000001', title: 'VPN keeps disconnecting for Abel Tuter' }] };
  const pack = gapPack(cluster, { days: 60 });
  assert.equal(pack.table, 'incident');
  assert.equal(pack.sysId, 'a'.repeat(32));
  assert.equal(pack.kind, 'other');
  const parts = gapParts(pack);
  assert.deepEqual(parts.map((p) => p.label), ['Topic words', 'Volume', 'Category', 'Configuration item']);
  assert.equal(parts[1].text, '3 resolved tickets in the last 60 days, 2 with written resolution notes');
  const sent = JSON.stringify(parts);
  assert.ok(!sent.includes('Abel') && !sent.includes('INC0000001') && !sent.includes('keeps'), 'no ticket text');
  assert.match(gapPack({ ...cluster, count: 1 }).related.gap.volume, /^1 resolved ticket in/);
  assert.equal(gapPack({ label: 'x', count: 1, withFix: 0, tables: [], examples: [] }).table, 'incident');
});
