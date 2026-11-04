import { useState } from 'react';
import RunPanel from '../RunPanel.jsx';
import { SafeText } from '../../render/SafeText.jsx';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { resolveProviderConfig } from '../../providers/config.js';
import { logAudit } from '../../lib/storage.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { isAiReady } from '../aiReady.js';
import AiKeyNote from '../AiKeyNote.jsx';
import { AiBadge } from '../ui/primitives.jsx';
import { destinationOf } from '../shell/shellParts.jsx';
import { isolate, t } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';

export { isAiReady };

/** That sentence as the panel's shared note, with the way there ("Open Settings"). Nothing when the AI can be used. */
export function AiKeyLine({ eff }) {
  return <AiKeyNote eff={eff} what="this" />;
}

/**
 * An AI action button: the AI mark, and on hover where the text goes (TRACKER.md 2.3). `primary` makes it the screen's one filled
 * button. Every other prop goes to the <button>.
 */
export function AiButton({ eff, primary = false, className = '', children, ...rest }) {
  const where = destinationOf(eff);
  return (
    <button
      type="button"
      className={`ab-btn ab-btn-sm ${primary ? 'ab-btn-ai' : 'ab-btn-ai-quiet'}${className ? ` ${className}` : ''}`}
      title={where ? t('Sends masked text to {where}. You see it first.', { where: isolate(where) }) : t('Sends masked text to the AI you chose. You see it first.')}
      {...rest}
    >
      <AiBadge label="" title="" />
      {children}
    </button>
  );
}

/** A feature by id, and whether the organisation's policy lets it run. */
export function featureState(id, policy) {
  const feature = featureById(id);
  return { feature, available: Boolean(feature) && isFeatureAvailable(feature, policy) };
}

// The pieces the three AI report sections share. They sit on top of useRun()/RunPanel: the run itself (policy, firewall, preview,
// provider, audit) is exactly the shared pipeline; this file only draws what comes back.

/**
 * RunPanel without its own result card: progress, errors and the preview of exactly what will be sent come from RunPanel, but
 * the result is drawn by <AiResult>, because a team note offers Copy and Print (not Insert) and may need a check in front of it.
 */
export function RunProgress({ run, eff, page, readingText = t('Getting ready…') }) {
  return <RunPanel run={{ ...run, phase: run.phase === 'done' ? 'idle' : run.phase }} eff={eff} page={page} readingText={readingText} />;
}

// What a finding is, in words (a text, not a constant: the language can change while the page is open).
const kindText = (kind) => {
  if (kind === 'ranking') return t('ranks people');
  if (kind === 'person-rating') return t('rates a named person');
  if (kind === 'agent-label') return t('rates a person by a label such as "Agent A"');
  return t('looks like a rating');
};

/**
 * The finished answer, as safe text, with Copy and Print. Shown only when the finished run is for `featureId`.
 *   heading   the card's title
 *   notice    extra notes above the text (the word count, a missing heading...): an array of strings
 *   withhold  { note, findings } holds the text back behind a warning until the person chooses to see it (the coaching snapshot,
 *             when its answer seems to rate individuals)
 */
export function AiResult(props) {
  const { run, featureId } = props;
  if (run.phase !== 'done' || run.result === null || run.active?.id !== featureId) return null;
  // One card per answer: it goes away while the next answer is made, and a new answer is a new card even when no render came in
  // between. "Show the answer anyway" (and the Copy note) belong to the answer they were pressed on; the next answer, which may rate
  // people too, is held back again.
  return <AiAnswer key={run.result} {...props} />;
}

function AiAnswer({ run, eff, featureId, heading, notice = [], withhold = null }) {
  const [note, setNote] = useState('');
  const [shown, setShown] = useState(false);

  const held = Boolean(withhold) && !shown;
  const config = resolveProviderConfig(eff.values, eff.apiKey);

  async function copy() {
    try {
      await navigator.clipboard.writeText(toPlainText(parseSafeText(run.result)));
      setNote(t('Copied to the clipboard.'));
      logAudit({ feature: featureId, table: run.lastPack?.table, sysId: run.lastPack?.sysId, provider: config.provider, model: config.model, mode: eff.values.piiMode, outcome: 'copied' });
    } catch {
      setNote(t('The browser blocked copying. Select the text and copy it by hand.'));
    }
  }

  return (
    <section className="ab-card ab-ai-result" aria-live="polite" aria-label={heading}>
      <h3 className="ab-h ab-ai-result-h">
        <AiBadge />
        <span>{heading}</span>
      </h3>
      {notice.map((n) => (
        <p key={n} className="ab-note ab-note-warn">{n}</p>
      ))}
      {held ? (
        <div className="ab-note ab-note-warn" role="alert">
          <p>{withhold.note}</p>
          {withhold.findings?.length > 0 && (
            <ul className="ab-ai-findings">
              {withhold.findings.map((f) => (
                <li key={`${f.kind}-${f.excerpt}`}>
                  {tx('{kind}: {excerpt}', { kind: kindText(f.kind), excerpt: <span className="ab-mono">{f.excerpt}</span> })}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ab-btn ab-btn-sm" onClick={() => setShown(true)}>{t('Show the answer anyway')}</button>
        </div>
      ) : (
        <div className="ab-output">
          <SafeText text={run.result} />
        </div>
      )}
      {note && <p className="ab-note ab-note-ok" role="status">{note}</p>}
      <div className="ab-row ab-ai-actions">
        {/* Not filled: the one filled button of the screen is the action that wrote this. */}
        {!held && <button type="button" className="ab-btn ab-btn-sm" onClick={copy}>{t('Copy')}</button>}
        {!held && <button type="button" className="ab-btn ab-btn-sm" onClick={() => window.print()}>{t('Print')}</button>}
        {run.again && <button type="button" className="ab-btn ab-btn-sm" onClick={run.again}>{t('Try again')}</button>}
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={run.reset}>{t('Close')}</button>
      </div>
      <p className="ab-hint">{t('AI can be wrong. Check the text before you use it.')}</p>
    </section>
  );
}

/** The card a section without engine data sits in (coaching, explain). */
export function AiShell({ title, help, children }) {
  return (
    <section className="ab-card ab-widget" aria-label={title}>
      <div className="ab-widget-head">
        <h2 className="ab-h">{title}</h2>
      </div>
      {help && <p className="ab-sub ab-widget-help">{help}</p>}
      <div className="ab-widget-body">{children}</div>
    </section>
  );
}

/** The calm line shown where an AI action is not allowed or not ready. */
export function AiBlocked({ children }) {
  return <p className="ab-note" role="status">{children}</p>;
}
