import { mount, click, settle, makeChrome } from './fixtures/panel-dom.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { useEffect } from 'react';
import { PROFILES_FOR_RE, cleanProfilesFor } from '../src/profiles/ids.js';
import { activeProfiles, confirmPatch, profilesConfirmedFor, withProfiles } from '../src/profiles/profiles.js';
import { profileOwnerKey, useProfileOwner } from '../src/profiles/useProfileOwner.js';
import { confirmedProfiles, firstRunSteps, profileChoices } from '../src/sidepanel/firstRun.js';
import FirstRun from '../src/sidepanel/FirstRun.jsx';
import ProfilePicker from '../src/options/ProfilePicker.jsx';
import { DEFAULT_SETTINGS, effectiveSettings } from '../src/policy/policy.js';
import { SETTINGS_KEY, loadSettings, saveSettings } from '../src/lib/storage.js';
import { userHash } from '../src/lib/lastViewed.js';
import { STORED_DATA, clearAllStored, describeKey } from '../src/lib/storedData.js';
import { diagnosticsText } from '../src/options/diagnostics.js';

// W-18 of the audit of 2026-11-07 (the last build wave, builder Q2): the work profiles are confirmed by a person, not by a browser.
// `profilesFor` holds one short one-way hash of the site and the signed-in person's user id next to `profilesConfirmed`. When a
// DIFFERENT person is signed in and the page told us their roles, the previous person's choice is not kept: the first-run question
// comes back with the suggestion from the new person's roles. An unknown person, unknown roles or a confirmation from before the
// person was recorded keep the stored choice: not knowing never takes a choice away. Pure tests with a fake settings object and
// page.user, then the card and the picker mounted.

const SN = 'https://acme.service-now.com';
const OTHER_SN = 'https://beta.service-now.com';
const ANN_ID = '3f9c0a1b7d5e2c483f9c0a1b7d5e2c48';
const BEN_ID = '9a8b7c6d5e4f30219a8b7c6d5e4f3021';
// (the one-way hashes of the two people on the first site; worked out once before the tests, Web Crypto is asynchronous)
let H_ANN = '';
let H_BEN = '';
before(async () => {
  H_ANN = await userHash(ANN_ID, SN);
  H_BEN = await userHash(BEN_ID, SN);
});

const effOf = (settings = {}, policy = {}, over = {}) => {
  const e = effectiveSettings(settings, policy);
  return { ready: true, values: e.values, locked: e.locked, policy: e.policy, floors: e.floors || {}, apiKey: '', keyLocked: false, ...over };
};
// What the page says about the person (src/content/index.js: user { name, roles, userId }), and the tab it is on.
const pageOf = (userId, roles, extra = {}) => ({ status: 'no-record', tabId: 3, href: `${SN}/home`, surface: 'classic', user: userId === null ? null : { name: 'Someone', roles, userId }, ...extra });
const states = (r) => r.steps.map((s) => `${s.id}:${s.state}`).join(' ');

test('the hashes are 16 lower-case hex characters, differ per person and per site, and are not the user id', () => {
  assert.match(H_ANN, PROFILES_FOR_RE);
  assert.match(H_BEN, PROFILES_FOR_RE);
  assert.notEqual(H_ANN, H_BEN);
  assert.notEqual(H_ANN, ANN_ID.slice(0, 16), 'a hash, not a piece of the id');
  assert.ok(!ANN_ID.includes(H_ANN));
});

test('cleanProfilesFor keeps exactly a 16-character hash (folded to lower case) and nothing else', () => {
  assert.equal(cleanProfilesFor(H_ANN), H_ANN);
  assert.equal(cleanProfilesFor(`  ${H_ANN.toUpperCase()} `), H_ANN);
  for (const bad of [ANN_ID, `${H_ANN}0`, H_ANN.slice(1), 'not a hash at all', `${H_ANN}\n`.repeat(1) + 'x', '', null, undefined, 7, {}, [H_ANN], 'g'.repeat(16)]) {
    assert.equal(cleanProfilesFor(bad), '', JSON.stringify(bad));
  }
});

