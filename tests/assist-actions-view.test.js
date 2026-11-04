import { mount, click, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionGroups, MoreActions, QuickBar } from '../src/sidepanel/ticket/assist/actions/index.js';
import { normalizePolicy } from '../src/policy/policy.js';

// The AI Assist actions and the quick bar of the Ticket screen as a person sees them: one primary button, three suggestions, the rest
// folded under "More actions", the AI mark on every action, a reason on a disabled one, and the clutter budget of TRACKER.md 2.4.

const A = 'a'.repeat(32);
const rec = (kind, table = kind) => ({ kind, table, sysId: A, number: 'INC0010001' });
const head = (state, extra = {}) => ({ number: 'INC0010001', short_description: 'VPN', state, priority: '3 - Moderate', ...extra });
const eff = ({ values = {}, policy = {} } = {}) => ({
  ready: true,
  apiKey: 'k',
  values: { piiMode: 'standard', profiles: ['it', 'req', 'csm'], provider: 'openai', model: 'm', quickBarOpen: true, quickPins: {}, ...values },
  locked: {},
  policy: normalizePolicy(policy),
});
const page = { tabId: 7, href: 'https://x.service-now.com/incident.do?sys_id=' + A, surface: 'classic', record: rec('incident') };
const html = (props) => renderToStaticMarkup(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} busy={false} aiReady onRun={() => {}} {...props} />);

const shownButtons = (markup) => {
  // (what is folded under "More actions" is not on screen; the small "Change format" links under an action are not action buttons)
  const before = markup.split('hidden=""')[0].replace(/<div class="ab-fmt-open"><p class="ab-fmt-line"><button[^>]*>.*?<\/button>/g, '');
  return (before.match(/<button/g) || []).length;
};

test('one primary button, three suggestions and "More actions": four buttons before anything is unfolded', () => {
  const markup = html();
  assert.equal((markup.match(/ab-act-primary/g) || []).length, 1);
  // The redesign: the suggestions are rows (an icon tile, the name, one line); the first carries the one filled mark, "Start".
  assert.match(markup, /class="ab-row ab-act ab-act-row ab-act-primary" data-feature="reply-draft"/);
  assert.equal((markup.match(/class="ab-act-start"[^>]*>Start</g) || []).length, 1);
  assert.equal((markup.match(/class="ab-act-icon"/g) || []).length, 3);
  assert.equal(shownButtons(markup), 4);
  assert.match(markup, /More actions \(\d+\)/);
  assert.match(markup, /Suggested while you work on it/);
  assert.ok(!/ab-btn-ai/.test(markup), 'no AI colour: the AI mark is the small grey spark');
});

