const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The page bridge is a plain script for the page's own world. Here it runs in a vm context against a very small fake DOM
// (elements with attributes, shadow roots, frames, labels, a value setter, events) so the portal behaviour can be tested
// without a browser: which box is chosen, when it refuses, how the text goes in. The real-browser proof is e2e scenario l.
const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

class FakeEl {
  constructor(doc, tag, attrs = {}, opts = {}) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.childNodes = [];
    this.shadowRoot = null;
    this.contentDocument = null;
    this.hidden = false;
    this.disabled = Boolean(opts.disabled);
    this.readOnly = Boolean(opts.readOnly);
    this.maxLength = opts.maxLength ?? -1;
    this.labels = (opts.labels || []).map((textContent) => ({ textContent }));
    this.rect = opts.rect || { width: 300, height: 60, right: 400 };
    this.style = { visibility: opts.visibility || 'visible', display: opts.display || 'block' };
    this.events = [];
    this.focused = false;
    this.parts = [];
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  querySelectorAll() {
    const out = [];
    const walk = (el) => el.children.forEach((c) => (out.push(c), walk(c)));
    walk(this);
    return out;
  }

  getClientRects() {
    return this.hidden || this.style.display === 'none' ? [] : [this.rect];
  }

  getRootNode() {
    return this.root || this.ownerDocument;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }

  focus() {
    this.focused = true;
  }

  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    this.childNodes = this.childNodes.filter((n) => n !== node);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  // contenteditable text: text nodes joined, <br> as a line break
  get innerText() {
    return this.childNodes.map((n) => (n.nodeType === 3 ? n.textContent : '\n')).join('');
  }

  get textContent() {
    return this.innerText;
  }
}

class FakeTextArea extends FakeEl {
  get value() {
    return this._value || '';
  }

  set value(v) {
    this._value = this.refuse ? this._value : String(v);
  }
}
class FakeInput extends FakeTextArea {}

function makeDom({ url = 'https://x.service-now.com/esc?id=ticket&table=incident', window: extra = {} } = {}) {
  const u = new URL(url);
  const listeners = {};
  const responses = [];
  const doc = {
    designMode: 'off',
    body: null,
    documentElement: null,
    activeElement: null,
    addEventListener: (type, fn) => (listeners[type] = fn),
    dispatchEvent: (event) => {
      responses.push(event);
      return true;
    },
    querySelector: () => null,
    getElementById: (id) => all.find((el) => el.attrs.id === id) || null,
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
    createTextNode: (t) => new FakeText(t),
    createElement: (tag) => new FakeEl(doc, tag),
    execCommand: () => false,
    querySelectorAll: () => all.filter((el) => el.top),
  };
  const all = [];
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
    }
  }
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
  sandbox.window = sandbox;
  doc.defaultView = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE, sandbox);

  let n = 0;
  const api = {
    doc,
    win: sandbox,
    /** Add a control to the page (top level, or inside `parent`'s children / shadow root). */
    add(tag, attrs = {}, opts = {}) {
      const Klass = tag === 'textarea' ? FakeTextArea : tag === 'input' ? FakeInput : FakeEl;
      const el = new Klass(doc, tag, attrs, opts);
      if (opts.value !== undefined) el._value = opts.value;
      if (opts.text) el.childNodes.push(new FakeText(opts.text));
      if (opts.hidden) el.hidden = true;
      if (opts.refuse) el.refuse = true;
      all.push(el);
      if (opts.parent) {
        opts.parent.children.push(el);
        el.root = opts.parent.shadowRoot || opts.parent.root || null;
      } else el.top = true;
      return el;
    },
    shadow(host) {
      host.shadowRoot = { querySelectorAll: () => host.shadowChildren || [], getElementById: () => null };
      host.shadowChildren = [];
      return host;
    },
    inShadow(host, el) {
      el.top = false;
      el.root = host.shadowRoot;
      host.shadowChildren.push(el);
      return el;
    },
    /** A same-origin frame holding a document with the given elements. */
    frame(attrs, bodyAttrs) {
      const inner = {
        designMode: 'off',
        defaultView: sandbox,
        createTextNode: doc.createTextNode,
        createElement: (tag) => new FakeEl(inner, tag),
        createRange: doc.createRange,
        execCommand: () => false,
        getElementById: () => null,
        querySelectorAll: () => inner.all,
        all: [],
        body: null,
      };
      inner.body = new FakeEl(inner, 'body', bodyAttrs);
      inner.all.push(inner.body);
      const f = api.add('iframe', attrs);
      f.contentDocument = inner;
      return { frame: f, inner };
    },
    call(action, args = []) {
      responses.length = 0;
      listeners['ab-page-request']({ detail: { id: `t${(n += 1)}`, action, args } });
      const detail = responses[responses.length - 1].detail;
      assert.equal(detail.ok, true, detail.error);
      // The bridge ran in another realm: a JSON copy compares cleanly with plain objects here.
      return detail.result === undefined ? undefined : JSON.parse(JSON.stringify(detail.result));
    },
    raw(action, args = [], extraDetail = {}) {
      responses.length = 0;
      listeners['ab-page-request']({ detail: { id: 'x', action, args, ...extraDetail } });
      return responses[0]?.detail;
    },
  };
  return api;
}

