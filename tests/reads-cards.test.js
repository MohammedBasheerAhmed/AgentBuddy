import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Notes, ReadState, accessLines } from '../src/sidepanel/ticket/cards/bits.jsx';
import ErrorNote from '../src/sidepanel/ErrorNote.jsx';
import { READ_CODE, READ_TEXT, classifyReadError } from '../src/context/access.js';
import { readJson } from '../src/content/tableApi.js';
import { registerCatalogue, setLanguage } from '../src/i18n/index.js';
import { AR_READS } from '../src/i18n/ar/reads.js';
import { AR_NOTES } from '../src/i18n/ar/notes.js';

registerCatalogue('ar', AR_NOTES); // (the same texts the catalogue index adds; harmless when it already has them)

// Round 4, Phase 0 (docs/round4.md, agent B): what the Insights cards show when the instance refused or limited a read. A refusal is a
// plain line with no "Try again" (trying again cannot change it); the instance limiting or answering with a page is a calm note WITH
// "Try again"; a lost session and any other failure stay an error. Never an empty list, never "all clear" (readFully, useInsight.js).

const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const failed = (error) => ({ phase: 'error', data: null, error });
// What reaches the panel: ask.js rebuilds an Error from the content script's { message, code } (src/lib/messages.js toWireError).
const wire = (message, code = '') => Object.assign(new Error(message), { code });

test('a 403 from an access rule: "not available to you with your role", a plain line, no alarm and no "Try again"', () => {
  const markup = html(ReadState, { state: failed(wire('Your user is not allowed to read this (403): Insufficient rights to query records.', 'ACCESS_DENIED')), what: 'earlier tickets', onRetry: () => {} });
  assert.equal(markup, '<p class="ab-hint ab-reads-refused">Earlier tickets: not available to you with your role.</p>');
});

test('a 403 from the organisation\'s restriction: says so and sends the person to the ServiceNow admin', () => {
  const markup = html(ReadState, { state: failed(wire(READ_TEXT.policy, 'ACCESS_DENIED')), what: 'SLAs', onRetry: () => {} });
  assert.equal(markup, '<p class="ab-hint ab-reads-refused">SLAs: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.</p>');
});

test('429, 503 and a page instead of data: a calm note in plain words, with "Try again"', () => {
  const cases = [
    [wire(READ_TEXT.rateLimited, READ_CODE.RATE_LIMITED), 'ServiceNow is limiting requests. Try again in a minute.'],
    [wire(READ_TEXT.unavailable, READ_CODE.UNAVAILABLE), 'ServiceNow is busy or under maintenance. Try again in a few minutes.'],
    [wire(READ_TEXT.notData, READ_CODE.NOT_DATA), 'ServiceNow did not send the information. Sign in again, or try later (it may be down for maintenance).'],
    [wire('ServiceNow did not answer in time. Try again in a moment.', 'SN_TIMEOUT'), 'ServiceNow did not answer in time. Try again in a moment.'],
  ];
  for (const [error, text] of cases) {
    const markup = html(ReadState, { state: failed(error), what: 'knowledge articles', onRetry: () => {} });
    assert.match(markup, /^<div class="ab-note ab-note-warn ab-errnote ab-reads-calm" role="status">/, text);
    assert.ok(markup.includes(`<p class="ab-errnote-text">${text}</p>`), text);
    assert.match(markup, /<button type="button" class="ab-btn ab-btn-sm">Try again<\/button>/);
    assert.ok(!/ab-note-danger|role="alert"/.test(markup));
  }
});

test('a lost session and any other failure stay an error with "Try again"; the record not there and a blocked table as before', () => {
  const session = html(ReadState, { state: failed(wire(READ_TEXT.session, 'SESSION_EXPIRED')), what: 'this ticket', onRetry: () => {} });
  assert.match(session, /^<div class="ab-note ab-note-danger ab-errnote" role="alert"><p class="ab-errnote-text">You are signed out of ServiceNow\. Sign in again, then try again\./);
  const other = html(ReadState, { state: failed(wire('')), what: 'this ticket', onRetry: () => {} });
  assert.match(other, /ab-note-danger[^>]*role="alert"><p class="ab-errnote-text">This ticket could not be read\.<\/p>/);
  assert.equal(html(ReadState, { state: failed(wire('x', 'NOT_FOUND')), what: 'the request' }), '<p class="ab-hint ab-reads-refused">The request: not available to you.</p>');
  assert.equal(html(ReadState, { state: failed(wire('x', 'BLOCKED_TABLE')), what: 'SLAs' }), '<p class="ab-hint ab-reads-refused">SLAs: your organisation does not let Agent Buddy read this.</p>');
  assert.equal(html(ReadState, { state: { phase: 'ready', data: { items: [] }, error: null }, what: 'x' }), '', 'nothing once data is there');
});

