import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t } from '../src/i18n/index.js';
import { shown, shownList, placeholderName } from '../src/reports/shown.js';
import { say } from '../src/reports/engine/say.js';
import { runReport, createRuntime, resultTables } from '../src/reports/engine/index.js';
import { AR_REPORTS } from '../src/i18n/ar/reports.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';
import { registerCatalogue } from '../src/i18n/index.js';
import { fakeInstance, USER, GROUP_A, NOW } from './reports-fixtures.js';

// The reports engine runs in the ServiceNow page and writes English only (src/reports/engine/say.js); the panel shows its texts in the
// language of the person through shown() (src/reports/shown.js), which finds the Arabic by the English text. These tests keep the two
// in step: a text the engine writes that has no Arabic would show in English, and nothing else would notice.

// (the texts of src/i18n/ar/labels.js are part of the catalogue once src/i18n/ar/index.js lists them; this test needs only them)
registerCatalogue('ar', AR_LABELS);

test.afterEach(() => setLanguage('en'));

test('in English shown() gives the text back and say() fills the names', () => {
  setLanguage('en');
  assert.equal(shown('No update in 3+ days'), 'No update in 3+ days');
  assert.equal(shownList('Open, In my groups'), 'Open, In my groups');
  assert.equal(say('No update in {days}+ days', { days: 3 }), 'No update in 3+ days');
  assert.equal(say('{a} and {b}', { a: 1 }), '1 and {b}');
});

test('shown() finds the Arabic of an exact text, of a text with numbers, and of a note that names a table', () => {
  setLanguage('ar');
  assert.equal(shown('Some ticket types could not be counted'), AR_LABELS['Some ticket types could not be counted']);
  assert.equal(shown('No update in 3+ days'), t('No update in {days}+ days', { days: 3 }));
  assert.equal(shown('Incidents: SLA information is not available to you.'), `${AR_REPORTS.Incidents}: ${AR_REPORTS['SLA information is not available to you.']}`);
  // a text that is built from other texts: a title, a hint with a sentence added, two notes one after the other
  assert.equal(shown('Incidents: number of tickets by state'), t('{table}: {measure} by {groupBy}', { table: AR_REPORTS.Incidents, measure: AR_REPORTS['Number of tickets'], groupBy: AR_REPORTS.State }));
  assert.equal(shown('Tickets that are still active. Some ticket types could not be counted.'), `${AR_REPORTS['Tickets that are still active']}. ${AR_LABELS['Some ticket types could not be counted']}.`);
  assert.match(shown('3 of the chosen groups do not exist on this ServiceNow site, so they are left out. Choose groups again. No longer active: A, B.'), /[؀-ۿ]/);
  assert.ok(!/Choose groups again/.test(shown('3 of the chosen groups do not exist on this ServiceNow site, so they are left out. Choose groups again. No longer active: A, B.')));
});

test('a word that is a button in one place and a label above a count in another has its own Arabic', () => {
  setLanguage('ar');
  assert.equal(shown('Open'), AR_REPORTS['Open (tickets)']);
  assert.notEqual(shown('Open'), t('Open'));
  assert.equal(shownList('Open, In my groups'), `${AR_REPORTS['Open (tickets)']}${t(', ')}${AR_REPORTS['In my groups']}`);
});

test('ticket data is not translated: a state, a name, a group that looks like a text of the panel stays as it is', () => {
  setLanguage('ar');
  assert.equal(placeholderName('Resolved'), 'Resolved');
  assert.equal(placeholderName('Ann Lee'), 'Ann Lee');
  assert.equal(placeholderName('(unassigned)'), AR_REPORTS['(unassigned)']);
  assert.equal(shown('Never seen before'), 'Never seen before');
  // the names inside a sentence are data, shown whole
  assert.match(shown('Waiting to close (Resolved, Closed Complete). Not counted as open.'), /Resolved, Closed Complete/);
});

