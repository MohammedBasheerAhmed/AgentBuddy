import { useCallback, useSyncExternalStore } from 'react';

// What the Knowledge screen's Insights half found that its AI Assist half works from: the duplicate group whose text was compared
// (for "Draft a merged article") and the knowledge-gap topics (for "Draft an article outline"). The two halves are drawn by the shell
// side by side, so they share it here, IN MEMORY only (docs/build-rules.md 7: nothing of it is stored), per ServiceNow instance:
// what was found on one instance is never offered on another. A panel reload forgets it.

const values = new Map(); // `${origin}|${name}` -> value
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The instance a page is on ('' when unknown). */
export function instanceOf(page) {
  try {
    return new URL(page?.href || '').origin;
  } catch {
    return '';
  }
}

/**
 * Where what a knowledge tool read belongs: the tab it was read through and the instance ('7|https://acme.service-now.com'). The
 * tools start over when it changes: their links, knowledge base ids and categories are the old instance's.
 */
export const placeOf = (page) => `${page?.tabId ?? ''}|${instanceOf(page)}`;

/** Forget everything (tests). */
export function clearShared() {
  values.clear();
  notify();
}

/** [value, set] for one shared value of the instance `page` is on. */
export function useShared(page, name) {
  const origin = instanceOf(page);
  const value = useSyncExternalStore(subscribe, () => values.get(`${origin}|${name}`) ?? null, () => null);
  const set = useCallback((next) => {
    const key = `${origin}|${name}`;
    if (next === null || next === undefined) values.delete(key);
    else values.set(key, next);
    notify();
  }, [origin, name]);
  return [value, set];
}
