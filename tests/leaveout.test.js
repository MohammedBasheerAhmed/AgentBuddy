import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAVE_OUT_IDS, choicesOf, cleanLeaveOut, knownIds, leaveOutParts, leftOutAccess, withLeaveOut } from '../src/lib/leaveOut.js';
import { prepareRun, previewRequired, auditBlocked, auditCancelled, executeRun } from '../src/lib/pipeline.js';
import { featureById } from '../src/features/registry.js';
import { unavailable, madeWithout, unavailableText } from '../src/features/parts.js';
import { normalizePolicy, effectiveSettings } from '../src/policy/policy.js';
import { resolveProviderConfig } from '../src/providers/config.js';
import { createRunController } from '../src/sidepanel/useRun.js';

// "What goes in" (round 5, board F): the person can leave groups of a request out before it is sent, never add to it.

const PACK = {
  version: 1,
  table: 'incident',
  sysId: 'a'.repeat(32),
  number: 'INC0010001',
  kind: 'incident',
  fields: { number: 'INC0010001', short_description: 'VPN fails for Abel Tuter', state: 'In Progress' },
  people: [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com' }],
  journal: [
    { when: '2026-10-26 09:00:00', by: 'Beth Anglin', type: 'work_note', text: 'Asked Abel to restart.' },
    { when: '2026-10-26 09:05:00', by: 'Beth Anglin', type: 'work_note', text: 'Checked the gateway logs.' },
    { when: '2026-10-26 09:10:00', by: 'Abel Tuter', type: 'comment', text: 'Still failing.' },
  ],
  related: {},
  access: [],
};

const fakeFirewall = (opts) => {
  const fw = {
    opts,
    // (like the real one for what the tests need: a text the person asked to hide is replaced by a placeholder, everywhere)
    buildRequest: (req) => {
      const hide = (text) => (req.mask || []).reduce((out, m) => out.split(m).join('[MASKED_1]'), text);
      return { messages: [{ role: 'system', content: req.system }, { role: 'user', content: JSON.stringify(req.parts) }], preview: req.parts.map((p) => hide(p.text)).join('\n'), stats: { total: 0, counts: {} }, mode: opts.mode };
    },
    rehydrate: (x) => x,
    scan: () => [],
  };
  return fw;
};
const values = (over = {}) => effectiveSettings({ provider: 'anthropic', ...over }, {}).values;
const config = () => resolveProviderConfig({ provider: 'anthropic' }, 'sk-ant-test');
const summary = featureById('record-summary');
const prepare = (extra = {}, v = values()) => prepareRun({ feature: summary, pack: PACK, values: v, policy: normalizePolicy({}), config: config(), createFirewall: fakeFirewall, ...extra });
const fieldsOf = (prepared) => prepared.input.parts.map((p) => p.field);

test('the choices are the groups the request really holds, with how many parts each covers', () => {
  const parts = [{ field: 'short_description' }, { field: 'work_notes' }, { field: 'work_notes' }, { field: 'comments' }, { field: 'caller_tickets' }, { field: 'kb_article' }, { field: 'reference_status' }];
  assert.deepEqual(choicesOf(parts).map((c) => [c.id, c.count]), [['comments', 1], ['work_notes', 2], ['caller_tickets', 1], ['kb_articles', 1]]);
  assert.deepEqual(choicesOf([{ field: 'short_description' }]), [], 'the ticket\'s own fields are never a choice');
  assert.deepEqual(choicesOf(null), []);
});

test('leaving out removes the groups\' parts and nothing else; unknown ids and repeats do nothing', () => {
  const parts = [{ field: 'short_description' }, { field: 'work_notes' }, { field: 'comments' }, { field: 'reference_ticket' }, { field: 'reference_ticket_routing' }, { field: 'reference_status' }];
  assert.deepEqual(leaveOutParts(parts, ['work_notes']).map((p) => p.field), ['short_description', 'comments', 'reference_ticket', 'reference_ticket_routing', 'reference_status']);
  assert.deepEqual(leaveOutParts(parts, ['reference_tickets']).map((p) => p.field), ['short_description', 'work_notes', 'comments', 'reference_status'], 'a group covers all its handles; the status part stays');
  assert.deepEqual(leaveOutParts(parts, ['short_description', 'nonsense', 'work_notes', 'work_notes']).map((p) => p.field), ['short_description', 'comments', 'reference_ticket', 'reference_ticket_routing', 'reference_status']);
  assert.equal(leaveOutParts(parts, []).length, parts.length);
  assert.deepEqual(knownIds(['work_notes', 'x', 'comments', 'comments']), ['comments', 'work_notes']);
});

test('the setting is cleaned: plain action handles, known groups, nothing else', () => {
  assert.deepEqual(cleanLeaveOut({ 'record-summary': ['work_notes', 'zzz', 'work_notes'], 'Bad Id!': ['comments'], 'reply-draft': [], [`${'x'.repeat(80)}`]: ['comments'] }), { 'record-summary': ['work_notes'] });
  for (const odd of [null, undefined, 5, 'x', [], [['a']]]) assert.deepEqual(cleanLeaveOut(odd), {});
  assert.deepEqual(withLeaveOut({ a: ['comments'] }, 'b', ['work_notes']), { a: ['comments'], b: ['work_notes'] });
  assert.deepEqual(withLeaveOut({ a: ['comments'], b: ['work_notes'] }, 'a', []), { b: ['work_notes'] }, 'nothing left out: the entry is forgotten');
  assert.deepEqual(withLeaveOut({}, '[object Object]', ['comments']), {}, 'an action that is not a handle is refused');
  assert.equal(effectiveSettings({ aiLeaveOut: { 'record-summary': ['work_notes', 'bogus'] } }, {}).values.aiLeaveOut['record-summary'].join(), 'work_notes');
  assert.deepEqual(effectiveSettings({ aiLeaveOut: 'oops' }, {}).values.aiLeaveOut, {});
  assert.equal(LEAVE_OUT_IDS.length, new Set(LEAVE_OUT_IDS).size, 'group ids are unique');
});

test('with nothing left out the request is exactly what it was, and the choices are offered', () => {
  const prepared = prepare();
  assert.ok(fieldsOf(prepared).includes('work_notes') && fieldsOf(prepared).includes('comments'));
  assert.deepEqual(prepared.choices.map((c) => [c.id, c.count]), [['comments', 1], ['work_notes', 2]]);
  assert.deepEqual(prepared.leftOut, []);
  assert.equal(prepared.strict, false);
});

test('a group left out is not in the request, the model is told it was the person\'s choice, and "Made without" says so', () => {
  const prepared = prepare({ leaveOut: ['work_notes'] });
  assert.ok(!fieldsOf(prepared).includes('work_notes'), 'no work note reaches the firewall');
  assert.ok(fieldsOf(prepared).includes('comments') && fieldsOf(prepared).includes('short_description'));
  assert.deepEqual(prepared.leftOut, ['work_notes']);
  assert.deepEqual(prepared.choices.map((c) => c.id), ['comments', 'work_notes'], 'the group stays in the list, so it can be put back');
  const note = prepared.input.parts.find((p) => p.field === 'data_not_available');
  assert.match(note.text, /Work notes \(internal\)/);
  assert.match(note.text, /chose to leave this out/);
  assert.match(note.text, /do not describe it as empty/);
  assert.ok(prepared.madeWithout.some((m) => m.what === 'Work notes (internal)' && m.why === 'left out by you'), JSON.stringify(prepared.madeWithout));
  assert.equal(prepared.pack, PACK, 'the pack itself is untouched');
  assert.ok(!JSON.stringify(PACK.access).includes('left-out'), 'nothing was added to the caller\'s pack');
});

test('a group the request does not hold is ignored; everything can be left out; the ticket\'s own fields always go', () => {
  const none = prepare({ leaveOut: ['kb_articles', 'caller_tickets'] });
  assert.deepEqual(none.leftOut, []);
  const all = prepare({ leaveOut: ['comments', 'work_notes'] });
  assert.ok(!fieldsOf(all).some((f) => f === 'comments' || f === 'work_notes'));
  assert.ok(fieldsOf(all).includes('short_description'));
  assert.deepEqual(all.leftOut, ['comments', 'work_notes']);
});

test('Strict for this one makes only this request stricter, and never looser', () => {
  assert.equal(prepare({ strict: true }).request.mode, 'strict');
  assert.equal(prepare({ strict: true }).strict, true);
  assert.equal(prepare({}).request.mode, 'standard');
  assert.equal(prepare({ strict: false }, values({ piiMode: 'strict' })).request.mode, 'strict', 'a setting that is Strict stays Strict');
  assert.equal(prepare({ strict: true }, values({ piiMode: 'strict' })).strict, false, 'nothing to change when it was Strict already');
});

test('leftOutAccess feeds unavailable(): the group\'s own words, flagged as the person\'s choice', () => {
  const list = unavailable({ table: 'incident', access: leftOutAccess([{ id: 'caller_tickets', label: "The caller's other tickets" }, { id: 'nope', label: 'x' }]) });
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].what, list[0].status, list[0].leftOut, list[0].why], ["The caller's other tickets", 'skipped', true, 'left out by you']);
  assert.match(unavailableText(list), /^These parts could not be read.*\n- The caller's other tickets: The person chose to leave this out/s);
  assert.equal(madeWithout(list)[0].why, 'left out by you');
});

