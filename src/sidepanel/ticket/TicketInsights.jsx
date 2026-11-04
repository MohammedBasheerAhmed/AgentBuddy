import { useEffect, useId, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { EmptyNote } from '../ui/primitives.jsx';
import { Icon } from '../ui/icons.jsx';
import { shownFor } from '../../profiles/profiles.js';
import { INSIGHT_CARDS } from './cards/index.js';
import { useCardReports } from './cardReports.js';
import { t } from '../../i18n/index.js';

/**
 * The cards for this record: its kind, the person's profiles, in order (`order` may be a number or a function of the record). The
 * quick-actions bar offers the same cards, by id (TicketQuickBar cardIdsFor).
 */
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

const FIRST = { danger: 0, warn: 1 };
const DOT = { danger: 'danger', warn: 'warn', ok: 'ok' };
const NO_IDS = new Set();

/**
 * The rows as they are drawn: the cards that need a look first (danger, then warn), then the others in their order; the cards with
 * nothing to report ('clear') last, under one "All clear in ..." row. Pure.
 * `keep`: the ids of cards the person opened in the list: they stay in the list even when they then report nothing (a card that
 * went into the folded "All clear" row while being read, after a Refresh, would vanish from under the person's eyes).
 * @returns {{ rows: object[], clear: object[] }}
 */
export function arrangeRows(cards, reports = {}, keep = NO_IDS) {
  const level = (c) => reports[c.id]?.attention || '';
  const filed = (c) => level(c) === 'clear' && !keep.has(c.id);
  const clear = cards.filter(filed);
  const rows = cards
    .filter((c) => !filed(c))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (FIRST[level(a.c)] ?? 2) - (FIRST[level(b.c)] ?? 2) || a.i - b.i)
    .map((x) => x.c);
  return { rows, clear };
}

/** One card as a row: its status dot, its title and its one-line answer, a chevron; the card's content opens under it. */
function CardRow({ card, rowId, level, summary, open, onToggle, hidden, children }) {
  const bodyId = `${rowId}-body`;
  const attention = level === 'danger' || level === 'warn';
  return (
    <li id={rowId} className={`ab-ins-card${level ? ` is-${level}` : ''}`} data-card={card.id} hidden={hidden || undefined}>
      <button type="button" className="ab-row ab-ins-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
        <span className={`ab-dot ab-dot-${DOT[level] || 'neutral'}`} aria-hidden="true" />
        <span className="ab-row-main">
          <span className="ab-row-title ab-ins-card-title">{card.title}</span>
          {attention && <span className="ab-sr">{t('Needs a look.')}</span>}
          {summary && <span className="ab-row-sub ab-ins-card-summary">{summary}</span>}
        </span>
        <Icon name="chevronDown" size={16} className="ab-chevron ab-ins-card-chevron" />
      </button>
      <div id={bodyId} className="ab-ins-card-body" hidden={!open}>
        {children}
      </div>
    </li>
  );
}

/**
 * The Ticket screen's Insights half: every card that applies, as ONE list of rows (TRACKER.md 2.4: one-line answers, the details one
 * click away). A row shows the card's status dot, its title and its one-line answer without being opened; a click opens the card's
 * content in place. The cards that need a look come first; the ones with nothing to report wait in the last row, "All clear in ...".
 * A card reads while the half is on screen (`active`), open or not, so its one line is there; `open` tells it whether its content
 * shows. Every card stays mounted, so it keeps reporting (its line, its status) and keeps what was typed or ticked in it.
 *
 * props: page, eff, record, header, active, openCard ({ id, at }: open and bring that card into view), onShowCard,
 *        reports (useCardReports of the Ticket screen, which "Needs you now" reads too; without it the half keeps its own)
 */
