import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirewall, FirewallError } from '../src/pii/firewall.js';
import { isSealed } from '../src/pii/seal.js';

// "Mask this too": text the person selects in the preview is handed to the firewall as `request.mask`. The firewall masks every
// occurrence in every part, for this and every later request, and seals the request again. Nothing else can change a sealed one.

const PEOPLE = [{ role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: 'a'.repeat(32) }];
const part = (text, field = 'description', extra = {}) => ({ label: field, field, text, ...extra });
const input = (parts, extra = {}) => ({ feature: 'record-summary', table: 'incident', system: 'You summarise tickets.', parts, userInstruction: 'Summarise this ticket.', ...extra });
const userOf = (sealed) => sealed.messages.find((m) => m.role === 'user').content;
const bodies = (sealed) => [...userOf(sealed).matchAll(/<ticket_data[^>]*>\n([\s\S]*?)\n<\/ticket_data>/g)].map((m) => m[1]);
const everything = (sealed) => `${sealed.messages.map((m) => m.content).join('\n')}\n${sealed.preview}`;

const PARTS = [
  part('Project Falcon is late. Carol Diaz owns project falcon.', 'description'),
  part('Carol Diaz wrote again about PROJECT FALCON.', 'comments', { label: 'Comment about Project Falcon' }),
];

test('a masked text is hidden everywhere it appears, in every part and label, whatever its case, and the request is sealed again', () => {
  const fw = createFirewall({ people: PEOPLE });
  const first = fw.buildRequest(input(PARTS));
  assert.ok(everything(first).includes('Carol Diaz'), 'no cue: the detectors did not find it');
  const again = fw.buildRequest(input(PARTS, { mask: ['Carol Diaz', 'Project Falcon'] }));
  assert.ok(isSealed(again));
  assert.ok(Object.isFrozen(again) && Object.isFrozen(again.messages));
  assert.notEqual(again, first);
  assert.ok(!/carol diaz|project falcon/i.test(everything(again)), everything(again));
  assert.deepEqual(bodies(again), ['[MASKED_1] is late. [PERSON_1] owns [MASKED_1].', '[PERSON_1] wrote again about [MASKED_1].']);
  assert.match(userOf(again), /label="Comment about \[MASKED_1\]"/);
  assert.equal(again.preview, again.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n'), 'the preview is still the exact outgoing text');
  // the sealed request handed out before is not changed
  assert.ok(everything(first).includes('Carol Diaz'));
});

test('the placeholder is like the others: a name becomes [PERSON_n] (one numbering with the record people), anything else [MASKED_n]', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(input([part('Abel Tuter met Carol Diaz in room Blue-7.')], { mask: ['Carol Diaz', 'room Blue-7'] }));
  assert.deepEqual(bodies(req), ['[PERSON_1] met [PERSON_2] in [MASKED_1].']);
  assert.equal(fw.rehydrate('[PERSON_1], [PERSON_2], [MASKED_1]'), 'Abel Tuter, Carol Diaz, room Blue-7');
});

test('the counts go to the stats as MANUAL, numbers only, and into the total', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(input(PARTS, { mask: ['Project Falcon'] }));
  assert.equal(req.stats.counts.MANUAL, 4, 'four places: two in the texts, one in the label, one upper-case');
  assert.equal(req.stats.total, Object.values(req.stats.counts).reduce((a, b) => a + b, 0));
  assert.ok(!JSON.stringify(req.stats).toLowerCase().includes('falcon'));
});

test('masking can only be added: a later request without the list still masks it, and so does clear()', () => {
  const fw = createFirewall({ people: PEOPLE });
  fw.buildRequest(input(PARTS, { mask: ['Carol Diaz'] }));
  const later = fw.buildRequest(input([part('Carol Diaz again')]));
  assert.deepEqual(bodies(later), ['[PERSON_1] again']);
  fw.clear();
  assert.deepEqual(bodies(fw.buildRequest(input([part('Carol Diaz again')]))), ['[PERSON_1] again']);
  // asking for the same text twice changes nothing
  const twice = fw.buildRequest(input([part('Carol Diaz')], { mask: ['carol diaz', 'Carol Diaz'] }));
  assert.deepEqual(bodies(twice), ['[PERSON_1]']);
});

test('the firewall refuses a mask list it cannot trust (fail closed), and keeps nothing of it', () => {
  const bad = [
    'Carol Diaz', // not a list
    [42],
    [{ toString: () => 'Carol Diaz' }],
    ['x'],
    ['   '],
    ['!!'],
    ['y'.repeat(201)],
    ['[PERSON_1]'],
    ['see (EMAIL_2)'],
    Array.from({ length: 51 }, (_, i) => `text ${i}`),
  ];
  for (const mask of bad) {
    const fw = createFirewall({ people: PEOPLE });
    assert.throws(() => fw.buildRequest(input([part('Carol Diaz text 1 x')], { mask })), (e) => e instanceof FirewallError && e.code === 'REDACTION_FAILED', JSON.stringify(mask).slice(0, 40));
    assert.deepEqual(bodies(fw.buildRequest(input([part('Carol Diaz text 1')]))), ['Carol Diaz text 1'], 'nothing of the refused list stayed');
  }
});

test('a build that fails for another reason takes back the masks it added (the old sealed request still stands)', () => {
  const fw = createFirewall({ people: PEOPLE });
  const ok = fw.buildRequest(input([part('Carol Diaz')]));
  assert.throws(() => fw.buildRequest(input([part('Carol Diaz NI AB123456C4111 1111 1111 1111')], { mask: ['Carol Diaz'] })), FirewallError);
  assert.ok(isSealed(ok));
  assert.deepEqual(bodies(fw.buildRequest(input([part('Carol Diaz')]))), ['Carol Diaz']);
  // and a later successful mask gets a fresh placeholder, never the one the failed build handed out
  const next = fw.buildRequest(input([part('Zed Alpha and Carol Diaz')], { mask: ['Zed Alpha'] }));
  const [body] = bodies(next);
  assert.equal(fw.rehydrate(body), 'Zed Alpha and Carol Diaz');
});

test('a word that is also part of a placeholder ("person", "masked") can be masked without breaking the request', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(input([part('Abel Tuter is the person who masked it.')], { mask: ['person', 'masked'] }));
  assert.ok(isSealed(req));
  assert.deepEqual(bodies(req), ['[PERSON_1] is the [MASKED_1] who [MASKED_2] it.']);
});

test('the masked text is checked again on the finished request: no part of the request keeps it', () => {
  const fw = createFirewall({ people: PEOPLE });
  const req = fw.buildRequest(input([part('Ticket for Zanzibar Ops'), part('zanzibar ops again', 'comments')], { system: 'Help with Zanzibar Ops.', mask: ['Zanzibar Ops'] }));
  assert.ok(!/zanzibar/i.test(everything(req)));
});

test('the firewall object keeps its shape: masking more is part of building a request, not a new door', () => {
  const fw = createFirewall({ people: PEOPLE });
  assert.deepEqual(Object.keys(fw).sort(), ['buildRequest', 'clear', 'mode', 'rehydrate', 'scan', 'stats', 'toJSON']);
  fw.buildRequest(input(PARTS, { mask: ['Carol Diaz'] }));
  assert.equal(JSON.stringify(fw), '{"mode":"standard"}');
  assert.ok(!JSON.stringify(fw.stats()).includes('Carol'));
  assert.deepEqual(fw.scan('Carol Diaz').map((f) => f.kind), ['MANUAL'], 'scan knows it, so the review of a draft can too');
});