test('the setting: empty by default, kept only for a confirmed set, and only as a hash', () => {
  assert.equal(DEFAULT_SETTINGS.profilesFor, '');
  assert.equal(effectiveSettings({}, {}).values.profilesFor, '');
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: H_ANN }, {}).values.profilesFor, H_ANN);
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: H_ANN.toUpperCase() }, {}).values.profilesFor, H_ANN);
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: false, profilesFor: H_ANN }, {}).values.profilesFor, '', 'nothing confirmed: nobody confirmed it');
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: ANN_ID }, {}).values.profilesFor, '', 'a user id is never kept, even if one is stored by mistake');
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: 'x'.repeat(5000) }, {}).values.profilesFor, '', 'bounded');
  assert.equal(effectiveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: { who: H_ANN } }, {}).values.profilesFor, '');
});

test('profilesConfirmedFor: only another KNOWN person, with roles the page told us, sets the stored choice aside', () => {
  const mine = { profiles: ['csm'], profilesConfirmed: true, profilesFor: H_ANN };
  // the same person: theirs
  assert.equal(profilesConfirmedFor(mine, { who: H_ANN, roles: ['itil'] }), true);
  // another person with known roles: not theirs
  assert.equal(profilesConfirmedFor(mine, { who: H_BEN, roles: ['itil'] }), false);
  // another person but the page did not say the roles (null, undefined, not a list): not decided, the stored choice stays
  for (const roles of [null, undefined, 'itil', { 0: 'itil' }, 7]) assert.equal(profilesConfirmedFor(mine, { who: H_BEN, roles }), true, JSON.stringify(roles));
  // another person, the page answered with an empty list ("asked, holds none of the roles it looked for"): that is a known answer
  assert.equal(profilesConfirmedFor(mine, { who: H_BEN, roles: [] }), false);
  // nobody known at the screen: kept
  for (const who of ['', undefined, null, ANN_ID, 'junk']) assert.equal(profilesConfirmedFor(mine, { who, roles: ['itil'] }), true, JSON.stringify(who));
  // nobody recorded as the one who confirmed (from before this change, or the user id was unknown then): kept for everyone
  for (const profilesFor of ['', undefined, 'junk', ANN_ID]) assert.equal(profilesConfirmedFor({ ...mine, profilesFor }, { who: H_BEN, roles: ['itil'] }), true, JSON.stringify(profilesFor));
  // never confirmed: false, whoever it is
  assert.equal(profilesConfirmedFor({ profiles: [], profilesConfirmed: false, profilesFor: H_ANN }, { who: H_ANN, roles: ['itil'] }), false);
  assert.equal(profilesConfirmedFor(undefined, { who: H_ANN }), false);
});

test('withProfiles: another person on the same browser does not inherit the choice; their roles decide until they answer', () => {
  const stored = effOf({ profiles: ['csm', 'lead'], profilesConfirmed: true, profilesFor: H_ANN });
  const before = JSON.stringify(stored.values);
  const ben = withProfiles(stored, { roles: ['itil'], who: H_BEN });
  assert.deepEqual(activeProfiles(ben), ['it'], 'Ben is an IT fulfiller, not Ann\'s customer service lead');
  assert.equal(ben.values.profilesConfirmed, false, 'the question comes back');
  assert.equal(ben.values.profilesFor, '', 'the derived settings do not say Ann chose them');
  assert.equal(ben.signedIn, H_BEN);
  assert.equal(JSON.stringify(stored.values), before, 'the settings on disk are not touched');
  // a catalog fulfiller
  assert.deepEqual(activeProfiles(withProfiles(stored, { roles: ['sn_request_write'], who: H_BEN })), ['req']);
  // the open ticket's own tools still come on top
  assert.deepEqual(activeProfiles(withProfiles(stored, { roles: ['itil'], who: H_BEN, kind: 'case' })), ['it', 'csm']);
  // roles that point at nothing: the panel works as IT, as for a person who never chose
  assert.deepEqual(activeProfiles(withProfiles(stored, { roles: [], who: H_BEN })), ['it']);
  assert.equal(withProfiles(stored, { roles: [], who: H_BEN }).values.profilesConfirmed, false);
});

