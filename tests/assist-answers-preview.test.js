import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import PreviewDialog from '../src/sidepanel/PreviewDialog.jsx';
import { errorNextSteps, madeWithout, madeWithoutLine, otherRecordsSummary, previewStyle, splitPreview, waitingText } from '../src/sidepanel/runLogic.js';
import { featureById } from '../src/features/registry.js';
import { createFirewall } from '../src/pii/index.js';
import { prepareRun, maskMore } from '../src/lib/pipeline.js';
import { effectiveSettings, normalizePolicy, DEFAULT_SETTINGS } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';

// The check before a send (TRACKER.md AI0.2): the ticket data first and the fixed rules folded, the exact text one click away and
// still exactly what is sent; the short check for look-alike tickets after the first time. And the lines around an answer (AI0.4):
// what it was made without, the progress while waiting, the next step after an error.

const SYS = 'a'.repeat(32);
const pack = {
  version: 1,
  table: 'incident',
  sysId: SYS,
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN drops every hour', description: 'Abel Tuter says the VPN drops.' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [],
  related: {},
  access: [],
};
const e = effectiveSettings({ ...DEFAULT_SETTINGS, provider: 'anthropic', piiMode: 'standard' }, normalizePolicy({}));
const prepare = (feature, p = pack) => prepareRun({ feature: featureById(feature), pack: p, values: e.values, policy: e.policy, config: resolveProviderConfig(e.values, 'sk-ant-test'), createFirewall });

// ---- splitting the preview -------------------------------------------------------------------------------------------------------

test('the preview splits into ticket data and rules that add up to exactly the text that is sent', () => {
  const prepared = prepare('record-summary');
  const split = splitPreview(prepared);
  assert.equal(split.ok, true);
  assert.equal(split.exact, prepared.request.preview);
  assert.equal(`[system]\n${split.rules}\n\n[user]\n${split.data}`, prepared.request.preview, 'nothing reworded, nothing left out');
  assert.match(split.data, /^<ticket_data/);
  assert.ok(!split.rules.includes('VPN drops every hour') && !split.rules.includes('<ticket_data field='), 'no ticket data in the rules');
  assert.ok(split.data.includes('VPN drops every hour'));
  // after "Mask this too" the split follows the request sealed again
  const masked = maskMore(prepared, 'VPN drops');
  assert.equal(masked.ok, true);
  const again = splitPreview(masked.prepared);
  assert.ok(again.ok && !again.data.includes('VPN drops every hour'));
});

test('when the pieces cannot be proved to be the exact text, only the exact text is shown', () => {
  assert.deepEqual(splitPreview({ preview: 'Summarise [PERSON_1]' }), { ok: false, exact: 'Summarise [PERSON_1]', data: '', rules: '' });
  assert.equal(splitPreview({ request: { preview: 'other', messages: [{ role: 'system', content: 'a' }, { role: 'user', content: 'b' }] } }).ok, false, 'messages that do not rebuild the preview');
  assert.equal(splitPreview({ request: { preview: '[system]\nonly rules', messages: [{ role: 'system', content: 'only rules' }] } }).ok, false, 'no data part');
  assert.equal(splitPreview(null).ok, false);
});

// ---- the short check -----------------------------------------------------------------------------------------------------------

const withReference = (p = pack) => ({
  ...p,
  requirePreview: true,
  reference: {
    similar: { status: 'ok', hits: [1, 2, 3].map((i) => ({ number: `INC000964${i}`, short_description: 'VPN drops', close_notes: 'Replaced the client.', why: 'same words', people: [] })) },
    knowledge: { status: 'ok', hits: [1, 2].map((i) => ({ number: `KB001000${i}`, short_description: 'Fix the VPN', excerpt: 'Switch to TCP.', why: 'same words', people: [] })) },
  },
});

