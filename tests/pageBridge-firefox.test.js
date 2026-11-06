const test = require('node:test');
const assert = require('node:assert/strict');
import { callPage, requestDetail } from '../src/content/pageBridge.js';

// The content script's request to the page bridge (src/content/pageBridge.js). In Firefox an object a content script makes cannot be
// read by the page's own scripts ("Permission denied to access property "id"": the bridge never answered, found by the Firefox
// end-to-end run, e2e/firefox), so the request goes out as a copy made in the page's world with cloneInto, which Firefox gives content
// scripts. Chrome and Edge have no cloneInto: their request is the object itself, as before.

const DETAIL = { id: 'ab-0123', action: 'getSessionInfo', args: [] };

test('Chrome and Edge (no cloneInto): the request is the object itself', () => {
  const scope = { document: { defaultView: {} } };
  assert.equal(requestDetail(DETAIL, scope), DETAIL);
  assert.equal(requestDetail(DETAIL, {}), DETAIL);
  assert.equal(requestDetail(DETAIL, undefined), DETAIL); // (the default is globalThis, which has no cloneInto in Node)
  assert.equal(requestDetail(DETAIL), DETAIL);
});

test("Firefox (cloneInto): the request is a copy made in the page's world", () => {
  const view = { name: 'the page window' };
  const calls = [];
  const scope = {
    document: { defaultView: view },
    cloneInto: (value, target) => {
      calls.push({ value, target });
      return { ...value, madeIn: 'page' };
    },
  };
  const out = requestDetail(DETAIL, scope);
  assert.deepEqual(calls, [{ value: DETAIL, target: view }]);
  assert.deepEqual(out, { ...DETAIL, madeIn: 'page' });
  assert.notEqual(out, DETAIL);
});

test('a cloneInto that is not a function, or no page window to clone into, leaves the request as it is', () => {
  assert.equal(requestDetail(DETAIL, { cloneInto: 'not a function', document: { defaultView: {} } }), DETAIL);
  assert.equal(requestDetail(DETAIL, { cloneInto: () => ({}) }), DETAIL);
  assert.equal(requestDetail(DETAIL, { cloneInto: () => ({}), document: {} }), DETAIL);
});

// callPage itself, against a fake page: a document that carries events, and a bridge that answers the way src/page/bridge.js does.
function withFakePage(cloneInto, run) {
  const saved = { document: globalThis.document, cloneInto: globalThis.cloneInto };
  const doc = new EventTarget();
  doc.defaultView = { name: 'the page window' };
  const seen = [];
  doc.addEventListener('ab-page-request', (event) => {
    const detail = event.detail;
    seen.push(detail);
    doc.dispatchEvent(new CustomEvent('ab-page-response', { detail: { id: detail.id, ok: true, result: { action: detail.action } } }));
  });
  globalThis.document = doc;
  if (cloneInto) globalThis.cloneInto = cloneInto;
  else delete globalThis.cloneInto;
  return Promise.resolve()
    .then(() => run(seen, doc))
    .finally(() => {
      globalThis.document = saved.document;
      if (saved.cloneInto === undefined) delete globalThis.cloneInto;
      else globalThis.cloneInto = saved.cloneInto;
    });
}

test('callPage in Firefox: the bridge receives the copy, and its answer comes back', async () => {
  const clones = [];
  await withFakePage(
    (value, target) => {
      const copy = JSON.parse(JSON.stringify(value));
      clones.push({ copy, target });
      return copy;
    },
    async (seen, doc) => {
      const answer = await callPage('getSessionInfo', ['x'], { timeoutMs: 1000 });
      assert.deepEqual(answer, { action: 'getSessionInfo' });
      assert.equal(clones.length, 1);
      assert.equal(clones[0].target, doc.defaultView);
      assert.equal(seen.length, 1);
      assert.equal(seen[0], clones[0].copy, 'the event carries the copy made for the page, not the content script\'s own object');
      assert.equal(seen[0].action, 'getSessionInfo');
      assert.deepEqual(seen[0].args, ['x']);
      assert.match(seen[0].id, /^ab-[0-9a-f]{32}$/);
    }
  );
});

test('callPage in Chrome and Edge: unchanged, the bridge receives the request object and answers', async () => {
  await withFakePage(null, async (seen) => {
    const answer = await callPage('getFormMeta', [], { timeoutMs: 1000 });
    assert.deepEqual(answer, { action: 'getFormMeta' });
    assert.equal(seen.length, 1);
    assert.deepEqual(Object.keys(seen[0]).sort(), ['action', 'args', 'id']);
  });
});
