import test from 'node:test';
import assert from 'node:assert/strict';
import { afterRefusal, clickPlan, isAddedSite, looksLikeServiceNow, scopeChangeMatters, scopeFor, siteOrigin, tabChangeMatters } from '../src/background/panelScope.js';

// The rules of "the panel only on the sites the person added" (src/background/panelScope.js), without a browser. The owner's complaint
// (2026-11-07): the panel took width on ifBash.com. The rules decide, per tab, whether the panel is on.

const A = 'https://acme.service-now.com';
const B = 'https://beta.servicenowservices.com';
const ACTIVE = [A, B];

test('an added site: any page of its origin, portals included', () => {
  for (const url of [
    `${A}/`,
    `${A}/incident.do?sys_id=${'a'.repeat(32)}`,
    `${A}/now/nav/ui/classic/params/target/incident_list.do`,
    `${A}/sp?id=index`,
    `${A}/esc?id=sc_home`,
    `${A}/csm`,
    `${A}/#hash`,
    `${A}:443/incident.do`, // (the default port is the same origin)
    'HTTPS://ACME.SERVICE-NOW.COM/incident.do', // (upper case host)
    `${B}/incident_list.do`,
  ]) {
    assert.equal(isAddedSite(url, ACTIVE), true, url);
    assert.deepEqual(scopeFor({ url }, ACTIVE), { enabled: true, kind: 'added' }, url);
  }
});

test('anything else is not an added site: other hosts, look-alikes, other ports, sub-domains, http, and pages that are not websites', () => {
  for (const url of [
    'https://ifbash.com/',
    'https://www.ifbash.com/about',
    'https://example.com/',
    'https://acme.service-now.com.evil.example/', // a look-alike whose name starts with ours
    'https://service-now.com.evil.example/',
    'https://evil.example/https://acme.service-now.com/',
    'https://evil.example/?next=https://acme.service-now.com/',
    'https://acme.service-now.com@evil.example/', // (the host is evil.example)
    'https://user:pass@acme.service-now.com/', // user name and password: never an instance
    'https://acme.service-now.com:8443/', // another port is another origin
    'https://sub.acme.service-now.com/',
    'https://xacme.service-now.com/',
    'https://acme.service-now.com./', // trailing dot
    'http://acme.service-now.com/', // plain http
    'ftp://acme.service-now.com/',
    'chrome://extensions/',
    'chrome://newtab/',
    'about:blank',
    'file:///C:/Users/me/ticket.html',
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop/options.html',
    'moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/sidepanel.html',
    'view-source:https://acme.service-now.com/',
    'data:text/html,hello',
    'javascript:alert(1)',
    'not an address',
    '',
  ]) {
    assert.equal(isAddedSite(url, ACTIVE), false, url);
    assert.equal(scopeFor({ url }, ACTIVE).enabled, false, url);
  }
});

test('no address, or an address the browser does not show, is "not an added site"; no sites means no tab', () => {
  for (const tab of [undefined, null, {}, { id: 3 }, { url: undefined }, { url: null }, { url: 42 }, { url: '' }]) {
    assert.deepEqual(scopeFor(tab, ACTIVE), { enabled: false, kind: 'unseen' }, JSON.stringify(tab));
  }
  for (const active of [[], undefined, null, 'https://acme.service-now.com', {}]) {
    assert.equal(isAddedSite(`${A}/`, active), false);
    assert.equal(scopeFor({ url: `${A}/` }, active).enabled, false);
  }
  assert.equal(isAddedSite(`${A}/`, [null, 7, {}, '']), false, 'a bad entry is skipped, never matched');
  assert.equal(isAddedSite(`${A}/`, [null, A]), true);
});

test('the sites of the list are matched as written by the instance rules: case and default port do not matter', () => {
  assert.equal(isAddedSite(`${A}/`, ['HTTPS://Acme.Service-Now.com']), true);
  assert.equal(isAddedSite(`${A}/`, ['https://acme.service-now.com:443']), true);
  assert.equal(isAddedSite('https://localhost:8443/nav', ['https://localhost:8443']), true, 'a site on a port, as the end-to-end fake instance is');
  assert.equal(isAddedSite('https://localhost:9000/nav', ['https://localhost:8443']), false);
  assert.equal(isAddedSite('https://localhost/nav', ['https://localhost:8443']), false);
  assert.equal(isAddedSite('http://localhost:8443/', ['https://localhost:8443']), false, 'http is never an instance');
  assert.equal(isAddedSite('http://localhost/', ['http://localhost']), false, 'not even when the list holds it');
  assert.equal(siteOrigin('http://127.0.0.1:3000/'), '');
});

test('a site on its own web address is added by the person, not recognised by its name', () => {
  const custom = 'https://servicenow.acme.example';
  assert.equal(looksLikeServiceNow(`${custom}/`), false);
  assert.deepEqual(scopeFor({ url: `${custom}/incident.do` }, [custom]), { enabled: true, kind: 'added' });
  assert.deepEqual(scopeFor({ url: `${custom}/incident.do` }, []), { enabled: false, kind: 'other' });
});

