import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_TYPES,
  FIELD_LABELS,
  FILLABLE_FIELDS,
  LEVELS,
  normalizeContactType,
  normalizeLevel,
  parseTicketProposal,
  planFill,
} from '../src/compose/notesToTicket.js';

const ANSWER = [
  'Short description: VPN will not connect after the update',
  'Description: Caller cannot connect to the VPN from home since this morning.',
  'Error 809 is shown. A restart did not help.',
  'The whole sales team is affected.',
  'Impact: Medium',
  'Urgency: High',
  'Category hint: network',
  'Contact type: Phone',
  'Questions still to ask:',
  '1. Which VPN client and version?',
  '2. Does it work on the office network?',
].join('\n');

const incidentForm = { table: 'incident', kind: 'incident' };

// ---- Reading the answer ----------------------------------------------------------------------------------------------

test('parses every labelled line, with multi-line descriptions and numbered questions', () => {
  const p = parseTicketProposal(ANSWER);
  assert.equal(p.shortDescription, 'VPN will not connect after the update');
  assert.equal(p.description, 'Caller cannot connect to the VPN from home since this morning.\nError 809 is shown. A restart did not help.\nThe whole sales team is affected.');
  assert.equal(p.impact, 'Medium');
  assert.equal(p.urgency, 'High');
  assert.equal(p.contactType, 'phone');
  assert.equal(p.categoryHint, 'network');
  assert.deepEqual(p.questions, ['Which VPN client and version?', 'Does it work on the office network?']);
  assert.deepEqual(p.found, ['short_description', 'description', 'impact', 'urgency', 'category_hint', 'contact_type', 'questions']);
});

test('tolerates markdown dressing, bullets, case and odd spacing in the labels', () => {
  const p = parseTicketProposal(
    [
      '**Short description:** Printer on floor 3 is offline',
      '- **Description**: The printer shows offline since Monday.',
      '* IMPACT : low',
      'urgency: 3',
      '## Category hint:  Hardware ',
      'Contact type: **Walk-in**',
      'Questions still to ask:',
      '- Is the power light on?',
      '* Any paper jam?',
    ].join('\n')
  );
  assert.equal(p.shortDescription, 'Printer on floor 3 is offline');
  assert.equal(p.description, 'The printer shows offline since Monday.');
  assert.equal(p.impact, 'Low');
  assert.equal(p.urgency, 'Low');
  assert.equal(p.categoryHint, 'Hardware');
  assert.equal(p.contactType, 'walk-in');
  assert.deepEqual(p.questions, ['Is the power light on?', 'Any paper jam?']);
});

test('"Not stated", "None" and empty values are treated as absent', () => {
  const p = parseTicketProposal('Short description: Mouse broken\nDescription: Not stated\nImpact: Not stated\nUrgency: n/a\nCategory hint: None\nContact type: Not stated\nQuestions still to ask: None');
  assert.equal(p.shortDescription, 'Mouse broken');
  assert.equal(p.description, '');
  assert.equal(p.impact, '');
  assert.equal(p.impactText, '');
  assert.equal(p.urgency, '');
  assert.equal(p.categoryHint, '');
  assert.equal(p.contactType, '');
  assert.deepEqual(p.questions, []);
});

test('text that is not one of the known labels is ignored, not guessed at', () => {
  const p = parseTicketProposal(
    ['Some intro the model added', 'Assignment group: Network Operations', 'Priority: P1', 'Short description: Wifi is down', 'sys_id: 1234', 'State: Resolved', 'Description: Floor 2.'].join('\n')
  );
  assert.equal(p.shortDescription, 'Wifi is down');
  assert.equal(p.description, 'Floor 2.');
  assert.deepEqual(p.found, ['short_description', 'description']);
  assert.ok(!JSON.stringify(p).includes('Network Operations'));
  assert.ok(!JSON.stringify(p).includes('Resolved'));
});

