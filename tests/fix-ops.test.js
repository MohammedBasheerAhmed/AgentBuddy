import test from 'node:test';
import assert from 'node:assert/strict';
import { OPS } from '../src/content/ops/index.js';
import fixOps, { articleCodeQuery, checkCodes, searchArticlesByCode, searchSolvedByCode, ticketCodeQuery } from '../src/content/ops/fix.js';
import { checkPack, checkRecord } from '../src/content/ops/validate.js';
import { createPolicyGuard } from '../src/content/policyGuard.js';
import { fakeDeps, sessionExpiredError, v } from './fixtures/sn-fakeDeps.js';

// Find the fix (round 4): the error code search (src/content/ops/fix.js) against a fake instance with injected deps. GET only, the codes
// checked before they go into a query, the instance's LIKE checked again on every row, the record itself never returned, a refusal or
// an empty answer said honestly, and nothing read only to check (an article's body, a ticket's description) handed back.

const OWN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01';
const id = (n) => `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${String(n).padStart(2, '0')}`;
const NOW = Date.UTC(2026, 10, 6, 12);

function incident(n, { number, title, description = '', notes = '', state = 'Closed', resolved = '2026-10-20 10:00:00', closed = '', cls } = {}) {
  return {
    sys_id: v(id(n)),
    number: v(number),
    short_description: v(title),
    description: v(description),
    close_notes: v(notes),
    state: v(state === 'Closed' ? '7' : state === 'Resolved' ? '6' : '2', state),
    resolved_at: v(resolved, resolved),
    closed_at: v(closed, closed),
    sys_updated_on: v(resolved || '2026-10-01 10:00:00'),
    ...(cls ? { sys_class_name: v(cls, cls) } : {}),
  };
}

function article(n, { number, title, text, state = 'published', validTo = '2027-12-31', updated = '2026-09-01 10:00:00' }) {
  return {
    sys_id: v(`cccccccccccccccccccccccccccccc${String(n).padStart(2, '0')}`),
    number: v(number),
    short_description: v(title),
    text: v(text),
    workflow_state: v(state, state === 'published' ? 'Published' : 'Draft'),
    kb_knowledge_base: v(`kbb${n}`, 'IT Knowledge Base'),
    valid_to: v(validTo),
    sys_updated_on: v(updated),
  };
}

function tables() {
  return {
    incident: [
      // the record itself quotes the code: it is never one of the answers
      { ...incident(0, { number: 'INC0010030', title: 'Outlook error 0x800CCC0F on phone', notes: 'Reopened.', resolved: '2026-11-06 09:00:00' }), sys_id: v(OWN) },
      incident(1, { number: 'INC0010021', title: 'Mail on phone stopped', description: '<p>Outlook says <b>0x800CCC0F</b> after the password change.</p>', notes: 'Removed the mail account on the phone and added it again. Works now.', resolved: '2026-11-05 09:00:00' }),
      incident(2, { number: 'INC0010011', title: 'Cannot send mail', notes: 'Error 0x800ccc0f: re-entered the SMTP password.', state: 'Resolved', resolved: '2026-10-30 09:00:00' }),
      // the characters inside a longer code: the LIKE finds it, the check drops it
      incident(3, { number: 'INC0010012', title: 'Odd code A800CCC0F9 in a log', notes: 'Not a mail problem.' }),
      // never resolved or closed (close notes written early): not a solved ticket
      incident(4, { number: 'INC0010013', title: 'Outlook 0x800CCC0F again', notes: 'Draft notes.', state: 'In Progress', resolved: '' }),
      // closed through closed_at only (a table without resolved_at)
      incident(5, { number: 'INC0010014', title: 'Error 0x800CCC0F in the mail client', notes: 'Rebuilt the profile.', resolved: '', closed: '2026-10-10 10:00:00' }),
      // installer: "1603" as a code, and "1603" as a room number
      incident(6, { number: 'INC0010015', title: 'Install fails', notes: 'MSI error 1603: cleared the temp folder and installed again.' }),
      incident(7, { number: 'INC0010016', title: 'Projector in room 1603', notes: 'Replaced the lamp.' }),
    ],
    kb_knowledge: [
      article(1, { number: 'KB0000032', title: 'Mail on a phone after a password change', text: '<p>If Outlook shows <b>0x800CCC0F</b>, remove the mail account on the phone and add it again.</p>' }),
      article(2, { number: 'KB0000040', title: 'Error 0x800CCC0F (draft)', text: '<p>Draft.</p>', state: 'draft' }),
      article(3, { number: 'KB0000041', title: 'Old mail guide', text: '<p>0x800CCC0F: use the old server.</p>', validTo: '2024-01-01' }),
      article(4, { number: 'KB0000042', title: 'Codes like A800CCC0F9', text: '<p>Not this one.</p>' }),
      article(5, { number: 'KB0000043', title: 'Installer error 1603', text: '<p>Windows Installer error 1603 means a fatal error during installation.</p>' }),
    ],
  };
}