const COMMENT = { name: 'comments', 'ng-model': 'c.data.comment', placeholder: 'Add a comment', 'aria-label': 'Additional comments' };

// ---- Who is signed in ---------------------------------------------------------------------------------------------

test('g_user still answers first, exactly as before', () => {
  const dom = makeDom({ window: { g_user: { userName: 'beth', userID: 'a'.repeat(32), firstName: 'Beth', lastName: 'Anglin', roles: ['itil', 'x'] } } });
  assert.deepEqual(dom.call('getSessionInfo'), { userName: 'beth', userId: 'a'.repeat(32), firstName: 'Beth', lastName: 'Anglin', displayName: null, roles: ['itil', 'x'] });
});

test('no g_user: the NOW object is read (user id, user name, display name)', () => {
  const id = 'b'.repeat(32);
  const dom = makeDom({ window: { NOW: { user_id: id, user_name: 'abel', user_display_name: 'Abel Tuter', sys_id: 'c'.repeat(32), record: { name: 'x' } } } });
  const info = dom.call('getSessionInfo');
  assert.equal(info.userId, id);
  assert.equal(info.userName, 'abel');
  assert.equal(info.displayName, 'Abel Tuter');
  assert.equal(info.firstName, null);
});

test('NOW.user carries roles; the generic sys_id of NOW itself is never taken for the person', () => {
  const dom = makeDom({ window: { NOW: { sys_id: 'c'.repeat(32), user: { userID: 'd'.repeat(32), userName: 'beth', firstName: 'Beth', lastName: 'Anglin', roles: 'itil, csm_agent' } } } });
  const info = dom.call('getSessionInfo');
  assert.equal(info.userId, 'd'.repeat(32));
  assert.deepEqual(info.roles, ['itil', 'csm_agent']);
  const onlyPage = makeDom({ window: { NOW: { sys_id: 'c'.repeat(32), name: 'Some page' } } });
  assert.equal(onlyPage.call('getSessionInfo'), null);
});

test('the Angular root scope is read when nothing else has the user', () => {
  const scope = { user: { sys_id: 'e'.repeat(32), user_name: 'chuck', name: 'Chuck Tester' } };
  const injector = { has: (n) => n === '$rootScope', get: () => scope };
  const dom = makeDom({ window: { angular: { element: () => ({ injector: () => injector }) } } });
  dom.doc.documentElement = {};
  const info = dom.call('getSessionInfo');
  assert.equal(info.userId, 'e'.repeat(32));
  assert.equal(info.displayName, 'Chuck Tester');
});

test('odd values are ignored, a throwing global is survived, and nothing at all is null', () => {
  const dom = makeDom({ window: { NOW: { user_id: 'not-an-id', user_name: 42 } } });
  assert.equal(dom.call('getSessionInfo'), null);
  const throwing = makeDom({});
  Object.defineProperty(throwing.win, 'NOW', { get() { throw new Error('boom'); } });
  assert.equal(throwing.call('getSessionInfo'), null);
  assert.equal(makeDom().call('getSessionInfo'), null);
});

test('the session token also comes from NOW when g_ck is missing', () => {
  assert.equal(makeDom({ window: { g_ck: 'tok1' } }).call('getCsrfToken'), 'tok1');
  assert.equal(makeDom({ window: { NOW: { g_ck: 'tok2' } } }).call('getCsrfToken'), 'tok2');
  assert.equal(makeDom().call('getCsrfToken'), null);
});

test('the session token is also found among the default headers of the portal\'s Angular $http', () => {
  const services = { $http: { defaults: { headers: { common: { 'X-UserToken': 'tok3' } } } }, $rootScope: {} };
  const injector = { has: (n) => n in services, get: (n) => services[n] };
  const dom = makeDom({ window: { angular: { element: () => ({ injector: () => injector }) } } });
  dom.doc.documentElement = {};
  assert.equal(dom.call('getCsrfToken'), 'tok3');
  // no token header, or a service that throws: nothing, not an error
  services.$http = { defaults: { headers: { common: {} } } };
  assert.equal(dom.call('getCsrfToken'), null);
  services.$http = null;
  const odd = { has: () => true, get: () => { throw new Error('boom'); } };
  const broken = makeDom({ window: { angular: { element: () => ({ injector: () => odd }) } } });
  broken.doc.documentElement = {};
  assert.equal(broken.call('getCsrfToken'), null);
});

// ---- Insert on a portal page --------------------------------------------------------------------------------------

