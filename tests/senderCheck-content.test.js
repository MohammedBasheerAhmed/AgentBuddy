const test = require('node:test');
const assert = require('node:assert/strict');
import { checkExtensionSender, contentMessageAction, isFromExtensionPage, senderOrigin } from '../src/lib/senderCheck.js';
import { extensionIdentity } from '../src/lib/platform.js';
import { MSG } from '../src/lib/messages.js';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const OWN = { id: ID, origin: `chrome-extension://${ID}` };

test('the content script answers the side panel and the full-page dashboard, and nothing else', () => {
  // the side panel: no tab
  assert.equal(isFromExtensionPage({ id: ID, url: `chrome-extension://${ID}/sidepanel.html`, origin: `chrome-extension://${ID}` }, OWN), true);
  // the full-page dashboard: an extension page in a tab (sender.tab is set)
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: `chrome-extension://${ID}/dashboard.html?tab=4`, origin: `chrome-extension://${ID}` }, OWN), true);
  // a content script of this extension in some web page: same id, but the web page's origin
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: 'https://evil.example/x', origin: 'https://evil.example' }, OWN), false);
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: 'https://acme.service-now.com/incident.do' }, OWN), false);
  // another extension
  assert.equal(isFromExtensionPage({ id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }, OWN), false);
  // nothing known
  assert.equal(isFromExtensionPage({ id: ID }, OWN), false);
  assert.equal(isFromExtensionPage(undefined, OWN), false);
});

// ---- the three browsers (src/lib/platform.js extensionIdentity) --------------------------------------------------------------------

// Chrome and Edge: the origin's host is the extension id. Firefox: the add-on's id (runtime.id, sender.id) and a random id made at
// install for its pages. Safari: the same, upper case.
const BROWSERS = {
  chrome: { id: ID, base: `chrome-extension://${ID}/` },
  firefox: { id: 'agentbuddy@ifbash.example', base: 'moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/' },
  safari: { id: 'com.ifbash.agentbuddy.Extension (TEAM123456)', base: 'safari-web-extension://8E1F2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B/' },
};
const identity = ({ id, base }) => extensionIdentity({ id, getURL: (p) => `${base}${p}` });

test('each browser\'s own pages are accepted, by their reported origin or by their address', () => {
  for (const [name, b] of Object.entries(BROWSERS)) {
    const own = identity(b);
    const origin = b.base.slice(0, -1);
    assert.equal(own.origin, origin, name);
    assert.equal(isFromExtensionPage({ id: b.id, origin, url: `${b.base}sidepanel.html` }, own), true, `${name}: origin reported`);
    assert.equal(isFromExtensionPage({ id: b.id, url: `${b.base}sidepanel.html` }, own), true, `${name}: only the address (Firefox may not report an origin)`);
    assert.equal(isFromExtensionPage({ id: b.id, tab: { id: 3 }, url: `${b.base}dashboard.html?tab=4` }, own), true, `${name}: the dashboard in a tab`);
    assert.equal(checkExtensionSender({ id: b.id, url: `${b.base}options.html` }, own), 'extension', name);
    assert.equal(contentMessageAction({ type: MSG.READ }, { id: b.id, url: `${b.base}sidepanel.html` }, own), 'answer', name);
  }
});

test('everything that only looks like one of our pages is refused, in every browser', () => {
  for (const [name, b] of Object.entries(BROWSERS)) {
    const own = identity(b);
    const origin = own.origin;
    const scheme = origin.slice(0, origin.indexOf('://') + 3);
    const host = origin.slice(scheme.length);
    const no = (sender, why) => {
      assert.equal(isFromExtensionPage(sender, own), false, `${name}: ${why}`);
      assert.throws(() => checkExtensionSender(sender, own), /only allowed/, `${name}: ${why}`);
      assert.equal(contentMessageAction({ type: MSG.READ }, sender, own), 'ignore', `${name}: ${why}`);
    };
    no({ id: b.id, origin: `${scheme}0f0f0f0f-0000-4000-8000-000000000000` }, 'another extension\'s origin, same scheme');
    no({ id: b.id, url: `${scheme}0f0f0f0f-0000-4000-8000-000000000000/sidepanel.html` }, 'another extension\'s address, same scheme');
    no({ id: b.id, origin: `${origin}.evil` }, 'our host with more after it');
    no({ id: b.id, url: `${scheme}${host}.evil/sidepanel.html` }, 'our host with more after it, in the address');
    no({ id: b.id, origin: `${scheme}${host === host.toUpperCase() ? host.toLowerCase() : host.toUpperCase()}` }, 'the host in other letter case');
    no({ id: b.id, url: `${scheme}${host === host.toUpperCase() ? host.toLowerCase() : host.toUpperCase()}/sidepanel.html` }, 'the host in other letter case, in the address');
    no({ id: b.id, origin: `${origin}/` }, 'an origin with a path');
    no({ id: b.id, origin: `${origin}/sidepanel.html` }, 'an origin with a path');
    no({ id: b.id, origin: `${origin}:8443` }, 'an origin with a port');
    no({ id: b.id, url: `${scheme}${host}:8443/sidepanel.html` }, 'an address with a port');
    no({ id: b.id, url: `${scheme}user@${host}/sidepanel.html` }, 'an address with a user name');
    no({ id: b.id, origin: 'null', url: `${b.base}sidepanel.html` }, 'an opaque origin ("null") does not fall back to the address');
    no({ id: b.id, origin: 'null' }, 'an opaque origin');
    no({ id: b.id }, 'no origin and no address');
    no({ id: b.id, origin: '', url: '' }, 'empty origin and address');
    no({ id: b.id, tab: { id: 5 }, frameId: 0, origin: 'https://acme.service-now.com', url: 'https://acme.service-now.com/incident.do' }, 'an https page (our content script)');
    no({ id: b.id, tab: { id: 5 }, frameId: 3, url: 'https://evil.example/frame.html' }, 'a frame inside a page');
    no({ id: 'someone-else', origin, url: `${b.base}sidepanel.html` }, 'sender.id is another extension\'s');
    no({ origin, url: `${b.base}sidepanel.html` }, 'no sender.id');
    no({ id: b.id, url: `https://${host}/sidepanel.html` }, 'our host on https');
  }
});

