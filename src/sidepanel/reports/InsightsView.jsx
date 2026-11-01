import React, { useSyncExternalStore } from 'react';
import { useRun } from '../useRun.js';
import { buildInsightsPack, checkInsightsNote, describeInputs, INSIGHT_MAX_WORDS } from '../../reports/ai/insights.js';
import { AiBlocked, AiButton, AiResult, AiShell, RunProgress, AiKeyLine, featureState, isAiReady } from './aiShared.jsx';
import { andList, readLabel } from './format.js';
import { t } from '../../i18n/index.js';
import { shown as shownText } from '../../reports/shown.js';

const FEATURE_ID = 'dashboard-insights';
const NONE = [];
const noopSubscribe = () => () => {};
const getNone = () => NONE;

/** The answer's own checks, as short sentences. */
export function insightChecks(text) {
  const c = checkInsightsNote(text);
  const out = [];
  if (c.tooLong) out.push(t('The answer is {words} words; the aim was {max}.', { words: c.words, max: INSIGHT_MAX_WORDS }));
  if (c.missing.length) out.push(t('The AI left out: {missing}', { missing: c.missing.join(' ') }));
  return out;
}

/** What the explanation will be based on, in words. `entries` are the dashboard's loaded results. */
export function InsightsInputs({ entries }) {
  const inputs = describeInputs(entries);
  if (!inputs.used.length) {
    return <p className="ab-note">{t('There are no numbers to explain yet. They come from the dashboard under Insights: wait for it to load, or add Overview, Workload, SLA, Quality or Request fulfilment to it (Customize).')}</p>;
  }
  return (
    <>
      <p className="ab-note ab-note-ok">
        {inputs.readAt
          ? t('Based on what is on this dashboard now: {list}, read at {time}.', { list: andList(inputs.used.map(shownText)), time: readLabel(inputs.readAt) })
          : t('Based on what is on this dashboard now: {list}.', { list: andList(inputs.used.map(shownText)) })}
      </p>
      {inputs.missing.length > 0 && <p className="ab-hint">{t('Not on this dashboard, so they are not part of the explanation: {list}.', { list: andList(inputs.missing.map(shownText)) })}</p>}
    </>
  );
}

/**
 * AI29, "Explain this dashboard": the numbers the lead is looking at, explained. It reads nothing from ServiceNow itself: it takes
 * the results the dashboard's sections have already loaded (`entries`, memory only), so what is explained is what is on screen.
 * Drawn in the Team screen's AI Assist half (TeamAssist). `primary` makes its button the screen's one filled button.
 */
export function ExplainBody({ entries, page, eff, primary = false }) {
  const run = useRun({ page, eff, record: null });
  const { feature, available } = featureState(FEATURE_ID, eff.policy);
  const aiReady = isAiReady(eff);
  const blockedFields = eff.policy?.blockedFields || [];
  const sensitivePrefixes = eff.policy?.sensitiveTablePrefixes || [];
  const hasInputs = describeInputs(entries).used.length > 0;
  const shown = run.phase === 'done' && run.active?.id === FEATURE_ID;

  function go() {
    if (!feature || !available) return;
    run.run(feature, {
      getPack: async () => {
        const pack = buildInsightsPack(entries, { blockedFields, sensitivePrefixes });
        if (!pack) throw new Error(t('There are no numbers on this dashboard to explain yet.'));
        return pack;
      },
    });
  }

  return (
    <>
      {!available ? (
        <AiBlocked>{t('Your organisation has turned this off.')}</AiBlocked>
      ) : (
        <>
          <InsightsInputs entries={entries} />
          <p className="ab-hint">{t('Sends counts, trends, group names, ticket numbers and assignees (masked); no titles, descriptions or notes. The preview shows exactly what will be sent.')}</p>
          {!aiReady && <AiKeyLine eff={eff} />}
          <div className="ab-row">
            <AiButton eff={eff} primary={primary} disabled={!aiReady || !hasInputs || run.busy} onClick={go}>
              {t('Explain these numbers')}
            </AiButton>
          </div>
        </>
      )}
      <RunProgress run={run} eff={eff} page={page} readingText={t('Getting the numbers ready…')} />
      <AiResult run={run} eff={eff} featureId={FEATURE_ID} heading={t('What the numbers say')} notice={shown ? insightChecks(run.result) : []} />
    </>
  );
}

// The same, as a dashboard widget (a saved dashboard of an earlier version may hold one). The Insights half does not draw AI
// widgets any more (TRACKER.md 2.3: no AI element on Insights); this stays for the registry and the full-page dashboard's tests.
export default function InsightsView({ env, eff }) {
  const entries = useSyncExternalStore(env.loaded ? env.loaded.subscribe : noopSubscribe, env.loaded ? env.loaded.snapshot : getNone, getNone);
  return (
    <AiShell title={t('Explain this dashboard')} help={t('What stands out in the numbers, likely reasons (as hypotheses) and three suggested actions.')}>
      <ExplainBody entries={entries} page={env.page} eff={eff} />
    </AiShell>
  );
}
