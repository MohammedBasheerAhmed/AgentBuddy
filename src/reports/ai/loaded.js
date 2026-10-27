// A small, read-only window onto the results the dashboard's widgets have ALREADY loaded, so "Explain this dashboard" explains
// the numbers the lead is looking at without asking the instance again. Memory only: a widget puts its result here when it
// arrives and takes it out when it goes away; nothing is written to storage and nothing is ever read from the instance here.
//
// The store is created once per dashboard (ReportsDashboard.jsx) and handed to the widgets through `env.loaded`.
// `snapshot()` returns the same array until something changes, which is what React's useSyncExternalStore needs.

export function createLoadedStore() {
  let entries = []; // [{ id, section, result }] in the order they first arrived
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn());

  return {
    /** Remember (or replace) the result a widget is showing. A widget with no result yet is not remembered. */
    set(id, section, result) {
      if (!id || !section) return;
      if (!result) {
        this.remove(id);
        return;
      }
      const at = entries.findIndex((e) => e.id === id);
      if (at >= 0 && entries[at].result === result && entries[at].section === section) return;
      entries = at >= 0 ? entries.map((e, i) => (i === at ? { id, section, result } : e)) : [...entries, { id, section, result }];
      emit();
    },
    /** Forget a widget's result (it was removed from the dashboard). */
    remove(id) {
      if (!entries.some((e) => e.id === id)) return;
      entries = entries.filter((e) => e.id !== id);
      emit();
    },
    /** Forget everything (the dashboard shown was switched). */
    clear() {
      if (!entries.length) return;
      entries = [];
      emit();
    },
    snapshot: () => entries,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
