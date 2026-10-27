import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STEPS, buildChecklist, checklistProgress, looksLikeStep, normaliseStep, setDone, splitInstructions, stepId, stepsFromPack } from '../src/checks/checklist.js';
import { checklistParts, mergeParentPack } from '../src/checks/checklistParts.js';

// ---- numbered and bulleted lists --------------------------------------------------------------------------------------

test('a numbered list becomes one step per item, with the markers removed', () => {
  assert.deepEqual(splitInstructions('1. Image the laptop\n2) Install the standard software\n3: Deliver it to the user'), [
    'Image the laptop',
    'Install the standard software',
    'Deliver it to the user',
  ]);
  assert.deepEqual(splitInstructions('Step 1: Create the account\nStep 2 - Add to the group\n(3) Send the welcome email'), ['Create the account', 'Add to the group', 'Send the welcome email']);
  assert.deepEqual(splitInstructions('a) First thing\nb) Second thing'), ['First thing', 'Second thing']);
});

test('bullets and check boxes in any common style', () => {
  assert.deepEqual(splitInstructions('- Pack it\n* Label it\n• Ship it\n– Confirm delivery'), ['Pack it', 'Label it', 'Ship it', 'Confirm delivery']);
  assert.deepEqual(splitInstructions('[ ] Back up the data\n[x] Wipe the disk\n- [ ] Reinstall Windows\n☐ Check the drivers'), ['Back up the data', 'Wipe the disk', 'Reinstall Windows', 'Check the drivers']);
});

test('a marked item keeps its text even when it does not start with a verb; an indented line continues the item above', () => {
  assert.deepEqual(splitInstructions('1. The laptop must be encrypted\n   and registered in the asset tool\n2. Standard bag included'), ['The laptop must be encrypted and registered in the asset tool', 'Standard bag included']);
});

test('headings that end in a colon are skipped, and so are context lines', () => {
  assert.deepEqual(splitInstructions('New starter laptop for Friday.\nPlease do the following:\n1. Image the laptop\n2. Deliver the laptop'), ['Image the laptop', 'Deliver the laptop']);
});

test('a heading line followed by prose is not a step; blank lines and carriage returns are fine', () => {
  assert.deepEqual(splitInstructions('Steps:\r\n\r\n1. One thing\r\n\r\n2. Another thing\r\n'), ['One thing', 'Another thing']);
  assert.deepEqual(splitInstructions(''), []);
  assert.deepEqual(splitInstructions(null), []);
  assert.deepEqual(splitInstructions(undefined), []);
});

// ---- prose ------------------------------------------------------------------------------------------------------------------

test('prose: sentences that start with an action word, split at "then", "after that" and "finally"', () => {
  assert.deepEqual(splitInstructions('Create the account, then add it to the Sales group. After that, send the welcome email. Finally confirm with the manager.'), [
    'Create the account',
    'Add it to the Sales group',
    'Send the welcome email',
    'Confirm with the manager',
  ]);
});

test('prose: context sentences are not steps, "please" and "you need to" are skipped over, semicolons split', () => {
  assert.deepEqual(splitInstructions('The user starts on Monday. Please order a docking station; make sure it is the USB-C model. You need to tag the asset.'), [
    'Order a docking station',
    'Make sure it is the USB-C model',
    'Tag the asset',
  ]);
  assert.deepEqual(splitInstructions('New starter laptop for Charlie, needs to be ready by Friday.'), []);
});

test('prose: a condition is kept whole, not cut at "then"', () => {
  assert.deepEqual(splitInstructions('If the disk is full then delete the temp files.'), ['If the disk is full then delete the temp files']);
});

test('prose after a list is still found; very long steps are shortened', () => {
  assert.deepEqual(splitInstructions('1. Image the laptop\n2. Deliver the laptop\nMake sure the user signs for it.'), ['Image the laptop', 'Deliver the laptop', 'Make sure the user signs for it']);
  const long = splitInstructions(`1. ${'word '.repeat(80)}`);
  assert.ok(long[0].length <= 200 && long[0].endsWith('…'));
});

test('markdown the AI may add is removed from steps', () => {
  assert.deepEqual(splitInstructions('1. **Image** the `laptop`\n2. __Deliver__ it'), ['Image the laptop', 'Deliver it']);
});

test('looksLikeStep', () => {
  for (const s of ['Create the account', 'Please send the invoice', 'You need to check the log', 'Then restart the service', 'Make sure it boots', 'Set up the VPN']) assert.ok(looksLikeStep(s), s);
  for (const s of ['The user starts Monday', 'Laptop for Charlie', 'It is urgent', '', 'Because of the delay']) assert.ok(!looksLikeStep(s), s);
});

// ---- ids ---------------------------------------------------------------------------------------------------------------------

test('a step id is a short hash of the normalised text: stable, case- and punctuation-blind, 8 hex characters', () => {
  assert.match(stepId('Create the account'), /^[0-9a-f]{8}$/);
  assert.equal(stepId('Create the account'), stepId('  create the ACCOUNT. '));
  assert.notEqual(stepId('Create the account'), stepId('Create the accounts'));
  assert.notEqual(stepId('Create the account'), stepId('Create the account', 2));
  assert.equal(normaliseStep('  Hello,   World! '), 'hello world');
});

