import { useSyncExternalStore } from 'react';

// A result the agent wants to carry to ANOTHER form: "Open a new article form" navigates the tab away, which would lose the
// draft with the record it came from. The draft is kept here, in memory only (never in storage), until it is used, dismissed
// or an hour has passed. It is shown by <PendingDraft> when the tab shows a blank form of the table the feature names.

const MAX_AGE_MS = 60 * 60 * 1000;
let pending = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

/** @param {{ feature: object, text: string, people: object[], scan: Function|null }} draft */
export function setPending(draft) {
  pending = { ...draft, at: Date.now() };
  emit();
}

export function clearPending() {
  if (!pending) return;
  pending = null;
  emit();
}

export function getPending(now = Date.now()) {
  if (pending && now - pending.at > MAX_AGE_MS) pending = null;
  return pending;
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const usePending = () => useSyncExternalStore(subscribe, () => getPending());
