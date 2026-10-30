import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Run an async read when a tab opens (and again on demand). A newer run, or leaving the tab, makes an older answer that is
 * still on its way count for nothing.
 *
 *   const [state, reload] = useLoader(async () => ({ ... }), [record.sysId], { active });
 *   state = { phase: 'loading' | 'ready' | 'error', data, error }
 *
 * While reloading, the previous data stays in `data`, so the screen does not jump.
 * `active`: whether the tab is on show. A record's tabs stay mounted while another one is shown (what was chosen in them survives);
 * when a tab comes back into view it reads again, because what it checks may have changed meanwhile (the person typed in the form).
 */
export function useLoader(load, deps, { active = true } = {}) {
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

  // Shown again after a look at another tab: read again (the first read is the one above).
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);

  return [state, reload];
}
