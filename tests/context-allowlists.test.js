import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES,
  FEATURE_FIELDS,
  FEATURE_JOURNAL,
  FEATURE_RELATED,
  FIELDS_BY_KIND,
  FREE_TEXT_FIELDS,
  HR_HIDDEN,
  LIMITS,
  allowedFields,
  fieldLimit,
  withheldFields,
} from '../src/context/allowlists.js';
import { KINDS } from '../src/context/kinds.js';
import { RELATED_BY_KIND, relatedPlan } from '../src/context/related.js';

test('every kind has a display list and every feature has a list for every kind', () => {
  assert.deepEqual(Object.keys(FIELDS_BY_KIND).sort(), [...KINDS].sort());
  for (const feature of FEATURES) {
    assert.deepEqual(Object.keys(FEATURE_FIELDS[feature]).sort(), [...KINDS].sort(), feature);
  }
});

test('a feature list is a subset of its kind\'s display list, with no duplicates and always the record number', () => {
  for (const feature of FEATURES) {
    for (const kind of KINDS) {
      const list = FEATURE_FIELDS[feature][kind];
      const ceiling = new Set(FIELDS_BY_KIND[kind]);
      assert.equal(new Set(list).size, list.length, `${feature}/${kind} has duplicates`);
      for (const name of list) assert.ok(ceiling.has(name), `${feature}/${kind}: ${name} is not in FIELDS_BY_KIND`);
      assert.ok(list.includes('number'), `${feature}/${kind} lacks number`);
    }
  }
});

test('the lists are frozen so nothing can widen them at run time', () => {
  assert.throws(() => {
    'use strict';
    FIELDS_BY_KIND.incident.push('u_secret');
  });
  assert.throws(() => {
    'use strict';
    FEATURE_FIELDS.similar.incident.push('description');
  });
});

test('notes and comments are never ordinary fields: they have their own switch', () => {
  for (const kind of KINDS) {
    assert.ok(!FIELDS_BY_KIND[kind].includes('comments'));
    assert.ok(!FIELDS_BY_KIND[kind].includes('work_notes'));
  }
  assert.equal(FEATURE_JOURNAL['record-summary'], true);
  assert.equal(FEATURE_JOURNAL.similar, false);
  assert.equal(FEATURE_JOURNAL['kb-recs'], false);
  assert.equal(FEATURE_JOURNAL['caller-history'], false);
});

test('the lists carry what the brief names', () => {
  const incident = FIELDS_BY_KIND.incident;
  for (const name of ['number', 'short_description', 'description', 'state', 'priority', 'impact', 'urgency', 'category', 'subcategory', 'assignment_group', 'assigned_to', 'caller_id', 'opened_by', 'cmdb_ci', 'business_service', 'opened_at', 'sys_updated_on', 'resolved_at', 'close_code', 'close_notes', 'contact_type', 'parent']) {
    assert.ok(incident.includes(name), `incident lacks ${name}`);
  }
  for (const name of ['cat_item', 'request', 'stage', 'due_date']) assert.ok(FIELDS_BY_KIND.requested_item.includes(name), name);
  for (const name of ['account', 'contact', 'product', 'entitlement']) assert.ok(FIELDS_BY_KIND.case.includes(name), name);
  for (const name of ['hr_service', 'subject_person']) assert.ok(FIELDS_BY_KIND.hr_case.includes(name), name);
  for (const name of ['type', 'risk', 'start_date', 'end_date']) assert.ok(FIELDS_BY_KIND.change.includes(name), name);
  for (const name of ['known_error', 'cause_notes']) assert.ok(FIELDS_BY_KIND.problem.includes(name), name);
});