test('looks like ServiceNow: the host ends with .service-now.com or .servicenowservices.com, over https, and nothing else', () => {
  for (const url of [
    'https://dev364920.service-now.com/',
    'https://acme.service-now.com/incident.do',
    'https://acme.servicenowservices.com/',
    'https://a.b.service-now.com/',
    'HTTPS://ACME.SERVICE-NOW.COM/',
    'https://acme.service-now.com:8443/',
  ]) {
    assert.equal(looksLikeServiceNow(url), true, url);
  }
  for (const url of [
    'https://ifbash.com/',
    'https://service-now.com/', // the apex is not an instance
    'https://servicenowservices.com/',
    'https://www.servicenow.com/', // ServiceNow's own website is not an instance
    'https://developer.servicenow.com/',
    'https://service-now.com.evil.example/',
    'https://acme.service-now.com.evil.example/',
    'https://acme-service-now.com/',
    'https://evilservice-now.com/',
    'https://acme.service-now.com@evil.example/',
    'https://user@acme.service-now.com/',
    'https://evil.example/acme.service-now.com',
    'https://evil.example/?u=https://acme.service-now.com',
    'https://acme.service-now.com./',
    'https://a..service-now.com/',
    'http://acme.service-now.com/',
    'chrome://acme.service-now.com/',
    'file:///acme.service-now.com',
    'view-source:https://acme.service-now.com/',
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(looksLikeServiceNow(url), false, String(url));
  }
});

test('a ServiceNow address that is not added is its own kind: the panel is off, a click can turn it on for the click', () => {
  assert.deepEqual(scopeFor({ url: 'https://dev1.service-now.com/' }, ACTIVE), { enabled: false, kind: 'servicenow' });
  assert.deepEqual(scopeFor({ url: 'https://ifbash.com/' }, ACTIVE), { enabled: false, kind: 'other' });
  assert.deepEqual(scopeFor({ url: 'chrome://extensions/' }, ACTIVE), { enabled: false, kind: 'other' });
  assert.deepEqual(scopeFor({ url: 'https://dev1.service-now.com/' }, [...ACTIVE, 'https://dev1.service-now.com']), { enabled: true, kind: 'added' });
});

test('the click plan: only a ServiceNow-looking page switches the panel on for the click; every other page only asks to open', () => {
  assert.deepEqual(clickPlan({ id: 1, url: 'https://dev1.service-now.com/' }), { enable: true });
  assert.deepEqual(clickPlan({ id: 1, url: `${A}/incident.do` }), { enable: true }, 'an added site: switching on what is on already changes nothing');
  assert.deepEqual(clickPlan({ id: 1, url: 'https://ifbash.com/' }), { enable: false });
  assert.deepEqual(clickPlan({ id: 1, url: 'https://servicenow.acme.example/' }), { enable: false });
  assert.deepEqual(clickPlan({ id: 1 }), { enable: false });
  assert.deepEqual(clickPlan(undefined), { enable: false });
});

test('when the panel did not open: Settings for a page that could be a site to add; nothing for an added site or a ServiceNow page', () => {
  assert.equal(afterRefusal({ url: 'https://ifbash.com/' }, ACTIVE), 'settings');
  assert.equal(afterRefusal({ url: 'chrome://newtab/' }, ACTIVE), 'settings');
  assert.equal(afterRefusal({ url: 'https://servicenow.acme.example/' }, ACTIVE), 'settings', 'a site on its own address that is not added yet: Settings is where to add it');
  assert.equal(afterRefusal({}, ACTIVE), 'settings');
  assert.equal(afterRefusal(undefined, []), 'settings');
  assert.equal(afterRefusal({ url: `${A}/` }, ACTIVE), 'nothing', 'an added site: the refusal has another cause');
  assert.equal(afterRefusal({ url: 'https://servicenow.acme.example/' }, ['https://servicenow.acme.example']), 'nothing');
  assert.equal(afterRefusal({ url: 'https://dev1.service-now.com/' }, ACTIVE), 'nothing', 'it was switched on for the click');
});

test('storage changes that can change the active sites: the policy, and the list of sites in the settings, nothing else', () => {
  const KEY = 'agentbuddy_settings';
  assert.equal(scopeChangeMatters({ anything: {} }, 'managed', KEY), true);
  assert.equal(scopeChangeMatters({}, 'managed', KEY), true);
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: { instances: [] }, newValue: { instances: [A] } } }, 'local', KEY), true);
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: { instances: [A] }, newValue: { instances: [] } } }, 'local', KEY), true);
  assert.equal(scopeChangeMatters({ [KEY]: { newValue: { instances: [A] } } }, 'local', KEY), true, 'first save');
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: { instances: [A], model: 'a' }, newValue: { instances: [A], model: 'b' } } }, 'local', KEY), false, 'another setting');
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: {}, newValue: { instances: [] } } }, 'local', KEY), false, 'no list and an empty list are the same');
  assert.equal(scopeChangeMatters({ other_key: { oldValue: 1, newValue: 2 } }, 'local', KEY), false);
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: { instances: [] }, newValue: { instances: [A] } } }, 'session', KEY), false);
  assert.equal(scopeChangeMatters({ [KEY]: { oldValue: { instances: [] }, newValue: { instances: [A] } } }, 'sync', KEY), false);
  assert.equal(scopeChangeMatters(undefined, 'local', KEY), false);
  assert.equal(scopeChangeMatters(null, 'managed', KEY), true);
});

test('a tab event matters when the address or the load state changed, not for a title, a sound or an icon', () => {
  assert.equal(tabChangeMatters({ url: `${A}/` }), true);
  assert.equal(tabChangeMatters({ status: 'loading' }), true);
  assert.equal(tabChangeMatters({ status: 'complete' }), true);
  assert.equal(tabChangeMatters({ title: 'x' }), false);
  assert.equal(tabChangeMatters({ audible: true }), false);
  assert.equal(tabChangeMatters({ favIconUrl: 'x' }), false);
  assert.equal(tabChangeMatters({}), false);
  assert.equal(tabChangeMatters(undefined), false);
});