test('every entry of the reports catalogue that has {names} is found again from the English text it came from', () => {
  const numbers = /^(n|count|total|days|hours|min|max|fetched|looked|used|shown|multi|reopened|threshold|percent|words|h|m|d)$/;
  const texts = /^(note|reason|table|measure|groupBy|hint|text|what|where|units|window)$/;
  const misses = [];
  for (const [key, value] of Object.entries(AR_REPORTS)) {
    // a text whose fixed words are shorter than two letters ("{n} h") is never a pattern; the panel writes those itself
    if (typeof value !== 'string' || !/\{[A-Za-z]/.test(key) || !/[A-Za-z]{2}/.test(key.replace(/\{[^}]*\}/g, ''))) continue;
    if (['kind', 'excerpt', 'start', 'last', 'list', 'time', 'name', 'label', 'bits', 'parts', 'description', 'title', 'filter', 'scope', 'groups', 'missing', 'median', 'tickets', 'details', 'status', 'first', 'high', 'value', 'when', 'from', 'to', 'date', 'span', 'unit', 'sampleMax', 'NOTABLE_MAX', 'kinds'].some((n) => key.includes(`{${n}}`))) continue; // written in the panel with t(), not found again
    const params = {};
    for (const m of key.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) params[m[1]] = numbers.test(m[1]) ? '7' : texts.test(m[1]) ? 'Incidents' : 'Alpha Beta';
    setLanguage('en');
    const english = key.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_, name) => params[name]);
    setLanguage('ar');
    const expected = t(key, Object.fromEntries(Object.entries(params).map(([name, v]) => [name, texts.test(name) ? AR_REPORTS.Incidents : v === 'Alpha Beta' ? `⁨Alpha Beta⁩` : v])));
    if (shown(english) !== expected) misses.push(key);
  }
  assert.deepEqual(misses, []);
});

test('every text the engine writes for a person has an Arabic entry, in every situation it was run in', async () => {
  const strings = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      if (/[A-Za-z]{3,}/.test(value) && (/\s|[()]/.test(value) || /^[A-Z][a-z]+$/.test(value))) strings.add(value);
    } else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) if (['label', 'hint', 'note', 'notes', 'reason', 'title', 'name', 'window', 'unit', 'filter', 'basedOn', 'groupLabel', 'tableLabel', 'what', 'columns', 'rows', 'data', 'tiles', 'access', 'caps', 'tables', 'scope'].includes(k) || typeof v === 'object') collect(v);
    }
  };
  const situations = [fakeInstance(), fakeInstance({ denied: ['incident', 'task_sla', 'sysapproval_approver', 'sys_user_grmember'] }), fakeInstance({ hidden: ['incident', 'task_sla', 'sysapproval_approver'] }), fakeInstance({ missingColumns: ['reassignment_count', 'resolved_at', 'closed_at', 'category', 'cmdb_ci', 'caller_id', 'reopen_count'] })];
  const scopes = [{ kind: 'mine' }, { kind: 'chosen', groupIds: [GROUP_A], groupNames: { [GROUP_A]: 'Service Desk' } }];
  const builders = [
    { table: 'incident', groupBy: 'state', metric: 'count', chart: 'bar', presets: ['open', 'breached'] },
    { table: 'incident', groupBy: 'none', metric: 'count', chart: 'bar', presets: ['my_groups'] },
    { table: 'incident', groupBy: 'assigned_to', metric: 'avg_resolve_days', chart: 'bar', presets: [] },
  ];
  setLanguage('en');
  for (const instance of situations) {
    const env = { deps: instance.deps, userId: USER, runtime: createRuntime(), now: NOW, offsetMin: 0 };
    for (const scope of scopes) {
      for (const section of ['overview', 'workload', 'sla', 'quality', 'fulfilment', 'handover']) {
        const r = await runReport({ kind: 'section', section, scope, tables: ['incident', 'sc_req_item', 'sc_task', 'problem'], params: { hours: 12 } }, env);
        collect(r);
        resultTables(r).forEach(collect);
      }
    }
    for (const config of builders) {
      const r = await runReport({ kind: 'builder', config }, env);
      collect(r);
      resultTables(r).forEach(collect);
    }
  }
  assert.ok(strings.size > 60, `only ${strings.size} texts were collected`);
  setLanguage('ar');
  // (the labels of a day, "Oct 27", are dates and are drawn as they are)
  // (the filter of a builder report is a list joined by commas: the panel draws it with shownList)
  const untranslated = [...strings].filter((s) => !/^[A-Z][a-z]{2} \d{1,2}$/.test(s) && (s.startsWith('Open, ') ? shownList(s) : shown(s)) === s);
  assert.deepEqual(untranslated, []);
});
