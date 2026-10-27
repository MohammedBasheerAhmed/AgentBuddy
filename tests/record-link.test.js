import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordLink from '../src/sidepanel/RecordLink.jsx';
import DataTable from '../src/sidepanel/charts/DataTable.jsx';
import { isPlainClick } from '../src/sidepanel/linkClick.js';

globalThis.React = React;

const SYS = 'a'.repeat(32);
const classic = { href: 'https://acme.service-now.com/incident.do?sys_id=' + SYS, surface: 'classic', tabId: 1 };
const portal = { href: 'https://acme.service-now.com/sp?id=ticket&table=incident&sys_id=' + SYS, surface: 'portal', portal: { base: '/sp', pageId: 'ticket' }, tabId: 1 };

test('isPlainClick: only an unmodified left click is the panel\'s own; the rest is the browser\'s (new tab)', () => {
  assert.equal(isPlainClick({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), true);
  assert.equal(isPlainClick({ button: 0, ctrlKey: true }), false, 'Ctrl+click');
  assert.equal(isPlainClick({ button: 0, metaKey: true }), false, 'Cmd+click');
  assert.equal(isPlainClick({ button: 0, shiftKey: true }), false, 'Shift+click');
  assert.equal(isPlainClick({ button: 1 }), false, 'middle button');
});

test('RecordLink: a real link to the record on the same instance, opening a new tab for Ctrl+click and the context menu', () => {
  const html = renderToStaticMarkup(<RecordLink page={classic} item={{ table: 'incident', sysId: SYS }} className="ab-feature">INC1</RecordLink>);
  assert.match(html, /^<a /);
  assert.ok(html.includes(`href="https://acme.service-now.com/nav_to.do?uri=incident.do%3Fsys_id%3D${SYS}"`), html);
  assert.ok(html.includes('target="_blank"'));
  assert.ok(/rel="noopener noreferrer"/.test(html), 'the new tab gets no handle on the panel');
  assert.ok(html.includes('class="ab-feature"'));
  assert.ok(/Ctrl\+click/.test(html), 'the title says how to open a new tab');
});

test('RecordLink: on a portal the address is the portal ticket page of the same instance', () => {
  const html = renderToStaticMarkup(<RecordLink page={portal} item={{ table: 'incident', sysId: SYS }}>INC1</RecordLink>);
  assert.ok(html.includes(`href="https://acme.service-now.com/sp?id=ticket&amp;table=incident&amp;sys_id=${SYS}"`), html);
});

test('RecordLink: an address that cannot be built safely is plain text, not a link', () => {
  const bad = renderToStaticMarkup(<RecordLink page={classic} item={{ table: 'incident;drop', sysId: 'nope' }}>INC1</RecordLink>);
  assert.ok(!bad.includes('<a '), bad);
  assert.ok(bad.includes('INC1'));
  const none = renderToStaticMarkup(<RecordLink page={{ href: 'not a url' }} item={{ table: 'incident', sysId: SYS }}>INC1</RecordLink>);
  assert.ok(!none.includes('<a '), none);
});

test('DataTable: with rowHref the first cell is a real link; without it (or with an empty address) it stays a button', () => {
  const cols = [{ key: 'number', label: 'Number' }, { key: 'title', label: 'Title' }];
  const rows = [{ key: 'r1', number: 'INC1', title: 'One', table: 'incident', sysId: SYS }, { key: 'r2', number: 'INC2', title: 'Two' }];
  const html = renderToStaticMarkup(
    <DataTable columns={cols} rows={rows} onRowOpen={() => {}} rowHref={(row) => (row.table ? `https://acme.service-now.com/nav_to.do?uri=x${row.number}` : '')} />
  );
  assert.ok(html.includes('<a class="ab-chart-link" href="https://acme.service-now.com/nav_to.do?uri=xINC1" target="_blank" rel="noopener noreferrer" data-ab-link="record"'), html);
  assert.ok(html.includes('<button type="button" class="ab-chart-link">INC2</button>'), 'a row with no address stays a button');
  const plain = renderToStaticMarkup(<DataTable columns={cols} rows={rows} onRowOpen={() => {}} />);
  assert.ok(!plain.includes('<a '), 'no rowHref: unchanged');
});
