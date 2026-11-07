import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { portalInfo, surfaceOf } from '../src/context/surface.js';

// S11 of the 2026-11-07 audit: surfaceOf('/now/nav/ui/home') said 'workspace' while three test files built their pages with
// surface 'classic' for that very address, so those tests proved a state the product never produced.
//
// Decision: the Next Experience SHELL (/now/nav/ui/..., its home and the frame around the classic form) is 'classic'. Nothing about
// it behaves like a Workspace: a record opens through nav_to.do, a form is saved with Save (not Post), and the Save counter that only
// a Workspace needs (src/content/index.js) stays off. A Workspace is a page with its own /now/<workspace>/ route (sow, cwf, ...).

const HOST = 'https://acme.service-now.com';
const ID = 'b'.repeat(32);

test('S11: the Next Experience shell is classic: its home, its classic frame, and anything under /now/nav/ui', () => {
  for (const url of [
    `${HOST}/now/nav/ui/home`,
    `${HOST}/now/nav/ui/home?x=1#y`,
    `${HOST}/now/nav/ui/`,
    `${HOST}/now/nav/ui`,
    `${HOST}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ID}`,
    `${HOST}/now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dactive%3Dtrue`,
    `${HOST}/NOW/NAV/UI/home`,
  ]) {
    assert.equal(surfaceOf(url), 'classic', url);
  }
});

test('S11: a Workspace is still a Workspace, and a path that only looks like the shell is not one', () => {
  for (const url of [
    `${HOST}/now/sow/home`,
    `${HOST}/now/sow/list/params/list-id/incident`,
    `${HOST}/now/sow/record/incident/${ID}`,
    `${HOST}/now/workspace/agent/home`,
    `${HOST}/now/cwf/agent/record/sn_customerservice_case/${ID}`,
    `${HOST}/now/hr-agent-workspace/home`,
    `${HOST}/now/navigator/home`, // starts like "nav" but is not the shell
    `${HOST}/now/nav/other`,
  ]) {
    assert.equal(surfaceOf(url), 'workspace', url);
  }
  assert.equal(surfaceOf(`${HOST}/`), 'other');
  assert.equal(surfaceOf(`${HOST}/sp?id=index`), 'portal');
  assert.equal(portalInfo(`${HOST}/now/nav/ui/home`), null, 'the shell is not a portal');
});

test('S11: the test pages that say classic for the shell home are what the product produces', () => {
  // Every fixture that uses the shell home as a page says surface 'classic'; the address is what production would see.
  const fixtures = ['mywork-view.test.js', 'screens-rail.test.js', 'reports-links-ui.test.js'];
  for (const file of fixtures) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'tests', file), 'utf8');
    const lines = source.split('\n').filter((line) => line.includes('/now/nav/ui/home') && /surface:/.test(line));
    assert.ok(lines.length >= 1, `${file} has a page at the shell home`);
    for (const line of lines) {
      const says = /surface:\s*'([a-z]+)'/.exec(line)?.[1];
      assert.equal(says, surfaceOf(`${HOST}/now/nav/ui/home`), `${file}: ${line.trim().slice(0, 100)}`);
    }
  }
});