test('the comment box is found by name, ng-model, aria-label and placeholder, and the text is typed in', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: '' });
  const other = dom.add('textarea', { name: 'u_private_stuff', placeholder: 'Describe' }, { value: 'keep' });
  const result = dom.call('fillField', ['comments', 'Hello there', 'Additional comments', true]);
  assert.deepEqual(result, { ok: true, method: 'dom', label: 'Additional comments' }); // the box that was used is named
  assert.equal(box.value, 'Hello there');
  assert.deepEqual(box.events, ['input', 'change']); // what Angular's ngModel listens to
  assert.equal(other.value, 'keep');
  assert.deepEqual(other.events, []);
});

test('append puts the text below what is there; without append it replaces', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: 'Already typed  \n' });
  assert.equal(dom.call('fillField', ['comments', 'Reply', 'Additional comments', true]).ok, true);
  assert.equal(box.value, 'Already typed\n\nReply');
  assert.equal(dom.call('fillField', ['comments', 'Fresh', 'Additional comments', false]).ok, true);
  assert.equal(box.value, 'Fresh');
});

test('on a portal page the work-notes box is never mistaken for the comment box, nor the other way round', () => {
  const dom = makeDom();
  const comment = dom.add('textarea', COMMENT, { value: '' });
  const notes = dom.add('textarea', { name: 'work_notes', 'ng-model': 'c.data.workNotes', placeholder: 'Add a work note (internal)' }, { value: '' });
  assert.equal(dom.call('fillField', ['work_notes', 'internal text', 'Work notes', true]).ok, true);
  assert.equal(notes.value, 'internal text');
  assert.equal(comment.value, '');
  assert.equal(dom.call('fillField', ['comments', 'customer text', 'Additional comments', true]).ok, true);
  assert.equal(comment.value, 'customer text');
  assert.equal(notes.value, 'internal text');
});

test('with only a comment box, work notes are refused (never put into the customer-visible box)', () => {
  const dom = makeDom();
  const comment = dom.add('textarea', COMMENT, { value: 'x' });
  assert.deepEqual(dom.call('fillField', ['work_notes', 'internal text', 'Work notes', true]), { ok: false, reason: 'no-form' });
  assert.equal(comment.value, 'x');
  assert.deepEqual(comment.events, []);
});

test('a box that mentions internal use is not a customer comment box', () => {
  const dom = makeDom();
  dom.add('textarea', { name: 'comment', placeholder: 'Add an internal comment' }, { value: '' });
  assert.deepEqual(dom.call('fillField', ['comments', 'x', 'Additional comments', true]), { ok: false, reason: 'no-form' });
});

test('several equally good boxes: refused, nothing is written', () => {
  const dom = makeDom();
  const a = dom.add('textarea', COMMENT, { value: 'a' });
  const b = dom.add('textarea', COMMENT, { value: 'b' });
  assert.deepEqual(dom.call('fillField', ['comments', 'x', 'Additional comments', true]), { ok: false, reason: 'no-form' });
  assert.equal(a.value, 'a');
  assert.equal(b.value, 'b');
  assert.deepEqual([a.events, b.events], [[], []]);
});

test('a clearly better box wins over a weaker look-alike', () => {
  const dom = makeDom();
  const strong = dom.add('textarea', COMMENT, { value: '' });
  const weak = dom.add('textarea', { placeholder: 'Write a reply' }, { value: '' });
  assert.equal(dom.call('fillField', ['comments', 'x', 'Additional comments', true]).ok, true);
  assert.equal(strong.value, 'x');
  assert.equal(weak.value, '');
});

test('hidden boxes are ignored: display none, hidden, off-screen and one-pixel boxes', () => {
  const dom = makeDom();
  const real = dom.add('textarea', COMMENT, { value: '' });
  dom.add('textarea', COMMENT, { value: '', display: 'none' });
  dom.add('textarea', COMMENT, { value: '', hidden: true });
  dom.add('textarea', COMMENT, { value: '', visibility: 'hidden' });
  dom.add('textarea', COMMENT, { value: '', rect: { width: 300, height: 60, right: -9000 } });
  dom.add('textarea', COMMENT, { value: '', rect: { width: 1, height: 1, right: 5 } });
  assert.equal(dom.call('fillField', ['comments', 'visible only', 'Additional comments', true]).ok, true);
  assert.equal(real.value, 'visible only');
  const onlyHidden = makeDom();
  onlyHidden.add('textarea', COMMENT, { value: '', display: 'none' });
  assert.deepEqual(onlyHidden.call('fillField', ['comments', 'x', '', true]), { ok: false, reason: 'no-form' });
});

