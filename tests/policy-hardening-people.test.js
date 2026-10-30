// SEC-11 (every feature that sends text reads every person column of the kind, so every person is masked by name) and SEC-05 (the people
// named on OTHER people's tickets are masked exactly too; reference material makes the preview mandatory; the routing hint no longer
// carries other tickets' resolution text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES as SPEC_IDS, FEATURE_FIELDS, FEATURE_MASK_ONLY, FIELDS_BY_KIND, HR_HIDDEN, LIMITS, PERSON_COLUMNS, SEARCH_ONLY_FEATURES, allowedFields, maskOnlyFields } from '../src/context/allowlists.js';
import { PERSON_FIELDS } from '../src/context/people.js';
import { FEATURES, contextFor, featureById } from '../src/features/registry.js';
import { readContextPack } from '../src/context/pack.js';
import { HIT_PERSON_COLUMNS, findSimilarTickets, searchKnowledge } from '../src/context/similar.js';
import { addReference, cleanArticleHit, cleanTicketHit } from '../src/itsm/reference.js';
import { referenceParts } from '../src/itsm/parts.js';
import { cleanCases, mergeAccountCases } from '../src/domain/accountCases.js';
import { prepareRun, previewRequired } from '../src/lib/pipeline.js';
import { createFirewall } from '../src/pii/index.js';
import { effectiveSettings, normalizePolicy } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { OPS } from '../src/content/ops/index.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { HR_CASE_ID, hrCaseRow } from './fixtures/sn-hr-case.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { DAVE } from './fixtures/sn-users.js';
import { IDS, caseRows, domainTables } from './domain-fixtures.js';
import { hostilePack, hostileRead, hostileHits } from './fixtures/itsm-hostile.js';

const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const run = (id, pack, pol = {}, mode = 'standard') =>
  prepareRun({ feature: featureById(id), pack, values: values({ piiMode: mode }), policy: normalizePolicy(pol), config: config(), createFirewall });
const outgoing = (prepared) => prepared.request.messages.map((m) => m.content).join('\n');

// ---- SEC-11: person columns, structurally ----------------------------------------------------------------------------------

