// A small DOM, just enough for react-dom to render the side panel's views in Node and for a test to click, type, press keys and
// follow the focus. There is no jsdom in this project (and no network to fetch it), so this stands in for the browser.
//
// Import it BEFORE react-dom (tests/fixtures/panel-dom.js does): react-dom decides at load time whether a DOM exists.
// It is a test double, not a browser: no layout, no CSS, no innerHTML (the panel never uses it). An element is "shown" when neither it
// nor an ancestor has the `hidden` attribute or `style.display = 'none'`; that is all getClientRects() looks at.

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ELEMENT = 1;
const TEXT = 3;
const COMMENT = 8;
const DOCUMENT = 9;
const FRAGMENT = 11;

export class FakeEvent {
  constructor(type, init = {}) {
    const { bubbles = false, cancelable = false, ...rest } = init;
    this.type = type;
    this.bubbles = bubbles;
    this.cancelable = cancelable;
    this.defaultPrevented = false;
    this.isTrusted = true;
    this.timeStamp = Date.now();
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.button = 0;
    this.buttons = 0;
    this.ctrlKey = false;
    this.shiftKey = false;
    this.altKey = false;
    this.metaKey = false;
    this.detail = 0;
    this.relatedTarget = null;
    Object.assign(this, rest);
    this._stop = false;
    this._stopNow = false;
    this._path = [];
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this._stop = true;
  }

  stopImmediatePropagation() {
    this._stop = true;
    this._stopNow = true;
  }

  composedPath() {
    return this._path.slice();
  }

  getModifierState(key) {
    return { Control: this.ctrlKey, Shift: this.shiftKey, Alt: this.altKey, Meta: this.metaKey }[key] || false;
  }
}

class FakeNode {
  constructor(doc, nodeType, nodeName) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = new Map();
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] || null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] || null : null;
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === ELEMENT ? this.parentNode : null;
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n.nodeType === DOCUMENT;
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  insertBefore(child, ref) {
    if (child.nodeType === FRAGMENT) {
      for (const c of child.childNodes.slice()) this.insertBefore(c, ref);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  replaceChild(next, old) {
    this.insertBefore(next, old);
    return this.removeChild(old);
  }

  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  get textContent() {
    if (this.nodeType === TEXT || this.nodeType === COMMENT) return this.nodeValue;
    return this.childNodes.map((c) => (c.nodeType === COMMENT ? '' : c.textContent)).join('');
  }

  set textContent(value) {
    if (this.nodeType === TEXT || this.nodeType === COMMENT) {
      this.nodeValue = String(value ?? '');
      return;
    }
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (value !== '' && value !== null && value !== undefined) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }

  addEventListener(type, fn, options) {
    if (typeof fn !== 'function') return;
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this._listeners.get(type) || [];
    if (!list.some((l) => l.fn === fn && l.capture === capture)) list.push({ fn, capture, once: Boolean(options?.once) });
    this._listeners.set(type, list);
  }

  removeEventListener(type, fn, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      list.filter((l) => !(l.fn === fn && l.capture === capture))
    );
  }

  _invoke(event, capture) {
    for (const l of (this._listeners.get(event.type) || []).slice()) {
      if (event._stopNow) return;
      if (l.capture !== capture) continue;
      event.currentTarget = this;
      if (l.once) this.removeEventListener(event.type, l.fn, { capture });
      l.fn.call(this, event);
    }
  }

  dispatchEvent(event) {
    event.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    event._path = path;
    for (let i = path.length - 1; i >= 0 && !event._stop; i -= 1) {
      event.eventPhase = i === 0 ? 2 : 1;
      path[i]._invoke(event, true);
    }
    for (let i = 0; i < path.length && !event._stop; i += 1) {
      if (i > 0 && !event.bubbles) break;
      event.eventPhase = i === 0 ? 2 : 3;
      path[i]._invoke(event, false);
    }
    event.currentTarget = null;
    event.eventPhase = 0;
    return !event.defaultPrevented;
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) {
    super(doc, TEXT, '#text');
    this.nodeValue = String(text);
  }

  get data() {
    return this.nodeValue;
  }

  set data(v) {
    this.nodeValue = String(v);
  }
}

class FakeComment extends FakeNode {
  constructor(doc, text) {
    super(doc, COMMENT, '#comment');
    this.nodeValue = String(text);
  }
}

