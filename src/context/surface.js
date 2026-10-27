// Which kind of ServiceNow page a tab is showing, from its address alone (the content script adds what the page tells it).
//   'classic'    the platform UI: /incident.do, /nav_to.do, /now/nav/ui/classic/...
//   'workspace'  Next Experience workspaces: /now/<workspace>/record/<table>/<sys_id>
//   'portal'     Service Portal, Employee Center, customer service portal and other portal themes: /sp?id=ticket&table=...
//   'other'      anything else
// Portal pages are the ones that carry an `id=` page parameter on a short first path segment and are not a .do page.

export function surfaceOf(href) {
  let url;
  try {
    url = new URL(String(href || ''));
  } catch {
    return 'other';
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (/\.do$/i.test(path) || /\/nav_to\.do$/i.test(path) || /\/now\/nav\/ui\/classic\//i.test(path)) return 'classic';
  if (/^\/now\//i.test(path) || /\/record\/[a-z][a-z0-9_]*\/[0-9a-f]{32}/i.test(path)) return 'workspace';
  const first = path.split('/').filter(Boolean)[0] || '';
  if (url.searchParams.has('id') && /^[a-z][a-z0-9_-]{0,30}$/i.test(first)) return 'portal';
  return 'other';
}
