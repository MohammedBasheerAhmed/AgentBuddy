// Agent Buddy content script. Registered at run time only on instances the person enabled (see the service worker).
//
// It answers messages from this extension's own side panel and nothing else:
//   PAGE_STATE  which record is open (from the classic form via the page bridge, or from the URL on Workspaces and portals).
//               Portal pages are single-page apps: the address changes without a reload, so the address is read afresh on
//               every request and no record is remembered between requests.
//   READ        GET-only reads with the person's own session (the context engine in src/context)
//   FILL_FIELD  put text into ONE field on the open form (the only write; the person presses Save). Only the fields in
//               src/lib/fillable.js, only on the record the text was written for, with HTML escaped for an HTML field (fill.js)
//
// The one thing it puts on the page is the small bar of main actions (bar.js, in a closed shadow root). The bar runs nothing itself:
// a click asks the service worker to open the side panel and run the action there. Nothing is sent to any server from here, and the
// page cannot message this script: chrome.runtime.onMessage only receives messages from this extension.
import { MSG, toWireError } from '../lib/messages.js';
import { tryCallPage, callPage } from './pageBridge.js';
import { getSessionUser } from './sessionToken.js';
import { queryTable } from './tableApi.js';
import { parseRecordRef, kindForTable } from '../context/kinds.js';
import { SYS_ID_RE, TABLE_RE, disp } from '../context/util.js';
import { handleRead } from './reads.js';
import { portalInfo, surfaceOf } from '../context/surface.js';
import { contentMessageAction } from '../lib/senderCheck.js';
import { handleFillField } from './fill.js';
import { policyGuard } from './policyGuard.js';
import { startBar } from './bar.js';

