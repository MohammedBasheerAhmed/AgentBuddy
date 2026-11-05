import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/icons.jsx';
import { AiBadge } from '../ui/primitives.jsx';
import { t } from '../../i18n/index.js';

// The side rail (the 2026-11-05 layout): a slim column of icons on the right of the panel (on the left in Arabic) that lists everything
// the screen on show offers, for the half on show. On the Ticket screen with Insights on: "All insights", then every card (a dot marks
// the ones that need a look); with AI Assist on: "Suggested", then every AI action this record offers (a click starts it, preview
// first, as everywhere). On the other screens: their sections, a click brings one into view. The screens themselves stay in the bar at
// the bottom (App.jsx ScreenTabs).
//
// The pieces:
//   RailContext        the store the shell made (railStore.js); screens publish into it with useRailPublish
//   useRailPublish     a screen says what its rail lists while it is on show (TicketView, ScreenView)
//   useSectionRegistry + RailSectionsContext + useRailSection
//                      a screen whose rail lists its sections: each section registers itself (a ref on its element), so a section
//                      that is not drawn for this person (a profile, a policy) is not in the rail either; the order is the page's
//   goToSection        a click on a section item: open it if it folds, bring it into view, put the focus on its heading
//   SideRail           the rail itself (drawn by the shell for the screen on show)

export const RailContext = createContext(null);

/** Publish this screen's rail while it is on show (`active`), and take it away when it is not. Cheap on every render (railStore). */
export function useRailPublish(screen, rail, active) {
  const store = useContext(RailContext);
  useEffect(() => {
    if (!store) return;
    if (active && rail) store.publish(screen, rail);
    else store.clear(screen);
  });
  useEffect(() => () => store?.clear(screen), [store, screen]);
}

export const RailSectionsContext = createContext(null);

// The page's order: a section drawn higher comes first. A section may say its place (`order`: a dashboard whose widgets the person
// moves); then that decides. (Without a DOM, in a test, the order they registered in.)
function byPage(a, b) {
  if (Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) return a.order - b.order;
  if (!a.el || !b.el || typeof a.el.compareDocumentPosition !== 'function') return a.n - b.n;
  return a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1; // 4: Node.DOCUMENT_POSITION_FOLLOWING
}

/**
 * The sections of one half, as they register (useRailSection). Returns [registry, entries]: give the registry to RailSectionsContext
 * around the half; `entries` ({ id, label, icon, attention, el, open }) are in the page's order and change only when a section came,
 * went or changed its name, icon or mark.
 */
export function useSectionRegistry() {
  const map = useRef(new Map());
  const count = useRef(0);
  const [version, setVersion] = useState(0);
  const registry = useMemo(
    () => ({
      set(id, entry) {
        const was = map.current.get(id);
        const next = { n: was ? was.n : count.current++, ...entry, id };
        map.current.set(id, next);
        if (!was || was.label !== next.label || was.icon !== next.icon || was.attention !== next.attention || was.el !== next.el || was.order !== next.order) setVersion((v) => v + 1);
      },
      remove(id) {
        if (map.current.delete(id)) setVersion((v) => v + 1);
      },
    }),
    []
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => [...map.current.values()].sort(byPage), [version]);
  return [registry, entries];
}

/**
 * A section that the rail lists. Put the returned ref on the section's element. `open`: for a section that folds, a function that
 * opens it (called before it is brought into view). `order`: its place, for sections the person can move (a dashboard's widgets);
 * left out, the page's order decides. Does nothing outside a RailSectionsContext (a section drawn elsewhere).
 */
export function useRailSection({ id, label, icon = 'chevronRight', attention = '', open = null, order = undefined }) {
  const registry = useContext(RailSectionsContext);
  const opener = useRef(open);
  opener.current = open;
  const [el, setEl] = useState(null);
  useEffect(() => {
    if (!registry || !id || !label) return;
    registry.set(id, { label, icon, attention, el, order, open: () => opener.current?.() });
  }, [registry, id, label, icon, attention, el, order]);
  useEffect(() => () => registry?.remove(id), [registry, id]);
  return useCallback(
    (node) => {
      if (node) node.setAttribute('data-rail-section', id);
      setEl(node);
    },
    [id]
  );
}

/**
 * A click on a section item: open it if it folds, then (once that has drawn) bring it into view and put the focus on its title: the
 * fold button of a card (its own title, and a real control), else its heading, else the section itself.
 */