test('withProfiles: the same person keeps their own choice, and so does anyone we cannot tell apart', () => {
  const stored = effOf({ profiles: ['csm', 'lead'], profilesConfirmed: true, profilesFor: H_ANN });
  const ann = withProfiles(stored, { roles: ['itil'], who: H_ANN });
  assert.deepEqual(activeProfiles(ann), ['csm', 'lead']);
  assert.equal(ann.values, stored.values, 'nothing changed: the same settings object');
  assert.equal(ann.signedIn, H_ANN);
  // no person given (the service worker's call, an old caller): exactly as before, the very same eff
  assert.equal(withProfiles(stored, { roles: ['itil'] }), stored);
  assert.equal(withProfiles(stored, { roles: ['itil'], kind: '' }), stored);
  // the person is not known yet (the hash is still being worked out, or the page does not say): the choice stays
  for (const who of ['', 'junk']) {
    const e = withProfiles(stored, { roles: ['itil'], who });
    assert.deepEqual(activeProfiles(e), ['csm', 'lead'], JSON.stringify(who));
    assert.equal(e.values.profilesConfirmed, true);
    assert.equal(e.signedIn, '');
  }
  // the roles are not known: the choice stays
  for (const roles of [null, undefined]) assert.deepEqual(activeProfiles(withProfiles(stored, { roles, who: H_BEN })), ['csm', 'lead']);
  // a confirmation from before the person was recorded: kept for everyone
  const old = effOf({ profiles: ['csm'], profilesConfirmed: true });
  assert.deepEqual(activeProfiles(withProfiles(old, { roles: ['itil'], who: H_BEN })), ['csm']);
});

test('withProfiles: the organisation\'s locked profiles belong to nobody and are never set aside', () => {
  const locked = effOf({ profiles: ['csm'], profilesConfirmed: true, profilesFor: H_ANN }, { lockedProfiles: ['it', 'lead'] });
  assert.deepEqual(activeProfiles(withProfiles(locked, { roles: ['sn_request_write'], who: H_BEN })), ['it', 'lead']);
  assert.equal(withProfiles(locked, { roles: ['sn_request_write'], who: H_BEN }).values.profilesConfirmed, true);
});

test('confirmPatch records who confirmed; without a person on the screen it clears the record, without the key it leaves it', () => {
  assert.deepEqual(confirmPatch(['it'], { signedIn: H_BEN }), { profiles: ['it'], profilesConfirmed: true, profilesFor: H_BEN });
  // the person is not known: an earlier person's mark must not stand for them
  assert.deepEqual(confirmPatch(['it'], { signedIn: '' }), { profiles: ['it'], profilesConfirmed: true, profilesFor: '' });
  // Settings does not know who is signed in: the record is left alone
  assert.deepEqual(confirmPatch(['it'], {}), { profiles: ['it'], profilesConfirmed: true });
  assert.deepEqual(confirmPatch(['it']), { profiles: ['it'], profilesConfirmed: true });
  assert.deepEqual(confirmPatch(['it'], { signedIn: ANN_ID }), { profiles: ['it'], profilesConfirmed: true, profilesFor: '' }, 'only ever a hash');
});

test('confirmedProfiles takes the person from the panel\'s settings; the two-argument call is exactly as before', () => {
  const choices = profileChoices({ eff: effOf({}), roles: ['itil'] });
  assert.deepEqual(confirmedProfiles(['lead'], choices), { profiles: ['it', 'lead'], profilesConfirmed: true });
  assert.deepEqual(confirmedProfiles(['lead'], choices, effOf({}, {}, { signedIn: H_BEN })), { profiles: ['it', 'lead'], profilesConfirmed: true, profilesFor: H_BEN });
});

