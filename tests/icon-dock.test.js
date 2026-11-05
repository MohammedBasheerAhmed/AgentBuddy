import test from 'node:test';
import assert from 'node:assert/strict';
import { MARK, PATHS, SPARK } from '../src/sidepanel/ui/iconPaths.js';
import { featureIcon, screenIcon } from '../src/sidepanel/ui/featureIcons.js';
import { SCREENS } from '../src/profiles/profiles.js';
import { FEATURES } from '../src/features/registry.js';
import { QUICK_CARDS, QUICK_LABELS } from '../src/features/quick.js';

// The icon dock on the ServiceNow page (src/content/bar.js) and the icon dock at the bottom of the panel (src/sidepanel/App.jsx) draw the
// same icons from one table (iconPaths.js); the name an icon has is looked up by id (featureIcons.js).

const drawn = (name) => name === 'spark' || typeof PATHS[name] === 'string';

test('every screen of the panel has its own icon, and the icon is in the set', () => {
  const names = SCREENS.map((s) => screenIcon(s.id));
  assert.equal(SCREENS.length, 5);
  for (const [i, name] of names.entries()) {
    assert.notEqual(name, 'spark', `${SCREENS[i].id} has an icon of its own`);
    assert.ok(drawn(name), `${SCREENS[i].id}: ${name} can be drawn`);
  }
  assert.equal(new Set(names).size, names.length, 'no two screens share an icon');
  assert.equal(screenIcon('something-new'), 'spark', 'a screen this table does not know gets the spark, not nothing');
});

test('every action and card the page dock can offer has an icon that can be drawn', () => {
  const ids = new Set([...Object.keys(QUICK_LABELS), ...Object.keys(QUICK_CARDS), ...FEATURES.map((f) => f.id)]);
  assert.ok(ids.size > 20);
  for (const id of ids) assert.ok(drawn(featureIcon(id)), `${id}: ${featureIcon(id)} can be drawn`);
  for (const id of Object.keys(QUICK_LABELS)) assert.notEqual(featureIcon(id), 'spark', `${id} has an icon of its own`);
});

test('the icon data is plain strings (the page script draws them with DOM calls: nothing is loaded)', () => {
  for (const [name, d] of Object.entries(PATHS)) {
    assert.equal(typeof d, 'string', name);
    assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/, `${name} is path data and nothing else`);
  }
  assert.match(SPARK, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
  assert.deepEqual(Object.keys(MARK), ['tile', 'bubble', 'tick']);
  for (const d of Object.values(MARK)) assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,-]+$/);
});

test('the panel draws its bar of screens from the same table, after the screens, each icon with its name under it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const app = read('src', 'sidepanel', 'App.jsx');
  assert.ok(app.indexOf('<main className="ab-main">') < app.indexOf('<ScreenTabs '), 'in the page as on the screen: after the screens');
  assert.ok(app.indexOf('<SideRail') < app.indexOf('<ScreenTabs '), 'the side rail comes before the bar, beside the screens');
  assert.match(app, /<span className="ab-screen-name">\{s\.label\}<\/span>/, 'the name is drawn, so it is also the button\'s name');
  assert.match(app, /aria-selected=\{s\.id === value\}/);
  const icons = read('src', 'sidepanel', 'ui', 'icons.jsx');
  assert.match(icons, /from '\.\/iconPaths\.js'/, 'the panel and the page dock share one table');
  const bar = read('src', 'content', 'bar.js');
  assert.match(bar, /from '\.\.\/sidepanel\/ui\/iconPaths\.js'/);
  assert.ok(!/from 'react'|\.jsx'/.test(bar), 'the page script does not pull in React or the panel\'s components');
  const css = read('src', 'ui', 'areas', 'shell.css');
  assert.match(css, /\.ab-screens \{[^}]*position: sticky;[^}]*bottom: 0/, 'it sticks to the bottom edge');
  assert.ok(!/ab-screen-tab::after/.test(css), 'no floating name: the name is drawn under the icon');
  assert.match(css, /\.ab-rail \{[^}]*position: sticky;[^}]*top: var\(--ab-head-h/, 'the rail sticks under the header');
  assert.ok(/\.ab-sr \{/.test(css));
});
