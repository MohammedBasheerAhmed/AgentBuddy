import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_ANSWER, answerProblem, lastPackOf, makeTokens, needsPreview, previewKeyFor, seenAfterConfirm } from '../src/sidepanel/runLogic.js';
import { internalTextsOf } from '../src/safeSend/review.js';
import { previewRequired } from '../src/lib/pipeline.js';

// The decisions inside useRun that are not about React (integration review T4).

// ---- tokens: a newer run, or a reset, makes an older one still in flight count for nothing ------------------------------------

test('a run that is current may show its answer; a newer run or a reset abandons it', () => {
  const tokens = makeTokens();
  const first = tokens.next();
  assert.equal(tokens.isCurrent(first), true);
  const second = tokens.next();
  assert.equal(tokens.isCurrent(first), false, 'a newer run abandons the older one');
  assert.equal(tokens.isCurrent(second), true);
  tokens.drop(); // Cancel, Close, or another record
  assert.equal(tokens.isCurrent(second), false, 'a reset abandons the run in flight');
});

test('the confirm step reads the current token: a preview confirmed after a reset belongs to nobody', () => {
  const tokens = makeTokens();
  const mine = tokens.next();
  const atConfirm = tokens.current();
  assert.equal(atConfirm, mine);
  tokens.drop();
  assert.equal(tokens.isCurrent(atConfirm), false);
});

test('two sets of tokens do not interfere (two views, two runs)', () => {
  const a = makeTokens();
  const b = makeTokens();
  const ta = a.next();
  b.next();
  b.next();
  assert.equal(a.isCurrent(ta), true);
});

// ---- the preview ------------------------------------------------------------------------------------------------------------

const feature = (over = {}) => ({ id: 'reply-draft', ...over });
const need = (over) => needsPreview({ previewMode: 'first', feature: feature(), pack: {}, seen: [], previewRequired, ...over });

test('always shows it, never does not, first shows it the first time', () => {
  assert.equal(need({ previewMode: 'always', seen: ['reply-draft'] }), true);
  assert.equal(need({ previewMode: 'never' }), false);
  assert.equal(need({ previewMode: 'first', seen: [] }), true);
  assert.equal(need({ previewMode: 'first', seen: ['reply-draft'] }), false);
});

test('SEC-05: a pack that carries other people\'s tickets always gets the preview in "first" mode, but never overrides "never"', () => {
  const reference = { requirePreview: true };
  assert.equal(need({ pack: reference, seen: ['reply-draft'] }), true, 'seen once is not enough when the pack says so');
  assert.equal(need({ pack: reference, previewMode: 'never' }), false, 'the person\'s (or the organisation\'s) choice of "never" stands');
  assert.equal(need({ pack: reference, previewMode: 'always' }), true);
  assert.equal(need({ pack: { requirePreview: false }, seen: ['reply-draft'] }), false);
  assert.equal(need({ pack: { requirePreview: 'yes' }, seen: ['reply-draft'] }), false, 'only the real flag counts');
  assert.equal(need({ pack: undefined, seen: ['reply-draft'] }), false);
});

test('L15: a group of generated features shares one "seen" key; a feature without a group uses its own id', () => {
  assert.equal(previewKeyFor({ id: 'email-status', previewGroup: 'email' }), 'email');
  assert.equal(previewKeyFor({ id: 'rewrite-short', previewGroup: 'rewrite' }), 'rewrite');
  assert.equal(previewKeyFor({ id: 'reply-draft' }), 'reply-draft');
  assert.equal(previewKeyFor(null), '');
  // seeing one email preview covers the other emails, and not the rewrites
  const seen = seenAfterConfirm({ previewMode: 'first', feature: { id: 'email-status', previewGroup: 'email' }, seen: [] });
  assert.deepEqual(seen, ['email']);
  assert.equal(need({ feature: { id: 'email-update', previewGroup: 'email' }, seen }), false);
  assert.equal(need({ feature: { id: 'rewrite-short', previewGroup: 'rewrite' }, seen }), true);
  assert.equal(need({ feature: { id: 'reply-draft' }, seen }), true);
});

test('confirming a preview remembers it only in "first" mode, once, and hands back the same list when nothing changes', () => {
  const seen = ['reply-draft'];
  assert.equal(seenAfterConfirm({ previewMode: 'first', feature: feature(), seen }), seen, 'already there: the same array, so nothing is saved');
  assert.deepEqual(seenAfterConfirm({ previewMode: 'first', feature: feature({ id: 'next-best-action' }), seen }), ['reply-draft', 'next-best-action']);
  assert.equal(seenAfterConfirm({ previewMode: 'always', feature: feature({ id: 'x' }), seen }), seen);
  assert.equal(seenAfterConfirm({ previewMode: 'never', feature: feature({ id: 'x' }), seen }), seen);
  assert.deepEqual(seen, ['reply-draft'], 'the list it was given is not changed');
});

// ---- an answer with nothing in it --------------------------------------------------------------------------------------------

test('L9: an empty or blank answer from the model is an error with a plain message', () => {
  assert.equal(EMPTY_ANSWER, 'The AI sent back nothing. Try again.');
  for (const text of ['', '   ', '\n\n', undefined, null, 5]) assert.equal(answerProblem(text), EMPTY_ANSWER, String(text));
  assert.equal(answerProblem('Cause: the gateway certificate expired.'), '');
  assert.equal(answerProblem(' x '), '');
});

// ---- what a finished run remembers about its pack -----------------------------------------------------------------------------

test('a finished run remembers the record it is for and its work notes (for the Insert check and the check for internal wording)', () => {
  const pack = {
    table: 'incident',
    sysId: 'a'.repeat(32),
    number: 'INC0010001',
    journal: [
      { type: 'comment', by: 'Beth', text: 'Hello Abel' },
      { type: 'work_note', by: 'Beth', text: 'Internal: the finance share is being restructured' },
    ],
  };
  assert.deepEqual(lastPackOf(pack, internalTextsOf), { table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', internalTexts: ['Internal: the finance share is being restructured'] });
  // a text the person pasted has a made-up record and no notes
  assert.deepEqual(lastPackOf({ table: 'compose', sysId: 'b'.repeat(32), journal: [] }, internalTextsOf), { table: 'compose', sysId: 'b'.repeat(32), number: '', internalTexts: [] });
  assert.deepEqual(lastPackOf(null, internalTextsOf), { table: undefined, sysId: undefined, number: '', internalTexts: [] });
  assert.deepEqual(lastPackOf(pack).internalTexts, [], 'without a reader there are no notes');
});
