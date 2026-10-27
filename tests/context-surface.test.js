const test = require('node:test');
const assert = require('node:assert/strict');
import { portalInfo, surfaceOf } from '../src/context/surface.js';

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

const HOST = 'https://x.service-now.com';

test('portalInfo gives the portal suffix and the page id, lower case', () => {
  assert.deepEqual(portalInfo(`${HOST}/esc?id=ticket&table=incident&sys_id=${'a'.repeat(32)}`), { base: '/esc', pageId: 'ticket' });
  assert.deepEqual(portalInfo(`${HOST}/sp?id=kb_article_view&sysparm_article=KB0010001`), { base: '/sp', pageId: 'kb_article_view' });
  assert.deepEqual(portalInfo(`${HOST}/csm?id=csm_ticket`), { base: '/csm', pageId: 'csm_ticket' });
  assert.deepEqual(portalInfo(`${HOST}/hrsp?id=hr_ticket`), { base: '/hrsp', pageId: 'hr_ticket' });
  assert.deepEqual(portalInfo(`${HOST}/csp/?id=csm_ticket`), { base: '/csp', pageId: 'csm_ticket' });
  // a customer's own portal suffix, and the query string in any case
  assert.deepEqual(portalInfo(`${HOST}/Support-Portal?ID=Ticket`), { base: '/support-portal', pageId: 'ticket' });
  // a hash route
  assert.deepEqual(portalInfo(`${HOST}/esc#/?id=ticket&table=incident`), { base: '/esc', pageId: 'ticket' });
  assert.deepEqual(portalInfo(`${HOST}/esc/#!/?id=my_requests`), { base: '/esc', pageId: 'my_requests' });
  // the home address of a well-known portal is a portal page without a page id; an unknown suffix needs an id
  assert.deepEqual(portalInfo(`${HOST}/sp`), { base: '/sp', pageId: '' });
  assert.deepEqual(portalInfo(`${HOST}/esc/`), { base: '/esc', pageId: '' });
  assert.equal(portalInfo(`${HOST}/mystery`), null);
  // a page id that is not a plain name is not passed on
  assert.deepEqual(portalInfo(`${HOST}/sp?id=${encodeURIComponent('<b>x</b>')}`), { base: '/sp', pageId: '' });
});

test('portalInfo is null for everything that is not a portal page', () => {
  const none = [
    '', 'not a url', null, undefined, 42,
    `${HOST}/`, `${HOST}/login.do`, `${HOST}/incident.do?id=3`, `${HOST}/nav_to.do?id=x`,
    `${HOST}/now/sow/home?id=ticket`, `${HOST}/now/sow/record/incident/${'b'.repeat(32)}?id=x`,
    `${HOST}/api/now/table/incident?id=x`, `${HOST}/angular.do?id=x`, `${HOST}/some/deep/path?id=ticket`,
    `${HOST}/images/logo.png?id=1`,
  ];
  for (const u of none) assert.equal(portalInfo(u), null, String(u));
});

test('hash-routed and bare portal addresses are portal pages, classic and workspace stay as they were', () => {
  for (const u of [`${HOST}/esc#/?id=ticket`, `${HOST}/sp`, `${HOST}/esc/`, `${HOST}/hrsp`, `${HOST}/csm?ID=csm_ticket`, `${HOST}/helpdesk?id=index`]) assert.equal(surfaceOf(u), 'portal', u);
  for (const u of [`${HOST}/api/now/table/incident?id=x`, `${HOST}/mystery`, `${HOST}/some/deep/path?id=ticket`]) assert.equal(surfaceOf(u), 'other', u);
  assert.equal(surfaceOf(`${HOST}/incident.do?id=ticket`), 'classic');
  assert.equal(surfaceOf(`${HOST}/now/sow/home?id=ticket`), 'workspace');
});
