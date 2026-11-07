import { useId, useMemo, useState } from 'react';
import { AiBadge } from '../../../ui/primitives.jsx';
import { Icon, featureIcon } from '../../../ui/icons.jsx';
import FormatEditor from '../../../../formats/FormatEditor.jsx';
import { orgFormatOf, resolveFormat, specOf } from '../../../../formats/formats.js';
import { saveFormat } from '../../../../formats/saveFormat.js';
import { destinationOf } from '../../../shell/shellParts.jsx';
import { featureById } from '../../../../features/registry.js';
import { actionPlan, offeredFeatures } from './plan.js';
import { useChecklistNeed } from './useChecklistNeed.js';
import { t, t as tr } from '../../../../i18n/index.js';

// The AI actions of the Ticket screen (docs/focus-layout.md, A): FIVE rows, one per pain point the record has an action for
// (understand the ticket, find the fix, the same caller, reply, close well; src/features/focus.js). Each row names its pain point in a
// small label above it, then the action as a row (an icon, the name, one line); a click starts it. The first of the ticket's stage that
// can run carries the screen's one filled mark ("Start" on its row). Every other action the record offers is in All tools.
// An action that cannot run says why instead of failing after the click; a reason that stops every action (a blocked table, HR content
// not allowed) is said once, above them. useActionPlan works the plan out once, for these rows and for the side rail.
//
// FocusActions props: { plan (useActionPlan), eff, busy, aiReady, quiet, onRun(feature, options) }
//   busy: an answer is being read, previewed or sent (the buttons wait); aiReady: AI can be used now (the shell says how to set it
//   up when it cannot, so this view only disables); quiet: an answer with its own filled main button is on screen, so no row is filled
//   (one filled button per screen). Every action goes through onRun, which is useRun: preview, masking and policy.

const CHECKLIST = 'fulfilment-checklist';
const CHECKLIST_KINDS = ['catalog_task', 'requested_item'];

/**
 * What AI Assist offers on this record (actionPlan), worked out once for its five rows and the side rail.
 * The checklist action is offered only when the written instructions have no steps: that needs one read, made only where it can
 * matter (a request item or task, the action allowed and in the person's profiles, AI usable now).
 */
export function useActionPlan({ page, eff, record, header = null, aiReady = true }) {
  const kind = record?.kind || 'other';
  const checklist = featureById(CHECKLIST);
  const wantChecklist =
    Boolean(aiReady && checklist && CHECKLIST_KINDS.includes(kind)) && offeredFeatures({ record, header, eff, features: [checklist] }).length > 0;
  const need = useChecklistNeed({ page, eff, record, wanted: wantChecklist });
  return useMemo(() => actionPlan({ record, header, eff, gates: { [CHECKLIST]: need === true } }), [record, header, eff, need]);
}

// "Change format" under an action whose answer can be laid out (src/formats): the same editor as in Settings, opened in place. It saves to
// the person's settings at once; the panel follows the change (useEffective listens to storage). Open or shut, it never starts an action.
function FormatToggle({ feature, eff }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const { source } = resolveFormat(feature.id, eff.values.formats, eff.policy?.orgFormats);
  // The organisation's format whatever is in force, so the editor can offer it back after the person chose their own or the standard
  // one (the same as Settings, src/options/FormatsSection.jsx).
  const inherited = orgFormatOf(feature.id, eff.policy?.orgFormats);
  const mark = {
    mine: t('Your format'),
    standard: t('Your choice: the standard format'),
    org: t("Your organisation's format"),
    locked: t('Set by your organisation'),
  }[source];
  return (
    <div className="ab-fmt-open">
      <p className="ab-fmt-line">
        <button type="button" className="ab-act-link" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          {source === 'locked' ? t('See format') : t('Change format')}
          <Icon name="chevronDown" size={14} className="ab-chevron" />
        </button>
        {mark && <span className={`ab-fmt-state ab-fmt-state-${source}`}>{mark}</span>}
      </p>
      {open && (
        <div id={bodyId}>
          <FormatEditor
            feature={feature}
            saved={eff.values.formats?.[feature.id] || null}
            source={source}
            inherited={inherited}
            idBase={`act-fmt-${feature.id}`}
            inPanel
            onSave={(next) => saveFormat(feature.id, next)}
          />
        </div>
      )}
    </div>
  );
}

