// The contract between every prompt and the code that uses its answer.
//
//  - Every request says the data is untrusted (once, in the firewall's rules after the task); every prompt says which language to
//    write in, caps the length, and holds no ticket data.
//  - Every text a customer or requester reads carries the customer rules (no internal notes, no gaps to fill in, their language).
//  - Wherever the panel reads an answer back (an Insert that takes one part of it, the email subject, the lines of a ticket
//    proposal), the labels the prompt asks for are exactly the labels the parser looks for, and an answer written the way the
//    prompt says survives the trip through the safe renderer (parseSafeText -> toPlainText) and comes out in the right place.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featureById, insertsFor } from '../src/features/registry.js';
import { CUSTOMER_SAFE, LANGUAGE_AGENT, LANGUAGE_CUSTOMER, LANGUAGE_SOURCE, ONLY_OUTPUT, UNTRUSTED, UNTRUSTED_MARK, rulesFor } from '../src/prompts/rules.js';
import { parseSafeText, toPlainText } from '../src/render/safeText.js';
import { ARTICLE_LABELS, pickArticleBody, pickArticleTitle } from '../src/itsm/sections.js';
import { PROBLEM_HEADINGS } from '../src/features/packs/domain.js';
import { CHAT_SUMMARY_HEADINGS } from '../src/features/packs/knowledge.js';
import { PROPOSAL_LABELS, parseTicketProposal } from '../src/compose/notesToTicket.js';
import { EMAIL_TYPES, parseEmailDraft } from '../src/compose/emailRecommend.js';
import { pickRequesterQuestions, pickResolutionNotes } from '../src/features/picks.js';
import { RULES_PREAMBLE, createFirewall } from '../src/pii/firewall.js';

const system = (id) => featureById(id).system;
const plainOf = (answer) => toPlainText(parseSafeText(answer));
/** What the n-th Insert button of a feature puts into the field, exactly as ResultView computes it. */
function insertValue(id, answer, n = 0) {
  const spec = insertsFor(featureById(id))[n];
  const plain = plainOf(answer);
  return typeof spec.pick === 'function' ? String(spec.pick(plain) || '').trim() : plain;
}
/** The labels appear in the prompt, each followed by a colon, in this order. */
function assertLabelsInOrder(id, labels) {
  let from = 0;
  for (const label of labels) {
    const at = system(id).indexOf(`${label}:`, from);
    assert.ok(at >= from, `${id}: "${label}:" is in the prompt, after the label before it`);
    from = at + label.length;
  }
}

// Texts that someone outside the support team reads: the customer, the requester, an approver.
const CUSTOMER_FEATURES = ['reply-draft', 'missing-info', 'request-explain', 'chat-reply', ...EMAIL_TYPES.map((t) => t.featureId)];
// Features whose input is text the agent wrote (they keep its language); reports are about the team, not a ticket.
const REWRITES = FEATURES.filter((f) => f.id.startsWith('rewrite-')).map((f) => f.id);
const REPORTS = ['shift-handover', 'coaching-snapshot', 'dashboard-insights'];

// ---- Rules every prompt carries ---------------------------------------------------------------------------------------

// The untrusted-data rule is said ONCE per request, by the firewall: it is part of the rules it appends to every system message,
// right after the feature's task (RULES_PREAMBLE, src/pii/firewall.js). It used to be written into every prompt as well (rulesFor),
// so every request said it twice. The test therefore looks at what the model really gets: each feature's request, built by the real
// firewall, must carry the rule in its SYSTEM message (with the task, where the model gives it the most weight), and exactly once.
// Prompts that still write the sentence themselves (their packs are owned by other areas and keep it until they drop it) are allowed
// to say it twice; none may say it zero times. (The report prompts dropped it in round 3.)
const STILL_SAID_IN_PROMPT = new Set([]);
const countRule = (text) => (text.match(new RegExp(UNTRUSTED_MARK.source, 'gi')) || []).length;