test('the other records a run uses, counted from what is actually sent', () => {
  const nba = prepare('next-best-action', withReference());
  assert.equal(otherRecordsSummary(nba), '3 solved tickets and 2 articles');
  assert.equal(otherRecordsSummary(prepare('record-summary')), '', 'none');
  const listed = { input: { parts: [{ field: 'linked_incidents' }, { field: 'account_cases' }, { field: 'kb_article' }] }, pack: { related: { linkedIncidents: [{}, {}], accountCases: [{}] } } };
  assert.equal(otherRecordsSummary(listed), '1 article, 2 linked incidents and 1 other case of the account');
  assert.equal(otherRecordsSummary({ input: { parts: [{ field: 'linked_incidents' }] }, pack: { related: {} } }), '', 'a list it cannot count is not named vaguely');
  assert.equal(otherRecordsSummary(null), '');
});

test('the short check only in "first time" mode, for other records, once the full check was seen, and only when it can name them', () => {
  const feature = featureById('next-best-action');
  const ref = { requirePreview: true };
  const base = { previewMode: 'first', feature, pack: ref, seen: [feature.previewGroup || feature.id], others: '3 solved tickets' };
  assert.equal(previewStyle(base), 'short');
  assert.equal(previewStyle({ ...base, seen: [] }), 'full', 'the first time is the full check');
  assert.equal(previewStyle({ ...base, previewMode: 'always' }), 'full', '"always" means always the full text');
  assert.equal(previewStyle({ ...base, pack: {} }), 'full', 'no other records: this is not the look-alike case');
  assert.equal(previewStyle({ ...base, others: '' }), 'full', 'cannot say what it uses: full check');
  assert.equal(previewStyle({ ...base, seen: undefined }), 'full');
});

// ---- the dialog ---------------------------------------------------------------------------------------------------------------

const dialog = (props) =>
  renderToStaticMarkup(<PreviewDialog feature={{ title: 'Next best actions' }} config={{ provider: 'anthropic', baseUrl: '' }} canSkipNext onSend={() => {}} onCancel={() => {}} onMask={() => ({ ok: true, masked: 1 })} {...props} />);

