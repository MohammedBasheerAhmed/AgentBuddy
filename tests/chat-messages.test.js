import test from 'node:test';
import assert from 'node:assert/strict';
import { assignSides, mapChatRow, messageSender, messageSide, messageText } from '../src/context/chat.js';
import { chatOverview, describeMinutes } from '../src/chat/stats.js';
import { chatParts, messageLine } from '../src/chat/parts.js';
import { v } from './fixtures/sn-fakeDeps.js';

const row = (fields) => ({ sys_created_on: v('2026-10-26 09:00:00'), ...fields });

// ---- one row ----------------------------------------------------------------------------------------

test('text: the first column that has any, HTML stripped, JSON payloads searched for their text', () => {
  assert.equal(messageText(row({ message: v('<p>Hello <b>there</b></p>') })), 'Hello there');
  assert.equal(messageText(row({ message: v(''), text: v('second choice') })), 'second choice');
  assert.equal(messageText(row({ payload: v('{"type":"Text","value":"From the payload"}') })), 'From the payload');
  assert.equal(messageText(row({ payload: v('{"data":{"message":{"text":"Deep"}}}') })), 'Deep');
  assert.equal(messageText(row({ payload: v('{"type":"Button","value":{"label":"x"}}') })), '', 'a payload without text is not a message');
  assert.equal(messageText(row({ message: v('{ not json at all') })), '{ not json at all', 'text that only looks like JSON is kept');
  assert.equal(messageText(row({ payload: v('plain payload') })), 'plain payload');
  assert.equal(messageText(row({})), '');
  assert.equal(messageText(row({ message: v('x'.repeat(5000)) })).length, 1500, 'capped like a journal entry');
});

test('sender: a name column wins, a sys_id is not a name, the creator login is the fallback, system accounts are nobody', () => {
  assert.deepEqual(messageSender(row({ sender: v('', 'Beth Anglin') })), { name: 'Beth Anglin' });
  assert.deepEqual(messageSender(row({ profile: v('a'.repeat(32), 'a'.repeat(32)), sys_created_by: v('abel.tuter') })), { login: 'abel.tuter' });
  assert.deepEqual(messageSender(row({ sys_created_by: v('system') })), {});
  assert.deepEqual(messageSender(row({ sys_created_by: v('GUEST') })), {});
  assert.deepEqual(messageSender(row({})), {});
});

test('side comes from the row\'s own columns: system events, bots, direction', () => {
  assert.equal(messageSide(row({ message_type: v('system') })), 'system');
  assert.equal(messageSide(row({ type: v('typing indicator') })), 'system');
  assert.equal(messageSide(row({ sender_type: v('Virtual Agent') })), 'bot');
  assert.equal(messageSide(row({ direction: v('Inbound') })), 'customer');
  assert.equal(messageSide(row({ direction: v('outbound') })), 'agent');
  assert.equal(messageSide(row({ direction: v('sideways') })), '');
  assert.equal(messageSide(row({})), '');
});

test('a row becomes { when, by, type, text, side } ; events and empty rows are dropped; a bot has no name', () => {
  assert.deepEqual(mapChatRow(row({ direction: v('inbound'), sender: v('', 'Abel Tuter'), message: v('Hi') })), {
    when: '2026-10-26 09:00:00', by: 'Abel Tuter', type: 'comment', text: 'Hi', side: 'customer', login: false,
  });
  assert.equal(mapChatRow(row({ message_type: v('system'), message: v('Beth joined') })), null);
  assert.equal(mapChatRow(row({ message: v('   ') })), null);
  const bot = mapChatRow(row({ message_type: v('bot'), sys_created_by: v('some.bot'), message: v('Hello, I am a bot') }));
  assert.equal(bot.by, '');
  assert.equal(bot.side, 'bot');
  const byLogin = mapChatRow(row({ sys_created_by: v('abel.tuter'), message: v('Hi') }));
  assert.deepEqual([byLogin.by, byLogin.login], ['abel.tuter', true]);
});