const withClock = (deps) => Object.assign(deps, { now: () => NOW });
const ctx = (deps, extra = {}) => ({ deps, checkRecord, checkPack, allowSensitive: false, ...extra });
const ask = (deps, args, extra) => OPS.fixCodeSearch({ table: 'incident', sysId: OWN, ...args }, ctx(deps, extra));

test('the operation is registered, and the codes are checked before anything is asked', async () => {
  assert.equal(OPS.fixCodeSearch, fixOps.fixCodeSearch);
  assert.deepEqual(checkCodes(['800CCC0F']), ['800CCC0F']);
  assert.deepEqual(checkCodes(['1603', 'ORA-12154', '1603']), ['1603', 'ORA-12154'], 'a code asked twice is searched once');
  assert.deepEqual(checkCodes(['NullPointerException', 'java.net.SocketTimeoutException', 'HY000']), ['NullPointerException', 'java.net.SocketTimeoutException', 'HY000']);
  const bad = [
    undefined, null, '1603', [], ['1603', '1618', '1619', '1620'], [''], ['a'], ['x'.repeat(41)], ['1603^ORactive=true'], ['1603\n'], ['ORA 12154'],
    ['javascript:alert(1)'], ['%'], ['*'], ['-1603'], ['.1603'], [1603], [null], [{ toString: () => '1603' }], ['1603', '^'],
  ];
  for (const codes of bad) assert.throws(() => checkCodes(codes), /not an error code Agent Buddy can search for/, JSON.stringify(codes));

  const deps = withClock(fakeDeps(tables()));
  await assert.rejects(ask(deps, { codes: ['1603^ORsys_idISNOTEMPTY'] }), /not an error code/);
  await assert.rejects(OPS.fixCodeSearch({ table: 'incident; drop', sysId: OWN, codes: ['1603'] }, ctx(deps)), /not a valid record/);
  await assert.rejects(OPS.fixCodeSearch({ table: 'incident', sysId: 'not-an-id', codes: ['1603'] }, ctx(deps)), /not a valid record/);
  await assert.rejects(OPS.fixCodeSearch(undefined, ctx(deps)), /not a valid record/);
  assert.equal(deps.calls.length, 0, 'nothing was asked of the instance');
});

test('the queries: published articles by title or text; tickets with close notes by title, description or close notes, never the record', () => {
  assert.equal(articleCodeQuery(['800CCC0F']), 'workflow_state=published^short_descriptionLIKE800CCC0F^ORtextLIKE800CCC0F^ORDERBYDESCsys_updated_on');
  assert.equal(
    articleCodeQuery(['1603', 'ORA-12154']),
    'workflow_state=published^short_descriptionLIKE1603^ORtextLIKE1603^ORshort_descriptionLIKEORA-12154^ORtextLIKEORA-12154^ORDERBYDESCsys_updated_on'
  );
  assert.equal(
    ticketCodeQuery(['800CCC0F'], OWN.toUpperCase()),
    `close_notesISNOTEMPTY^sys_id!=${OWN}^short_descriptionLIKE800CCC0F^ORdescriptionLIKE800CCC0F^ORclose_notesLIKE800CCC0F^ORDERBYDESCsys_updated_on`
  );
  // a term that is not safe never reaches a query, even past checkCodes
  assert.equal(articleCodeQuery(['1603^ORactive=true']), '');
  assert.equal(articleCodeQuery([]), '');
  assert.equal(ticketCodeQuery(['1603'], 'not-an-id'), '', 'no exclusion, no query');
  assert.equal(ticketCodeQuery(['x^y'], OWN), '');
});

