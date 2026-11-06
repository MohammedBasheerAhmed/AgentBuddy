import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionGroups, FocusActions, actionPlan, useActionPlan } from '../src/sidepanel/ticket/assist/actions/index.js';
import { featureById } from '../src/features/registry.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The AI Assist actions of the Ticket screen as a person sees them (docs/focus-layout.md): five rows, one per pain point, each with
// its pain point as a small label above it; one filled "Start" at most (the one that fits the ticket's state); the AI mark on every
// action; a reason on a disabled one. Everything else the record offers is in All tools, not here.

const A = 'a'.repeat(32);
const rec = (kind, table = kind) => ({ kind, table, sysId: A, number: 'INC0010001' });
const head = (state, extra = {}) => ({ number: 'INC0010001', short_description: 'VPN', state, priority: '3 - Moderate', ...extra });
const eff = ({ values = {}, policy = {} } = {}) => ({
  ready: true,
  apiKey: 'k',
  values: { piiMode: 'standard', profiles: ['it', 'req', 'csm'], provider: 'openai', model: 'm', ...values },
  locked: {},
  policy: normalizePolicy(policy),
});
const page = { tabId: 7, href: 'https://x.service-now.com/incident.do?sys_id=' + A, surface: 'classic', record: rec('incident') };
const html = (props) => renderToStaticMarkup(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} busy={false} aiReady onRun={() => {}} {...props} />);
const planOf = (kind = 'incident', state = 'In Progress') => actionPlan({ record: rec(kind), header: head(state), eff: eff() });
const count = (markup, re) => (markup.match(re) || []).length;

test('five rows at most, one per pain point, each named above its row; one filled "Start", on the action that fits the state', () => {
  const markup = html();
  const plan = planOf();
  const rows = count(markup, /class="ab-row ab-act ab-act-row[^"]*" data-feature/g);
  assert.equal(rows, plan.five.length);
  assert.ok(rows >= 4 && rows <= 5, String(rows));
  const labels = [...markup.matchAll(/<p class="ab-act-pain">([^<]+)<\/p><button/g)].map((m) => m[1]);
  assert.deepEqual(labels, plan.five.map((f) => f.painTitle), 'the label right above its button, outside it');
  assert.ok(labels.every((l) => ['Understand the ticket', 'Find the fix', 'Same caller', 'Reply', 'Close well'].includes(l)));
  assert.equal(count(markup, /ab-act-primary/g), 1);
  assert.match(markup, /class="ab-row ab-act ab-act-row ab-act-primary" data-feature="reply-draft"/);
  assert.equal(count(markup, /class="ab-act-start"[^>]*>Start</g), 1);
  assert.equal(count(markup, /class="ab-act-icon"/g), rows);
  assert.ok(!/More actions/.test(markup), 'no folded list: the rest is in All tools');
  assert.ok(!/Suggested/.test(markup));
  assert.ok(!/ab-btn-ai/.test(markup), 'no AI colour: the AI mark is the small grey spark');
});

test('every action carries the AI mark and says where text goes on hover; each row has one line of description', () => {
  const markup = html();
  const actions = count(markup, /<button type="button" class="[^"]*ab-act[^"]*" data-feature/g);
  assert.equal(count(markup, /class="ab-ai-badge"/g), actions);
  assert.match(markup, /title="Sends masked text to [^"]+\. You see it first\."/);
  assert.equal(count(markup, /class="ab-row-sub ab-act-desc"/g), actions);
});

test('a button\'s text starts with its action\'s title (the pain point label is not inside it)', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ui = await mount(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} aiReady onRun={() => {}} />);
  try {
    for (const button of ui.$$('button.ab-act-row')) {
      const title = featureById(button.getAttribute('data-feature')).title;
      assert.ok(button.textContent.trim().startsWith(title), `${button.textContent} starts with ${title}`);
    }
  } finally {
    await ui.unmount();
  }
});

test('an answer with its own filled main button on screen ("quiet"): the actions stay usable, none is filled', () => {
  const markup = html({ quiet: true });
  assert.equal(count(markup, /ab-act-primary/g), 0);
  assert.ok(!/data-feature="reply-draft" disabled=""/.test(markup));
});

