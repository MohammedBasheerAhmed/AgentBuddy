import { mount, click, settle, type, makeChrome } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedProfiles, firstRunSteps, hostLooksLikeServiceNow, profileChoices, siteVerdict } from '../src/sidepanel/firstRun.js';
import FirstRun from '../src/sidepanel/FirstRun.jsx';
import SetupView, { REFUSED_TEXT } from '../src/sidepanel/SetupView.jsx';
import ErrorBoundary from '../src/sidepanel/ErrorBoundary.jsx';
import { effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY } from '../src/lib/storage.js';

// The first run is one "Getting started" card: turn the site on (offered only on a ServiceNow page), say what you work on, set up AI
// or skip it, open a ticket. Each step's action sits in the card, nothing else on the screen repeats it, and a part of the panel that
// breaks offers the next step instead of a dead end.

const SN = 'https://acme.service-now.com';
const off = (origin = '') => ({ status: 'not-enabled', tabId: 3, origin });
const list = { status: 'no-record', tabId: 3, href: `${SN}/home`, surface: 'classic', user: { name: 'Beth', roles: ['itil'] } };
const states = (r) => r.steps.map((s) => `${s.id}:${s.state}`).join(' ');
const effOf = (settings = {}, policy = {}, over = {}) => {
  const e = effectiveSettings(settings, policy);
  return { ready: true, values: e.values, locked: e.locked, policy: e.policy, apiKey: '', keyLocked: false, ...over };
};
const fresh = effOf();
const confirmed = (over = {}) => effOf({ profiles: ['it'], profilesConfirmed: true, ...over });

test('a brand-new panel on a ServiceNow tab that is not turned on: the site is next, the rest come later', () => {
  const r = firstRunSteps({ page: off(SN), lastSeen: null, aiReady: false, eff: fresh });
  assert.equal(r.show, true);
  assert.equal(r.next, 'site');
  assert.equal(states(r), 'site:next profiles:later ai:later ticket:later');
  assert.equal(r.steps[0].hint, '', 'the step itself (with the Turn on button) says what turning it on reads: no second sentence (TRACKER.md 2.4)');
  assert.equal(firstRunSteps({ page: off(''), aiReady: false, eff: fresh }).steps[0].hint, '', 'without an address the help is the card below, not said twice');
});

test('the site is on (here, a tab answered before, a saved site or one the worker runs on): what you work on is next, then AI', () => {
  assert.equal(states(firstRunSteps({ page: list, lastSeen: list, aiReady: false, eff: fresh })), 'site:done profiles:next ai:later ticket:later');
  assert.equal(states(firstRunSteps({ page: off(''), lastSeen: list, aiReady: false, eff: fresh })), 'site:done profiles:next ai:later ticket:later');
  assert.equal(firstRunSteps({ page: off(''), aiReady: false, eff: effOf({ instances: [SN] }) }).steps[0].state, 'done');
  assert.equal(firstRunSteps({ page: off(''), aiReady: false, eff: fresh, activeInstances: [SN] }).steps[0].state, 'done', 'a site the organisation turned on');
  assert.equal(states(firstRunSteps({ page: list, aiReady: false, eff: confirmed() })), 'site:done profiles:done ai:next ticket:later');
});

test('"Skip AI for now", AI set up, or AI switched off by the organisation: the card is done; the last step never keeps it', () => {
  assert.equal(firstRunSteps({ page: list, aiReady: false, eff: confirmed({ aiSkipped: true }) }).show, false);
  assert.equal(firstRunSteps({ page: list, aiReady: true, eff: confirmed() }).show, false);
  const orgOff = firstRunSteps({ page: list, aiReady: false, eff: effOf({ profiles: ['it'], profilesConfirmed: true }, { aiEnabled: false }) });
  assert.equal(orgOff.show, false);
  assert.ok(!orgOff.steps.some((s) => s.id === 'ai'), 'no AI step at all when the organisation switched AI off');
  assert.equal(firstRunSteps({ page: list, aiReady: false, eff: effOf({}, { lockedProfiles: ['csm'] }) }).steps[1].state, 'done', 'profiles locked by the organisation: nothing to ask');
});