test('sides the row did not give come from who the record names; a name that matches both or neither is not guessed', () => {
  const entries = [
    { by: 'Abel Tuter', text: 'a', side: '' },
    { by: 'Beth Anglin', text: 'b', side: '' },
    { by: 'Stranger Danger', text: 'c', side: '' },
    { by: 'ABEL  tuter', text: 'd', side: '' },
    { by: 'Beth Anglin', text: 'e', side: 'bot' },
    { by: 'Same Person', text: 'f', side: '' },
  ];
  const out = assignSides(entries, { customers: ['Abel Tuter', 'Same Person'], agents: ['Beth Anglin', 'Same Person'] });
  assert.deepEqual(out.map((e) => e.side), ['customer', 'agent', '', 'customer', 'bot', ''], 'a given side is kept; an ambiguous name stays unclassified');
  assert.equal(entries[0].side, '', 'the input is not changed');
  assert.deepEqual(assignSides(entries, {}).map((e) => e.side), ['', '', '', '', 'bot', '']);
});

// ---- the overview -----------------------------------------------------------------------------------------

const pack = (journal, extra = {}) => ({
  fields: { state: 'Open' },
  people: [{ role: 'customer', name: 'Abel Tuter', email: 'abel.tuter@example.com' }, { role: 'agent', name: 'Beth Anglin', email: '' }],
  related: { times: {} },
  journal,
  ...extra,
});
const msg = (when, side, by, text) => ({ when, side, by, type: 'comment', text });
const MIN = 60000;
const at = (s) => Date.parse(`${s.replace(' ', 'T')}Z`);

test('overview: counts, participants, first response, and a customer who is waiting', () => {
  const journal = [
    msg('2026-10-26 09:00:00', 'customer', 'Abel Tuter', 'Hi, VPN problem'),
    msg('2026-10-26 09:00:10', 'bot', '', 'Connecting you'),
    msg('2026-10-26 09:03:00', 'agent', 'Beth Anglin', 'Hello Abel'),
    msg('2026-10-26 09:10:00', 'customer', 'Abel Tuter', 'Still failing'),
  ];
  const o = chatOverview(pack(journal), { now: at('2026-10-26 09:17:00') });
  assert.deepEqual([o.count, o.byCustomer, o.byAgent, o.byBot, o.unclear], [4, 2, 1, 1, 0]);
  assert.equal(o.canTellSides, true);
  assert.deepEqual(o.participants.map((p) => [p.name, p.role, p.email]), [['Abel Tuter', 'customer', 'abel.tuter@example.com'], ['Beth Anglin', 'agent', '']]);
  assert.equal(o.firstResponseMinutes, 3);
  assert.equal(o.durationMinutes, 10);
  assert.equal(o.waitingMinutes, 7, 'the customer spoke last, seven minutes ago');
  assert.deepEqual(o.lastCustomer, { when: '2026-10-26 09:10:00', by: 'Abel Tuter', text: 'Still failing' });
  assert.equal(o.lastMessage.side, 'customer');
  assert.equal(o.ended, false);
});

test('overview: nobody is waiting when an agent spoke last or the chat is over', () => {
  const journal = [msg('2026-10-26 09:00:00', 'customer', 'A', 'Hi'), msg('2026-10-26 09:02:00', 'agent', 'B', 'Hello')];
  assert.equal(chatOverview(pack(journal), { now: at('2026-10-26 10:00:00') }).waitingMinutes, null);
  const asked = [msg('2026-10-26 09:00:00', 'customer', 'A', 'Hi')];
  assert.equal(chatOverview(pack(asked, { related: { times: { closed_at: '2026-10-26 09:30:00' } } }), { now: at('2026-10-26 10:00:00') }).ended, true);
  assert.equal(chatOverview(pack(asked, { related: { times: { closed_at: '2026-10-26 09:30:00' } } }), { now: at('2026-10-26 10:00:00') }).waitingMinutes, null);
  assert.equal(chatOverview(pack(asked, { fields: { state: 'Closed Complete' } }), { now: at('2026-10-26 10:00:00') }).ended, true);
  assert.equal(chatOverview(pack(asked), { now: at('2026-10-26 10:00:00') }).waitingMinutes, 60);
});

