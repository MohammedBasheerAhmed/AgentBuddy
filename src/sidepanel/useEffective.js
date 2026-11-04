import { useCallback, useEffect, useRef, useState } from 'react';
import { loadEffective, keyStore } from '../lib/storage.js';
import { settingsChangeMatters } from '../lib/settingsChanges.js';
import { setReadPolicy } from './ask.js';

/**
 * The effective settings (user choices with the organisation's policy on top) plus the AI key, kept fresh when storage
 * changes in another window or on the settings page. The key stays inside extension pages. Only a change to the settings, the
 * policy or the key reloads them (src/lib/settingsChanges.js): the activity log written after every run and insert does not.
 */
export function useEffective() {
  const [state, setState] = useState({ ready: false, values: null, locked: {}, policy: null, apiKey: '', keyLocked: false });
  // Two refreshes can overlap (two saves in quick succession) and finish in either order: only the last one started may land, or
  // the older settings would win and stay until the next change.
  const newest = useRef(0);

  const refresh = useCallback(async () => {
    newest.current += 1;
    const mine = newest.current;
    const eff = await loadEffective();
    if (mine !== newest.current) return;
    setReadPolicy(eff.policy); // every READ sent to the page carries the organisation's policy (see ask.js)
    const store = keyStore();
    // A key supplied by the organisation wins over a personal one.
    const apiKey = eff.values.providedApiKey || (await store.load(eff.values.provider));
    const keyLocked = !apiKey && (await store.isLocked(eff.values.provider));
    if (mine !== newest.current) return;
    setState({ ready: true, values: eff.values, locked: eff.locked, policy: eff.policy, apiKey, keyLocked });
  }, []);

  useEffect(() => {
    refresh();
    const onChange = (changes, areaName) => {
      if (settingsChangeMatters(changes, areaName)) refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);

  return { ...state, refresh };
}
