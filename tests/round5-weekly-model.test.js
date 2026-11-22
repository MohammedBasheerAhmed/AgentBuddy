// Round 5, the weekly views: what the screen, the PDF, the copied text and the CSV show. One model, so they cannot disagree; a number that
// was not read is not in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countChange, decisionText, mineModel, modelToTables, modelToText, periodText, pointsChange, rangeText, teamModel, timeChange, moreFewer } from '../src/sidepanel/reports/weekly/model.js';
import { setLanguage, t } from '../src/i18n/index.js';
import { shown } from '../src/reports/shown.js';
import { tablesToCsv, tablesToTsv } from '../src/reports/exportTables.js';

const WINDOW = { which: 'last', partial: false, start: 0, end: 1, first: { y: 2026, m: 11, d: 9, wd: 1 }, last: { y: 2026, m: 11, d: 15, wd: 0 } };
const HOUR = 3600000;
const TEAM = {
  readAt: Date.UTC(2026, 10, 16, 15, 36),
  data: {
    available: true,
    kind: 'team',
    window: WINDOW,
    types: ['Incidents'],
    numbers: {
      cameIn: { value: 63, prev: 54 },
      closed: { value: 58, prev: 54 },
      backlog: { value: 5, prev: 0 },
      sla: { percent: 88, total: 140, kept: 123, prev: 91 },
      reopened: { value: 4, of: 58, prev: 6, prevOf: 54, types: ['Incidents'] },
    },
    areas: [{ name: 'Network', count: 21, plain: false }, { name: 'Other', count: 3, plain: true }],
    decisions: [{ id: 'cause', count: 4, name: 'VPN Gateway EU' }, { id: 'load', people: 2, percent: 40, of: 85 }, { id: 'notes', without: 3, closed: 14 }],
    oldest: [{ number: 'INC0010100', title: 'Printer offline in Finance', ageDays: 31, sla: 'breached' }, { number: 'INC0010001', title: 'VPN keeps disconnecting', ageDays: 0, sla: null }],
    leftOut: [],
  },
};
const MINE = {
  readAt: Date.UTC(2026, 10, 18, 15, 36),
  data: {
    available: true,
    kind: 'mine',
    window: { ...WINDOW, which: 'this', partial: true },
    types: ['Incidents'],
    now: { closed: 11, typicalMs: 30 * HOUR, reply: { meanMs: 42 * 60000, n: 9, of: 11 }, reopened: { n: 1, of: 11, types: ['Incidents'], numbers: [] }, sla: { kept: 10, total: 11, percent: 91 }, areas: [{ name: 'Network', count: 5, plain: false }] },
    before: { closed: 8, typicalMs: 30 * HOUR, reply: { meanMs: 50 * 60000, n: 7, of: 8 }, reopened: { n: 0, of: 8 }, sla: { kept: 7, total: 8, percent: 88 } },
    leftOut: [],
  },
};

test('the weekly report: five tiles in the order of the board, each with the change against the week before', () => {
  const m = teamModel(TEAM, { scope: 'My groups (2)' });
  assert.deepEqual(m.tiles.map((x) => [x.label, x.value, x.change?.text.replace(/‎/g, ''), x.change?.tone]), [
    ['Came in', '63', '+9', 'neutral'],
    ['Closed', '58', '+4', 'good'],
    ['Backlog', '‎+5‎', 'worse', 'bad'],
    ['SLA kept', '88%', '-3 pts', 'bad'],
    ['Reopened', '4', '-2', 'good'],
  ]);
  assert.equal(m.comparedWith, 'the week before');
  assert.equal(m.title, 'Weekly report');
});

test('a number that was not read has no tile: never a zero', () => {
  const data = { ...TEAM.data, numbers: { ...TEAM.data.numbers, sla: null, reopened: null }, leftOut: [{ key: 'sla', why: 'No SLA came due in this week.' }, { key: 'reopened', why: 'Reopened tickets could not be counted.' }] };
  const m = teamModel({ ...TEAM, data });
  assert.deepEqual(m.tiles.map((x) => x.key), ['cameIn', 'closed', 'backlog']);
  assert.deepEqual(m.missing.map((x) => x.label), ['SLA kept', 'Reopened']);
  assert.equal(m.missing[0].why, 'No SLA came due in this week.');
  assert.match(modelToText(m), /Not shown, because it could not be read honestly: SLA kept, Reopened\./);
});

