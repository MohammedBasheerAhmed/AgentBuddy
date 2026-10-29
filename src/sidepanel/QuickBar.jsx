import { useId, useState } from 'react';
import { MAX_QUICK, QUICK_LABELS, isQuickId, quickActions } from '../features/quick.js';
import { saveSettings } from '../lib/storage.js';

/**
 * The few actions worth one click, above the record's tabs. It folds down to one strip (the choice is remembered) and the person can
 * choose which actions it holds, per kind of record. The same choice feeds the bar on the ServiceNow page.
 *
 * props: kind (of the open record), features (what the full Actions list offers for it: the bar shows only these), eff,
 *        disabled (no AI key yet, or an answer is on screen), onRun(feature) (starts the action like a click in the list does)
 */
export default function QuickBar({ kind, features, eff, disabled, onRun }) {
  const bodyId = useId();
  const [choosing, setChoosing] = useState(false);
  const open = eff.values.quickBarOpen !== false;
  const pins = eff.values.quickPins || {};

  const byId = new Map(features.map((f) => [f.id, f]));
  // Only what the Actions list really offers for this record. Pins that name nothing it offers (a hand-edited setting, an action
  // renamed in a later version) must not leave the bar empty: the suggestions stand in.
  const offered = (own) => quickActions({ kind, pins: own, policy: eff.policy }).filter((a) => byId.has(a.id));
  const own = offered(pins);
  const actions = own.length ? own : offered({});
  const shownIds = actions.map((a) => a.id);
  const pinnable = features.filter((f) => isQuickId(f.id));
  if (!actions.length && !pinnable.length) return null;

  const setOpen = (next) => saveSettings({ quickBarOpen: next });
  const setPins = (ids) => {
    const next = { ...pins };
    if (ids) next[kind] = ids;
    else delete next[kind];
    return saveSettings({ quickPins: next });
  };
  const toggle = (id) => setPins(shownIds.includes(id) ? shownIds.filter((x) => x !== id) : [...shownIds, id].slice(0, MAX_QUICK));

  return (
    <section className="ab-quick" aria-label="Quick actions">
      <div className="ab-quick-head">
        <button type="button" className="ab-quick-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className={`ab-quick-chevron${open ? ' ab-quick-chevron-open' : ''}`} aria-hidden="true" />
          Quick actions
        </button>
        {open && pinnable.length > 1 && (
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-pressed={choosing} onClick={() => setChoosing((on) => !on)}>
            {choosing ? 'Done' : 'Choose'}
          </button>
        )}
      </div>

      {open && (
        <div id={bodyId}>
          {!choosing && (
            <div className="ab-quick-actions" role="group" aria-label="Quick actions">
              {actions.map((a, i) => (
                <button key={a.id} type="button" className={`ab-btn ab-btn-sm${i === 0 ? ' ab-btn-primary' : ''}`} disabled={disabled} onClick={() => onRun(byId.get(a.id))}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {choosing && (
            <fieldset className="ab-quick-choose">
              <legend className="ab-hint">Pick up to {MAX_QUICK} for this kind of record. They also show on the ServiceNow page.</legend>
              {pinnable.map((f) => {
                const on = shownIds.includes(f.id);
                return (
                  <label key={f.id} className="ab-check">
                    <input type="checkbox" checked={on} disabled={on ? shownIds.length === 1 : shownIds.length >= MAX_QUICK} onChange={() => toggle(f.id)} />
                    <span>{QUICK_LABELS[f.id]}</span>
                  </label>
                );
              })}
              {pins[kind]?.length > 0 && (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setPins(null)}>
                  Use the suggested ones
                </button>
              )}
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
