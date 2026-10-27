import React, { useSyncExternalStore } from 'react';
import { useRun } from '../useRun.js';
import { buildInsightsPack, checkInsightsNote, describeInputs, INSIGHT_MAX_WORDS } from '../../reports/ai/insights.js';
import { AiBlocked, AiResult, AiShell, RunProgress, aiNotReadyText, featureState, isAiReady } from './aiShared.jsx';
import { andList, readLabel } from './format.js';

const FEATURE_ID = 'dashboard-insights';
const NONE = [];
const noopSubscribe = () => () => {};
const getNone = () => NONE;

/** The answer's own checks, as short sentences. */
export function insightChecks(text) {
  const c = checkInsightsNote(text);
  const out = [];
  if (c.tooLong) out.push(`The answer is ${c.words} words; the aim was ${INSIGHT_MAX_WORDS}.`);
  if (c.missing.length) out.push(`The AI left out: ${c.missing.join(' ')}`);
  return out;
}

/** What the explanation will be based on, in words. `entries` are the dashboard's loaded results. */
export function InsightsInputs({ entries }) {
  const inputs = describeInputs(entries);
  if (!inputs.used.length) {
    return <p className="ab-note">There are no numbers to explain yet. Add the Overview, Workload, SLA, Quality or Request fulfilment sections to this dashboard (Customize), and wait for them to load.</p>;
  }
  return (
    <>
      <p className="ab-note ab-note-ok">
        Based on what is on this dashboard now: {andList(inputs.used)}
        {inputs.readAt ? `, read at ${readLabel(inputs.readAt)}` : ''}.
      </p>
      {inputs.missing.length > 0 && <p className="ab-hint">Not on this dashboard, so they are not part of the explanation: {andList(inputs.missing)}.</p>}
    </>
  );
}

// "Explain this dashboard": the numbers the lead is looking at, explained. It reads nothing from ServiceNow itself: it takes the
// results the other sections of this dashboard have already loaded (env.loaded), so what is explained is what is on screen.
export default function InsightsView({ env, eff }) {
  const entries = useSyncExternalStore(env.loaded ? env.loaded.subscribe : noopSubscribe, env.loaded ? env.loaded.snapshot : getNone, getNone);
  const run = useRun({ page: env.page, eff, record: null });
  const { feature, available } = featureState(FEATURE_ID, eff.policy);
  const aiReady = isAiReady(eff);
  const blockedFields = eff.policy?.blockedFields || [];
  const hasInputs = describeInputs(entries).used.length > 0;
  const shown = run.phase === 'done' && run.active?.id === FEATURE_ID;

  function go() {
    if (!feature || !available) return;
    run.run(feature, {
      getPack: async () => {
        const pack = buildInsightsPack(entries, { blockedFields });
        if (!pack) throw new Error('There are no numbers on this dashboard to explain yet.');
        return pack;
      },
    });
  }

  return (
    <AiShell title="Explain this dashboard" help="What stands out in the numbers above, likely reasons (as hypotheses) and three suggested actions.">
      {!available ? (
        <AiBlocked>Your organisation has turned this off.</AiBlocked>
      ) : (
        <>
          <InsightsInputs entries={entries} />
          <p className="ab-hint">
            Sends counts, trends, group names, ticket numbers and the names of assignees (masked). No ticket titles, descriptions or notes are sent. The preview shows exactly what will be sent.
          </p>
          {!aiReady && <p className="ab-note ab-note-warn">{aiNotReadyText(eff)}</p>}
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm ab-btn-primary" disabled={!aiReady || !hasInputs || run.busy} onClick={go}>
              Explain these numbers
            </button>
          </div>
        </>
      )}
      <RunProgress run={run} eff={eff} page={env.page} readingText="Getting the numbers ready…" />
      <AiResult run={run} eff={eff} featureId={FEATURE_ID} heading="What the numbers say" notice={shown ? insightChecks(run.result) : []} />
    </AiShell>
  );
}