test('this week so far: the comparison is with the same days of last week, and reopened carries no change (those tickets have had less time to come back)', () => {
  const m = teamModel({ ...TEAM, data: { ...TEAM.data, window: { ...WINDOW, which: 'this', partial: true } } });
  assert.equal(m.comparedWith, 'the same days last week');
  assert.equal(m.tiles.find((x) => x.key === 'reopened').change, null);
  assert.ok(m.tiles.find((x) => x.key === 'closed').change);
  assert.match(m.period, /today$/);
});

test('My week: five numbers, the change in words, the SLA tile on its own row', () => {
  const m = mineModel(MINE);
  assert.deepEqual(m.tiles.map((x) => [x.key, x.value]), [['closed', '11'], ['reply', '42 min'], ['typical', '1 d 6 h'], ['reopened', '1 of 11'], ['sla', '91%']]);
  assert.equal(m.tiles[0].change.text, '+3 on the same days last week');
  assert.equal(m.tiles[1].change.text, '8 min faster than the same days last week');
  assert.equal(m.tiles[1].change.tone, 'good');
  assert.equal(m.tiles[2].change.text, 'Same as the same days last week');
  assert.equal(m.tiles[3].change, null, 'reopened: no change for a week that is still going');
  assert.equal(m.tiles[4].change.text, '3 points better than the same days last week');
  assert.equal(m.tiles[4].sub, '10 of 11 closed tickets that had an SLA');
  assert.equal(m.tiles[4].wide, true);
  assert.deepEqual(m.areas, [{ name: 'Network', count: 5 }]);
});

test('My week, last week: compared with the week before, and a reopened ticket that is one more is bad', () => {
  const m = mineModel({ ...MINE, data: { ...MINE.data, window: { ...WINDOW, which: 'last', partial: false } } });
  assert.equal(m.tiles[0].change.text, '+3 on the week before');
  assert.equal(m.tiles[3].change.text, '1 more than the week before');
  assert.equal(m.tiles[3].change.tone, 'bad');
});

test('My week: with nothing to compare there is no change line, and left-out numbers have no tile', () => {
  const data = { ...MINE.data, before: { closed: null, typicalMs: null, reply: null, reopened: null, sla: null }, now: { ...MINE.data.now, reply: null, sla: null }, leftOut: [{ key: 'reply', why: 'Fewer than 3 tickets had a written reply, so there is no average.' }] };
  const m = mineModel({ ...MINE, data });
  assert.deepEqual(m.tiles.map((x) => x.key), ['closed', 'typical', 'reopened']);
  assert.ok(m.tiles.every((x) => x.change === null), JSON.stringify(m.tiles));
  assert.equal(m.missing[0].label, 'Average first reply');
});

test('change lines: a sign that stays in front of its number, the same, and no comparison', () => {
  assert.equal(countChange(5, 5).text, 'same');
  assert.equal(countChange(5, null), null);
  assert.equal(countChange(7, 5, { long: true, period: 'last week' }).text, '+2 on last week');
  assert.equal(countChange(3, 5, { long: true, period: 'last week', goodWhen: 'up' }).tone, 'bad');
  assert.equal(pointsChange(88, 91).text.replace(/‎/g, ''), '-3 pts');
  assert.equal(pointsChange(88, 88, { long: true, period: 'the week before' }).text, 'Same as the week before');
  assert.equal(moreFewer(2, 5, { period: 'last week' }).text, '3 fewer than last week');
  assert.equal(timeChange(30 * HOUR, 30 * HOUR + 60000, { period: 'last week' }).dir, undefined);
  assert.equal(timeChange(30 * HOUR, 30 * HOUR + 60000, { period: 'last week' }).text, 'Same as last week', 'a minute is not a change');
  assert.equal(timeChange(NaN, 1, { period: 'x' }), null);
  assert.equal(timeChange(2 * HOUR, 5 * HOUR, { period: 'last week' }).text, '3 h faster than last week');
});

