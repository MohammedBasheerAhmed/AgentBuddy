import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async read when a tab opens (and again on demand). A newer run, or leaving the tab, makes an older answer that is
 * still on its way count for nothing.
 *
 *   const [state, reload] = useLoader(async () => ({ ... }), [record.sysId]);
 *   state = { phase: 'loading' | 'ready' | 'error', data, error }
 *
 * While reloading, the previous data stays in `data`, so the screen does not jump.
 */
export function useLoader(load, deps) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: '' });
  const token = useRef(0);

  const reload = useCallback(async () => {
    token.current += 1;
    const mine = token.current;
    setState((s) => ({ phase: 'loading', data: s.data, error: '' }));
    try {
      const data = await load();
      if (mine === token.current) setState({ phase: 'ready', data, error: '' });
    } catch (err) {
      if (mine === token.current) setState({ phase: 'error', data: null, error: err?.message || 'Something went wrong.' });
    }
    // `load` is a fresh closure on every render; the caller names what it really depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    reload();
    return () => {
      token.current += 1;
    };
  }, [reload]);

  return [state, reload];
}
