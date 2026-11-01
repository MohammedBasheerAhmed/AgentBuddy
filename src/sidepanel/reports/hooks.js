import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { retryDelay } from './useReport.js';
import { DASHBOARDS_KEY, chromeLocalStorage, createDashboardStore, stateForInstance } from '../../reports/dashboards.js';

/**
 * Which report tables the person can read, who they are, their groups and their time zone. Re-read when `refreshKey` changes.
 * `allowSensitive`: ask for HR tables too (the HR profile is on and the organisation allows HR content; the content script checks).
 * `code` is the error's code ('SESSION_EXPIRED' when the ServiceNow session ended).
 */
export function useReportContext({ tabId, blocked, refreshKey, allowSensitive = false }) {
  const [state, setState] = useState({ phase: 'loading', data: null, error: '', code: '' });
  const key = JSON.stringify({ blocked: blocked || [], allowSensitive: allowSensitive === true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, phase: s.data ? 'ready' : 'loading', error: '', code: '' }));
    (async () => {
      for (let attempt = 0; alive; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one try at a time
          const data = await read(tabId, 'reportContext', JSON.parse(key));
          if (alive) setState({ phase: 'ready', data, error: '', code: '' });
          return;
        } catch (err) {
          // The ServiceNow page was being replaced: wait for the new one and ask again (see useReport.js).
          const wait = retryDelay(err, attempt);
          if (wait !== null) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, wait));
            continue;
          }
          if (alive) setState((s) => ({ phase: 'error', data: s.data, error: err.code === 'SESSION_EXPIRED' ? 'Your ServiceNow session has expired. Log in again, then press Refresh.' : err.message, code: err.code || '' }));
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [tabId, key, refreshKey]);
  return state;
}

/**
 * The saved dashboards of ONE instance (configuration only), loaded from chrome.storage.local, kept in step with another open copy
 * of the dashboard (the side panel and the full page), and saved on every change.
 *   instance: the instance key (instanceKey(page.href)); lead: the person works as a team lead (the first dashboard shown)
 *   org: the organisation's dashboard (policy `defaultDashboard`, a layout), first and on show for someone with no dashboards yet
 */
export function useDashboards({ instance = '', lead = false, org = null } = {}) {
  const storeRef = useRef(null);
  const stateRef = useRef(null);
  const [info, setInfo] = useState({ ready: false, state: null, status: 'empty', saveFailed: false });
  // Compared by value: the policy is read again from time to time, and a new object with the same dashboard changes nothing.
  const orgKey = org ? JSON.stringify(org) : '';

  useEffect(() => {
    let alive = true;
    const store = createDashboardStore({ storage: chromeLocalStorage(), instance, lead, org: orgKey ? JSON.parse(orgKey) : null });
    storeRef.current = store;
    store.load().then(({ state, status }) => {
      if (!alive) return;
      stateRef.current = state;
      setInfo({ ready: true, state, status, saveFailed: false });
    });
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[DASHBOARDS_KEY] || !alive) return;
      const next = stateForInstance(changes[DASHBOARDS_KEY].newValue, instance);
      if (!next || next.status !== 'ok' || JSON.stringify(next.state) === JSON.stringify(stateRef.current)) return;
      stateRef.current = next.state;
      setInfo((i) => ({ ...i, state: next.state }));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
    // The role only decides the first dashboard of a first run; a new instance is a new set of dashboards. The organisation's dashboard
    // arriving (or changing) reads again, so someone with nothing saved yet starts with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, orgKey]);

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

/**
 * The time now, updated once a minute while `on`: lists that say "due in 1 h 20 min" stay right while they are on screen without
 * reading anything again.
 */
export function useMinuteClock(on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}
