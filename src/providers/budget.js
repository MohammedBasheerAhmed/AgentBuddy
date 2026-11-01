// Storage side of AI usage and spend caps (the arithmetic is in src/lib/aiUsage.js). Runs in the side panel, the only page that
// makes model calls. Everything here fails soft: a storage problem must never stop a chat, so only
// a cap that is really reached refuses a call.
import { t } from '../i18n/index.js';
import { USAGE_KEY, PRICES_KEY, CAPS_KEY, appendEntry, makeEntry, checkCaps, priceKey, normalizeCaps } from '../lib/aiUsage.js';

const hasStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);

// Several panels (one per window) can finish a call at the same moment. Writes go through one queue per page and a Web Lock
// across pages, so none overwrites another's entry.
let queue = Promise.resolve();
const withLock = (fn) => (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('agentbuddy-usage', fn) : fn());

/** { log, prices, caps } as stored. */
export async function readBudgetState() {
  if (!hasStorage()) return { log: [], prices: {}, caps: {} };
  const stored = await chrome.storage.local.get([USAGE_KEY, PRICES_KEY, CAPS_KEY]);
  return { log: Array.isArray(stored[USAGE_KEY]) ? stored[USAGE_KEY] : [], prices: stored[PRICES_KEY] || {}, caps: stored[CAPS_KEY] || {} };
}

/** Throws a plain message when a cap for this provider is reached; returns the check (so callers can see "warn"). */
export async function assertWithinCaps(provider, now = new Date()) {
  let state;
  try {
    state = await readBudgetState();
  } catch {
    return { status: 'ok', items: [], worst: null, message: '' };
  }
  const result = checkCaps(state.log, state.caps, provider, now);
  if (result.status === 'blocked') {
    const err = new Error(result.message);
    err.code = 'BUDGET'; // what the audit log records (src/lib/pipeline.js errorReason)
    throw err;
  }
  return result;
}

/**
 * Save the person's own limits (Settings > Usage and limits). Only the fields in `patch` change; a blank or 0 means "no limit".
 * Returns the caps as they are now. Throws when the browser does not let it save (Settings shows that next to the field).
 */
export async function saveCaps(patch) {
  if (!hasStorage()) throw new Error(t('Settings cannot be saved here.'));
  return withLock(async () => {
    const stored = (await chrome.storage.local.get(CAPS_KEY))[CAPS_KEY];
    const next = normalizeCaps({ ...(stored && typeof stored === 'object' ? stored : {}), ...patch });
    await chrome.storage.local.set({ [CAPS_KEY]: next });
    return next;
  });
}

/** Log one finished call. Never throws. */
export function recordCall({ provider, model, ms, usage, host, kind, now = new Date() }) {
  if (!hasStorage()) return Promise.resolve();
  queue = queue
    .then(() =>
      withLock(async () => {
        const { log, prices } = await readBudgetState();
        const entry = makeEntry({ now, provider, model, ms, usage, price: prices[priceKey(provider, model)], host, kind });
        await chrome.storage.local.set({ [USAGE_KEY]: appendEntry(log, entry) });
      })
    )
    .catch(() => {});
  return queue;
}