test('every request says that the data cannot give orders: in the system message, once', () => {
  assert.match(UNTRUSTED, UNTRUSTED_MARK);
  assert.ok(RULES_PREAMBLE.includes(UNTRUSTED), 'the firewall says it, in the shared wording');
  for (const f of FEATURES) {
    const sealed = createFirewall().buildRequest({
      feature: f.id,
      table: 'incident',
      system: f.system,
      userInstruction: f.instruction,
      parts: [{ label: 'Short description', field: 'short_description', text: 'Printer on floor 3 is jamming', inline: true }],
    });
    const [system, user] = sealed.messages;
    assert.equal(countRule(user.content), 0, `${f.id}: the rule is not in the user message`);
    const times = countRule(system.content);
    assert.ok(times >= 1, `${f.id}: the system message carries the untrusted-data rule`);
    if (!STILL_SAID_IN_PROMPT.has(f.id)) assert.equal(times, 1, `${f.id}: said once (the prompt need not repeat it)`);
  }
});

test('the shared rule sentences do not repeat the untrusted-data rule (the firewall says it)', () => {
  for (const audience of ['agent', 'customer', 'published']) assert.doesNotMatch(rulesFor(audience), UNTRUSTED_MARK, audience);
});

test('every prompt is fixed text: no template hole, no ticket data', () => {
  for (const f of FEATURES) {
    const text = `${f.system}\n${f.instruction}`;
    assert.ok(!/\{\{|\$\{|<ticket_data|<\/ticket_data/.test(text), `${f.id}: template hole or delimiter`);
    assert.ok(!/@[\w.-]+\.[a-z]{2,}|\b(?:INC|RITM|REQ|CHG|PRB|SCTASK|CS|HRC)\d{5,}\b|\b\d{3}[ -]\d{4}\b/.test(text), `${f.id}: looks like ticket data`);
    // A literal redaction token ("[PERSON_1]") in a prompt is neutralised by the firewall before it is sent (it would reach the
    // model as "(PERSON_1)" and contradict the preamble), so prompts describe the tokens instead of writing one.
    assert.ok(!/\[[A-Z]+_\d+\]/.test(text), `${f.id}: a literal redaction token`);
  }
});

test('every text a customer, requester or approver reads carries the customer rules', () => {
  for (const id of CUSTOMER_FEATURES) {
    for (const rule of [CUSTOMER_SAFE, LANGUAGE_CUSTOMER, ONLY_OUTPUT]) assert.ok(system(id).includes(rule), `${id}: ${rule.slice(0, 40)}`);
  }
  // (The untrusted-data rule is the firewall's: see the test above.)
  assert.equal(rulesFor('customer'), [CUSTOMER_SAFE, LANGUAGE_CUSTOMER, ONLY_OUTPUT].join(' '));
});

test('every prompt says which language to write in, and that the labels stay as written', () => {
  for (const f of FEATURES) {
    if (REPORTS.includes(f.id)) continue;
    if (REWRITES.includes(f.id)) {
      assert.match(f.system, /Keep the language of the original unless the task says to translate/, f.id);
      continue;
    }
    const rule = [LANGUAGE_AGENT, LANGUAGE_CUSTOMER, LANGUAGE_SOURCE].find((r) => f.system.includes(r));
    assert.ok(rule, `${f.id}: a language rule`);
  }
  for (const rule of [LANGUAGE_AGENT, LANGUAGE_CUSTOMER, LANGUAGE_SOURCE]) assert.match(rule, /exactly as written/);
});

test('every prompt caps the length of the answer (a rewrite follows the length of its text)', () => {
  for (const f of FEATURES) {
    if (REWRITES.includes(f.id)) continue;
    assert.match(f.system, /\bat most \d+ (?:words|steps|lines|characters)\b|\bat most \$\{|\bAt most \d+ words\b/i, `${f.id}: a length cap`);
  }
});

// ---- Answers the panel reads back ---------------------------------------------------------------------------------------

test('"What is missing?": the customer comment gets the questions, never the agent\'s "Missing:" line', () => {
  assertLabelsInOrder('missing-info', ['Missing']);
  const answer = [
    'Missing: affected device, exact error text, business impact',
    '',
    'To help us fix this quickly, could you tell us:',
    '',
    '1. Which laptop or phone shows the problem? (so we check the right device)',
    '2. What does the error message say, word for word? (so we can search for it)',
    '3. How many people are affected? (so we set the right priority)',
  ].join('\n');
  const value = insertValue('missing-info', answer);
  assert.ok(!/missing:/i.test(value), value);
  assert.ok(!/business impact/.test(value), 'the agent\'s checklist stays out');
  assert.match(value, /^To help us fix this quickly/);
  assert.match(value, /1\. Which laptop/);
  assert.match(value, /3\. How many people/);
  // Bold label, questions straight after it.
  assert.equal(insertValue('missing-info', '**Missing:** error text\n1. What does the error say?').trim(), '1. What does the error say?');
  // Nothing but the agent's line: nothing to insert (the view offers Copy).
  assert.equal(pickRequesterQuestions('Missing: nothing, the ticket is complete.'), '');
  // An answer that ignored the layout still gives its questions.
  assert.match(pickRequesterQuestions('1. When did it start?\n2. Does a restart help?'), /When did it start/);
});

test('resolution notes: the "Suggested close code" advice is shown but not inserted into the notes', () => {
  assertLabelsInOrder('resolution-notes', ['Cause', 'Fix', 'Verification', 'Suggested close code']);
  const answer = 'Cause: an expired VPN certificate.\nFix: renewed the certificate and restarted the client.\nVerification: the caller confirmed the VPN connects.\nSuggested close code: Solved (Permanently)';
  const value = insertValue('resolution-notes', answer);
  assert.match(value, /^Cause: an expired VPN certificate\./);
  assert.match(value, /Verification: the caller confirmed/);
  assert.ok(!/close code/i.test(value), value);
  assert.ok(!/Solved \(Permanently\)/.test(value));
  // The same with markdown around the labels, and with the code on its own line below its label.
  const marked = insertValue('resolution-notes', '**Cause:** disk full\n\n**Fix:** cleared the temp folder\n\n**Verification:** Not confirmed with the customer\n\n**Suggested close code:**\nSolved (Work Around)');
  assert.ok(!/close code|Work Around/i.test(marked), marked);
  assert.match(marked, /Fix:\s*cleared the temp folder/);
  assert.equal(pickResolutionNotes('Cause: x\nFix: y\nVerification: z'), 'Cause: x\nFix: y\nVerification: z', 'nothing to drop');
});

test('the knowledge article draft: the prompt\'s labels are the parser\'s, title and body land in the right fields', () => {
  assertLabelsInOrder('kb-article-draft', ARTICLE_LABELS);
  assert.ok(system('kb-article-draft').includes('Similar article exists: <article number> <article title>. Consider updating it instead.'));
  const answer = [
    'Similar article exists: KB0010001 Reset your VPN password. Consider updating it instead.',
    'Title: VPN client says the certificate has expired',
    'Symptoms: The VPN client refuses to connect and shows a certificate error.',
    'Cause: The device certificate expired.',
    'Resolution: Renew the certificate from the self-service portal.',
    'Steps:',
    '1. Open the company portal.',
    '2. Choose Renew certificate.',
    'Applies to: Windows laptops with the corporate VPN client.',
  ].join('\n');
  assert.equal(insertValue('kb-article-draft', answer, 0), 'VPN client says the certificate has expired');
  const body = insertValue('kb-article-draft', answer, 1);
  assert.match(body, /^Symptoms: The VPN client refuses/);
  assert.match(body, /Applies to: Windows laptops/);
  assert.ok(!/Similar article exists|Title:/.test(body));
  assert.equal(pickArticleTitle(plainOf(answer)), insertValue('kb-article-draft', answer, 0));
  assert.equal(pickArticleBody(plainOf(answer)), body);
});

test('the problem write-up: the prompt\'s headings are the ones its three Insert buttons look for', () => {
  assertLabelsInOrder('problem-rca', PROBLEM_HEADINGS);
  const answer = PROBLEM_HEADINGS.map((h) => `${h}: text for ${h.toLowerCase()}.`).join('\n');
  const inserts = insertsFor(featureById('problem-rca'));
  assert.deepEqual(inserts.map((i) => i.field), ['description', 'cause_notes', 'workaround']);
  assert.equal(insertValue('problem-rca', answer, 0), 'text for problem statement.');
  assert.equal(insertValue('problem-rca', answer, 1), 'text for probable cause.');
  assert.equal(insertValue('problem-rca', answer, 2), 'text for workaround.');
});

test('the chat summary: the ticket notes Insert takes the "Suggested ticket notes" section', () => {
  assertLabelsInOrder('chat-summary', CHAT_SUMMARY_HEADINGS);
  const answer = 'Summary: The customer could not log in.\nOutcome: resolved - password reset.\nFollow-ups:\n- None\nSuggested ticket notes:\n- Issue: login failure\n- Tried: password reset\n- Result: works';
  const value = insertValue('chat-summary', answer);
  assert.match(value, /Issue: login failure/);
  assert.ok(!/Summary:|Outcome:/.test(value), value);
});

test('notes to ticket: every label the parser reads is named in the prompt, and an answer in that layout is read back', () => {
  for (const label of PROPOSAL_LABELS) assert.ok(system('notes-to-ticket').toLowerCase().includes(`${label}:`), `"${label}:" is asked for`);
  const answer = [
    'Short description: Outlook keeps asking for the password',
    'Description: Since this morning Outlook asks for the password every few minutes. A restart did not help.',
    'Impact: Low',
    'Urgency: Medium',
    'Category hint: email',
    'Contact type: Phone',
    'Questions still to ask:',
    '1. Which version of Outlook?',
  ].join('\n');
  const p = parseTicketProposal(plainOf(answer));
  assert.equal(p.shortDescription, 'Outlook keeps asking for the password');
  assert.match(p.description, /restart did not help/);
  assert.deepEqual([p.impact, p.urgency, p.contactType, p.categoryHint], ['Low', 'Medium', 'phone', 'email']);
  assert.deepEqual(p.questions, ['Which version of Outlook?']);
  assert.match(system('notes-to-ticket'), /High, Medium or Low/);
});

test('every email: the "Subject:" line the prompt asks for is the one the email form reads', () => {
  for (const t of EMAIL_TYPES) assert.match(system(t.featureId), /the first line is "Subject:"/, t.featureId);
  const draft = parseEmailDraft(plainOf('Subject: Your VPN request INC update\n\nHello Abel,\n\nThe certificate was renewed.\n\nKind regards'));
  assert.equal(draft.subject, 'Your VPN request INC update');
  assert.match(draft.body, /^Hello Abel,/);
});

test('fixed layouts are spelled out for the answers people read line by line', () => {
  assertLabelsInOrder('record-summary', ['Issue', 'Impact', 'Done so far', 'Current state', 'Next step']);
  assertLabelsInOrder('sentiment-risk', ['Mood', 'Escalation risk', 'What triggered it', 'Suggested approach']);
  assertLabelsInOrder('routing-hint', ['Category', 'Assignment group', 'Priority']);
  assertLabelsInOrder('resolution-improve', ['Cause', 'Fix', 'Verification']);
  assertLabelsInOrder('thread-summary', ['Decisions', 'Open questions', 'Who owns what', 'Next']);
  assert.ok(system('next-best-action').includes('"- [ ] "'));
  assert.match(system('rewrite-bilingual'), /three dashes \(---\)/);
});