test('is it ServiceNow? Its own hosting by address; any other address by the marks a look at the page found', () => {
  for (const o of ['https://acme.service-now.com', 'https://acme.servicenow.com', 'https://agency.servicenowservices.com']) assert.equal(hostLooksLikeServiceNow(o), true, o);
  for (const o of ['https://outlook.office.com', 'https://service-now.com.evil.example', 'http://acme.service-now.com', 'not a url', '']) assert.equal(hostLooksLikeServiceNow(o), false, o);
  assert.equal(siteVerdict({ origin: SN, markers: null }), 'servicenow');
  const custom = 'https://itsm.corp.example';
  assert.equal(siteVerdict({ origin: custom, markers: { gck: true } }), 'servicenow');
  assert.equal(siteVerdict({ origin: custom, markers: { now: true } }), 'servicenow');
  assert.equal(siteVerdict({ origin: custom, markers: { scripts: true } }), 'servicenow');
  assert.equal(siteVerdict({ origin: 'https://outlook.office.com', markers: { gck: false, now: false, glide: false, scripts: false } }), 'other');
  assert.equal(siteVerdict({ origin: custom, markers: null }), 'unknown', 'the page could not be looked at');
  assert.equal(siteVerdict({ origin: custom, markers: { gck: 'yes' } }), 'other', 'only real booleans count');
});

test('what you work on: suggested from roles and work, only what the organisation allows, HR only where it approved HR', () => {
  const c = profileChoices({ eff: fresh, roles: ['itil', 'knowledge'], hints: { managesGroup: true } });
  assert.deepEqual(c.ticked, ['it', 'lead', 'km']);
  assert.deepEqual(c.main.map((p) => p.id), ['it', 'req', 'csm'], 'no HR without the organisation');
  assert.deepEqual(c.addOns.map((p) => p.id), ['lead', 'km', 'mpc']);
  assert.ok(profileChoices({ eff: effOf({}, { allowHrContent: true }) }).main.some((p) => p.id === 'hr'));
  assert.deepEqual(profileChoices({ eff: effOf({}, { allowedProfiles: ['csm', 'lead'] }), roles: ['itil'] }).main.map((p) => p.id), ['csm']);
  assert.deepEqual(profileChoices({ eff: effOf({}, { allowedProfiles: ['csm', 'lead'] }), roles: ['itil'] }).ticked, ['csm'], 'a suggestion the policy does not allow falls back to what it allows');
  assert.deepEqual(profileChoices({ eff: confirmed({ profiles: ['csm'] }), roles: ['itil'] }).ticked, ['csm'], 'the person\'s own choice wins over the suggestion');
  assert.equal(profileChoices({ eff: effOf({}, { lockedProfiles: ['it'] }) }).locked, true);
  assert.deepEqual(confirmedProfiles(['lead'], c), { profiles: ['it', 'lead'], profilesConfirmed: true }, 'an add-on alone gets a base');
  assert.deepEqual(confirmedProfiles(['km', 'csm'], c), { profiles: ['csm', 'km'], profilesConfirmed: true });
});

function withScripting(fake, markers) {
  fake.chrome.scripting = { executeScript: async () => [{ result: markers }] };
  return fake;
}

