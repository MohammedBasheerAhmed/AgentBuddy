// Agent Buddy content script. Registered at run time only on instances the person enabled (see the service worker).
//
// It answers messages from this extension's own side panel and nothing else:
//   PAGE_STATE  which record is open (from the classic form via the page bridge, or from the URL on Workspaces and portals).
//               Portal pages are single-page apps: the address changes without a reload, so the address is read afresh on
//               every request and no record is remembered between requests. formStamp changes when the form is saved.
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
import { parseNewRecordRef, parseRecordRef, kindForTable } from '../context/kinds.js';
import { resolveRealClass } from '../context/pack.js';
import { SYS_ID_RE, TABLE_RE, disp } from '../context/util.js';
import { handleRead } from './reads.js';
import { portalInfo, surfaceOf } from '../context/surface.js';
import { contentMessageAction } from '../lib/senderCheck.js';
import { handleFillField } from './fill.js';
import { policyGuard } from './policyGuard.js';
import { startBar } from './bar.js';
import { SUPPORTED, setLanguage } from '../i18n/index.js';
import { TAKEOVER_EVENT, contentTakeover, runtimeAlive } from './barLogic.js';

// After an extension update, the copy of this script injected before it keeps running in the open tabs, cut off from the extension
// (its messages fail). The service worker injects the new copy into those tabs (service-worker.js, onInstalled 'update'); the new
// copy replaces an old one whose extension context is gone, and tells any other old copy to remove its bar.
const runtime = chrome.runtime;
const alive = () => runtimeAlive(runtime);
const decision = contentTakeover(window.__abContent);
if (decision === 'replace') {
  try {
    window.__abContent.retire();
  } catch {
    /* the old copy is gone already */
  }
}

