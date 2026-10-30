import { mount, click, type, choose, press, focused, makeChrome, settle } from './fixtures/panel-dom.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { useEffect, useRef, useState } from 'react';

// The small DOM the view tests run on (tests/fixtures/panel-dom.js) must behave like a browser where the views rely on it: clicks
// reach React, typed text and choices come back through onChange, a disabled button cannot be pressed, hidden parts are not "shown",
// and the focus follows .focus() and leaves an element that is removed. If one of these broke, the view tests would prove nothing.

function Sample() {
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('b');
  const [on, setOn] = useState(false);
  const [keys, setKeys] = useState([]);
  const [show, setShow] = useState(true);
  const heading = useRef(null);
  useEffect(() => {
    if (n === 2) heading.current?.focus();
  }, [n]);
  return (
    <div onKeyDown={(e) => setKeys((k) => [...k, e.key])}>
      <h2 ref={heading} tabIndex={-1}>Count {n}</h2>
      <button type="button" onClick={() => setN((x) => x + 1)}>Add</button>
      <button type="button" disabled onClick={() => setN(100)}>Off</button>
      <label htmlFor="t">Name</label>
      <input id="t" value={text} onChange={(e) => setText(e.target.value)} />
      <textarea aria-label="Notes" value={text.toUpperCase()} onChange={(e) => setText(e.target.value.toLowerCase())} />
      <select aria-label="Pick" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
      <label className="ab-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> Tick</label>
      <p>{`text=${text} pick=${pick} on=${on} keys=${keys.join(',')}`}</p>
      <div hidden><button type="button">Hidden</button></div>
      {show && <button type="button" onClick={() => setShow(false)}>Go away</button>}
    </div>
  );
}

test('the harness: clicks, typing, choices, checkboxes, keys, hidden parts and focus behave like a browser', async () => {
  globalThis.chrome = makeChrome().chrome;
  const ui = await mount(<Sample />);
  assert.equal(ui.errors.length, 0, ui.errors.join('\n'));
  await click(ui.button('Add'));
  assert.match(ui.text(), /Count 1/);
  await click(ui.button('Off', { all: true }));
  assert.match(ui.text(), /Count 1/, 'a disabled button cannot be pressed');
  await type(ui.field('Name'), 'Abel');
  assert.match(ui.text(), /text=Abel/);
  assert.equal(ui.$('textarea').value, 'ABEL', 'a controlled value is written back');
  await choose(ui.$('select'), 'a');
  assert.match(ui.text(), /pick=a/);
  assert.equal(ui.$('select').value, 'a');
  await click(ui.$('input[type="checkbox"]'));
  assert.match(ui.text(), /on=true/);
  assert.equal(ui.$('input[type="checkbox"]').checked, true);
  await press(ui.$('button'), 'ArrowRight');
  assert.match(ui.text(), /keys=ArrowRight/);
  assert.equal(ui.hasButton('Hidden'), false, 'a button in a hidden part is not shown');
  assert.ok(ui.button('Hidden', { all: true }));
  await click(ui.button('Add'));
  assert.equal(focused(), ui.$('h2'), 'focus() on an element with tabIndex -1 moves the focus');
  const away = ui.button('Go away');
  away.focus();
  assert.equal(focused(), away);
  await click(away);
  assert.equal(focused().tagName, 'BODY', 'an element that is removed loses the focus');
  await settle();
  await ui.unmount();
});
