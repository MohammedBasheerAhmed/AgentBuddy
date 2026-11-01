import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HalfPanel, HalfSwitch } from '../src/sidepanel/ui/primitives.jsx';

globalThis.React = React;

// The Insights / AI Assist switch and its panels (found by the accessibility audit, e2e scenario zz): a panel is a tab panel only
// where the switch that names it is on screen, and the selected tab still shows where the keyboard focus is.

const panel = (props) => renderToStaticMarkup(React.createElement(HalfPanel, { idBase: 'x-half', half: 'insights', ...props }, 'content'));

test('with a switch, the panel is a tab panel named by its tab', () => {
  assert.match(panel({}), /<div id="x-half-panel-insights" role="tabpanel" aria-labelledby="x-half-tab-insights" class="ab-pane">content<\/div>/);
});

test('without a switch (one half, or AI switched off) the panel is a plain pane: no tab panel named by a tab that is not there', () => {
  const markup = panel({ switched: false });
  assert.match(markup, /<div id="x-half-panel-insights" class="ab-pane">content<\/div>/);
  assert.doesNotMatch(markup, /role=|aria-labelledby/);
});

test('every tab panel the switch controls exists under the id the tab points to', () => {
  const tabs = renderToStaticMarkup(React.createElement(HalfSwitch, { idBase: 'x-half', value: 'insights', onChange() {} }));
  assert.match(tabs, /id="x-half-tab-insights"[^>]*aria-controls="x-half-panel-insights"/);
  assert.match(tabs, /id="x-half-tab-assist"[^>]*aria-controls="x-half-panel-assist"/);
});

test('the selected tab keeps the focus ring: its own shadow does not win over :focus-visible', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'areas', 'shell.css'), 'utf8');
  assert.match(css, /\.ab-halfswitch-tab\.is-on:focus-visible\s*\{[^}]*box-shadow:\s*var\(--ab-ring\)/);
});
