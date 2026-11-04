import { useCallback, useRef, useState } from 'react';

// What the Insights cards report about the record on screen: each card's one-line summary and its status. The Insights half draws
// them on its rows (the summary without opening a card, the status as the row's dot); the top of the Ticket screen reads the ones
// that need a look for "Needs you now". Kept in the Ticket screen, so both see the same reports.
//
// The reports carry the record they were made for: { key, cards: card id -> { summary, attention } }. A set left from the last record
// is not shown, and the first report for a new record starts a fresh one. (Not an effect that empties them when the record changes:
// the cards' effects run before such an effect, so it would wipe what a card had just reported from memory, and with it every
// folded card's one line.)

const NO_REPORTS = Object.freeze({});

// A card's status: 'danger' or 'warn' (it needs a look), 'ok' (good news: a fix was found), 'clear' (nothing to report: the card
// goes into the last row, "All clear in ..."), '' (plain information).
const LEVELS = Object.freeze(['danger', 'warn', 'ok', 'clear']);

/** The status a card reported, or '' for anything else. */
export const levelOf = (value) => (LEVELS.includes(value) ? value : '');

/**
 * The reports of the record with this key, and one stable pair of setters per card (so a card can call them from its effects
 * without causing a loop). A report belongs to the record on screen when it is made (a card is a new one for every record:
 * src/sidepanel/ticket/cards/index.js perRecord).
 * @returns {{ cards: Record<string, { summary?: string, attention?: string }>, settersFor(id): { setSummary(text), setAttention(level) } }}
 */
export function useCardReports(key) {
  const [meta, setMeta] = useState(() => ({ key, cards: {} }));
  const keyNow = useRef(key);
  keyNow.current = key;
  const setters = useRef({});
  const settersFor = useCallback((id) => {
    if (!setters.current[id]) {
      const patch = (field, value) => {
        const forKey = keyNow.current;
        setMeta((m) => {
          const mine = m.key === forKey ? m.cards : {};
          if (m.key === forKey && mine[id]?.[field] === value) return m;
          return { key: forKey, cards: { ...mine, [id]: { ...mine[id], [field]: value } } };
        });
      };
      setters.current[id] = {
        setSummary: (text) => patch('summary', String(text || '')),
        setAttention: (level) => patch('attention', levelOf(level)),
      };
    }
    return setters.current[id];
  }, []);
  return { cards: meta.key === key ? meta.cards : NO_REPORTS, settersFor };
}