test('every action carries the AI mark and says where text goes on hover; a suggested row has one line of description', () => {
  const markup = html();
  const actions = (markup.match(/<button type="button" class="[^"]*ab-act[^"]*" data-feature/g) || []).length;
  assert.ok(actions >= 8);
  assert.equal((markup.match(/class="ab-ai-badge"/g) || []).length, actions);
  assert.match(markup, /title="Sends masked text to [^"]+\. You see it first\."/);
  const rows = (markup.match(/class="ab-row ab-act ab-act-row[^"]*" data-feature/g) || []).length;
  assert.equal(rows, 3);
  assert.equal((markup.match(/class="ab-row-sub ab-act-desc"/g) || []).length, rows);
  // Under "More actions" the actions are small buttons; the description is on hover, with where the text goes.
  const pills = [...markup.matchAll(/<button type="button" class="ab-act ab-act-pill" data-feature="[^"]+" title="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(pills.length, actions - rows);
  assert.ok(pills.every((title) => /Sends masked text to [^"]+\. You see it first\.$/.test(title)), pills.join(' | '));
});

test('More actions groups the rest under Understand, Reply, Work it and Resolve', () => {
  const markup = html({ header: head('New') });
  const groups = [...markup.matchAll(/class="ab-act-grouphead"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(groups, ['Understand', 'Reply', 'Work it']);
});

test('an answer with its own filled main button on screen ("quiet"): the actions stay usable, none is filled', () => {
  const markup = html({ quiet: true });
  assert.equal((markup.match(/ab-act-primary/g) || []).length, 0);
  assert.ok(!/data-feature="reply-draft" disabled=""/.test(markup));
});

test('AI not usable now, or an answer on its way: every action is off and none is filled', () => {
  for (const props of [{ aiReady: false }, { busy: true }]) {
    const markup = html(props);
    assert.equal((markup.match(/ab-act-primary/g) || []).length, 0);
    const actions = (markup.match(/data-feature=/g) || []).length;
    assert.equal((markup.match(/<button type="button" class="[^"]*ab-act[^"]*" data-feature="[^"]+" disabled=""/g) || []).length, actions);
  }
});

test('a reason that stops every action is said once, above them; a reason for one action is on that action', () => {
  const blocked = renderToStaticMarkup(<ActionGroups page={page} eff={eff({ policy: { blockedTables: ['incident'] } })} record={rec('incident')} header={head('In Progress')} aiReady onRun={() => {}} />);
  assert.equal((blocked.match(/does not allow Agent Buddy to use incident records/g) || []).length, 1);
  const hr = renderToStaticMarkup(
    <ActionGroups page={page} eff={eff({ values: { profiles: ['hr'] }, policy: { allowHrContent: true, aiProvider: 'openai' } })} record={rec('hr_case', 'sn_hr_core_case')} header={head('Work in Progress')} aiReady onRun={() => {}} />
  );
  assert.match(hr, /HR records need Strict privacy mode/);
  assert.equal((hr.match(/HR records need Strict privacy mode/g) || []).length, 1, 'never the same sentence twice');
});

test('a catalog task warns under the reply that the requester does not see its comments', () => {
  const markup = renderToStaticMarkup(<ActionGroups page={page} eff={eff()} record={rec('catalog_task', 'sc_task')} header={head('Work in Progress')} aiReady onRun={() => {}} />);
  assert.match(markup, /class="ab-act-caution">The requester does not see comments on a catalog task/);
});

// ---- live -------------------------------------------------------------------------------------------------------------------

test('a click runs the action through onRun; More actions opens and closes the groups', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ran = [];
  const ui = await mount(<ActionGroups page={page} eff={eff()} record={rec('incident')} header={head('In Progress')} aiReady onRun={(f, o) => ran.push([f.id, o])} />);
  await click(ui.button(/^Draft a reply to the customer/));
  assert.deepEqual(ran, [['reply-draft', undefined]]);
  assert.ok(!ui.hasButton(/^Catch up on the discussion/), 'folded');
  const more = ui.button(/^More actions/);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  await click(more);
  assert.ok(ui.hasButton(/^Catch up on the discussion/));
  assert.equal(more.getAttribute('aria-expanded'), 'true', 'the same button, its chevron turned up');
  await click(ui.button(/^Catch up on the discussion/));
  assert.equal(ran[1][0], 'thread-summary');
  await click(more);
  assert.ok(!ui.hasButton(/^Catch up on the discussion/), 'folded again');
  await ui.unmount();
});

test('a reason that stops one action under "More actions" is said in words next to it, not only on hover', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const strict = { id: 'strict-thing', title: 'Summarise strictly', description: 'A summary.' };
  const ok = { id: 'other-thing', title: 'Something else', description: 'Another.' };
  const plan = { total: 3, more: 2, block: '', suggested: [], groups: [{ id: 'understand', label: 'Understand', items: [{ feature: strict, reason: 'Needs Strict privacy mode. Change it in Settings.', caution: '' }, { feature: ok, reason: '', caution: '' }] }] };
  const ui = await mount(<MoreActions plan={plan} eff={eff()} aiReady onRun={() => {}} />);
  await click(ui.button(/^More actions \(2\)/));
  const off = ui.button(/^Summarise strictly/);
  assert.equal(off.disabled, true);
  assert.equal(ui.$(`#${off.getAttribute('aria-describedby')}`)?.textContent, 'Summarise strictly: Needs Strict privacy mode. Change it in Settings.');
  assert.equal(ui.button(/^Something else/).disabled, false);
  assert.equal(ui.button(/^Something else/).getAttribute('aria-describedby'), null);
  await ui.unmount();
});

test('the checklist action shows on a catalog task only when the written instructions have no steps', async () => {
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
  let ui = await mount(<ActionGroups page={p} eff={eff()} record={task} header={head('Work in Progress')} aiReady onRun={() => {}} />);
  await settle();
  assert.deepEqual(reads, ['fulfilment-checklist']);
  await click(ui.button(/^More actions/));
  assert.ok(ui.hasButton(/^Draft a checklist from the instructions/), 'no steps found: offered');
  await ui.unmount();

  description = '1. Create the account\n2. Send the welcome email\n3. Close the task';
  ui = await mount(<ActionGroups page={p} eff={eff()} record={task} header={head('Work in Progress')} aiReady onRun={() => {}} />);
  await settle();
  if (ui.hasButton(/^More actions/)) await click(ui.button(/^More actions/));
  assert.ok(!ui.hasButton(/^Draft a checklist from the instructions/), 'steps found: Insights has the checklist');
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

// ---- the quick bar of the Ticket screen -------------------------------------------------------------------------------------

test('the quick bar: state-aware, AI items marked, an Insights item opens its card, no AI items when AI cannot be used', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ran = [];
  const cards = [];
  const bar = (props) => <QuickBar page={page} eff={eff()} record={rec('incident')} header={head('Resolved')} busy={false} aiReady onRun={(f) => ran.push(f.id)} onShowCard={(id) => cards.push(id)} {...props} />;
  const ui = await mount(bar({}));
  const labels = () => ui.$$('.ab-quick-actions button').map((b) => b.textContent);
  // Resolved: wrap up first, the "Ready to resolve?" card leading (it opens the card 'resolve'; audit P2.4: it was never shown).
  assert.deepEqual(labels(), ['Ready to resolve?', 'Resolution notes', 'Knowledge article', 'Draft a reply']);
  await click(ui.button('Ready to resolve?'));
  assert.deepEqual(cards, ['resolve']);
  await click(ui.button('Resolution notes'));
  assert.deepEqual(ran, ['resolution-notes']);
  // In progress: reply first, and the Related tickets card one click away
  await ui.rerender(bar({ header: head('In Progress') }));
  assert.deepEqual(labels(), ['Draft a reply', 'Summarise', 'Next best action', 'Related tickets']);
  await click(ui.button('Related tickets'));
  assert.deepEqual(cards, ['resolve', 'related']);
  await ui.rerender(bar({ aiReady: false }));
  assert.deepEqual(labels(), ['Ready to resolve?', 'Related tickets']);
  await ui.rerender(bar({ eff: eff({ values: { aiSkipped: true } }) }));
  assert.deepEqual(labels(), ['Ready to resolve?', 'Related tickets'], '"Skip AI for now": no AI items');
  await ui.unmount();
});

test('the quick bar holds no action that cannot run on this record (closed ticket: no reply; blocked table: no AI)', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ui = await mount(<QuickBar page={page} eff={eff({ values: { quickPins: { incident: ['reply-draft', 'record-summary'] } } })} record={rec('incident')} header={head('Closed')} aiReady onRun={() => {}} onShowCard={() => {}} />);
  assert.deepEqual(ui.$$('.ab-quick-actions button').map((b) => b.textContent), ['Summarise']);
  await ui.unmount();
  const ui2 = await mount(<QuickBar page={page} eff={eff({ policy: { blockedTables: ['incident'] } })} record={rec('incident')} header={head('In Progress')} aiReady onRun={() => {}} onShowCard={() => {}} />);
  // (with no AI the cards are all there is: both of them, the one for the stage first)
  assert.deepEqual(ui2.$$('.ab-quick-actions button').map((b) => b.textContent), ['Related tickets', 'Ready to resolve?']);
  await ui2.unmount();
});
