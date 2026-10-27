import { useSyncExternalStore } from 'react';

// A result the agent wants to carry to ANOTHER form: "Open a new article form" navigates the tab away, which would lose the
// draft with the record it came from. The draft is kept here, in memory only (never in storage), under these rules:
//   - it belongs to the ServiceNow site (origin) it was written on, and is shown only there: a draft made on one customer's
//     instance is never offered on another's
//   - it is shown only on a blank form of the table the feature names
//   - it is dropped after 15 minutes, when the person closes it, and after it was inserted successfully
// It holds the text and the firewall's memory of the values it masked (`scan`), which is why it does not stay long.
// <PendingDraft> shows it.

export const MAX_AGE_MS = 15 * 60 * 1000;
let pending = null;
let timer = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

/** "https://acme.service-now.com" from an address, or '' (only https sites hold a draft). */
export function originOf(href) {
  try {
    const url = new URL(String(href || ''));
    return url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function drop() {
  clearTimeout(timer);
  timer = null;
  pending = null;
}

/**
 * @param {{ feature: object, text: string, people: object[], scan: Function|null, origin: string, internalTexts?: string[] }} draft
 * @returns {boolean} false when the draft was not kept (no known site to bind it to)
 */
export function setPending(draft) {
  if (!draft || !originOf(draft.origin)) {
    clearPending();
    return false;
  }
  drop();
  pending = { ...draft, origin: originOf(draft.origin), at: Date.now() };
  // The memory is released when the draft expires, even if nothing else happens in the panel.
  timer = setTimeout(() => {
    if (pending && Date.now() - pending.at >= MAX_AGE_MS) {
      drop();
      emit();
    }
  }, MAX_AGE_MS + 1000);
  timer.unref?.();
  emit();
  return true;
}

export function clearPending() {
  if (!pending) return;
  drop();
  emit();
}

export function getPending(now = Date.now()) {
  if (pending && now - pending.at > MAX_AGE_MS) drop();
  return pending;
}

/** Is this draft the one to show on this page? Same site, a blank form, of the table the feature names. */
export function pendingFits(draft, page) {
  const table = draft?.feature?.open?.table;
  if (!draft || !table || !draft.origin) return false;
  return page?.newRecord?.table === table && originOf(page.href) === draft.origin;
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// (the same snapshot is given for rendering on a server, so the card can be rendered to markup in tests)
const snapshot = () => getPending();
export const usePending = () => useSyncExternalStore(subscribe, snapshot, snapshot);
