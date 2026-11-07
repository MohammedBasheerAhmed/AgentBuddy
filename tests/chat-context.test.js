import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MAX_MESSAGES, readChatMessages } from '../src/context/chat.js';
import { allowedFields, FIELDS_BY_KIND } from '../src/context/allowlists.js';
import { readContextPack } from '../src/context/pack.js';
import { fakeDeps, v } from './fixtures/sn-fakeDeps.js';
import { buildInstance } from './fixtures/sn-instance.js';
import { INCIDENT_ID } from './fixtures/sn-incident.js';
import { ABEL, BETH, CONVERSATION_ID, INTERACTION_ID, SEEDS, chatTables, id } from './knowledge-fixtures.js';

const interaction = { table: 'interaction', sysId: INTERACTION_ID };
const readChat = (ref = interaction, tables = chatTables(), behaviour, options) => {
  const deps = fakeDeps(tables, behaviour);
  return readChatMessages(ref, deps, options).then((result) => ({ result, deps }));
};

// ---- the reader -------------------------------------------------------------------------------------

test('messages of an interaction: found through its conversation, oldest first, events dropped, sides and names mapped', async () => {
  const { result, deps } = await readChat();
  assert.deepEqual(result.entries.map((e) => [e.when.slice(11), e.side, e.by]), [
    ['09:00:05', 'customer', 'abel.tuter'],
    ['09:00:09', 'bot', ''],
    ['09:01:00', 'agent', 'Beth Anglin'],
    ['09:02:00', 'customer', 'abel.tuter'],
    ['09:03:00', 'agent', 'Beth Anglin'],
    ['09:10:00', 'customer', 'abel.tuter'],
  ]);
  assert.ok(result.entries.every((e) => e.type === 'comment' && !('login' in e)));
  assert.ok(result.entries.every((e) => !/joined the chat/.test(e.text)), 'the system event is gone');
  assert.equal(result.entries[2].text, `Hi ${SEEDS.customerFirst}, this is ${SEEDS.agentName}. Which error do you see?`, 'HTML is stripped');
  assert.deepEqual(result.loginNames, ['abel.tuter']);
  assert.deepEqual(result.names, ['Beth Anglin']);
  const [entry] = result.access;
  assert.equal(entry.source, 'chat');
  assert.equal(entry.status, 'ok');
  assert.equal(entry.strategy, 'sys_cs_message via sys_cs_conversation.interaction');
  assert.match(entry.note, /UTC/);
  // GET-only: the reader can only call queryTable, and it asked for the conversation first.
  assert.ok(deps.calls.every((c) => c.fn === 'queryTable'));
  assert.equal(deps.calls[0].table, 'sys_cs_conversation');
  assert.equal(deps.calls[0].query, `interaction=${INTERACTION_ID}`);
});

test('the caps hold: at most max messages (newest), a note when more existed, reads bounded', async () => {
  const { result, deps } = await readChat(interaction, chatTables(), {}, { max: 3 });
  assert.deepEqual(result.entries.map((e) => e.when.slice(11)), ['09:02:00', '09:03:00', '09:10:00']);
  assert.match(result.access[0].note, /newest 3 messages/);
  const read = deps.callsTo('sys_cs_message')[0];
  assert.equal(read.options.limit, 4, 'max + 1, to know there was more');
  assert.equal(CHAT_MAX_MESSAGES, 80);
  const holders = deps.callsTo('sys_cs_conversation');
  assert.ok(holders.every((c) => c.options.limit <= 5));
});

test('a conversation record is read directly; messages of other conversations are never mixed in', async () => {
  const tables = chatTables();
  tables.sys_cs_message.push({ sys_id: v(id(0x899)), conversation: v(id(0x702)), sys_created_on: v('2026-10-26 09:05:00'), direction: v('inbound'), message: v('OTHER CONVERSATION MESSAGE') });
  const { result, deps } = await readChat({ table: 'sys_cs_conversation', sysId: CONVERSATION_ID }, tables);
  assert.equal(result.entries.length, 6);
  assert.ok(!JSON.stringify(result).includes('OTHER CONVERSATION'));
  assert.equal(deps.callsTo('sys_cs_conversation').length, 0, 'no holder lookup for the conversation itself');
  assert.equal(result.access[0].strategy, 'sys_cs_message via the sys_cs_conversation record');
});

