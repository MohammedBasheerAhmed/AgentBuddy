import { useEffect, useState } from 'react';
import { read } from '../ask.js';

const NOTHING = { groups: [], note: '' };

/**
 * A search for assignment groups by name, as the person types (the dashboard's "Chosen groups" and the coaching snapshot's group):
 * from two letters on, 350 ms after the last key, with the person's own session (the content script's `reportGroups` read, src/content/
 * ops/reports.js). An answer that arrives after the text changed again is dropped.
 * @returns {{ text: string, setText: (text: string) => void, found: { groups: { id, name }[], note: string } }}
 */
export function useGroupSearch(tabId, blocked) {
  const [text, setText] = useState('');
  const [found, setFound] = useState(NOTHING);

  useEffect(() => {
    const search = text.trim();
    if (search.length < 2) {
      setFound(NOTHING);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      read(tabId, 'reportGroups', { search, blocked })
        .then((answer) => alive && setFound(answer))
        .catch((err) => alive && setFound({ groups: [], note: err.message }));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tabId, text, blocked]);

  return { text, setText, found };
}
