import { useId, useMemo, useState } from 'react';
import { AiBadge } from '../../../ui/primitives.jsx';
import { destinationOf } from '../../../shell/shellParts.jsx';
import { featureById } from '../../../../features/registry.js';
import { actionPlan, offeredFeatures } from './plan.js';
import { useChecklistNeed } from './useChecklistNeed.js';
import { t, t as tr } from '../../../../i18n/index.js';

// The AI actions of the Ticket screen (TRACKER.md 3.5 and 2.4): the three that fit the ticket's state first, the first of them the one
// primary button of the screen; everything else folded under "More actions", by what the agent is doing (Understand, Reply, Work it,
// Resolve). An action that cannot run says why on its button instead of failing after the click; a reason that stops every action
// (a blocked table, HR content not allowed) is said once, above them.
//
// props: { page, eff, record, header, busy, aiReady, quiet, onRun(feature, options) }
//   busy: an answer is being read, previewed or sent (the buttons wait); aiReady: AI can be used now (the shell says how to set it
//   up when it cannot, so this view only disables); quiet: an answer with its own filled main button is on screen, so the first
//   suggestion is drawn as an ordinary button (one filled button per screen). Every action goes through onRun, which is useRun:
//   preview, masking and policy.

const CHECKLIST = 'fulfilment-checklist';
const CHECKLIST_KINDS = ['catalog_task', 'requested_item'];

function ActionButton({ item, primary, off, where, onRun }) {
  const { feature, reason, caution } = item;
  const hover = reason || (where ? t('Sends masked text to {where}. You see it first.', { where }) : t('Sends masked text to your AI. You see it first.'));
  return (
    <li className="ab-act-item">
      <button
        type="button"
        className={`ab-act${primary ? ' ab-act-primary ab-btn-ai' : ''}`}
        data-feature={feature.id}
        disabled={off || Boolean(reason)}
        title={hover}
        onClick={() => onRun(feature)}
      >
        <span className="ab-act-line">
          <span className="ab-act-title">{tr(feature.title)}</span> <AiBadge title={hover} />
        </span>
        <span className={`ab-act-desc${reason ? ' ab-act-reason' : ''}`}>{reason || tr(feature.description)}</span>
      </button>
      {caution && <p className="ab-act-caution">{caution}</p>}
    </li>
  );
}

export default function ActionGroups({ page, eff, record, header = null, busy = false, aiReady = true, quiet = false, onRun }) {
  const moreId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const kind = record?.kind || 'other';

  // The checklist action is offered only when the written instructions have no steps: that needs one read, made only where it can
  // matter (a request item or task, the action allowed and in the person's profiles, AI usable now).
  const checklist = featureById(CHECKLIST);
  const wantChecklist =
    Boolean(aiReady && checklist && CHECKLIST_KINDS.includes(kind)) && offeredFeatures({ record, header, eff, features: [checklist] }).length > 0;
  const need = useChecklistNeed({ page, eff, record, wanted: wantChecklist });

  const plan = useMemo(() => actionPlan({ record, header, eff, gates: { [CHECKLIST]: need === true } }), [record, header, eff, need]);
  const where = destinationOf(eff);
  const off = !aiReady || busy || Boolean(plan.block);

  if (!plan.total) {
    return (
      <section className="ab-acts" aria-label={t('AI actions')}>
        <p className="ab-act-empty">{t('No AI actions fit this record. Insights still has what can be read here.')}</p>
      </section>
    );
  }

  return (
    <section className="ab-acts" aria-label={t('AI actions')} data-stage={plan.stage || 'unknown'}>
      {plan.block && (
        <p className="ab-note ab-note-warn" role="note">
          {plan.block}
        </p>
      )}
      {plan.suggested.length > 0 && (
        <>
          <p className="ab-act-head">{plan.words}</p>
          <ul className="ab-act-list" aria-label={plan.words}>
            {plan.suggested.map((it, i) => (
              <ActionButton key={it.feature.id} item={it} primary={i === 0 && !off && !quiet} off={off} where={where} onRun={onRun} />
            ))}
          </ul>
        </>
      )}
      {plan.more > 0 && (
        <div className="ab-act-more">
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-act-moretoggle" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!moreOpen)}>
            <span className={`ab-act-chevron${moreOpen ? ' is-open' : ''}`} aria-hidden="true" />
            {moreOpen ? t('Fewer actions') : t('More actions ({count})', { count: plan.more })}
          </button>
          <div id={moreId} className="ab-act-groups" hidden={!moreOpen}>
            {plan.groups.map((g) => (
              <div key={g.id} className="ab-act-group" role="group" aria-labelledby={`${moreId}-${g.id}`}>
                <h3 className="ab-act-grouphead" id={`${moreId}-${g.id}`}>{g.label}</h3>
                <ul className="ab-act-list">
                  {g.items.map((it) => (
                    <ActionButton key={it.feature.id} item={it} primary={false} off={off} where={where} onRun={onRun} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