test('a label that appears twice keeps the first one only', () => {
  const p = parseTicketProposal('Short description: First\nShort description: Second\nmore second text\nDescription: Body');
  assert.equal(p.shortDescription, 'First');
  assert.equal(p.description, 'Body');
});

test('lengths are capped to what the columns hold', () => {
  const p = parseTicketProposal(`Short description: ${'a'.repeat(400)}\nDescription: ${'b'.repeat(9000)}`);
  assert.equal(p.shortDescription.length, 160);
  assert.equal(p.description.length, 4000);
});

test('empty and weird input gives an empty proposal', () => {
  for (const input of [null, undefined, '', '   ', 42, {}, 'just a sentence with no labels', ':::', 'Impact']) {
    const p = parseTicketProposal(input);
    assert.equal(p.shortDescription, '');
    assert.equal(p.impact, '');
    assert.deepEqual(p.questions, []);
  }
});

// ---- Value mapping ---------------------------------------------------------------------------------------------------

test('High / Medium / Low map to the choice values 1 / 2 / 3', () => {
  assert.deepEqual(LEVELS.map((l) => [l.label, l.value]), [['High', '1'], ['Medium', '2'], ['Low', '3']]);
  assert.equal(normalizeLevel('High').value, '1');
  assert.equal(normalizeLevel('medium').value, '2');
  assert.equal(normalizeLevel('LOW').value, '3');
  assert.equal(normalizeLevel('Moderate').value, '2');
  assert.equal(normalizeLevel('2 - Medium').value, '2');
  assert.equal(normalizeLevel('1 - High').value, '1');
  assert.equal(normalizeLevel('3').value, '3');
  assert.equal(normalizeLevel('High (many users)').value, '1');
});

test('anything that is not clearly a level is not a level', () => {
  for (const bad of ['', null, undefined, 'Critical', 'Urgent', 'Lower', 'Highest', '4', '0', 'Not stated', 'unknown', 'P1']) {
    assert.equal(normalizeLevel(bad), null, String(bad));
  }
});

test('contact types map to their choice values; chat, social and the rest are not filled', () => {
  assert.deepEqual(CONTACT_TYPES.map((c) => c.value), ['phone', 'self-service', 'email', 'walk-in']);
  assert.equal(normalizeContactType('Phone').value, 'phone');
  assert.equal(normalizeContactType('Telephone call').value, 'phone');
  assert.equal(normalizeContactType('walk in').value, 'walk-in');
  assert.equal(normalizeContactType('Walk-in').value, 'walk-in');
  assert.equal(normalizeContactType('in person').value, 'walk-in');
  assert.equal(normalizeContactType('E-mail').value, 'email');
  assert.equal(normalizeContactType('Email').value, 'email');
  assert.equal(normalizeContactType('Self-service').value, 'self-service');
  assert.equal(normalizeContactType('portal').value, 'self-service');
  for (const bad of ['Chat', 'Social media', 'Fax', 'Not stated', '', null]) assert.equal(normalizeContactType(bad), null, String(bad));
});

test('what the AI wrote is kept for display even when it is not recognised', () => {
  const p = parseTicketProposal('Impact: Critical\nUrgency: ASAP\nContact type: Chat');
  assert.equal(p.impact, '');
  assert.equal(p.impactText, 'Critical');
  assert.equal(p.urgency, '');
  assert.equal(p.urgencyText, 'ASAP');
  assert.equal(p.contactType, '');
  assert.equal(p.contactTypeText, 'Chat');
});

// ---- What may be filled -----------------------------------------------------------------------------------------------

test('only five fields can ever be filled, in a fixed order', () => {
  assert.deepEqual(FILLABLE_FIELDS, ['short_description', 'description', 'impact', 'urgency', 'contact_type']);
  assert.deepEqual(Object.keys(FIELD_LABELS), FILLABLE_FIELDS);
  assert.throws(() => {
    'use strict';
    FILLABLE_FIELDS.push('assignment_group');
  });
});