export function goToSection(entry, win = typeof window === 'undefined' ? null : window) {
  entry?.open?.();
  const el = entry?.el;
  if (!el || !win) return;
  const still = Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  win.setTimeout(() => {
    el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    const toggle = el.querySelector?.('.ab-cardx-toggle');
    const heading = el.matches?.('h2, h3, h4') ? el : el.querySelector?.('h2, h3, h4');
    const target = toggle || heading || el;
    if (target !== toggle && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
  }, 0);
}

/** The name of an item for a screen reader (the same words the tip shows, with what the marks say). */
export function railItemName(it) {
  if (it.ai) return t('{label} (AI)', { label: it.label });
  if (it.attention) return t('{label}: needs a look', { label: it.label });
  return it.label;
}

const NAMES_ID = 'ab-rail-names';

/**
 * The rail of the screen on show. props: rail ({ title, items }: railStore's shape), names (the names are shown: the rail is wide),
 * onNames(next), onSelect(id). One tab stop; the arrow keys, Home and End move along it. The name of an icon shows beside it on hover
 * and on the keyboard (one tip, fixed to the window, so the rail's own scrolling cannot cut it off).
 */
export function SideRail({ rail, names = false, onNames = () => {}, onSelect = () => {} }) {
  const [tip, setTip] = useState(null);
  const [focusId, setFocusId] = useState('');
  const inner = useRef(null);
  const items = rail?.items || [];
  const ids = [...items.map((it) => it.id), NAMES_ID];
  const tabId = ids.includes(focusId) ? focusId : items.find((it) => it.current)?.id || ids[0];

  // The names were just shown or hidden, or the screen changed: no tip is left behind.
  useEffect(() => setTip(null), [names, rail]);

  if (!items.length) return null;

  const show = (e, text, ai = false) => {
    if (names || typeof window === 'undefined') return;
    const r = e.currentTarget.getBoundingClientRect();
    const rtl = window.getComputedStyle(e.currentTarget).direction === 'rtl';
    setTip({ text, ai, top: Math.round(r.top + r.height / 2), side: rtl ? { left: Math.round(r.right + 8) } : { right: Math.round(window.innerWidth - r.left + 8) } });
  };
  const hide = () => setTip(null);
  const focusOn = (id) => inner.current?.querySelector(`[data-rail-id="${CSS.escape(id)}"]`)?.focus();
  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = ids.indexOf(tabId);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % ids.length;
    else if (e.key === 'ArrowUp') next = (at - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (e.key === 'Escape' && tip) {
      hide();
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    setFocusId(ids[next]);
    focusOn(ids[next]);
  };
  const namesLabel = names ? t('Hide names') : t('Show names');

  return (
    <nav className={`ab-rail${names ? ' is-wide' : ''}`} aria-label={t('Side rail: {name}', { name: rail.title })} onKeyDown={onKeyDown}>
      <div className="ab-rail-inner" ref={inner}>
        {names && rail.title && (
          <p className="ab-rail-title" aria-hidden="true">
            {rail.title}
          </p>
        )}
        {/* The items scroll on their own when there are more than fit (AI Assist offers many); "Show names" stays at the foot. */}
        <div className="ab-rail-list" onScroll={hide}>
        {items.map((it) => (
          <Fragment key={it.id}>
            {it.separator && <span className="ab-rail-rule" aria-hidden="true" />}
            <button
              type="button"
              className="ab-rail-item"
              data-rail-id={it.id}
              tabIndex={it.id === tabId ? 0 : -1}
              aria-current={it.current ? 'true' : undefined}
              aria-disabled={it.disabled ? 'true' : undefined}
              aria-label={railItemName(it)}
              onClick={() => {
                if (it.disabled) return;
                setFocusId(it.id);
                onSelect(it.id);
              }}
              onFocus={(e) => {
                setFocusId(it.id);
                show(e, it.label, it.ai);
              }}
              onBlur={hide}
              onMouseEnter={(e) => show(e, it.label, it.ai)}
              onMouseLeave={hide}
            >
              <Icon name={it.icon || 'chevronRight'} size={20} />
              {names && (
                <span className="ab-rail-name" aria-hidden="true">
                  {it.label}
                </span>
              )}
              {names && it.ai && <AiBadge label="" title="" />}
              {it.attention && <span className={`ab-rail-dot is-${it.attention}`} aria-hidden="true" />}
            </button>
          </Fragment>
        ))}
        </div>
        <button
          type="button"
          className="ab-rail-item ab-rail-names"
          data-rail-id={NAMES_ID}
          tabIndex={tabId === NAMES_ID ? 0 : -1}
          aria-expanded={names}
          aria-label={namesLabel}
          onClick={() => {
            hide();
            onNames(!names);
          }}
          onFocus={(e) => {
            setFocusId(NAMES_ID);
            show(e, namesLabel);
          }}
          onBlur={hide}
          onMouseEnter={(e) => show(e, namesLabel)}
          onMouseLeave={hide}
        >
          <Icon name={names ? 'chevronRight' : 'chevronLeft'} size={20} />
          {names && (
            <span className="ab-rail-name" aria-hidden="true">
              {namesLabel}
            </span>
          )}
        </button>
      </div>
      {tip && (
        <span className="ab-rail-tip" aria-hidden="true" style={{ top: tip.top, ...tip.side }}>
          {tip.text}
          {tip.ai && <AiBadge label="" title="" size={12} />}
        </span>
      )}
    </nav>
  );
}
