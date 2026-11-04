// One read per record and question, shared by every Insights card that needs it, kept IN MEMORY only (build rule 7: no ticket
// content in storage). The Glance reads the ticket's facts once; the risk, missing-details, journey and email cards use the same
// answer instead of asking again. Pure apart from the clock, which is injected.
//
//   const store = createInsightStore({ now: Date.now });
//   store.get(key, load, { maxAgeMs, force }) -> Promise<value>   a fresh value is reused, a read on its way is joined
//   store.peek(key) -> { value, at, error } | null                 what is there now (a folded card draws its summary from it)
//   store.subscribe(key, fn) -> unsubscribe                       fn(entry) when a read of the key starts or settles, and
//                                                                 fn(null) when clear() drops it
//   store.clear(prefix?)                                          drop every entry (or those whose key starts with prefix)
//
// Entries are dropped oldest first beyond `max`, and on clear(): Settings' "Clear everything" or a site turned off
// (src/sidepanel/forgetOnClear.js). clear() tells the subscribers of every key it drops, so a card on screen lets go of what it
// showed then and there.

export function createInsightStore({ now = Date.now, max = 120 } = {}) {
  const entries = new Map(); // key -> { value, error, at, pending }
  const listeners = new Map(); // key -> Set<fn>

  const notify = (key) => {
    const entry = entries.get(key);
    for (const fn of listeners.get(key) || []) {
      try {
        fn(entry || null);
      } catch {
        /* a listener that throws must not stop the others */
      }
    }
  };

  const trim = () => {
    while (entries.size > max) entries.delete(entries.keys().next().value);
  };

  function get(key, load, { maxAgeMs = 120000, force = false } = {}) {
    const entry = entries.get(key);
    if (entry?.pending) return entry.pending;
    if (!force && entry && !entry.error && now() - entry.at <= maxAgeMs) return Promise.resolve(entry.value);
    const pending = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (entries.get(key)?.pending !== pending) return value; // cleared or replaced meanwhile
          entries.delete(key); // re-insert: newest last, for the oldest-first trim
          entries.set(key, { value, error: null, at: now(), pending: null });
          trim();
          notify(key);
          return value;
        },
        (error) => {
          if (entries.get(key)?.pending === pending) {
            // A failed read keeps the last good value on screen, with the error next to it.
            const before = entries.get(key);
            entries.set(key, { value: before?.value, error, at: before?.at ?? 0, pending: null });
            notify(key);
          }
          throw error;
        }
      );
    entries.set(key, { value: entry?.value, error: null, at: entry?.at ?? 0, pending });
    notify(key);
    return pending;
  }

  function peek(key) {
    const entry = entries.get(key);
    return entry ? { value: entry.value, error: entry.error, at: entry.at, loading: Boolean(entry.pending) } : null;
  }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => {
      const set = listeners.get(key);
      set?.delete(fn);
      if (set && !set.size) listeners.delete(key);
    };
  }

  function clear(prefix = '') {
    const dropped = [...entries.keys()].filter((key) => !prefix || key.startsWith(prefix));
    for (const key of dropped) entries.delete(key);
    // After every entry is gone, so a listener that peeks at another key finds that one gone too. (A read still on its way finds
    // its entry gone when it answers and stores nothing: see get.)
    for (const key of dropped) notify(key);
  }

  return { get, peek, subscribe, clear, size: () => entries.size };
}
