// The page bridge (src/page/bridge.js) loaded into a fake page, for the tests of roles and writes (tests/roles-*.test.js,
// tests/writes-*.test.js). It follows tests/page-bridge-version.test.js: the real file runs in a vm against a fake document, and
// every request is answered the way the content script would see it. No browser, no network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

export const BRIDGE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }

  stopImmediatePropagation() {}
}

/**
 * A classic page: the bridge, a document with no boxes, and whatever globals the test names.
 * @param {{ g_form?: object, g_user?: object, NOW?: object, pathname?: string }} [page]
 * @returns {{ ask: (action: string, args?: any[]) => any, window: object }} ask() answers with the result, or throws the bridge's error
 */
export function loadBridge({ g_form, g_user, NOW, pathname = '/incident.do' } = {}) {
  const listeners = [];
  const doc = {
    addEventListener: (type, fn) => void listeners.push({ type, fn }),
    removeEventListener: () => {},
    dispatchEvent(event) {
      for (const l of listeners.filter((x) => x.type === event.type)) l.fn.call(doc, event);
      return true;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = { document: doc, CustomEvent: FakeEvent, location: { pathname, search: '', hash: '', href: `https://x.service-now.com${pathname}` }, frames: [] };
  if (g_form) sandbox.g_form = g_form;
  if (g_user) sandbox.g_user = g_user;
  if (NOW) sandbox.NOW = NOW;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SOURCE, sandbox);
  let n = 0;
  return {
    window: sandbox,
    ask(action, args = []) {
      const answers = [];
      doc.addEventListener('ab-page-response', (event) => answers.push(JSON.parse(JSON.stringify(event.detail))));
      doc.dispatchEvent(new FakeEvent('ab-page-request', { detail: { id: `r${(n += 1)}`, action, args } }));
      if (answers.length !== 1) throw new Error(`the bridge answered ${answers.length} times`);
      if (!answers[0].ok) throw new Error(answers[0].error);
      return answers[0].result;
    },
  };
}

/**
 * A g_form as ServiceNow's is: setValue changes what getValue answers next, unless the field is locked, and then it is ignored
 * without a word (what a locked field does, often). Every setValue is recorded, so a test can prove what was written.
 * @param {{ values?: object, editable?: string[]|null|'absent'|'throws', locked?: string[], rewrite?: (name: string, value: string) => string, options?: object|null, types?: object, isReadOnly?: boolean }} [spec]
 *   editable: what getEditableFields() answers ('absent': the form has no such function; 'throws': it fails)
 *   locked: names whose setValue is ignored; rewrite: a client script that changes a value as it is set
 *   options: { field: ['stored values'] } makes getOption(field, value) answer for a choice (null: no getOption function)
 */
export function fakeForm({ values = {}, editable = [], locked = [], rewrite = null, options = null, types = null, isReadOnly = true } = {}) {
  const held = { ...values };
  const sets = [];
  const form = {
    hasField: (name) => Object.prototype.hasOwnProperty.call(held, name),
    getValue: (name) => held[name],
    setValue(name, value) {
      sets.push([name, value]);
      if (locked.includes(name)) return;
      held[name] = rewrite ? rewrite(name, String(value)) : value;
    },
    getTableName: () => 'incident',
    getUniqueValue: () => 'a'.repeat(32),
  };
  if (editable === 'throws') {
    form.getEditableFields = () => {
      throw new Error('not here');
    };
  } else if (editable !== 'absent') form.getEditableFields = () => editable;
  if (isReadOnly) form.isReadOnly = () => true;
  if (options) form.getOption = (name, value) => (options[name] || []).includes(value);
  if (types) form.getGlideUIElement = (name) => ({ type: types[name] || 'string' });
  return Object.assign(form, { sets, held });
}
