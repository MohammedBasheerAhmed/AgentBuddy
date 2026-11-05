import { useEffect, useId, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { EmptyNote } from '../ui/primitives.jsx';
import { Icon } from '../ui/icons.jsx';
import { shownFor } from '../../profiles/profiles.js';
import { INSIGHT_CARDS } from './cards/index.js';
import { useCardReports } from './cardReports.js';
import { reveal } from './ticketRail.js';
import { t } from '../../i18n/index.js';

/**
 * The cards for this record: its kind, the person's profiles, in order (`order` may be a number or a function of the record). The
 * side rail lists the same cards, in this order (ticketRail.js insightsRail).
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

/** The ids of the Insights cards this record shows (the very cards the Insights half draws). */
export function cardIdsFor(record, header, eff) {
  return cardsFor(INSIGHT_CARDS, record || {}, header, eff).map((c) => c.id);
}

const FIRST = { danger: 0, warn: 1 };
const DOT = { danger: 'danger', warn: 'warn', ok: 'ok' };
const NO_IDS = new Set();
const NO_NEEDS = [];

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

/**
 * One card as a row: its status dot, its title and its one-line answer, a chevron; the card's content opens under it. Shown alone (the
 * side rail chose it: `focused`) the row is a heading over the open content instead. The content keeps its place in the tree either
 * way, so what was typed or ticked in it stays.
 */
function CardRow({ card, rowId, level, summary, open, focused, onToggle, hidden, children }) {
  const bodyId = `${rowId}-body`;
  const attention = level === 'danger' || level === 'warn';
  const dot = <span className={`ab-dot ab-dot-${DOT[level] || 'neutral'}`} aria-hidden="true" />;
  return (
    <li id={rowId} className={`ab-ins-card${level ? ` is-${level}` : ''}${focused ? ' is-focus' : ''}`} data-card={card.id} hidden={hidden || undefined}>
      {focused ? (
        <div className="ab-row ab-ins-focus-head">
          {dot}
          <span className="ab-row-main">
            <h3 className="ab-row-title ab-ins-card-title ab-ins-focus-title" tabIndex={-1}>
              {card.title}
            </h3>
            {attention && <span className="ab-sr">{t('Needs a look.')}</span>}
            {summary && <span className="ab-row-sub ab-ins-card-summary ab-ins-focus-summary">{summary}</span>}
          </span>
        </div>
      ) : (
        <button type="button" className="ab-row ab-ins-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
          {dot}
          <span className="ab-row-main">
            <span className="ab-row-title ab-ins-card-title">{card.title}</span>
            {attention && <span className="ab-sr">{t('Needs a look.')}</span>}
            {summary && <span className="ab-row-sub ab-ins-card-summary">{summary}</span>}
          </span>
          <Icon name="chevronDown" size={16} className="ab-chevron ab-ins-card-chevron" />
        </button>
      )}
      <div id={bodyId} className="ab-ins-card-body" hidden={!(open || focused)}>
        {children}
      </div>
    </li>
  );
}

/** One fact that needs the agent now (needsNow.js): a plain row, its dot, one sentence and a quiet line under it. Nothing to click. */
function NeedRow({ item, hidden }) {
  return (
    <li className={`ab-ins-need is-${item.level}`} data-need={item.id} hidden={hidden || undefined}>
      <div className="ab-row ab-ins-need-row">
        <span className={`ab-dot ab-dot-${DOT[item.level] || 'neutral'}`} aria-hidden="true" />
        <span className="ab-row-main">
          <span className="ab-row-title ab-ins-need-text">{item.text}</span>
          <span className="ab-sr">{t('Needs a look.')}</span>
          {item.sub && <span className="ab-row-sub ab-ins-need-sub">{item.sub}</span>}
        </span>
      </div>
    </li>
  );
}

/**
 * The Ticket screen's Insights half: what needs the agent now (the SLA, a customer waiting, a possible outage: plain rows), then every
 * card that applies, as ONE list of rows (TRACKER.md 2.4: one-line answers, the details one click away). A row shows the card's status
 * dot, its title and its one-line answer without being opened; a click opens the card's content in place. The cards that need a look
 * come first; the ones with nothing to report wait in the last row, "All clear in ...".
 *
 * The side rail can show one card alone (`focus`): that card, open, under an "All insights" button that goes back to the list. The
 * other cards stay mounted, hidden: a card reads while the half is on screen (`active`), open, folded or hidden, so its one line and
 * its dot (on its row and in the rail) are there, and it keeps what was typed or ticked in it.
 *
 * props: page, eff, record, header, active, needs (needsNow items), focus ({ id, at, from }: the card shown alone, or id null for the
 *        list; `at` changes with every request, `from` is the card that was alone before going back), onBack() (back to the list),
 *        onShowCard (a card's way to another card), reports (useCardReports of the Ticket screen, which the rail reads too; without
 *        it the half keeps its own)
 */
export default function TicketInsights({ page, eff, record, header, active, needs = NO_NEEDS, focus = null, onBack = () => {}, onShowCard = () => {}, reports = null }) {
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
  const focusId = focus?.id && cards.some((c) => c.id === focus.id) ? focus.id : null;

  // A card was chosen (the rail, the bar on the ServiceNow page, another card) or the person went back to the list: once that has
  // drawn, the top of the half is brought into view and the focus goes to the card's heading, or back to its row in the list.
  const asked = useRef(focus);
  asked.current = focus;
  const focusAt = focus?.at || 0;
  useEffect(() => {
    if (!focusAt) return undefined;
    const { id, from } = asked.current || {};
    if (!id && from && clearIds.current.has(from)) setClearOpen(true);
    const timer = setTimeout(() => {
      const box = root.current;
      if (!box) return;
      if (id) {
        reveal(box);
        box.querySelector(`[data-card="${id}"] .ab-ins-focus-title`)?.focus?.({ preventScroll: true });
        return;
      }
      const row = from ? box.querySelector(`[data-card="${from}"]:not([hidden]) > .ab-ins-card-toggle`) : null;
      if (row) row.focus();
      else reveal(box);
    }, 0);
    return () => clearTimeout(timer);
  }, [focusAt]);

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
    const focused = focusId === c.id;
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
        focused={focused}
        hidden={focusId ? !focused : hidden}
        onToggle={(v) => {
          if (v && !clearIds.current.has(c.id)) keptInList.current.add(c.id);
          if (!v) keptInList.current.delete(c.id);
          setOpen((o) => ({ ...o, [c.id]: v }));
        }}
      >
        <ErrorBoundary resetKey={key}>
          {/* `active`: the half is on screen, so a folded card can still fill its one-line answer (the point of folding);
              `open`: whether its content shows, for a card that keeps a heavy read until it is opened. */}
          <Card page={page} eff={eff} record={record} header={header} active={Boolean(active)} open={isOpen || focused} setSummary={setSummary} setAttention={setAttention} onShowCard={onShowCard} />
        </ErrorBoundary>
      </CardRow>
    );
  };

  const clearRow = clear.length > 0 && (
    <li key="ab-all-clear" className="ab-ins-clear" hidden={focusId ? true : undefined}>
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
  // ticked or chosen in it stays). The facts that need a look lead it.
  const items = [
    ...needs.map((item) => <NeedRow key={`need:${item.id}`} item={item} hidden={Boolean(focusId)} />),
    ...rows.map((c) => row(c, false)),
    clearRow,
    ...clear.map((c) => row(c, !clearOpen)),
  ].filter(Boolean);
  if (!items.length) return <EmptyNote>{t('Nothing to show for this kind of record yet.')}</EmptyNote>;
  return (
    <div className={`ab-ins${focusId ? ' is-focus' : ''}`} ref={root}>
      {focusId && (
        <button type="button" className="ab-ins-back" onClick={onBack}>
          <Icon name="chevronLeft" size={16} className="ab-flip" />
          {t('All insights')}
        </button>
      )}
      <ul className="ab-rows ab-ins-cards" aria-label={t('Insights')}>
        {items}
      </ul>
      {!cards.length && <EmptyNote>{t('Nothing to show for this kind of record yet.')}</EmptyNote>}
    </div>
  );
}
