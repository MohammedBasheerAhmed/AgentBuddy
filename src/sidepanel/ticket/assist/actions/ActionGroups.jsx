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

// The AI actions of the Ticket screen (TRACKER.md 3.5 and 2.4), in two parts the AI Assist half places around its answers:
//   SuggestedActions  "Suggested while you work on it": the three that fit the ticket's state, as rows (an icon, the name, one line).
//                     A row starts its action on a click; the first carries the screen's one filled mark ("Start" on its row).
//   MoreActions       "More actions (n)": everything else, folded, as small buttons by what the agent is doing (Understand, Reply,
//                     Work it, Resolve).
// An action that cannot run says why instead of failing after the click; a reason that stops every action (a blocked table, HR content
// not allowed) is said once, above them. useActionPlan works the plan out once for both parts.
//
// props of both: { plan (useActionPlan), eff, busy, aiReady, onRun(feature, options) }; SuggestedActions also `quiet`
//   busy: an answer is being read, previewed or sent (the buttons wait); aiReady: AI can be used now (the shell says how to set it
//   up when it cannot, so this view only disables); quiet: an answer with its own filled main button is on screen, so the first
//   suggestion is not filled (one filled button per screen). Every action goes through onRun, which is useRun: preview, masking and
//   policy.

const CHECKLIST = 'fulfilment-checklist';
const CHECKLIST_KINDS = ['catalog_task', 'requested_item'];

/**
 * What AI Assist offers on this record (actionPlan), worked out once for the suggestions and "More actions".
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

/** One suggested action: a row that starts it on a click. The first one carries the screen's one filled mark, "Start". */
function ActionRow({ item, primary, off, where, eff, onRun }) {
  const { feature, reason, caution } = item;
  const hover = hoverOf(reason, where);
  return (
    <li className="ab-act-item">
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

/** One action under "More actions": a small button with the AI mark; why it cannot run (or a caution) is said under its group. */
function ActionPill({ item, off, where, onRun, noteId }) {
  const { feature, reason } = item;
  const hover = reason || `${tr(feature.description)} ${hoverOf('', where)}`;
  return (
    <li className="ab-act-pill-item">
      <button
        type="button"
        className="ab-act ab-act-pill"
        data-feature={feature.id}
        disabled={off || Boolean(reason)}
        title={hover}
        aria-describedby={noteId}
        onClick={() => onRun(feature)}
      >
        <AiBadge label="" title={hover} />
        <span className="ab-act-title">{tr(feature.title)}</span>
      </button>
    </li>
  );
}

/** "Suggested while you work on it": the actions that fit the ticket's state. A reason that stops them all is said once, above. */
export function SuggestedActions({ plan, eff, busy = false, aiReady = true, quiet = false, onRun }) {
  const headId = `ab-acts${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const where = destinationOf(eff);
  const off = !aiReady || busy || Boolean(plan.block);
  if (!plan.total) {
    return (
      <section className="ab-acts ab-acts-suggested" aria-label={t('AI actions')}>
        <p className="ab-act-empty">{t('No AI actions fit this record. Insights still has what can be read here.')}</p>
      </section>
    );
  }
  return (
    <section className="ab-acts ab-acts-suggested" aria-labelledby={plan.suggested.length ? headId : undefined} aria-label={plan.suggested.length ? undefined : t('AI actions')} data-stage={plan.stage || 'unknown'}>
      {plan.block && (
        <p className="ab-note ab-note-warn" role="note">
          {plan.block}
        </p>
      )}
      {plan.suggested.length > 0 && (
        <>
          <h3 className="ab-section-title ab-act-head" id={headId}>
            {plan.words}
          </h3>
          <ul className="ab-rows ab-act-list">
            {plan.suggested.map((it, i) => (
              <ActionRow key={it.feature.id} item={it} primary={i === 0 && !off && !quiet} off={off} where={where} eff={eff} onRun={onRun} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** "More actions (n)": the rest, folded, as small buttons in their groups. */
export function MoreActions({ plan, eff, busy = false, aiReady = true, onRun }) {
  const moreId = `ab-more${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [open, setOpen] = useState(false);
  if (!plan.total || !plan.more) return null;
  const where = destinationOf(eff);
  const off = !aiReady || busy || Boolean(plan.block);
  return (
    <section className="ab-acts ab-acts-more" aria-label={t('More actions')}>
      <button type="button" className="ab-act-moretoggle" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen(!open)}>
        <span className="ab-act-moretext">
          {t('More actions ({count})', { count: plan.more })}
        </span>
        <Icon name="chevronDown" size={16} className="ab-chevron" />
      </button>
      <div id={moreId} className="ab-act-groups" hidden={!open}>
        {plan.groups.map((g) => {
          // What a button cannot say on itself: why it is off, or where its text would land (a catalog task's reply).
          const notes = g.items.filter((it) => it.reason || it.caution);
          const noteId = (it) => `${moreId}-${it.feature.id}-note`;
          return (
            <div key={g.id} className="ab-act-group" role="group" aria-labelledby={`${moreId}-${g.id}`}>
              <h4 className="ab-act-grouphead" id={`${moreId}-${g.id}`}>
                {g.label}
              </h4>
              <ul className="ab-act-pills">
                {g.items.map((it) => (
                  <ActionPill key={it.feature.id} item={it} off={off} where={where} onRun={onRun} noteId={it.reason || it.caution ? noteId(it) : undefined} />
                ))}
              </ul>
              {notes.map((it) => (
                <p key={it.feature.id} id={noteId(it)} className={it.reason ? 'ab-act-reason ab-act-note' : 'ab-act-caution ab-act-note'}>
                  {t('{action}: {why}', { action: tr(it.feature.title), why: it.reason || it.caution })}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Both parts together (where nothing goes between them). props: { page, eff, record, header, busy, aiReady, quiet, onRun } */
export default function ActionGroups({ page, eff, record, header = null, busy = false, aiReady = true, quiet = false, onRun }) {
  const plan = useActionPlan({ page, eff, record, header, aiReady });
  return (
    <>
      <SuggestedActions plan={plan} eff={eff} busy={busy} aiReady={aiReady} quiet={quiet} onRun={onRun} />
      <MoreActions plan={plan} eff={eff} busy={busy} aiReady={aiReady} onRun={onRun} />
    </>
  );
}
