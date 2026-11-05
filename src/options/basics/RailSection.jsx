// Settings, Basics: the side rail of the Ticket screen (docs/rail-layout.md, part C). Per kind of record and per half (Insights, AI
// Assist), the person hides what they never use and moves up what they use most; saved as railLayout (src/features/railLayout.js), which
// the panel reads to draw the rail. Then whether a kind left alone follows the ticket's state (railByState), and the small bar on the
// ServiceNow page: on or off (pageBar, which the organisation can lock) and which AI actions it holds per kind (quickPins, up to 4),
// chosen here now that the panel has no quick-actions bar of its own. What each kind offers is worked out in ../railOptions.js.
import { useEffect, useRef, useState } from 'react';
import { Locked, SectionHead, Status, Switch, useSaveSetting } from '../fields.jsx';
import { MAX_QUICK, moveRailItem, pagePicks, railHasAssist, railKinds, railRows, resetRail, togglePagePick, toggleRailItem } from '../railOptions.js';
import { Icon } from '../../sidepanel/ui/icons.jsx';
import { nextTabIndex } from '../../sidepanel/tabKeys.js';
import { t } from '../../i18n/index.js';

const PANEL_ID = 'rail-set-panel';
const LIST_TITLE_ID = 'rail-set-title';
const PAGE_TITLE_ID = 'rail-page-title';

/**
 * A stored value the section changes several times in a row (a list moved one place per click): the section draws its own copy at once
 * and saves it, so a second click builds on the first even before the page has read the settings again. The copy follows the stored
 * value whenever no save is on its way; a save the browser refused puts the stored value back.
 *   -> [value, apply(next, save)]   save(next) -> Promise<boolean> (useSaveSetting's save)
 */
function useDraft(saved) {
  const [draft, setDraft] = useState(saved);
  const pending = useRef(0);
  const latest = useRef(saved);
  latest.current = saved;
  const key = JSON.stringify(saved ?? null);
  useEffect(() => {
    if (!pending.current) setDraft(latest.current);
  }, [key]);
  const apply = async (next, save) => {
    pending.current += 1;
    setDraft(next);
    const ok = await save(next);
    pending.current -= 1;
    if (!ok && !pending.current) setDraft(latest.current);
  };
  return [draft, apply];
}

/**
 * A row of tabs that picks what the list below shows (a kind of record; Insights or AI Assist). One tab stop; Left/Right, Home and End
 * move between the tabs (src/sidepanel/tabKeys.js). Every tab controls the one list below.
 */
