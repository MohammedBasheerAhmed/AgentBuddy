// Settings, Basics: the side rail and the small bar on the ServiceNow page. The rail lists the five of each screen and then All tools
// (docs/focus-layout.md); it has nothing left to arrange, so the section only says whether it is drawn at all (railShow, off by
// default) and, while it is, whether it shows its names (railNames, which the rail's own button changes too). Then the small bar on
// the ServiceNow page: on or off (pageBar, which the organisation can lock) and which AI actions it holds per kind of record
// (quickPins, up to 4). What each kind offers the bar is worked out in ../railOptions.js.
import { useEffect, useRef, useState } from 'react';
import { Locked, SectionHead, Status, Switch, useSaveSetting } from '../fields.jsx';
import { MAX_QUICK, pagePicks, railKinds, togglePagePick } from '../railOptions.js';
import { Icon } from '../../sidepanel/ui/icons.jsx';
import { nextTabIndex } from '../../sidepanel/tabKeys.js';
import { t } from '../../i18n/index.js';

const PANEL_ID = 'rail-page-panel';
const PAGE_TITLE_ID = 'rail-page-title';
const DESC_ID = 'rail-show-desc';

/**
 * A stored value the section changes several times in a row (pills pressed one after the other): the section draws its own copy at
 * once and saves it, so a second click builds on the first even before the page has read the settings again. The copy follows the
 * stored value whenever no save is on its way; a save the browser refused puts the stored value back.
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
 * A row of tabs that picks the kind of record the bar's actions below are chosen for. One tab stop; Left/Right, Home and End move
 * between the tabs (src/sidepanel/tabKeys.js). Every tab controls the one panel below.
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
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function RailSection({ eff, reload }) {
  const v = eff.values;
  const { status, save } = useSaveSetting(reload);
  const [pins, applyPins] = useDraft(v.quickPins || {});
  const kinds = railKinds(eff);
  const [kindChoice, setKind] = useState(kinds[0].id);
  const kind = kinds.find((k) => k.id === kindChoice) || kinds[0];
  const railOn = v.railShow === true;

  const picks = pagePicks(kind.id, eff, pins);
  const full = picks.chosen.length >= MAX_QUICK;
  const pick = (id) => {
    const next = togglePagePick(pins, kind.id, picks.chosen, id);
    if (next !== pins) applyPins(next, (n) => save({ quickPins: n }));
  };

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-rail">
      <SectionHead id="h-rail" title={t('Side rail')} descId={DESC_ID}>
        {t('The five of each screen on the right of the panel, with All tools at its foot.')}
      </SectionHead>
      <div className="ab-set-switches ab-set-rail-switches">
        <Switch id="rail-show" checked={railOn} describedBy={DESC_ID} onChange={(on) => save({ railShow: on })}>
          {t('Show the side rail')}
        </Switch>
        {/* Under the switch it belongs to, and only while there is a rail to show names in. */}
        {railOn && (
          <div className="ab-set-subswitch">
            <Switch id="rail-names" checked={v.railNames === true} onChange={(on) => save({ railNames: on })}>
              {t('Show names')}
            </Switch>
          </div>
        )}
      </div>

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
          <ChoiceTabs label={t('Kind of ticket')} idBase="rail-kind" items={kinds} value={kind.id} onChange={setKind} />
          <div id={PANEL_ID} role="tabpanel" aria-labelledby={`rail-kind-tab-${kind.id}`}>
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
        </div>
      )}
      <Status status={status} />
    </section>
  );
}