test('the first run: a different person is asked again; the same person, an unknown person and unknown roles are not', () => {
  const stored = effOf({ profiles: ['csm'], profilesConfirmed: true, profilesFor: H_ANN, aiSkipped: true });
  const withSite = { ...stored, values: { ...stored.values, instances: [SN] } };
  const run = (eff, page) => firstRunSteps({ page, aiReady: false, eff });
  // Ann at the screen: nothing to ask
  const ann = run(withProfiles(withSite, { roles: ['itil'], who: H_ANN }), pageOf(ANN_ID, ['itil']));
  assert.equal(ann.show, false);
  // Ben at the screen: the question is next, everything else is done
  const ben = run(withProfiles(withSite, { roles: ['itil'], who: H_BEN }), pageOf(BEN_ID, ['itil']));
  assert.equal(ben.show, true);
  assert.equal(ben.next, 'profiles');
  assert.equal(states(ben), 'site:done profiles:next ai:done ticket:later');
  // the same eff given straight (not run through withProfiles) says the same
  assert.equal(run({ ...withSite, signedIn: H_BEN }, pageOf(BEN_ID, ['itil'])).next, 'profiles');
  // Ben, but the page did not say his roles / nobody is known: not asked
  assert.equal(run(withProfiles(withSite, { roles: null, who: H_BEN }), pageOf(BEN_ID, null)).show, false);
  assert.equal(run(withProfiles(withSite, { roles: ['itil'], who: '' }), pageOf(null)).show, false);
  assert.equal(run(withSite, pageOf(BEN_ID, ['itil'])).show, false, 'a settings object that does not carry the person: as before');
  // the organisation set the profiles: nothing to ask whoever it is
  const org = effOf({ profilesConfirmed: true, profilesFor: H_ANN, aiSkipped: true, instances: [SN] }, { lockedProfiles: ['it'] });
  assert.equal(run(withProfiles(org, { roles: ['itil'], who: H_BEN }), pageOf(BEN_ID, ['itil'])).show, false);
});

test('the question for a different person is pre-filled from his roles, not from the previous person\'s choice', () => {
  const stored = effOf({ profiles: ['csm', 'lead'], profilesConfirmed: true, profilesFor: H_ANN });
  const ben = withProfiles(stored, { roles: ['sn_request_write'], who: H_BEN });
  assert.deepEqual(profileChoices({ eff: ben, roles: ['sn_request_write'] }).ticked, ['req']);
  // even when the settings are given as they are stored, with only the person added
  assert.deepEqual(profileChoices({ eff: { ...stored, signedIn: H_BEN }, roles: ['sn_request_write'] }).ticked, ['req']);
  // the same person: their own choice
  assert.deepEqual(profileChoices({ eff: { ...stored, signedIn: H_ANN }, roles: ['sn_request_write'] }).ticked, ['csm', 'lead']);
  // the Settings page (no person, roles not given): the stored choice
  assert.deepEqual(profileChoices({ eff: stored }).ticked, ['csm', 'lead']);
});

test('two people on one browser, start to finish: each is asked once; nothing but a hash is stored; Clear all removes it', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const whoAt = async (page) => userHash(page.user?.userId, page.href);
  const panelFor = async (page) => {
    const base = effOf(await loadSettings());
    return withProfiles(base, { roles: page.user?.roles, kind: page.record?.kind, who: await whoAt(page) });
  };
  const ann = pageOf(ANN_ID, ['sn_customerservice_agent']);
  const ben = pageOf(BEN_ID, ['itil']);

  // Ann signs in first and answers the question: customer service.
  let eff = await panelFor(ann);
  assert.equal(firstRunSteps({ page: ann, aiReady: true, eff: { ...eff, values: { ...eff.values, instances: [SN] } } }).next, 'profiles');
  assert.deepEqual(profileChoices({ eff, roles: ann.user.roles }).ticked, ['csm']);
  await saveSettings(confirmedProfiles(['csm'], profileChoices({ eff, roles: ann.user.roles }), eff));
  let stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  assert.equal(stored.profilesFor, H_ANN);
  assert.equal(stored.profilesConfirmed, true);

  // Ann again: not asked, her choice.
  eff = await panelFor(ann);
  assert.equal(firstRunSteps({ page: ann, aiReady: true, eff: { ...eff, values: { ...eff.values, instances: [SN] } } }).show, false);
  assert.deepEqual(activeProfiles(eff), ['csm']);

  // Ben signs in on the same browser: he is asked, with the suggestion from HIS roles; Ann's choice is not what he works with.
  eff = await panelFor(ben);
  assert.deepEqual(activeProfiles(eff), ['it']);
  assert.equal(firstRunSteps({ page: ben, aiReady: true, eff: { ...eff, values: { ...eff.values, instances: [SN] } } }).next, 'profiles');
  assert.deepEqual(profileChoices({ eff, roles: ben.user.roles }).ticked, ['it']);
  // ... and until he answers, nothing was saved over Ann's choice
  assert.deepEqual((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY].profiles, ['csm']);

  // Ben answers: IT and team lead.
  await saveSettings(confirmedProfiles(['it', 'lead'], profileChoices({ eff, roles: ben.user.roles }), eff));
  stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  assert.equal(stored.profilesFor, H_BEN);
  eff = await panelFor(ben);
  assert.deepEqual(activeProfiles(eff), ['it', 'lead']);
  assert.equal(firstRunSteps({ page: ben, aiReady: true, eff: { ...eff, values: { ...eff.values, instances: [SN] } } }).show, false, 'Ben is not asked again');

  // The same person on another site is another hash: asked there too (the site is part of the hash).
  const benElsewhere = pageOf(BEN_ID, ['itil'], { href: `${OTHER_SN}/home` });
  assert.notEqual(await whoAt(benElsewhere), H_BEN);

  // Only a hash is kept: no user id, no name, anywhere in storage.
  const everything = JSON.stringify(fake.chrome.storage.local.data);
  assert.ok(!everything.includes(ANN_ID) && !everything.includes(BEN_ID), 'no user id');
  assert.ok(!everything.includes('Someone'), 'no name');
  assert.match(stored.profilesFor, PROFILES_FOR_RE);

  // Settings > Stored data > Clear all removes it with the rest of the settings.
  const done = await clearAllStored({ local: fake.chrome.storage.local, session: undefined });
  assert.deepEqual(done.remaining, []);
  assert.equal((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY], undefined);
  assert.equal((await loadSettings()).profilesFor, '', 'back to the default');
  assert.equal((await loadSettings()).profilesConfirmed, false);
});

