// Which kind of ServiceNow page a tab is showing, from its address alone (the content script adds what the page tells it).
//   'classic'    the platform UI: /incident.do, /nav_to.do, /now/nav/ui/classic/...
//   'workspace'  Next Experience workspaces: /now/<workspace>/record/<table>/<sys_id>
//   'portal'     Service Portal, Employee Center, customer service portal, HR portal and other portal themes:
//                /sp?id=ticket&table=..., /esc?id=ticket&..., /csm?id=csm_ticket&..., /hrsp?id=hr_ticket&...
//   'other'      anything else
// A portal address is a short first path segment (the portal's URL suffix) plus an `id=` page parameter, in the query string or
// in a hash route (#/?id=...). The bare suffix of a well-known portal (/sp, /esc, /csm, /csp, /hrsp) is a portal home page.

import { portalParams } from './kinds.js';

// Suffixes of the portals ServiceNow ships. A customer's own portal has any other suffix and is recognised by its `id=` parameter.
const KNOWN_PORTAL_SUFFIXES = new Set(['sp', 'esc', 'ec', 'csm', 'csp', 'hrsp']);
// First path segments that are never a portal even when they carry an `id` parameter.
const NOT_PORTAL_SEGMENTS = new Set(['api', 'now', 'angular', 'images', 'scripts', 'styles', 'assets']);
const SUFFIX_RE = /^[a-z][a-z0-9_-]{0,30}$/i;
const PAGE_ID_RE = /^[a-z0-9_.-]{1,80}$/i;

function parse(href) {
  try {
    return new URL(String(href || ''));
  } catch {
    return null;
  }
}

function isClassicOrWorkspace(path) {
  if (/\.do$/i.test(path) || /\/now\/nav\/ui\/classic\//i.test(path)) return 'classic';
  if (/^\/now\//i.test(path) || /\/record\/[a-z][a-z0-9_]*\/[0-9a-f]{32}/i.test(path)) return 'workspace';
  return '';
}

/**
 * Where a portal page lives: { base: '/esc', pageId: 'ticket' } (the portal's URL suffix and the page id, lower case; pageId is
 * '' on a portal's home address). null when the address is not a portal page.
 */
export function portalInfo(href) {
  const url = parse(href);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (isClassicOrWorkspace(path)) return null;
  const first = path.split('/').filter(Boolean)[0] || '';
  if (!SUFFIX_RE.test(first) || NOT_PORTAL_SEGMENTS.has(first.toLowerCase())) return null;
  // Only the portal's own page (/esc?id=...) counts; a deeper path (/something/else?id=1) is not a portal address.
  if (path.split('/').filter(Boolean).length > 1) return null;
  const rawId = String(portalParams(url).get('id') || '').trim();
  const pageId = PAGE_ID_RE.test(rawId) ? rawId.toLowerCase() : '';
  if (!rawId && !KNOWN_PORTAL_SUFFIXES.has(first.toLowerCase())) return null;
  return { base: `/${first.toLowerCase()}`, pageId };
}

export function surfaceOf(href) {
  const url = parse(href);
  if (!url) return 'other';
  const kind = isClassicOrWorkspace(url.pathname.replace(/\/+$/, ''));
  if (kind) return kind;
  return portalInfo(href) ? 'portal' : 'other';
}