function makeStyle() {
  const style = {};
  Object.defineProperties(style, {
    setProperty: { value: (name, value) => { style[name] = String(value); } },
    removeProperty: { value: (name) => { delete style[name]; } },
    getPropertyValue: { value: (name) => style[name] ?? '' },
  });
  return style;
}

// ---- selectors: tag, #id, .class, [attr], [attr="v"], :not(...), descendant and child combinators, comma lists ----------------------

function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = '';
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && sep(ch)) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function compileCompound(text) {
  const tests = [];
  const re = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:(\^|\$|\*|~)?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]|:not\(((?:[^()]|\([^()]*\))*)\)/y;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) throw new Error(`panel-dom: selector not supported: ${text}`);
    at = re.lastIndex;
    if (m[1] && m[1] !== '*') {
      const tag = m[1].toUpperCase();
      tests.push((el) => el.tagName === tag);
    } else if (m[2]) tests.push((el) => el.getAttribute('id') === m[2]);
    else if (m[3]) tests.push((el) => (el.getAttribute('class') || '').split(/\s+/).includes(m[3]));
    else if (m[4]) {
      const name = m[4].toLowerCase();
      const op = m[5] || '';
      const want = m[6] ?? m[7] ?? m[8];
      tests.push((el) => {
        if (!el.hasAttribute(name)) return false;
        if (want === undefined) return true;
        const v = el.getAttribute(name);
        if (op === '^') return v.startsWith(want);
        if (op === '$') return v.endsWith(want);
        if (op === '*') return v.includes(want);
        if (op === '~') return v.split(/\s+/).includes(want);
        return v === want;
      });
    } else if (m[9] !== undefined) {
      const inner = compileSelector(m[9]);
      tests.push((el) => !inner(el));
    }
  }
  return (el) => tests.every((t) => t(el));
}

function compileComplex(text) {
  // "a > b c": a list of [combinator, compound] from left to right (spaces and ">" inside [attr="..."] or :not(...) are not combinators)
  let spaced = '';
  let depth = 0;
  let quote = '';
  for (const ch of text.trim()) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    spaced += !quote && depth === 0 && ch === '>' ? ' > ' : ch;
  }
  const tokens = splitTop(spaced, (ch) => /\s/.test(ch)).filter(Boolean);
  const steps = [];
  let comb = ' ';
  for (const tok of tokens) {
    if (tok === '>') {
      comb = '>';
      continue;
    }
    steps.push({ comb, test: compileCompound(tok) });
    comb = ' ';
  }
  const matchFrom = (el, i) => {
    if (!steps[i].test(el)) return false;
    if (i === 0) return true;
    if (steps[i].comb === '>') return el.parentElement ? matchFrom(el.parentElement, i - 1) : false;
    for (let p = el.parentElement; p; p = p.parentElement) if (matchFrom(p, i - 1)) return true;
    return false;
  };
  return (el) => matchFrom(el, steps.length - 1);
}

function compileSelector(text) {
  const parts = splitTop(text, (ch) => ch === ',').map((s) => s.trim()).filter(Boolean).map(compileComplex);
  return (el) => parts.some((p) => p(el));
}

function descendants(node, out = []) {
  for (const c of node.childNodes) {
    if (c.nodeType === ELEMENT) {
      out.push(c);
      descendants(c, out);
    }
  }
  return out;
}

const NATIVE_FOCUS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

class FakeElement extends FakeNode {
  constructor(doc, tag, ns = HTML_NS) {
    const name = ns === HTML_NS ? tag.toUpperCase() : tag;
    super(doc, ELEMENT, name);
    this.tagName = name;
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns;
    this._attrs = new Map();
    this.style = makeStyle();
    this.scrollTop = 0;
    this.scrollLeft = 0;
  }

  getAttribute(name) {
    const v = this._attrs.get(String(name).toLowerCase());
    return v === undefined ? null : v;
  }

  setAttribute(name, value) {
    this._attrs.set(String(name).toLowerCase(), String(value));
  }

  removeAttribute(name) {
    this._attrs.delete(String(name).toLowerCase());
  }

  hasAttribute(name) {
    return this._attrs.has(String(name).toLowerCase());
  }

  setAttributeNS(_ns, name, value) {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_ns, name) {
    this.removeAttribute(name);
  }