test('overview: sides that cannot be told are said so, and nothing is made up', () => {
  const journal = [msg('2026-10-26 09:00:00', '', 'X', 'one'), msg('2026-10-26 09:01:00', '', 'Y', 'two')];
  const o = chatOverview(pack(journal), { now: at('2026-10-26 09:05:00') });
  assert.equal(o.canTellSides, false);
  assert.equal(o.unclear, 2);
  assert.equal(o.lastCustomer, null);
  assert.equal(o.waitingMinutes, null);
  assert.equal(o.lastMessage.text, 'two');
});

test('overview: an empty or odd pack does not throw', () => {
  const o = chatOverview({ journal: [] });
  assert.deepEqual([o.count, o.lastMessage, o.lastCustomer, o.waitingMinutes, o.durationMinutes, o.participants], [0, null, null, null, null, []]);
  assert.doesNotThrow(() => chatOverview(undefined));
  assert.doesNotThrow(() => chatOverview({ journal: [null, {}, { text: 'x', when: 'not a time' }] }));
  assert.equal(chatOverview({ journal: [{ text: 'x', when: 'not a time', side: 'customer' }] }, { now: 1 }).waitingMinutes, null);
});

test('minutes are described in words', () => {
  assert.equal(describeMinutes(0), 'less than a minute');
  assert.equal(describeMinutes(1), '1 minute');
  assert.equal(describeMinutes(45), '45 minutes');
  assert.equal(describeMinutes(65), '1 hour 5 minutes');
  assert.equal(describeMinutes(120), '2 hours');
  assert.equal(describeMinutes(60 * 49), '2 days');
  assert.equal(describeMinutes(NaN), '');
});

// ---- the parts the firewall will see ------------------------------------------------------------------------

test('parts: record details, then the newest messages oldest first, labelled by side with FIXED wording', () => {
  const journal = [
    msg('2026-10-26 09:00:00', 'customer', 'Abel Tuter', 'first'),
    msg('2026-10-26 09:01:00', 'agent', 'Beth Anglin', 'second'),
    msg('2026-10-26 09:02:00', 'bot', '', 'third'),
    msg('2026-10-26 09:03:00', '', 'Someone', 'fourth'),
  ];
  const parts = chatParts({ fields: { short_description: 'VPN', type: 'Chat', state: 'Open' }, journal }, { journal: 3 });
  assert.deepEqual(parts.map((p) => p.label), ['Topic', 'Channel', 'Chat state', 'Agent message', 'Bot message', 'Message from an unknown sender']);
  const messages = parts.filter((p) => p.field === 'comments');
  assert.equal(messages[0].text, '[2026-10-26 09:01:00] Beth Anglin: second');
  assert.equal(messages[1].text, '[2026-10-26 09:02:00] third', 'a bot has no name');
  for (const p of parts) assert.ok(!/Abel|Beth|Someone/.test(p.label), 'names are never in a label');
});

test('parts: the reply feature also gets the customer\'s latest message on its own, and knowledge articles', () => {
  const journal = [msg('2026-10-26 09:00:00', 'customer', 'Abel', 'first'), msg('2026-10-26 09:01:00', 'agent', 'Beth', 'second'), msg('2026-10-26 09:02:00', 'customer', 'Abel', 'last one')];
  const related = { knowledge: [{ number: 'KB1', title: 'VPN fix', excerpt: 'Reset the profile' }] };
  const parts = chatParts({ fields: {}, journal, related }, { journal: 10, lastMessage: true });
  const last = parts.find((p) => p.label.startsWith('Reply to this customer message'));
  assert.equal(last.text, '[2026-10-26 09:02:00] Abel: last one');
  const kb = parts.find((p) => p.label === 'Knowledge article that may help');
  assert.equal(kb.text, 'KB1: VPN fix\nReset the profile');
  assert.equal(kb.field, 'text');
  assert.equal(chatParts({ fields: {}, journal }, { journal: 10 }).some((p) => p.label.startsWith('Reply to')), false);
});

test('parts: nothing to say gives no parts, and a line without time or name still reads', () => {
  assert.deepEqual(chatParts({ fields: {}, journal: [] }), []);
  assert.deepEqual(chatParts(undefined), []);
  assert.equal(messageLine({ text: 'hi' }), '[] hi');
});
