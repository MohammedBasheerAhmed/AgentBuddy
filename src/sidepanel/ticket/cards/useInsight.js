import { useCallback, useEffect, useRef, useState } from 'react';
import { createInsightStore } from '../../../insights/cache.js';

// The reads behind the Insights cards, shared in panel memory (src/insights/cache.js): one read per record and question, joined by
// every card that needs it. A card reads only while it is `active` (open, with the Insights half on screen); a folded card still
// draws its one-line summary from what is already there (the Glance reads the ticket's facts for everyone).

export const insightStore = createInsightStore();

/** The part of a key that names the record: the tab and the record, so two tabs on the same ticket do not mix. */
export const recordKey = (page, record) => `${page?.tabId}|${record?.table}:${String(record?.sysId || '').toLowerCase()}`;

const toState = (entry) => {
  if (!entry) return { phase: 'idle', data: null, error: null, at: 0 };
  if (entry.loading) return { phase: 'loading', data: entry.value ?? null, error: null, at: entry.at };
  if (entry.error) return { phase: 'error', data: entry.value ?? null, error: entry.error, at: entry.at };
  return { phase: 'ready', data: entry.value ?? null, error: null, at: entry.at };
};

/**
 * One shared read.
 *   key        the store key ('' for "nothing to read")
 *   load       async () => value (only called when the store has no fresh value)
 *   active     read now (the first time, and again when shown again if older than maxAgeMs)
 *   maxAgeMs   how long a value counts as fresh
 *   refreshOnShow  read again every time the card is shown again (a check of the form, which the agent may have changed)
 * returns { phase: 'idle'|'loading'|'ready'|'error', data, error, at, reload() }. While it reads again, the last data stays.
 */
export function useInsight({ key, load, active = true, maxAgeMs = 120000, refreshOnShow = false }) {
  const [state, setState] = useState(() => toState(key ? insightStore.peek(key) : null));
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) {
      setState(toState(null));
      return undefined;
    }
    setState(toState(insightStore.peek(key)));
    return insightStore.subscribe(key, (entry) => setState(toState(entry)));
  }, [key]);

  const run = useCallback(
    (force) => (key ? insightStore.get(key, () => loadRef.current(), { maxAgeMs, force }).catch(() => undefined) : Promise.resolve(undefined)),
    [key, maxAgeMs]
  );

  const shown = useRef(false);
  useEffect(() => {
    if (!active || !key) {
      shown.current = false;
      return;
    }
    const again = !shown.current && refreshOnShow && insightStore.peek(key)?.at > 0;
    shown.current = true;
    run(Boolean(again));
  }, [active, key, run, refreshOnShow]);

  const reload = useCallback(() => run(true), [run]);
  return { ...state, reload };
}

// A read that could not see everything it asked for: denied, failed, blocked by the policy, or zero rows that may be hidden rows.
const NOT_SEEN = new Set(['denied', 'error', 'blocked', 'empty-or-hidden']);

/**
 * Did a read see everything it looked at (no access entry says otherwise)? A card says "nothing to report" ('clear', which files it
 * under "All clear in ...") only then: "you cannot read knowledge articles" is not "no article matches".
 * @param {...(object[]|undefined)} lists access entries ({ status }) of the reads the card relies on
 */
export const readFully = (...lists) => lists.every((list) => !Array.isArray(list) || !list.some((a) => NOT_SEEN.has(a?.status)));

/** Call fn(value) whenever value changes (for setSummary / setAttention, whose identity is stable). */
export function useReport(fn, value) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    fnRef.current?.(value);
  }, [value]);
}
