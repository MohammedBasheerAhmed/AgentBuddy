// AI0.3 (d) and (e): every request is estimated before it is sent and fitted to the model (the oldest notes go first, the rules never),
// and it says what it was made without: notes that could not be read, lists that were denied, older notes that were left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, estimateMessages, contextWindow, promptBudget, fitParts, LOCAL_CONTEXT, UNKNOWN_CONTEXT } from '../src/lib/tokens.js';
import { prepareRun, maskMore, fitToModel, RunBlocked } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { unavailable, journalCut, notAvailablePart, madeWithout, madeWithoutText, unavailableText } from '../src/features/parts.js';
import { createFirewall } from '../src/pii/index.js';
import { RULES_PREAMBLE } from '../src/pii/firewall.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { hostilePack } from './fixtures/itsm-hostile.js';

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const cloud = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const ollama = () => resolveProviderConfig({ provider: 'ollama' }, '');
const policy = normalizePolicy({});
const prepare = (id, pack, config = cloud()) => prepareRun({ feature: featureById(id), pack, values: values(), policy, config, createFirewall });

// A long ticket: `n` customer comments of about 1,400 characters each, as the journal reader caps them.
function longPack(n = 30) {
  const base = hostilePack();
  const journal = [];
  for (let i = 0; i < n; i++) {
    journal.push({ when: `2026-10-${String(1 + (i % 28)).padStart(2, '0')} 09:${String(i).padStart(2, '0')}:00`, by: 'Abel Tuter', type: 'comment', text: `Update ${i}: ${'the VPN dropped again while I was on the finance call, twice before nine. '.repeat(19)}`.slice(0, 1400) });
  }
  return { ...base, journal };
}
const userOf = (prepared) => prepared.request.messages[1].content;
const notesIn = (prepared) => (userOf(prepared).match(/field="comments"/g) || []).length;

// ---- The estimate ---------------------------------------------------------------------------------------------------------------

test('the estimate is on the high side: about 4 characters per token for English, more tokens for other scripts', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  const english = 'The VPN drops every ten minutes since the update on Monday. '.repeat(20); // 1,200 chars; a real tokenizer says about 260
  const est = estimateTokens(english);
  assert.ok(est >= 300 && est <= 400, String(est));
  assert.ok(estimateTokens('漢字'.repeat(100)) >= 200, 'one token or more per CJK character');
  assert.ok(estimateTokens('Привет, мир. '.repeat(50)) > estimateTokens('Hello, world. '.repeat(50)), 'Cyrillic costs more than ASCII');
  assert.equal(estimateMessages([{ role: 'system', content: 'abcd' }, { role: 'user', content: 'abcd' }]), 2 * (8 + estimateTokens('abcd')));
});

test('the context of the model: known cloud models by name, Ollama\'s default for a model on this computer, a setting wins', () => {
  assert.deepEqual(contextWindow(cloud()), { tokens: 200000, source: 'model' });
  assert.deepEqual(contextWindow({ model: 'openai/gpt-4o-mini' }), { tokens: 128000, source: 'model' });
  assert.deepEqual(contextWindow({ model: 'deepseek-chat' }), { tokens: 64000, source: 'model' });
  assert.deepEqual(contextWindow({ model: 'my-deployment-7' }), { tokens: UNKNOWN_CONTEXT, source: 'unknown' });
  assert.deepEqual(contextWindow(ollama()), { tokens: LOCAL_CONTEXT, source: 'local-default' });
  assert.deepEqual(contextWindow({ ...ollama(), model: 'llama3.1' }), { tokens: 4096, source: 'local-default' }, 'llama 3.1 could take 128k, but Ollama gives it its default');
  assert.deepEqual(contextWindow({ ...ollama(), contextTokens: 32768 }), { tokens: 32768, source: 'setting' });
  assert.deepEqual(contextWindow({ local: true, contextTokens: 'lots' }), { tokens: LOCAL_CONTEXT, source: 'local-default' }, 'a setting that is not a number is ignored');
  const local = promptBudget(ollama());
  assert.deepEqual([local.window, local.reserve, local.prompt], [4096, 1024, 3072], 'a quarter kept back for the answer');
  assert.equal(promptBudget(cloud()).reserve, 16000);
});

test('fitParts leaves out the earliest droppable parts first, keeps the newest, and never touches the others', () => {
  const parts = [
    { field: 'short_description', text: 'x'.repeat(100) },
    ...[1, 2, 3, 4].map((n) => ({ field: 'comments', text: `${n}`.repeat(400) })),
  ];
  const droppable = (p) => p.field === 'comments';
  const all = fitParts({ parts, fixed: 0, budget: 100000, droppable });
  assert.equal(all.dropped, 0);
  const some = fitParts({ parts, fixed: 0, budget: 380, droppable });
  assert.deepEqual(some.parts.map((p) => p.text[0]), ['x', '3', '4']);
  assert.ok(some.fits);
  const tight = fitParts({ parts, fixed: 0, budget: 10, droppable });
  assert.deepEqual(tight.parts.map((p) => p.text[0]), ['x', '4'], 'the newest note stays');
  assert.equal(tight.fits, false);
});

