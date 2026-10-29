import { useCallback, useEffect, useState } from 'react';
import { LAUNCH_KEY, LAUNCH_TTL_MS, freshLaunch } from '../lib/launch.js';

/**
 * The request the bar on the ServiceNow page left for the panel (src/lib/launch.js), or null. It is read when the panel opens (the
 * click that opened it may have come first) and whenever it changes (the panel was already open). `clear()` takes it back out of
 * storage: a request is used once. One that is not for the page on screen is simply not used and expires on its own.
 */
export function useLaunch() {
  const [launch, setLaunch] = useState(null);
  const area = typeof chrome !== 'undefined' ? chrome.storage?.session : null;

  const take = useCallback((raw) => setLaunch(freshLaunch(raw, Date.now())), []);

  useEffect(() => {
    if (!area) return undefined;
    let cancelled = false;
    area.get(LAUNCH_KEY).then((got) => !cancelled && take(got?.[LAUNCH_KEY])).catch(() => {});
    const onChange = (changes, areaName) => {
      if (areaName === 'session' && changes[LAUNCH_KEY]) take(changes[LAUNCH_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [area, take]);

  // A request nobody picked up stops counting when it is old.
  useEffect(() => {
    if (!launch) return undefined;
    const timer = setTimeout(() => setLaunch(null), Math.max(0, launch.at + LAUNCH_TTL_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [launch]);

  const clear = useCallback(() => {
    setLaunch(null);
    area?.remove(LAUNCH_KEY).catch(() => {});
  }, [area]);

  return { launch, clear };
}
