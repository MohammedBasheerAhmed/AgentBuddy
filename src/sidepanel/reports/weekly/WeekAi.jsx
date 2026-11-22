import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun } from '../../useRun.js';
import { SafeText } from '../../../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../../../render/safeText.js';
import { splitPreview } from '../../runLogic.js';
import { parseSent } from '../../previewView.js';
import { AiBadge } from '../../ui/primitives.jsx';
import { aiNeedsText, isAiReady } from '../../aiReady.js';
import { AiButton, RunProgress, featureState } from '../aiShared.jsx';
import { t } from '../../../i18n/index.js';

const sectionText = (x) => (x.kind === 'block' ? `${x.label}\n${x.text}` : x.text);

/**
 * The one AI line of a weekly view ("The week in short", "One thing to try"). A normal Agent Buddy AI action: `useRun` runs the firewall,
 * the preview the person must read first, the provider and the audit. It is written from COUNTS and TICKET NUMBERS only (src/reports/weekly/ai.js
 * says what the pack holds), and the view says so, and "What was sent" shows the exact text that left, as it was in the preview.
 * The numbers around it never wait for it: with the AI off, switched off by the organisation or with no key, the view shows everything
 * but this line, and one plain sentence says why.
 *
 * props: featureId, page, eff, result (the weekly result this line is about), buildPack(result), heading, runLabel, onText(text)
 *   (the plain text of the answer, or '' while there is none: the PDF and the copied text carry it)
 */
export default function WeekAi({ featureId, page, eff, result, buildPack, heading, runLabel, onText }) {
  const run = useRun({ page, eff, record: null });
  const { feature, available } = featureState(featureId, eff.policy);
  const pack = useMemo(() => (result ? buildPack(result, { blockedFields: eff.policy?.blockedFields || [] }) : null), [result, buildPack, eff.policy]);
  const ready = isAiReady(eff);
  const skipped = eff.values?.aiSkipped === true;
  // The request the person was shown in the preview (kept in memory while this line is on screen): "What was sent".
  const sentRef = useRef(null);
  const [showSent, setShowSent] = useState(false);

  // (the preview is the moment the exact request is known; it is the one that is sent)
  const previewed = run.phase === 'preview' ? run.prepared?.p || null : null;
  useEffect(() => {
    if (previewed) sentRef.current = previewed;
  }, [previewed]);
  const answered = run.phase === 'done' && run.active?.id === featureId && typeof run.result === 'string' && run.result.trim() !== '';
  const text = useMemo(() => (answered ? toPlainText(parseSafeText(run.result)).trim() : ''), [answered, run.result]);

  useEffect(() => {
    onText?.(text);
  }, [text, onText]);

  // New numbers (another week, a refresh): the line was written from the old ones, so it goes.
  const reset = run.reset;
  useEffect(() => {
    reset();
    sentRef.current = null;
    setShowSent(false);
  }, [result, reset]);

  const sent = sentRef.current ? splitPreview(sentRef.current) : null;
  // (what was sent, as a person reads it: each block under its label, then the task; the rules that go with every request are in the preview)
  const sentText = sent ? (sent.ok ? parseSent(sent.data).sections.map(sectionText).join('\n\n') : sent.exact) : '';

  // Why there is no line, in one plain sentence (the numbers do not need it).
  let why = '';
  if (!available) why = t('The written line is switched off by your organisation. The numbers do not need it.');
  else if (skipped) why = t('AI is switched off, so there is no written line. The numbers do not need it.');
  else if (!ready) why = aiNeedsText(eff, 'this');
  else if (!pack) why = t('There are not enough numbers to write a line from.');

  const canWrite = available && !skipped && ready && Boolean(pack);

  return (
    <section className="ab-weekly-ai" aria-label={heading}>
      <h2 className="ab-weekly-ai-h">
        <AiBadge label="" title="" />
        <span>{heading}</span>
      </h2>
      {text && (
        <div className="ab-weekly-ai-text">
          <SafeText text={run.result} />
        </div>
      )}
      {!text && why && <p className="ab-weekly-ai-why">{why}</p>}
      {!text && canWrite && (
        <div className="ab-row">
          <AiButton eff={eff} disabled={run.busy} onClick={() => feature && run.run(feature, { getPack: async () => pack })}>
            {runLabel}
          </AiButton>
        </div>
      )}
      <RunProgress run={run} eff={eff} page={page} readingText={t('Getting the numbers ready…')} />
      {(canWrite || text) && (
        <p className="ab-weekly-ai-note">
          <span>{t('Written from counts and ticket numbers. No names, no ticket text.')}</span>
          {text && sentText && (
            <>
              {' '}
              <button type="button" className="ab-weekly-linkbtn" aria-expanded={showSent} onClick={() => setShowSent(!showSent)}>
                {t('What was sent')}
              </button>
            </>
          )}
        </p>
      )}
      {text && showSent && sentText && (
        <pre className="ab-weekly-sent" tabIndex={0} aria-label={t('What was sent')}>
          {sentText}
        </pre>
      )}
      {text && (
        <div className="ab-row">
          <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" disabled={run.busy} onClick={() => run.again()}>
            {t('Write it again')}
          </button>
        </div>
      )}
      {text && <p className="ab-hint">{t('AI can be wrong. Check the text before you use it.')}</p>}
    </section>
  );
}
