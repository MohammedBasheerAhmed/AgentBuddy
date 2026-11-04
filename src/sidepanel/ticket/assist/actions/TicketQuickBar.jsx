import QuickBar from '../../../QuickBar.jsx';
import { INSIGHT_CARDS } from '../../cards/index.js';
import { cardsFor } from '../../TicketInsights.jsx';
import { stageOf } from '../../../../features/stages.js';
import { aiAvailable } from '../../../../profiles/profiles.js';
import { featureBlock, offeredFeatures, recordBlock } from './plan.js';

// The quick-actions bar of the Ticket screen, drawn inside the ticket at a glance (TRACKER.md F6). State-aware: what fits the
// ticket's stage comes first. Both halves: AI actions (only when AI can be used now, and only those that can run on this record) and
// Insights cards (opened with onShowCard; their ids are the Insights agent's INSIGHT_CARDS ids, 'resolve' and 'related').
//
// props: { page, eff, record, header, busy, aiReady, onRun(feature), onShowCard(cardId) }

// The checklist action needs a read to know whether it is offered (src/sidepanel/ticket/assist/actions/useChecklistNeed.js): the
// bar does not make it, so the bar never holds that action.
const NOT_IN_BAR = { 'fulfilment-checklist': false };

/**
 * The ids of the Insights cards this record shows: the very cards the Insights half draws (TicketInsights cardsFor: the record's
 * kind, the person's profiles, a card's own `when`), as the ids the bar's card items name. The bar needs no order.
 */
export function cardIdsFor(record, header, eff) {
  return cardsFor(INSIGHT_CARDS, record || {}, header, eff).map((c) => c.id);
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
      cards={cardIdsFor(record, header, eff)}
      eff={eff}
      disabled={busy}
      aiReady={ai}
      onRun={onRun}
      onShowCard={onShowCard}
    />
  );
}
