const test = require('node:test');
const assert = require('node:assert/strict');
import { surfaceOf } from '../src/context/surface.js';

test('classic, workspace, portal and other pages are told apart by address', () => {
  const classic = ['https://x.service-now.com/incident.do?sys_id=' + 'a'.repeat(32), 'https://x.service-now.com/nav_to.do?uri=incident.do', 'https://x.service-now.com/now/nav/ui/classic/params/target/incident.do'];
  for (const u of classic) assert.equal(surfaceOf(u), 'classic', u);
  const workspace = ['https://x.service-now.com/now/sow/record/incident/' + 'b'.repeat(32), 'https://x.service-now.com/now/workspace/agent/record/sn_customerservice_case/' + 'c'.repeat(32)];
  for (const u of workspace) assert.equal(surfaceOf(u), 'workspace', u);
  const portal = ['https://x.service-now.com/sp?id=ticket&table=incident&sys_id=' + 'd'.repeat(32), 'https://x.service-now.com/esc?id=ticket&table=sc_req_item&sys_id=x', 'https://x.service-now.com/csm?id=csm_ticket', 'https://x.service-now.com/hrsp?id=hr_ticket'];
  for (const u of portal) assert.equal(surfaceOf(u), 'portal', u);
  for (const u of ['', 'not a url', 'https://x.service-now.com/', 'https://x.service-now.com/login.do']) {
    assert.ok(['other', 'classic'].includes(surfaceOf(u)), u);
  }
  assert.equal(surfaceOf('https://x.service-now.com/'), 'other');
});
