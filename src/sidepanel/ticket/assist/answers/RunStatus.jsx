import { useEffect, useState } from 'react';
import { errorNextSteps, waitingText } from '../../../runLogic.js';
import { AiBadge } from '../../../ui/primitives.jsx';
import { t } from '../../../../i18n/index.js';

/**
 * A clock that ticks while `on`: the time now, re-read every `ms`. Off, it does nothing (no timer left running).
 */
export function useTick(on, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    id?.unref?.(); // (Node, in the tests: a clock alone does not keep the process running; a browser's timer id is a number)
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

/**
 * What a run is doing while the person waits, with the way out: "Reading the ticket…" or "Waiting for the AI · 12 s", and the try
 * when the provider was busy and Agent Buddy tries again. "Stop waiting" drops the run (an answer that arrives later is not shown).
 * A calm line on a soft surface, with the grey AI spark while the AI is being asked.
 *
 * props: run ({ phase, since, attempt, attempts }), onStop, readingText
 */
export function RunProgress({ run, onStop, readingText = t('Reading the ticket as you…') }) {
  const waiting = run.phase === 'sending';
  const now = useTick(run.phase === 'reading' || waiting);
  if (run.phase !== 'reading' && !waiting) return null;
  const text = waiting ? waitingText({ since: run.since, now, attempt: run.attempt || 1, attempts: run.attempts || 3 }) : readingText;
  return (
    <div className="ab-note ab-runstatus" role="status">
      {waiting && <AiBadge label="" title="" />}
      <span className="ab-runstatus-text">{text}</span>
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onStop}>{t('Stop waiting')}</button>
    </div>
  );
}

/**
 * A run that failed, in plain words, with the next step that can fix it: "Try again" (when it may work a second time) and "Open
 * Settings" (a key, an address, a model, the privacy mode). `onDismiss` puts the error away.
 *
 * props: error (text), code (the error's code), onRetry, onDismiss
 */
export function RunError({ error, code = '', onRetry, onDismiss }) {
  if (!error) return null;
  const steps = errorNextSteps(code);
  return (
    <div className="ab-note ab-note-danger ab-errnote ab-runerror" role="alert">
      <p className="ab-errnote-text">{error}</p>
      <div className="ab-row">
        {steps.retry && onRetry && (
          <button type="button" className="ab-btn ab-btn-sm" onClick={onRetry}>{t('Try again')}</button>
        )}
        {steps.settings && (
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => chrome.runtime.openOptionsPage()}>{t('Open Settings')}</button>
        )}
        {onDismiss && (
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onDismiss}>{t('Dismiss')}</button>
        )}
      </div>
    </div>
  );
}
