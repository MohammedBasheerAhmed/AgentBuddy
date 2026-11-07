import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accessLine, describeAccess, plainNote, plainSource } from '../src/sidepanel/plainAccess.js';
import { plainError } from '../src/sidepanel/ask.js';
import ErrorNote from '../src/sidepanel/ErrorNote.jsx';
import { Notes, ReadState, accessLines } from '../src/sidepanel/ticket/cards/bits.jsx';
import { NOTE_TEXT, READ_TEXT } from '../src/context/access.js';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_NOTES } from '../src/i18n/ar/notes.js';
import { AR_LABELS } from '../src/i18n/ar/labels.js';

// Audit of 2026-11-07, workstream "notes and errors": what the panel does with an access entry or an error before a person reads it.
// (The Arabic of these sentences is registered here as the catalogue index will: the tests do not wait for it.)
registerCatalogue('ar', AR_NOTES);
registerCatalogue('ar', AR_LABELS);

test.afterEach(() => setLanguage('en'));

const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const hasArabic = (text) => /[؀-ۿ]/.test(text);

// ---- plainNote: the engine's fixed sentences are translated whole, and the safety net catches the rest ----------------------------------

test('plainNote: every standard sentence of the engine has its Arabic; the English comes back as it was', () => {
  for (const sentence of [...Object.values(NOTE_TEXT), ...Object.values(READ_TEXT)]) {
    setLanguage('en');
    assert.equal(plainNote(sentence), sentence, 'English: unchanged');
    setLanguage('ar');
    assert.ok(hasArabic(plainNote(sentence)), `Arabic: ${sentence}`);
    assert.notEqual(plainNote(sentence), sentence);
  }
});

test('plainNote: sentences with a number are found again by their pattern, several sentences one after the other too', () => {
  setLanguage('ar');
  assert.equal(plainNote('Showing the newest 80 messages.'), AR_NOTES['Showing the newest {n} messages.'].replace('{n}', '80'));
  assert.equal(plainNote('Showing the oldest 10 and the newest 10 of 25.'), AR_NOTES['Showing the oldest {n} and the newest {m} of {total}.'].replace('{n}', '10').replace('{m}', '10').replace('{total}', '25'));
  assert.equal(plainNote('Times are UTC. Showing the newest 80 messages.'), `${AR_NOTES['Times are UTC.']} ${AR_NOTES['Showing the newest {n} messages.'].replace('{n}', '80')}`);
  assert.equal(plainNote('3 more cases exist for this account.'), AR_NOTES['{n} more cases exist for this account.'].replace('{n}', '3'));
  assert.equal(plainNote('Their times are in your time zone, so their order among the other notes may be off by a few hours.'), AR_NOTES['Their times are in your time zone, so their order among the other notes may be off by a few hours.']);
  setLanguage('en');
  assert.equal(plainNote('Showing the newest 80 messages.'), 'Showing the newest 80 messages.');
});

test('plainNote: the safety net leaves no table name, no "your user", no HTTP code and no "Table API" in a sentence from an older reader', () => {
  const cases = [
    ['Your user cannot read kb_use.', 'You cannot read article links.'],
    ['Your user cannot read sys_audit.', /^You cannot read (?:history|[a-z ]+)\.$/],
    ['Your user cannot read u_vendor_ticket.', 'You cannot read vendor tickets.'],
    ['You cannot read cmdb_ci_server.', 'You cannot read servers.'],
    ['You cannot read incident.', 'You cannot read incidents.'],
    ['Your user cannot read task.', 'You cannot read tasks.'],
    ['Your user sees no rows of problem at all, so "none for this record" proves nothing.', /^You see no rows of problems at all/],
    ['Your user sees no rows of sc_cat_item at all.', 'You see no rows of catalog items at all.'],
    ['Could not read sys_user_grmember: Table API query on "sys_user_grmember" failed (500): boom', /^Could not read [a-z ]+: Could not be read just now\. Try again in a moment\.$/],
    ['Your user is not allowed to read this (403): Insufficient rights.', 'You are not allowed to read this: Insufficient rights.'],
    ['sys_audit did not apply the filter on this ticket, so it was not used.', /^[A-Z][a-z ]+ did not apply the filter/],
    ['Could not read "incident" again.', 'Could not read incidents again.'],
    ['Your organisation does not allow reading x_acme_visit_log.', 'Your organisation does not allow reading visit logs.'],
  ];
  for (const [input, expected] of cases) {
    const out = plainNote(input);
    if (expected instanceof RegExp) assert.match(out, expected, input);
    else assert.equal(out, expected, input);
    assert.doesNotMatch(out, /your user|Table API|\b403\b|\b500\b|\b[a-z]+_[a-z_]+\b/i, `${input} -> ${out}`);
  }
});

