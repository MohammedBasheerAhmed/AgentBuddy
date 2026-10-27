// Agent Buddy content script. Registered at run time only on instances the person enabled (see the service worker).
//
// It answers messages from this extension's own side panel and nothing else:
//   PAGE_STATE  which record is open (from the classic form via the page bridge, or from the URL on Workspaces and portals).
//               Portal pages are single-page apps: the address changes without a reload, so the address is read afresh on
//               every request and no record is remembered between requests.
//   READ        GET-only reads with the person's own session (the context engine in src/context)
//   FILL_FIELD  put text into ONE field on the open form (the only write; the person presses Save)
//
// No UI is injected into the ServiceNow page, nothing is sent to any server from here, and the page cannot message this
// script: chrome.runtime.onMessage only receives messages from this extension.
import { MSG, toWireError } from '../lib/messages.js';
import { tryCallPage, callPage } from './pageBridge.js';
import { getSessionUser } from './sessionToken.js';
import { queryTable } from './tableApi.js';
import { parseRecordRef, kindForTable } from '../context/kinds.js';
import { SYS_ID_RE, TABLE_RE, disp } from '../context/util.js';
import { handleRead } from './reads.js';
import { portalInfo, surfaceOf } from '../context/surface.js';
import { isFromExtensionPage } from '../lib/senderCheck.js';

const FIELD_RE = /^[a-z][a-z0-9_]{0,79}$/;
const MAX_INSERT_CHARS = 20000;
// The reasons the panel knows how to explain (src/sidepanel/ResultView.jsx). Anything else the page says becomes 'no-form'.
const FILL_REASONS = new Set(['no-form', 'no-such-field', 'read-only', 'too-long', 'set-failed', 'bad-field']);

if (!window.__abContentInstalled) {
  window.__abContentInstalled = true;

  // number -> sys_id cache, so an address that carries only a number (Workspace, portal) is looked up once. A number is the same
  // record whatever page it is on, so this is the one thing remembered between requests. A number that found nothing is not
  // asked again for 30 seconds (the panel asks every few seconds).
  const numberCache = new Map();
  const numberMisses = new Map();
  const MISS_MS = 30000;

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
        const rows = await queryTable(ref.table, `number=${number}`, ['sys_id', 'number'], { limit: 1 }).catch(() => []);
        if (rows[0]?.sys_id) numberCache.set(cacheKey, rows[0].sys_id);
        else numberMisses.set(cacheKey, Date.now());
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
    const [record, session, newRecord] = await Promise.all([resolveRecord(href).catch(() => null), getSessionUser({ queryTable }).catch(() => null), newRecordState().catch(() => null)]);
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

  async function header({ table, sysId }) {
    assertRecord(table, sysId);
    const rows = await queryTable(table, `sys_id=${sysId}`, ['number', 'short_description', 'state', 'priority'], { limit: 1, displayValue: true });
    const row = rows[0] || {};
    return { number: disp(row.number), short_description: disp(row.short_description), state: disp(row.state), priority: disp(row.priority) };
  }

  function assertRecord(table, sysId) {
    if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) throw new Error('That is not a valid record.');
  }

  async function fillField({ field, value, label, mode }) {
    if (!FIELD_RE.test(field || '')) return { ok: false, reason: 'bad-field' };
    const text = String(value ?? '');
    if (!text) return { ok: false, reason: 'bad-field' };
    if (text.length > MAX_INSERT_CHARS) return { ok: false, reason: 'too-long' };
    try {
      // 'append' = never overwrite what the agent already typed: the bridge adds the text below it, on a classic form
      // (g_form), on a Workspace page and on a portal page (the box it finds in the DOM) alike.
      const answer = await callPage('fillField', [field, text, typeof label === 'string' ? label.slice(0, 100) : '', mode === 'append']);
      // The answer comes from the page: only the two shapes the panel understands go back.
      if (answer?.ok === true) return { ok: true, method: answer.method === 'gform' ? 'gform' : 'dom' };
      return { ok: false, reason: FILL_REASONS.has(answer?.reason) ? answer.reason : 'no-form' };
    } catch {
      return { ok: false, reason: 'no-form' };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages (the side panel, the full-page dashboard) can ask. chrome.runtime.onMessage never delivers
    // web-page messages; the sender's origin (not "is it in a tab") tells an extension page from a content script.
    if (!isFromExtensionPage(sender, chrome.runtime.id)) return false;
    (async () => {
      switch (message?.type) {
        case MSG.PING:
          return { ok: true };
        case MSG.PAGE_STATE:
          return pageState();
        case MSG.READ:
          if (message.op === 'header') return header(message.args || {});
          return handleRead(message.op, message.args || {});
        case MSG.FILL_FIELD:
          return fillField(message);
        default:
          throw new Error('Unknown request.');
      }
    })()
      .then(sendResponse)
      .catch((err) => sendResponse(toWireError(err)));
    return true;
  });
}
