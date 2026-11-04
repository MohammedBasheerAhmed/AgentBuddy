import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import ResultView from '../src/sidepanel/ResultView.jsx';
import InsertFindings from '../src/sidepanel/InsertFindings.jsx';
import { RunError, RunProgress } from '../src/sidepanel/ticket/assist/answers/RunStatus.jsx';
import { featureById } from '../src/features/registry.js';

// The answer on the Write and Knowledge screens (and a draft waiting on a blank form), in the calm answer look of the redesign: a soft
// surface with no border, the grey AI spark and the title, the text through SafeText, then the buttons, with at most one filled: the
// first Insert of an answer that goes into a form. An answer that is only copied fills none (the screen has its own next step).

const A = 'a'.repeat(32);
const page = { tabId: 7, href: `https://acme.service-now.com/incident.do?sys_id=${A}`, record: { table: 'incident', sysId: A, number: 'INC0010001', kind: 'incident' } };
const noop = () => {};
const card = (props) => renderToStaticMarkup(<ResultView text="We restarted the gateway. Please try again." page={page} people={[]} scan={null} onClose={noop} audit={noop} {...props} />);
const filled = (markup) => (markup.match(/class="[^"]*ab-btn-primary[^"]*"/g) || []).length;

test('the answer: a soft surface with the AI spark and its title, the text as safe text, the buttons below', () => {
  const markup = card({ feature: featureById('reply-draft'), source: { expect: { table: 'incident', sysId: A }, number: 'INC0010001' } });
  assert.match(markup, /^<section class="ab-surface ab-result" aria-labelledby="[^"]+"><div class="ab-result-head"><span class="ab-ai-badge"[^>]*><svg class="ab-icon ab-ai-spark"[^>]*aria-hidden="true"/, 'the shared AI mark, the grey spark');
  assert.match(markup, /<h2 class="ab-result-title" id="[^"]+" tabindex="-1">Draft a reply to the customer<\/h2>/);
  assert.ok(!markup.includes('ab-card'), 'no bordered card');
  assert.match(markup, /<div class="ab-output ab-result-body"><div class="ab-safe-text"><p class="ab-safe-p">We restarted the gateway\. Please try again\.<\/p><\/div><\/div>/);
  assert.equal(filled(markup), 1, 'the first Insert is the one filled button');
  assert.match(markup, /<button type="button" class="ab-btn ab-btn-primary">Insert as customer comment<\/button>/);
});

test('an answer that is only copied (Write, Knowledge) fills no button: the screen around it has its own next step', () => {
  for (const id of ['kb-merge-draft', 'kb-gap-outline', 'notes-to-ticket']) {
    const markup = card({ feature: featureById(id) });
    assert.equal(filled(markup), 0, id);
    assert.match(markup, /<button type="button" class="ab-btn">Copy<\/button>/, id);
  }
});

test('what the review found before an insert: a quiet warning block that still stops the insert and is announced', () => {
  const markup = renderToStaticMarkup(<InsertFindings field="comments" items={[{ advice: 'A card number:', excerpt: '[CARD_1]' }]} busy={false} onInsertAnyway={noop} onEditFirst={noop} />);
  assert.match(markup, /^<div class="ab-note ab-note-warn ab-findings-box" role="alert"><p class="ab-findings-head"><svg class="ab-icon ab-findings-icon"/);
  assert.match(markup, /<strong>Check before sending to the customer:<\/strong>/);
  assert.match(markup, />Insert anyway<\/button>/);
  assert.match(markup, />Edit first<\/button>/);
});

test('while waiting: the grey spark only while the AI is asked; an error keeps its alert and its next steps', () => {
  const sending = renderToStaticMarkup(<RunProgress run={{ phase: 'sending', since: Date.now() }} onStop={noop} />);
  assert.match(sending, /^<div class="ab-note ab-runstatus" role="status"><span class="ab-ai-badge"><svg class="ab-icon ab-ai-spark"/);
  assert.match(sending, />Stop waiting<\/button>/);
  const reading = renderToStaticMarkup(<RunProgress run={{ phase: 'reading' }} onStop={noop} readingText="Reading…" />);
  assert.ok(!reading.includes('ab-ai-badge') && reading.includes('Reading…'));
  assert.equal(renderToStaticMarkup(<RunProgress run={{ phase: 'idle' }} onStop={noop} />), '');
  const failed = renderToStaticMarkup(<RunError error="The AI service is busy." code="BUSY" onRetry={noop} />);
  assert.match(failed, /class="ab-note ab-note-danger ab-errnote ab-runerror" role="alert"/);
  assert.match(failed, />Try again<\/button>/);
});