test('AI not usable now, or an answer on its way: every action is off and none is filled', () => {
  for (const props of [{ aiReady: false }, { busy: true }]) {
    const markup = html(props);
    assert.equal(count(markup, /ab-act-primary/g), 0);
    const actions = count(markup, /data-feature=/g);
    assert.equal(count(markup, /<button type="button" class="[^"]*ab-act[^"]*" data-feature="[^"]+" disabled=""/g), actions);
  }
});

test('the state decides the filled row: a new ticket the summary, a resolved one the resolution notes, a closed one no reply row', () => {
  assert.match(html({ header: head('New') }), /ab-act-primary" data-feature="record-summary"/);
  // (round 4: Prepare to close is the fifth slot's action and the primary of a resolved ticket)
  assert.match(html({ header: head('Resolved') }), /ab-act-primary" data-feature="prepare-close"/);
  const closed = html({ header: head('Closed') });
  assert.ok(!/data-feature="reply-draft"/.test(closed));
  assert.ok(!/<p class="ab-act-pain">Reply</.test(closed));
});

test('a reason that stops every action is said once, above them; a reason for one action is on that action', () => {
  const blocked = renderToStaticMarkup(<ActionGroups page={page} eff={eff({ policy: { blockedTables: ['incident'] } })} record={rec('incident')} header={head('In Progress')} aiReady onRun={() => {}} />);
  assert.equal(count(blocked, /does not allow Agent Buddy to use incident records/g), 1);
  const hr = renderToStaticMarkup(
    <ActionGroups page={page} eff={eff({ values: { profiles: ['hr'] }, policy: { allowHrContent: true, aiProvider: 'openai' } })} record={rec('hr_case', 'sn_hr_core_case')} header={head('Work in Progress')} aiReady onRun={() => {}} />
  );
  assert.match(hr, /HR records need Strict privacy mode/);
  assert.equal(count(hr, /HR records need Strict privacy mode/g), 1, 'never the same sentence twice');
  // One action that needs Strict: on its own row, which stays (the slot is its), disabled.
  const strictReply = { ...featureById('reply-draft'), requires: { minMode: 'strict' } };
  const plan = actionPlan({ record: rec('incident'), header: head('In Progress'), eff: eff(), features: [featureById('record-summary'), strictReply] });
  const one = renderToStaticMarkup(<FocusActions plan={plan} eff={eff()} aiReady onRun={() => {}} />);
  assert.match(one, /data-feature="reply-draft" disabled=""/);
  assert.match(one, /class="ab-row-sub ab-act-desc ab-act-reason">Needs Strict privacy mode/);
  assert.match(one, /ab-act-primary" data-feature="record-summary"/, 'the mark moves to the next that can run');
});

test('a catalog task warns under the reply that the requester does not see its comments', () => {
  const markup = renderToStaticMarkup(<ActionGroups page={page} eff={eff()} record={rec('catalog_task', 'sc_task')} header={head('Work in Progress')} aiReady onRun={() => {}} />);
  assert.match(markup, /class="ab-act-caution">The requester does not see comments on a catalog task/);
});

test('nothing fits the record: said in words; only actions of the rest: no rows (All tools has them)', () => {
  const none = renderToStaticMarkup(<FocusActions plan={{ total: 0, five: [], rest: [], items: [], block: '', primary: '' }} eff={eff()} aiReady onRun={() => {}} />);
  assert.match(none, /No AI actions fit this record/);
  const kb = actionPlan({ record: rec('knowledge', 'kb_knowledge'), header: null, eff: eff({ values: { profiles: ['km'] } }) });
  const rest = renderToStaticMarkup(<FocusActions plan={kb} eff={eff()} aiReady onRun={() => {}} />);
  assert.equal(count(rest, /<button/g), 0);
  assert.ok(!/No AI actions fit/.test(rest), 'it has actions, just not one of the five');
});

// ---- live -------------------------------------------------------------------------------------------------------------------

test('a click runs the action through onRun', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ran = [];
  const ui = await mount(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} aiReady onRun={(f, o) => ran.push([f.id, o])} />);
  await click(ui.button(/^Draft a reply to the customer/));
  assert.deepEqual(ran, [['reply-draft', undefined]]);
  assert.ok(!ui.hasButton(/^More actions/));
  assert.ok(!ui.hasButton(/^Catch up on the discussion/), 'not one of the five: in All tools');
  await ui.unmount();
});

// The plan as the screen works it out (useActionPlan), its action ids drawn so a test can read them.
function PlanIds(props) {
  const plan = useActionPlan(props);
  return <p className="ids">{plan.items.map((it) => it.feature.id).join(' ')}</p>;
}

test('the checklist action is offered on a catalog task only when the written instructions have no steps', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const task = rec('catalog_task', 'sc_task');
  const reads = [];
  let description = 'Please sort this out.';
  fake.onRead('pack', (args) => {
    reads.push(args.feature);
    return { table: 'sc_task', sysId: A, kind: 'catalog_task', fields: { description }, people: [], journal: [], related: {}, access: [] };
  });
  const p = { ...page, record: task };
  let ui = await mount(<PlanIds page={p} eff={eff()} record={task} header={head('Work in Progress')} aiReady />);
  await settle();
  assert.deepEqual(reads, ['fulfilment-checklist']);
  assert.match(ui.$('p.ids').textContent, /\bfulfilment-checklist\b/, 'no steps found: offered');
  await ui.unmount();

  description = '1. Create the account\n2. Send the welcome email\n3. Close the task';
  ui = await mount(<PlanIds page={p} eff={eff()} record={task} header={head('Work in Progress')} aiReady />);
  await settle();
  assert.ok(!/\bfulfilment-checklist\b/.test(ui.$('p.ids').textContent), 'steps found: Insights has the checklist');
  await ui.unmount();
});

test('no read for the checklist where it cannot matter (an incident, or AI not usable)', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  let reads = 0;
  fake.onRead('pack', () => {
    reads += 1;
    return {};
  });
  const ui = await mount(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} aiReady onRun={() => {}} />);
  const task = rec('catalog_task', 'sc_task');
  const ui2 = await mount(<ActionGroups page={{ ...page, record: task }} eff={eff()} record={task} header={head('Open')} aiReady={false} onRun={() => {}} />);
  await settle();
  assert.equal(reads, 0);
  await ui.unmount();
  await ui2.unmount();
});

test('the plan holds every action the record offers, in the registry\'s order: the five and the rest together', () => {
  const plan = planOf();
  const ids = plan.items.map((it) => it.feature.id);
  assert.equal(ids.length, plan.total);
  assert.deepEqual([...ids].sort(), [...plan.five.map((f) => f.item), ...plan.rest].map((it) => it.feature.id).sort());
  assert.ok(plan.items.every((it) => 'reason' in it && 'caution' in it));
  const off = actionPlan({ record: rec('incident'), header: head('In Progress'), eff: eff({ policy: { blockedTables: ['incident'] } }) });
  assert.ok(off.block && off.items.length > 0, 'a record block still lists the actions; AI Assist says why once');
});
