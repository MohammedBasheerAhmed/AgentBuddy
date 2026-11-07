import test from 'node:test';
import assert from 'node:assert/strict';
import { LOST_TOUCH, PANEL_UPDATED, ask, plainError, read } from '../src/sidepanel/ask.js';

// Integration review M11: the browser's own words about a missing page never reach the person.

const BROWSER = [
  'Could not establish connection. Receiving end does not exist.',
  'The message port closed before a response was received.',
  'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
  'No tab with id: 1234.',
  'The tab was closed.',
];

test('the browser messages about a lost page become one plain sentence', () => {
  assert.equal(LOST_TOUCH, 'Agent Buddy lost touch with this page. Reload the ServiceNow page and try again.');
  for (const text of BROWSER) assert.equal(plainError(new Error(text)), LOST_TOUCH, text);
  assert.equal(plainError({ message: 'Error: Could not establish connection. Receiving end does not exist.' }), LOST_TOUCH);
});

test('a reloaded extension is said differently: the panel itself has to be reopened', () => {
  assert.equal(plainError(new Error('Extension context invalidated.')), PANEL_UPDATED);
});

test('any other message is already ours and passes through; an empty one gets a fallback', () => {
  assert.equal(plainError(new Error('Your organisation has switched this feature off.')), 'Your organisation has switched this feature off.');
  assert.equal(plainError(new Error('')), 'Something went wrong. Try again; if it keeps happening, tell your administrator.');
  assert.equal(plainError(null, 'Nope.'), 'Nope.');
  assert.equal(plainError('plain string'), 'plain string');
});

const withChrome = async (sendMessage, fn) => {
  const before = globalThis.chrome;
  globalThis.chrome = { tabs: { sendMessage } };
  try {
    return await fn();
  } finally {
    globalThis.chrome = before;
  }
};

test('ask(): a rejected message becomes a plain error with a code the views can test', async () => {
  for (const text of BROWSER) {
    await withChrome(async () => { throw new Error(text); }, async () => {
      await assert.rejects(ask(1, { type: 'x' }), (err) => err.message === LOST_TOUCH && err.code === 'LOST_TOUCH');
    });
  }
});

test('ask(): no answer at all (the page was replaced on the way) is the same lost touch, not a crash on undefined', async () => {
  for (const nothing of [undefined, null]) {
    await withChrome(async () => nothing, async () => {
      await assert.rejects(read(1, 'pack', {}), (err) => err.message === LOST_TOUCH);
    });
  }
});

test('ask(): an error from the page keeps its message and code; an unknown rejection is passed on unchanged', async () => {
  await withChrome(async () => ({ error: { message: 'That is not a valid record.', code: 'BAD' } }), async () => {
    await assert.rejects(read(1, 'pack', {}), (err) => err.message === 'That is not a valid record.' && err.code === 'BAD');
  });
  const odd = new Error('Something odd.');
  await withChrome(async () => { throw odd; }, async () => {
    await assert.rejects(ask(1, {}), (err) => err === odd);
  });
});

test('read() sends the READ message with the op and its arguments, and returns the answer', async () => {
  let sent;
  const answer = await withChrome(async (tabId, message) => { sent = { tabId, message }; return { items: [1] }; }, () => read(5, 'myday', { a: 1 }));
  assert.deepEqual(answer, { items: [1] });
  assert.equal(sent.tabId, 5);
  assert.equal(sent.message.op, 'myday');
  assert.deepEqual(sent.message.args, { a: 1 });
});