if (!window.__abContentInstalled) {
  window.__abContentInstalled = true;

  // number -> sys_id cache, so an address that carries only a number (Workspace, portal) is looked up once. A number is the same
  // record whatever page it is on, so this is the one thing remembered between requests. A number that found nothing is not
  // asked again for 30 seconds (the panel asks every few seconds).
  const numberCache = new Map();
  const numberMisses = new Map();
  const MISS_MS = 30000;
  const MAX_REMEMBERED = 200; // a portal tab open all week does not grow the cache without end

  const remember = (map, key, value) => {
    if (map.size >= MAX_REMEMBERED) map.delete(map.keys().next().value);
    map.set(key, value);
  };

  // Once the site is turned off (the service worker says so) this script does nothing more until the page is reloaded: the bar goes,
  // the panel gets no answers, nothing is read. Turning the site on again injects a fresh script.
  let retired = false;
  let bar = null;
  function retire() {
    if (retired) return;
    retired = true;
    window.__abContentInstalled = false;
    numberCache.clear();
    numberMisses.clear();
    bar?.stop();
  }

  async function resolveRecord(href) {
    // 1) The classic form knows exactly which record it shows.
    const meta = await tryCallPage('getFormMeta');
    if (meta?.table && SYS_ID_RE.test(meta.sysId || '') && !meta.isNewRecord && TABLE_RE.test(meta.table)) {
      return { table: meta.table, sysId: meta.sysId, number: meta.number || '', kind: kindForTable(meta.table) };
    }
    // 2) Workspaces, Next Experience and portals: the address (read afresh on every request).
    const ref = parseRecordRef(href);
    if (!ref || !TABLE_RE.test(ref.table || '')) return null;
    let { sysId, number } = ref;
    if (!sysId && number) {
      const cacheKey = `${ref.table}:${number}`;
      if (!numberCache.has(cacheKey) && Date.now() - (numberMisses.get(cacheKey) || 0) > MISS_MS) {
        // (through the policy guard: a blocked table is not looked up)
        const guarded = await policyGuard.deps({ queryTable });
        const rows = await guarded.queryTable(ref.table, `number=${number}`, ['sys_id', 'number'], { limit: 1 }).catch(() => []);
        if (rows[0]?.sys_id) remember(numberCache, cacheKey, rows[0].sys_id);
        else remember(numberMisses, cacheKey, Date.now());
      }
      sysId = numberCache.get(cacheKey) || '';
    }
    if (!SYS_ID_RE.test(sysId || '')) return null;
    return { table: ref.table, sysId, number: number || '', kind: kindForTable(ref.table) };
  }

  // A blank form on the classic UI (new incident, new article...): there is no record yet, but the table is known.
  async function newRecordState() {
    const meta = await tryCallPage('getFormMeta');
    return meta?.isNewRecord && TABLE_RE.test(meta.table || '') ? { table: meta.table, kind: kindForTable(meta.table) } : null;
  }

  async function pageState() {
    // The address is read ONCE per request and used for the record, the surface and the portal alike: a portal changes it
    // with history.pushState and no reload, so nothing here may remember an earlier one.
    const href = location.href;
    // (the one read here, "who is Me" in sys_user, goes through the policy guard like every other read)
    const guarded = await policyGuard.deps({ queryTable }).catch(() => null);
    const [record, session, newRecord] = await Promise.all([resolveRecord(href).catch(() => null), guarded ? getSessionUser(guarded).catch(() => null) : null, newRecordState().catch(() => null)]);
    const surface = surfaceOf(href);
    const portal = surface === 'portal' ? portalInfo(href) : null;
    return {
      href,
      title: document.title,
      surface,
      ...(portal ? { portal } : {}),
      record,
      newRecord: record ? null : newRecord,
      user: session && (session.userId || session.name || session.userName) ? { name: session.name, roles: session.roles, userId: session.userId } : null,
    };
  }

  async function header({ table, sysId }, policy) {
    assertRecord(table, sysId);
    // The panel's policy rides along with the message (see src/sidepanel/ask.js); the guard merges it with the managed policy.
    const guarded = await policyGuard.deps({ queryTable }, policy);
    const rows = await guarded.queryTable(table, `sys_id=${sysId}`, ['number', 'short_description', 'state', 'priority'], { limit: 1, displayValue: true });
    const row = rows[0] || {};
    return { number: disp(row.number), short_description: disp(row.short_description), state: disp(row.state), priority: disp(row.priority) };
  }

  function assertRecord(table, sysId) {
    if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) throw new Error('That is not a valid record.');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages (the side panel, the full-page dashboard) can ask. chrome.runtime.onMessage never delivers
    // web-page messages; the sender's origin (not "is it in a tab") tells an extension page from a content script. The service
    // worker may say the site was turned off, after which nothing is answered (src/lib/senderCheck.js contentMessageAction).
    const action = contentMessageAction(message, sender, chrome.runtime.id, retired);
    if (action === 'retire') {
      retire();
      sendResponse({ ok: true });
      return false;
    }
    if (action !== 'answer') return false;
    (async () => {
      switch (message?.type) {
        case MSG.PING:
          return { ok: true };
        case MSG.PAGE_STATE:
          return pageState();
        case MSG.READ:
          if (message.op === 'header') return header(message.args || {}, message.policy);
          return handleRead(message.op, message.args || {}, { policy: message.policy });
        case MSG.FILL_FIELD:
          return handleFillField(message, { callPage, currentRecord: () => resolveRecord(location.href), currentNewRecord: newRecordState, href: () => location.href });
        default:
          throw new Error('Unknown request.');
      }
    })()
      .then(sendResponse)
      .catch((err) => sendResponse(toWireError(err)));
    return true;
  });

  // The bar of main actions. It follows the record that is open (the same detection the side panel uses) and hides itself when the
  // service worker says it may not show (switched off in Settings, a blocked table). While it is switched off it does not look at the
  // page at all; when the service worker says the site is no longer turned on, this whole script retires.
  bar = startBar({ resolveRecord: () => resolveRecord(location.href), onSiteOff: retire });
}