function ChoiceTabs({ label, idBase, items, value, onChange }) {
  const buttons = useRef({});
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = nextTabIndex(e.key, items.findIndex((it) => it.id === value), items.length);
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    buttons.current[items[next].id]?.focus();
  };
  return (
    <div className="ab-set-rail-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((it) => (
        <button
          key={it.id}
          id={`${idBase}-tab-${it.id}`}
          ref={(el) => {
            buttons.current[it.id] = el;
          }}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          aria-controls={PANEL_ID}
          tabIndex={value === it.id ? 0 : -1}
          className="ab-set-rail-tab"
          onClick={() => onChange(it.id)}
        >
          {it.icon ? <Icon name={it.icon} size={14} /> : null}
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function RailSection({ eff, reload }) {
  const v = eff.values;
  const { status, save } = useSaveSetting(reload);
  const [layout, applyLayout] = useDraft(v.railLayout || {});
  const [pins, applyPins] = useDraft(v.quickPins || {});
  const kinds = railKinds(eff);
  const hasAssist = railHasAssist(eff);
  const [kindChoice, setKind] = useState(kinds[0].id);
  const [halfChoice, setHalf] = useState('insights');
  const kind = kinds.find((k) => k.id === kindChoice) || kinds[0];
  const half = hasAssist ? halfChoice : 'insights';
  const { rows, shown, arranged } = railRows(kind.id, half, eff, layout);
  const ids = rows.map((r) => r.id);

  // After a move the row's button is where the focus goes on (the row may have been moved in the page, which loses it); at the top or
  // the bottom, where that button is now off, the row's other one.
  const moveButtons = useRef({});
  const refocus = useRef(null);
  useEffect(() => {
    const want = refocus.current;
    if (!want) return;
    refocus.current = null;
    const same = moveButtons.current[`${want.id}:${want.step}`];
    const other = moveButtons.current[`${want.id}:${-want.step}`];
    (same && !same.disabled ? same : other)?.focus();
  });

  const saveLayout = (next) => applyLayout(next, (n) => save({ railLayout: n }));
  const move = (id, step) => {
    refocus.current = { id, step };
    saveLayout(moveRailItem(layout, kind.id, half, ids, id, step));
  };

  const picks = pagePicks(kind.id, eff, pins);
  const full = picks.chosen.length >= MAX_QUICK;
  const pick = (id) => {
    const next = togglePagePick(pins, kind.id, picks.chosen, id);
    if (next !== pins) applyPins(next, (n) => save({ quickPins: n }));
  };

  const halves = [
    { id: 'insights', label: t('Insights') },
    { id: 'assist', label: t('AI Assist'), icon: 'spark' },
  ];
  const listTitle = half === 'assist' ? t('AI Assist for {kinds}', { kinds: kind.many }) : t('Insights for {kinds}', { kinds: kind.many });

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-rail">
      <SectionHead id="h-rail" title={t('Side rail')}>
        {t('The rail on the right of the Ticket screen lists everything Insights or AI Assist offers for the ticket that is open. Hide what you never use and put what you use most at the top, per kind of record.')}
      </SectionHead>
      <ChoiceTabs label={t('Kind of record')} idBase="rail-kind" items={kinds} value={kind.id} onChange={setKind} />
      {hasAssist && <ChoiceTabs label={t('Which list to arrange')} idBase="rail-half" items={halves} value={half} onChange={setHalf} />}

      <div id={PANEL_ID} className="ab-set-rail-panel" role="tabpanel" aria-labelledby={LIST_TITLE_ID}>
        <div className="ab-set-rail-head">
          <h3 className="ab-set-rail-title" id={LIST_TITLE_ID}>{listTitle}</h3>
          {rows.length > 0 && <span className="ab-hint">{t('{n} of {m} shown', { n: shown, m: rows.length })}</span>}
        </div>
        {rows.length === 0 ? (
          <p className="ab-set-empty">{t('Nothing to arrange here.')}</p>
        ) : (
          <ol className="ab-set-rail-list" aria-labelledby={LIST_TITLE_ID}>
            {rows.map((r, i) => (
              <li key={r.id} className={`ab-set-rail-row${r.hidden ? ' is-hidden' : ''}`}>
                <span className="ab-set-rail-icon">
                  <Icon name={r.icon} />
                </span>
                <span className="ab-set-rail-name">{r.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!r.hidden}
                  aria-label={t('Show {name} in the rail', { name: r.label })}
                  title={t('Show {name} in the rail', { name: r.label })}
                  className="ab-set-rail-toggle"
                  onClick={() => saveLayout(toggleRailItem(layout, kind.id, half, r.id))}
                />
                <button
                  type="button"
                  ref={(el) => {
                    moveButtons.current[`${r.id}:-1`] = el;
                  }}
                  className="ab-set-rail-move"
                  aria-label={t('Move {name} up', { name: r.label })}
                  title={t('Move {name} up', { name: r.label })}
                  disabled={i === 0}
                  onClick={() => move(r.id, -1)}
                >
                  <Icon name="chevronUp" />
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    moveButtons.current[`${r.id}:1`] = el;
                  }}
                  className="ab-set-rail-move"
                  aria-label={t('Move {name} down', { name: r.label })}
                  title={t('Move {name} down', { name: r.label })}
                  disabled={i === rows.length - 1}
                  onClick={() => move(r.id, 1)}
                >
                  <Icon name="chevronDown" />
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="ab-set-actions">
          <button type="button" className="ab-btn ab-btn-sm" disabled={!arranged} onClick={() => saveLayout(resetRail(layout, kind.id, half))}>
            {t('Reset to the suggested order')}
          </button>
        </div>
      </div>

      {hasAssist && (
        <div className="ab-set-switches">
          <Switch id="rail-by-state" checked={v.railByState !== false} onChange={(on) => save({ railByState: on })}>
            {t("When I have not arranged a kind, put what fits the ticket's state first.")}
          </Switch>
        </div>
      )}

      <h3 className="ab-set-subtitle">{t('On the ServiceNow page')}</h3>
      <div className="ab-set-switches">
        <div>
          <Switch id="page-bar" checked={v.pageBar !== false} disabled={Boolean(eff.locked.pageBar)} onChange={(on) => save({ pageBar: on })}>
            {t('Show the bar on ServiceNow pages. A click opens the side panel and starts the action there.')}
          </Switch>
          <Locked why={eff.locked.pageBar} />
        </div>
      </div>
      {v.pageBar !== false && picks.items.length > 0 && (
        <div className="ab-set-rail-page">
          <div className="ab-set-rail-head">
            <span className="ab-set-rail-subhead" id={PAGE_TITLE_ID}>{t('Its actions for {kinds} (up to {max})', { kinds: kind.many, max: MAX_QUICK })}</span>
            <span className="ab-hint">{t('{n} of {max} chosen', { n: picks.chosen.length, max: MAX_QUICK })}</span>
          </div>
          <div className="ab-set-rail-pills" role="group" aria-labelledby={PAGE_TITLE_ID}>
            {picks.items.map((p) => {
              const on = picks.chosen.includes(p.id);
              return (
                <button key={p.id} type="button" className="ab-set-rail-pill" aria-pressed={on} disabled={!on && full} onClick={() => pick(p.id)}>
                  {on ? <Icon name="check" size={14} /> : null}
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
          {!picks.own && <p className="ab-hint ab-set-rail-note">{t('Until you choose, the bar shows these suggestions.')}</p>}
          {full && <p className="ab-hint ab-set-rail-note">{t('The bar holds up to {max}. Turn one off to choose another.', { max: MAX_QUICK })}</p>}
        </div>
      )}
      <Status status={status} />
    </section>
  );
}