// ---- Through the pipeline -------------------------------------------------------------------------------------------------------

test('a long ticket goes whole to a cloud model, and is cut to fit a model on this computer: oldest notes first, rules intact', () => {
  const pack = longPack(30);
  const big = prepare('record-summary', pack);
  assert.equal(notesIn(big), 15, 'record-summary asks for the newest 15');
  assert.equal(big.size.notesLeftOut, 0);
  assert.ok(big.size.tokens > 4000, String(big.size.tokens));

  const small = prepare('record-summary', pack, ollama());
  assert.ok(small.size.tokens <= small.size.budget, `${small.size.tokens} <= ${small.size.budget}`);
  assert.ok(small.size.notesLeftOut > 0 && notesIn(small) >= 1 && notesIn(small) < 15);
  assert.equal(small.size.window, 4096);
  const [system, user] = small.request.messages;
  assert.ok(system.content.startsWith(featureById('record-summary').system), 'the task is whole');
  assert.ok(system.content.endsWith(RULES_PREAMBLE), 'the rules are whole');
  assert.ok(user.content.endsWith(featureById('record-summary').instruction));
  // the newest note is in, the oldest are not
  assert.match(user.content, /Update 29:/);
  assert.ok(!/Update 15:/.test(user.content));
  // the model and the person are told
  assert.match(user.content, /<ticket_data field="data_not_available" label="Not available">\nOlder notes and comments were left out so that the request fits the AI model: the newest \d+ of 30 are included\.\n<\/ticket_data>/);
  assert.deepEqual(small.madeWithout.map((m) => m.status), ['cut']);
  assert.match(small.madeWithout[0].why, /left out to fit the AI model/);
  assert.equal(small.preview, small.request.preview, 'the preview is the cut request, exactly');
});

test('"Mask this too" keeps the cut request: it is built again from the same parts', () => {
  const small = prepare('record-summary', longPack(30), ollama());
  const masked = maskMore(small, 'finance call');
  assert.equal(masked.ok, true);
  assert.equal(masked.prepared.input.parts.length, small.input.parts.length);
  assert.ok(!masked.prepared.preview.includes('finance call'));
});

test('when even the newest note does not fit, nothing is sent and the person is told what to do', () => {
  const pack = { ...hostilePack(), fields: { short_description: 'VPN', description: 'word '.repeat(4000) } };
  // (audit P3.29: a model on this computer is always counted at 4,096 tokens, so the message does not suggest setting up the server for
  // more, or another local model: neither would change anything)
  assert.throws(
    () => prepare('record-summary', pack, ollama()),
    (e) => e instanceof RunBlocked && e.code === 'TOO_LONG' && /too long for the chosen AI model/.test(e.message) && /Settings/.test(e.message) &&
      /always counts on 4,096 tokens, whatever its server is set up for/.test(e.message) && !/unless its server|Choose a model that reads more/.test(e.message)
  );
  assert.throws(() => prepare('record-summary', pack, { ...cloud(), model: 'gpt-4' }), (e) => e.code === 'TOO_LONG' && /Choose a model that reads more in Settings\./.test(e.message) && !/this computer/.test(e.message));
  assert.doesNotThrow(() => prepare('record-summary', pack), 'a cloud model takes it');
});

// Audit P3.30: when the masked request comes out longer than the estimate, the pipeline fits again to a lowered target; if even the
// newest note does not fit that, the message still names the model's own budget, never the lowered internal number.
test('"too long" after a second fit names the model\'s budget, and a size above it', () => {
  // Many short addresses: each one is masked into a longer placeholder, so the finished request is larger than the first estimate.
  const pack = { ...hostilePack(), journal: [], fields: { short_description: 'VPN', description: Array.from({ length: 800 }, (_, i) => `u${i}@x.io`).join(' ') } };
  const budget = promptBudget(ollama()).prompt;
  assert.throws(() => prepare('record-summary', pack, ollama()), (e) => {
    const m = /about ([\d,]+) tokens, and the model reads about ([\d,]+)\./.exec(e.message);
    assert.ok(m, e.message);
    const [said, reads] = [Number(m[1].replace(/,/g, '')), Number(m[2].replace(/,/g, ''))];
    assert.equal(reads, budget, 'the model\'s budget');
    assert.ok(said > reads, `${said} is more than ${reads}`);
    return e.code === 'TOO_LONG';
  });
});

test('a reply keeps the message it answers: the last customer message is the one that stays', () => {
  const pack = { ...longPack(30), kind: 'incident' };
  const p = prepare('reply-draft', pack, { ...ollama(), contextTokens: 3200 });
  assert.match(userOf(p), /Update 29:/);
});

// ---- What was not available -----------------------------------------------------------------------------------------------------

