import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../src/sidepanel/ask.js';
import { READS_FILE, READS_KEY, READS_NOT_LOADED_CODE } from '../src/lib/messages.js';

// The reading engine is a file of its own (reads.bundle.js) so the script that loads on every page of an added site stays small. The
// panel injects it the first time a read finds it missing (src/sidepanel/ask.js) and asks again.

const notLoaded = () => ({ error: { message: 'The reading part of Agent Buddy is not loaded on this page yet.', code: READS_NOT_LOADED_CODE } });

const withChrome = async (api, fn) => {
  const before = globalThis.chrome;
  globalThis.chrome = api;
  try {
    return await fn();
  } finally {
    globalThis.chrome = before;
  }
};

test('a read that finds the engine missing loads it into that tab, in the isolated world, and asks again', async () => {
  const injected = [];
  let loaded = false;
  const api = {
    tabs: { sendMessage: async () => (loaded ? { items: [1] } : notLoaded()) },
    scripting: {
      executeScript: async (details) => {
        injected.push(details);
        loaded = true;
        return [{}];
      },
    },
  };
  const answer = await withChrome(api, () => read(7, 'myday', {}));
  assert.deepEqual(answer, { items: [1] });
  assert.equal(injected.length, 1);
  assert.deepEqual(injected[0], { target: { tabId: 7 }, files: [READS_FILE], world: 'ISOLATED' });
});

test('a screen that starts several reads at once injects the file once per tab', async () => {
  let injections = 0;
  let loaded = false;
  const api = {
    tabs: { sendMessage: async () => (loaded ? { ok: true } : notLoaded()) },
    scripting: {
      executeScript: async () => {
        injections += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        loaded = true;
        return [{}];
      },
    },
  };
  const answers = await withChrome(api, () => Promise.all([read(3, 'a'), read(3, 'b'), read(3, 'c'), read(3, 'd')]));
  assert.equal(answers.length, 4);
  assert.equal(injections, 1);
});

test('a loaded engine is not injected again, and other errors are passed on untouched', async () => {
  let injections = 0;
  const api = {
    tabs: { sendMessage: async () => ({ error: { message: 'You cannot see this.', code: 'FORBIDDEN' } }) },
    scripting: { executeScript: async () => { injections += 1; } },
  };
  await withChrome(api, async () => {
    await assert.rejects(read(1, 'pack'), (err) => err.code === 'FORBIDDEN' && err.message === 'You cannot see this.');
  });
  assert.equal(injections, 0);
});

test('when the browser refuses the file the person is told the page is out of touch, not a technical word', async () => {
  const api = {
    tabs: { sendMessage: async () => notLoaded() },
    scripting: { executeScript: async () => { throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.'); } },
  };
  await withChrome(api, async () => {
    await assert.rejects(read(1, 'pack'), (err) => err.code === 'LOST_TOUCH' && /lost touch/.test(err.message));
  });
});

test('the engine, once loaded, puts its two entry points on the world under the shared key and says the panel\'s language', async () => {
  const calls = [];
  const before = globalThis[READS_KEY];
  try {
    await import('../src/content/readsEntry.js');
    const engine = globalThis[READS_KEY];
    assert.equal(typeof engine.handleRead, 'function');
    assert.equal(typeof engine.clear, 'function');
    assert.ok(Object.isFrozen(engine), 'nothing can swap an entry point afterwards');
    // An unknown operation is refused by the engine itself (the language option never reaches it as an argument).
    await assert.rejects(engine.handleRead('no-such-op', {}, { language: 'ar', guard: { deps: async (d) => d, allowSensitive: async () => false }, makeDeps: () => ({}) }), /Unknown request/);
    calls.push('refused');
  } finally {
    if (before === undefined) delete globalThis[READS_KEY];
    else globalThis[READS_KEY] = before;
  }
  assert.deepEqual(calls, ['refused']);
});
