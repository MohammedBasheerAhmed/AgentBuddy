import { useCallback, useEffect, useState } from 'react';
import { loadEffective, keyStore } from '../lib/storage.js';

/**
 * The effective settings (user choices with the organisation's policy on top) plus the AI key, kept fresh when storage
 * changes in another window or on the settings page. The key stays inside extension pages.
 */
export function useEffective() {
  const [state, setState] = useState({ ready: false, values: null, locked: {}, policy: null, apiKey: '', keyLocked: false });

  const refresh = useCallback(async () => {
    const eff = await loadEffective();
    const store = keyStore();
    // A key supplied by the organisation wins over a personal one.
    const apiKey = eff.values.providedApiKey || (await store.load(eff.values.provider));
    const keyLocked = !apiKey && (await store.isLocked(eff.values.provider));
    setState({ ready: true, values: eff.values, locked: eff.locked, policy: eff.policy, apiKey, keyLocked });
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  return { ...state, refresh };
}
