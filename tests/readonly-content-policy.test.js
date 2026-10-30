// The content script runs in the ServiceNow page's own process: it reads only the policy keys a read needs (security audit 2, AB2-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import { READ_POLICY_KEYS, createPolicyGuard, readManaged } from '../src/content/policyGuard.js';

const ORG = {
  blockedTables: ['sn_hr_er_case'],
  sensitiveTablePrefixes: ['x_acme_hr_'],
  allowHrContent: false,
  providedApiKey: 'sk-org-secret-key-0123456789',
  aiBaseUrl: 'https://ai-gateway.corp.example/v1',
  aiProvider: 'openai',
};

// chrome.storage.managed as the browser has it: get(keys) answers with those keys, get(null) with everything.
function managedArea(store, asked) {
  return {
    get: async (keys) => {
      asked.push(keys);
      if (keys === null || keys === undefined) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
    },
  };
}

test('the content script asks the browser for the three read keys only, never the whole policy', async () => {
  const asked = [];
  const got = await readManaged(managedArea(ORG, asked));
  assert.deepEqual(asked, [[...READ_POLICY_KEYS]]);
  assert.deepEqual(Object.keys(got.raw).sort(), ['allowHrContent', 'blockedTables', 'sensitiveTablePrefixes']);
  assert.ok(!JSON.stringify(got).includes('sk-org-secret'), 'an AI key the organisation supplies never enters the page process');
  assert.equal(got.known, true);
});

test('a browser that answers with more than was asked for still hands over only the read keys', async () => {
  const noisy = { get: async () => ({ ...ORG }) };
  const got = await readManaged(noisy);
  assert.ok(!('providedApiKey' in got.raw) && !('aiBaseUrl' in got.raw));
});

test('no managed storage, or one that throws: the policy is unknown, as before', async () => {
  assert.deepEqual(await readManaged(undefined), { known: false, raw: {} });
  assert.deepEqual(await readManaged({ get: async () => { throw new Error('managed storage is not available'); } }), { known: false, raw: {} });
});

test('the guard built on it still blocks what the policy blocks', async () => {
  const asked = [];
  const guard = createPolicyGuard({ getManaged: () => readManaged(managedArea(ORG, asked)) });
  const deps = await guard.deps({ queryTable: async () => [] });
  await assert.rejects(() => deps.queryTable('sn_hr_er_case', '', ['number']), (err) => err.code === 'BLOCKED_TABLE');
  assert.equal(await guard.allowSensitive(true), false, 'HR content stays off when the policy says so');
  assert.ok(!JSON.stringify(await guard.state()).includes('sk-org-secret'));
});