test('"Stored data" names the setting\'s new content in plain words, and the key it lives under is the settings key', () => {
  const settings = STORED_DATA.find((item) => item.id === 'settings');
  assert.equal(describeKey(SETTINGS_KEY), settings);
  assert.match(settings.detail, /what you work on/);
  assert.match(settings.detail, /scrambled code for who chose it/);
  assert.ok(!/user id|hash|sys_id/i.test(settings.detail), settings.detail);
});

test('the copied diagnostics say whether who chose the profiles is recorded, never the code', () => {
  const stored = effOf({ profiles: ['it'], profilesConfirmed: true, profilesFor: H_ANN });
  const text = diagnosticsText({ manifest: { version: '1' }, userAgent: '', eff: stored, keyMode: 'none', now: new Date('2026-11-07T10:00:00Z') });
  assert.match(text, /Work profiles: it; show everything: no; who chose them is recorded \(a one-way code, not shown\): yes/);
  assert.ok(!text.includes(H_ANN));
  const none = diagnosticsText({ manifest: { version: '1' }, userAgent: '', eff: effOf({ profiles: ['it'], profilesConfirmed: true }), keyMode: 'none', now: new Date('2026-11-07T10:00:00Z') });
  assert.match(none, /who chose them is recorded \(a one-way code, not shown\): no/);
  const unconfirmed = diagnosticsText({ manifest: { version: '1' }, userAgent: '', eff: effOf({}), keyMode: 'none', now: new Date('2026-11-07T10:00:00Z') });
  assert.ok(!/who chose them is recorded/.test(unconfirmed));
});

test('profileOwnerKey: the site and the user id the page named; nothing without both', () => {
  assert.equal(profileOwnerKey(pageOf(ANN_ID, ['itil'])), `${SN}|${ANN_ID}`);
  assert.equal(profileOwnerKey(pageOf(ANN_ID.toUpperCase(), ['itil'])), `${SN}|${ANN_ID}`, 'folded to lower case, as the hash does');
  assert.equal(profileOwnerKey(pageOf(null)), '');
  assert.equal(profileOwnerKey(pageOf('', ['itil'])), '');
  assert.equal(profileOwnerKey({ user: { userId: ANN_ID } }), '', 'no address');
  assert.equal(profileOwnerKey({ href: 'http://acme.service-now.com/x', user: { userId: ANN_ID } }), '', 'only https addresses');
  assert.equal(profileOwnerKey(null), '');
});

