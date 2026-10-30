const test = require('node:test');
const assert = require('node:assert/strict');
import { maskTables, tableToCsv, tablesToCsv, tablesToTsv, exportFileName } from '../src/reports/exportTables.js';

const cols = [{ key: 'who', label: 'Owner', person: true }, { key: 'group', label: 'Group' }, { key: 'title', label: 'Short description' }, { key: 'n', label: 'Open' }];
const table = (rows, title = 'Work') => ({ title, columns: cols, rows });

test('CSV: header is the labels, cells are quoted when needed', () => {
  const csv = tableToCsv(table([{ who: 'Ann Lee', group: 'Service, Desk', title: 'She said "hi"', n: 3 }]));
  assert.equal(csv, 'Owner,Group,Short description,Open\r\nAnn Lee,"Service, Desk","She said ""hi""",3');
});

test('CSV: a cell that starts like a formula is neutralised, in every column', () => {
  const csv = tableToCsv(table([{ who: '=HYPERLINK("http://evil")', group: '+cmd', title: '@SUM(A1)', n: -5 }, { who: '-2+3', group: '\tx', title: '=1+1', n: '-3.5' }]));
  const lines = csv.split('\r\n');
  assert.match(lines[1], /^"'=HYPERLINK/);
  assert.ok(lines[1].includes(",'+cmd,"));
  assert.ok(lines[1].includes(",'@SUM(A1),"));
  assert.ok(lines[1].endsWith(',-5'), 'a plain negative number stays a number');
  assert.ok(lines[2].startsWith("'-2+3,"));
  assert.ok(lines[2].endsWith(",-3.5"));
});

test('CSV: several tables go in one file with their titles', () => {
  const csv = tablesToCsv([table([{ who: 'A', group: 'G', title: 'T', n: 1 }], 'First'), table([{ who: 'B', group: 'G', title: 'T', n: 2 }], 'Second')]);
  assert.match(csv, /^First\r\nOwner,/);
  assert.match(csv, /\r\n\r\nSecond\r\nOwner,/);
  assert.equal(tablesToCsv([table([{ who: 'A', group: 'G', title: 'T', n: 1 }])]).startsWith('Owner,'), true, 'one table is plain CSV');
});

test('TSV (copy as table): tabs and line breaks inside a cell are flattened and formulas guarded', () => {
  const tsv = tablesToTsv([table([{ who: 'Ann\tLee', group: 'a\nb', title: '=1+1', n: 4 }])]);
  const lines = tsv.split('\n');
  assert.equal(lines[0], 'Work');
  assert.equal(lines[1], 'Owner\tGroup\tShort description\tOpen');
  assert.equal(lines[2], "Ann Lee\ta b\t'=1+1\t4");
});

test('masking: people become Person 1, Person 2... in order of first appearance, the same name the same number', () => {
  const masked = maskTables([table([{ who: 'Ann Lee', group: 'Service Desk', title: 'Printer', n: 1 }, { who: 'Bo Ray', group: 'Service Desk', title: 'VPN', n: 2 }, { who: 'ann lee ', group: 'Network', title: 'Mail', n: 3 }])]);
  assert.deepEqual(masked[0].rows.map((r) => r.who), ['Person 1', 'Person 2', 'Person 1']);
  assert.deepEqual(masked[0].rows.map((r) => r.group), ['Service Desk', 'Service Desk', 'Network'], 'group names stay');
});

test('masking is stable across tables in one export, whatever the column order', () => {
  const t1 = table([{ who: 'Ann Lee', group: 'G', title: 't', n: 1 }], 'One');
  const t2 = { title: 'Two', columns: [{ key: 'n', label: 'Open' }, { key: 'owner', label: 'Assigned to', person: true }], rows: [{ n: 4, owner: 'Bo Ray' }, { n: 5, owner: 'Ann Lee' }] };
  const [a, b] = maskTables([t1, t2]);
  assert.equal(a.rows[0].who, 'Person 1');
  assert.deepEqual(b.rows.map((r) => r.owner), ['Person 2', 'Person 1']);
  assert.deepEqual(b.rows.map((r) => r.n), [4, 5], 'numbers are untouched');
});

test('masking keeps the "nobody" placeholders and does not number them', () => {
  const masked = maskTables([table([{ who: '(unassigned)', group: 'G', title: 't', n: 1 }, { who: '', group: 'G', title: 't', n: 2 }, { who: 'Ann Lee', group: 'G', title: 't', n: 3 }])]);
  assert.deepEqual(masked[0].rows.map((r) => r.who), ['(unassigned)', '', 'Person 1']);
});

test('masking scrubs emails anywhere and known names inside ticket titles', () => {
  const masked = maskTables([
    table([
      { who: 'Ann Lee', group: 'G', title: 'Ann Lee cannot log in, mail ann.lee@example.com', n: 1 },
      { who: 'Bo Ray', group: 'G', title: 'Escalated by Bo Ray to Annette Lee; ping bo@x.io', n: 2 },
    ]),
  ]);
  assert.equal(masked[0].rows[0].title, 'Person 1 cannot log in, mail [email]');
  // "to Annette Lee": a full name after a cue word is found in the title itself (src/pii/names.js), numbered after the columns.
  assert.equal(masked[0].rows[1].title, 'Escalated by Person 2 to Person 3; ping [email]');
});

test('masking: names written in a title are found by their cue and become Person N, numbered after the person columns', () => {
  const masked = maskTables([
    table([
      { who: 'Ann Lee', group: 'Service Desk', title: 'New laptop for Anna Schmidt', n: 1 },
      { who: 'Bo Ray', group: 'Service Desk', title: "Customer's manager is María-José O'Neil", n: 2 },
      { who: 'Ann Lee', group: 'Network', title: 'Spoke with Dr. Priya Raman; cc: Anna Schmidt', n: 3 },
      { who: 'Bo Ray', group: 'Network', title: 'Hi Tom, the VPN is back', n: 4 },
    ]),
  ]);
  assert.deepEqual(masked[0].rows.map((r) => r.who), ['Person 1', 'Person 2', 'Person 1', 'Person 2']);
  assert.deepEqual(masked[0].rows.map((r) => r.title), [
    'New laptop for Person 3',
    "Customer's manager is Person 4",
    'Spoke with Dr. Person 5; cc: Person 3',
    'Hi Person 6, the VPN is back',
  ]);
  assert.deepEqual(masked[0].rows.map((r) => r.group), ['Service Desk', 'Service Desk', 'Network', 'Network'], 'group names are never names');
});

test('masking: the numbering of names found in titles is the same every time and does not depend on column order', () => {
  const rows = [
    { who: 'Ann Lee', title: 'Leaver - Tom Baker', note: 'spoke with Raj Patel' },
    { who: 'Ann Lee', title: 'Access for Raj Patel', note: 'Hi Tom Baker,' },
  ];
  const a = maskTables([{ title: 'A', columns: [{ key: 'who', label: 'Owner', person: true }, { key: 'title', label: 'T' }, { key: 'note', label: 'N' }], rows }]);
  const b = maskTables([{ title: 'A', columns: [{ key: 'who', label: 'Owner', person: true }, { key: 'title', label: 'T' }, { key: 'note', label: 'N' }], rows }]);
  assert.deepEqual(a, b);
  assert.deepEqual(a[0].rows.map((r) => [r.title, r.note]), [['Leaver - Person 2', 'spoke with Person 3'], ['Access for Person 3', 'Hi Person 2,']]);
});

test('masking: a first name found in prose that belongs to one person-column name is that person', () => {
  const masked = maskTables([table([{ who: 'Ann Lee', group: 'G', title: 'Spoke with Ann about it', n: 1 }])]);
  assert.equal(masked[0].rows[0].title, 'Spoke with Person 1 about it');
});

test('masking: Strict mode also masks a full name with no cue; Standard leaves it (the export screen says so)', () => {
  const rows = [{ who: 'Ann Lee', group: 'G', title: 'Monitor broken - Rutger Visser at desk 4', n: 1 }];
  assert.equal(maskTables([table(rows)])[0].rows[0].title, 'Monitor broken - Rutger Visser at desk 4');
  assert.equal(maskTables([table(rows)], { mode: 'strict' })[0].rows[0].title, 'Monitor broken - Person 2 at desk 4');
});

test('a masked CSV of titles with prose names has none of them in it', () => {
  const titles = ['Laptop for Anna Schmidt', 'Hi Tom, VPN is down', "manager is María-José O'Neil", '@Kevin Lee please check', 'Regards,\nOliver Bennett'];
  const csv = tablesToCsv(maskTables([table(titles.map((title, i) => ({ who: 'Ann Lee', group: 'G', title, n: i })))]));
  for (const name of ['Anna', 'Schmidt', 'Tom', 'María', "O'Neil", 'Kevin', 'Oliver', 'Bennett']) assert.ok(!csv.includes(name), `${name} is in the CSV`);
});

test('masking does not change the input and survives odd cells', () => {
  const input = table([{ who: 'Ann Lee', group: null, title: undefined, n: 1 }]);
  const before = JSON.stringify(input);
  const [out] = maskTables([input]);
  assert.equal(JSON.stringify(input), before);
  assert.equal(out.rows[0].group, null);
  assert.equal(out.rows[0].who, 'Person 1');
  assert.deepEqual(maskTables([]), []);
});

test('a masked CSV has no real name in it', () => {
  const csv = tablesToCsv(maskTables([table([{ who: 'María-José O\'Neil', group: 'G', title: 'María-José O\'Neil asked', n: 1 }])]));
  assert.ok(!/Mar[ií]a|O'Neil/.test(csv), csv);
  assert.match(csv, /Person 1,G,Person 1 asked,1/);
});

test('export file names are safe', () => {
  assert.equal(exportFileName('SLA risk radar', new Date('2026-10-27T10:00:00Z')), 'agent-buddy-sla-risk-radar-2026-10-27.csv');
  assert.equal(exportFileName('../../etc/passwd', new Date('2026-10-27T10:00:00Z')), 'agent-buddy-etc-passwd-2026-10-27.csv');
  assert.equal(exportFileName('', new Date('2026-10-27T10:00:00Z')), 'agent-buddy-report-2026-10-27.csv');
});