test('features stay minimal: similar and kb-recs read less than the summary', () => {
  assert.ok(FEATURE_FIELDS.similar.incident.length < FEATURE_FIELDS['record-summary'].incident.length);
  assert.ok(!FEATURE_FIELDS.similar.incident.includes('description'));
  assert.ok(!FEATURE_FIELDS.similar.incident.includes('caller_id'));
  assert.ok(FEATURE_FIELDS['caller-history'].incident.includes('caller_id'));
  assert.ok(!FEATURE_FIELDS['kb-recs'].incident.includes('assigned_to'));
  assert.ok(FEATURE_FIELDS['reply-draft'].incident.includes('contact_type'));
  assert.ok(FEATURE_FIELDS['resolution-notes'].problem.includes('fix_notes'));
  assert.ok(FEATURE_FIELDS['missing-info'].requested_item.includes('cat_item'));
});

test('HR-family tables lose free text and identities unless sensitive data is allowed', () => {
  for (const table of ['sn_hr_core_case', 'sn_hr_core_task']) {
    for (const feature of FEATURES) {
      const minimal = allowedFields(table, feature);
      for (const name of minimal) {
        assert.ok(!FREE_TEXT_FIELDS.has(name) && !HR_HIDDEN.has(name), `${table}/${feature} would read ${name}`);
      }
      assert.ok(minimal.includes('number'));
    }
  }
  const strict = allowedFields('sn_hr_core_case', 'record-summary');
  assert.deepEqual(strict, ['number', 'state', 'priority', 'assignment_group', 'assigned_to', 'opened_at', 'sys_updated_on', 'resolved_at']);
  const open = allowedFields('sn_hr_core_case', 'record-summary', { allowSensitive: true });
  for (const name of ['short_description', 'description', 'hr_service', 'subject_person', 'opened_for']) assert.ok(open.includes(name), name);
  assert.ok(withheldFields('sn_hr_core_case', 'record-summary').includes('description'));
  assert.deepEqual(withheldFields('sn_hr_core_case', 'record-summary', { allowSensitive: true }), []);
  assert.deepEqual(withheldFields('incident', 'record-summary'), []);
});

test('other tables are not affected by the HR rule', () => {
  assert.ok(allowedFields('incident', 'record-summary').includes('description'));
  assert.ok(allowedFields('sn_customerservice_case', 'record-summary').includes('contact'));
});

test('an unknown feature fails closed', () => {
  assert.throws(() => allowedFields('incident', 'make-coffee'), /Unknown feature/);
  assert.throws(() => allowedFields('incident', undefined), /Unknown feature/);
});

test('an unknown table gets the generic list', () => {
  const generic = allowedFields('u_custom_table', 'record-summary');
  assert.ok(generic.includes('number'));
  assert.ok(!generic.includes('caller_id'));
});

test('limits are the ones the contract names', () => {
  assert.equal(LIMITS.description, 4000);
  assert.equal(LIMITS.journalEntry, 1500);
  assert.equal(LIMITS.journalEntries, 30);
  assert.equal(LIMITS.kbExcerpt, 600);
  assert.equal(fieldLimit('description'), 4000);
  assert.equal(fieldLimit('close_notes'), LIMITS.closeNotes);
  assert.equal(fieldLimit('category'), LIMITS.field);
});

test('which extras a feature may include is narrowed by kind and by sensitivity', () => {
  assert.deepEqual(relatedPlan({ kind: 'requested_item', feature: 'record-summary' }), ['variables', 'approvals', 'catalogTasks', 'slas']);
  assert.deepEqual(relatedPlan({ kind: 'requested_item', feature: 'missing-info' }), ['variables']);
  assert.deepEqual(relatedPlan({ kind: 'incident', feature: 'similar' }), []);
  assert.deepEqual(relatedPlan({ kind: 'hr_case', feature: 'record-summary', minimised: true }), ['slas']);
  assert.deepEqual(relatedPlan({ kind: 'other', feature: 'record-summary' }), []);
  for (const feature of FEATURES) {
    for (const key of FEATURE_RELATED[feature]) {
      assert.ok(Object.values(RELATED_BY_KIND).some((keys) => keys.includes(key)), `${feature} names an extra nothing provides: ${key}`);
    }
  }
});