test('SEC-11: every feature that sends text reads every person column of every kind (nothing is left to each spec)', () => {
  const kinds = Object.keys(FIELDS_BY_KIND);
  let checked = 0;
  for (const id of SPEC_IDS) {
    if (SEARCH_ONLY_FEATURES.includes(id)) continue;
    for (const kind of kinds) {
      const people = FIELDS_BY_KIND[kind].filter((name) => PERSON_COLUMNS.includes(name));
      for (const name of people) {
        assert.ok(FEATURE_FIELDS[id][kind].includes(name), `${id} / ${kind}: ${name} is a person column of the ceiling but is not read`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 400, `the check really ran (${checked})`);
});

test('SEC-11: every feature in the registry has a context spec, and the spec reads the people of every kind it applies to', () => {
  const searchOnly = new Set(SEARCH_ONLY_FEATURES);
  // These two are built from the reports engine's own figures (src/reports/ai), not from a record: they read no record, so they have no spec.
  const notFromARecord = new Set(['shift-handover', 'dashboard-insights']);
  for (const feature of FEATURES) {
    const spec = contextFor(feature);
    if (notFromARecord.has(feature.id)) {
      assert.ok(!SPEC_IDS.includes(spec), `${feature.id} has no record to read`);
      continue;
    }
    assert.ok(SPEC_IDS.includes(spec), `${feature.id}: no context spec "${spec}"`);
    for (const kind of feature.kinds?.length ? feature.kinds : Object.keys(FIELDS_BY_KIND)) {
      const people = (FIELDS_BY_KIND[kind] || FIELDS_BY_KIND.other).filter((name) => PERSON_COLUMNS.includes(name));
      if (searchOnly.has(spec)) continue;
      for (const name of people) assert.ok(FEATURE_FIELDS[spec][kind in FEATURE_FIELDS[spec] ? kind : 'other'].includes(name), `${feature.id} / ${kind}: ${name}`);
    }
  }
  // the three search-only features keep their narrow lists
  for (const id of SEARCH_ONLY_FEATURES) {
    assert.ok(!FEATURE_FIELDS[id].incident.includes('opened_by'), `${id} reads no extra person column`);
    assert.deepEqual([...FEATURE_MASK_ONLY[id].incident], []);
  }
});

test('SEC-11: the audit\'s reproduction: the columns reply-draft, handoff-brief, missing-info, account-briefing, case-eng-escalation and problem-rca missed', () => {
  assert.ok(FEATURE_FIELDS['reply-draft'].incident.includes('opened_by'));
  assert.ok(FEATURE_FIELDS['reply-draft'].hr_case.includes('subject_person'));
  assert.ok(FEATURE_FIELDS['handoff-brief'].incident.includes('opened_by'));
  assert.ok(FEATURE_FIELDS['handoff-brief'].hr_case.includes('subject_person'));
  assert.ok(FEATURE_FIELDS['missing-info'].incident.includes('opened_by') && FEATURE_FIELDS['missing-info'].incident.includes('assigned_to'));
  assert.ok(FEATURE_FIELDS['missing-info'].hr_case.includes('opened_for') && FEATURE_FIELDS['missing-info'].hr_case.includes('subject_person'));
  assert.ok(FEATURE_FIELDS['account-briefing'].case.includes('opened_by'));
  assert.ok(FEATURE_FIELDS['case-eng-escalation'].case.includes('opened_by'));
  assert.ok(FEATURE_FIELDS['problem-rca'].problem.includes('opened_by'));
});

test('SEC-11: the list of person columns matches the roles the context engine knows, and a new person-like column cannot slip in unlisted', () => {
  for (const name of Object.keys(PERSON_FIELDS)) assert.ok(PERSON_COLUMNS.includes(name), `${name} is a role in people.js but not a person column`);
  assert.ok(PERSON_COLUMNS.includes('author'), 'the author of an article');
  const looksLikeAPerson = /(_by$|_for$|^assigned_to$|caller|^contact$|consumer|person|author)/;
  const everyColumn = new Set(Object.values(FIELDS_BY_KIND).flat());
  const unlisted = [...everyColumn].filter((name) => looksLikeAPerson.test(name) && !PERSON_COLUMNS.includes(name));
  assert.deepEqual(unlisted, [], 'add the column to PERSON_COLUMNS in src/context/allowlists.js');
});

test('SEC-11: on an HR table the identities are still withheld unless sensitive data is allowed (as before)', () => {
  for (const id of ['reply-draft', 'missing-info', 'handoff-brief', 'hr-case-brief']) {
    const minimal = allowedFields('sn_hr_core_case', id);
    for (const name of ['caller_id', 'opened_by', 'opened_for', 'subject_person', 'contact']) assert.ok(!minimal.includes(name), `${id}: ${name} is HR-hidden`);
    assert.ok(minimal.every((name) => !HR_HIDDEN.has(name)));
    const open = allowedFields('sn_hr_core_case', id, { allowSensitive: true });
    for (const name of ['opened_by', 'opened_for', 'subject_person']) assert.ok(open.includes(name), `${id}: ${name}`);
  }
  assert.ok(allowedFields('sn_hr_core_case', 'reply-draft').includes('assigned_to'), 'the handler is not an HR-hidden column, as before');
});

// ---- SEC-11: read to be masked, not to be sent ------------------------------------------------------------------------------

test('a person column that is not in the feature\'s own spec is read for its name only: it is on the people list, not a field of the pack', async () => {
  const tables = buildInstance();
  tables.incident[0].opened_by = v(DAVE.sysId, DAVE.name);
  const fake = fakeDeps(tables);
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fake, { feature: 'reply-draft' });
  assert.ok(maskOnlyFields('incident', 'reply-draft').includes('opened_by'), 'opened_by is not in the reply-draft spec');
  assert.ok(fake.fieldsAsked().has('opened_by'), 'it is read');
  assert.equal(pack.fields.opened_by, undefined, 'but not put in the pack\'s fields (so no part sends it)');
  assert.ok(pack.people.some((p) => p.name === DAVE.name && p.role === 'opened_by'), 'the person is known, so the name is masked wherever the text mentions it');
  assert.equal(pack.fields.caller_id, 'Abel Tuter', 'a person column the spec lists is a field as before');
});

test('SEC-11 end to end: a name that only the opener column knows is masked in the reply draft (it was sent in clear before)', async () => {
  const tables = buildInstance();
  tables.incident[0].short_description = v('Printer broken, please ask Dana Whitfield about the ticket');
  tables.incident[0].opened_by = v('f'.repeat(32), 'Dana Whitfield');
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(tables), { feature: 'reply-draft' });
  const text = outgoing(run('reply-draft', pack));
  assert.ok(!/Dana/.test(text) && !/Whitfield/.test(text), 'the opener\'s name is masked');
  assert.match(text, /\[PERSON_\d+\]/);
  // The same record read with only the old columns: "please ask Dana Whitfield" names her with a cue, so it is found in prose
  // (src/pii/names.js) and masked even then.
  const old = { ...pack, people: pack.people.filter((p) => p.name !== 'Dana Whitfield') };
  assert.doesNotMatch(outgoing(run('reply-draft', old)), /Dana|Whitfield/);
  // Written with no cue, only the opener column masks it: the old columns would have let it through.
  tables.incident[0].short_description = v('Printer broken, Dana Whitfield has the details');
  const bare = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(tables), { feature: 'reply-draft' });
  assert.doesNotMatch(outgoing(run('reply-draft', bare)), /Dana|Whitfield/, 'masked through the opener column');
  assert.match(outgoing(run('reply-draft', { ...bare, people: bare.people.filter((p) => p.name !== 'Dana Whitfield') })), /Dana Whitfield/);
});