test('a disabled or read-only box is reported as read-only and left alone', () => {
  const dom = makeDom();
  const closed = dom.add('textarea', COMMENT, { value: 'closed', disabled: true });
  assert.deepEqual(dom.call('fillField', ['comments', 'x', 'Additional comments', true]), { ok: false, reason: 'read-only' });
  assert.equal(closed.value, 'closed');
  const aria = makeDom();
  aria.add('textarea', { ...COMMENT, 'aria-readonly': 'true' }, { value: '' });
  assert.equal(aria.call('fillField', ['comments', 'x', '', true]).reason, 'read-only');
  // an editable box beside a locked one is used
  const both = makeDom();
  both.add('textarea', COMMENT, { value: '', readOnly: true });
  const ok = both.add('textarea', { name: 'comments', 'aria-label': 'Comments' }, { value: '' });
  assert.equal(both.call('fillField', ['comments', 'x', '', true]).ok, true);
  assert.equal(ok.value, 'x');
});

test('too long for the box (maxlength) or for the bridge is refused', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: 'abc', maxLength: 10 });
  assert.deepEqual(dom.call('fillField', ['comments', 'this is far too long', '', true]), { ok: false, reason: 'too-long' });
  assert.equal(box.value, 'abc');
  assert.equal(dom.call('fillField', ['comments', 'x'.repeat(20001), '', true]).reason, 'too-long');
});

test('a page that puts its own value back is reported as set-failed', () => {
  const dom = makeDom();
  dom.add('textarea', COMMENT, { value: 'old', refuse: true });
  assert.deepEqual(dom.call('fillField', ['comments', 'new', '', false]), { ok: false, reason: 'set-failed' });
});

test('a box that updates on blur also gets blur and focusout', () => {
  const dom = makeDom();
  const box = dom.add('textarea', { ...COMMENT, 'ng-model-options': "{ updateOn: 'blur' }" }, { value: '' });
  assert.equal(dom.call('fillField', ['comments', 'x', '', true]).ok, true);
  assert.deepEqual(box.events, ['input', 'change', 'blur', 'focusout']);
});

test('boxes inside an open shadow root are found', () => {
  const dom = makeDom();
  const host = dom.shadow(dom.add('sp-comment-box'));
  const box = dom.inShadow(host, dom.add('textarea', { 'aria-label': 'Comments' }, { value: '' }));
  assert.equal(dom.call('fillField', ['comments', 'in the shadow', 'Additional comments', true]).ok, true);
  assert.equal(box.value, 'in the shadow');
});

test('a label element names the box', () => {
  const dom = makeDom();
  const box = dom.add('textarea', { id: 'x1' }, { value: '', labels: ['Additional comments'] });
  assert.equal(dom.call('fillField', ['comments', 'labelled', 'Additional comments', true]).ok, true);
  assert.equal(box.value, 'labelled');
});

test('a rich-text area (contenteditable) is typed into, below the existing text', () => {
  const dom = makeDom();
  const editor = dom.add('div', { contenteditable: 'true', 'aria-label': 'Comments', role: 'textbox' }, { text: 'Hello' });
  // the browser's own text insertion is used when it works
  dom.doc.execCommand = (cmd, _ui, text) => {
    editor.appendChild(new FakeText(text));
    return cmd === 'insertText';
  };
  assert.deepEqual(dom.call('fillField', ['comments', 'Reply', 'Additional comments', true]), { ok: true, method: 'dom', label: 'Comments' });
  assert.equal(editor.innerText, 'Hello\n\nReply');
  assert.ok(editor.events.includes('input') && editor.events.includes('change'));
});

test('a rich-text area falls back to plain nodes (never markup) when text insertion is refused', () => {
  const dom = makeDom();
  const editor = dom.add('div', { contenteditable: '', 'aria-label': 'Comments' }, { text: 'Hello' });
  assert.deepEqual(dom.call('fillField', ['comments', 'line one\nline two', '', true]), { ok: true, method: 'dom', label: 'Comments' });
  assert.equal(editor.innerText, 'Hello\n\nline one\nline two');
  assert.equal(editor.childNodes.filter((n) => n.tagName === 'BR').length, 3);
});

test('a rich-text editor inside a same-origin frame is found through its frame', () => {
  const dom = makeDom();
  const { inner } = dom.frame({ title: 'Additional comments editor', id: 'ed' }, { contenteditable: 'true' });
  assert.deepEqual(dom.call('fillField', ['comments', 'in a frame', 'Additional comments', false]), { ok: true, method: 'dom', label: 'Additional comments editor' });
  assert.equal(inner.body.innerText, 'in a frame');
});

test('a frame that cannot be read is skipped, not fatal', () => {
  const dom = makeDom();
  const f = dom.add('iframe', {});
  Object.defineProperty(f, 'contentDocument', { get() { throw new Error('cross-origin'); } });
  const box = dom.add('textarea', COMMENT, { value: '' });
  assert.equal(dom.call('fillField', ['comments', 'x', '', true]).ok, true);
  assert.equal(box.value, 'x');
});

test('search boxes, password boxes and unrelated boxes are never chosen', () => {
  const dom = makeDom();
  dom.add('input', { type: 'text', name: 'q', placeholder: 'Search for comments' }, { value: '' });
  dom.add('input', { type: 'password', name: 'comment_password' }, { value: '' });
  dom.add('input', { type: 'text', name: 'token_comment' }, { value: '' });
  dom.add('textarea', { name: 'u_other', placeholder: 'Describe your issue' }, { value: '' });
  assert.deepEqual(dom.call('fillField', ['comments', 'x', 'Additional comments', true]), { ok: false, reason: 'no-form' });
});