test('Connect Support: live_group_profile pointing back at the record, live_message by group; the profile name is the sender', async () => {
  const GROUP = id(0x710);
  const tables = {
    interaction: chatTables().interaction,
    live_group_profile: [{ sys_id: v(GROUP), document: v(INTERACTION_ID) }],
    live_message: [
      { sys_id: v(id(0x901)), group: v(GROUP), profile: v(id(0x950), SEEDS.customerName), message: v('Hello, anyone there?'), sys_created_on: v('2026-10-26 09:00:00'), type: v('message') },
      { sys_id: v(id(0x902)), group: v(GROUP), profile: v(id(0x951), SEEDS.agentName), message: v('Yes, how can I help?'), sys_created_on: v('2026-10-26 09:00:30'), type: v('message') },
      { sys_id: v(id(0x903)), group: v(GROUP), profile: v(id(0x951), SEEDS.agentName), message: v('left the chat'), sys_created_on: v('2026-10-26 09:05:00'), type: v('system') },
    ],
  };
  const { result } = await readChat(interaction, tables);
  assert.deepEqual(result.entries.map((e) => [e.by, e.text, e.side]), [
    [SEEDS.customerName, 'Hello, anyone there?', ''],
    [SEEDS.agentName, 'Yes, how can I help?', ''],
  ]);
  assert.equal(result.access[0].strategy, 'live_message via live_group_profile.document');
  assert.deepEqual(result.names, [SEEDS.customerName, SEEDS.agentName]);
  assert.deepEqual(result.loginNames, []);
});

test('a record whose conversation cannot be found is tried against the message table directly, and then reported honestly', async () => {
  const tables = chatTables();
  tables.sys_cs_conversation = [];
  const { result, deps } = await readChat(interaction, tables);
  assert.deepEqual(result.entries, []);
  assert.equal(result.access.length, 1);
  assert.equal(result.access[0].status, 'empty-or-hidden');
  assert.match(result.access[0].note, /You cannot see the chat messages/);
  assert.match(result.access[0].note, /the chat may not be empty/);
  assert.equal(result.access[0].strategy, 'none');
  assert.ok(deps.callsTo('sys_cs_message').some((c) => c.query.startsWith(`interactionIN${INTERACTION_ID}`)), 'the direct recipe was tried');
});

test('denied, hidden and failing tables degrade into access, never into an exception or made-up messages', async () => {
  const denied = (await readChat(interaction, chatTables(), { denied: ['sys_cs_conversation', 'live_group_profile', 'sys_cs_message'] })).result;
  assert.deepEqual(denied.entries, []);
  assert.equal(denied.access[0].status, 'denied');
  assert.match(denied.access[0].note, /You cannot see the chat messages/);
  assert.doesNotMatch(denied.access[0].note, /sys_cs_|live_|your user/i, 'the sentence names no table');
  assert.ok(denied.access[0].tried.includes('sys_cs_conversation: denied'), 'what each place answered stays in `tried`, which is never drawn');

  const hidden = (await readChat(interaction, chatTables(), { hidden: ['sys_cs_conversation', 'live_group_profile', 'sys_cs_message'] })).result;
  assert.equal(hidden.access[0].status, 'empty-or-hidden');

  const broken = (await readChat(interaction, chatTables(), { errors: { sys_cs_message: new Error('Table API query failed (500)') } })).result;
  assert.deepEqual(broken.entries, []);
  assert.equal(broken.access[0].status, 'error');

  // Only the message table is denied: the conversation was found, the messages could not be read.
  const half = (await readChat(interaction, chatTables(), { denied: ['sys_cs_message'] })).result;
  assert.equal(half.access[0].status, 'denied');
  assert.match(half.access[0].note, /You cannot see the chat messages/);
  assert.doesNotMatch(half.access[0].note, /sys_cs_|your user/i);
});