if (decision !== 'skip') {
  window.__abContent = { alive, retire: () => retire() };
  // (a copy that lives in another isolated world cannot be reached through window: it hears this and checks its own context)
  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));

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
    if (window.__abContent?.alive === alive) window.__abContent = null;
    document.removeEventListener(TAKEOVER_EVENT, onTakeover);
    document.removeEventListener('click', onPress, true);
    document.removeEventListener('keydown', onKey, true);
    numberCache.clear();
    numberMisses.clear();
    realClasses.clear();
    bar?.stop();
  }
  // A newer copy arrived. Only a copy whose extension context is gone steps down: a page script can send the same event, and must not
  // be able to remove a working bar with it.
  function onTakeover() {
    if (!alive()) retire();
  }
  document.addEventListener(TAKEOVER_EVENT, onTakeover);

  // A record opened through the base class (/task.do?sys_id=..., a Workspace /record/task/<id>) is really an incident, a case, an HR
  // case...: its real class is looked up once (one small read through the policy guard), so the panel's header, the bar's actions and
  // the record's kind are those of the real type. A class that cannot be looked up stays 'task' (the pack read then treats the record
  // as sensitive). sys_id -> class, bounded like the number cache.
  const realClasses = new Map();
  async function realClassOf(table, sysId) {
    if (table !== 'task') return table;
    if (realClasses.has(sysId)) return realClasses.get(sysId);
    const guarded = await policyGuard.deps({ queryTable });
    const found = await resolveRealClass({ table, sysId }, guarded).catch(() => ({ table, unresolved: true }));
    if (found.unresolved || !TABLE_RE.test(found.table)) return table;
    remember(realClasses, sysId, found.table);
    return found.table;
  }

  // `known`: the form's description when the caller has already asked the page for it (pageState asks once for everything).
  async function resolveRecord(href, known) {
    // 1) The classic form knows exactly which record it shows.
    const meta = known === undefined ? await tryCallPage('getFormMeta') : known;
    if (meta?.table && SYS_ID_RE.test(meta.sysId || '') && !meta.isNewRecord && TABLE_RE.test(meta.table)) {
      const table = await realClassOf(meta.table, meta.sysId);
      return { table, sysId: meta.sysId, number: meta.number || '', kind: kindForTable(table) };
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
    const table = await realClassOf(ref.table, sysId);
    return { table, sysId, number: number || '', kind: kindForTable(table) };
  }

  // A blank form (new incident, new article...): there is no record yet, but the table is known. The form says so through g_form
  // (classic, and Next Experience where the bridge reaches the form's frame); otherwise the address does (sys_id=-1), which covers a
  // Next Experience form whose frame the bridge cannot reach (yet) and a Workspace's /record/<table>/-1.
  async function newRecordState(known) {
    const meta = known === undefined ? await tryCallPage('getFormMeta') : known;
    if (meta?.isNewRecord && TABLE_RE.test(meta.table || '')) return { table: meta.table, kind: kindForTable(meta.table) };
    if (meta?.table && meta.isNewRecord === false) return null; // the form on the page is a saved record
    const fromAddress = parseNewRecordRef(location.href);
    return fromAddress ? { table: fromAddress.table, kind: kindForTable(fromAddress.table) } : null;
  }

  // "The form was saved" (TRACKER.md N1): the panel reads the ticket's header again when formStamp changes. A classic form (and the
  // form frame of Next Experience) reloads on Save, so the time its document was loaded changes. A Workspace saves without a reload,
  // so a press of its own Save (or Update, Resolve, Submit; Ctrl+S) is counted. Only the count is kept, nothing about the page or the
  // record, and the listeners only look: they never stop, change or start anything.
  let saves = 0;
  const SAVE_LABEL_RE = /^(save|update|save and close|resolve|submit)$/i;
  const labelOf = (el) => String(el.getAttribute?.('aria-label') || el.getAttribute?.('label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  function onPress(event) {
    if (surfaceOf(location.href) !== 'workspace') return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const el of path.slice(0, 8)) {
      if (!el || el.nodeType !== 1) continue;
      const tag = String(el.tagName || '').toLowerCase();
      if (tag !== 'button' && el.getAttribute?.('role') !== 'button' && !tag.startsWith('now-button')) continue;
      if (SAVE_LABEL_RE.test(labelOf(el))) saves += 1;
      return; // the nearest button is the one pressed
    }
  }
  function onKey(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key || '').toLowerCase() === 's' && surfaceOf(location.href) === 'workspace') saves += 1;
  }
  document.addEventListener('click', onPress, true);
  document.addEventListener('keydown', onKey, true);
  // What the page world said is data: only a plain whole number gets through.
  const formStamp = (meta) => `${Number.isSafeInteger(meta?.loadedAt) && meta.loadedAt > 0 ? meta.loadedAt : ''}:${saves}`;

  async function pageState() {
    // The address is read ONCE per request and used for the record, the surface and the portal alike: a portal changes it
    // with history.pushState and no reload, so nothing here may remember an earlier one.
    const href = location.href;
    // (the one read here, "who is Me" in sys_user, goes through the policy guard like every other read)
    const guarded = await policyGuard.deps({ queryTable }).catch(() => null);
    const meta = await tryCallPage('getFormMeta'); // asked once, for the record, a blank form and the save stamp alike
    const [record, session, newRecord] = await Promise.all([resolveRecord(href, meta).catch(() => null), guarded ? getSessionUser(guarded).catch(() => null) : null, newRecordState(meta).catch(() => null)]);
    const surface = surfaceOf(href);
    const portal = surface === 'portal' ? portalInfo(href) : null;
    return {
      href,
      title: document.title,
      surface,
      ...(portal ? { portal } : {}),
      record,
      newRecord: record ? null : newRecord,
      formStamp: formStamp(meta),
      user: session && (session.userId || session.name || session.userName) ? { name: session.name, roles: session.roles, userId: session.userId } : null,
    };
  }

  async function header({ table, sysId }, policy) {
    assertRecord(table, sysId);
    // The panel's policy rides along with the message (see src/sidepanel/ask.js); the guard merges it with the managed policy.
    const guarded = await policyGuard.deps({ queryTable }, policy);
    // An incident also says whether it is a major one (the Major Incident plugin's column; absent elsewhere, then simply not returned).
    const columns = ['number', 'short_description', 'state', 'priority', ...(table === 'incident' ? ['major_incident_state'] : [])];
    const rows = await guarded.queryTable(table, `sys_id=${sysId}`, columns, { limit: 1, displayValue: true });
    const row = rows[0] || {};
    return { number: disp(row.number), short_description: disp(row.short_description), state: disp(row.state), priority: disp(row.priority), ...(row.major_incident_state !== undefined ? { major_incident_state: disp(row.major_incident_state) } : {}) };
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
    // The panel says which language it is in; the texts built here (rows of My work, the form fields ...) are written in it.
    if (SUPPORTED.includes(message?.language)) setLanguage(message.language);
    (async () => {
      switch (message?.type) {
        case MSG.PING:
          return { ok: true };
        case MSG.PAGE_STATE:
          return pageState();
        case MSG.READ:
          if (message.op === 'header') return header(message.args || {}, message.policy);
          return handleRead(message.op, message.args || {}, { policy: message.policy, currentRecord: () => resolveRecord(location.href) });
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
