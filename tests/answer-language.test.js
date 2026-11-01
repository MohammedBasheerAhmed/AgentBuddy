import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRun } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { answerLanguageRule } from '../src/prompts/rules.js';
import { setLanguage } from '../src/i18n/index.js';

// Settings > Language of AI answers: by default the answer follows the language of the ticket (the prompts already say so); with "the
// language of the panel" one fixed sentence is added to the task. It names a language from a fixed list and nothing from the ticket.

const PACK = {
  version: 1, table: 'incident', sysId: 'a'.repeat(32), number: 'INC0010001', kind: 'incident',
  fields: { short_description: 'VPN fails for Abel Tuter', description: 'The VPN drops every ten minutes.' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }], journal: [], related: {}, access: [],
};
const run = (settings, language) => {
  setLanguage(language);
  try {
    const values = effectiveSettings({ provider: 'anthropic', ...settings }, {}).values;
    const p = prepareRun({ feature: featureById('record-summary'), pack: PACK, values, policy: normalizePolicy({}), config: resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test'), createFirewall });
    return p.request.messages.find((m) => m.role === 'system').content;
  } finally {
    setLanguage('en');
  }
};

test('the rule is empty for "the language of the ticket", for an unknown setting and for a language without a name', () => {
  assert.equal(answerLanguageRule('ticket', 'ar'), '');
  assert.equal(answerLanguageRule(undefined, 'ar'), '');
  assert.equal(answerLanguageRule('panel', 'fr'), '');
  assert.equal(answerLanguageRule('klingon', 'ar'), '');
});

test('"the language of the panel" names that language in a fixed sentence and keeps labels, tokens and names as they are', () => {
  const ar = answerLanguageRule('panel', 'ar');
  assert.match(ar, /^Write the whole answer in Arabic, whatever language the ticket data is written in\./);
  assert.match(ar, /redaction token, record number, address and name exactly as it is in the data/);
  assert.match(answerLanguageRule('panel', 'en'), /in English/);
});

test('by default the system message is the feature\'s own, plus the firewall\'s rules; no sentence about the answer language is added', () => {
  const system = run({}, 'ar');
  assert.ok(!/Write the whole answer in/.test(system));
  assert.equal(system, run({ answerLanguage: 'ticket' }, 'ar'));
});

test('with the panel\'s language the sentence is in the system message once, before the firewall\'s rules, and the ticket text is not in it', () => {
  const system = run({ answerLanguage: 'panel' }, 'ar');
  assert.equal(system.split('Write the whole answer in Arabic').length - 1, 1);
  assert.ok(system.indexOf('Write the whole answer in Arabic') < system.indexOf('Rules set by the application'));
  assert.ok(!/Abel|VPN drops/.test(system), 'nothing from the ticket in the trusted text');
  assert.match(run({ answerLanguage: 'panel' }, 'en'), /Write the whole answer in English/);
});
