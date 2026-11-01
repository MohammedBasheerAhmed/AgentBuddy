import React, { useCallback, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { CardFrame, EmptyNote } from '../ui/primitives.jsx';
import { shownFor } from '../../profiles/profiles.js';
import { INSIGHT_CARDS } from './cards/index.js';
import { t } from '../../i18n/index.js';

/** The cards for this record: its kind, the person's profiles, in order (`order` may be a number or a function of the record). */
export function cardsFor(cards, record, header, eff) {
  const kind = record.kind || 'other';
  return cards
    .filter((c) => {
      const kinds = Array.isArray(c.kinds) && c.kinds.length ? c.kinds : ['*'];
      return kinds.includes('*') || kinds.includes(kind);
    })
    .filter((c) => shownFor(c.profiles, eff))
    // A card may say it does not apply to this record (no configuration item, no account): then it is not drawn at all.
    .filter((c) => {
      if (typeof c.when !== 'function') return true;
      try {
        return c.when(record, header) !== false;
      } catch {
        return true;
      }
    })
    .map((c, i) => ({ card: c, rank: typeof c.order === 'function' ? Number(c.order(record, header)) || 100 : Number(c.order ?? 100), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.card);
}

/**
 * The Ticket screen's Insights half: every card that applies, each in a folding CardFrame (TRACKER.md 2.4: one-line summaries,
 * the details one click away). A card reads while the half is on screen (`active`), folded or not, so its summary line is there;
 * `open` tells it whether its body shows.
 *
 * props: page, eff, record, header, active, openCard ({ id, at }: open and bring that card into view), onShowCard
 */
export default function TicketInsights({ page, eff, record, header, active, openCard = null, onShowCard = () => {} }) {
  const key = `${record.table}:${record.sysId}`;
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff);
  const [meta, setMeta] = useState({}); // card id -> { summary, attention }
  const [open, setOpen] = useState({}); // card id -> true / false (unset: the card's default)
  const root = useRef(null);

  // A new record: summaries and attention marks belong to the old one.
  useEffect(() => setMeta({}), [key]);

  useEffect(() => {
    if (!openCard?.id) return;
    setOpen((o) => ({ ...o, [openCard.id]: true }));
    // After the card has opened and the half is shown.
    const timer = setTimeout(() => root.current?.querySelector(`[data-card="${openCard.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
    return () => clearTimeout(timer);
  }, [openCard]);

  // One stable pair of setters per card, so a card can call them from its effects without causing a loop.
  const setters = useRef({});
  const settersFor = useCallback((id) => {
    if (!setters.current[id]) {
      const patch = (field, value) => setMeta((m) => (m[id]?.[field] === value ? m : { ...m, [id]: { ...m[id], [field]: value } }));
      setters.current[id] = {
        setSummary: (text) => patch('summary', String(text || '')),
        setAttention: (level) => patch('attention', level === 'warn' || level === 'danger' ? level : ''),
      };
    }
    return setters.current[id];
  }, []);

  if (!cards.length) return <EmptyNote>{t('Nothing to show for this kind of record yet.')}</EmptyNote>;

  return (
    <div className="ab-cards" ref={root}>
      {cards.map((c) => {
        // Open as the person left it; else as the card says for this record (openWhen), else its default.
        let opensBy = c.defaultOpen !== false;
        if (typeof c.openWhen === 'function') {
          try {
            opensBy = Boolean(c.openWhen(record, header));
          } catch {
            /* keep the default */
          }
        }
        const isOpen = open[c.id] ?? opensBy;
        const { Card } = c;
        const { setSummary, setAttention } = settersFor(c.id);
        return (
          <CardFrame
            key={c.id}
            id={c.id}
            title={c.title}
            summary={meta[c.id]?.summary || ''}
            attention={meta[c.id]?.attention || ''}
            open={isOpen}
            onToggle={(v) => setOpen((o) => ({ ...o, [c.id]: v }))}
          >
            <ErrorBoundary resetKey={key}>
              {/* `active`: the half is on screen, so a folded card can still fill its one-line summary (the point of folding);
                  `open`: whether its body shows, for a card that keeps a heavy read until it is opened. */}
              <Card page={page} eff={eff} record={record} header={header} active={Boolean(active)} open={isOpen} setSummary={setSummary} setAttention={setAttention} onShowCard={onShowCard} />
            </ErrorBoundary>
          </CardFrame>
        );
      })}
    </div>
  );
}
