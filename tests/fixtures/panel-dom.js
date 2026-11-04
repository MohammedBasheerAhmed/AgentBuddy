// Drive the side panel's React views in Node: mount, click, type, press keys, follow the focus, and a fake `chrome` whose answers a
// test controls (and can hold back, to make two reads overlap). Built on tests/fixtures/panel-dom-env.js (a small DOM).
//
//   import { mount, click, makeChrome, deferred } from './fixtures/panel-dom.js';   // FIRST import of the test file
//   const fake = makeChrome(); globalThis.chrome = fake.chrome;
//   fake.onRead('kbSearch', (args) => ({ ... }));
//   const ui = await mount(<KnowledgeInsights page={page} eff={eff} active />);
//   await click(ui.button('Search'));
//
// Every step runs inside React's act(), so effects and state updates have settled when it returns.
import { document, FakeEvent, window } from './panel-dom-env.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MSG } from '../../src/lib/messages.js';

export { document, window, FakeEvent };

/** A promise the test resolves or rejects when it chooses. */
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Let every pending promise and timer of 0 ms run, inside act. */
export const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

/** Run something (resolve a deferred read, say) inside act and let what follows settle. */
export const during = async (fn) => {
  await act(async () => {
    await fn();
  });
  await settle();
};

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const matches = (text, want) => (want instanceof RegExp ? want.test(norm(text)) : norm(text) === want);

export async function click(el) {
  if (!el) throw new Error('click: no element');
  await act(async () => {
    el.click();
  });
  await settle();
}

/** Type into an input or a textarea: what a person does, as React sees it (an input event). */
export async function type(el, value) {
  await act(async () => {
    el.focus();
    el.value = value;
    el.dispatchEvent(new FakeEvent('input', { bubbles: true }));
  });
  await settle();
}

/** Pick an option of a select. */
export async function choose(el, value) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new FakeEvent('change', { bubbles: true }));
  });
  await settle();
}

/** Press a key on an element (keydown, bubbling). */
export async function press(el, key, init = {}) {
  await act(async () => {
    el.dispatchEvent(new FakeEvent('keydown', { bubbles: true, cancelable: true, key, ...init }));
  });
  await settle();
}

export const focused = () => document.activeElement;

/**
 * Mount a React element in a fresh container. The helpers look only at what a person could see (hidden parts of the panel stay
 * mounted, as in the real panel, and are skipped), unless `all` is asked for.
 */
export async function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const errors = [];
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };
  try {
    await act(async () => {
      root.render(element);
    });
    await settle();
  } finally {
    console.error = original;
  }
  const shown = (el) => el.shown;
  const api = {
    container,
    root,
    errors,
    async rerender(next) {
      await act(async () => {
        root.render(next);
      });
      await settle();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.parentNode?.removeChild(container);
    },
    /** All text a person can see, spaces squeezed. */
    text() {
      const walk = (node) => {
        if (node.nodeType === 3) return node.nodeValue;
        if (node.nodeType !== 1 || !node.shown) return '';
        // Text nodes of one element run together (React splits "{n} titles" into two); elements are kept apart by a space.
        return ` ${node.childNodes.map(walk).join('')} `;
      };
      return norm(walk(container));
    },
    /** Elements matching a selector; shown ones only unless all = true. */
    $$(selector, { all = false } = {}) {
      const found = container.querySelectorAll(selector);
      return all ? found : found.filter(shown);
    },
    $(selector, opts) {
      return api.$$(selector, opts)[0] || null;
    },
    /** The shown button whose text is `label` (a string: exact, spaces squeezed; or a RegExp). Throws when there is none. */
    button(label, { all = false } = {}) {
      const found = api.$$('button', { all }).find((b) => matches(b.textContent, label));
      if (!found) throw new Error(`no button ${label}; buttons: ${api.$$('button', { all }).map((b) => JSON.stringify(norm(b.textContent))).join(', ')}`);
      return found;
    },
    hasButton(label) {
      return api.$$('button').some((b) => matches(b.textContent, label));
    },
    /** The shown tab (role="tab") named `label`. */
    tab(label) {
      const found = api.$$('[role="tab"]').find((b) => matches(b.textContent, label));
      if (!found) throw new Error(`no tab ${label}`);
      return found;
    },
    /** A form control by the text of its <label for>. */
    field(label) {
      const lab = api.$$('label').find((l) => matches(l.textContent, label));
      if (!lab) throw new Error(`no label ${label}`);
      const id = lab.getAttribute('for');
      return id ? container.querySelector(`#${id}`) : lab.querySelector('input, select, textarea');
    },
  };
  return api;
}

