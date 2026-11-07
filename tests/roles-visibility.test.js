// W-08 of the audit of 2026-11-07: the bar on the ServiceNow page and the keyboard shortcuts offered actions from a table of defaults and
// pins and ignored the panel's rules: "Draft a reply" on a change task and a problem, an HR action in a privacy mode that refuses every
// HR function. They now ask the same function the panel asks (src/features/visibility.js). This file keeps the bar's small table of
// facts (BAR_FEATURES, which the service worker can load without the registry) in step with the registry, and proves that the function
// the panel's list uses and the bar's are one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, featureById, isFeatureAvailable } from '../src/features/registry.js';
import { BAR_FEATURES, barFeatureShown, featureAvailable, featureShown, modeBelow, modeNeeded } from '../src/features/visibility.js';
import { QUICK_DEFAULTS, QUICK_LABELS, quickActions } from '../src/features/quick.js';
import { requiredMode } from '../src/lib/pipeline.js';
import { whenAllows } from '../src/features/stages.js';
import { offeredFeatures } from '../src/sidepanel/ticket/assist/actions/plan.js';
import { KINDS } from '../src/context/kinds.js';
import { PROFILE_IDS, withProfiles } from '../src/profiles/profiles.js';
import { DEFAULT_SETTINGS, effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { handleCommand } from '../src/background/commands.js';

const eff = (values = {}, policy = {}) => effectiveSettings({ ...DEFAULT_SETTINGS, ...values }, normalizePolicy(policy));
// One table for each kind the product knows, and the ones that share a kind but not a rule.
const TABLES = {
  incident: 'incident', problem: 'problem', change: 'change_request', request: 'sc_request', requested_item: 'sc_req_item', catalog_task: 'sc_task',
  case: 'sn_customerservice_case', hr_case: 'sn_hr_core_case', task: 'task', knowledge: 'kb_knowledge', chat: 'interaction', other: 'u_custom_thing',
};
const EXTRA_TABLES = ['change_task', 'problem_task', 'incident_task', 'sn_customerservice_task', 'sn_hr_core_task'];
const bar = (id, table, e = eff()) => barFeatureShown(id, { table, eff: e });

test('the bar\'s facts match the registry: the same kinds, the same minimum mode, the same rule for a table, for every action it can show', () => {
  assert.deepEqual(Object.keys(BAR_FEATURES).sort(), Object.keys(QUICK_LABELS).sort(), 'one row for each action with a short label');
  const tables = [...Object.values(TABLES), ...EXTRA_TABLES];
  for (const id of Object.keys(BAR_FEATURES)) {
    const row = BAR_FEATURES[id];
    const feature = featureById(id);
    assert.ok(feature, id);
    assert.deepEqual([...row.kinds].sort(), [...feature.kinds].sort(), `${id}: kinds (update BAR_FEATURES in src/features/visibility.js)`);
    assert.equal(row.requires?.minMode || '', feature.requires?.minMode || '', `${id}: minimum mode`);
    // The rule that depends on the table. The state rules are the panel's (the bar does not know the state), and "major incident" is
    // decided by the panel too: a state not known says no there, and the bar leaves that to the click.
    if (id === 'major-incident-comms') continue;
    for (const table of tables) {
      const kind = Object.entries(TABLES).find(([, t]) => t === table)?.[0] || 'task';
      const record = { table, kind };
      assert.equal(whenAllows(row, record, null), whenAllows(feature, record, null), `${id} on ${table}`);
    }
  }
});

test('the function the panel\'s list uses is the bar\'s: every action, every kind and table, profile and state gives the same answer', () => {
  const profiles = [[], ['it'], ['req'], ['csm'], ['hr'], ['lead'], ['km'], ['mpc'], ['it', 'req', 'csm', 'hr', 'lead', 'km', 'mpc']];
  const states = [null, { state: 'New' }, { state: 'In Progress' }, { state: 'Resolved' }, { state: 'Closed' }];
  for (const set of profiles) {
    const e = eff({ profiles: set, profilesConfirmed: set.length > 0 }, { allowHrContent: true });
    for (const [kind, table] of Object.entries(TABLES)) {
      for (const header of states) {
        const record = { kind, table };
        const panel = offeredFeatures({ record, header, eff: e }).map((f) => f.id);
        const same = FEATURES.filter((f) => featureShown(f, { record, header, eff: e })).map((f) => f.id);
        assert.deepEqual(same, panel, `${kind} ${JSON.stringify(set)} ${JSON.stringify(header)}`);
      }
    }
  }
  // ... and the part of it that is not about the ticket: policy
  const policy = normalizePolicy({ disabledFeatures: ['Reply-Draft'], coachingEnabled: false });
  for (const f of FEATURES) assert.equal(featureAvailable(f, policy), isFeatureAvailable(f, policy), f.id);
  assert.equal(featureAvailable(featureById('coaching-snapshot'), normalizePolicy({ coachingEnabled: true })), true);
});

test('the privacy mode an action needs is the pipeline\'s: Strict on an HR or other sensitive table, or the action\'s own minimum', () => {
  const policy = normalizePolicy({ sensitiveTablePrefixes: ['x_acme_hr_'] });
  for (const table of ['incident', 'sn_hr_core_case', 'sn_hr_core_task', 'sn_si_incident', 'x_acme_hr_case', 'kb_knowledge', 'u_thing', '']) {
    for (const f of FEATURES) assert.equal(modeNeeded(f, table, policy), requiredMode(f, { table }, policy) || '', `${f.id} on ${table}`);
  }
  assert.equal(modeBelow(eff(), 'strict'), true, 'the usual mode is below Strict');
  assert.equal(modeBelow(eff({ piiMode: 'strict' }), 'strict'), false);
  assert.equal(modeBelow(eff({ piiMode: 'local-only' }), 'strict'), false);
  assert.equal(modeBelow(eff(), ''), false, 'an action that needs nothing');
});

test('no reply on a ticket with no customer: a problem, and a task of a problem or a change; a reply stays on the others', () => {
  for (const id of ['reply-draft', 'missing-info', 'translate-message']) {
    for (const table of ['problem', 'problem_task', 'change_task']) assert.equal(bar(id, table), false, `${id} on ${table}`);
    for (const table of ['incident', 'sc_req_item', 'sc_task', 'sn_customerservice_case', 'incident_task', 'task']) assert.equal(bar(id, table), true, `${id} on ${table}`);
  }
  assert.equal(bar('record-summary', 'problem_task'), true, 'the summary is for every ticket');
});

test('what the bar leads with by default is only what the panel would offer, for every kind (and a problem, a catalog task and a task do not lead with a reply)', () => {
  for (const [kind, table] of Object.entries(TABLES)) {
    for (const e of [eff(), eff({ profiles: ['it'], profilesConfirmed: true }), eff({ piiMode: 'strict' }, { allowHrContent: true })]) {
      for (const a of quickActions({ kind, table, eff: e, policy: e.policy })) {
        assert.ok(featureShown(BAR_FEATURES[a.id], { record: { kind, table }, eff: withProfiles(e, { kind }), byProfile: false }), `${kind}: ${a.id}`);
      }
    }
  }
  for (const kind of ['problem', 'catalog_task', 'task']) assert.ok(!QUICK_DEFAULTS[kind].includes('reply-draft'), kind);
  assert.deepEqual(quickActions({ kind: 'problem', table: 'problem', eff: eff(), policy: eff().policy }).map((a) => a.id), ['record-summary', 'problem-rca', 'handoff-brief']);
  assert.deepEqual(quickActions({ kind: 'task', table: 'change_task', eff: eff(), policy: eff().policy }).map((a) => a.id), ['record-summary', 'resolution-notes', 'handoff-brief']);
  assert.deepEqual(quickActions({ kind: 'incident', table: 'incident', eff: eff(), policy: eff().policy }).map((a) => a.id), ['record-summary', 'reply-draft', 'resolution-notes'], 'an incident is as it was');
});

test('a pin the kind cannot do is not shown (a problem pinned with a reply, a change with an RCA)', () => {
  const e = eff();
  const pins = { problem: ['reply-draft', 'problem-rca'], change: ['problem-rca', 'change-cab-brief'] };
  assert.deepEqual(quickActions({ kind: 'problem', table: 'problem', eff: e, policy: e.policy, pins }).map((a) => a.id), ['problem-rca']);
  assert.deepEqual(quickActions({ kind: 'change', table: 'change_request', eff: e, policy: e.policy, pins }).map((a) => a.id), ['change-cab-brief']);
});

test('Strict mode for HR: in the usual mode the bar offers nothing on an HR case; in Strict it does', () => {
  for (const id of ['record-summary', 'hr-case-brief', 'reply-draft']) {
    assert.equal(bar(id, 'sn_hr_core_case', eff({}, { allowHrContent: true })), false, id);
    assert.equal(bar(id, 'sn_hr_core_case', eff({ piiMode: 'strict' }, { allowHrContent: true })), true, id);
  }
  // the action's own minimum holds on any table
  assert.equal(modeNeeded(featureById('hr-case-brief'), 'incident', normalizePolicy({})), 'strict');
});

test('the person\'s profiles apply once they have chosen them; until then the panel works them out from roles the worker cannot see, so the bar does not guess', () => {
  assert.equal(bar('change-cab-brief', 'change_request', eff()), true, 'not chosen yet: shown');
  assert.equal(bar('change-cab-brief', 'change_request', eff({ profiles: ['it'], profilesConfirmed: true })), false, 'chosen without major incident, problem and change: not shown, as in the panel');
  assert.equal(bar('change-cab-brief', 'change_request', eff({ profiles: ['it', 'mpc'], profilesConfirmed: true })), true);
  assert.equal(bar('account-briefing', 'sn_customerservice_case', eff({ profiles: ['it'], profilesConfirmed: true })), true, 'a case always has the customer service tools');
  assert.equal(bar('fulfilment-checklist', 'sc_task', eff({ profiles: ['it'], profilesConfirmed: true })), true, 'a catalog task always has the fulfilment tools');
  assert.equal(bar('fulfilment-checklist', 'incident', eff({ profiles: ['it'], profilesConfirmed: true })), false);
  assert.equal(bar('record-summary', 'incident', eff({ showEverything: true })), true);
});

test('an action that is switched off by the organisation, or an id the bar has never heard of, is not shown', () => {
  assert.equal(bar('reply-draft', 'incident', eff({}, { disabledFeatures: ['reply-draft'] })), false);
  assert.equal(bar('made-up', 'incident'), false);
  assert.equal(bar('__proto__', 'incident'), false);
  assert.equal(bar('record-summary', 'incident', eff({}, { disabledFeatures: ['record-summary'] })), false);
});

test('the keyboard shortcut for a reply is held to the same rules: not started on a problem, a task of a change, or an HR case outside Strict', async () => {
  const ORIGIN = 'https://dev1.service-now.com';
  const SYS = 'a'.repeat(32);
  const run = async (table, { settings = {}, policy = {} } = {}) => {
    const launches = [];
    const out = await handleCommand('reply', { id: 7, url: `${ORIGIN}/${table}.do?sys_id=${SYS}` }, {
      openPanel: async () => {},
      pageState: async () => ({ record: { table, sysId: SYS, number: 'X0010001' } }),
      activeInstances: async () => [ORIGIN],
      loadSettings: async () => settings,
      loadPolicy: async () => normalizePolicy(policy),
      aiOn: async () => true,
      saveLaunch: async (launch) => void launches.push(launch),
      now: () => 1000,
    });
    return { out, launches };
  };
  assert.equal((await run('incident')).out.started, true);
  for (const table of ['problem', 'problem_task', 'change_task']) assert.equal((await run(table)).out.started, false, table);
  assert.equal((await run('sn_hr_core_case', { policy: { allowHrContent: true } })).out.started, false, 'HR in the usual mode');
  assert.equal((await run('sn_hr_core_case', { policy: { allowHrContent: true }, settings: { piiMode: 'strict' } })).out.started, true, 'HR in Strict');
});

test('every kind is covered by the tables above', () => {
  assert.deepEqual(Object.keys(TABLES).sort(), [...KINDS].sort());
  assert.ok(PROFILE_IDS.length > 0);
});
