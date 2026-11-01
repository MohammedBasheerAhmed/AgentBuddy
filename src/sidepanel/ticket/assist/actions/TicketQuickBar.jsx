import QuickBar from '../../../QuickBar.jsx';
import { INSIGHT_CARDS } from '../../cards/index.js';
import { stageOf } from '../../../../features/stages.js';
import { aiAvailable, shownFor } from '../../../../profiles/profiles.js';
import { featureBlock, offeredFeatures, recordBlock } from './plan.js';

// The quick-actions bar of the Ticket screen, drawn inside the ticket at a glance (TRACKER.md F6). State-aware: what fits the
// ticket's stage comes first. Both halves: AI actions (only when AI can be used now, and only those that can run on this record) and
// Insights cards (opened with onShowCard; their ids are the Insights agent's INSIGHT_CARDS ids, 'ready' and 'related').
//
// props: { page, eff, record, header, busy, aiReady, onRun(feature), onShowCard(cardId) }

// The checklist action needs a read to know whether it is offered (src/sidepanel/ticket/assist/actions/useChecklistNeed.js): the
// bar does not make it, so the bar never holds that action.
const NOT_IN_BAR = { 'fulfilment-checklist': false };

/** The Insights card ids this record shows (its kind and the person's profiles). */
export function cardsFor(record, eff, cards = INSIGHT_CARDS) {
  const kind = record?.kind || 'other';
  return (Array.isArray(cards) ? cards : [])
    .filter((c) => c && typeof c.id === 'string' && (c.kinds || ['*']).some((k) => k === '*' || k === kind) && shownFor(c.profiles, eff))
    .map((c) => c.id);
}

export default function TicketQuickBar({ eff, record, header = null, busy = false, aiReady = true, onRun, onShowCard }) {
  const kind = record?.kind || 'other';
  const ai = Boolean(aiReady) && aiAvailable(eff) && !recordBlock({ record, eff });
  const features = ai ? offeredFeatures({ record, header, eff, gates: NOT_IN_BAR }).filter((f) => !featureBlock(f, eff, record)) : [];
  return (
    <QuickBar
      kind={kind}
      stage={stageOf(record, header)}
      features={features}
      cards={cardsFor(record, eff)}
      eff={eff}
      disabled={busy}
      aiReady={ai}
      onRun={onRun}
      onShowCard={onShowCard}
    />
  );
}