test('a search: up to 5 of each, newest first, every row checked again; GET only and only the columns it needs', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await ask(deps, { codes: ['800CCC0F'] });
  assert.deepEqual(answer.codes, ['800CCC0F']);
  assert.deepEqual(answer.articles.map((a) => a.number), ['KB0000032'], 'not the draft, not the expired one, not the one that only has the characters');
  assert.deepEqual(answer.articles[0], {
    sysId: 'cccccccccccccccccccccccccccccc01',
    number: 'KB0000032',
    short_description: 'Mail on a phone after a password change',
    knowledgeBase: 'IT Knowledge Base',
    excerpt: 'If Outlook shows 0x800CCC0F, remove the mail account on the phone and add it again.',
    codes: ['800CCC0F'],
  });
  assert.deepEqual(answer.tickets.map((x) => x.number), ['INC0010021', 'INC0010011', 'INC0010014'], 'newest first; not the record, not the unsolved one, not the look-alike characters');
  assert.deepEqual(answer.tickets[0], {
    table: 'incident',
    sysId: id(1),
    number: 'INC0010021',
    short_description: 'Mail on phone stopped',
    state: 'Closed',
    solvedUtc: '2026-11-05 09:00:00',
    fix: 'Removed the mail account on the phone and added it again. Works now.',
    codes: ['800CCC0F'],
  });
  assert.equal(answer.tickets[2].solvedUtc, '2026-10-10 10:00:00', 'closed_at when there is no resolved_at');
  assert.ok(!JSON.stringify(answer).includes('password change.</p>') && !answer.tickets.some((x) => 'description' in x), 'the description read to check is not handed back');
  assert.deepEqual(answer.access.map((a) => [a.source, a.status]), [['kb_knowledge', 'ok'], ['incident', 'ok']]);

  assert.equal(deps.calls.length, 2, 'one read per table');
  for (const call of deps.calls) {
    assert.equal(call.fn, 'queryTable');
    assert.equal(call.options.limit, 20);
  }
  const [kbCall, ticketCall] = [deps.callsTo('kb_knowledge')[0], deps.callsTo('incident')[0]];
  assert.equal(kbCall.query, articleCodeQuery(['800CCC0F']));
  assert.equal(ticketCall.query, ticketCodeQuery(['800CCC0F'], OWN));
  assert.ok(!ticketCall.fields.some((f) => /caller|assigned|opened_by|email/.test(f)), 'no person column is read');
});

test('a short number counts only where it is quoted as a code; several codes are searched together and each answer says which', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await ask(deps, { codes: ['1603', '800CCC0F'] });
  assert.deepEqual(answer.tickets.map((x) => [x.number, x.codes]), [
    ['INC0010021', ['800CCC0F']],
    ['INC0010011', ['800CCC0F']],
    ['INC0010015', ['1603']],
    ['INC0010014', ['800CCC0F']],
  ]);
  assert.ok(!answer.tickets.some((x) => x.number === 'INC0010016'), 'room 1603 is not error 1603');
  assert.deepEqual(answer.articles.map((a) => [a.number, a.codes]), [['KB0000032', ['800CCC0F']], ['KB0000043', ['1603']]]);
});

test('at most 5 articles and 5 tickets', async () => {
  const t = tables();
  for (let n = 10; n < 20; n += 1) {
    t.incident.push(incident(n, { number: `INC00200${n}`, title: `Mail error 0x800CCC0F #${n}`, notes: 'Fixed.', resolved: `2026-09-${n} 10:00:00` }));
    t.kb_knowledge.push(article(n, { number: `KB00001${n}`, title: `0x800CCC0F guide ${n}`, text: '<p>Text.</p>' }));
  }
  const answer = await ask(withClock(fakeDeps(t)), { codes: ['800CCC0F'] });
  assert.equal(answer.articles.length, 5);
  assert.equal(answer.tickets.length, 5);
});

test('nothing found is a fact only when it could be read; a refusal is said as such', async () => {
  const none = await ask(withClock(fakeDeps(tables())), { codes: ['ORA-12154'] });
  assert.deepEqual([none.articles, none.tickets], [[], []]);
  assert.deepEqual(none.access.map((a) => [a.source, a.status]), [['kb_knowledge', 'empty'], ['incident', 'empty']]);

  const hidden = await ask(withClock(fakeDeps(tables(), { hidden: ['kb_knowledge'] })), { codes: ['800CCC0F'] });
  assert.equal(hidden.access.find((a) => a.source === 'kb_knowledge').status, 'empty-or-hidden', 'no article visible at all proves nothing');
  assert.equal(hidden.tickets.length, 3, 'the tickets are still searched');

  const denied = await ask(withClock(fakeDeps(tables(), { denied: ['kb_knowledge', 'incident'] })), { codes: ['800CCC0F'] });
  assert.deepEqual(denied.access.map((a) => [a.source, a.status]), [['kb_knowledge', 'denied'], ['incident', 'denied']]);

  await assert.rejects(ask(withClock(fakeDeps(tables(), { expired: ['kb_knowledge'] })), { codes: ['800CCC0F'] }), /session has expired/);
  assert.equal(sessionExpiredError().code, 'SESSION_EXPIRED');
});

