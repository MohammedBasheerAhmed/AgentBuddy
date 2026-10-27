import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';

const SESSION_TEXT = 'Your ServiceNow session has expired. Log in again, then press Refresh.';
const STALE = Symbol('stale');

/**
 * Run one report through the content script of the ServiceNow tab and keep its result. The request is plain JSON
 * ({ kind, section, scope, tables, params, config, blocked }); the answer is the JSON the engine returns. A newer request
 * (or a new refreshKey) replaces an older one, and an answer that arrives late for an old request is ignored. While a new
 * answer is on its way the old one stays on screen, marked busy.
 *
 * request === null means "nothing to read yet" (for example no table is available).
 * limiter (optional) lets the dashboard start only a couple of widgets at a time, in order, so a widget's time limit is not
 * spent waiting behind the others; a widget that was closed or replaced while it waited never starts.
 */
export function useReport({ tabId, request, refreshKey = 0, limiter }) {
  const [state, setState] = useState({ phase: request ? 'loading' : 'idle', result: null, error: '', code: '' });
  const generation = useRef(0);
  const key = request ? JSON.stringify(request) : '';

  const load = useCallback(async () => {
    if (!key) {
      setState({ phase: 'idle', result: null, error: '', code: '' });
      return;
    }
    generation.current += 1;
    const mine = generation.current;
    setState((s) => ({ ...s, phase: s.result ? 'refreshing' : 'loading', error: '', code: '' }));
    const go = () => (mine === generation.current ? read(tabId, 'reportRun', JSON.parse(key)) : STALE);
    try {
      const result = await (limiter ? limiter.run(go) : go());
      if (result !== STALE && mine === generation.current) setState({ phase: 'ready', result, error: '', code: '' });
    } catch (err) {
      if (mine !== generation.current) return;
      const expired = err.code === 'SESSION_EXPIRED';
      setState((s) => ({ phase: 'error', result: expired ? null : s.result, error: expired ? SESSION_TEXT : err.message || 'This report could not be read.', code: err.code || '' }));
    }
  }, [tabId, key, limiter]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1; // a closed widget ignores its late answer
    };
  }, [load, refreshKey]);

  return { ...state, busy: state.phase === 'loading' || state.phase === 'refreshing', reload: load };
}