test('nothing on the page is ever clicked or submitted', () => {
  assert.ok(!/\.click\(|\.submit\(|requestSubmit|dispatchEvent\(new (Mouse|Pointer|Keyboard)/.test(BRIDGE), 'the bridge never clicks, presses keys or submits');
});

test('a classic form (g_form) still wins over the portal path', () => {
  const calls = [];
  const dom = makeDom({
    window: {
      g_form: { hasField: () => true, getValue: () => '', getEditableFields: () => ['comments'], isReadOnly: () => true, setValue: (n, v) => calls.push([n, v]) },
    },
  });
  dom.add('textarea', COMMENT, { value: '' });
  assert.deepEqual(dom.call('fillField', ['comments', 'x', '', true]), { ok: true, method: 'gform' });
  assert.deepEqual(calls, [['comments', 'x']]);
});

test('off a portal page (a workspace, no g_form) an exact label still finds the box, and the box is named in the answer', () => {
  const dom = makeDom({ url: 'https://x.service-now.com/now/sow/record/incident/' + 'a'.repeat(32) });
  const box = dom.add('textarea', { 'aria-label': 'Work notes' }, { value: 'typed' });
  assert.deepEqual(dom.call('fillField', ['work_notes', 'more', 'Work notes', true]), { ok: true, method: 'dom', label: 'Work notes' });
  assert.equal(box.value, 'typed\n\nmore');
  // CHANGED on purpose (AB-SEC-06): two equally good boxes used to mean "take the first". Now nothing is written.
  const other = dom.add('textarea', { 'aria-label': 'Work notes' }, { value: '' });
  assert.deepEqual(dom.call('fillField', ['work_notes', 'again', 'Work notes', true]), { ok: false, reason: 'no-form' });
  assert.equal(box.value, 'typed\n\nmore');
  assert.equal(other.value, '');
});

test('bad field names are refused before the page is touched', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: '' });
  for (const name of ['', 'Comments', 'a-b', 'password', 'x'.repeat(90), 42]) assert.deepEqual(dom.call('fillField', [name, 'x', '', true]), { ok: false, reason: 'bad-field' }, String(name));
  assert.deepEqual(box.events, []);
});

test('only the known actions answer', () => {
  const dom = makeDom();
  assert.equal(dom.raw('constructor').ok, false);
  assert.equal(dom.raw('eval', ['1+1']).ok, false);
});

// ---- Insert on a Workspace page (no g_form, not a portal): the stricter fallback (AB-SEC-06) -------------------------

const WORKSPACE = 'https://x.service-now.com/now/sow/record/incident/' + 'a'.repeat(32);

test('workspace: a hidden box is never written (another record tab, a collapsed panel, an off-screen box)', () => {
  const dom = makeDom({ url: WORKSPACE });
  const visible = dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: '' });
  dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: '', display: 'none' });
  dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: '', hidden: true });
  dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: '', visibility: 'hidden' });
  dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: '', rect: { width: 300, height: 60, right: -9000 } });
  assert.deepEqual(dom.call('fillField', ['comments', 'for the open record', 'Additional comments', true]), { ok: true, method: 'dom', label: 'Additional comments' });
  assert.equal(visible.value, 'for the open record');
  const onlyHidden = makeDom({ url: WORKSPACE });
  const ghost = onlyHidden.add('textarea', { 'aria-label': 'Additional comments' }, { value: '', display: 'none' });
  assert.deepEqual(onlyHidden.call('fillField', ['comments', 'x', 'Additional comments', true]), { ok: false, reason: 'no-form' });
  assert.deepEqual(ghost.events, []);
});

test('workspace: "Description" is not "Short description"', () => {
  const dom = makeDom({ url: WORKSPACE });
  const short = dom.add('input', { type: 'text', 'aria-label': 'Short description' }, { value: 'title' });
  // only the look-alike is on the page: nothing is written to it
  assert.deepEqual(dom.call('fillField', ['description', 'long text', 'Description', false]), { ok: false, reason: 'no-form' });
  assert.equal(short.value, 'title');
  assert.deepEqual(short.events, []);
  // with the real one present, the real one is used
  const real = dom.add('textarea', { 'aria-label': 'Description' }, { value: '' });
  assert.deepEqual(dom.call('fillField', ['description', 'long text', 'Description', false]), { ok: true, method: 'dom', label: 'Description' });
  assert.equal(real.value, 'long text');
  assert.equal(short.value, 'title');
});