test('the periods', () => {
  assert.equal(rangeText({ y: 2026, m: 11, d: 9 }, { y: 2026, m: 11, d: 15 }).replace(/\s/g, ' '), rangeText({ y: 2026, m: 11, d: 9 }, { y: 2026, m: 11, d: 15 }));
  assert.match(rangeText({ y: 2026, m: 11, d: 9 }, { y: 2026, m: 11, d: 15 }), /9.*15/);
  assert.match(periodText({ partial: true, first: { y: 2026, m: 11, d: 16, wd: 1 } }), /16.* to today/);
  assert.equal(periodText(null), '');
});

test('the decisions in plain words, with only what the data gives', () => {
  assert.equal(decisionText({ id: 'cause', count: 4, name: 'VPN Gateway EU' }).replace(/[⁦-⁩]/g, ''), 'Open a problem for VPN Gateway EU: 4 tickets, one likely cause.');
  assert.equal(decisionText({ id: 'cause', count: 4, name: '' }), 'Open a problem: 4 tickets share one likely cause.', 'a configuration item whose name is hidden is not named');
  assert.equal(decisionText({ id: 'load', percent: 40 }), 'Two people hold 40% of the open tickets. Rebalance the work.');
  assert.equal(decisionText({ id: 'notes', without: 3, closed: 14 }), '3 of 14 closes had no fix note. Ask for one at close.');
});

test('the copied text and the CSV carry the same numbers as the screen, and the paragraph when there is one', () => {
  const m = teamModel(TEAM, { scope: 'My groups (2)', paragraph: 'The team closed 58 tickets against 63 that came in.' });
  const text = modelToText(m).replace(/‎/g, '');
  assert.match(text, /^Weekly report: 9.*15.*, My groups \(2\)\n\nThe team closed 58 tickets against 63 that came in\.\n\nCame in: 63 \(.*9\)/);
  assert.match(text, /Backlog: .*5 \(worse\)/);
  assert.match(text, /Needs a decision:\n1\. Open a problem for .*VPN Gateway EU.*\n2\. Two people hold 40%/);
  assert.match(text, /Where the week went:\n- Network: 21\n- Other: 3/);
  const tables = modelToTables(m);
  assert.deepEqual(tables.map((x) => x.title.replace(/ \(.*\)$/, '')), ['Weekly report', 'Closed by area', 'Needs a decision', 'Oldest open tickets']);
  assert.equal(tables[0].rows.length, 5);
  assert.deepEqual(tables[3].rows[1], { number: 'INC0010001', title: 'VPN keeps disconnecting', age: 'today', sla: 'Not available to you' }, 'an SLA that cannot be seen is said so');
  const csv = tablesToCsv(tables);
  assert.match(csv, /Printer offline in Finance/);
  assert.match(tablesToTsv(tables), /^Weekly report/);
});

test('with the AI off the report is the numbers, the decisions and the files, without the paragraph', () => {
  const m = teamModel(TEAM, { scope: 'x' });
  assert.equal(m.paragraph, '');
  assert.ok(!/\n\n\n/.test(modelToText(m)));
  assert.ok(m.tiles.length === 5 && m.decisions.length === 3);
});

test('in Arabic the same model speaks Arabic, with the digits kept as 0 to 9', () => {
  setLanguage('ar');
  try {
    const m = mineModel(MINE);
    assert.equal(m.tiles[0].label, 'التذاكر المغلقة');
    assert.match(m.tiles[0].change.text, /^\+3 عن /);
    assert.equal(t('Share with my lead'), 'شارك مع قائد فريقي');
    assert.equal(shown('Some ticket types could not be counted.'), 'تعذّر عدّ بعض أنواع التذاكر.');
    assert.match(modelToText(teamModel(TEAM)), /الواردة/);
  } finally {
    setLanguage('en');
  }
});