test('the notes under a card: the organisation\'s restriction once for every read it stopped, the instance\'s limit once, the rest as before', async () => {
  const entryFor = async (source, response) => {
    let err;
    try {
      await readJson(response, 'q');
    } catch (e) {
      err = e;
    }
    const f = classifyReadError(err, source);
    return { source, status: f.status, note: f.note }; // the way most readers build their access entries
  };
  const answer = (status, body = '') => ({ ok: false, status, redirected: false, url: '', headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const access = [
    await entryFor('task_sla', answer(403, { error: { message: 'User Not Authorized', detail: 'Access denied by REST API access policy' } })),
    { source: 'kb_use', status: 'denied', note: 'Your user cannot read kb_use.' },
    await entryFor('sysapproval_approver', answer(403, { error: { message: 'User Not Authorized', detail: 'Access denied by REST API access policy' } })),
    await entryFor('problem', answer(429)),
    await entryFor('change_request', answer(429)),
    { source: 'm2m_kb_task', status: 'ok', note: '' },
    await entryFor('x_missing', answer(400, { error: { message: 'Invalid table x_missing' } })),
  ];
  assert.deepEqual(accessLines(access), [
    'SLAs, Approvals: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.',
    'Article links: You cannot read article links.',
    'ServiceNow is limiting requests. Try again in a minute.',
  ]);
  assert.equal(html(Notes, { access }), `<p class="ab-hint ab-kb-notes">${accessLines(access).join(' ')}</p>`);
  assert.equal(html(Notes, { access: [{ source: 'a', status: 'ok' }] }), '', 'nothing to say: nothing drawn');
  assert.ok(!html(Notes, { access }).includes('task_sla'), 'no table names');
});

test('ErrorNote: the default is unchanged; a limit or a page instead of data is calm on its own; a tone can be given', () => {
  assert.equal(html(ErrorNote, { error: 'It took too long.' }), '<div class="ab-note ab-note-danger ab-errnote" role="alert"><p class="ab-errnote-text">It took too long.</p></div>');
  assert.match(html(ErrorNote, { error: wire(READ_TEXT.rateLimited, READ_CODE.RATE_LIMITED) }), /^<div class="ab-note ab-note-warn ab-errnote ab-reads-calm" role="status">/);
  assert.match(html(ErrorNote, { error: READ_TEXT.notData }), /ab-reads-calm/);
  assert.match(html(ErrorNote, { error: READ_TEXT.notData, tone: 'danger' }), /ab-note-danger/);
});

test('in Arabic: every new sentence is shown from the catalogue, the thing kept in the sentence', () => {
  setLanguage('ar');
  try {
    const policy = html(ReadState, { state: failed(wire(READ_TEXT.policy, 'ACCESS_DENIED')), what: 'x' });
    assert.ok(policy.includes(AR_NOTES['{thing}: not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need it.'].replace('{thing}', 'X')));
    const limited = html(ReadState, { state: failed(wire(READ_TEXT.rateLimited, READ_CODE.RATE_LIMITED)), what: 'x', onRetry: () => {} });
    assert.ok(limited.includes(AR_READS['ServiceNow is limiting requests. Try again in a minute.']));
    const session = html(ReadState, { state: failed(wire(READ_TEXT.session, 'SESSION_EXPIRED')), what: 'x' });
    assert.ok(session.includes(AR_NOTES[READ_TEXT.session]), 'the session message is translated now too');
    for (const [english, arabic] of Object.entries(AR_READS)) {
      assert.ok(/[؀-ۿ]/.test(arabic), english);
      assert.deepEqual(arabic.match(/\{[a-z]+\}/gi) || [], english.match(/\{[a-z]+\}/gi) || [], english);
    }
  } finally {
    setLanguage('en');
  }
});