test('in Firefox the add-on\'s id is not its pages\' origin: moz-extension://<runtime.id> is refused', () => {
  const geckoId = '7f3c9b2e-1111-4222-8333-944455556666'; // an add-on id that even looks like a page id
  const own = extensionIdentity({ id: geckoId, getURL: (p) => `moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/${p}` });
  assert.equal(isFromExtensionPage({ id: geckoId, origin: `moz-extension://${geckoId}` }, own), false);
  assert.equal(isFromExtensionPage({ id: geckoId, url: `moz-extension://${geckoId}/sidepanel.html` }, own), false);
  assert.equal(isFromExtensionPage({ id: geckoId, url: 'moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/sidepanel.html' }, own), true);
  // nor does the Chrome shape of the old check let anything through in Firefox
  assert.equal(isFromExtensionPage({ id: geckoId, origin: `chrome-extension://${geckoId}` }, own), false);
});

test('"this extension" must be known exactly: no id, no origin, a web origin or a Chrome origin that is not the id\'s accepts nothing', () => {
  const panel = { id: ID, origin: `chrome-extension://${ID}`, url: `chrome-extension://${ID}/sidepanel.html` };
  const page = { id: ID, tab: { id: 5 }, frameId: 0, origin: 'https://acme.service-now.com', url: 'https://acme.service-now.com/incident.do' };
  for (const own of [undefined, null, ID, {}, { id: ID }, { origin: OWN.origin }, { id: ID, origin: '' }, { id: '', origin: OWN.origin }, { id: ID, origin: `chrome-extension://${ID}/` }]) {
    assert.equal(isFromExtensionPage(panel, own), false, JSON.stringify(own));
    assert.equal(contentMessageAction({ type: MSG.READ }, panel, own), 'ignore', JSON.stringify(own));
  }
  // a web page's origin given as "ours" must not make our content scripts count as our pages
  assert.equal(isFromExtensionPage(page, { id: ID, origin: 'https://acme.service-now.com' }), false);
  // in Chrome and Edge the origin's host is the id itself, exactly as the check was before Firefox
  assert.equal(isFromExtensionPage({ id: ID, origin: 'chrome-extension://pppppppppppppppppppppppppppppppp' }, { id: ID, origin: 'chrome-extension://pppppppppppppppppppppppppppppppp' }), false);
  // a context that could not say its address (getURL throws once the extension is gone) accepts nothing
  const gone = extensionIdentity({ id: ID, getURL: () => { throw new Error('Extension context invalidated.'); } });
  assert.deepEqual({ ...gone }, { id: ID, origin: '' });
  assert.equal(isFromExtensionPage(panel, gone), false);
});

test('the sender\'s origin is the frame\'s, never the tab\'s', () => {
  assert.equal(senderOrigin({ origin: 'https://a.example', url: 'https://b.example/x', tab: { url: 'https://c.example' } }), 'https://a.example');
  assert.equal(senderOrigin({ url: 'moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37/sidepanel.html' }), 'moz-extension://5b0c3e2a-9d41-4c8e-a7f2-0e6d1b9c4a37');
  assert.equal(senderOrigin({ url: 'safari-web-extension://8E1F2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B/x.html' }), 'safari-web-extension://8E1F2A3B-4C5D-4E6F-8A9B-0C1D2E3F4A5B');
  assert.equal(senderOrigin({ tab: { url: `chrome-extension://${ID}/sidepanel.html` } }), '');
  assert.equal(senderOrigin({ url: 'about:blank' }), '');
  assert.equal(senderOrigin(undefined), '');
});