// ---- the controller: choose() builds the request again, remember() keeps the choice -------------------------------------------------

function controller(over = {}) {
  const remembered = [];
  const eff = { values: values({ previewMode: 'always', ...(over.settings || {}) }), apiKey: 'sk-ant-test', policy: normalizePolicy({}) };
  const ctl = createRunController({
    getEnv: () => ({ page: { tabId: 1, href: 'https://dev.example.com/incident.do', record: { table: 'incident', sysId: PACK.sysId, number: PACK.number } }, eff, record: { table: 'incident', sysId: PACK.sysId } }),
    deps: { ensureAiPermission: async () => {}, prepareRun, previewRequired, auditBlocked, auditCancelled, createFirewall: fakeFirewall, logAudit: async () => {}, executeRun, sendChat: async () => ({ text: 'ok', usage: {} }) },
    tokensUsed: async () => 0,
    rememberSeen: () => {},
    rememberLeaveOut: async (next) => remembered.push(next),
  });
  return { ctl, remembered, eff };
}
const waitFor = async (ctl, phase) => {
  for (let i = 0; i < 50 && ctl.getState().phase !== phase; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctl.getState().phase, phase);
};

test('choose() builds the request again with the group left out, keeps what the person hid by hand, and remember() keeps the choice per action', async () => {
  const { ctl, remembered } = controller();
  await ctl.run(summary, { getPack: async () => PACK });
  await waitFor(ctl, 'preview');
  const first = ctl.getState().prepared.p;
  assert.ok(fieldsOf(first).includes('work_notes'));
  assert.equal(ctl.maskMore('Abel').ok, true, 'the person hides a name by hand');
  const out = ctl.choose({ leaveOut: ['work_notes'] });
  assert.equal(out.ok, true);
  const second = ctl.getState().prepared.p;
  assert.ok(!second.request.preview.includes('Abel'), 'what they hid by hand is hidden again in the new request');
  assert.ok(second.request.preview.includes('[MASKED_1]'));
  assert.ok(!fieldsOf(second).includes('work_notes'));
  assert.deepEqual(second.leftOut, ['work_notes']);
  assert.notEqual(second.firewall, first.firewall, 'built again through a new firewall');
  assert.equal(second.runKey, first.runKey || first.firewall, 'but it is the same check: the dialog keeps its place');
  assert.equal(ctl.getState().phase, 'preview', 'nothing was sent');
  // put it back, then Strict for this one: each choice starts from the one before
  assert.equal(ctl.choose({ leaveOut: [] }).ok, true);
  assert.ok(fieldsOf(ctl.getState().prepared.p).includes('work_notes'));
  assert.equal(ctl.choose({ strict: true }).ok, true);
  assert.equal(ctl.getState().prepared.p.request.mode, 'strict');
  assert.equal(ctl.choose({ leaveOut: ['comments'] }).ok, true);
  assert.equal(ctl.getState().prepared.p.request.mode, 'strict', 'Strict stays on while another choice changes');
  await ctl.remember(['comments']);
  assert.deepEqual(remembered, [{ 'record-summary': ['comments'] }]);
  await ctl.remember([]);
  assert.deepEqual(remembered[1], {}, 'forgetting removes the entry');
});