test('workspace: an exact label wins over a label with a marker, and a marker still matches when it is alone', () => {
  const dom = makeDom({ url: WORKSPACE });
  const marked = dom.add('textarea', { 'aria-label': 'Work notes (internal)' }, { value: '' });
  assert.equal(dom.call('fillField', ['work_notes', 'a', 'Work notes', false]).ok, true, 'the marker alone matches');
  assert.equal(marked.value, 'a');
  const exact = dom.add('textarea', { 'aria-label': 'Work notes' }, { value: '' });
  assert.equal(dom.call('fillField', ['work_notes', 'b', 'Work notes', false]).label, 'Work notes');
  assert.equal(exact.value, 'b');
  assert.equal(marked.value, 'a', 'the weaker box is left alone');
  // a label that merely starts with the words is another field
  const other = makeDom({ url: WORKSPACE });
  other.add('textarea', { 'aria-label': 'Description of the change' }, { value: '' });
  assert.deepEqual(other.call('fillField', ['description', 'x', 'Description', false]), { ok: false, reason: 'no-form' });
});

test('workspace: the column name counts as exact, and two equally good boxes mean no write', () => {
  const dom = makeDom({ url: WORKSPACE });
  const box = dom.add('textarea', { name: 'incident.work_notes' }, { value: '' });
  assert.equal(dom.call('fillField', ['work_notes', 'by name', '', false]).ok, true);
  assert.equal(box.value, 'by name');
  const host = dom.shadow(dom.add('now-record'));
  const twin = dom.inShadow(host, dom.add('textarea', { name: 'work_notes' }, { value: '' }));
  assert.deepEqual(dom.call('fillField', ['work_notes', 'two', '', false]), { ok: false, reason: 'no-form' });
  assert.equal(box.value, 'by name');
  assert.equal(twin.value, '');
});

test('workspace: a locked box is read-only, a password or secret-named box is never used, and the value is read back', () => {
  const locked = makeDom({ url: WORKSPACE });
  const closed = locked.add('textarea', { 'aria-label': 'Work notes' }, { value: 'closed', disabled: true });
  assert.deepEqual(locked.call('fillField', ['work_notes', 'x', 'Work notes', true]), { ok: false, reason: 'read-only' });
  assert.equal(closed.value, 'closed');
  const secret = makeDom({ url: WORKSPACE });
  secret.add('input', { type: 'password', name: 'work_notes', 'aria-label': 'Work notes' }, { value: '' });
  secret.add('input', { type: 'text', name: 'work_notes_token', 'aria-label': 'Work notes' }, { value: '' });
  assert.deepEqual(secret.call('fillField', ['work_notes', 'x', 'Work notes', true]), { ok: false, reason: 'no-form' });
  const stubborn = makeDom({ url: WORKSPACE });
  stubborn.add('textarea', { 'aria-label': 'Work notes' }, { value: 'old', refuse: true });
  assert.deepEqual(stubborn.call('fillField', ['work_notes', 'new', 'Work notes', false]), { ok: false, reason: 'set-failed' }, 'a box that did not take the text is not inserted');
});

// ---- Insert into an HTML field with g_form (AB-SEC-01) --------------------------------------------------------------------

function gformWindow(type, initial = '') {
  const calls = [];
  const g_form = {
    hasField: () => true,
    getValue: () => initial,
    getEditableFields: () => ['text', 'short_description', 'comments'],
    isReadOnly: () => true,
    setValue: (n, v) => calls.push([n, v]),
  };
  if (type !== undefined) g_form.getGlideUIElement = () => ({ type });
  return { calls, window: { g_form } };
}

test('an HTML field gets the escaped HTML made by the content script, never the raw characters', () => {
  const { calls, window } = gformWindow('html');
  const dom = makeDom({ window });
  const raw = '<img src=x onerror=1>';
  assert.deepEqual(dom.call('fillField', ['text', raw, 'Article body', false, '<p>&lt;img src=x onerror=1&gt;</p>']), { ok: true, method: 'gform' });
  assert.deepEqual(calls, [['text', '<p>&lt;img src=x onerror=1&gt;</p>']]);
  assert.ok(!calls[0][1].includes('<img'), 'no live tag reaches the form');
});

test('an HTML field with no escaped text supplied is refused, not filled with raw text', () => {
  for (const type of ['html', 'translated_html']) {
    const { calls, window } = gformWindow(type);
    const dom = makeDom({ window });
    assert.deepEqual(dom.call('fillField', ['text', '<img src=x>', '', false]), { ok: false, reason: 'bad-field' }, type);
    assert.deepEqual(calls, [], type);
  }
});

test('append adds the escaped HTML below what the HTML field holds', () => {
  const { calls, window } = gformWindow('html', '<p>First</p>');
  const dom = makeDom({ window });
  assert.equal(dom.call('fillField', ['text', 'Second', '', true, '<p>Second</p>']).ok, true);
  assert.deepEqual(calls, [['text', '<p>First</p>\n\n<p>Second</p>']]);
});