  get attributes() {
    return [...this._attrs].map(([name, value]) => ({ name, value }));
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(v) {
    this.setAttribute('id', v);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(v) {
    this.setAttribute('class', v);
  }

  get children() {
    return this.childNodes.filter((c) => c.nodeType === ELEMENT);
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  get tabIndex() {
    const v = this.getAttribute('tabindex');
    if (v !== null && /^-?\d+$/.test(v)) return Number(v);
    return NATIVE_FOCUS.has(this.tagName) || (this.tagName === 'A' && this.hasAttribute('href')) ? 0 : -1;
  }

  get innerText() {
    return this.textContent;
  }

  get innerHTML() {
    throw new Error('panel-dom: innerHTML is not supported (the panel must never use it)');
  }

  set innerHTML(_v) {
    throw new Error('panel-dom: innerHTML is not supported (the panel must never use it)');
  }

  /** Neither this element nor an ancestor is hidden. */
  get shown() {
    if (!this.isConnected) return false;
    for (let n = this; n && n.nodeType === ELEMENT; n = n.parentNode) {
      if (n.hasAttribute('hidden') || n.style.display === 'none') return false;
    }
    return true;
  }

  get inert() {
    for (let n = this; n && n.nodeType === ELEMENT; n = n.parentNode) if (n.hasAttribute('inert')) return true;
    return false;
  }

  get focusable() {
    if (!this.shown || this.inert) return false;
    if (NATIVE_FOCUS.has(this.tagName) && this.hasAttribute('disabled')) return false;
    if (this.hasAttribute('tabindex')) return true;
    return NATIVE_FOCUS.has(this.tagName) || (this.tagName === 'A' && this.hasAttribute('href')) || this.tagName === 'SUMMARY';
  }

  getClientRects() {
    return this.shown ? [{ x: 0, y: 0, width: 10, height: 10 }] : [];
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 };
  }

  scrollIntoView() {}

  focus() {
    if (!this.focusable) return;
    this.ownerDocument._focus(this);
  }

  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument._focus(null);
  }

  click() {
    if (NATIVE_FOCUS.has(this.tagName) && this.hasAttribute('disabled')) return;
    this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
  }

  matches(selector) {
    return compileSelector(selector)(this);
  }

  closest(selector) {
    const test = compileSelector(selector);
    for (let n = this; n && n.nodeType === ELEMENT; n = n.parentNode) if (test(n)) return n;
    return null;
  }

  querySelectorAll(selector) {
    const test = compileSelector(selector);
    return descendants(this).filter(test);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeButton extends FakeElement {
  get type() {
    return this.getAttribute('type') || 'submit';
  }
}

class FakeAnchor extends FakeElement {
  get href() {
    return this.getAttribute('href') || '';
  }
}

// An input or a textarea keeps what is typed as a property (as a browser does); React reads and writes it.
class FakeInput extends FakeElement {
  constructor(doc) {
    super(doc, 'input');
    let value = null;
    let checked = false;
    Object.defineProperty(this, 'value', { get: () => (value === null ? this.getAttribute('value') ?? '' : value), set: (v) => { value = String(v ?? ''); }, configurable: true, enumerable: true });
    Object.defineProperty(this, 'checked', { get: () => checked, set: (v) => { checked = Boolean(v); }, configurable: true, enumerable: true });
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  get type() {
    return (this.getAttribute('type') || 'text').toLowerCase();
  }

  set type(v) {
    this.setAttribute('type', v);
  }

  get defaultValue() {
    return this.getAttribute('value') ?? '';
  }

  set defaultValue(v) {
    this.setAttribute('value', v);
  }

  get defaultChecked() {
    return this.hasAttribute('checked');
  }

  set defaultChecked(v) {
    if (v) this.setAttribute('checked', '');
    else this.removeAttribute('checked');
  }

  get name() {
    return this.getAttribute('name') ?? '';
  }

  set name(v) {
    this.setAttribute('name', v);
  }

  click() {
    if (this.hasAttribute('disabled')) return;
    const checkable = this.type === 'checkbox' || this.type === 'radio';
    const before = this.checked;
    if (checkable) this.checked = this.type === 'radio' ? true : !before;
    const ok = this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
    if (checkable && !ok) this.checked = before;
  }
}

class FakeTextarea extends FakeElement {
  constructor(doc) {
    super(doc, 'textarea');
    let value = null;
    Object.defineProperty(this, 'value', { get: () => (value === null ? this.textContent : value), set: (v) => { value = String(v ?? ''); }, configurable: true, enumerable: true });
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  get type() {
    return 'textarea';
  }

  get defaultValue() {
    return this.textContent;
  }

  set defaultValue(v) {
    this.textContent = v;
  }
}

class FakeOption extends FakeElement {
  constructor(doc) {
    super(doc, 'option');
    this._selected = false;
    this.defaultSelected = false;
  }

  get value() {
    return this.getAttribute('value') ?? this.textContent;
  }

  set value(v) {
    this.setAttribute('value', v);
  }

  get selected() {
    return this._selected;
  }

  set selected(v) {
    const on = Boolean(v);
    if (on) {
      const select = this.closest('select');
      if (select && !select.multiple) for (const o of select.options) o._selected = false;
    }
    this._selected = on;
  }
}

class FakeSelect extends FakeElement {
  constructor(doc) {
    super(doc, 'select');
    this.multiple = false;
    Object.defineProperty(this, 'value', {
      get: () => {
        const opts = this.options;
        const chosen = opts.find((o) => o.selected) || opts[0];
        return chosen ? chosen.value : '';
      },
      set: (v) => {
        for (const o of this.options) o._selected = o.value === String(v);
      },
      configurable: true,
      enumerable: true,
    });
  }

  get options() {
    return descendants(this).filter((n) => n.tagName === 'OPTION');
  }

  get selectedIndex() {
    return this.options.findIndex((o) => o.selected);
  }

  get type() {
    return this.multiple ? 'select-multiple' : 'select-one';
  }
}

const CLASSES = { button: FakeButton, a: FakeAnchor, input: FakeInput, textarea: FakeTextarea, select: FakeSelect, option: FakeOption };

class FakeDocument extends FakeNode {
  constructor() {
    super(null, DOCUMENT, '#document');
    this.ownerDocument = null;
    this._active = null;
    this.oninput = null; // react-dom asks `'oninput' in document` to decide how it listens to typing
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tag) {
    const Cls = CLASSES[String(tag).toLowerCase()] || FakeElement;
    return new Cls(this, String(tag).toLowerCase());
  }

  createElementNS(ns, tag) {
    return ns === HTML_NS ? this.createElement(tag) : new FakeElement(this, tag, ns);
  }

  createTextNode(text) {
    return new FakeText(this, text);
  }

  createComment(text) {
    return new FakeComment(this, text);
  }

  createDocumentFragment() {
    const f = new FakeNode(this, FRAGMENT, '#document-fragment');
    return f;
  }

  get activeElement() {
    // A focused element that left the page (its part of the panel was removed) no longer has the focus, as in a browser.
    if (this._active && (!this.documentElement.contains(this._active) || !this._active.shown)) this._active = null;
    return this._active || this.body;
  }

  _focus(el) {
    const before = this.activeElement === this.body ? null : this.activeElement;
    if (before === el) return;
    this._active = el;
    if (before) before.dispatchEvent(new FakeEvent('focusout', { bubbles: true, relatedTarget: el }));
    if (el) el.dispatchEvent(new FakeEvent('focusin', { bubbles: true, relatedTarget: before }));
  }

  getElementById(id) {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
}

class HTMLIFrameElement {}

export const document = new FakeDocument();

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
};

export const window = {
  document,
  HTMLIFrameElement,
  location: { href: 'chrome-extension://test/sidepanel.html' },
  getSelection: () => null,
};

globalThis.window = window;
globalThis.document = document;
globalThis.HTMLIFrameElement = HTMLIFrameElement;
globalThis.sessionStorage = memoryStorage();
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// React's act() queues its work through a MessageChannel when it cannot find Node's timers (it cannot inside a bundle). A real
// MessageChannel keeps Node running for ever once a port has a listener, so the test process would never end: this one posts
// through setImmediate and holds nothing open.
class ImmediateChannel {
  constructor() {
    const port1 = { onmessage: null, close() {} };
    this.port1 = port1;
    this.port2 = { postMessage: (data) => setImmediate(() => port1.onmessage?.({ data })), close() {} };
  }
}
globalThis.MessageChannel = ImmediateChannel;
