import { useEffect, useId, useState } from 'react';
import { MAX_QUICK, QUICK_CARDS, QUICK_LABELS, isQuickCard, isQuickId, quickItems } from '../features/quick.js';
import { saveSettings } from '../lib/storage.js';
import { AiBadge } from './ui/primitives.jsx';
import { Icon, featureIcon } from './ui/icons.jsx';
import { t, t as tr } from '../i18n/index.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const cardId = (card) => `card:${card}`;

/**
 * The few actions worth one click, in the ticket at a glance. It holds items from both halves of the Ticket screen, each marked:
 * AI actions (the AI mark; they start the action exactly like a click in AI Assist does, preview first) and Insights items (no mark;
 * they open that card of the Insights half, nothing is sent). It folds down to one strip (the choice is remembered) and the person
 * can choose which items it holds, per kind of record. The same choice feeds the bar on the ServiceNow page (AI items only there).
 *
 * What the person changes shows at once and is saved behind the scenes: the saved settings come back a moment later (storage, then
 * the panel's settings reload), and two ticks in that moment must both count, so the bar works from its own copy until the saved one
 * has caught up with it.
 *
 * props: kind (of the open record), stage (src/features/stages.js; null when unknown), features (the AI actions this record offers
 *        right now: only these can show), cards (the ids of the Insights cards this record shows: 'ready', 'related'), eff,
 *        disabled (an answer is on its way: the AI items wait), aiReady (false: AI cannot be used now, so no AI items at all),
 *        onRun(feature), onShowCard(cardId)
 */
export default function QuickBar({ kind, stage = null, features = [], cards = [], eff, disabled = false, aiReady = true, onRun, onShowCard }) {
  const bodyId = useId();
  const AI_HOVER = t('Uses AI. Masked text goes to the AI you chose, after a preview.');
  const [choosing, setChoosing] = useState(false);
  const [mine, setMine] = useState(null); // { open?, pins? } changed here and not saved back yet
  const [problem, setProblem] = useState('');
  const savedOpen = eff.values.quickBarOpen !== false;
  const savedPins = eff.values.quickPins || {};
  const open = mine && 'open' in mine ? mine.open : savedOpen;
  const pins = mine && 'pins' in mine ? mine.pins : savedPins;

  // The saved settings caught up with what was changed here: drop the copy.
  useEffect(() => {
    if (!mine) return;
    if ((!('open' in mine) || mine.open === savedOpen) && (!('pins' in mine) || same(mine.pins, savedPins))) setMine(null);
  }, [mine, savedOpen, savedPins]);

  const aiFeatures = aiReady ? features : [];
  const byId = new Map(aiFeatures.map((f) => [f.id, f]));
  // Insights items only where the shell can open a card.
  const shownCards = typeof onShowCard === 'function' ? cards.filter((c) => isQuickCard(cardId(c))) : [];
  // Only what this record really offers. Pins that name nothing it offers (a hand-edited setting, an action renamed in a later
  // version, an AI action while AI is off) must not leave the bar empty: the suggestions stand in.
  const itemsFor = (own) => quickItems({ kind, stage, pins: own, policy: eff.policy, offered: aiFeatures.map((f) => f.id), cards: shownCards, ai: aiReady });
  const items = itemsFor(pins);
  const shownIds = items.map((a) => a.id);
  const pinnable = [
    ...aiFeatures.filter((f) => isQuickId(f.id)).map((f) => ({ id: f.id, label: QUICK_LABELS[f.id], ai: true })),
    ...shownCards.map((c) => ({ id: cardId(c), label: QUICK_CARDS[cardId(c)].label, ai: false })),
  ];
  if (!items.length && !pinnable.length) return null;

  const save = (patch, local) => {
    setProblem('');
    setMine((m) => ({ ...(m || {}), ...local }));
    saveSettings(patch).catch(() => {
      setMine(null);
      setProblem(t('Agent Buddy could not save that choice. Try again.'));
    });
  };
  const setOpen = (next) => save({ quickBarOpen: next }, { open: next });
  const setPins = (ids) => {
    const next = { ...pins };
    if (ids) next[kind] = ids;
    else delete next[kind];
    save({ quickPins: next }, { pins: next });
  };
  const toggle = (id) => setPins(shownIds.includes(id) ? shownIds.filter((x) => x !== id) : [...shownIds, id].slice(0, MAX_QUICK));

  return (
    <section className="ab-quick" aria-label={t('Quick actions')}>
      <div className="ab-quick-head">
        <button type="button" className="ab-quick-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className={`ab-quick-chevron${open ? ' ab-quick-chevron-open' : ''}`} aria-hidden="true" />
          {t('Quick actions')}
        </button>
        {open && pinnable.length > 1 && (
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" aria-pressed={choosing} aria-label={choosing ? t('Done choosing quick actions') : t('Choose quick actions')} onClick={() => setChoosing((on) => !on)}>
            {choosing ? t('Done') : t('Choose')}
          </button>
        )}
      </div>

      {open && (
        <div id={bodyId}>
          {!choosing && (
            <div className="ab-quick-actions" role="group" aria-label={t('Quick actions')}>
              {items.map((a) =>
                a.ai ? (
                  <button key={a.id} type="button" data-quick={a.id} className="ab-btn ab-btn-ai-quiet ab-quick-tile ab-quick-ai" disabled={disabled} title={AI_HOVER} aria-label={t('{label} (AI)', { label: tr(a.label) })} onClick={() => onRun(byId.get(a.id))}>
                    <span className="ab-quick-icon"><Icon name={featureIcon(a.id)} size={16} /></span>
                    <span className="ab-quick-label">{tr(a.label)}</span>
                    <AiBadge label="" title={AI_HOVER} />
                  </button>
                ) : (
                  <button key={a.id} type="button" data-quick={a.id} className="ab-btn ab-quick-tile ab-quick-insight" title={t('Opens the card in Insights. Stays in ServiceNow.')} onClick={() => onShowCard(a.card)}>
                    <span className="ab-quick-icon"><Icon name={featureIcon(a.id)} size={16} /></span>
                    <span className="ab-quick-label">{tr(a.label)}</span>
                  </button>
                )
              )}
            </div>
          )}

          {choosing && (
            <fieldset className="ab-quick-choose">
              <legend className="ab-hint">{t('Pick up to {MAX_QUICK} for this kind of record. The AI ones also show on the ServiceNow page.', { MAX_QUICK })}</legend>
              {pinnable.map((p) => {
                const on = shownIds.includes(p.id);
                return (
                  <label key={p.id} className="ab-check">
                    <input type="checkbox" checked={on} disabled={on ? shownIds.length === 1 : shownIds.length >= MAX_QUICK} onChange={() => toggle(p.id)} />
                    <span className="ab-quick-choice">{tr(p.label)}</span>
                    {p.ai && <AiBadge />}
                  </label>
                );
              })}
              {pins[kind]?.length > 0 && (
                <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => setPins(null)}>
                  {t('Use the suggested ones')}
                </button>
              )}
            </fieldset>
          )}
          {problem && <p className="ab-note ab-note-danger" role="alert">{problem}</p>}
        </div>
      )}
    </section>
  );
}
