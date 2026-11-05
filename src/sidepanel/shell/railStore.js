// The side rail's data, between the screens and the shell (App.jsx). Each screen publishes what its rail lists while it is on show
// (its id, a title, the items); the shell draws the rail of the screen on show. Without React, so it is tested as it is
// (tests/shell-rail.test.js).
//
// A screen publishes on every render, so a publish that changes nothing must change nothing: the shell is told only when what the rail
// draws changed (ids, names, icons, marks), never for a new click handler. Handlers are kept to one side and always the latest, so a
// click runs what the screen holds now.
//
// An item: { id, label, icon, attention: '' | 'warn' | 'danger', ai: boolean, current: boolean, disabled: boolean, separator: boolean,
//            onSelect() }. `separator`: a line is drawn above it (after the "All insights" / "Suggested" item that leads the list).

const ATTENTION = new Set(['warn', 'danger']);

/** What the rail draws for one screen, without the handlers: a plain object, the same for the same picture. */
export function railShape(rail) {
  if (!rail || !Array.isArray(rail.items)) return null;
  return {
    title: typeof rail.title === 'string' ? rail.title : '',
    items: rail.items
      .filter((it) => it && typeof it.id === 'string' && it.id && typeof it.label === 'string')
      .map((it) => ({
        id: it.id,
        label: it.label,
        icon: typeof it.icon === 'string' ? it.icon : '',
        attention: ATTENTION.has(it.attention) ? it.attention : '',
        ai: Boolean(it.ai),
        current: Boolean(it.current),
        disabled: Boolean(it.disabled),
        separator: Boolean(it.separator),
      })),
  };
}

const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createRailStore() {
  let state = {}; // screen id -> railShape
  const handlers = {}; // screen id -> { item id -> onSelect }
  const listeners = new Set();
  const notify = () => listeners.forEach((l) => l());
  const store = {
    /** A screen's rail as it is now. Tells the shell only when the picture changed. */
    publish(screen, rail) {
      const shape = railShape(rail);
      if (!shape || !shape.items.length) {
        store.clear(screen);
        return;
      }
      handlers[screen] = {};
      for (const it of rail.items) if (it && typeof it.onSelect === 'function') handlers[screen][it.id] = it.onSelect;
      if (sameShape(state[screen], shape)) return;
      state = { ...state, [screen]: shape };
      notify();
    },
    /** The screen has no rail now (it is hidden, or has nothing to list). */
    clear(screen) {
      delete handlers[screen];
      if (!(screen in state)) return;
      const next = { ...state };
      delete next[screen];
      state = next;
      notify();
    },
    /** A click on an item: the screen's latest handler for it. A disabled item does nothing. */
    select(screen, id) {
      const item = state[screen]?.items.find((it) => it.id === id);
      if (!item || item.disabled) return false;
      const run = handlers[screen]?.[id];
      if (typeof run !== 'function') return false;
      run();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
  };
  return store;
}
