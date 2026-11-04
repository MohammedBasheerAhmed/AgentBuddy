// The answers of the Ticket screen, kept per ticket in memory (AI0.4). Pure: no React, no chrome.*; tests/assist-answers-store.test.js.
//
// Why memory only: an answer holds ticket text, names put back locally and the firewall's scan(). chrome.storage holds settings and
// configuration, never ticket content (docs/build-rules.md, rule 7). The store lives as long as the panel: closing the panel (or
// reloading it) forgets everything, and forget() clears it on purpose.
//
// Shape: key -> { answers: newest first }. A key names one ticket on one instance (see keyOf), so the same sys_id on two instances
// (out-of-the-box demo records share them) never mixes. Caps keep it small: `perRecord` answers per ticket (the oldest goes), and
// `records` tickets (the one looked at least recently goes, never the one being added to).

export const ANSWERS_PER_RECORD = 5;
export const RECORDS_KEPT = 10;

/** The key of one ticket: '<host>|<table>:<sysId>' ('' when there is no record). */
export function keyOf(page, record) {
  const rec = record || page?.record || null;
  if (!rec?.table || !rec?.sysId) return '';
  let host;
  try {
    host = new URL(page?.href || '').host;
  } catch {
    host = '';
  }
  return `${host}|${rec.table}:${rec.sysId}`;
}

/**
 * @param {{ perRecord?: number, records?: number, now?: () => number }} [options]
 */
export function createAnswerStore({ perRecord = ANSWERS_PER_RECORD, records = RECORDS_KEPT, now = () => Date.now() } = {}) {
  // A Map keeps insertion order: re-inserting a key on every touch makes the first key the one looked at least recently.
  const map = new Map();
  let seq = 0;
  let version = 0;
  const listeners = new Set();
  const changed = () => {
    version += 1;
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch {
        // a listener that throws must not stop the others
      }
    }
  };
  const touch = (key) => {
    const entry = map.get(key) || { answers: [] };
    map.delete(key);
    map.set(key, entry);
    return entry;
  };

  return {
    /** Add an answer for a ticket; returns its id. The newest is first; past the caps the oldest answers and tickets go. */
    add(key, answer) {
      if (!key) return '';
      seq += 1;
      const id = `a${seq}`;
      const entry = touch(key);
      entry.answers = [{ ...answer, id, at: answer?.at ?? now() }, ...entry.answers].slice(0, Math.max(1, perRecord));
      while (map.size > Math.max(1, records)) map.delete(map.keys().next().value);
      changed();
      return id;
    },
    /** The answers of a ticket, newest first ([] when none). Does not count as a look (see seen). */
    list(key) {
      return map.get(key)?.answers || [];
    },
    get(key, id) {
      return (map.get(key)?.answers || []).find((a) => a.id === id) || null;
    },
    /** Change one answer (only the fields given). */
    update(key, id, patch) {
      const entry = map.get(key);
      const at = entry ? entry.answers.findIndex((a) => a.id === id) : -1;
      if (at < 0) return false;
      entry.answers = entry.answers.map((a, i) => (i === at ? { ...a, ...patch, id: a.id } : a));
      changed();
      return true;
    },
    /** The person closed an answer. */
    remove(key, id) {
      const entry = map.get(key);
      if (!entry) return false;
      const before = entry.answers.length;
      entry.answers = entry.answers.filter((a) => a.id !== id);
      if (!entry.answers.length) map.delete(key);
      if (entry.answers.length !== before) changed();
      return entry.answers.length !== before;
    },
    /** The ticket is on screen: it becomes the one looked at most recently, and its answers are marked seen. */
    seen(key) {
      const entry = map.get(key);
      if (!entry) return;
      touch(key);
      if (entry.answers.some((a) => a.unseen)) {
        entry.answers = entry.answers.map((a) => (a.unseen ? { ...a, unseen: false } : a));
        changed();
      }
    },
    /** Forget one ticket's answers, or every answer. */
    forget(key) {
      if (key === undefined) map.clear();
      else map.delete(key);
      changed();
    },
    keys: () => [...map.keys()],
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    version: () => version,
  };
}