test('plainNote: ordinary words that are also table names are left alone, and so is everything that is not a note', () => {
  const sentence = 'This task has no requested item you can see. The incident could not be read. No chat messages. A problem is linked.';
  assert.equal(plainNote(sentence), sentence);
  assert.equal(plainNote(''), '');
  assert.equal(plainNote(undefined), '');
  assert.equal(plainNote(null), '');
  assert.equal(plainNote('   '), '   ');
  assert.equal(plainNote('Your user name is not set.'), 'Your user name is not set.', '"user name" is a thing a person has');
});

// ---- an access entry is worded by its reason with the label of its source ------------------------------------------------------------

test('accessLine: a standard note (or none) is worded by the reason with the plain label of the source', () => {
  assert.equal(accessLine({ source: 'sys_user_grmember', status: 'denied', note: NOTE_TEXT.denied }), 'Group memberships: not available to you with your role.');
  assert.equal(accessLine({ source: 'u_vendor_ticket', status: 'empty-or-hidden', note: NOTE_TEXT.hidden }), 'Vendor tickets: you can see none at all, so Agent Buddy cannot tell whether there are none or your role hides them.');
  assert.equal(accessLine({ source: 'sc_cat_item', status: 'error', note: NOTE_TEXT.error }), 'Catalog items: could not be read just now. Try again in a moment.');
  assert.equal(accessLine({ source: 'incident', status: 'blocked' }), 'Incidents: your organisation does not let Agent Buddy read this.');
  assert.equal(accessLine({ source: 'caller-history', status: 'denied' }), 'Earlier tickets from this person: not available to you with your role.');
  assert.equal(accessLine({ source: 'journal', status: 'denied' }), 'Notes and comments: not available to you with your role.');
  assert.equal(accessLine({ source: 'field history', status: 'denied' }), 'History: not available to you with your role.');
  assert.equal(accessLine({ source: 'sys_audit', status: 'denied', note: READ_TEXT.policy }), 'History: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.');
});

test('accessLine: a sentence of the reader\'s own is kept after the label, translated', () => {
  assert.equal(accessLine({ source: 'chat', status: 'denied', note: 'You cannot see the chat messages. Your role may not allow it, so the chat may not be empty.' }), 'Chat messages: You cannot see the chat messages. Your role may not allow it, so the chat may not be empty.');
  setLanguage('ar');
  const line = accessLine({ source: 'u_vendor_ticket', status: 'error', note: NOTE_TEXT.ignoredFilter });
  assert.ok(line.endsWith(AR_NOTES[NOTE_TEXT.ignoredFilter]), line);
  assert.doesNotMatch(line, /u_vendor|ServiceNow did not/);
});

test('describeAccess and the notes under a card say it in Arabic, with the thing named by its label', () => {
  setLanguage('ar');
  const access = [
    { source: 'sys_audit', status: 'denied', note: NOTE_TEXT.denied },
    { source: 'u_site_visit', status: 'empty-or-hidden', note: NOTE_TEXT.hidden },
    { source: 'journal', status: 'ok', note: '' },
  ];
  const lines = describeAccess(access);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(hasArabic(line), line);
    assert.doesNotMatch(line, /sys_audit|u_site_visit|site_visit/);
  }
  assert.equal(html(Notes, { access }), `<p class="ab-hint ab-kb-notes">${accessLines(access).join(' ')}</p>`);
});

test('plainSource: a table by the label of its name, never the name; the few sources that are not tables by their words', () => {
  assert.equal(plainSource('x_snc_app_widget'), 'App widgets');
  assert.equal(plainSource('u_cost_center_owner'), 'Cost center owners');
  assert.equal(plainSource('cmdb_ci_server'), 'Servers');
  assert.equal(plainSource('field history'), 'History');
  assert.equal(plainSource('similar tickets'), 'Similar tickets');
  assert.equal(plainSource(''), 'Some information');
  assert.equal(plainSource(undefined), 'Some information');
  setLanguage('ar');
  assert.ok(hasArabic(plainSource('sys_audit')));
  assert.ok(hasArabic(plainSource('similar tickets')));
});

// ---- plainError: one plain clause and one next step, never a code, "Table API" or a table name -------------------------------------

