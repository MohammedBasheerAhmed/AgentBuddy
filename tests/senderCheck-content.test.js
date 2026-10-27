const test = require('node:test');
const assert = require('node:assert/strict');
import { isFromExtensionPage } from '../src/lib/senderCheck.js';

const ID = 'abcdefghijklmnopabcdefghijklmnop';

test('the content script answers the side panel and the full-page dashboard, and nothing else', () => {
  // the side panel: no tab
  assert.equal(isFromExtensionPage({ id: ID, url: `chrome-extension://${ID}/sidepanel.html`, origin: `chrome-extension://${ID}` }, ID), true);
  // the full-page dashboard: an extension page in a tab (sender.tab is set)
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: `chrome-extension://${ID}/dashboard.html?tab=4`, origin: `chrome-extension://${ID}` }, ID), true);
  // a content script of this extension in some web page: same id, but the web page's origin
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: 'https://evil.example/x', origin: 'https://evil.example' }, ID), false);
  assert.equal(isFromExtensionPage({ id: ID, tab: { id: 5 }, url: 'https://acme.service-now.com/incident.do' }, ID), false);
  // another extension
  assert.equal(isFromExtensionPage({ id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }, ID), false);
  // nothing known
  assert.equal(isFromExtensionPage({ id: ID }, ID), false);
  assert.equal(isFromExtensionPage(undefined, ID), false);
});