test('a table without the link column answers with EVERY row: none of them is used, and the note says why', async () => {
  const tables = chatTables();
  tables.sys_cs_conversation = [{ sys_id: v(CONVERSATION_ID), topic: v('x') }, { sys_id: v(id(0x703)), topic: v('y') }];
  tables.sys_cs_message = tables.sys_cs_message.map(({ conversation, ...rest }) => rest); // and no conversation column either
  const { result } = await readChat(interaction, tables);
  assert.deepEqual(result.entries, []);
  assert.equal(result.access[0].status, 'empty-or-hidden');
  assert.match(result.access[0].note, /You cannot see the chat messages/);
  assert.ok(result.access[0].tried.includes('sys_cs_conversation: empty-or-hidden') && result.access[0].tried.includes('sys_cs_message: empty-or-hidden'));
});

test('rows that belong to other conversations mean the filter was ignored: an error, and none of them is used', async () => {
  const OTHER = id(0x777);
  const calls = [];
  const deps = {
    queryTable: async (table) => {
      calls.push(table);
      if (table === 'sys_cs_conversation') return [{ sys_id: v(CONVERSATION_ID), interaction: v(OTHER) }];
      return [{ sys_id: v(id(0x801)), conversation: v(OTHER), sys_created_on: v('2026-10-26 09:00:00'), direction: v('inbound'), message: v('NOT THIS CHAT') }];
    },
  };
  const result = await readChatMessages(interaction, deps);
  assert.deepEqual(result.entries, []);
  assert.equal(result.access[0].status, 'error');
  assert.equal(result.access[0].note, 'Could not be read just now. Try again in a moment.');
  assert.doesNotMatch(result.access[0].note, /sys_cs_|filter|other conversations/);
  assert.ok(!JSON.stringify(result).includes('NOT THIS CHAT'));
});

test('a lost session is not hidden as "no messages"', async () => {
  await assert.rejects(readChat(interaction, chatTables(), { expired: ['sys_cs_conversation'] }), (err) => err.code === 'SESSION_EXPIRED');
});

test('bad input fails before anything is read', async () => {
  const deps = fakeDeps(chatTables());
  await assert.rejects(readChatMessages({ table: 'interaction', sysId: 'nope' }, deps), TypeError);
  await assert.rejects(readChatMessages({ table: 'interaction', sysId: `${INTERACTION_ID}^ORsys_id!=1` }, deps), TypeError);
  assert.equal(deps.calls.length, 0);
});

test('ids taken from the instance\'s own answers are checked before they go back into a query', async () => {
  const tables = chatTables();
  tables.sys_cs_conversation = [{ sys_id: v('not-a-sys-id^ORactive=true'), interaction: v(INTERACTION_ID) }];
  const { deps } = await readChat(interaction, tables);
  assert.ok(deps.callsTo('sys_cs_message').every((c) => !c.query.includes('not-a-sys-id')));
});

// ---- the pack ---------------------------------------------------------------------------------------------

const packOf = (feature, behaviour, tables = chatTables()) => {
  const deps = fakeDeps(tables, behaviour);
  return readContextPack(interaction, deps, { feature }).then((pack) => ({ pack, deps }));
};

test('a chat pack: kind chat, allowlisted fields, messages in the journal, people with email and role', async () => {
  const { pack, deps } = await packOf('chat-summary');
  assert.equal(pack.kind, 'chat');
  assert.deepEqual(Object.keys(pack).sort(), ['access', 'fields', 'journal', 'kind', 'number', 'people', 'related', 'sysId', 'table', 'version']);
  assert.deepEqual(Object.keys(pack.fields).sort(), ['assigned_to', 'closed_at', 'number', 'opened_at', 'opened_for', 'short_description', 'state', 'type']);
  assert.equal(pack.fields.opened_for, ABEL.name);
  assert.equal(pack.journal.length, 6);
  assert.deepEqual(pack.journal.filter((e) => e.by).map((e) => e.by), [ABEL.name, BETH.name, ABEL.name, BETH.name, ABEL.name], 'a login became the display name');
  assert.deepEqual(pack.journal.map((e) => e.side), ['customer', 'bot', 'agent', 'customer', 'agent', 'customer']);
  assert.deepEqual(pack.people.map((p) => [p.role, p.name, p.email]), [
    ['assigned_to', BETH.name, BETH.email],
    ['opened_for', ABEL.name, ABEL.email],
  ]);
  assert.deepEqual(pack.related.times, { opened_at: '2026-10-26 09:00:00', closed_at: '2026-10-26 09:20:00' }, 'stored UTC times, not the display format');
  assert.equal(pack.access.find((a) => a.source === 'chat').status, 'ok');
  assert.equal(pack.access.find((a) => a.source === 'sys_user').status, 'ok');
  // The record read asked for the chat columns only: no comments, no work notes, and the notes table was not touched.
  assert.deepEqual(deps.callsTo('interaction')[0].fields, allowedFields('interaction', 'chat-summary'));
  assert.equal(deps.callsTo('sys_journal_field').length, 0);
});

