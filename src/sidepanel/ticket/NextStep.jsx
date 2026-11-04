import { AiBadge } from '../ui/primitives.jsx';
import { destinationOf } from '../shell/shellParts.jsx';
import { t, t as tr } from '../../i18n/index.js';

/**
 * The Ticket screen's one main step: the action the ticket's state suggests first (src/sidepanel/ticket/assist/actions/plan.js
 * nextStep), as the screen's one filled button, and one line under it that says what happens. A click starts it exactly as its row in
 * AI Assist does (onRun: useRun, the check before sending, policy); AI Assist comes forward with the answer.
 *
 * props: feature, eff, busy (an answer is on its way: the step waits), onRun(feature)
 */
export default function NextStep({ feature, eff, busy = false, onRun }) {
  const where = destinationOf(eff);
  const hover = where ? t('Sends masked text to {where}. You see it first.', { where }) : t('Sends masked text to your AI. You see it first.');
  return (
    <div className="ab-next">
      <button type="button" className="ab-btn ab-btn-primary ab-btn-lg ab-btn-block ab-next-btn" data-next={feature.id} disabled={busy} title={hover} onClick={() => onRun(feature)}>
        <AiBadge label="" title={hover} size={16} />
        <span className="ab-next-label">{tr(feature.title)}</span>
      </button>
      <p className="ab-next-note">{t('AI writes it from the masked ticket. You see what is sent first.')}</p>
    </div>
  );
}
