// Work profiles: suggestions from roles, what each person sees, and the hint on a ticket outside their profiles.
const test = require('node:test');
const assert = require('node:assert/strict');
import {
  suggestProfiles,
  isVisibleFor,
  shownFor,
  activeProfiles,
  profilesOfFeature,
  screensFor,
  missingProfileFor,
  aiAvailable,
  aiOffByPolicy,
  FEATURE_PROFILES,
  PROFILES,
  PROFILE_IDS,
} from '../src/profiles/profiles.js';
import { FEATURES } from '../src/features/registry.js';
import { effectiveSettings } from '../src/policy/policy.js';

const eff = (values = {}, policy = {}) => effectiveSettings(values, policy);

test('the profile list and the ids agree', () => {
  assert.deepEqual(PROFILES.map((p) => p.id), [...PROFILE_IDS]);
});

test('itil suggests IT; nothing at all still suggests IT', () => {
  assert.deepEqual(suggestProfiles({ roles: ['itil', 'sn_request_read'] }), ['it']);
  assert.deepEqual(suggestProfiles({}), ['it']);
  assert.deepEqual(suggestProfiles({ roles: ['snc_internal'] }), ['it']);
});

test('customer service, knowledge and major-incident roles are recognised; add-ons alone still get a base', () => {
  assert.deepEqual(suggestProfiles({ roles: ['sn_customerservice_agent'] }), ['csm']);
  assert.deepEqual(suggestProfiles({ roles: ['knowledge'] }), ['it', 'km']);
  assert.deepEqual(suggestProfiles({ roles: ['itil', 'sn_major_inc_mgmt.major_incident_manager'] }), ['it', 'mpc']);
});

test('HR is only suggested when the organisation approved it', () => {
  assert.deepEqual(suggestProfiles({ roles: ['sn_hr_core.case_writer'] }), ['it']);
  assert.deepEqual(suggestProfiles({ roles: ['sn_hr_core.case_writer'], hrApproved: true }), ['hr']);
});

test('catalog work and managing a group add request fulfilment and team lead', () => {
  assert.deepEqual(suggestProfiles({ roles: ['itil'], hasCatalogWork: true, managesGroup: true }), ['it', 'req', 'lead']);
});

test('visibility: "all" items always show; others need a matching profile; Show everything overrides', () => {
  assert.equal(isVisibleFor(['all'], ['csm']), true);
  assert.equal(isVisibleFor(undefined, ['csm']), true);
  assert.equal(isVisibleFor(['km'], ['it']), false);
  assert.equal(isVisibleFor(['km'], ['it', 'km']), true);
  assert.equal(isVisibleFor(['km'], ['it'], { showEverything: true }), true);
  assert.equal(isVisibleFor(['it'], []), true, 'nothing chosen yet behaves like IT');
});

test('every AI feature in the registry has a profile entry or carries its own; the table names no feature that does not exist', () => {
  const ids = new Set(FEATURES.map((f) => f.id));
  for (const id of Object.keys(FEATURE_PROFILES)) assert.ok(ids.has(id), `${id} is a feature`);
  for (const f of FEATURES) {
    const list = profilesOfFeature(f);
    assert.ok(list.length > 0, f.id);
    for (const p of list) assert.ok(p === 'all' || PROFILE_IDS.includes(p), `${f.id}: ${p}`);
  }
  assert.deepEqual(profilesOfFeature({ id: 'email-apology' }), ['all']);
  assert.deepEqual(profilesOfFeature({ id: 'x', profiles: ['csm'] }), ['csm']);
});

test('screens: Team only for team leads; policy hides screens but never the Ticket screen', () => {
  assert.deepEqual(screensFor(eff({ profiles: ['it'] })).map((s) => s.id), ['ticket', 'mywork', 'write', 'knowledge']);
  assert.deepEqual(screensFor(eff({ profiles: ['it', 'lead'] })).map((s) => s.id), ['ticket', 'mywork', 'team', 'write', 'knowledge']);
  assert.deepEqual(screensFor(eff({ profiles: ['lead', 'it'] }, { disabledSections: ['team', 'write', 'ticket'] })).map((s) => s.id), ['ticket', 'mywork', 'knowledge']);
  assert.deepEqual(screensFor(eff({ profiles: ['it'], showEverything: true })).map((s) => s.id), ['ticket', 'mywork', 'team', 'write', 'knowledge']);
});

test('policy: locked profiles replace the choice, allowed profiles filter it, HR needs approval', () => {
  assert.deepEqual(eff({ profiles: ['csm'] }, { lockedProfiles: ['it', 'req'] }).values.profiles, ['it', 'req']);
  assert.equal(eff({ profiles: ['csm'] }, { lockedProfiles: ['it'] }).locked.profiles, 'Set by your organisation.');
  assert.deepEqual(eff({ profiles: ['it', 'csm'] }, { allowedProfiles: ['it'] }).values.profiles, ['it']);
  assert.deepEqual(eff({ profiles: ['hr', 'it'] }).values.profiles, ['it']);
  assert.deepEqual(eff({ profiles: ['hr'] }, { allowHrContent: true }).values.profiles, ['hr']);
  assert.deepEqual(eff({ profiles: ['hr'] }, { allowedProfiles: ['hr'] }).values.profiles, ['hr']);
  assert.deepEqual(eff({ profiles: ['bogus', 'it', 'it'] }).values.profiles, ['it']);
  assert.deepEqual(activeProfiles(eff({})), ['it']);
});

test('a ticket outside the profiles gets a hint, unless the person has it, shows everything, or the policy rules it out', () => {
  assert.match(missingProfileFor('case', eff({ profiles: ['it'] })).text, /customer service case\. Show customer service tools\?/);
  assert.equal(missingProfileFor('case', eff({ profiles: ['csm'] })), null);
  assert.equal(missingProfileFor('incident', eff({ profiles: ['csm'] })), null);
  assert.equal(missingProfileFor('case', eff({ profiles: ['it'], showEverything: true })), null);
  assert.equal(missingProfileFor('hr_case', eff({ profiles: ['it'] })), null, 'HR not approved');
  assert.ok(missingProfileFor('hr_case', eff({ profiles: ['it'] }, { allowHrContent: true })));
  assert.equal(missingProfileFor('case', eff({ profiles: ['it'] }, { allowedProfiles: ['it'] })), null);
  assert.equal(missingProfileFor('case', eff({}, { lockedProfiles: ['it'] })), null);
});

test('AI on or off: the organisation switch and the personal "Skip AI for now"', () => {
  assert.equal(aiAvailable(eff({})), true);
  assert.equal(aiAvailable(eff({ aiSkipped: true })), false);
  assert.equal(aiOffByPolicy(eff({}, { aiEnabled: false })), true);
  assert.equal(aiAvailable(eff({}, { aiEnabled: false })), false);
  assert.equal(shownFor(['csm'], eff({ profiles: ['it'] })), false);
});
