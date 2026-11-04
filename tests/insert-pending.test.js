import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_AGE_MS, clearPending, getPending, originOf, pendingFits, setPending } from '../src/sidepanel/pendingDraft.js';
import PendingDraft from '../src/sidepanel/PendingDraft.jsx';
import { featureById } from '../src/features/registry.js';

// AB-SEC-17: the draft carried to a blank form belongs to one site, lasts 15 minutes, and goes after it is used or closed.

const ORIGIN = 'https://acme.service-now.com';
const feature = featureById('kb-article-draft');
const blankArticle = (href = `${ORIGIN}/kb_knowledge.do?sys_id=-1`) => ({ href, tabId: 3, newRecord: { table: 'kb_knowledge', kind: 'knowledge' }, record: null });
const draft = (over = {}) => ({ feature, text: 'Title: How to reset\nSymptoms: x', people: [], scan: () => [], origin: ORIGIN, ...over });

test('the origin is the site of the page, https only', () => {
  assert.equal(originOf(`${ORIGIN}/incident.do?sys_id=1`), ORIGIN);
  assert.equal(originOf('https://ACME.service-now.com:8443/x'), 'https://acme.service-now.com:8443');
  for (const bad of ['http://acme.service-now.com/', 'chrome-extension://abc/x.html', 'about:blank', 'not a url', '', undefined, null]) assert.equal(originOf(bad), '', String(bad));
});

test('a draft without a site to bind it to is not kept', () => {
  clearPending();
  assert.equal(setPending(draft({ origin: '' })), false);
  assert.equal(setPending(draft({ origin: undefined })), false);
  assert.equal(setPending(draft({ origin: 'http://acme.service-now.com' })), false);
  assert.equal(setPending(null), false);
  assert.equal(getPending(), null);
});

test('it is shown only on the site it came from, on a blank form of the table the feature names', () => {
  clearPending();
  assert.equal(setPending(draft()), true);
  const d = getPending();
  assert.equal(d.origin, ORIGIN);
  assert.equal(pendingFits(d, blankArticle()), true);
  // another customer's instance, another site, a look-alike host
  assert.equal(pendingFits(d, blankArticle('https://other.service-now.com/kb_knowledge.do?sys_id=-1')), false);
  assert.equal(pendingFits(d, blankArticle('https://acme.service-now.com.evil.example/kb_knowledge.do')), false);
  assert.equal(pendingFits(d, blankArticle('http://acme.service-now.com/kb_knowledge.do')), false);
  // a blank form of another table, an open record, no form
  assert.equal(pendingFits(d, { ...blankArticle(), newRecord: { table: 'incident' } }), false);
  assert.equal(pendingFits(d, { ...blankArticle(), newRecord: null, record: { table: 'kb_knowledge', sysId: 'a'.repeat(32) } }), false);
  assert.equal(pendingFits(d, { href: `${ORIGIN}/` }), false);
  assert.equal(pendingFits(null, blankArticle()), false);
  assert.equal(pendingFits({ ...d, origin: '' }, blankArticle()), false);
  assert.equal(pendingFits({ ...d, feature: { id: 'x' } }, blankArticle()), false, 'a feature without an open form has nowhere to go');
  clearPending();
});

test('it expires after fifteen minutes', () => {
  clearPending();
  setPending(draft());
  const at = getPending().at;
  assert.equal(MAX_AGE_MS, 15 * 60 * 1000);
  assert.ok(getPending(at + MAX_AGE_MS - 1000), 'still there just before');
  assert.equal(getPending(at + MAX_AGE_MS + 1), null, 'gone after');
  assert.equal(getPending(), null, 'and it stays gone: the memory (text, firewall map) was released');
});

test('closing it, or a new draft, replaces it; clearing twice is harmless', () => {
  clearPending();
  setPending(draft({ text: 'first' }));
  setPending(draft({ text: 'second' }));
  assert.equal(getPending().text, 'second');
  clearPending();
  assert.equal(getPending(), null);
  clearPending();
  assert.equal(getPending(), null);
  // a refused draft also drops the old one: nothing stale stays behind
  setPending(draft({ text: 'old' }));
  setPending(draft({ origin: '' }));
  assert.equal(getPending(), null);
});

test('the card shows on the right page with the same Insert / Copy buttons, and nowhere else', () => {
  clearPending();
  const card = (page) => renderToStaticMarkup(React.createElement(PendingDraft, { page }));
  setPending(draft());
  const shown = card(blankArticle());
  assert.match(shown, /Draft a knowledge article/);
  assert.match(shown, /Insert title into the article form/);
  assert.match(shown, /Insert body into the article form/);
  assert.match(shown, />Copy</);
  assert.match(shown, />Close</);
  // the draft is not offered on another site, nor on a form of another table
  assert.equal(card(blankArticle('https://other.service-now.com/kb_knowledge.do?sys_id=-1')), '');
  assert.equal(card({ ...blankArticle(), newRecord: { table: 'incident' } }), '');
  clearPending();
  assert.equal(card(blankArticle()), '', 'nothing once it is cleared');
});

// Found by the end-to-end run: a carried article draft offers a title AND a body, and it was dropped after the first insert, so the
// body could never be inserted from it.
test('a draft is used up only when every insert it offers has gone in', async () => {
  const { afterInsert } = await import('../src/sidepanel/pendingDraft.js');
  const article = featureById('kb-article-draft');
  const title = { field: 'short_description' };
  const body = { field: 'text' };
  let step = afterInsert([], title, article);
  assert.deepEqual(step, { done: ['short_description'], complete: false }, 'after the title the body is still to come');
  step = afterInsert(step.done, title, article);
  assert.deepEqual(step, { done: ['short_description'], complete: false }, 'the same insert twice counts once');
  step = afterInsert(step.done, body, article);
  assert.deepEqual(step, { done: ['short_description', 'text'], complete: true }, 'title and body: used up');
  // one insert only (or a different order): complete as soon as that one is in
  assert.equal(afterInsert([], { field: 'work_notes' }, { insert: { field: 'work_notes' } }).complete, true);
  assert.equal(afterInsert(['text'], title, article).complete, true);
  // a feature with no inserts is used up at once; odd input never throws
  assert.equal(afterInsert([], title, { id: 'x' }).complete, true);
  assert.deepEqual(afterInsert([], null, null), { done: [], complete: true });
});
