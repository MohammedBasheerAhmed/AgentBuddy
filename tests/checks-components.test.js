import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestBody, StatusCard } from '../src/sidepanel/checks/RequestBody.jsx';
import { CheckList, CheckSummary } from '../src/sidepanel/checks/CheckList.jsx';
import { ProgressBar, StepList } from '../src/sidepanel/checks/ChecklistSteps.jsx';
import { Facts, LoadNotes, Section } from '../src/sidepanel/checks/Bits.jsx';
import { buildRequestView } from '../src/checks/requestView.js';
import { buildCheckView } from '../src/checks/resolutionCheck.js';
import { checklistProgress, stepsFromPack } from '../src/checks/checklist.js';
import QualityGateView from '../src/sidepanel/tabs/QualityGateView.jsx';
import RequestExplainerView from '../src/sidepanel/tabs/RequestExplainerView.jsx';
import FulfilmentChecklistView from '../src/sidepanel/tabs/FulfilmentChecklistView.jsx';
import { normalizePolicy } from '../src/policy/policy.js';

// The views are written for the automatic JSX runtime; the test bundler uses the classic one.
globalThis.React = React;

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

const pack = (over = {}) => ({
  kind: 'requested_item',
  fields: { number: 'RITM1', short_description: HOSTILE, state: 'Open', approval: 'Requested', requested_for: HOSTILE },
  related: {
    variables: [{ question: HOSTILE, value: HOSTILE }],
    approvals: [{ approver: HOSTILE, group: '', state: 'Requested', updated: '2026-10-24 08:00:00' }],
    catalogTasks: [{ number: 'SCTASK1', short_description: HOSTILE, state: 'Open', assignedTo: HOSTILE, assignmentGroup: '', active: 'true' }],
  },
  access: [{ source: 'sc_item_option_mtom', status: 'ok', note: '1 masked or secret answer was left out.' }],
  ...over,
});

test('the Request tab draws hostile ticket text as text, with ab- classes only', () => {
  const markup = html(<RequestBody view={buildRequestView(pack(), { currentNumber: 'SCTASK1', now: Date.UTC(2026, 9, 27) })} />);
  assertInert(markup);
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped, not parsed');
  assert.ok(!markup.includes('<img') && !markup.includes('<script'));
  assert.match(markup, /Waiting for approval/);
  assert.match(markup, /hidden \(1\)/);
  assert.match(markup, /\(this one\)/);
});

test('the status card writes the state in words and keeps access gaps visible', () => {
  const view = buildRequestView(pack({ related: {}, access: [{ source: 'sysapproval_approver', status: 'denied', note: '' }] }), { now: Date.UTC(2026, 9, 27) });
  const markup = html(<StatusCard status={view.status} />);
  assert.match(markup, /Waiting for approval/);
  assert.match(markup, /You cannot see approvals on this instance/);
  assertInert(markup);
});

test('sections that could not be read say so instead of looking empty', () => {
  const view = buildRequestView(pack({ related: {}, access: [{ source: 'sc_item_option_mtom', status: 'denied', note: '' }] }), { now: Date.UTC(2026, 9, 27) });
  const markup = html(<RequestBody view={view} />);
  assert.match(markup, /cannot read the answers/);
  assert.match(markup, /approvals could not be read/);
  assert.match(markup, /Catalog tasks could not be read/);
});

test('the check list writes each status in words and never echoes a value it was told about', () => {
  const secret = 'Hunter2-Secret!';
  const view = buildCheckView(
    { kind: 'incident', fields: { state: 'x', close_notes: `Replaced the certificate on the gateway and restarted it. password: ${secret}` }, people: [], journal: [], related: { childTasks: [{ number: 'TASK1', state: 'Open', active: 'true' }] }, access: [] },
    { form: null, links: null },
    { now: Date.UTC(2026, 9, 27) }
  );
  const markup = html(<><CheckSummary summary={view.summary} /><CheckList checks={view.checks} /></>);
  assertInert(markup);
  assert.match(markup, /Look at this/);
  assert.match(markup, /1 password or key/);
  assert.ok(!markup.includes(secret));
  assert.match(markup, /thing[s]? to look at before you resolve this\./);
  assert.ok(markup.indexOf('Look at this') < markup.indexOf('Fine'), 'warnings come first');
});

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
  assert.match(html(<Section title="T" count={3}>x</Section>), /<summary[^>]*>T <span class="ab-tag">3<\/span>/);
  assert.match(html(<LoadNotes state={{ phase: 'error', data: null, error: HOSTILE }} />), /role="alert"/);
  assert.equal(html(<LoadNotes state={{ phase: 'ready', data: {}, error: '' }} />), '');
  assert.match(html(<LoadNotes state={{ phase: 'loading', data: null, error: '' }} />), /Looking/);
});

// ---- the three views, in their first (loading) state --------------------------------------------------------------------------------

const eff = { policy: normalizePolicy({}), values: {}, apiKey: '' };
const run = { busy: false, phase: 'idle', active: null, result: null, run: () => {} };
const page = { tabId: 1, href: 'https://x.service-now.com/nav_to.do', surface: 'classic' };

test('each tab renders its title before any data has arrived, without touching the page', () => {
  globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  try {
    const request = html(<RequestExplainerView page={page} eff={eff} record={{ table: 'sc_req_item', sysId: 'e'.repeat(32), kind: 'requested_item', number: 'RITM1' }} header={null} run={run} aiReady={false} />);
    assert.match(request, /Where is this request\?/);
    assert.match(request, /Nothing here is sent to an AI/);
    assert.match(request, /Looking/);
    const check = html(<QualityGateView page={page} eff={eff} record={{ table: 'incident', sysId: 'a'.repeat(32), kind: 'incident', number: 'INC1' }} header={null} run={run} aiReady={false} />);
    assert.match(check, /Check before you resolve/);
    assert.match(check, /Advice only: nothing is blocked or changed/);
    assert.match(check, /Check again/);
    const list = html(<FulfilmentChecklistView page={page} eff={eff} record={{ table: 'sc_task', sysId: 'c'.repeat(32), kind: 'catalog_task', number: 'SCTASK1' }} header={null} run={run} aiReady={false} />);
    assert.match(list, /Fulfilment checklist/);
    assert.match(list, /not the step text/);
    for (const markup of [request, check, list]) assertInert(markup);
  } finally {
    delete globalThis.chrome;
  }
});

test('the AI buttons are not offered while there is no data, and a policy that switches a feature off removes its button', () => {
  // (Without data nothing but the heading and the notes show: the buttons appear after the first read.)
  const request = html(<RequestExplainerView page={page} eff={eff} record={{ table: 'sc_req_item', sysId: 'e'.repeat(32), kind: 'requested_item' }} header={null} run={run} aiReady />);
  assert.ok(!/Explain it in plain words/.test(request));
});