test('SEC-11 end to end, HR: the subject of a case named in the title is masked in the reply draft (the audit\'s reproduction)', async () => {
  const row = hrCaseRow();
  row.subject_person = v('1'.repeat(32), 'Meena Iyer');
  row.opened_for = v('2'.repeat(32), 'Other Person');
  row.short_description = v('Leave request for Meena Iyer');
  const fake = fakeDeps({ sn_hr_core_case: [row], task_sla: [] });
  const pack = await readContextPack({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, fake, { feature: 'reply-draft', allowSensitive: true });
  assert.ok(pack.people.some((p) => p.name === 'Meena Iyer'), 'the subject is on the pack');
  const text = outgoing(run('reply-draft', pack, { allowHrContent: true, aiProvider: 'anthropic' }, 'strict'));
  assert.ok(!/Meena|Iyer/.test(text));
});

test('SEC-11: a record whose person columns are HR-hidden stays minimal, with no people read at all', async () => {
  const fake = fakeDeps({ sn_hr_core_case: [hrCaseRow()], task_sla: [] });
  const pack = await readContextPack({ table: 'sn_hr_core_case', sysId: HR_CASE_ID }, fake, { feature: 'reply-draft' });
  assert.ok(!fake.fieldsAsked().has('subject_person'));
  assert.ok(!fake.fieldsAsked().has('opened_by'));
  assert.ok(!fake.fieldsAsked().has('short_description'));
  assert.deepEqual(pack.fields.short_description, undefined);
});

// ---- SEC-05: people on other tickets --------------------------------------------------------------------------------------------

test('SEC-05: a look-alike ticket carries the display names of the people on its row (caller, assignee...), and nothing else', async () => {
  const tables = buildInstance();
  tables.incident[1].caller_id = v('a'.repeat(32), 'Priya Raman');
  tables.incident[1].assigned_to = v('b'.repeat(32), 'Dev Mehta');
  const fake = fakeDeps(tables);
  const pack = { table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting' }, people: [] };
  const { hits } = await findSimilarTickets(pack, fake, { limit: 20 });
  assert.ok(hits.every((h) => Array.isArray(h.people)));
  const withNames = hits.filter((h) => h.people.length);
  assert.ok(withNames.some((h) => h.people.includes('Priya Raman') && h.people.includes('Dev Mehta')), JSON.stringify(withNames.map((h) => h.people)));
  const call = fake.callsTo('incident')[0];
  for (const column of HIT_PERSON_COLUMNS) assert.ok(call.fields.includes(column), column);
  assert.ok(hits.every((h) => h.people.every((n) => !/^[0-9a-f]{32}$/i.test(n))), 'never a bare id');
  assert.equal(fake.callsTo('sys_user').length, 0, 'no other table is read for the names');
});

test('SEC-05: a knowledge hit carries its author', async () => {
  const tables = buildInstance();
  tables.kb_knowledge[0].author = v('c'.repeat(32), 'Kara Nilsson');
  const found = await searchKnowledge({ table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting', description: '' }, people: [] }, fakeDeps(tables), {});
  assert.ok(found.hits.length > 0);
  assert.ok(found.hits.some((h) => h.people.includes('Kara Nilsson')));
});

test('SEC-05: addReference puts the other tickets\' people on the pack, once each, and marks the pack requirePreview', async () => {
  const hits = hostileHits();
  hits.similar[0].people = ['Priya Raman', 'Dev Mehta', 'Abel Tuter'];
  hits.similar[1].people = ['Priya Raman'];
  hits.knowledge[0].people = ['Kara Nilsson'];
  const read = async (op) => (op === 'knowledge' ? { hits: hits.knowledge, access: [] } : { hits: hits.similar, access: [] });
  const pack = hostilePack();
  const out = await addReference(pack, { read }, { similar: 'similar', knowledge: true });
  const added = out.people.filter((p) => p.role === 'reference_person').map((p) => p.name);
  assert.deepEqual(added, ['Priya Raman', 'Dev Mehta', 'Kara Nilsson'], 'once each; Abel is already on the record');
  assert.equal(out.requirePreview, true);
  assert.equal(pack.requirePreview, undefined, 'the original pack is not changed');
  assert.equal(pack.people.length, 2);
  // no hits, no flag
  const none = await addReference(pack, { read: async () => ({ hits: [], access: [] }) }, { similar: 'similar', knowledge: true });
  assert.equal(none.requirePreview, undefined);
  assert.equal(none.people.length, pack.people.length);
  // a read that fails, no flag
  const failed = await addReference(pack, { read: async () => { throw new Error('boom'); } }, { similar: 'similar' });
  assert.equal(failed.requirePreview, undefined);
});

test('SEC-05: names from a page are cleaned: strings only, capped, never an id', () => {
  const hit = cleanTicketHit({ number: 'INC0001001', short_description: 'x', people: ['Priya Raman', 7, null, 'a'.repeat(32), { evil: true }, ...Array.from({ length: 20 }, (_, i) => `Person ${i}`)] });
  assert.equal(hit.people[0], 'Priya Raman');
  assert.ok(hit.people.length <= 8);
  assert.ok(hit.people.every((n) => typeof n === 'string' && !/^[0-9a-f]{32}$/i.test(n)));
  assert.deepEqual(cleanArticleHit({ number: 'KB0010001', people: 'not a list' }).people, []);
  assert.deepEqual(cleanTicketHit({ number: 'INC0001001' }).people, []);
});

test('SEC-05: the review\'s reproduction: a name in a look-alike\'s close notes is masked when the row names the person; an unlisted one is not (stated limit)', async () => {
  const hits = hostileHits();
  hits.similar[0].close_notes = 'Spoke to Priya Raman and her manager Dev Mehta; reset the token';
  hits.similar[0].people = ['Priya Raman'];
  const read = async (op) => (op === 'knowledge' ? { hits: [], access: [] } : { hits: hits.similar, access: [] });
  const feature = featureById('next-best-action');
  const pack = await feature.enrich(hostilePack(), { read });
  const text = outgoing(prepareRun({ feature, pack, values: values(), policy: normalizePolicy({}), config: config(), createFirewall }));
  assert.ok(!text.includes('Priya Raman') && !/Priya|Raman/.test(text), 'the person on the row is masked');
  assert.match(text, /Dev Mehta/, 'a person named only in the prose and on no row is still not found: docs/security.md says so');
});

test('SEC-05: routing-hint\'s reference drops the resolution text: no close notes, no close code, only group, priority and category', async () => {
  const feature = featureById('routing-hint');
  const pack = await feature.enrich(hostilePack(), { read: hostileRead() });
  for (const hit of pack.reference.similar.hits) {
    assert.equal(hit.close_notes, '');
    assert.equal(hit.close_code, '');
    assert.ok(hit.assignment_group && hit.priority);
  }
  const parts = referenceParts(pack, { routing: true });
  const tickets = parts.filter((p) => p.label.startsWith('Reference solved ticket'));
  assert.equal(tickets.length, 2);
  for (const p of tickets) {
    assert.equal(p.field, 'reference_ticket_routing');
    assert.ok(!/How it was solved|Close code|Replaced the expired|certificate/.test(p.text), p.text);
    assert.match(p.text, /Assignment group:/);
    assert.match(p.text, /Priority:/);
    assert.match(p.text, /Category:/);
  }
  assert.equal(pack.requirePreview, true);
  // next-best-action keeps the fix text (that is what it is for)
  const nba = await featureById('next-best-action').enrich(hostilePack(), { read: hostileRead() });
  assert.match(referenceParts(nba).find((p) => p.label.startsWith('Reference solved ticket')).text, /How it was solved: Replaced the expired gateway certificate/);
  assert.equal(referenceParts(nba).find((p) => p.label.startsWith('Reference solved ticket')).field, 'reference_ticket');
});

test('SEC-05: every pack that carries reference material is marked requirePreview, and the preview is then shown even in "first" mode', async () => {
  // look-alikes and articles
  for (const id of ['next-best-action', 'routing-hint', 'kb-article-draft']) {
    const feature = featureById(id);
    const pack = await feature.enrich(hostilePack(), { read: hostileRead() });
    assert.equal(pack.requirePreview, true, id);
    assert.equal(previewRequired('first', id, [id], pack), true, id);
  }
  // an ordinary run is not marked
  assert.equal(previewRequired('first', 'record-summary', ['record-summary'], hostilePack()), false);
});

// ---- SEC-05: linked incidents, changes, an account's cases ---------------------------------------------------------------------

test('SEC-05: problem-rca: the people on the linked incidents are on the pack and masked, and the pack requires the preview', async () => {
  const tables = domainTables();
  tables.incident[0].caller_id = v('a'.repeat(32), 'Priya Raman');
  tables.incident[0].assigned_to = v('b'.repeat(32), 'Dev Mehta');
  tables.incident[0].short_description = v('Gateway timeout reported by Priya Raman');
  tables.incident[0].close_notes = v('Dev Mehta restarted the pool');
  const fake = fakeDeps(tables);
  const pack = await readContextPack({ table: 'problem', sysId: IDS.problem }, fake, { feature: 'problem-rca' });
  const names = pack.people.filter((p) => p.role === 'reference_person').map((p) => p.name);
  assert.ok(names.includes('Priya Raman') && names.includes('Dev Mehta'), JSON.stringify(names));
  assert.equal(pack.requirePreview, true);
  assert.ok(pack.people.length <= LIMITS.people + LIMITS.referencePeople);
  const text = outgoing(run('problem-rca', pack));
  assert.ok(!/Priya|Raman|Dev Mehta/.test(text));
  assert.match(text, /Gateway timeout reported by \[PERSON_\d+\]/);
  // the shaped rows themselves did not change (the names ride on the people list)
  assert.deepEqual(Object.keys(pack.related.linkedIncidents[0]), ['number', 'short_description', 'state', 'opened', 'resolved', 'ci', 'closeNotes']);
});

test('SEC-05: a problem with no linked incident, or a plain incident, is not marked', async () => {
  const none = domainTables();
  none.incident = [];
  const pack = await readContextPack({ table: 'problem', sysId: IDS.problem }, fakeDeps(none), { feature: 'problem-rca' });
  assert.equal(pack.requirePreview, undefined);
  const inc = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, fakeDeps(buildInstance()), { feature: 'record-summary' });
  assert.equal(inc.requirePreview, undefined);
});

test('SEC-05: change-cab-brief: the people on overlapping changes are on the pack and the pack requires the preview', async () => {
  const tables = domainTables();
  const others = tables.change_request.filter((r) => r.sys_id.value !== IDS.change);
  assert.ok(others.length > 0, 'the fixture has overlapping changes');
  others[0].requested_by = v('d'.repeat(32), 'Ravi Menon');
  others[0].assigned_to = v('e'.repeat(32), 'Sana Qureshi');
  const pack = await readContextPack({ table: 'change_request', sysId: IDS.change }, fakeDeps(tables), { feature: 'change-cab-brief' });
  assert.ok(pack.related.conflicts?.length > 0, 'a conflict was found');
  const names = pack.people.filter((p) => p.role === 'reference_person').map((p) => p.name);
  assert.ok(names.includes('Ravi Menon') || names.includes('Sana Qureshi'), JSON.stringify(names));
  assert.equal(pack.requirePreview, true);
});

test('SEC-05: account-briefing: recent changes on the case\'s CI mark the pack; the account\'s other cases bring their people', async () => {
  const tables = domainTables();
  const pack = await readContextPack({ table: 'sn_customerservice_case', sysId: IDS.case }, fakeDeps(tables), { feature: 'account-briefing' });
  if (pack.related.recentChanges?.length) assert.equal(pack.requirePreview, true);
  const rows = caseRows().filter((r) => r.sys_id.value !== IDS.case);
  rows[0].contact = v('1'.repeat(32), 'Lena Fischer');
  rows[0].assigned_to = v('2'.repeat(32), 'Omar Haddad');
  const fake = fakeDeps({ sn_customerservice_case: [caseRows()[0], ...rows] });
  const answer = await OPS.accountCases({ table: 'sn_customerservice_case', sysId: IDS.case }, { deps: fake, checkRecord, checkPack });
  assert.ok(answer.cases.some((c) => c.people.includes('Lena Fischer') && c.people.includes('Omar Haddad')));
  const merged = mergeAccountCases({ table: 'sn_customerservice_case', people: [{ role: 'contact', name: 'Marisol Quintero' }], related: {}, access: [] }, answer);
  const added = merged.people.filter((p) => p.role === 'reference_person').map((p) => p.name);
  assert.deepEqual(added.sort(), ['Lena Fischer', 'Omar Haddad']);
  assert.equal(merged.requirePreview, true);
  assert.ok(merged.related.accountCases.every((c) => !('people' in c)), 'the names are not part of the text that is sent');
  assert.equal(merged.people[0].name, 'Marisol Quintero');
  // no other cases, no flag
  const empty = mergeAccountCases({ table: 'sn_customerservice_case', people: [], related: {}, access: [] }, { cases: [], more: 0, access: [{ source: 'x', status: 'empty', note: '' }] });
  assert.equal(empty.requirePreview, undefined);
});

test('SEC-05: cleanCases keeps at most a few names per case, as short plain strings', () => {
  const [one] = cleanCases([{ number: 'CS0000001', short_description: 'x', people: ['Lena Fischer', 5, '', 'a'.repeat(300), 'B', 'C', 'D', 'E'] }]);
  assert.ok(one.people.length <= 4);
  assert.ok(one.people.every((n) => typeof n === 'string' && n.length <= 100));
  assert.deepEqual(cleanCases([{ number: 'CS0000002', short_description: 'x' }])[0].people, []);
});

test('SEC-05: chat-reply: the knowledge hits\' authors are masked and the pack requires the preview', async () => {
  const feature = featureById('chat-reply');
  const pack = {
    version: 1, table: 'interaction', sysId: 'a'.repeat(32), number: 'IMS0001', kind: 'chat', fields: { short_description: 'VPN' }, people: [],
    journal: [{ when: '2026-10-26 09:00:00', by: 'Abel Tuter', type: 'comment', text: 'My VPN keeps dropping', side: 'customer' }],
    related: {}, access: [],
  };
  const read = async () => ({ hits: [{ number: 'KB0010001', short_description: 'VPN fix', excerpt: 'Written by Kara Nilsson: switch to TCP.', people: ['Kara Nilsson'] }], access: [] });
  const out = await feature.enrich(pack, { read });
  assert.equal(out.requirePreview, true);
  assert.ok(out.people.some((p) => p.role === 'reference_person' && p.name === 'Kara Nilsson'));
  const text = outgoing(run('chat-reply', out));
  assert.ok(!/Kara|Nilsson/.test(text));
  const none = await feature.enrich(pack, { read: async () => ({ hits: [], access: [] }) });
  assert.equal(none.requirePreview, undefined);
});

// ---- The columns the extra reads ask for are within the ceilings (SEC-14) ----------------------------------------------------------

test('SEC-14: the extra columns read from other tables are inside the display ceiling of their kind', async () => {
  const tables = domainTables();
  const fake = fakeDeps(tables);
  await readContextPack({ table: 'problem', sysId: IDS.problem }, fake, { feature: 'problem-rca' });
  const linked = fake.callsTo('incident').find((c) => c.fields.includes('problem_id'));
  for (const name of linked.fields) assert.ok(name === 'sys_id' || FIELDS_BY_KIND.incident.includes(name), `incident.${name} is not in the incident ceiling`);
  const changeFake = fakeDeps(domainTables());
  await readContextPack({ table: 'change_request', sysId: IDS.change }, changeFake, { feature: 'change-cab-brief' });
  for (const call of changeFake.callsTo('change_request').filter((c) => c.options.limit > 1)) {
    for (const name of call.fields) assert.ok(name === 'sys_id' || FIELDS_BY_KIND.change.includes(name), `change_request.${name}`);
  }
  const caseFake = fakeDeps(domainTables());
  await OPS.accountCases({ table: 'sn_customerservice_case', sysId: IDS.case }, { deps: caseFake, checkRecord, checkPack });
  for (const call of caseFake.calls) for (const name of call.fields) assert.ok(name === 'sys_id' || FIELDS_BY_KIND.case.includes(name), `case.${name}`);
  // look-alikes: every column of a hit is a column of some ticket kind
  const simFake = fakeDeps(buildInstance());
  await findSimilarTickets({ table: 'incident', sysId: INCIDENT_ID, fields: { short_description: 'VPN keeps disconnecting' }, people: [] }, simFake, {});
  const everyColumn = new Set(Object.values(FIELDS_BY_KIND).flat());
  for (const name of simFake.callsTo('incident')[0].fields) assert.ok(name === 'sys_id' || everyColumn.has(name), `similar: ${name}`);
});

test('SEC-14: problem_id is on the incident ceiling and on the resolution-check spec (the Check tab reads it as a yes/no)', () => {
  assert.ok(FIELDS_BY_KIND.incident.includes('problem_id'));
  assert.ok(FEATURE_FIELDS['resolution-check'].incident.includes('problem_id'));
  assert.ok(!FEATURE_FIELDS['resolution-check'].problem.includes('problem_id'), 'only incidents have it');
  assert.ok(!FEATURE_FIELDS['record-summary'].incident.includes('problem_id'), 'no other feature reads it');
});
