// Small in-memory helpers for reports: a time-limited cache with in-flight sharing, and a limit on parallel requests.
// Nothing here touches storage: report numbers are never persisted, and "Refresh" empties the cache.

/**
 * A cache whose entries expire after `ttlMs`. `load(key, loader)` returns { value, at }: a fresh entry, or the one that is
 * already being loaded (two widgets asking for the same number share one request), or runs `loader`. A failed load is not kept.
 */
export function createCache({ ttlMs = 60000, max = 400, now = () => Date.now() } = {}) {
  const entries = new Map(); // key -> { value, at } | { promise }

  const fresh = (entry) => entry && entry.value !== undefined && now() - entry.at < ttlMs;

  function prune() {
    if (entries.size <= max) return;
    // Oldest first: a Map keeps insertion order.
    for (const key of entries.keys()) {
      if (entries.size <= max) break;
      if (!entries.get(key).promise) entries.delete(key);
    }
  }

  return {
    async load(key, loader) {
      const hit = entries.get(key);
      if (fresh(hit)) return hit;
      if (hit?.promise) return hit.promise;
      const promise = (async () => {
        try {
          const value = await loader();
          const entry = { value, at: now() };
          entries.set(key, entry);
          prune();
          return entry;
        } catch (err) {
          entries.delete(key);
          throw err;
        }
      })();
      entries.set(key, { promise });
      return promise;
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}

/** Run at most `max` jobs at once; the rest wait their turn in order. */
export function createLimiter(max = 4) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      job().finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push(() => Promise.resolve().then(task).then(resolve, reject));
        pump();
      });
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