test('a field the form says is plain text gets the plain text; a form that does not say gets the HTML', () => {
  const plain = gformWindow('string');
  assert.equal(makeDom({ window: plain.window }).call('fillField', ['text', 'a < b', '', false, '<p>a &lt; b</p>']).ok, true);
  assert.deepEqual(plain.calls, [['text', 'a < b']]);
  const unknown = gformWindow(undefined);
  assert.equal(makeDom({ window: unknown.window }).call('fillField', ['text', 'a < b', '', false, '<p>a &lt; b</p>']).ok, true);
  assert.deepEqual(unknown.calls, [['text', '<p>a &lt; b</p>']]);
  // an ordinary field with no HTML text is unchanged
  const comments = gformWindow('journal_input');
  assert.equal(makeDom({ window: comments.window }).call('fillField', ['comments', 'hello', '', false]).ok, true);
  assert.deepEqual(comments.calls, [['comments', 'hello']]);
});

// ---- Round 3 (F5): no second copy after "Try again", and the check before the click ----------------------------------

test('portal and workspace: the earlier insert is swapped for the new one when the box still holds it as a whole block', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: 'Typed by me' });
  assert.equal(dom.call('fillField', ['comments', 'Reply one', 'Additional comments', true]).ok, true);
  assert.equal(box.value, 'Typed by me\n\nReply one');
  assert.equal(dom.call('fillField', ['comments', 'Reply two', 'Additional comments', true, '', 'Reply one']).ok, true);
  assert.equal(box.value, 'Typed by me\n\nReply two');
  // edited by the person: theirs now, the new text goes below
  box._value = 'Typed by me\n\nReply two, and more';
  assert.equal(dom.call('fillField', ['comments', 'Reply three', 'Additional comments', true, '', 'Reply two']).ok, true);
  assert.equal(box.value, 'Typed by me\n\nReply two, and more\n\nReply three');
  const ws = makeDom({ url: WORKSPACE });
  const notes = ws.add('textarea', { 'aria-label': 'Work notes' }, { value: 'Note A' });
  assert.equal(ws.call('fillField', ['work_notes', 'Note B', 'Work notes', true, '', 'Note A']).ok, true);
  assert.equal(notes.value, 'Note B');
});

test('a g_form field swaps the earlier insert too; with HTML or without append the earlier text is ignored', () => {
  const calls = [];
  const g_form = { hasField: () => true, getValue: () => 'Mine\n\nOld answer', getEditableFields: () => ['work_notes', 'text'], isReadOnly: () => true, setValue: (n, v) => calls.push([n, v]) };
  const dom = makeDom({ window: { g_form } });
  assert.equal(dom.call('fillField', ['work_notes', 'New answer', '', true, '', 'Old answer']).ok, true);
  assert.equal(dom.call('fillField', ['work_notes', 'Replaced', '', false, '', 'Old answer']).ok, true);
  assert.deepEqual(calls, [['work_notes', 'Mine\n\nNew answer'], ['work_notes', 'Replaced']]);
});

test('getFieldStates reads and never writes: a portal names the box an insert would use; a hidden or missing one is unknown', () => {
  const dom = makeDom();
  const box = dom.add('textarea', COMMENT, { value: 'typed' });
  dom.add('textarea', { name: 'work_notes', 'aria-label': 'Work notes' }, { value: '', readOnly: true });
  const out = dom.call('getFieldStates', [['comments', 'work_notes', 'close_notes'], ['Additional comments', 'Work notes', 'Resolution notes']]);
  assert.deepEqual(out, { form: 'portal', fields: { comments: 'editable', work_notes: 'read-only', close_notes: 'unknown' }, boxes: { comments: 'Additional comments' } });
  assert.equal(box.value, 'typed');
  assert.deepEqual(box.events, []);
  assert.equal(box.focused, false);
  const ws = makeDom({ url: WORKSPACE });
  ws.add('textarea', { 'aria-label': 'Resolution notes' }, { value: '' });
  assert.deepEqual(ws.call('getFieldStates', [['close_notes'], ['Resolution notes']]), { form: 'workspace', fields: { close_notes: 'editable' }, boxes: { close_notes: 'Resolution notes' } });
  assert.equal(ws.call('getFieldStates', ['comments']), null, 'names must be a list');
});

// ---- N4: the notes typed in a Workspace page's boxes (getBoxValues, READ ONLY) ----------------------------------------------

const NOTE_NAMES = ['close_notes', 'work_notes', 'comments'];
const NOTE_LABELS = ['Resolution notes', 'Work notes', 'Additional comments'];

