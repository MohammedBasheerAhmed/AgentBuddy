import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { DASHBOARDS_KEY, chromeLocalStorage, createDashboardStore, sanitizeState } from '../../reports/dashboards.js';

/** Which report tables the person can read, who they are, and their groups. Re-read when `refreshKey` changes. */
export function useReportContext({ tabId, blocked, refreshKey }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: '' });
  const key = JSON.stringify(blocked || []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, phase: s.data ? 'ready' : 'loading', error: '' }));
    read(tabId, 'reportContext', { blocked: JSON.parse(key) })
      .then((data) => alive && setState({ phase: 'ready', data, error: '' }))
      .catch((err) => alive && setState((s) => ({ phase: 'error', data: s.data, error: err.code === 'SESSION_EXPIRED' ? 'Your ServiceNow session has expired. Log in again, then press Refresh.' : err.message })));
    return () => {
      alive = false;
    };
  }, [tabId, key, refreshKey]);
  return state;
}

/**
 * The saved dashboards (configuration only), loaded from chrome.storage.local, kept in step with another open copy of the
 * dashboard (the side panel and the full page), and saved on every change.
 */
export function useDashboards() {
  const storeRef = useRef(null);
  const stateRef = useRef(null);
  const [info, setInfo] = useState({ ready: false, state: null, status: 'empty', saveFailed: false });

  useEffect(() => {
    let alive = true;
    const store = createDashboardStore({ storage: chromeLocalStorage() });
    storeRef.current = store;
    store.load().then(({ state, status }) => {
      if (!alive) return;
      stateRef.current = state;
      setInfo({ ready: true, state, status, saveFailed: false });
    });
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[DASHBOARDS_KEY] || !alive) return;
      const next = sanitizeState(changes[DASHBOARDS_KEY].newValue);
      if (next.status !== 'ok' || JSON.stringify(next.state) === JSON.stringify(stateRef.current)) return;
      stateRef.current = next.state;
      setInfo((i) => ({ ...i, state: next.state }));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** update((state) => newState): applies a pure change from src/reports/dashboards.js and saves it. */
  const update = useCallback((change) => {
    const current = stateRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    stateRef.current = next;
    setInfo((i) => ({ ...i, state: next }));
    storeRef.current?.save(next).then((saved) => {
      if (!saved) setInfo((i) => ({ ...i, saveFailed: true }));
    });
  }, []);

  return { ...info, update };
}