test('choose() with nothing waiting says so; a refused build leaves the old request standing', async () => {
  const { ctl } = controller();
  assert.deepEqual(ctl.choose({ leaveOut: ['comments'] }), { ok: false, problem: 'GONE' });
  await ctl.run(summary, { getPack: async () => PACK });
  await waitFor(ctl, 'preview');
  const before = ctl.getState().prepared.p;
  const refusing = createRunController({
    getEnv: () => ({ page: { tabId: 1, href: 'https://dev.example.com/', record: { table: 'incident' } }, eff: { values: values({ previewMode: 'always' }), apiKey: 'sk-ant-test', policy: normalizePolicy({}) }, record: {} }),
    deps: { ensureAiPermission: async () => {}, prepareRun: (args) => { if (args.strict) throw new Error('Strict blocks a field.'); return prepareRun(args); }, previewRequired, auditBlocked, auditCancelled, createFirewall: fakeFirewall, logAudit: async () => {}, executeRun, sendChat: async () => ({}) },
    rememberSeen: () => {},
  });
  await refusing.run(summary, { getPack: async () => PACK });
  await waitFor(refusing, 'preview');
  const standing = refusing.getState().prepared.p;
  assert.deepEqual(refusing.choose({ strict: true }), { ok: false, problem: 'REFUSED' });
  assert.equal(refusing.getState().prepared.p, standing);
  assert.equal(ctl.getState().prepared.p, before);
});

test('a choice kept for an action is applied the next time it runs, and the check shows what that left out', async () => {
  const { ctl } = controller({ settings: { aiLeaveOut: { 'record-summary': ['work_notes'] } } });
  await ctl.run(summary, { getPack: async () => PACK });
  await waitFor(ctl, 'preview');
  const p = ctl.getState().prepared.p;
  assert.ok(!fieldsOf(p).includes('work_notes'));
  assert.deepEqual(p.leftOut, ['work_notes']);
  assert.ok(p.choices.some((c) => c.id === 'work_notes'), 'still on the list, so it can be put back');
});