test('the full check: where it goes, what was hidden, the ticket data to read, the rules and the exact text folded, Hide something else', () => {
  const prepared = prepare('record-summary');
  const markup = dialog({ prepared, config: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' } });
  assert.match(markup, /<h2 class="ab-sheet-title" id="ab-prev-title-[\w-]+">Check before sending<\/h2><p class="ab-sheet-sub">Next best actions · to DeepSeek \(deepseek-chat\)<\/p>/);
  assert.match(markup, /Personal details are hidden before anything leaves:/);
  assert.match(markup, /class="ab-chip ab-check-count">\d+ names?</);
  // the ticket data as a person reads it: the fields under "Ticket", the hidden values as chips, nothing of the wrappers
  assert.match(markup, /<div class="ab-sent" role="region" aria-label="What will be sent" tabindex="0"><section class="ab-sent-section"><h4 class="ab-sent-title">Ticket<\/h4><dl class="ab-sent-fields">/);
  assert.match(markup, /<dt>Short description<\/dt><dd>VPN drops every hour<\/dd>/);
  assert.match(markup, /<span class="ab-mask-chip" title="\[PERSON_1\]">Person 1<\/span>/);
  assert.ok(!markup.includes('&lt;ticket_data') && !markup.includes('<ticket_data'), 'no markup of the request in the readable view');
  // the rules and the exact text are folded: their buttons point down, their text is not there until opened
  assert.match(markup, /<button type="button" class="ab-disclosure-toggle" aria-expanded="false"><svg[^>]*class="ab-icon ab-chevron"[\s\S]*?<\/svg>The rules sent with it<\/button>/);
  assert.match(markup, /aria-expanded="false"><svg[^>]*class="ab-icon ab-chevron"[\s\S]*?<\/svg>Show the exact text<\/button>/);
  assert.ok(markup.indexOf('ab-sent') < markup.indexOf('The rules sent with it'), 'data first');
  assert.ok(!markup.includes('Rules set by the application') && !markup.includes('ab-preview-exact'), 'nothing of the folded text is drawn');
  assert.match(markup, /Hide something else/);
  assert.match(markup, />Send to AI<\/button>/);
  assert.ok(!markup.includes('Abel Tuter'));
});

test('the short check names the other records and offers the full text; Send and Cancel stay', () => {
  const prepared = prepare('next-best-action', withReference());
  const markup = dialog({ prepared, short: true, others: '3 solved tickets and 2 articles' });
  assert.match(markup, /Send to the AI\?/);
  assert.match(markup, /Uses 3 solved tickets and 2 articles from other tickets\./);
  assert.match(markup, />Show what is sent<\/button>/);
  assert.match(markup, />Cancel<\/button>/);
  assert.match(markup, />Send to AI<\/button>/);
  assert.ok(!markup.includes('ab-preview') && !markup.includes('ab-sent'), 'no text until asked for');
  assert.match(markup, /Personal details are hidden before anything leaves:/, 'what was hidden is said here too');
  // short asked for but nothing to name: the full check
  assert.match(dialog({ prepared, short: true, others: '' }), /Check before sending/);
});

// ---- around an answer ------------------------------------------------------------------------------------------------------

test('what an answer was made without: plain words, once each, quiet sources left out', () => {
  const access = [
    { source: 'sys_journal_field', status: 'denied' },
    { source: 'journal', status: 'error' },
    { source: 'task_sla', status: 'blocked' },
    { source: 'sys_user', status: 'denied' },
    { source: 'kb_use', status: 'empty-or-hidden' },
    { source: 'sn_hr_core_case', status: 'skipped' },
    { source: 'sysapproval_approver', status: 'ok' },
    { source: 'incident', status: 'empty' },
    null,
  ];
  assert.deepEqual(madeWithout(access), ['notes and comments', 'SLAs', 'article links', 'HR cases']);
  assert.equal(madeWithoutLine(madeWithout(access)), 'Made without: notes and comments, SLAs, article links, HR cases.');
  assert.equal(madeWithoutLine(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 'Made without: a, b, c, d, e and 2 more.');
  assert.equal(madeWithoutLine([]), '');
  assert.deepEqual(madeWithout(undefined), []);
  // (a table nobody listed is called by the words of its name, src/lib/tableLabels.js, never by the name and no longer "some information")
  assert.deepEqual(madeWithout([{ source: 'u_custom_table', status: 'denied' }]), ['custom tables']);
});

test('after an error: Try again where it can help, Open Settings where the fix is', () => {
  assert.deepEqual(errorNextSteps('BAD_KEY'), { retry: false, settings: true });
  assert.deepEqual(errorNextSteps('RATE_LIMIT'), { retry: true, settings: false });
  assert.deepEqual(errorNextSteps('TIMEOUT'), { retry: true, settings: true });
  assert.deepEqual(errorNextSteps('HR_BLOCKED'), { retry: false, settings: false });
  assert.deepEqual(errorNextSteps('BLOCKED_FIELD'), { retry: false, settings: false });
  assert.deepEqual(errorNextSteps(''), { retry: true, settings: false }, 'a lost page or an unknown error may work again');
  assert.deepEqual(errorNextSteps('mode_too_low'), { retry: false, settings: true });
});

test('while waiting: the seconds, the try after a busy answer, a word when it is slow', () => {
  assert.equal(waitingText({ since: 1000, now: 1500 }), 'Waiting for the AI…');
  assert.equal(waitingText({ since: 1000, now: 13000 }), 'Waiting for the AI · 12 s…');
  assert.match(waitingText({ since: 1000, now: 41000 }), /^Waiting for the AI · 40 s\. Long tickets/);
  assert.equal(waitingText({ since: 1000, now: 21000, attempt: 2, attempts: 3 }), 'Waiting for the AI · 20 s. It was busy, so Agent Buddy is trying again (try 2 of 3).');
  assert.match(waitingText({ since: 0, now: 5, attempt: 9, attempts: 3 }), /try 3 of 3/);
});
