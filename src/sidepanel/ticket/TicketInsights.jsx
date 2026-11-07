import { useEffect, useId, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { AiBadge, EmptyNote } from '../ui/primitives.jsx';
import { LAUNCH_KEY, makeLaunch } from '../../lib/launch.js';
import { TRANSLATE_ID } from '../../features/packs/translate.js';
import { Icon } from '../ui/icons.jsx';
import { painIcon } from '../ui/featureIcons.js';
import { shownFor } from '../../profiles/profiles.js';
import { useAllTools } from '../palette/allToolsContext.js';
import { INSIGHT_CARDS } from './cards/index.js';
import { useCardReports } from './cardReports.js';
import { groupOfCard, insightGroups, needsLook, orderMembers } from './focusView.js';
import { reveal } from './ticketRail.js';
import MoreTools from './MoreTools.jsx';
import { t, tn } from '../../i18n/index.js';

/**
 * The cards for this record: its kind, the person's profiles, in order (`order` may be a number or a function of the record). The five
 * rows take theirs from it in this order (focusView.js insightGroups), and All tools lists the rest.
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

/** The ids of the Insights cards this record has (the five rows' and the rest under All tools). */
export function cardIdsFor(record, header, eff) {
  return cardsFor(INSIGHT_CARDS, record || {}, header, eff).map((c) => c.id);
}

const DOT = { danger: 'danger', warn: 'warn', ok: 'ok' };
const NO_NEEDS = [];

/** A card shown alone (the side rail, All tools, the bar on the ServiceNow page, a link in another card): its name as a heading. */
function FocusHead({ card, level, summary }) {
  return (
    <div className="ab-row ab-ins-focus-head">
      <span className={`ab-dot ab-dot-${DOT[level] || 'neutral'}`} aria-hidden="true" />
      <span className="ab-row-main">
        <h3 className="ab-row-title ab-ins-card-title ab-ins-focus-title" tabIndex={-1}>
          {card.title}
        </h3>
        {needsLook(level) && <span className="ab-sr">{t('Needs a look.')}</span>}
        {summary && <span className="ab-row-sub ab-ins-card-summary ab-ins-focus-summary">{summary}</span>}
      </span>
    </div>
  );
}

/**
 * One card as a row (a row of the five with several cards, or a card of the rest shown alone): its status dot, its title and its
 * one-line answer, a chevron; the card's content opens under it. Shown alone (`focused`) the row is a heading over the open content
 * instead. The content keeps its place in the tree either way, so what was typed or ticked in it stays.
 */
function CardRow({ card, rowId, level, summary, open, focused, onToggle, hidden, children }) {
  const bodyId = `${rowId}-body`;
  return (
    <li id={rowId} className={`ab-ins-card${level ? ` is-${level}` : ''}${focused ? ' is-focus' : ''}`} data-card={card.id} hidden={hidden || undefined}>
      {focused ? (
        <FocusHead card={card} level={level} summary={summary} />
      ) : (
        <button type="button" className="ab-row ab-ins-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
          <span className={`ab-dot ab-dot-${DOT[level] || 'neutral'}`} aria-hidden="true" />
          <span className="ab-row-main">
            <span className="ab-row-title ab-ins-card-title">{card.title}</span>
            {needsLook(level) && <span className="ab-sr">{t('Needs a look.')}</span>}
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

/** The only card of a row: its content straight in the row (no row inside a row). Shown alone it gets its name as a heading. */
function SoloCard({ card, rowId, level, summary, focused, children }) {
  return (
    <div id={rowId} className={`ab-ins-card ab-ins-solo${level ? ` is-${level}` : ''}${focused ? ' is-focus' : ''}`} data-card={card.id}>
      {focused && <FocusHead card={card} level={level} summary={summary} />}
      <div className="ab-ins-card-body">{children}</div>
    </div>
  );
}

/** One fact that needs the agent now (needsNow.js): a plain row, its dot, one sentence and a quiet line under it. Nothing to click. */
function NeedRow({ item }) {
  return (
    <li className={`ab-ins-need is-${item.level}`} data-need={item.id}>
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
 * A plain fact of "Understand the ticket" (round 4): what changed since the agent last looked ("Since you last looked (yesterday
 * 17:05)", what changed in a quiet line under it), or "Nothing new since you looked (...)". A grey dot: it needs no look.
 */
function SinceRow({ item }) {
  return (
    <li className="ab-ins-need ab-ins-since" data-need={item.id}>
      <div className="ab-row ab-ins-need-row">
        <span className="ab-dot ab-dot-neutral" aria-hidden="true" />
        <span className="ab-row-main">
          <span className="ab-row-title ab-ins-need-text">{item.text}</span>
          {item.sub && <span className="ab-row-sub ab-ins-need-sub">{item.sub}</span>}
        </span>
      </div>
    </li>
  );
}

// A message longer than this is cut to a few lines at first ("Show all" opens the rest).
const LONG_MESSAGE = 280;

/**
 * What the caller wrote last (round 4): "The caller wrote, today 09:14", then the message as it was read, in its own direction
 * (dir="auto": an Arabic message reads right to left in an English panel). "Translate" (with the AI mark) when the message is in another
 * script than the panel's language: it starts the AI action in AI Assist, where the check before sending comes first. Nothing here
 * sends anything.
 */
function CallerWroteRow({ item, onTranslate = null }) {
  const [all, setAll] = useState(false);
  const textId = `ab-said${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const message = typeof item.message === 'string' ? item.message : '';
  const long = message.length > LONG_MESSAGE;
  return (
    <li className="ab-ins-need ab-ins-said" data-need={item.id}>
      <div className="ab-row ab-ins-need-row">
        <span className="ab-dot ab-dot-neutral" aria-hidden="true" />
        <span className="ab-row-main">
          <span className="ab-row-title ab-ins-need-text">{item.text}</span>
          <span id={textId} className={`ab-ins-said-text${long && !all ? ' is-cut' : ''}`} dir="auto">
            {message}
          </span>
          {(long || (item.translate && onTranslate)) && (
            <span className="ab-ins-said-actions">
              {item.translate && onTranslate && (
                <button type="button" className="ab-btn ab-btn-sm ab-ins-translate" title={t('Opens AI Assist. You see what will be sent first.')} onClick={onTranslate}>
                  <AiBadge label="" title="" />
                  {t('Translate')}
                </button>
              )}
              {long && (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-expanded={all} aria-controls={textId} onClick={() => setAll(!all)}>
                  {all ? t('Show fewer') : t('Show all')}
                </button>
              )}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

// chrome.storage.session, where a request for the Ticket screen waits (src/lib/launch.js); null where there is none.
const launchArea = () => (typeof chrome !== 'undefined' && chrome.storage?.session && typeof chrome.storage.session.set === 'function' ? chrome.storage.session : null);

/**
 * Start an AI action of the record on screen in AI Assist, from Insights, the way the bar on the ServiceNow page does: a request
 * (src/lib/launch.js makeLaunch: a tab, a record and a feature id, nothing else) left in the panel's session storage, which the panel
 * takes once (src/sidepanel/useLaunch.js) and the Ticket screen runs exactly as a click in AI Assist would: the same checks (offered,
 * AI set up, not busy), the same preview before anything is sent. Insights itself runs no AI. False when no request could be made.
 */
export function launchFromInsights({ page, record, featureId, area = launchArea(), now = Date.now() }) {
  const request = makeLaunch({ tabId: page?.tabId, table: record?.table, sysId: record?.sysId, featureId, now });
  if (!request || !area) return false;
  const pending = area.set({ [LAUNCH_KEY]: request });
  if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  return true;
}

/**
 * One of the five (a pain point): its icon in a small tile (a dot on it when the row needs a look), its name, one line, a chevron. A
 * click opens it in place. While one of its cards is shown alone, the row's own button steps aside and only that card shows.
 */
function GroupRow({ group, rowId, open, focusHere, hidden, onToggle, children }) {
  const bodyId = `${rowId}-body`;
  return (
    <li id={rowId} className={`ab-ins-pain${group.level ? ` is-${group.level}` : ''}`} data-group={group.id} hidden={hidden || undefined}>
      {!focusHere && (
        <button type="button" className="ab-row ab-ins-group-row" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
          <span className="ab-ins-tile" aria-hidden="true">
            <Icon name={painIcon(group.id)} size={18} />
            {group.look && <span className={`ab-ins-tile-dot is-${group.level}`} />}
          </span>
          <span className="ab-row-main">
            <span className="ab-row-title ab-ins-pain-title">{group.title}</span>
            {group.look && <span className="ab-sr">{t('Needs a look.')}</span>}
            {group.line && <span className="ab-row-sub ab-ins-pain-line">{group.line}</span>}
          </span>
          <Icon name="chevronDown" size={16} className="ab-chevron ab-ins-card-chevron" />
        </button>
      )}
      <div id={bodyId} className="ab-ins-pain-body" hidden={!(open || focusHere)}>
        {children}
      </div>
    </li>
  );
}

/**
 * The Ticket screen's Insights half (docs/focus-layout.md, A): FIVE rows, one per pain point (understand the ticket, find the fix, the
 * same caller, reply, close well), each with one line that answers it without opening it; a click opens the row in place.
 * "Understand the ticket" starts with what needs the agent now (the SLA, a customer waiting, a possible outage: plain rows), after
 * what changed since the agent last looked and what the caller wrote last (round 4; "Translate" starts an AI action in AI Assist). A row
 * with one card shows that card's content directly; a row with several shows them as rows of their own (the dot, the title, one
 * line), the ones that need a look first. The rest of the record's cards are in All tools ("More for this ticket: n Insights").
 *
 * One card can be shown alone (`focus`: the side rail, All tools, the bar on the ServiceNow page, another card): that card, open,
 * under "Back". A card of the rest is mounted the first time it is asked for and then stays mounted, hidden, for the record. Every
 * mounted card reads while the half is on screen (`active`), open, folded or hidden, so its one line and its dot (on its row, on the
 * row of the five and in the rail) are there, and it keeps what was typed or ticked in it.
 *
 * props: page, eff, record, header, active, needs (needsNow items), focus ({ id, at, from, group }: the card shown alone, or id null
 *        for the five; `at` changes with every request, `from` is the card that was alone before going back, `group` a row to open
 *        and bring into view), onBack() (back to the five), onShowCard (a card's way to another card), reports (useCardReports of the
 *        Ticket screen, which the rail and the tab read too; without it the half keeps its own)
 */
export default function TicketInsights({ page, eff, record, header, active, needs = NO_NEEDS, focus = null, onBack = () => {}, onShowCard = () => {}, reports = null }) {
  const key = `${record.table}:${record.sysId}`;
  const cards = cardsFor(INSIGHT_CARDS, record, header, eff);
  const own = useCardReports(key);
  const { cards: shownReports, settersFor } = reports || own;
  const openAllTools = useAllTools();
  const [open, setOpen] = useState({}); // card id -> true / false (unset: the card's default)
  const [openGroups, setOpenGroups] = useState({}); // pain point id -> true / false (unset: folded)
  const root = useRef(null);
  const idBase = `ab-ins${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { groups, rest } = insightGroups({ cards, reports: shownReports, needs });
  const groupsNow = useRef(groups);
  groupsNow.current = groups;
  const focusId = focus?.id && cards.some((c) => c.id === focus.id) ? focus.id : null;
  const focusGroup = groupOfCard(groups, focusId);
  // "Translate" next to the caller's message: the AI action in AI Assist (never here), when a request can be left for it.
  const canLaunch = Boolean(launchArea());
  const translate = () => launchFromInsights({ page, record, featureId: TRANSLATE_ID });

  // The cards of the rest that were asked for on this record: mounted from then on (hidden when not alone), so they keep reporting
  // and keep what was typed in them. Another record starts with none.
  const asked = useRef({ key, ids: [] });
  if (asked.current.key !== key) asked.current = { key, ids: [] };
  if (focusId && !focusGroup && !asked.current.ids.includes(focusId)) asked.current.ids = [...asked.current.ids, focusId];
  const mounted = asked.current.ids.map((id) => rest.find((c) => c.id === id)).filter(Boolean);
  const restFocused = Boolean(focusId && !focusGroup);

  // A card was chosen, the person went back to the five, or the rail asked for a row: once that has drawn, the right place is brought
  // into view and takes the focus: the card's heading; back from a card, its row (its row of the five opened for it) or, for a card
  // of the rest, the way to All tools; a row of the five, its own button.
  const request = useRef(focus);
  request.current = focus;
  const focusAt = focus?.at || 0;
  useEffect(() => {
    if (!focusAt) return undefined;
    const { id, from, group } = request.current || {};
    const back = !id && from ? groupOfCard(groupsNow.current, from) : null;
    const opening = id ? '' : group || back?.id || '';
    if (opening) setOpenGroups((o) => (o[opening] ? o : { ...o, [opening]: true }));
    const timer = setTimeout(() => {
      const box = root.current;
      if (!box) return;
      if (id) {
        reveal(box);
        box.querySelector(`[data-card="${id}"] .ab-ins-focus-title`)?.focus?.({ preventScroll: true });
        return;
      }
      let target = null;
      if (group) target = box.querySelector(`li[data-group="${group}"] > .ab-ins-group-row`);
      else if (back && back.cards.length > 1) target = box.querySelector(`li[data-card="${from}"] > .ab-ins-card-toggle`);
      else if (back) target = box.querySelector(`li[data-group="${back.id}"] > .ab-ins-group-row`);
      else if (from) target = box.querySelector('.ab-more-tools');
      if (!target) {
        reveal(box);
        return;
      }
      reveal(group ? target.closest('li') : target);
      target.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [focusAt]);

  // A card's content, wherever it is drawn. `shownOpen`: whether its content is on screen, for a card that keeps a heavy read until
  // it is opened; `active`: the half is on screen, so a folded card can still fill its one-line answer (the point of folding).
  const content = (c, shownOpen) => {
    const { Card } = c;
    const { setSummary, setAttention } = settersFor(c.id);
    return (
      <ErrorBoundary resetKey={key}>
        <Card page={page} eff={eff} record={record} header={header} active={Boolean(active)} open={Boolean(shownOpen)} setSummary={setSummary} setAttention={setAttention} onShowCard={onShowCard} />
      </ErrorBoundary>
    );
  };
  // Open as the person left it. On first view the rows are folded (their one line answers at a look), except a card that is the
  // record's own main view (request status, the checklist, article checks, chat facts: `defaultOpen`) where its state wants it
  // (openWhen).
  const opensBy = (c) => {
    if (c.defaultOpen !== true) return false;
    if (typeof c.openWhen !== 'function') return true;
    try {
      return Boolean(c.openWhen(record, header));
    } catch {
      return true;
    }
  };
  const cardRow = (c, { visible, hidden }) => {
    const isOpen = open[c.id] ?? opensBy(c);
    const focused = focusId === c.id;
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
        hidden={hidden}
        onToggle={(v) => setOpen((o) => ({ ...o, [c.id]: v }))}
      >
        {content(c, (visible && isOpen) || focused)}
      </CardRow>
    );
  };

  const groupRow = (g) => {
    const isOpen = Boolean(openGroups[g.id]);
    const focusHere = focusGroup?.id === g.id;
    let body = null;
    if (g.cards.length === 1) {
      const c = g.cards[0];
      const report = shownReports[c.id] || {};
      body = (
        <SoloCard card={c} rowId={`${idBase}-${c.id}`} level={report.attention || ''} summary={report.summary || ''} focused={focusId === c.id}>
          {content(c, isOpen || focusId === c.id)}
        </SoloCard>
      );
    } else if (g.cards.length > 1) {
      body = <ul className="ab-rows ab-ins-members">{orderMembers(g.cards, shownReports).map((c) => cardRow(c, { visible: isOpen, hidden: Boolean(focusId) && focusId !== c.id }))}</ul>;
    }
    return (
      <GroupRow key={g.id} group={g} rowId={`${idBase}-g-${g.id}`} open={isOpen} focusHere={focusHere} hidden={Boolean(focusId) && !focusHere} onToggle={(v) => setOpenGroups((o) => ({ ...o, [g.id]: v }))}>
        {g.needs.length > 0 && (
          <ul className="ab-rows ab-ins-needs" hidden={focusHere || undefined}>
            {g.needs.map((item) => {
              if (item.id === 'since') return <SinceRow key={item.id} item={item} />;
              if (item.id === 'caller') return <CallerWroteRow key={item.id} item={item} onTranslate={canLaunch ? translate : null} />;
              return <NeedRow key={item.id} item={item} />;
            })}
          </ul>
        )}
        {body}
      </GroupRow>
    );
  };

  if (!groups.length && !rest.length) return <EmptyNote>{t('Nothing to show for this kind of ticket yet.')}</EmptyNote>;
  return (
    <div className={`ab-ins${focusId ? ' is-focus' : ''}`} ref={root}>
      {focusId && (
        <button type="button" className="ab-ins-back" onClick={onBack}>
          <Icon name="chevronLeft" size={16} className="ab-flip" />
          {t('Back')}
        </button>
      )}
      <ul className="ab-rows ab-ins-cards ab-ins-groups" aria-label={t('Insights')} hidden={restFocused || undefined}>
        {groups.map(groupRow)}
        {!focusId && rest.length > 0 && <MoreTools item label={tn(rest.length, 'More for this ticket: {n} Insight', 'More for this ticket: {n} Insights')} onOpen={() => openAllTools('ticket-insights')} />}
      </ul>
      {mounted.length > 0 && (
        <ul className="ab-rows ab-ins-cards ab-ins-rest" aria-label={t('Insights')} hidden={!restFocused || undefined}>
          {mounted.map((c) => cardRow(c, { visible: false, hidden: focusId !== c.id }))}
        </ul>
      )}
    </div>
  );
}
