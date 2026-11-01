// N3: the link to a knowledge article that the agent copies for the customer. The customer does not use the agent's form view, so
// the link is the article's own reading page: on a portal the portal's article page, otherwise the classic article view
// (kb_view.do), which ServiceNow sends to the portal for people without the classic UI. Built from the page's own origin and the
// article NUMBER (checked), never from text in the ticket. Pure.

import { SYS_ID_RE } from '../context/util.js';

const KB_NUMBER = /^KB\d{4,12}$/;
const PORTAL_SEGMENT = /^\/[a-z][a-z0-9_-]{0,30}$/i;

/** '' when it cannot be built safely. */
export function articleShareUrl(page, { number, sysId } = {}) {
  let origin;
  let first = '';
  try {
    const url = new URL(page?.href);
    if (!/^https?:$/.test(url.protocol)) return '';
    origin = url.origin;
    first = `/${url.pathname.split('/').filter(Boolean)[0] || ''}`;
  } catch {
    return '';
  }
  const n = String(number || '').trim().toUpperCase();
  if (KB_NUMBER.test(n)) {
    if (page?.surface === 'portal') {
      const base = typeof page.portal?.base === 'string' && PORTAL_SEGMENT.test(page.portal.base) ? page.portal.base.toLowerCase() : PORTAL_SEGMENT.test(first) ? first.toLowerCase() : '/sp';
      return `${origin}${base}?id=kb_article_view&sysparm_article=${n}`;
    }
    return `${origin}/kb_view.do?sysparm_article=${n}`;
  }
  if (SYS_ID_RE.test(String(sysId || ''))) return `${origin}/kb_view.do?sys_kb_id=${String(sysId).toLowerCase()}`;
  return '';
}