test('drawn on a ServiceNow page: one card, the site step carries "Turn on for this site", and nothing below repeats it', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const asked = [];
  fake.chrome.permissions.request = async ({ origins }) => {
    asked.push(...origins);
    return true;
  };
  const messages = [];
  fake.chrome.runtime.sendMessage = async (m) => {
    messages.push(m);
    return m.type === 'ab:enable-instance' ? { instances: [SN] } : {};
  };
  const ui = await mount(
    <>
      <FirstRun page={off(SN)} lastSeen={null} aiReady={false} eff={fresh} />
      <SetupView page={off(SN)} eff={fresh} />
    </>
  );
  assert.match(ui.text(), /Getting started Step 1 of 4/);
  assert.equal(ui.$$('ol li').length, 4);
  assert.match(ui.$('li[aria-current="step"]').textContent, /Turn on Agent Buddy/);
  assert.ok(!/Not turned on for this page/.test(ui.text()), 'the separate turn-on card is not drawn while the card offers it');
  assert.ok(!/Add an AI key/.test(ui.text()), 'no separate key card');
  assert.equal(ui.$$('.ab-btn-primary').length, 1, 'one primary button');
  await click(ui.button('Turn on for this site'));
  assert.deepEqual(asked, [`${SN}/*`]);
  assert.ok(messages.some((m) => m.type === 'ab:enable-instance' && m.origin === SN));
  await ui.unmount();
});

test('a page that does not look like ServiceNow: said so, with a small "Turn on anyway"; a refused permission says the next step', async () => {
  const fake = withScripting(makeChrome(), { gck: false, now: false, glide: false, scripts: false });
  globalThis.chrome = fake.chrome;
  fake.chrome.permissions.request = async () => false;
  const page = off('https://outlook.office.com');
  const ui = await mount(<FirstRun page={page} lastSeen={null} aiReady={false} eff={fresh} />);
  await settle(4);
  assert.match(ui.text(), /This does not look like ServiceNow\./);
  assert.ok(!ui.hasButton('Turn on for this site'));
  assert.equal(ui.$$('.ab-btn-primary').length, 0, 'nothing pushes the person to turn on webmail');
  await click(ui.button('Turn on anyway'));
  assert.ok(ui.text().includes(REFUSED_TEXT));
  assert.match(REFUSED_TEXT, /choose Allow/);
  assert.match(REFUSED_TEXT, /your organisation may block it: ask your administrator/);
  await ui.unmount();

  // A custom domain that IS ServiceNow (g_ck on the page): the normal button.
  const sn = withScripting(makeChrome(), { gck: true, now: false, glide: true, scripts: true });
  globalThis.chrome = sn.chrome;
  const ui2 = await mount(<FirstRun page={off('https://itsm.corp.example')} lastSeen={null} aiReady={false} eff={fresh} />);
  await settle(4);
  assert.ok(ui2.hasButton('Turn on for this site'));
  await ui2.unmount();
});

test('the site is on, nothing chosen yet: "What do you work on?" pre-filled from the roles, one Confirm saves profiles and profilesConfirmed', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('profileHints', () => ({ managesGroup: true, hasCatalogWork: false }));
  const ui = await mount(<FirstRun page={list} lastSeen={list} aiReady={false} eff={fresh} />);
  await settle(4);
  assert.match(ui.$('li[aria-current="step"]').textContent, /Choose what you work on/);
  const ticked = ui.$$('input[type="checkbox"]').filter((b) => b.checked).map((b) => b.id);
  assert.deepEqual(ticked, ['ab-firstrun-prof-it', 'ab-firstrun-prof-lead'], 'itil suggests IT; managing a group suggests Team lead');
  assert.equal(fake.readsOf('profileHints').length, 1);
  await click(ui.button('Confirm'));
  const saved = fake.chrome.storage.local.data[SETTINGS_KEY];
  assert.deepEqual(saved.profiles, ['it', 'lead']);
  assert.equal(saved.profilesConfirmed, true);
  await ui.unmount();
});

test('AI step: "Set up AI" opens Settings, "Skip AI for now" saves aiSkipped; with it the card is gone', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const ui = await mount(<FirstRun page={list} lastSeen={list} aiReady={false} eff={confirmed()} />);
  assert.match(ui.$('li[aria-current="step"]').textContent, /Set up AI, or skip it for now/);
  await click(ui.button('Set up AI'));
  assert.equal(fake.optionsOpened, 1);
  await click(ui.button('Skip AI for now'));
  assert.equal(fake.chrome.storage.local.data[SETTINGS_KEY].aiSkipped, true);
  await ui.rerender(<FirstRun page={list} lastSeen={list} aiReady={false} eff={confirmed({ aiSkipped: true })} />);
  assert.equal(ui.text(), '', 'nothing once the setup is done');
  await ui.unmount();
});