test('the chat allowlist holds even when the instance returns every column', async () => {
  const { pack, deps } = await packOf('chat-summary', { leaky: true });
  const text = JSON.stringify(pack);
  for (const leak of ['CHAT-LEAK-1', 'INTERACTION-COMMENTS-LEAK', 'CONV-LEAK']) assert.ok(!text.includes(leak), leak);
  const allowed = new Set(allowedFields('interaction', 'chat-summary'));
  for (const key of Object.keys(pack.fields)) assert.ok(allowed.has(key), key);
  for (const call of deps.callsTo('interaction')) for (const name of call.fields) assert.ok(allowed.has(name), `asked for ${name}`);
});

test('chat-reply reads less of the record than chat-summary', async () => {
  const { pack } = await packOf('chat-reply');
  assert.deepEqual(Object.keys(pack.fields).sort(), ['assigned_to', 'number', 'opened_for', 'short_description', 'state', 'type']);
  assert.equal(pack.journal.length, 6);
  assert.ok(!('times' in pack.related) || !('opened_at' in pack.related.times));
});

test('chat tables that cannot be read leave the rest of the pack intact and say so', async () => {
  const { pack } = await packOf('chat-summary', { denied: ['sys_cs_conversation', 'live_group_profile', 'sys_cs_message'] });
  assert.deepEqual(pack.journal, []);
  assert.equal(pack.fields.number, 'IMS0001001');
  assert.equal(pack.people.length, 2, 'the customer and the agent from the record are still known');
  const entry = pack.access.find((a) => a.source === 'chat');
  assert.equal(entry.status, 'denied');
  assert.match(entry.note, /You cannot see the chat messages/);
});

test('a chat feature with notes switched off reads no messages at all', async () => {
  const deps = fakeDeps(chatTables());
  const pack = await readContextPack(interaction, deps, { feature: 'chat-summary', includeJournal: false });
  assert.deepEqual(pack.journal, []);
  assert.equal(deps.callsTo('sys_cs_conversation').length + deps.callsTo('sys_cs_message').length, 0);
});

test('a conversation that exists in two products is merged into one chronological list', async () => {
  const tables = chatTables();
  const GROUP = id(0x710);
  tables.live_group_profile = [{ sys_id: v(GROUP), document: v(INTERACTION_ID) }];
  tables.live_message = [{ sys_id: v(id(0x901)), group: v(GROUP), profile: v(id(0x951), BETH.name), message: v('Connect message'), sys_created_on: v('2026-10-26 09:01:30'), type: v('message') }];
  const { result } = await readChat(interaction, tables);
  assert.equal(result.entries.length, 7);
  assert.equal(result.entries[3].text, 'Connect message');
  assert.equal(result.access[0].strategy, 'sys_cs_message via sys_cs_conversation.interaction + live_message via live_group_profile.document');
});

// ---- regression: the other kinds are untouched -------------------------------------------------------------------

test('a ticket pack gets no chat extras and still reads its notes from the journal table', async () => {
  const deps = fakeDeps(buildInstance());
  const pack = await readContextPack({ table: 'incident', sysId: INCIDENT_ID }, deps);
  assert.ok(!('times' in pack.related) && !('article' in pack.related));
  assert.ok(pack.access.some((a) => a.source === 'journal'));
  assert.ok(pack.journal.every((e) => !('side' in e)));
  assert.deepEqual(FIELDS_BY_KIND.chat.slice(0, 1), ['number']);
});