export default function TicketInsights({ page, eff, record, header, active, openCard = null, onShowCard = () => {}, reports = null }) {
  const key = `${record.table}:${record.sysId}`;
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff);
  const own = useCardReports(key);
  const { cards: shownReports, settersFor } = reports || own;
  const [open, setOpen] = useState({}); // card id -> true / false (unset: the card's default)
  const [clearOpen, setClearOpen] = useState(false);
  const root = useRef(null);
  const idBase = `ab-ins${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // Cards the person opened while they were in the list: they keep their place while open (arrangeRows `keep`). One opened inside the
  // "All clear" row stays there.
  const keptInList = useRef(new Set());
  const { rows, clear } = arrangeRows(cards, shownReports, keptInList.current);
  const clearIds = useRef(new Set());
  clearIds.current = new Set(clear.map((c) => c.id));

  useEffect(() => {
    if (!openCard?.id) return undefined;
    setOpen((o) => ({ ...o, [openCard.id]: true }));
    if (clearIds.current.has(openCard.id)) setClearOpen(true);
    // After the card has opened and the half is shown.
    const timer = setTimeout(() => root.current?.querySelector(`[data-card="${openCard.id}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0);
    return () => clearTimeout(timer);
  }, [openCard]);

  if (!cards.length) return <EmptyNote>{t('Nothing to show for this kind of record yet.')}</EmptyNote>;

  const row = (c, hidden) => {
    // Open as the person left it. On first view the rows are folded (their one line answers at a look), except a card that is the
    // record's own main view (request status, the checklist, article checks, chat facts: `defaultOpen`) where its state wants it
    // (openWhen).
    let opensBy = c.defaultOpen === true;
    if (opensBy && typeof c.openWhen === 'function') {
      try {
        opensBy = Boolean(c.openWhen(record, header));
      } catch {
        /* keep the default */
      }
    }
    const isOpen = open[c.id] ?? opensBy;
    const { Card } = c;
    const { setSummary, setAttention } = settersFor(c.id);
    const report = shownReports[c.id] || {};
    return (
      <CardRow
        key={c.id}
        card={c}
        rowId={`${idBase}-${c.id}`}
        level={report.attention || ''}
        summary={report.summary || ''}
        open={isOpen}
        hidden={hidden}
        onToggle={(v) => {
          if (v && !clearIds.current.has(c.id)) keptInList.current.add(c.id);
          if (!v) keptInList.current.delete(c.id);
          setOpen((o) => ({ ...o, [c.id]: v }));
        }}
      >
        <ErrorBoundary resetKey={key}>
          {/* `active`: the half is on screen, so a folded card can still fill its one-line answer (the point of folding);
              `open`: whether its content shows, for a card that keeps a heavy read until it is opened. */}
          <Card page={page} eff={eff} record={record} header={header} active={Boolean(active)} open={isOpen} setSummary={setSummary} setAttention={setAttention} onShowCard={onShowCard} />
        </ErrorBoundary>
      </CardRow>
    );
  };

  const clearRow = clear.length > 0 && (
    <li key="ab-all-clear" className="ab-ins-clear">
      <button
        type="button"
        className="ab-row ab-ins-clear-toggle"
        aria-expanded={clearOpen}
        aria-controls={clear.map((c) => `${idBase}-${c.id}`).join(' ')}
        onClick={() => setClearOpen(!clearOpen)}
      >
        <span className="ab-ins-clear-mark" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
        <span className="ab-row-main">
          <span className="ab-row-sub ab-ins-clear-text">{t('All clear in {list}', { list: clear.map((c) => c.title).join(t(', ')) })}</span>
        </span>
        <Icon name="chevronDown" size={16} className="ab-chevron ab-ins-card-chevron" />
      </button>
    </li>
  );
  // ONE array of keyed rows, so a card that moves into or out of "All clear" keeps its place in the tree: it is not drawn anew (what was
  // ticked or chosen in it stays).
  const items = [...rows.map((c) => row(c, false)), clearRow, ...clear.map((c) => row(c, !clearOpen))].filter(Boolean);
  return (
    <div className="ab-ins" ref={root}>
      <ul className="ab-rows ab-ins-cards" aria-label={t('Insights')}>
        {items}
      </ul>
    </div>
  );
}