const hoverOf = (reason, where) => reason || (where ? t('Sends masked text to {where}. You see it first.', { where }) : t('Sends masked text to your AI. You see it first.'));

/**
 * One of the five: the pain point it answers as a small label above it (outside the button, so the button's text starts with the
 * action's title), then a row that starts the action on a click. The primary one carries the screen's one filled mark, "Start".
 */
function ActionRow({ pain = '', painTitle = '', item, primary, off, where, eff, onRun }) {
  const { feature, reason, caution } = item;
  const hover = hoverOf(reason, where);
  return (
    <li className="ab-act-item" data-pain={pain || undefined}>
      {painTitle && <p className="ab-act-pain">{painTitle}</p>}
      <button
        type="button"
        className={`ab-row ab-act ab-act-row${primary ? ' ab-act-primary' : ''}`}
        data-feature={feature.id}
        disabled={off || Boolean(reason)}
        title={hover}
        onClick={() => onRun(feature)}
      >
        <span className="ab-act-icon" aria-hidden="true">
          <Icon name={featureIcon(feature.id)} size={16} />
        </span>
        <span className="ab-row-main">
          <span className="ab-act-line">
            <span className="ab-row-title ab-act-title">{tr(feature.title)}</span> <AiBadge label="" title={hover} />
          </span>
          <span className={`ab-row-sub ab-act-desc${reason ? ' ab-act-reason' : ''}`}>{reason || tr(feature.description)}</span>
        </span>
        {primary && (
          <span className="ab-act-start" aria-hidden="true">
            {t('Start')}
          </span>
        )}
      </button>
      {caution && <p className="ab-act-caution">{caution}</p>}
      {specOf(feature.id) && <FormatToggle feature={feature} eff={eff} />}
    </li>
  );
}

/** The five rows of AI Assist (plan.five). A reason that stops them all is said once, above. */
export function FocusActions({ plan, eff, busy = false, aiReady = true, quiet = false, onRun }) {
  const where = destinationOf(eff);
  const off = !aiReady || busy || Boolean(plan.block);
  if (!plan.total) {
    return (
      <section className="ab-acts ab-acts-five" aria-label={t('AI actions')}>
        <p className="ab-act-empty">{t('No AI actions fit this ticket. Insights still has what can be read here.')}</p>
      </section>
    );
  }
  return (
    <section className="ab-acts ab-acts-five" aria-label={t('AI actions')} data-stage={plan.stage || 'unknown'}>
      {plan.block && (
        <p className="ab-note ab-note-warn" role="note">
          {plan.block}
        </p>
      )}
      {plan.five.length > 0 && (
        <ul className="ab-rows ab-act-list">
          {plan.five.map(({ pain, painTitle, item }) => (
            <ActionRow
              key={item.feature.id}
              pain={pain}
              painTitle={painTitle}
              item={item}
              primary={item.feature.id === plan.primary && !off && !quiet}
              off={off}
              where={where}
              eff={eff}
              onRun={onRun}
            />
          ))}
        </ul>
      )}
      {plan.note && <p className="ab-hint">{plan.note}</p>}
    </section>
  );
}

/** The five rows with their own plan (where nothing else needs the plan). props: { page, eff, record, header, busy, aiReady, quiet, onRun } */
export default function ActionGroups({ page, eff, record, header = null, busy = false, aiReady = true, quiet = false, onRun }) {
  const plan = useActionPlan({ page, eff, record, header, aiReady });
  return <FocusActions plan={plan} eff={eff} busy={busy} aiReady={aiReady} quiet={quiet} onRun={onRun} />;
}