test('planFill turns the reviewed values into whitelisted fields with checked values', () => {
  const plan = planFill({ shortDescription: ' VPN down ', description: 'Error 809.\nSince today.', impact: 'Medium', urgency: 'High', contactType: 'phone' }, incidentForm);
  assert.equal(plan.canFill, true);
  assert.equal(plan.reason, '');
  assert.deepEqual(plan.fields, [
    { field: 'short_description', value: 'VPN down', label: 'Short description' },
    { field: 'description', value: 'Error 809.\nSince today.', label: 'Description' },
    { field: 'impact', value: '2', label: 'Impact' },
    { field: 'urgency', value: '1', label: 'Urgency' },
    { field: 'contact_type', value: 'phone', label: 'Contact type' },
  ]);
  for (const f of plan.fields) assert.ok(FILLABLE_FIELDS.includes(f.field));
});

test('planFill never offers a field outside the whitelist, whatever the values object carries', () => {
  const plan = planFill(
    { shortDescription: 'x', assignment_group: 'Network', category: 'network', priority: '1', state: 'Resolved', caller_id: 'abel', __proto__: { description: 'inherited' }, impact: 'Low' },
    incidentForm
  );
  assert.deepEqual(plan.fields.map((f) => f.field), ['short_description', 'impact']);
});

test('planFill drops values it cannot check: unknown levels, unknown contact types', () => {
  const plan = planFill({ shortDescription: 'x', impact: 'Critical', urgency: '9', contactType: 'carrier-pigeon' }, incidentForm);
  assert.deepEqual(plan.fields.map((f) => f.field), ['short_description']);
  const levelsAsValues = planFill({ shortDescription: 'x', impact: '1', urgency: '3' }, incidentForm);
  assert.deepEqual(levelsAsValues.fields.map((f) => f.value), ['x', '1', '3'], 'a digit is read as the choice value it already is');
});

test('the channel is only filled on the incident form, where those choice values exist', () => {
  const onCase = planFill({ shortDescription: 'x', contactType: 'phone' }, { table: 'sn_customerservice_case', kind: 'case' });
  assert.equal(onCase.canFill, true);
  assert.deepEqual(onCase.fields.map((f) => f.field), ['short_description']);
});

test('only on a blank incident or case form, with a reason otherwise', () => {
  const values = { shortDescription: 'x' };
  const none = planFill(values, null);
  assert.equal(none.canFill, false);
  assert.deepEqual(none.fields, []);
  assert.match(none.reason, /blank ticket form/);
  assert.equal(planFill(values, undefined).canFill, false);
  assert.equal(planFill(values, 'incident').canFill, false);
  const kb = planFill(values, { table: 'kb_knowledge', kind: 'knowledge' });
  assert.equal(kb.canFill, false);
  assert.match(kb.reason, /kb_knowledge/);
  assert.deepEqual(kb.fields, []);
  assert.equal(planFill(values, { table: 'change_request', kind: 'change' }).canFill, false);
  assert.equal(planFill(values, { table: 'sn_customerservice_case', kind: 'case' }).canFill, true);
});

test('nothing to fill is said plainly', () => {
  const plan = planFill({}, incidentForm);
  assert.equal(plan.canFill, false);
  assert.match(plan.reason, /nothing to fill/i);
  assert.equal(planFill(null, incidentForm).canFill, false);
});

test('an answer goes through parse then plan end to end', () => {
  const plan = planFill(
    (({ shortDescription, description, impact, urgency, contactType }) => ({ shortDescription, description, impact, urgency, contactType }))(parseTicketProposal(ANSWER)),
    incidentForm
  );
  assert.deepEqual(plan.fields.map((f) => `${f.field}=${f.value.split('\n')[0]}`), [
    'short_description=VPN will not connect after the update',
    'description=Caller cannot connect to the VPN from home since this morning.',
    'impact=2',
    'urgency=1',
    'contact_type=phone',
  ]);
});
