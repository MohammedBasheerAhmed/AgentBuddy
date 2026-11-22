import { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../../ask.js';
import { retryDelay } from '../useReport.js';
import { tm } from '../../../i18n/index.js';

// Kept in English and drawn with shown() (src/reports/shown.js), like every other text of a report.
const SESSION_TEXT = tm('You are signed out of ServiceNow. Sign in again, then try again.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read one weekly result ('myWeek' or 'weeklyReport', src/content/ops/weekly.js) through the content script of the ServiceNow tab and keep it in
 * memory (nothing is stored). `args` is plain JSON, or null for "nothing to read yet". A newer request replaces an older one and the answer
 * of the older one is dropped; while a new answer is on its way the old one stays on screen. A page that moves to another address while
 * the read runs is asked again (twice at most), as the other report reads do (useReport.js).
 * Returns { phase: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error', result, error, code, busy, reload(), refresh() }: `refresh` forgets the
 * page's short-lived cache first, so the numbers are read again from ServiceNow.
 */
export function useWeeklyRead({ tabId, op, args }) {
  const [state, setState] = useState({ phase: args ? 'loading' : 'idle', result: null, answered: '', error: '', code: '' });
  const generation = useRef(0);
  const key = args ? JSON.stringify(args) : '';

  const load = useCallback(
    async (fresh = false) => {
      if (!key) {
        setState({ phase: 'idle', result: null, answered: '', error: '', code: '' });
        return;
      }
      generation.current += 1;
      const mine = generation.current;
      setState((s) => ({ ...s, phase: s.result ? 'refreshing' : 'loading', error: '', code: '' }));
      for (let attempt = 0; ; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop -- a retry waits for the page to come back, one try at a time.
          if (fresh && attempt === 0) await read(tabId, 'weeklyClear', {});
          // eslint-disable-next-line no-await-in-loop
          const result = await read(tabId, op, JSON.parse(key));
          if (mine === generation.current) setState({ phase: 'ready', result, answered: key, error: '', code: '' });
          return;
        } catch (err) {
          if (mine !== generation.current) return;
          const wait = retryDelay(err, attempt);
          if (wait !== null) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(wait);
            if (mine !== generation.current) return;
            continue;
          }
          const expired = err.code === 'SESSION_EXPIRED';
          setState((s) => {
            // "the last read that worked" stays on screen only for this same request (a refresh): another week's numbers never sit under the new choice
            const kept = !expired && s.answered === key;
            return { phase: 'error', result: kept ? s.result : null, answered: kept ? s.answered : '', error: expired ? SESSION_TEXT : err.message || tm('This report could not be read.'), code: err.code || '' };
          });
          return;
        }
      }
    },
    [tabId, op, key]
  );

  useEffect(() => {
    load();
    return () => {
      generation.current += 1; // a closed view ignores its late answer
    };
  }, [load]);

  const reload = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);
  return { ...state, busy: state.phase === 'loading' || state.phase === 'refreshing', reload, refresh };
}