test('plainError: a technical message is replaced by the sentence of its reason; a plain one passes through with no HTTP code', () => {
  const err = (message, extra = {}) => Object.assign(new Error(message), extra);
  const cases = [
    [err('Your user is not allowed to read this (403): Insufficient rights to query records.', { code: 'ACCESS_DENIED' }), NOTE_TEXT.denied],
    [err('Table API query on "u_site_visit" failed (500): boom'), NOTE_TEXT.error],
    [err('Count on "incident" failed (500)'), NOTE_TEXT.error],
    [err('The record was not found in sn_hr_core_case, or your user cannot see it.', { code: 'NOT_FOUND' }), NOTE_TEXT.notFound],
    [err('Your organisation does not allow Agent Buddy to read incident records.', { code: 'BLOCKED_TABLE' }), NOTE_TEXT.blocked],
    [err('Your organisation does not allow Agent Buddy to read sn_hr_core_case records.', { code: 'BLOCKED_TABLE' }), NOTE_TEXT.blocked],
    [err(READ_TEXT.session, { code: 'SESSION_EXPIRED' }), READ_TEXT.session],
    [err(READ_TEXT.policy, { code: 'ACCESS_DENIED' }), READ_TEXT.policy],
    [err('Anthropic refused the request (answer 403). The key may not be allowed to use this model.'), 'Anthropic refused the request. The key may not be allowed to use this model.'],
    [err('Your organisation has switched this feature off.'), 'Your organisation has switched this feature off.'],
    [err(''), 'Something went wrong. Try again; if it keeps happening, tell your administrator.'],
    ['plain string', 'plain string'],
  ];
  for (const [input, expected] of cases) {
    const said = plainError(input);
    assert.equal(said, expected, String(input?.message ?? input));
    assert.doesNotMatch(said, /Table API|your user|\b[1-5]\d\d\b|\b[a-z]+_[a-z_]+\b/i, said);
  }
  assert.equal(plainError(null, 'Nope.'), 'Nope.');
});

test('plainError in Arabic: the fixed sentences are shown from the catalogue', () => {
  setLanguage('ar');
  const said = plainError(Object.assign(new Error('Table API query on "x" failed (500): boom'), { reason: 'error', status: 500 }));
  assert.equal(said, AR_NOTES[NOTE_TEXT.error]);
  assert.equal(plainError(Object.assign(new Error(READ_TEXT.session), { code: 'SESSION_EXPIRED' })), AR_NOTES[READ_TEXT.session]);
  assert.equal(plainError(Object.assign(new Error('Your organisation does not allow Agent Buddy to read incident records.'), { code: 'BLOCKED_TABLE' })), AR_NOTES[NOTE_TEXT.blocked]);
});

test('ErrorNote and ReadState show the plain sentence of an old technical error, calmly where the instance was only busy', () => {
  const old = Object.assign(new Error('Table API query on "sys_audit" failed (500): boom'), { reason: 'error', status: 500 });
  const markup = html(ErrorNote, { error: old, onRetry: () => {} });
  assert.match(markup, /Could not be read just now\. Try again in a moment\./);
  assert.doesNotMatch(markup, /Table API|500|sys_audit/);
  const state = html(ReadState, { state: { phase: 'error', data: null, error: old }, what: 'history', onRetry: () => {} });
  assert.doesNotMatch(state, /Table API|500|sys_audit/);
  assert.match(state, /Try again/);
});

// ---- the cards: no card prints a note as the engine wrote it --------------------------------------------------------------------------

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

test('the Insights cards print a note only through plainNote (or accessLine), never as the engine wrote it', () => {
  const dir = path.join(__dirname, '..', 'src', 'sidepanel', 'ticket', 'cards');
  // (KnowledgeCard, StepsCard, EmailCard and bits.jsx belong to another workstream; the scan covers the rest)
  const skip = new Set(['KnowledgeCard.jsx', 'StepsCard.jsx', 'EmailCard.jsx', 'bits.jsx']);
  const bad = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsx') && !skip.has(f))) {
    code(fs.readFileSync(path.join(dir, file), 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/\{([^{}]*\.note\b[^{}]*)\}/g)) {
          if (!/plainNote\(|accessLine\(|Boolean\(|&&\s*$/.test(m[1]) && !/^\s*[\w.?[\]]+\.note\s*&&\s*$/.test(m[1])) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
  }
  assert.deepEqual(bad, []);
});

test('the pure-engine files and the panel files this workstream owns never say "your user" to a person', () => {
  const dirs = ['src/context', 'src/content/ops', 'src/insights', 'src/sidepanel/ticket'];
  const files = ['src/content/tableApi.js', 'src/sidepanel/plainAccess.js', 'src/sidepanel/ask.js', 'src/sidepanel/ErrorNote.jsx'];
  const walk = (dir) => fs.readdirSync(path.join(__dirname, '..', dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(js|jsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
  const bad = [];
  for (const file of [...dirs.flatMap(walk), ...files]) {
    code(read(file))
      .split('\n')
      .forEach((line, i) => {
        // plainAccess.js and ask.js recognise "your user" in the sentences of an older reader: their patterns are the one place the words are written
        if (/your user/i.test(line) && !['src/sidepanel/plainAccess.js', 'src/sidepanel/ask.js'].includes(file)) bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  assert.deepEqual(bad, []);
});
