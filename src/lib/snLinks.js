// The one place that knows what a ServiceNow address looks like. Every address the panel builds (a record, a knowledge article, a
// list, a blank form, the email form) comes from here, so the same thing is always the same address, whichever screen asks and
// whichever tab the agent happens to be on. Pure: no chrome.*, no React, nothing read from the page.
//
// The rules (audit 6 of 2026-11-07; docs/live-questions/audit-1107-links.md lists what is assumed about ServiceNow):
//   - An address is built from the page's own origin (https only) and a table, a sys_id or an article number that passed a check.
//     Never from text in a ticket. '' means "cannot be built safely": the caller shows plain text or a disabled button.
//   - A knowledge article is READ at the article reader, /kb_view.do?sysparm_article=KB0010001 (by number: it follows the newest
//     published version; /kb_view.do?sys_kb_id=<id> only when there is no number), for the agent who opens it and for the customer
//     who receives the copied link, on every surface. So "open" and "copy link" are the same string and the view does not depend on
//     the tab. The one exception is the authoring form (intent 'author', the Duplicates screen): a knowledge manager edits there.
//   - A ticket stays in the UI the agent works in: a Workspace record route, a portal ticket page, else the classic form.
//   - A list, a blank form and the email form are classic pages.
//   - staysInOwnUi() says whether an address keeps the agent in their Workspace or portal; the caller opens one that does not in a
//     new tab, so a Workspace or portal tab is never replaced by a classic page (and what is typed on it is not lost).
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';

export const ARTICLE_TABLE = 'kb_knowledge';

// KB0010001, and the other prefixes an instance can use (KBA..., ARTICLE...): two to eight letters, then four to twelve digits.
export const ARTICLE_NUMBER_RE = /^[A-Za-z]{2,8}\d{4,12}$/;

// ---- The assumptions about ServiceNow, in one place -----------------------------------------------------------------------------
// A live answer (docs/live-questions/audit-1107-links.md) is a change to one of these lines.

/** The article reader of the platform. */
export const ARTICLE_READER_PATH = '/kb_view.do';

/** Which kind of ticket a table is. First match wins; a table that matches none has no family (and is never guessed). */
export const TABLE_FAMILIES = Object.freeze([
  ['hr', /^sn_hr_/],
  ['csm', /^(?:sn_customerservice_|csm_)/],
  ['itsm', /^(?:incident|incident_task|problem|problem_task|change_request|change_task|sc_request|sc_req_item|sc_task|task)$/],
]);

/** The portal page that shows a ticket of each family (?id=<page>&table=<table>&sys_id=<id>). */
export const PORTAL_TICKET_PAGES = Object.freeze({ csm: 'csm_ticket', hr: 'hr_ticket', itsm: 'ticket' });
export const DEFAULT_PORTAL_TICKET_PAGE = 'ticket';

/** The portal used when neither the page's own description nor its address names one. */
export const DEFAULT_PORTAL = '/sp';

// ---- Small pieces ---------------------------------------------------------------------------------------------------------------

