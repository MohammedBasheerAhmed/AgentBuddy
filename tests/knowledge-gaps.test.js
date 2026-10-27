import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_FIX_CHARS, buildGapRadar, clusterTickets } from '../src/knowledge/gaps.js';

let n = 0;
const ticket = (title, extra = {}) => {
  n += 1;
  return { table: 'incident', sysId: `s${n}`, number: `INC${String(n).padStart(4, '0')}`, title, category: '', ci: '', fixLength: 0, ...extra };
};
const FIX = 'x'.repeat(MIN_FIX_CHARS);

test('tickets about the same thing group together, biggest first, with a label made of their own words', () => {
  const clusters = clusterTickets([
    ticket('VPN keeps disconnecting every ten minutes'),
    ticket('VPN disconnecting after sleep'),
    ticket('VPN disconnects on wifi'),
    ticket('Cannot print to third floor printer'),
    ticket('Printer on third floor offline'),
    ticket('Something lonely about toasters'),
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 3);
  assert.match(clusters[0].label, /vpn/i);
  assert.match(clusters[0].label, /disconnect/i);
  assert.match(clusters[1].label, /print/i);
  assert.equal(clusters[1].count, 2);
  assert.deepEqual(clusters.map((c) => c.id), ['g1', 'g2']);
});

test('examples: at most three, tickets with a written fix first, each with its number', () => {
  const [c] = clusterTickets([
    ticket('Outlook calendar not syncing'),
    ticket('Outlook calendar sync broken', { fixLength: MIN_FIX_CHARS + 1 }),
    ticket('Outlook calendar stuck', { fixLength: 5 }),
    ticket('Outlook calendar missing events', { fixLength: MIN_FIX_CHARS }),
    ticket('Outlook calendar duplicates'),
  ]);
  assert.equal(c.count, 5);
  assert.equal(c.withFix, 2);
  assert.equal(c.examples.length, 3);
  assert.deepEqual(c.examples.slice(0, 2).map((e) => e.title), ['Outlook calendar sync broken', 'Outlook calendar missing events']);
  assert.ok(c.examples.every((e) => e.number && e.sysId && e.table === 'incident'));
});

test('the most common word pair names a group; a broader word does not swallow two different topics', () => {
  const clusters = clusterTickets([
    ticket('Outlook crashes on start'),
    ticket('Outlook crashes when opening attachments'),
    ticket('Outlook crashes after update'),
    ticket('Outlook calendar sync broken'),
    ticket('Outlook calendar not syncing'),
    ticket('Outlook calendar permissions'),
  ]);
  const labels = clusters.map((c) => c.label.toLowerCase());
  assert.equal(clusters.length, 2);
  assert.ok(labels.some((l) => l.includes('crash')));
  assert.ok(labels.some((l) => l.includes('calendar')));
});

test('leftover tickets are grouped by category, then by configuration item, when at least two share one', () => {
  const clusters = clusterTickets([
    ticket('Alpha thing', { category: 'Hardware' }),
    ticket('Bravo stuff', { category: 'hardware' }),
    ticket('Charlie item', { category: 'Hardware' }),
    ticket('Delta unit', { ci: 'Router-9' }),
    ticket('Echo piece', { ci: 'router-9' }),
    ticket('Foxtrot odd', { category: 'Software' }),
  ]);
  const byBasis = Object.fromEntries(clusters.map((c) => [c.basis, c]));
  assert.equal(byBasis.category.count, 3);
  assert.match(byBasis.category.label, /^Category: /);
  assert.equal(byBasis.ci.count, 2);
  assert.match(byBasis.ci.label, /^Configuration item: /);
});

test('a group shows its category and CI when more than half of it shares them', () => {
  const [c] = clusterTickets([
    ticket('VPN drops often', { category: 'Network', ci: 'Gateway EU' }),
    ticket('VPN drops again', { category: 'Network', ci: 'Gateway EU' }),
    ticket('VPN drops today', { category: 'Other', ci: 'Gateway US' }),
  ]);
  assert.equal(c.category, 'Network');
  assert.equal(c.ci, 'Gateway EU');
  const [d] = clusterTickets([ticket('VPN drops often', { category: 'A' }), ticket('VPN drops again', { category: 'B' })]);
  assert.equal(d.category, '', 'no category is shared by more than half');
});

test('the number of groups is capped and the minimum size is honoured', () => {
  const many = [];
  for (let i = 0; i < 40; i += 1) many.push(ticket(`distinct${i}word topic${i}thing`), ticket(`distinct${i}word topic${i}thing again`));
  assert.equal(clusterTickets(many, { maxClusters: 4 }).length, 4);
  assert.deepEqual(clusterTickets([ticket('Only one ticket here'), ticket('Another unrelated matter')]), []);
  assert.equal(clusterTickets([ticket('Same words here'), ticket('Same words here too')], { minSize: 3 }).length, 0);
});

test('email addresses, links, phone numbers and record numbers never become a group label', () => {
  const clusters = clusterTickets([
    ticket('VPN fails for abel.tuter@example.com on INC0010001 call +1 555-0134'),
    ticket('VPN fails for abel.tuter@example.com on INC0010002 call +1 555-0134'),
    ticket('Reset see https://intranet.example.com/reset/abel INC0010003'),
    ticket('Reset see https://intranet.example.com/reset/abel INC0010004'),
  ]);
  const text = JSON.stringify(clusters.map((c) => [c.label, c.keywords])).toLowerCase();
  for (const leak of ['abel', 'tuter', 'example', 'inc00', '555', 'intranet']) assert.ok(!text.includes(leak), leak);
  assert.ok(clusters.some((c) => /vpn/i.test(c.label)));
});

test('who raised a ticket is taken out of the topic words, and the callers are listed as people for the privacy filter', () => {
  const [c] = clusterTickets([
    ticket('VPN fails for Priya Raman', { who: ['Priya Raman'] }),
    ticket('VPN fails again for Priya Raman', { who: ['Priya Raman'] }),
    ticket('VPN fails for Sam Lee', { who: ['Sam Lee'] }),
  ]);
  assert.match(c.label, /vpn/i);
  const shown = `${c.label} ${c.keywords.join(' ')}`.toLowerCase();
  for (const name of ['priya', 'raman', 'sam', 'lee']) assert.ok(!shown.split(/[^a-z]+/).includes(name), `${name} is in the label: ${shown}`);
  assert.deepEqual([...c.people].sort(), ['Priya Raman', 'Sam Lee']);
  assert.deepEqual(clusterTickets([ticket('Plain thing'), ticket('Plain thing again')])[0].people, []);
});

test('a tie between equally common pairs goes to the one with the acronym', () => {
  const [c] = clusterTickets([ticket('VPN drops daily'), ticket('VPN drops daily')]);
  assert.match(c.label, /vpn/i);
});

test('bad input is harmless', () => {
  assert.deepEqual(clusterTickets(undefined), []);
  assert.deepEqual(clusterTickets([]), []);
  assert.doesNotThrow(() => clusterTickets([{ title: null }, { title: 5 }, {}]));
});

test('the same input always gives the same groups', () => {
  const input = [ticket('VPN fails to connect'), ticket('VPN fails on login'), ticket('Printer jam second floor'), ticket('Printer jam first floor')];
  assert.deepEqual(clusterTickets(input), clusterTickets([...input]));
});

// ---- the radar: tickets minus the ones with an article ---------------------------------------------------------------------

test('tickets that have an article are left out when the link could be read', () => {
  const tickets = [ticket('VPN fails to connect'), ticket('VPN fails on login'), ticket('VPN fails after update')];
  const known = buildGapRadar({ tickets, linked: new Set([tickets[0].sysId.toUpperCase()]), linkKnown: true });
  assert.equal(known.considered, 3);
  assert.equal(known.withArticle, 1);
  assert.equal(known.candidates, 2);
  assert.equal(known.clusters[0].count, 2);
  assert.equal(known.note, '');
});

test('when the link could not be read, nothing is left out and the note says so', () => {
  const tickets = [ticket('VPN fails to connect'), ticket('VPN fails on login')];
  const unknown = buildGapRadar({ tickets, linked: new Set([tickets[0].sysId]), linkKnown: false });
  assert.equal(unknown.candidates, 2, 'the link list is ignored when it is not trustworthy');
  assert.equal(unknown.withArticle, 0);
  assert.match(unknown.note, /Could not tell which tickets had an article/);
  assert.equal(unknown.clusters[0].count, 2);
});

test('an empty window has no note and no groups; ungrouped tickets are counted', () => {
  const empty = buildGapRadar({ tickets: [], linkKnown: false });
  assert.deepEqual([empty.clusters, empty.note, empty.considered], [[], '', 0]);
  const some = buildGapRadar({ tickets: [ticket('VPN fails to connect'), ticket('VPN fails on login'), ticket('Lonely unique matter')], linkKnown: true });
  assert.equal(some.unclustered, 1);
  assert.doesNotThrow(() => buildGapRadar());
});
