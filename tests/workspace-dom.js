// A small fake page for the Workspace tests (tests/workspace-*.test.js): the real src/page/bridge.js runs in a vm against it. It has what a
// Workspace page has and the portal fake (tests/portal-bridge.test.js) does not: parents (so the bridge can climb from a box to the switch
// beside it), open shadow roots with their hosts, a focused element, selected tabs and radios, a clock the test can set, and elements that
// can be taken off the page. Not a test itself (tests/run.js runs *.test.js only).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

export const BRIDGE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');

const descendants = (node, out = []) => {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
};

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
  }
}

export class FakeNode {
  constructor(doc, tag, attrs = {}, opts = {}) {
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.shadowRoot = null;
    this.contentDocument = null;
    this.hidden = Boolean(opts.hidden);
    this.disabled = Boolean(opts.disabled);
    this.readOnly = Boolean(opts.readOnly);
    this.maxLength = -1;
    this.labels = (opts.labels || []).map((textContent) => ({ textContent }));
    this.rect = opts.rect || { width: 300, height: 60, right: 400 };
    this.style = { visibility: 'visible', display: 'block' };
    this.ownText = opts.text || '';
    this.selected = Boolean(opts.selected);
    this.checked = Boolean(opts.checked);
    this.type = opts.type || attrs.type || '';
    this.events = [];
    this.connected = true;
  }

  get isConnected() {
    return this.connected;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  get textContent() {
    return [this.ownText, ...this.children.map((c) => c.textContent)].filter(Boolean).join(' ');
  }

  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  attachShadow() {
    const root = {
      nodeType: 11,
      host: this,
      children: [],
      activeElement: null,
      querySelectorAll: () => descendants(root),
      getElementById: () => null,
      append(child) {
        child.parentNode = root;
        root.children.push(child);
        return child;
      },
    };
    this.shadowRoot = root;
    return root;
  }

  querySelectorAll() {
    return descendants(this);
  }

  getClientRects() {
    return this.hidden || this.style.display === 'none' ? [] : [this.rect];
  }

  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  remove() {
    this.connected = false;
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
  }
}

// A text box with a value the page's own code could refuse to keep (opts.refuse: a controlled input that puts its old value back).
class FakeBox extends FakeNode {
  get value() {
    return this._value || '';
  }

  set value(v) {
    if (!this.refuse) this._value = String(v);
  }
}
class FakeTextArea extends FakeBox {}
class FakeInput extends FakeBox {}

/**
 * @param {{ url?: string, clock?: boolean, window?: object }} [options]
 *   clock: true makes Date.now() jump 100 ms at every call, so a search with a time budget ends after a few hundred nodes
 */
export function makeWorkspace({ url = 'https://x.service-now.com/now/sow/record/incident/' + 'a'.repeat(32), clock = false, window: extra = {} } = {}) {
  const u = new URL(url);
  const listeners = {};
  const responses = [];
  const body = new FakeNode(null, 'body');
  const html = new FakeNode(null, 'html');
  html.children.push(body);
  body.parentNode = html;
  const doc = {
    nodeType: 9,
    designMode: 'off',
    body,
    documentElement: html,
    activeElement: null,
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      responses.push(event);
      return true;
    },
    querySelector: () => null,
    getElementById: () => null,
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createElement: (tag) => new FakeNode(doc, tag),
    execCommand: () => false,
    querySelectorAll: () => descendants(body),
  };
  body.ownerDocument = doc;
  html.ownerDocument = doc;
  let ticks = 0;
  const sandbox = {
    document: doc,
    location: { pathname: u.pathname, search: u.search, hash: u.hash },
    frames: [],
    Event: FakeEvent,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: FakeInput,
    getComputedStyle: (el) => el.style,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    ...extra,
  };
  if (clock) sandbox.Date = { now: () => (ticks += 100) };
  sandbox.window = sandbox;
  doc.defaultView = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SOURCE, sandbox);

  let n = 0;
  const make = (tag, attrs, opts, parent) => {
    const Klass = tag === 'textarea' ? FakeTextArea : tag === 'input' ? FakeInput : FakeNode;
    const el = new Klass(doc, tag, attrs, opts);
    if (opts && opts.value !== undefined) el._value = opts.value;
    if (opts && opts.refuse) el.refuse = true;
    (parent || body).append(el);
    return el;
  };
  const api = {
    doc,
    win: sandbox,
    body,
    /** An element on the page (inside `parent` when given: an element, or a shadow root made with host.attachShadow()). */
    add(tag, attrs = {}, opts = {}, parent = null) {
      return make(tag, attrs, opts, parent);
    },
    /** A component with an open shadow root: { host, root }. Add its children with add(tag, attrs, opts, root). */
    host(tag = 'now-component', parent = null) {
      const host = make(tag, {}, {}, parent);
      return { host, root: host.attachShadow() };
    },
    /** A same-origin frame holding a document of its own: { frame, add(tag, attrs, opts) } (what is added is in the frame's body). */
    frame(attrs = {}) {
      const frame = make('iframe', attrs, {}, null);
      const inner = {
        nodeType: 9,
        designMode: 'off',
        defaultView: sandbox,
        body: null,
        querySelectorAll: () => descendants(inner.body),
        getElementById: () => null,
        createTextNode: doc.createTextNode,
        createElement: (tag) => new FakeNode(inner, tag),
        createRange: doc.createRange,
        execCommand: () => false,
      };
      inner.body = new FakeNode(inner, 'body');
      frame.contentDocument = inner;
      return {
        frame,
        add(tag, tagAttrs = {}, opts = {}) {
          const Klass = tag === 'textarea' ? FakeTextArea : tag === 'input' ? FakeInput : FakeNode;
          const el = new Klass(inner, tag, tagAttrs, opts);
          if (opts.value !== undefined) el._value = opts.value;
          inner.body.append(el);
          return el;
        },
      };
    },
    call(action, args = []) {
      responses.length = 0;
      listeners['ab-page-request']({ detail: { id: `w${(n += 1)}`, action, args } });
      const detail = responses[responses.length - 1].detail;
      if (detail.ok !== true) throw new Error(detail.error);
      return detail.result === undefined ? undefined : JSON.parse(JSON.stringify(detail.result));
    },
  };
  return api;
}

/**
 * A composer the way a Workspace draws one, inside open shadow roots: a switch of tabs (Work notes / Customer comments, or any pair
 * of labels) with one selected, and a text box. The box's own label is `boxLabel`. Returns { box, tabs, host }.
 */
export function addComposer(page, { tabs = ['Work notes', 'Customer comments'], selected = 0, boxLabel = 'Work notes', value = '', parent = null, extra = null } = {}) {
  const { host, root } = page.host('now-activity-composer', parent);
  const list = page.add('div', { role: 'tablist' }, {}, root);
  const buttons = tabs.map((label, i) => page.add('button', { role: 'tab', 'aria-selected': i === selected ? 'true' : 'false' }, { text: label }, list));
  if (extra) extra(root);
  const box = page.add('textarea', { 'aria-label': boxLabel }, { value }, root);
  return { box, tabs: buttons, host, root };
}