const PORTAL_SEGMENT_RE = /^[a-z][a-z0-9_-]{0,30}$/i;
// The part of a Workspace address before "/record/": /now/sow, /now/cwf/agent, /now/workspace/agent. Up to three plain segments.
const WORKSPACE_ROUTE_RE = /^(\/now(?:\/[a-z0-9_-]{1,40}){1,3})\/record\/([a-z][a-z0-9_]*)\/[0-9a-f]{32}(?:[/?#]|$)/i;
const MAX_QUERY = 6000;

const parse = (href) => {
  try {
    return new URL(String(href));
  } catch {
    return null;
  }
};

/** The origin of the instance the page is on; '' unless it is an https address. */
export function originOf(page) {
  const url = parse(page?.href);
  return url && url.protocol === 'https:' ? url.origin : '';
}

/** Which portal the page is on: the content script's answer (page.portal.base), else the first segment of the address, else /sp. */
export function portalBase(page) {
  const given = page?.portal?.base;
  if (typeof given === 'string' && given.startsWith('/') && PORTAL_SEGMENT_RE.test(given.slice(1))) return given.toLowerCase();
  const first = parse(page?.href)?.pathname.split('/').filter(Boolean)[0] || '';
  return PORTAL_SEGMENT_RE.test(first) ? `/${first.toLowerCase()}` : DEFAULT_PORTAL;
}

/** The family of a table ('itsm', 'csm', 'hr'), or '' when it is none of them. */
export function familyOf(table) {
  const name = String(table || '');
  for (const [id, re] of TABLE_FAMILIES) if (re.test(name)) return id;
  return '';
}

/** The portal page that shows a ticket of this table: by the table's family, never copied from the page the agent is on. */
export const ticketPageFor = (table) => PORTAL_TICKET_PAGES[familyOf(table)] || DEFAULT_PORTAL_TICKET_PAGE;

/** The record route of the Workspace the page is in: { prefix: '/now/sow', table: 'incident' }, or null away from a record page. */
export function workspaceRoute(page) {
  const url = parse(page?.href);
  const m = url ? WORKSPACE_ROUTE_RE.exec(url.pathname) : null;
  return m ? { prefix: m[1], table: m[2].toLowerCase() } : null;
}

/** The Workspace the page is in ("/now/sow"), read from the address of the record on screen; '' when it cannot be told. */
export const workspacePrefix = (page) => workspaceRoute(page)?.prefix || '';

// A Workspace's record route is used for the table on screen and the tables of the same family. A table outside it is not guessed:
// the route may not exist there, and a wrong guess opens an error page in the agent's tab (audit 9, S22).
const workspaceOpens = (route, table) => route.table === table || (familyOf(table) !== '' && familyOf(table) === familyOf(route.table));

/** The article number in its one written form (KB0010001), or '' when the text is not one. */
export function articleNumber(text) {
  const n = String(text ?? '').trim().toUpperCase();
  return ARTICLE_NUMBER_RE.test(n) ? n : '';
}

const sysIdOf = (value) => (typeof value === 'string' && SYS_ID_RE.test(value) ? value.toLowerCase() : '');
const tableOf = (value) => (typeof value === 'string' && TABLE_RE.test(value) ? value : '');
const formAddress = (origin, inner) => `${origin}/nav_to.do?uri=${encodeURIComponent(inner)}`;

// ---- The addresses --------------------------------------------------------------------------------------------------------------

/**
 * The address of a record.
 * @param {{ href: string, surface?: string, portal?: { base?: string } | null }} page the page the panel is attached to
 * @param {{ table: string, sysId?: string, number?: string }} ref the record (an article: its number, or its sys_id)
 * @param {{ audience?: 'agent' | 'customer', intent?: 'work' | 'read' | 'author' }} [opts]
 *   audience  'agent' (default): the person using the panel opens it. 'customer': the address is copied into a reply, so it never
 *             depends on the tab the agent has open; only an article has one (a ticket gives ''; nothing builds a customer's ticket).
 *   intent    'read' (the default for an article) and 'work' (the default for anything else) follow the rules above. 'author' opens an
 *             article in its authoring form (the Duplicates screen).
 * @returns {string} '' when it cannot be built safely
 */
export function linkFor(page, ref, { audience = 'agent', intent = undefined } = {}) {
  if (audience !== 'agent' && audience !== 'customer') return '';
  if (intent !== undefined && intent !== 'work' && intent !== 'read' && intent !== 'author') return '';
  const table = tableOf(ref?.table);
  const origin = originOf(page);
  if (!table || !origin) return '';
  const id = sysIdOf(ref.sysId);

  if (table === ARTICLE_TABLE) {
    if (audience === 'agent' && intent === 'author') return id ? formAddress(origin, `${table}.do?sys_id=${id}`) : '';
    const number = articleNumber(ref.number);
    if (number) return `${origin}${ARTICLE_READER_PATH}?sysparm_article=${number}`;
    return id ? `${origin}${ARTICLE_READER_PATH}?sys_kb_id=${id}` : '';
  }

  if (audience === 'customer' || !id) return '';
  if (page.surface === 'portal') return `${origin}${portalBase(page)}?id=${ticketPageFor(table)}&table=${table}&sys_id=${id}`;
  if (page.surface === 'workspace') {
    const route = workspaceRoute(page);
    if (route && workspaceOpens(route, table)) return `${origin}${route.prefix}/record/${table}/${id}`;
  }
  return formAddress(origin, `${table}.do?sys_id=${id}`);
}

/** The address to copy for a customer: an article hit ({ sysId, number }) as the reader, the same on every tab. */
export const customerArticleLink = (page, hit) => linkFor(page, { table: ARTICLE_TABLE, sysId: hit?.sysId, number: hit?.number }, { audience: 'customer' });

/** The classic list of a table with a filter (the filter is encoded; '' when the table, the page or the length is not valid). */
export function listLink(page, table, query = '') {
  const origin = originOf(page);
  const name = tableOf(table);
  const text = String(query ?? '');
  if (!origin || !name || text.length > MAX_QUERY) return '';
  return formAddress(origin, `${name}_list.do?sysparm_query=${encodeURIComponent(text)}`);
}

/** A blank form for a table on the classic UI. */
export function blankFormLink(page, table) {
  const origin = originOf(page);
  const name = tableOf(table);
  return origin && name ? formAddress(origin, `${name}.do?sys_id=-1`) : '';
}

/** The classic email client for a record. */
export function emailFormLink(page, ref) {
  const origin = originOf(page);
  const table = tableOf(ref?.table);
  const id = sysIdOf(ref?.sysId);
  if (!origin || !table || !id) return '';
  return `${origin}/email_client.do?sysparm_table=${table}&sysparm_sys_id=${id}&sysparm_target=${table}&sysparm_uniqueValue=${id}`;
}

/**
 * Does this address keep the agent in the UI the page is in? A classic page: always. A Workspace: only its own record route. A
 * portal: only that portal's own pages. An address of another instance never does. The caller opens an address that does not in a
 * NEW tab, so a Workspace or portal tab is not replaced by a classic page.
 */
export function staysInOwnUi(page, url) {
  const target = parse(url);
  const here = parse(page?.href);
  if (!target || !here || target.origin !== here.origin) return false;
  if (page.surface === 'workspace') {
    const route = workspaceRoute(page);
    return Boolean(route) && target.pathname.startsWith(`${route.prefix}/record/`);
  }
  if (page.surface === 'portal') return target.pathname.replace(/\/+$/, '') === portalBase(page);
  return true;
}