test('notes the user cannot read, lists that were denied or blocked: one part for the model, the same list for the panel', () => {
  const pack = {
    ...hostilePack(),
    journal: [],
    access: [
      { source: 'journal', status: 'denied', note: 'Your user cannot read the notes and comments of this record.', strategy: 'none' },
      { source: 'task_sla', status: 'error', note: 'Could not read task_sla: HTTP 500 from the instance <script>' },
      { source: 'sysapproval_approver', status: 'blocked', note: 'x' },
      { source: 'sys_user', status: 'denied', note: 'people lookups stay quiet' },
      { source: 'incident', status: 'empty-or-hidden', note: '', reference: true },
      { source: 'change_task', status: 'empty', note: '' },
      { source: 'task', status: 'ok', note: '' },
    ],
  };
  const list = unavailable(pack);
  assert.deepEqual(list.map((u) => [u.what, u.status]), [['Notes and comments', 'denied'], ['SLAs', 'error'], ['Approvals', 'blocked']]);
  const p = prepare('record-summary', pack);
  const part = /<ticket_data field="data_not_available" label="Not available">\n([\s\S]*?)\n<\/ticket_data>/.exec(userOf(p))[1];
  assert.equal(part, 'These parts could not be read, so do not describe them as empty or as "none":\n- Notes and comments: not readable by your user\n- SLAs: could not be read\n- Approvals: not allowed by your organisation (do not describe it as empty)');
  assert.ok(!/HTTP 500|script|quiet/.test(part), 'fixed wording only, nothing from the instance');
  assert.deepEqual(p.madeWithout, [
    { what: 'Notes and comments', why: 'your user cannot read them', status: 'denied' },
    { what: 'SLAs', why: 'could not be read', status: 'error' },
    { what: 'Approvals', why: 'not allowed by your organisation', status: 'blocked' },
  ]);
  assert.equal(madeWithoutText(p.madeWithout), 'Made without: Notes and comments (your user cannot read them); SLAs (could not be read); Approvals (not allowed by your organisation).');
  assert.equal(madeWithoutText([]), '');
  // the part is at the end of the data, just before the instruction
  assert.ok(userOf(p).indexOf('data_not_available') > userOf(p).lastIndexOf('field="fields"'));
});

test('nothing missing: no part, an empty list', () => {
  const p = prepare('record-summary', hostilePack());
  assert.ok(!userOf(p).includes('data_not_available'));
  assert.deepEqual(p.madeWithout, []);
});

test('notes left out by design or by the read limit are named; a feature that asks for every note gets no line', () => {
  const pack = longPack(20);
  assert.deepEqual(journalCut(pack, { sent: 15, depth: 15 }), { sent: 15, total: 20, more: false, trimmed: 0 });
  assert.equal(journalCut(pack, { sent: 20, depth: 25 }), null);
  assert.equal(journalCut(pack, { sent: 0, depth: 0 }), null, 'a feature that sends no notes is not "missing" any');
  // a feature that sends customer comments only is not "missing" the work notes
  const mixed = { journal: [...Array(12)].map(() => ({ type: 'comment', text: 'c' })).concat([...Array(10)].map(() => ({ type: 'work_note', text: 'w' }))) };
  assert.equal(journalCut(mixed, { sent: 12, depth: 12, fields: new Set(['comments']) }), null);
  assert.deepEqual(journalCut(mixed, { sent: 12, depth: 12 }), { sent: 12, total: 22, more: false, trimmed: 0 });
  const read = { ...pack, access: [{ source: 'journal', status: 'ok', note: 'Showing the newest 30 entries.', more: true }] };
  assert.equal(journalCut(read, { sent: 20, depth: 30 }).more, true);
  assert.match(unavailableText([], journalCut(read, { sent: 20, depth: 30 })), /Only the newest 20 notes and comments could be read; older ones exist/);
  const p = prepare('record-summary', pack);
  assert.match(userOf(p), /Only the newest 15 of the 20 notes and comments are included\./);
  assert.deepEqual(p.madeWithout, [{ what: 'Older notes and comments', why: 'left out (the newest 15 of 20 were sent)', status: 'cut' }]);
  assert.equal(notAvailablePart([], null), null);
  assert.deepEqual(madeWithout([], null), []);
});

test('skipped reads say why in their fixed words; a feature\'s own "not available" part is replaced, never doubled', () => {
  const pack = {
    ...hostilePack(),
    access: [
      { source: 'sn_hr_core_case', status: 'skipped', note: 'sn_hr_core_case holds sensitive data, so free text and identities were not read (description).' },
      { source: 'journal', status: 'skipped', note: 'Notes and comments on sensitive records are not read unless sensitive data is allowed.' },
    ],
    table: 'sn_hr_core_case',
  };
  const list = unavailable(pack);
  assert.deepEqual(list.map((u) => u.what), ['Some fields of this record', 'Notes and comments']);
  const fitted = fitToModel({ feature: featureById('record-summary'), pack, parts: [{ label: 'Data not available', field: 'data_not_available', text: 'old' }, { label: 'State', field: 'state', text: 'New', inline: true }], budget: 100000 });
  const own = fitted.parts.filter((p) => p.field === 'data_not_available');
  assert.equal(own.length, 1);
  assert.match(own[0].text, /- Notes and comments: Notes and comments on sensitive records are not read/);
});