// ---- a fake `chrome` ------------------------------------------------------------------------------------------------------------

function event() {
  const set = new Set();
  return {
    addListener: (fn) => set.add(fn),
    removeListener: (fn) => set.delete(fn),
    hasListener: (fn) => set.has(fn),
    get count() {
      return set.size;
    },
    fire: (...args) => [...set].forEach((fn) => fn(...args)),
  };
}

/**
 * A `chrome` object for one test.
 *   onRead(op, fn)        answer READ messages for one op: fn(args, message) -> value, a promise, or throw (sent back as { error })
 *   onFill(fn)            answer FILL_FIELD: fn(message) -> { ok, ... }
 *   onPageState(fn)       answer PAGE_STATE: fn(tabId) -> state, or throw (no content script)
 *   activeTab             { id, url } that tabs.query() returns
 *   sent                  every message sent to a tab, in order
 *   updates               every tabs.update(tabId, props)
 *   optionsOpened         how many times the Settings page was opened
 */
export function makeChrome() {
  const sent = [];
  const updates = [];
  const reads = new Map();
  let fill = async () => ({ ok: true, method: 'g_form' });
  let pageState = async () => {
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  const onChanged = event();
  const area = (name) => {
    const data = {};
    return {
      data,
      async get(keys) {
        if (keys === null || keys === undefined) return { ...data };
        const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = structuredClone(data[k]);
        return out;
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
          data[k] = structuredClone(v);
        }
        onChanged.fire(changes, name);
      },
      async remove(keys) {
        const changes = {};
        for (const k of [].concat(keys)) {
          if (Object.prototype.hasOwnProperty.call(data, k)) {
            changes[k] = { oldValue: data[k] };
            delete data[k];
          }
        }
        if (Object.keys(changes).length) onChanged.fire(changes, name);
      },
    };
  };
  const state = {
    activeTab: { id: 7, url: 'https://acme.service-now.com/incident.do' },
    optionsOpened: 0,
  };
  const tabsEvents = { onActivated: event(), onUpdated: event(), onRemoved: event() };
  const chrome = {
    runtime: {
      id: 'test',
      openOptionsPage: () => {
        state.optionsOpened += 1;
      },
      sendMessage: async () => ({}),
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    permissions: { contains: async () => true, request: async () => true },
    storage: { local: area('local'), session: area('session'), sync: area('sync'), onChanged },
    tabs: {
      ...tabsEvents,
      query: async () => (state.activeTab ? [{ ...state.activeTab }] : []),
      update: (tabId, props) => {
        updates.push({ tabId, props });
        return Promise.resolve({ id: tabId });
      },
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        if (message?.type === MSG.PAGE_STATE) return pageState(tabId);
        if (message?.type === MSG.FILL_FIELD) return fill(message, tabId);
        if (message?.type === MSG.READ) {
          const fn = reads.get(message.op);
          if (!fn) return { error: { message: `No answer for ${message.op} in this test.`, code: '' } };
          try {
            return await fn(message.args || {}, message);
          } catch (err) {
            return { error: { message: String(err?.message || err), code: err?.code || '' } };
          }
        }
        return {};
      },
    },
  };
  return {
    chrome,
    sent,
    updates,
    state,
    get activeTab() {
      return state.activeTab;
    },
    set activeTab(tab) {
      state.activeTab = tab;
    },
    get optionsOpened() {
      return state.optionsOpened;
    },
    onRead(op, fn) {
      reads.set(op, fn);
    },
    onFill(fn) {
      fill = fn;
    },
    onPageState(fn) {
      pageState = fn;
    },
    /** The READ messages sent for one op, in order. */
    readsOf(op) {
      return sent.filter((s) => s.message?.type === MSG.READ && s.message.op === op).map((s) => s.message.args);
    },
    fills() {
      return sent.filter((s) => s.message?.type === MSG.FILL_FIELD).map((s) => s.message);
    },
  };
}

/** A stand-in for the AI provider's HTTP answer (Anthropic format), so a whole run can go through useRun. */
export function fakeAiFetch(answer = 'An answer from the AI.') {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const text = typeof answer === 'function' ? await answer(calls.length) : answer;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
      text: async () => '',
    };
  };
  fetchFn.calls = calls;
  return fetchFn;
}

/** Fake clipboard (navigator.clipboard) that remembers what was copied. */
export function fakeClipboard() {
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => copied.push(String(t)) } }, configurable: true, writable: true });
  return copied;
}
