import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featureById, featuresFor, insertsFor } from '../src/features/registry.js';
import { FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { kindForTable, KINDS } from '../src/context/kinds.js';
import { normalizePolicy } from '../src/policy/policy.js';
import { destinationNote } from '../src/checks/requestView.js';

// Integration review M6: a feature must not be offered on a kind of record where it cannot do what its button says. The ceiling
// (FIELDS_BY_KIND) is what a record of that kind may ever be read for, so a feature whose insert goes into a column the ceiling
// does not have, on a kind it lists, is promising something the form may not have.

// Insert fields that are legitimately not on a ceiling, and why. Anything else must be on the ceiling of every kind the feature lists.
const JOURNAL_FIELDS = {
  comments: 'the customer-visible journal ("Additional comments"): written through the form, read through the journal, never a column of the record',
  work_notes: 'the internal journal ("Work notes"): the same',
};
// "feature:kind" -> why that pair is fine although the ceiling lacks the column. Empty today; an entry needs a reason a reviewer can read.
const KNOWN_EXCEPTIONS = {};

const ceilingOf = (kind) => new Set(FIELDS_BY_KIND[kind] || []);

/** Every place a feature's inserts do not fit the kinds it is listed for. */
function problemsOf(features) {
  const problems = [];
  for (const f of features) {
    for (const spec of insertsFor(f)) {
      // An insert that names the form it belongs to (an article's title and body) is judged against THAT form's kind.
      const target = spec.table ? [kindForTable(spec.table)] : f.kinds || [];
      for (const kind of target) {
        const fine = JOURNAL_FIELDS[spec.field] || ceilingOf(kind).has(spec.field) || KNOWN_EXCEPTIONS[`${f.id}:${kind}`];
        if (!fine) problems.push(`${f.id} inserts into ${spec.field}, which ${kind} records do not have on their ceiling`);
      }
    }
  }
  return problems;
}

test('every kind a feature lists exists in the ceiling table', () => {
  for (const f of FEATURES) for (const kind of f.kinds || []) assert.ok(KINDS.includes(kind) && FIELDS_BY_KIND[kind], `${f.id} lists unknown kind ${kind}`);
});

test('every insert of a feature goes into a column the ceiling of each kind it lists has (or a journal field)', () => {
  assert.deepEqual(problemsOf(FEATURES), []);
});

test('the check itself works: the offers the review found are reported', () => {
  const notes = featureById('resolution-notes');
  assert.deepEqual(problemsOf([{ ...notes, kinds: [...notes.kinds, 'request'] }]), ['resolution-notes inserts into close_notes, which request records do not have on their ceiling']);
  // the article inserts are judged against the article form, wherever they are offered
  assert.deepEqual(problemsOf([{ ...featureById('kb-article-draft'), kinds: ['request'] }]), []);
  assert.deepEqual(problemsOf([{ id: 'x', kinds: ['incident'], insert: { field: 'impact_text', label: 'x' } }]), ['x inserts into impact_text, which incident records do not have on their ceiling']);
});

test('the exceptions table is not stale', () => {
  for (const [name, reason] of Object.entries(JOURNAL_FIELDS)) assert.ok(reason.length > 20, `${name} needs a reason`);
  for (const [key, reason] of Object.entries(KNOWN_EXCEPTIONS)) {
    const [id, kind] = key.split(':');
    const f = featureById(id);
    assert.ok(f && f.kinds.includes(kind), `${key}: no longer a feature/kind pair`);
    assert.ok(reason.length > 20, `${key} needs a reason`);
    assert.ok(insertsFor(f).some((spec) => !JOURNAL_FIELDS[spec.field] && !ceilingOf(kind).has(spec.field)), `${key}: the ceiling now has the column, delete the exception`);
  }
});

test('routing-hint is offered where category and assignment group are on the ceiling, and resolution-notes where close_notes is', () => {
  for (const kind of featureById('routing-hint').kinds) {
    assert.ok(ceilingOf(kind).has('category') && ceilingOf(kind).has('assignment_group'), `routing-hint on ${kind}`);
  }
  assert.deepEqual(featureById('routing-hint').kinds, ['incident', 'case']);
  for (const kind of featureById('resolution-notes').kinds) assert.ok(ceilingOf(kind).has('close_notes'), `resolution-notes on ${kind}`);
  assert.ok(!featureById('resolution-notes').kinds.includes('request'));
  const policy = normalizePolicy({});
  assert.ok(!featuresFor('request', policy).some((f) => f.id === 'routing-hint' || f.id === 'resolution-notes'));
  assert.ok(featuresFor('incident', policy).some((f) => f.id === 'routing-hint'));
  assert.ok(featuresFor('requested_item', policy).some((f) => f.id === 'resolution-notes'));
});

test('a catalog task says where the message for the requester goes; other kinds say nothing extra', () => {
  assert.equal(destinationNote({ kind: 'catalog_task' }), "This goes into the task's comments.");
  for (const kind of ['request', 'requested_item', 'incident']) assert.equal(destinationNote({ kind }), '');
  assert.equal(destinationNote(null), '');
});