test('policy: a blocked table is not read and is reported as blocked', async () => {
  const guard = createPolicyGuard({ getManaged: async () => ({ known: true, raw: { blockedTables: ['kb_knowledge'] } }) });
  const fake = withClock(fakeDeps(tables()));
  const deps = await guard.deps(fake);
  const answer = await OPS.fixCodeSearch({ table: 'incident', sysId: OWN, codes: ['800CCC0F'] }, ctx(deps));
  assert.equal(answer.access.find((a) => a.source === 'kb_knowledge').status, 'blocked');
  assert.equal(fake.callsTo('kb_knowledge').length, 0);
  assert.equal(answer.tickets.length, 3);
});

test('sensitive tables: another HR case is searched only when sensitive data is allowed; a general task row needs a readable, allowed class', async () => {
  const hrRows = [incident(1, { number: 'HRC0001001', title: 'Payroll export error 0x800CCC0F', notes: 'Fixed the export.' })];
  const t = { ...tables(), sn_hr_core_case: hrRows };
  const deps = withClock(fakeDeps(t));
  const skipped = await OPS.fixCodeSearch({ table: 'sn_hr_core_case', sysId: OWN, codes: ['800CCC0F'] }, ctx(deps));
  assert.deepEqual(skipped.tickets, []);
  assert.equal(skipped.access.find((a) => a.source === 'sn_hr_core_case').status, 'skipped');
  assert.equal(deps.callsTo('sn_hr_core_case').length, 0);
  assert.equal(skipped.articles.length, 1, 'articles are not about anyone: still searched');
  const allowed = await OPS.fixCodeSearch({ table: 'sn_hr_core_case', sysId: OWN, codes: ['800CCC0F'] }, ctx(deps, { allowSensitive: true }));
  assert.deepEqual(allowed.tickets.map((x) => x.number), ['HRC0001001']);

  const taskRows = [
    incident(1, { number: 'INC0030001', title: 'Mail 0x800CCC0F', notes: 'Fixed.', cls: 'incident' }),
    incident(2, { number: 'HRT0030002', title: 'Mail 0x800CCC0F', notes: 'Fixed.', cls: 'sn_hr_core_task' }),
    incident(3, { number: 'TASK0030003', title: 'Mail 0x800CCC0F', notes: 'Fixed.' }),
  ];
  const taskDeps = withClock(fakeDeps({ ...tables(), task: taskRows }));
  const tasks = await OPS.fixCodeSearch({ table: 'task', sysId: OWN, codes: ['800CCC0F'] }, ctx(taskDeps));
  assert.deepEqual(tasks.tickets.map((x) => x.number), ['INC0030001'], 'an HR row and a row whose class cannot be told are left out');
  assert.ok(taskDeps.callsTo('task')[0].fields.includes('sys_class_name'));
});

test('a record that is not a ticket: articles only', async () => {
  const deps = withClock(fakeDeps(tables()));
  const answer = await OPS.fixCodeSearch({ table: 'sys_user', sysId: OWN, codes: ['800CCC0F'] }, ctx(deps));
  assert.deepEqual(answer.tickets, []);
  assert.deepEqual(answer.access.find((a) => a.source === 'sys_user'), { source: 'sys_user', status: 'skipped', note: 'Solved tickets are looked up for tickets only.' });
  assert.equal(deps.callsTo('sys_user').length, 0);
  assert.equal(answer.articles.length, 1);
});

test('the helpers on their own: an instance that ignored a condition does not leak drafts or unsolved tickets', async () => {
  // A fake that answers every row whatever the query says (as an instance that ignored the conditions would).
  const all = tables();
  const loose = {
    calls: [],
    async queryTable(table, query, fields) {
      this.calls.push({ table, query, fields });
      return (all[table] || []).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => fields.includes(k))));
    },
  };
  const kb = await searchArticlesByCode(['800CCC0F'], loose, { now: NOW });
  assert.deepEqual(kb.items.map((a) => a.number), ['KB0000032']);
  const solved = await searchSolvedByCode({ table: 'incident', sysId: OWN }, ['800CCC0F'], loose);
  assert.deepEqual(solved.items.map((x) => x.number), ['INC0010021', 'INC0010011', 'INC0010014']);
  const self = await searchSolvedByCode({ table: 'incident', sysId: id(1) }, ['800CCC0F'], loose);
  assert.ok(!self.items.some((x) => x.sysId === id(1)), 'the record itself, even when the instance returns it');
});
