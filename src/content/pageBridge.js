// Content-script side of the page-world bridge.
//
// Content scripts run in an isolated world: they share the DOM with the page but not its JavaScript globals, so
// window.g_form and window.g_ck are invisible here. The bridge (src/page/bridge.js) is registered as a MAIN-world content
// script on the same pages and answers promise-based RPC over CustomEvents on `document`.

const REQUEST_EVENT = 'ab-page-request';
const RESPONSE_EVENT = 'ab-page-response';
const DEFAULT_TIMEOUT_MS = 2500;

// Unguessable request ids, so a page script cannot answer a request it has not seen. (A script that listens to
// ab-page-request can still read the id, so bridge answers stay data to check, never authority.) Each id is answered at
// most once: the listener is removed on the first response, and later ones for it are ignored.
export function newRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `ab-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The request's `detail` as the page's own world can read it. In Firefox an object a content script makes stays in the content
 * script's world: the page bridge reading its `id` gets "Permission denied to access property" and never answers (found by the
 * Firefox end-to-end run, e2e/firefox). Firefox gives content scripts cloneInto for exactly this: a copy made in the page's world.
 * Chrome and Edge have no cloneInto and need none (a CustomEvent's detail reaches the page's world as a copy there), so they get the
 * object unchanged. The page then sees a request exactly as it does in Chrome (any page script can listen for one, see newRequestId,
 * which is why answers stay data to check), so the copy exposes nothing the design does not already assume.
 * @param {{ id: string, action: string, args: any[] }} detail
 * @param {object} [scope] the content script's global (a fake in tests)
 */
export function requestDetail(detail, scope = globalThis) {
  const clone = scope?.cloneInto;
  const view = scope?.document?.defaultView;
  return typeof clone === 'function' && view ? clone(detail, view) : detail;
}

/**
 * Call an action exposed by src/page/bridge.js: getCsrfToken, getSessionInfo, getFormMeta, getFormValues, getFieldStates,
 * getBoxValues, fillField (the list in the bridge itself is the one that counts).
 * @returns {Promise<any>}
 */
export function callPage(action, args = [], { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const id = newRequestId();
  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanup() {
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      clearTimeout(timer);
    }

    function onResponse(event) {
      const detail = event?.detail;
      if (settled || !detail || typeof detail !== 'object' || detail.id !== id) return;
      settled = true;
      cleanup();
      if (detail.ok) resolve(detail.result);
      else reject(new Error(detail.error || 'Page bridge call failed.'));
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`The page did not answer "${action}". Reload the page and try again.`));
    }, timeoutMs);

    document.addEventListener(RESPONSE_EVENT, onResponse);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: requestDetail({ id, action, args }) }));
  });
}

/** Convenience wrapper that resolves to null instead of throwing. */
export async function tryCallPage(action, args = []) {
  try {
    return await callPage(action, args);
  } catch {
    return null;
  }
}
