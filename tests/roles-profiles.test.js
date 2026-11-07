// W-03, W-17, W-18 and W-20 of the audit of 2026-11-07: the roles are used. Until the person chooses what they work on, the profiles
// follow the roles when the page told us the roles; unknown roles stay IT as before; the person's own choice always wins; and the
// tools a requested item or a catalog task needs (the fulfilment checklist) are there whatever the profile. Roles only decide what is
// SHOWN: nothing here changes what may be written.
const test = require('node:test');
const assert = require('node:assert/strict');
import { KIND_NEEDS, activeProfiles, missingProfileFor, profilesFromRoles, profilesOfFeature, rolesState, shownFor, suggestProfiles, withProfiles } from '../src/profiles/profiles.js';
import { profileChoices } from '../src/sidepanel/firstRun.js';
import { effectiveSettings } from '../src/policy/policy.js';
import { INSIGHT_CARDS } from '../src/sidepanel/ticket/cards/index.js';
import { cardsFor } from '../src/sidepanel/ticket/TicketInsights.jsx';
import { featureById } from '../src/features/registry.js';

const eff = (values = {}, policy = {}) => effectiveSettings(values, policy);
const ids = (e) => activeProfiles(e);

test('roles have three states: a list, none, and not known (which is not "none")', () => {
  assert.equal(rolesState(['itil']), 'known');
  assert.equal(rolesState([]), 'none');
  assert.equal(rolesState(['', '  ']), 'none');
  for (const unknown of [null, undefined, 'itil', { 0: 'itil' }, 7]) assert.equal(rolesState(unknown), 'unknown', String(unknown));
});

test('roles point at profiles: catalog fulfilment, customer service, HR (but not the basic HR role), leads', () => {
  assert.deepEqual(profilesFromRoles(['sn_request_write']), ['req']);
  assert.deepEqual(profilesFromRoles(['catalog_admin', 'itil']), ['it', 'req']);
  assert.deepEqual(profilesFromRoles(['sn_customerservice_agent']), ['csm']);
  assert.deepEqual(profilesFromRoles(['sn_customerservice_manager']), ['csm', 'lead']);
  assert.deepEqual(profilesFromRoles(['sn_hr_core.case_writer'], { hrApproved: true }), ['hr']);
  assert.deepEqual(profilesFromRoles(['sn_hr_core.basic'], { hrApproved: true }), [], 'held by ordinary employees: no work profile');
  assert.deepEqual(profilesFromRoles(['sn_hr_core.case_writer']), [], 'HR only where the organisation approved it');
  assert.deepEqual(profilesFromRoles(['  ITIL  ']), ['it'], 'folded to lower case');
  assert.deepEqual(profilesFromRoles(null), []);
  assert.deepEqual(profilesFromRoles([]), []);
});

test('the suggestion is never empty, and unknown roles are IT, exactly as before', () => {
  assert.deepEqual(suggestProfiles({}), ['it']);
  assert.deepEqual(suggestProfiles({ roles: null }), ['it']);
  assert.deepEqual(suggestProfiles({ roles: [] }), ['it']);
  assert.deepEqual(suggestProfiles({ roles: ['sn_request_write'] }), ['req'], 'a fulfiller who only works catalog tasks is not given IT');
  assert.deepEqual(suggestProfiles({ roles: ['sn_customerservice_manager', 'knowledge'] }), ['csm', 'lead', 'km']);
  assert.deepEqual(suggestProfiles({ roles: ['knowledge'] }), ['it', 'km'], 'an add-on alone still gets a base');
});

test('until the person chooses, the profiles follow the roles the page told us', () => {
  const e = withProfiles(eff({}), { roles: ['sn_request_write', 'itil'] });
  assert.deepEqual(ids(e), ['it', 'req']);
  assert.deepEqual(ids(withProfiles(eff({}), { roles: ['sn_customerservice_agent'] })), ['csm']);
  assert.deepEqual(ids(withProfiles(eff({}), { roles: ['knowledge'] })), ['it', 'km']);
  assert.deepEqual(e.values.profilesConfirmed, false, 'nothing is saved or confirmed by looking');
});

test('unknown roles change nothing: the panel works as IT, the same eff comes back', () => {
  const base = eff({});
  for (const roles of [null, undefined, [], 'itil']) {
    assert.equal(withProfiles(base, { roles }), base, JSON.stringify(roles));
    assert.deepEqual(ids(withProfiles(base, { roles })), ['it']);
  }
});

test('the person\'s own choice always wins over the roles', () => {
  const chosen = eff({ profiles: ['it'], profilesConfirmed: true });
  assert.equal(withProfiles(chosen, { roles: ['sn_customerservice_agent', 'sn_hr_core.case_writer'] }), chosen);
  assert.deepEqual(ids(withProfiles(chosen, { roles: ['sn_customerservice_agent'] })), ['it']);
  // chosen but not yet confirmed (a profile set some other way) is a choice too
  const set = eff({ profiles: ['csm'] });
  assert.equal(withProfiles(set, { roles: ['itil'] }), set);
});

