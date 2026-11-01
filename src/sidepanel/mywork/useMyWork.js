import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { retryDelay } from '../reports/useReport.js';
import { activeProfiles } from '../../profiles/profiles.js';

// Reading My work: one READ ('myWork', src/content/ops/mywork.js) that brings the queue, the approvals and the group queue together.
//
//   - read when the screen is first shown, and again when it is shown after STALE_MS (5 minutes): what is on screen is never older
//     than that without saying so ("Read 7 min ago")
//   - optional refresh every STALE_MS while the screen is on show (the person switches it on; remembered for the browser session)
//   - a read that takes longer than SLOW_MS says what it waits for, and can be stopped; "Try again" starts it over. A stopped or
//     replaced read's late answer is dropped. While a new read runs, the last answer stays on screen.
//   - nothing is stored: the answer lives in this hook's state and goes when the panel closes.

export const STALE_MS = 5 * 60 * 1000;
export const SLOW_MS = 3000;
const TICK_MS = 30000;
const AUTO_KEY = 'ab-mywork-auto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function remembered(key) {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function remember(key, on) {
  try {
    sessionStorage.setItem(key, on ? '1' : '0');
  } catch {
    // no session storage (a test, a locked-down browser): the choice lasts until the panel closes
  }
}

/**
 * @param {{ page: object, eff: object, active: boolean }} props `active`: the screen is on show
 * @returns {{ phase: 'idle'|'loading'|'ready'|'error', data, error, readAt, slow, stopped, auto, now,
 *   load(), stop(), setAuto(on) }}
 */
export function useMyWork({ page, eff, active }) {
  const [state, setState] = useState({ phase: 'idle', data: null, error: null, readAt: 0, slow: false, stopped: false });
  const [auto, setAutoState] = useState(() => remembered(AUTO_KEY));
  const [now, setNow] = useState(() => Date.now());
  const run = useRef(0);
  const phase = useRef('idle');
  phase.current = state.phase;

  const tabId = page?.tabId;
  const profiles = activeProfiles(eff);
  const allowSensitive = Boolean(eff?.policy?.allowHrContent);
  // Another tab, another instance in the same tab, other profiles or another HR rule: what is on screen is not this person's view.
  let origin = '';
  try {
    origin = new URL(page?.href || '').origin;
  } catch {
    origin = '';
  }
  const argsKey = `${tabId}|${origin}|${profiles.join(',')}|${allowSensitive}`;

  const load = useCallback(async () => {
    run.current += 1;
    const mine = run.current;
    setState((s) => ({ ...s, phase: 'loading', error: null, slow: false, stopped: false }));
    const slowTimer = setTimeout(() => {
      if (mine === run.current) setState((s) => ({ ...s, slow: true }));
    }, SLOW_MS);
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one try at a time
          const answer = await read(tabId, 'myWork', { profiles, allowSensitive });
          if (mine === run.current) {
            const at = Date.now();
            setNow(at);
            setState({ phase: 'ready', data: answer, error: null, readAt: at, slow: false, stopped: false });
          }
          return;
        } catch (err) {
          if (mine !== run.current) return;
          // The ServiceNow page was being replaced while it read: wait for the new page and ask again (twice at most).
          const wait = retryDelay(err, attempt);
          if (wait !== null) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(wait);
            if (mine !== run.current) return;
            continue;
          }
          setState((s) => ({ ...s, phase: 'error', error: err, slow: false }));
          return;
        }
      }
    } finally {
      clearTimeout(slowTimer);
    }
    // argsKey stands for tabId, profiles and allowSensitive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argsKey]);

  /** Stop waiting: the read's answer, when it comes, is dropped. What was on screen stays. */
  const stop = useCallback(() => {
    run.current += 1;
    setState((s) => ({ ...s, phase: s.data ? 'ready' : 'idle', slow: false, stopped: true }));
  }, []);

  // Shown (again): read when there is nothing yet or what there is is older than STALE_MS. A new tab or other profiles: read again.
  const lastKey = useRef('');
  useEffect(() => {
    if (!active) return;
    const changed = lastKey.current !== argsKey;
    lastKey.current = argsKey;
    const fresh = state.readAt && Date.now() - state.readAt < STALE_MS;
    if (phase.current === 'loading' && !changed) return;
    if (changed || !fresh) load();
    // state.readAt is read on purpose without being a dependency: only showing the screen (or new arguments) starts a read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, argsKey, load]);

  // Refresh every STALE_MS while on show, when the person asked for it.
  useEffect(() => {
    if (!active || !auto) return undefined;
    const timer = setInterval(() => {
      if (phase.current !== 'loading') load();
    }, STALE_MS);
    return () => clearInterval(timer);
  }, [active, auto, load]);

  // "Read 3 min ago" keeps up while on show.
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // A late answer for a closed view is dropped.
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const setAuto = useCallback((on) => {
    remember(AUTO_KEY, on);
    setAutoState(Boolean(on));
  }, []);

  return { ...state, auto, now, load, stop, setAuto };
}