test('useProfileOwner gives the hash once it is worked out, and \'\' when the page does not say who is signed in', async () => {
  const seen = [];
  function Probe({ page }) {
    const who = useProfileOwner(page);
    useEffect(() => {
      seen.push(who);
    }, [who]);
    return <p>{who}</p>;
  }
  const ui = await mount(<Probe page={pageOf(ANN_ID, ['itil'])} />);
  await settle(4);
  assert.equal(ui.text(), H_ANN);
  assert.deepEqual(seen, ['', H_ANN], 'nothing is decided while the hash is being worked out');
  await ui.rerender(<Probe page={pageOf(BEN_ID, ['itil'])} />);
  await settle(4);
  assert.equal(ui.text(), H_BEN);
  await ui.rerender(<Probe page={pageOf(null)} />);
  await settle(4);
  assert.equal(ui.text(), '', 'the person is not known on this page');
  await ui.unmount();
});

test('the card: a different person confirms the question and the hash of THAT person is saved with it', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('profileHints', () => ({ managesGroup: false, hasCatalogWork: false }));
  await saveSettings({ profiles: ['csm'], profilesConfirmed: true, profilesFor: H_ANN, aiSkipped: true, instances: [SN] });
  const base = effOf(await loadSettings());
  const page = pageOf(BEN_ID, ['sn_request_write']);
  const eff = withProfiles(base, { roles: page.user.roles, who: H_BEN });
  const ui = await mount(<FirstRun page={page} lastSeen={page} aiReady={false} eff={eff} />);
  await settle(4);
  assert.match(ui.$('li[aria-current="step"]').textContent, /Choose what you work on/);
  assert.deepEqual(ui.$$('input[type="checkbox"]').filter((b) => b.checked).map((b) => b.id), ['ab-firstrun-prof-req'], 'from his roles, not Ann\'s customer service');
  await click(ui.button('Confirm'));
  const saved = fake.chrome.storage.local.data[SETTINGS_KEY];
  assert.deepEqual(saved.profiles, ['req']);
  assert.equal(saved.profilesConfirmed, true);
  assert.equal(saved.profilesFor, H_BEN);
  assert.ok(!JSON.stringify(saved).includes(BEN_ID));
  await ui.unmount();
});

test('the card: when the person is not known, confirming clears the record of who, so the earlier person\'s mark does not stand for this one', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  fake.onRead('profileHints', () => ({}));
  await saveSettings({ profiles: ['csm'], profilesConfirmed: true, profilesFor: H_ANN, aiSkipped: true, instances: [SN] });
  // (a profile set some other way is not confirmed: here a first run of a person whose id the page does not say)
  const page = pageOf(null);
  const base = effOf({ ...(await loadSettings()), profilesConfirmed: false });
  const eff = withProfiles(base, { roles: null, who: '' });
  const ui = await mount(<FirstRun page={{ ...page, user: { name: 'Someone', roles: null } }} lastSeen={page} aiReady={false} eff={eff} />);
  await settle(4);
  await click(ui.button('Confirm'));
  const saved = fake.chrome.storage.local.data[SETTINGS_KEY];
  assert.equal(saved.profilesConfirmed, true);
  assert.equal(saved.profilesFor, '');
  await ui.unmount();
});

test('Settings > What you work on does not know who is signed in: a tick saves the profiles and leaves the record of who alone', async () => {
  const fake = makeChrome();
  globalThis.chrome = fake.chrome;
  const saves = [];
  const eff = effOf({ profiles: ['it'], profilesConfirmed: true, profilesFor: H_ANN });
  const ui = await mount(<ProfilePicker eff={eff} instant idBase="profile" onSave={async (patch) => { saves.push(patch); }} />);
  await click(ui.$('#profile-csm'));
  assert.deepEqual(saves, [{ profiles: ['it', 'csm'], profilesConfirmed: true }], 'no profilesFor in the patch: saveSettings keeps what is stored');
  await saveSettings({ profiles: ['it'], profilesConfirmed: true, profilesFor: H_ANN });
  await saveSettings(saves[0]);
  assert.equal((await loadSettings()).profilesFor, H_ANN);
  await ui.unmount();
});
