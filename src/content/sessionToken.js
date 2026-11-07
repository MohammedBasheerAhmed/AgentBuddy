// Same-origin REST calls made with only the session cookie get a 401 plus a Basic-auth challenge,
// which the browser shows as a login popup. Sending the session's X-UserToken avoids that, so a
// request is never sent without one.

import { callPage, tryCallPage } from './pageBridge.js';
import { tm } from '../context/access.js';
import { SYS_ID_RE } from '../context/util.js';

const TOKEN_TTL_MS = 5 * 60 * 1000;
// g_ck = '...' in a script, or "g_ck":"..." in a JSON blob (portal pages ship their settings that way).
const TOKEN_RE = /\bg_ck['"]?\s*[=:]\s*['"]([0-9A-Za-z]{20,})['"]/;
let cached = { token: null, at: 0 };

// The page itself and the classic form's frame. On Next Experience the frame sits inside the page's shadow DOM, where
// document.getElementById('gsft_main') does not find it; the window's named frames do (seen on dev364920), so that comes first.
function pageDocuments() {
  const docs = [document];
  const add = (frameDoc) => {
    if (frameDoc && !docs.includes(frameDoc)) docs.push(frameDoc);
  };
  try {
    add(window.frames.gsft_main?.document);
  } catch {
    // Cross-origin frame; ignore.
  }
  try {
    add(document.getElementById('gsft_main')?.contentDocument);
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

/**
 * Drop the kept token. Called when the instance says the session ended (a 401, a login page): the token belonged to that session,
 * and keeping it would send a refused token with every read for up to five minutes after the person signed in again.
 */
export function forgetSessionToken() {
  cached = { token: null, at: 0 };
  // The session ended, and whoever signs in next may be someone else: "Me" is looked up again for them (R-16).
  resetSessionUser();
}

/** Headers for a JSON request to the current instance. Throws rather than risk a login popup. */
export async function sessionHeaders(extra = {}) {
  const token = await getSessionToken();
  if (!token) {
    const err = new Error(tm('Agent Buddy could not read from this ServiceNow page. Reload the page (sign in again if it asks), then try again.'));
    err.code = 'NO_SESSION_TOKEN';
    throw err;
  }
  return { Accept: 'application/json', 'X-UserToken': token, ...extra };
}

// ---- Who is signed in --------------------------------------------------------------------------------------------------

const text = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * What the page bridge says about the signed-in person, reduced to the four things Agent Buddy uses (user id, user name,
 * display name, roles) and checked: the answer comes from the page, so it is data, not authority.
 * @returns {{ userId: string, userName: string, name: string, roles: string[] | null }} roles: null when the page did not say (unknown is not the same as none)
 */
export function cleanSessionInfo(info) {
  const o = info && typeof info === 'object' ? info : {};
  const id = text(o.userId, 40);
  const roles = Array.isArray(o.roles) ? o.roles.filter((r) => typeof r === 'string' && r).slice(0, 200).map((r) => r.slice(0, 80)) : null;
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
let lookedUp = null; // { at, user, token } from the last successful read (token: the session it was asked in)
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
  return { userId: id.toLowerCase(), userName, name: text(rows[0].name), roles: null };
}

// Is the kept answer to "who is Me" still about the person at the screen? Not when the page names a user and it is not the one that was
// looked up, nor when the session it was asked in is not the one now (another sign-in has another token). The answer is kept ten minutes
// only to save a read; it must never be a previous person's id for My work or the reports (R-16).
function lookupStillMine(found, fromPage) {
  if (fromPage.userName && found.user.userName && fromPage.userName.toLowerCase() !== found.user.userName.toLowerCase()) return false;
  if (found.token && cached.token && found.token !== cached.token) return false;
  return true;
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
  if (lookedUp && !lookupStillMine(lookedUp, fromPage)) resetSessionUser();
  if (lookedUp && now - lookedUp.at < USER_TTL_MS) return { ...fromPage, userId: lookedUp.user.userId, userName: fromPage.userName || lookedUp.user.userName, name: fromPage.name || lookedUp.user.name };
  if (now - lookupFailedAt < USER_RETRY_MS) return fromPage;
  if (!lookingUp) {
    lookingUp = lookUpMe(queryTable, fromPage.userName)
      .then((user) => {
        if (user) lookedUp = { at: Date.now(), user, token: cached.token };
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