test('getBoxValues: on a Workspace page each named box is found as an insert finds it, and only its text is read', () => {
  const dom = makeDom({ url: WORKSPACE });
  const host = dom.shadow(dom.add('now-record-form'));
  const notes = dom.inShadow(host, dom.add('textarea', { 'aria-label': 'Resolution notes' }, { value: 'Restarted the gateway' }));
  const work = dom.add('textarea', { name: 'incident.work_notes' }, { value: 'internal' });
  const editor = dom.add('div', { contenteditable: 'true', 'aria-label': 'Additional comments' }, { text: 'Hello' });
  assert.deepEqual(dom.call('getBoxValues', [NOTE_NAMES, NOTE_LABELS]), { close_notes: 'Restarted the gateway', work_notes: 'internal', comments: 'Hello' });
  // nothing was focused, typed or fired, and nothing changed
  for (const el of [notes, work, editor]) {
    assert.deepEqual(el.events, []);
    assert.equal(el.focused, false);
  }
  assert.deepEqual([notes.value, work.value, editor.innerText], ['Restarted the gateway', 'internal', 'Hello']);
  // an empty box is read as empty (the notes were cleared), not left out
  const blank = makeDom({ url: WORKSPACE });
  blank.add('textarea', { 'aria-label': 'Close notes' }, { value: '' });
  assert.deepEqual(blank.call('getBoxValues', [['close_notes'], ['Close notes']]), { close_notes: '' });
});

test('getBoxValues: a box that is missing, hidden, locked or one of two look-alikes is left out, never guessed', () => {
  const dom = makeDom({ url: WORKSPACE });
  const one = dom.add('textarea', { 'aria-label': 'Work notes' }, { value: 'one' });
  const two = dom.add('textarea', { 'aria-label': 'Work notes' }, { value: 'two' });
  dom.add('textarea', { 'aria-label': 'Additional comments' }, { value: 'hidden text', display: 'none' });
  dom.add('textarea', { 'aria-label': 'Resolution notes' }, { value: 'locked', disabled: true });
  dom.add('input', { type: 'text', 'aria-label': 'Short description' }, { value: 'title' });
  assert.deepEqual(dom.call('getBoxValues', [[...NOTE_NAMES, 'description'], [...NOTE_LABELS, 'Description']]), {});
  assert.deepEqual([one.events, two.events], [[], []]);
  // "Resolution notes" is not "Resolution notes summary"; a label with a marker is still the box
  const near = makeDom({ url: WORKSPACE });
  near.add('textarea', { 'aria-label': 'Resolution notes summary' }, { value: 'other field' });
  assert.deepEqual(near.call('getBoxValues', [['close_notes'], ['Resolution notes']]), {});
  near.add('textarea', { 'aria-label': 'Resolution notes (visible to the customer)' }, { value: 'the notes' });
  assert.deepEqual(near.call('getBoxValues', [['close_notes'], ['Resolution notes']]), { close_notes: 'the notes' });
});

test('getBoxValues: plain non-secret names only, at most eight; long text is cut; g_form pages and portal pages answer null', () => {
  const dom = makeDom({ url: WORKSPACE });
  dom.add('textarea', { name: 'close_notes' }, { value: 'x'.repeat(25000) });
  dom.add('textarea', { name: 'u_api_key', 'aria-label': 'Key' }, { value: 'sk-secret' });
  dom.add('input', { type: 'password', name: 'u_pass' }, { value: 'hunter2' });
  const out = dom.call('getBoxValues', [['close_notes', 'u_api_key', 'u_pass', 'Close Notes', '__proto__', 42], ['', 'Key', '', '', '', '']]);
  assert.deepEqual(Object.keys(out), ['close_notes']);
  assert.equal(out.close_notes.length, 20000);
  assert.equal(dom.call('getBoxValues', ['close_notes']), null, 'names must be a list');
  const many = makeDom({ url: WORKSPACE });
  many.add('textarea', { name: 'close_notes' }, { value: 'ninth' });
  assert.deepEqual(many.call('getBoxValues', [['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'close_notes'], []]), {}, 'the ninth name is not looked at');
  // a form with g_form answers through getFormValues; a portal page has no resolution notes of a ticket the agent works
  const classic = makeDom({ url: WORKSPACE, window: { g_form: { getValue: () => 'x' } } });
  classic.add('textarea', { name: 'close_notes' }, { value: 'typed' });
  assert.equal(classic.call('getBoxValues', [['close_notes'], ['Resolution notes']]), null);
  const portal = makeDom();
  portal.add('textarea', COMMENT, { value: 'typed' });
  assert.equal(portal.call('getBoxValues', [['comments'], ['Additional comments']]), null);
});

test('getBoxValues and the reader it uses never focus, type, set or fire anything (read only by construction)', () => {
  const reader = BRIDGE.slice(BRIDGE.indexOf('function boxText('), BRIDGE.indexOf('var actions = {'));
  const action = BRIDGE.slice(BRIDGE.indexOf('getBoxValues: function'), BRIDGE.indexOf('getBoxValues: function') + 1500).split('\n    },')[0];
  assert.ok(reader.length > 100 && action.length > 100);
  for (const code of [reader, action]) {
    assert.ok(!/focus\(|fireEvent|dispatchEvent|setControlValue|writeInto|writeEditable|execCommand|\.value\s*=[^=]|appendChild|removeChild/.test(code), code.slice(0, 80));
  }
});
