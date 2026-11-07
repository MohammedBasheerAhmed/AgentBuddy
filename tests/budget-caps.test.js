import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCaps, readBudgetState, assertWithinCaps, recordCall } from '../src/providers/budget.js';
import { CAPS_KEY, effectiveDailyTokenCap } from '../src/lib/aiUsage.js';
import { errorReason } from '../src/lib/pipeline.js';

// The person's own limits (Settings > Usage and limits): saved, applied before a call, and recorded in the audit log by a code.

function installChrome() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, JSON.parse(JSON.stringify(data[k]))]));
        },
        async set(obj) {
          Object.assign(data, JSON.parse(JSON.stringify(obj)));
        },
      },
    },
  };
  return data;
}

test('saveCaps keeps what is not changed, cleans what is typed, and a reached daily token cap refuses the next call with BUDGET', async () => {
  const data = installChrome();
  try {
    await saveCaps({ dailyCalls: 50 });
    const caps = await saveCaps({ dailyTokens: 1000 });
    assert.equal(caps.dailyCalls, 50, 'the other limit is kept');
    assert.equal(caps.dailyTokens, 1000);
    assert.equal((await saveCaps({ dailyTokens: -3 })).dailyTokens, 0, 'a negative number is "no limit"');
    await saveCaps({ dailyTokens: 1000 });
    assert.deepEqual(data[CAPS_KEY].dailyTokens, 1000);

    await recordCall({ provider: 'openai', model: 'm', ms: 5, usage: { input: 700, output: 400 }, host: '', kind: 'chat' });
    const { log } = await readBudgetState();
    assert.equal(log.length, 1);
    const err = await assertWithinCaps().catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.code, 'BUDGET');
    assert.match(err.message, /^Your daily AI limit is reached\. It resets tomorrow, or raise it in Settings > Usage and limits\.$/);
    assert.equal(errorReason(err), 'BUDGET');

    // Key checks ("Test connection") never count against a cap.
    await saveCaps({ dailyTokens: 5000 });
    await recordCall({ provider: 'openai', model: 'm', ms: 5, usage: { input: 9000, output: 0 }, kind: 'validate' });
    assert.equal((await assertWithinCaps()).status, 'ok');
  } finally {
    delete globalThis.chrome;
  }
});

test('the limit that applies is the smaller of the two, 0 meaning none', () => {
  assert.equal(effectiveDailyTokenCap(0, 0), 0);
  assert.equal(effectiveDailyTokenCap(200000, 0), 200000);
  assert.equal(effectiveDailyTokenCap(0, 5000), 5000);
  assert.equal(effectiveDailyTokenCap(200000, 5000), 5000);
  assert.equal(effectiveDailyTokenCap('x', -1), 0);
});
