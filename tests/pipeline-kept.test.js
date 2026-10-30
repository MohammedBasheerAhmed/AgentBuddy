// A password, card or ID number is never put back into an answer (NEVER_REHYDRATE). The marker that stays must be explained, not
// look like a bug: a notice above the answer, and its own advice in the check before Insert.
const test = require('node:test');
const assert = require('node:assert/strict');
import { executeRun, keptNote, KEPT_NOTE } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/firewall.js';
import { featureById } from '../src/features/registry.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { placeholderFindings } from '../src/safeSend/review.js';

const PACK = { version: 1, table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident', fields: {}, people: [] };
const values = () => effectiveSettings({ provider: 'anthropic' }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');

function prepared(feature = featureById('record-summary')) {
  const firewall = createFirewall({ mode: 'standard', people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }] });
  const request = firewall.buildRequest({
    feature: feature.id,
    table: 'incident',
    system: 'Summarise.',
    parts: [{ label: 'Description', field: 'description', text: 'Abel Tuter says his password: Winter2026! and card 4111 1111 1111 1111 do not work.' }],
  });
  return { request, firewall, feature, pack: PACK };
}

const echo = () => async (cfg, request) => {
  const user = request.messages.find((m) => m.role === 'user').content;
  const tokens = user.match(/\[[A-Z]+_\d+\]/g) || [];
  return { content: `Summary: ${tokens.join(' ')}` };
};

test('names come back, a password and a card do not, and the answer says why', async () => {
  const p = prepared();
  const out = await executeRun({ prepared: p, config: config(), values: values(), sendChat: echo(), logAudit: async () => {} });
  assert.match(out.text, /Abel Tuter/, 'a name is put back');
  assert.ok(!out.text.includes('Winter2026!') && !out.text.includes('4111'), out.text);
  assert.match(out.text, /\[SECRET_1\]/);
  assert.match(out.text, /\[CARD_1\]/);
  assert.equal(out.notice, KEPT_NOTE);
});

test('an answer with no kept marker carries no notice', async () => {
  const p = prepared();
  const out = await executeRun({ prepared: p, config: config(), values: values(), sendChat: async () => ({ content: 'Call [PERSON_1] back.' }), logAudit: async () => {} });
  assert.equal(out.text, 'Call Abel Tuter back.');
  assert.equal(out.notice, '');
});

test('a feature that keeps everything masked (an article) gets no kept-value notice: every marker is meant to stay', async () => {
  const p = prepared({ ...featureById('record-summary'), keepMasked: true });
  const out = await executeRun({ prepared: p, config: config(), values: values(), sendChat: echo(), logAudit: async () => {} });
  assert.equal(out.notice, '');
});

test('keptNote only reacts to the never-put-back kinds', () => {
  assert.equal(keptNote('[SECRET_1]'), KEPT_NOTE);
  assert.equal(keptNote('[CARD_2] and [IBAN_1]'), KEPT_NOTE);
  assert.equal(keptNote('ID: [ID_3]'), KEPT_NOTE);
  assert.equal(keptNote('[PERSON_1] and [EMAIL_1]'), '');
  assert.equal(keptNote('[SECRET_X]'), '');
  assert.equal(keptNote(''), '');
});

test('the check before Insert explains a kept marker differently from a forgotten name marker', () => {
  const [kept] = placeholderFindings('Your card [CARD_1] was refused.');
  const [name] = placeholderFindings('Hi [PERSON_1],');
  assert.match(kept.advice, /password, card or ID number stays hidden/);
  assert.match(name.advice, /hidden-name marker/);
  assert.equal(kept.severity, name.severity, 'the same severity: only the wording differs');
});
