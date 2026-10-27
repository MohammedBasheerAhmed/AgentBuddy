// Agent Buddy content script. Registered at run time only on instances the person enabled (see the service worker).
//
// It answers messages from this extension's own side panel and nothing else:
//   PAGE_STATE  which record is open (from the classic form via the page bridge, or from the URL on Workspaces)
//   READ        GET-only reads with the person's own session (the context engine in src/context)
//   FILL_FIELD  put text into ONE field on the open form (the only write; the person presses Save)
//
// No UI is injected into the ServiceNow page, nothing is sent to any server from here, and the page cannot message this
// script: chrome.runtime.onMessage only receives messages from this extension.
import { MSG, toWireError } from '../lib/messages.js';
import { tryCallPage, callPage } from './pageBridge.js';
import { queryTable } from './tableApi.js';
import { parseRecordRef, kindForTable } from '../context/kinds.js';
import { SYS_ID_RE, TABLE_RE, disp } from '../context/util.js';
import { handleRead } from './reads.js';
import { surfaceOf } from '../context/surface.js';

const FIELD_RE = /^[a-z][a-z0-9_]{0,79}$/;
const MAX_INSERT_CHARS = 20000;

if (!window.__abContentInstalled) {
  window.__abContentInstalled = true;

  // number -> sys_id cache, so a Workspace URL that carries only a number is looked up once.
  const numberCache = new Map();

  async function resolveRecord() {
    // 1) The classic form knows exactly which record it shows.
    const meta = await tryCallPage('getFormMeta');
    if (meta?.table && SYS_ID_RE.test(meta.sysId || '') && !meta.isNewRecord && TABLE_RE.test(meta.table)) {
      return { table: meta.table, sysId: meta.sysId, number: meta.number || '', kind: kindForTable(meta.table) };
    }
    // 2) Workspaces and Next Experience: the URL.
    const ref = parseRecordRef(location.href);
    if (!ref || !TABLE_RE.test(ref.table || '')) return null;
    let { sysId, number } = ref;
    if (!sysId && number) {
      const cacheKey = `${ref.table}:${number}`;
      if (!numberCache.has(cacheKey)) {
        const rows = await queryTable(ref.table, `number=${number}`, ['sys_id', 'number'], { limit: 1 }).catch(() => []);
        if (rows[0]?.sys_id) numberCache.set(cacheKey, rows[0].sys_id);
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
    const [record, session, newRecord] = await Promise.all([resolveRecord().catch(() => null), tryCallPage('getSessionInfo'), newRecordState().catch(() => null)]);
    return {
      href: location.href,
      title: document.title,
      surface: surfaceOf(location.href),
      record,
      newRecord: record ? null : newRecord,
      user: session ? { name: [session.firstName, session.lastName].filter(Boolean).join(' '), roles: session.roles || [], userId: session.userId || '' } : null,
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
      // (g_form) and on a Workspace page (the control it finds in the DOM) alike.
      return (await callPage('fillField', [field, text, label || '', mode === 'append'])) || { ok: false, reason: 'no-form' };
    } catch {
      return { ok: false, reason: 'no-form' };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only this extension's own pages (the side panel) can ask. chrome.runtime.onMessage never delivers web-page messages.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
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