test('the organisation\'s profiles are not overridden, and an allowed list is respected', () => {
  const locked = eff({}, { lockedProfiles: ['it'] });
  assert.equal(withProfiles(locked, { roles: ['sn_customerservice_agent'], kind: 'catalog_task' }), locked);
  const narrow = eff({}, { allowedProfiles: ['it'] });
  assert.deepEqual(ids(withProfiles(narrow, { roles: ['sn_customerservice_agent', 'itil'], kind: 'case' })), ['it'], 'csm is not allowed here');
  assert.deepEqual(ids(withProfiles(eff({}, { allowHrContent: true }), { roles: ['sn_hr_core.case_writer'] })), ['hr']);
  assert.deepEqual(ids(withProfiles(eff({}), { roles: ['sn_hr_core.case_writer'] })), ['it'], 'HR is not approved: IT');
});

test('a requested item or a catalog task always gets the fulfilment tools, whatever the profile; other kinds do not', () => {
  assert.deepEqual(KIND_NEEDS.catalog_task, ['req']);
  for (const kind of ['requested_item', 'catalog_task', 'request']) {
    for (const base of [eff({}), eff({ profiles: ['it'], profilesConfirmed: true }), eff({ profiles: ['csm'], profilesConfirmed: true })]) {
      assert.ok(ids(withProfiles(base, { kind })).includes('req'), `${kind}: ${ids(base)}`);
    }
  }
  assert.deepEqual(ids(withProfiles(eff({}), { kind: 'catalog_task' })), ['it', 'req'], 'on top of IT, not instead of it');
  assert.deepEqual(ids(withProfiles(eff({ profiles: ['csm'], profilesConfirmed: true }), { kind: 'case' })), ['csm']);
  assert.deepEqual(ids(withProfiles(eff({ profiles: ['it'], profilesConfirmed: true }), { kind: 'case' })), ['it', 'csm']);
  for (const kind of ['incident', 'problem', 'change', 'hr_case', 'knowledge', 'task', 'other', '']) {
    const base = eff({ profiles: ['it'], profilesConfirmed: true });
    assert.equal(withProfiles(base, { kind }), base, kind);
  }
});

test('the checklist card and the checklist action are shown on a catalog task to a person whose profile is IT or customer service', () => {
  const action = featureById('fulfilment-checklist');
  for (const profile of ['it', 'csm']) {
    const base = eff({ profiles: [profile], profilesConfirmed: true });
    assert.equal(shownFor(profilesOfFeature(action), base), false, 'without the kind it is hidden, as before');
    const here = withProfiles(base, { kind: 'catalog_task' });
    assert.equal(shownFor(profilesOfFeature(action), here), true, profile);
    assert.ok(cardsFor(INSIGHT_CARDS, { kind: 'catalog_task' }, null, here).some((c) => c.id === 'checklist'), profile);
    assert.ok(!cardsFor(INSIGHT_CARDS, { kind: 'catalog_task' }, null, base).some((c) => c.id === 'checklist'), 'and is hidden without it');
    // an incident still hides it: the checklist is for catalog work only
    assert.ok(!cardsFor(INSIGHT_CARDS, { kind: 'incident' }, null, withProfiles(base, { kind: 'incident' })).some((c) => c.id === 'checklist'));
  }
});

test('the hint "Show request fulfilment tools?" is not needed once the tools are there; HR and knowledge keep theirs', () => {
  const base = eff({ profiles: ['it'], profilesConfirmed: true });
  assert.ok(missingProfileFor('catalog_task', base), 'before: the hint');
  assert.equal(missingProfileFor('catalog_task', withProfiles(base, { kind: 'catalog_task' })), null);
  assert.equal(missingProfileFor('case', withProfiles(base, { kind: 'case' })), null);
  assert.ok(missingProfileFor('knowledge', withProfiles(base, { kind: 'knowledge' })));
  assert.ok(missingProfileFor('hr_case', withProfiles(eff({ profiles: ['it'], profilesConfirmed: true }, { allowHrContent: true }), { kind: 'hr_case' })));
});

test('the first-run question suggests the same profiles: unknown roles tick IT, known roles tick what they point at, a confirmed choice wins', () => {
  const tickedFor = (roles, e = eff({})) => profileChoices({ eff: e, roles }).ticked;
  assert.deepEqual(tickedFor(null), ['it']);
  assert.deepEqual(tickedFor(undefined), ['it']);
  assert.deepEqual(tickedFor([]), ['it']);
  assert.deepEqual(tickedFor(['sn_request_write']), ['req']);
  assert.deepEqual(tickedFor(['sn_request_write', 'itil']), ['it', 'req']);
  assert.deepEqual(tickedFor(['sn_request_write'], eff({ profiles: ['csm'], profilesConfirmed: true })), ['csm']);
  // ... and it is the same list the panel acts on before the question is answered
  assert.deepEqual(tickedFor(['sn_request_write', 'itil']), ids(withProfiles(eff({}), { roles: ['sn_request_write', 'itil'] })));
});

test('roles hide, they never unlock (W-20): withProfiles changes the profiles and nothing else', () => {
  const base = eff({ aiSkipped: true, piiMode: 'strict' }, { disabledFeatures: ['reply-draft'], blockedTables: ['incident'] });
  const out = withProfiles(base, { roles: ['itil_admin', 'admin', 'sn_hr_core.admin'], kind: 'catalog_task' });
  const { profiles: _a, ...restOut } = out.values;
  const { profiles: _b, ...restBase } = base.values;
  assert.deepEqual(restOut, restBase);
  assert.deepEqual(out.policy, base.policy, 'the organisation\'s policy is untouched by any role');
  assert.deepEqual(out.locked, base.locked);
});
