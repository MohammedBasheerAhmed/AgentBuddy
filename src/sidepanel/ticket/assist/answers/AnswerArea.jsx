import React, { useEffect, useRef, useState } from 'react';
import PreviewDialog from '../../../PreviewDialog.jsx';
import { resolveProviderConfig } from '../../../../providers/config.js';
import { isBusyPhase } from '../../../useRun.js';
import { otherRecordsSummary, previewStyle } from '../../../runLogic.js';
import AnswerCard from './AnswerCard.jsx';
import { RunError, RunProgress, useTick } from './RunStatus.jsx';

/**
 * The answer area at the top of the Ticket screen's AI Assist half (AI0.4). Where the person looks:
 *
 *   the run going on for this ticket (reading, waiting for the AI with the seconds and the try, Stop waiting), or its error with the
 *   next step; the check of what will be sent (full, or the short one for look-alike tickets after the first time); then this
 *   ticket's answers, newest first: the newest open, the earlier ones folded to one line. While a new run is going on they are all
 *   folded (one click opens one), so the new answer is the one that opens. Last, one line per other ticket with something waiting.
 *
 * Focus: a new answer takes the focus (its title) when this half is on show; a run that ends without one (Stop waiting, Cancel in
 * the check) and a closed answer give the focus back to the control that started it (or the next answer).
 *
 * props: assist (useAnswers), page, eff, record, active (the Ticket screen and this half are on show)
 */
export default function AnswerArea({ assist, page, eff, record, active = true }) {
  const { key, answers, phase } = assist;
  const root = useRef(null);
  const top = answers[0]?.id || '';
  // Answers the person opened or folded by hand; forgotten when a new answer arrives (the newest opens) or another ticket is shown.
  const [manual, setManual] = useState({ at: '', ids: {} });
  const at = `${key}|${top}`;
  const ids = manual.at === at ? manual.ids : {};
  const busy = isBusyPhase(phase);
  const now = useTick(answers.length > 0, 30000);

  // The newest answer takes the focus when it arrives; a run that ended with nothing gives it back.
  const prev = useRef({ key, phase, top });
  useEffect(() => {
    const before = prev.current;
    prev.current = { key, phase, top };
    if (before.key !== key) return;
    if (top && top !== before.top) {
      if (active) focusAnswer(root.current, top);
      return;
    }
    if (isBusyPhase(before.phase) && phase === 'idle') giveBack(assist.opener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase, top]);

  // On show: this ticket's answers count as seen (the line on other tickets stops saying "ready").
  useEffect(() => {
    if (active) assist.seen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, answers.length]);

  const prepared = phase === 'preview' ? assist.prepared : null;
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  const others = prepared ? otherRecordsSummary(prepared.p) : '';
  const style = prepared ? previewStyle({ previewMode: eff.values.previewMode, feature: prepared.p.feature, pack: prepared.p.pack, seen: eff.values.previewSeen || [], others }) : 'full';

  const close = (answer) => {
    const at2 = answers.findIndex((a) => a.id === answer.id);
    const next = answers[at2 + 1] || answers[at2 - 1] || null;
    assist.closeAnswer(answer);
    // The focus goes to the next answer, or back to the action that made this one.
    if (next) setTimeout(() => focusAnswer(root.current, next.id), 0);
    else setTimeout(() => giveBack({ id: answer.meta?.base?.id || answer.feature?.id || '' }), 0);
  };

  if (!answers.length && phase === 'idle' && !assist.elsewhere.length) return null;

  return (
    <div className="ab-answers" ref={root} aria-label="Answers" role="region">
      <RunProgress run={assist} onStop={assist.reset} />
      {phase === 'error' && <RunError error={assist.error} code={assist.errorCode} onRetry={assist.again} onDismiss={assist.reset} />}
      {prepared && (
        <PreviewDialog
          feature={prepared.p.feature}
          prepared={prepared.p}
          config={prepared.cfg || config}
          canSkipNext={eff.values.previewMode === 'first'}
          short={style === 'short'}
          others={others}
          onSend={assist.confirmPreview}
          onCancel={assist.cancelPreview}
          onMask={assist.maskMore}
        />
      )}
      {answers.map((a, i) => (
        <AnswerCard
          key={a.id}
          answer={a}
          open={ids[a.id] ?? (i === 0 && !busy)}
          onToggle={(open) => setManual({ at, ids: { ...ids, [a.id]: open } })}
          page={page}
          eff={eff}
          record={record}
          busy={busy}
          now={now}
          onRefine={assist.refine}
          onAgain={assist.retryAnswer}
          onClose={close}
        />
      ))}
      {assist.elsewhere.length > 0 && (
        <ul className="ab-answers-elsewhere" aria-label="Other tickets">
          {assist.elsewhere.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Put the focus on an answer's title (open) or its folded line. */
function focusAnswer(box, id) {
  const el = box?.querySelector(`[data-answer="${id}"] .ab-answer-toggle, [data-answer="${id}"] .ab-answer-fold`);
  el?.focus();
}

/**
 * The focus back to the control that started a run: the element itself while it is still on the page and enabled, else the action
 * by its feature id (a list button or a quick-bar button; it may have been drawn again meanwhile).
 */
function giveBack(opener) {
  if (typeof document === 'undefined' || !opener) return;
  const el = opener.element;
  if (el && el.isConnected && !el.disabled && typeof el.focus === 'function') {
    el.focus();
    if (document.activeElement === el) return;
  }
  if (!opener.id) return;
  const usable = (selector) => [...document.querySelectorAll(selector)].find((b) => !b.disabled) || null;
  const found = usable(`[data-feature="${opener.id}"]`) || usable(`[data-quick="${opener.id}"]`);
  found?.focus();
}