test('AI step with a saved key that is locked: the passphrase box is right in the card (AI0.1), with no trip to Settings', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const locked = effOf({ profiles: ['it'], profilesConfirmed: true }, {}, { keyLocked: true });
  const ui = await mount(<FirstRun page={list} lastSeen={list} aiReady={false} eff={locked} />);
  const box = ui.field(/Enter your passphrase to unlock it/);
  assert.equal(box.getAttribute('type'), 'password');
  assert.equal(box.getAttribute('autocomplete'), 'off', 'the browser is not asked to remember it');
  assert.equal(ui.hasButton('Set up AI'), false, 'nothing to set up: the key is there');
  assert.equal(ui.button('Unlock').disabled, true, 'nothing typed yet');
  // A passphrase that does not open the key: said in words, the box emptied, still locked (this test has no vault, so nothing opens).
  await type(box, 'not the passphrase');
  assert.equal(ui.button('Unlock').disabled, false);
  await click(ui.button('Unlock'));
  assert.match(ui.$('[role="alert"]').textContent, /no encrypted key|Wrong passphrase/);
  assert.equal(ui.field(/Enter your passphrase to unlock it/).value, '');
  assert.equal(fake.optionsOpened, 0);
  // A forgotten passphrase: the key is entered again in Settings.
  await click(ui.button('Forgot it? Enter the key again in Settings'));
  assert.equal(fake.optionsOpened, 1);
  await ui.unmount();
});

test('after the first run: a page that is not on gets "Not turned on for this page"; a page with no record a short line, not My work', async () => {
  globalThis.chrome = makeChrome().chrome;
  const done = confirmed({ aiSkipped: true, instances: [SN] });
  const other = 'https://other.service-now.com';
  const ui = await mount(<SetupView page={off(other)} eff={done} />);
  assert.match(ui.text(), /Not turned on for this page/);
  assert.ok(ui.hasButton('Turn on for this site'));
  await ui.rerender(<SetupView page={list} eff={done} onOpenScreen={() => {}} />);
  assert.match(ui.text(), /Open a ticket/);
  assert.ok(ui.hasButton('See my work'));
  assert.ok(!/My day|My work/.test(ui.$('section h2').textContent));
  await ui.rerender(<SetupView page={off('')} eff={fresh} />);
  assert.match(ui.text(), /Not turned on for this page/, 'a tab whose address cannot be seen: the help is here, never in the card');
  assert.match(ui.text(), /Open your ServiceNow site in this tab/);
  await ui.unmount();
});

// Breaks while globalThis.flakyBroken is true (React draws a failed part twice before it gives up, so a one-off failure would not do).
function Flaky() {
  if (globalThis.flakyBroken) throw new Error('the draw fails: Abel Tuter');
  return <p>Drawn fine</p>;
}

test('a part that breaks says so in plain words and "Try again" gives it another chance; the error text is never shown', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  globalThis.flakyBroken = true;
  const original = console.error;
  console.error = () => {};
  try {
    const ui = await mount(
      <ErrorBoundary resetKey="a">
        <Flaky />
      </ErrorBoundary>
    );
    assert.match(ui.text(), /Something went wrong in this part of Agent Buddy\. Try again, or reload the panel\./);
    assert.ok(!ui.text().includes('Abel Tuter'));
    assert.ok(ui.hasButton('Reload the panel'));
    await click(ui.button('Open Settings'));
    assert.equal(fake.optionsOpened, 1);
    globalThis.flakyBroken = false; // (what went wrong has passed: a page answer that was late, say)
    await click(ui.button('Try again'));
    assert.match(ui.text(), /Drawn fine/);
    await ui.unmount();
  } finally {
    console.error = original;
  }
});
