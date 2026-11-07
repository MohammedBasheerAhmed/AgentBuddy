const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// S7 of the 2026-11-07 audit: the page bridge took the FIRST of up to 20 child frames that had a g_form as "the form", so a hidden
// widget or preview frame on a home page made the panel believe in a record. The top window and gsft_main are trusted as before; any
// other child frame is the form only when it is on screen and form-sized, or holds the record the address names.

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'page', 'bridge.js'), 'utf8');
const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OTHER = 'b2c3d4e5f60718293a4b5c6d7e8f90a1';

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }

  stopImmediatePropagation() {}
}

/** A g_form that answers for one record. */
const gForm = (table, sysId, number = '') => ({
  getValue: (name) => (name === 'number' ? number : ''),
  getTableName: () => table,
  getUniqueValue: () => sysId,
  isNewRecord: () => false,
});

/** A child frame: a window with a g_form (or none) and the iframe element it sits in (null: a frame the page cannot reach into). */
const frame = ({ form = null, box = { width: 800, height: 600 }, element = true, style = null } = {}) => ({
  g_form: form || undefined,
  frameElement: element ? { getBoundingClientRect: () => box, __style: style } : null,
});

/** The bridge on a page with `frames` as its child frames, `top` as its own g_form and `href` as its address. */
function pageWith({ frames = [], named = {}, top = null, href = 'https://dev364920.service-now.com/now/nav/ui/home', computedStyle = true } = {}) {
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
  const list = [...frames];
  Object.assign(list, named);
  const sandbox = { document: doc, CustomEvent: FakeEvent, location: { href, pathname: new URL(href).pathname, search: '', hash: '' }, frames: list };
  if (top) sandbox.g_form = top;
  if (computedStyle) sandbox.getComputedStyle = (element) => element.__style || { display: 'block', visibility: 'visible' };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE, sandbox);
  let n = 0;
  return {
    meta() {
      const answers = [];
      doc.addEventListener('ab-page-response', (event) => answers.push(JSON.parse(JSON.stringify(event.detail))));
      doc.dispatchEvent(new FakeEvent('ab-page-request', { detail: { id: `r${(n += 1)}`, action: 'getFormMeta', args: [] } }));
      assert.equal(answers.length, 1);
      assert.equal(answers[0].ok, true, answers[0].error);
      return answers[0].result;
    },
  };
}

test('no form anywhere: no record', () => {
  assert.equal(pageWith().meta(), null);
});

test('the top window\'s g_form comes first, then gsft_main; neither needs to be on screen', () => {
  const widget = frame({ form: gForm('sys_user', OTHER, 'X1') });
  assert.equal(pageWith({ top: gForm('incident', ID, 'INC0010001'), frames: [widget] }).meta().table, 'incident');
  const hiddenMain = frame({ form: gForm('incident', ID, 'INC0010001'), element: false });
  const meta = pageWith({ named: { gsft_main: hiddenMain }, frames: [widget] }).meta();
  assert.deepEqual([meta.table, meta.sysId, meta.number], ['incident', ID, 'INC0010001']);
});

test('S7: a hidden, small or unreachable child frame with a g_form of its own is not the form', () => {
  const form = gForm('ui_page', OTHER);
  const cases = {
    'a frame with no size (display: none)': frame({ form, box: { width: 0, height: 0 } }),
    'a tracking pixel': frame({ form, box: { width: 1, height: 1 } }),
    'a narrow widget': frame({ form, box: { width: 299, height: 600 } }),
    'a short strip': frame({ form, box: { width: 800, height: 199 } }),
    'a frame the page cannot reach into': frame({ form, element: false }),
    'hidden by display': frame({ form, style: { display: 'none', visibility: 'visible' } }),
    'hidden by visibility': frame({ form, style: { display: 'block', visibility: 'hidden' } }),
    'a box with no numbers': { g_form: form, frameElement: { getBoundingClientRect: () => ({}) } },
    'an element that cannot be measured': { g_form: form, frameElement: {} },
  };
  for (const [name, child] of Object.entries(cases)) assert.equal(pageWith({ frames: [child] }).meta(), null, name);
  // the first frame is hidden, the second is the real form: the second is found (it was never the first before either)
  const real = frame({ form: gForm('incident', ID, 'INC0010001') });
  assert.equal(pageWith({ frames: [cases['a tracking pixel'], real] }).meta().table, 'incident');
});

test('S7: a child frame on screen and form-sized is the form (a classic form inside a Workspace or a shell)', () => {
  for (const box of [{ width: 300, height: 200 }, { width: 1200, height: 900 }]) {
    const meta = pageWith({ frames: [frame({ form: gForm('incident', ID, 'INC0010001'), box })] }).meta();
    assert.deepEqual([meta.table, meta.sysId], ['incident', ID], JSON.stringify(box));
  }
  // where the page cannot measure at all (no getComputedStyle), the size decides
  assert.equal(pageWith({ computedStyle: false, frames: [frame({ form: gForm('incident', ID) })] }).meta().table, 'incident');
});

test('S7: a frame that is not on screen still counts when it holds the very record the address names', () => {
  const small = { width: 1, height: 1 };
  const href = `https://dev364920.service-now.com/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}`;
  assert.equal(pageWith({ href, frames: [frame({ form: gForm('incident', ID, 'INC0010001'), box: small })] }).meta().table, 'incident');
  assert.equal(pageWith({ href, frames: [frame({ form: gForm('incident', ID.toUpperCase(), 'INC0010001'), box: small, element: false })] }).meta().table, 'incident');
  // another record than the address names: no
  assert.equal(pageWith({ href, frames: [frame({ form: gForm('incident', OTHER, 'INC0010002'), box: small })] }).meta(), null);
  // a form that cannot say its record (g_form without getUniqueValue) is not matched, and does not break the search
  const odd = { g_form: { getValue: () => '' }, frameElement: null };
  assert.equal(pageWith({ href, frames: [odd] }).meta(), null);
});

test('a frame that throws when it is touched (another origin) is skipped; the search goes on', () => {
  const foreign = {};
  Object.defineProperty(foreign, 'g_form', {
    get() {
      throw new Error('Blocked a frame with origin from accessing a cross-origin frame.');
    },
  });
  const real = frame({ form: gForm('problem', ID, 'PRB0040001') });
  assert.equal(pageWith({ frames: [foreign, real] }).meta().table, 'problem');
  const broken = { g_form: gForm('problem', ID), get frameElement() { throw new Error('cross-origin'); } };
  assert.equal(pageWith({ frames: [broken] }).meta(), null);
});

test('only the first twenty child frames are looked at', () => {
  const hidden = Array.from({ length: 20 }, () => frame({ box: { width: 0, height: 0 } }));
  const real = frame({ form: gForm('incident', ID, 'INC0010001') });
  assert.equal(pageWith({ frames: [...hidden, real] }).meta(), null);
});