test('buildChecklist: ids are the same each time, a step repeated in the same text keeps both, one repeated in a later text is dropped', () => {
  const a = buildChecklist([{ label: 'A', text: '1. Check the log\n2. Restart it\n3. Check the log' }]);
  const b = buildChecklist([{ label: 'A', text: '1. Check the log\n2. Restart it\n3. Check the log' }]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((s) => s.id)).size, 3, 'the repeated step has its own id');
  const merged = buildChecklist([{ label: 'Description', text: '1. Image the laptop\n2. Deliver it' }, { label: 'Special', text: '- Deliver it\n- Get a signature' }]);
  assert.deepEqual(merged.map((s) => [s.text, s.from]), [['Image the laptop', 'Description'], ['Deliver it', 'Description'], ['Get a signature', 'Special']]);
});

test('buildChecklist caps the number of steps', () => {
  const text = Array.from({ length: 80 }, (_, i) => `${i + 1}. Do thing number ${i + 1}`).join('\n');
  assert.equal(buildChecklist([{ text }]).length, MAX_STEPS);
});

test('stepsFromPack reads the description first, then the special instructions', () => {
  const pack = { fields: { description: '1. Image the laptop', special_instructions: '1. Deliver to floor 3' } };
  assert.deepEqual(stepsFromPack(pack).map((s) => s.text), ['Image the laptop', 'Deliver to floor 3']);
  assert.deepEqual(stepsFromPack({ fields: {} }), []);
  assert.deepEqual(stepsFromPack(null), []);
});

// ---- progress ----------------------------------------------------------------------------------------------------------------------

test('progress: "3 of 7 done", ticks for steps that are gone are ignored, complete only when every step is ticked', () => {
  const steps = Array.from({ length: 7 }, (_, i) => ({ id: `0000000${i}` }));
  const p = checklistProgress(steps, ['00000000', '00000001', '00000002', 'deadbeef']);
  assert.deepEqual(p, { done: 3, total: 7, percent: 43, complete: false, text: '3 of 7 done' });
  assert.equal(checklistProgress(steps, steps.map((s) => s.id)).complete, true);
  assert.deepEqual(checklistProgress([], ['x']), { done: 0, total: 0, percent: 0, complete: false, text: 'No steps' });
  assert.equal(checklistProgress(steps, undefined).done, 0);
});

test('setDone returns a new list and never changes its argument', () => {
  const before = Object.freeze(['a', 'b']);
  assert.deepEqual(setDone(before, 'c', true), ['a', 'b', 'c']);
  assert.deepEqual(setDone(before, 'a', false), ['b']);
  assert.deepEqual(setDone(before, 'a', true), ['b', 'a']);
  assert.deepEqual(setDone(undefined, 'a', true), ['a']);
});

// ---- what the AI proposal reads --------------------------------------------------------------------------------------------------------

test('checklistParts: the ordinary fields and one part per answer; no notes', () => {
  const pack = {
    fields: { number: 'SCTASK1', description: '1. Image the laptop' },
    journal: [{ when: 'x', by: 'Beth', type: 'work_note', text: 'NOT-THIS' }],
    related: { variables: [{ question: 'Operating system', value: 'Windows 11' }, { question: 'Empty', value: '' }] },
  };
  const parts = checklistParts(pack);
  const text = parts.map((p) => p.text).join('\n');
  assert.match(text, /Operating system: Windows 11/);
  assert.match(text, /Image the laptop/);
  assert.ok(!text.includes('NOT-THIS'));
  assert.ok(!text.includes('Empty:'));
});

test('mergeParentPack adds the item\'s answers and people to the task, and the task\'s own fields win', () => {
  const own = { kind: 'catalog_task', fields: { number: 'SCTASK1', description: 'task text' }, people: [{ name: 'Beth Anglin', role: 'assigned_to' }], related: {}, access: [{ source: 'task_sla', status: 'ok' }] };
  const parent = { kind: 'requested_item', fields: { number: 'RITM1', cat_item: 'Laptop', description: 'item text' }, people: [{ name: 'Beth Anglin' }, { name: 'Charlie Whitherspoon', role: 'requested_for' }], related: { variables: [{ question: 'OS', value: 'Win' }], approvals: [{ approver: 'x' }] }, access: [{ source: 'sc_item_option_mtom', status: 'ok' }] };
  const merged = mergeParentPack(own, parent);
  assert.equal(merged.fields.number, 'SCTASK1');
  assert.equal(merged.fields.description, 'task text');
  assert.equal(merged.fields.cat_item, 'Laptop');
  assert.deepEqual(merged.people.map((p) => p.name), ['Beth Anglin', 'Charlie Whitherspoon']);
  assert.deepEqual(Object.keys(merged.related), ['variables'], 'only the answers come across');
  assert.equal(merged.access.length, 2);
  assert.equal(mergeParentPack(own, null), own);
  assert.equal(mergeParentPack(own, own), own);
});
