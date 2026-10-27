// Same-origin REST calls made with only the session cookie get a 401 plus a Basic-auth challenge,
// which the browser shows as a login popup. Sending the session's X-UserToken avoids that, so a
// request is never sent without one.

import { callPage, tryCallPage } from './pageBridge.js';
import { SYS_ID_RE } from '../context/util.js';

const TOKEN_TTL_MS = 5 * 60 * 1000;
// g_ck = '...' in a script, or "g_ck":"..." in a JSON blob (portal pages ship their settings that way).
const TOKEN_RE = /\bg_ck['"]?\s*[=:]\s*['"]([0-9A-Za-z]{20,})['"]/;
let cached = { token: null, at: 0 };

function pageDocuments() {
  const docs = [document];
  try {
    const frameDoc = document.getElementById('gsft_main')?.contentDocument;
    if (frameDoc) docs.push(frameDoc);
  } catch {
    // Cross-origin frame; ignore.
  }
  return docs;
}

// Fallback when the page bridge is unavailable: the token is also in the page markup.
function tokenFromMarkup() {
  for (const doc of pageDocuments()) {
    const input = doc.querySelector('input[name="sysparm_ck"]');
    if (input?.value) return input.value;
    for (const script of doc.scripts) {
      const match = TOKEN_RE.exec(script.textContent || '');
      if (match) return match[1];
    }
  }
  return null;
}

/** The session token, or null when it cannot be read. */
export async function getSessionToken() {
  if (cached.token && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  let token = null;
  try {
    token = await callPage('getCsrfToken');
  } catch {
    // Bridge unavailable; try the markup.
  }
  token = token || tokenFromMarkup();
  if (token) cached = { token, at: Date.now() };
  return token;
}

/** Headers for a JSON request to the current instance. Throws rather than risk a login popup. */
export async function sessionHeaders(extra = {}) {
  const token = await getSessionToken();
  if (!token) {
    throw new Error('Could not read the ServiceNow session token. Reload the page and try again.');
  }
  return { Accept: 'application/json', 'X-UserToken': token, ...extra };
}

// ---- Who is signed in --------------------------------------------------------------------------------------------------

const text = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * What the page bridge says about the signed-in person, reduced to the four things Agent Buddy uses (user id, user name,
 * display name, roles) and checked: the answer comes from the page, so it is data, not authority.
 * @returns {{ userId: string, userName: string, name: string, roles: string[] }}
 */
export function cleanSessionInfo(info) {
  const o = info && typeof info === 'object' ? info : {};
  const id = text(o.userId, 40);
  const roles = Array.isArray(o.roles) ? o.roles.filter((r) => typeof r === 'string' && r).slice(0, 200).map((r) => r.slice(0, 80)) : [];
  return {
    userId: SYS_ID_RE.test(id) ? id.toLowerCase() : '',
    userName: text(o.userName),
    name: [text(o.firstName, 60), text(o.lastName, 60)].filter(Boolean).join(' ') || text(o.displayName),
    roles,
  };
}

// The dynamic filter "Me" that ships with every instance (sys_filter_option_dynamic): the same "is (dynamic) Me" the list
// filters use. The server resolves it to the signed-in user, so nothing is evaluated here and nothing is guessed.
const ME_FILTER = 'sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe';
const USER_TTL_MS = 10 * 60 * 1000;
const USER_RETRY_MS = 60 * 1000;
let lookedUp = null; // { at, user } from the last successful read
let lookupFailedAt = 0;
let lookingUp = null; // the read in flight, so overlapping requests share one

async function lookUpMe(queryTable, knownUserName) {
  // Two rows at most, and exactly one must come back: if the server ignored the filter, the first user it listed is NOT me.
  const rows = await queryTable('sys_user', ME_FILTER, ['sys_id', 'user_name', 'name'], { limit: 2 });
  if (rows.length !== 1) return null;
  const id = text(typeof rows[0].sys_id === 'object' ? rows[0].sys_id?.value : rows[0].sys_id, 40);
  const userName = text(rows[0].user_name);
  if (!SYS_ID_RE.test(id)) return null;
  // The page named the user already (just not the id): the two must agree.
  if (knownUserName && userName && knownUserName.toLowerCase() !== userName.toLowerCase()) return null;
  return { userId: id.toLowerCase(), userName, name: text(rows[0].name), roles: [] };
}

/**
 * Who is signed in. The page bridge answers first (g_user on classic and Workspace pages; on a portal page the NOW object or the
 * Angular root scope). When the page gives no user id, ONE small GET asks the instance who "Me" is (3 columns of the person's own
 * sys_user row, with the same session as every other read). That answer is kept for ten minutes; a failed attempt is not repeated
 * for one minute. `queryTable` is injected (src/content/tableApi.js), so this file stays free of network code.
 * userId is '' when nobody could be identified.
 */
export async function getSessionUser({ queryTable } = {}) {
  const fromPage = cleanSessionInfo(await tryCallPage('getSessionInfo'));
  if (fromPage.userId || typeof queryTable !== 'function') return fromPage;
  const now = Date.now();
  if (lookedUp && now - lookedUp.at < USER_TTL_MS) return { ...fromPage, userId: lookedUp.user.userId, userName: fromPage.userName || lookedUp.user.userName, name: fromPage.name || lookedUp.user.name };
  if (now - lookupFailedAt < USER_RETRY_MS) return fromPage;
  if (!lookingUp) {
    lookingUp = lookUpMe(queryTable, fromPage.userName)
      .then((user) => {
        if (user) lookedUp = { at: Date.now(), user };
        else lookupFailedAt = Date.now();
        return user;
      })
      .catch(() => {
        lookupFailedAt = Date.now();
        return null;
      })
      .finally(() => {
        lookingUp = null;
      });
  }
  const user = await lookingUp;
  return user ? { ...fromPage, userId: user.userId, userName: fromPage.userName || user.userName, name: fromPage.name || user.name } : fromPage;
}

/** Forget what was looked up (tests, and a changed session). */
export function resetSessionUser() {
  lookedUp = null;
  lookupFailedAt = 0;
  lookingUp = null;
}
