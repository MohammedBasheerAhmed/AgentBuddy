import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgressBar, StepList } from '../src/sidepanel/checks/ChecklistSteps.jsx';
import { Facts } from '../src/sidepanel/checks/Bits.jsx';
import { checklistProgress, stepsFromPack } from '../src/checks/checklist.js';

const html = (element) => renderToStaticMarkup(element);
const HOSTILE = '<img src=x onerror=alert(1)> <script>alert(2)</script> [link](https://evil.example/)';

// Only these tags and attributes may ever appear; text that merely looks like markup is escaped by React.
const TAGS = new Set(['div', 'p', 'ul', 'li', 'span', 'dl', 'dt', 'dd', 'details', 'summary', 'section', 'h2', 'button', 'label', 'input']);
const ATTRIBUTES = new Set(['class', 'role', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'data-status', 'open', 'type', 'checked', 'disabled', 'style']);

function assertInert(markup) {
  for (const tag of markup.match(/<[^>]*>/g) || []) {
    const name = /^<\/?([a-zA-Z0-9]+)/.exec(tag);
    assert.ok(name && TAGS.has(name[1].toLowerCase()), `unexpected tag ${tag}`);
    const bare = tag.replace(/="[^"]*"/g, '=""'); // (values may hold spaces; only the names are checked)
    for (const attr of bare.matchAll(/\s([a-zA-Z_:-]+)(?==|\s|\/|>)/g)) assert.ok(ATTRIBUTES.has(attr[1]), `unexpected attribute ${attr[1]} in ${tag}`);
  }
  assert.ok(!/<[^>]*\s(href|src|on[a-z]+)\s*=/i.test(markup), 'no link target, source or event handler');
  const classes = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(classes.every((c) => c.startsWith('ab-')), classes.filter((c) => !c.startsWith('ab-')).join(','));
}

test('the tick list: one labelled check box per step, ticked ones marked, progress in words and as a progressbar', () => {
  const steps = stepsFromPack({ fields: { description: `1. Image the laptop\n2. ${HOSTILE}\n3. Deliver it` } });
  const progress = checklistProgress(steps, [steps[0].id]);
  const markup = html(<><ProgressBar progress={progress} /><StepList steps={steps} done={[steps[0].id]} onToggle={() => {}} /></>);
  assertInert(markup);
  assert.match(markup, /1 of 3 done/);
  assert.match(markup, /role="progressbar"[^>]*aria-valuenow="1"/);
  assert.equal((markup.match(/type="checkbox"/g) || []).length, 3);
  assert.equal((markup.match(/checked=""/g) || []).length, 1);
  assert.match(markup, /ab-chk-step-done/);
  assert.ok(markup.includes('&lt;img'));
  assert.ok(!markup.includes('<img'));
});

test('small pieces', () => {
  assert.match(html(<Facts rows={[{ label: 'Q', value: 'hidden', hidden: true }]} />), /ab-chk-hidden/);
});
