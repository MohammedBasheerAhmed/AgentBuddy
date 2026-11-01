// What the AI Assist half of the Ticket screen offers, and why an action cannot run, worked out BEFORE anything is clicked. Pure: the
// views pass in the record, the header, the effective settings and (for tests) the feature list.
//
//   offeredFeatures()   the actions this record offers: its kind, the organisation's policy, the person's work profiles and the
//                       state rules (`when`). An action outside these is not shown at all.
//   recordBlock()       a reason that stops EVERY AI action on this record (a blocked table, HR content not allowed). Said once,
//                       above the actions, never on each button.
//   featureBlock()      a reason that stops ONE action (it needs Strict privacy mode). Said on that button, which is disabled.
//   actionPlan()        the 3 suggested for the ticket's stage (the first is the one primary button) and the rest by group.
//
// The checks mirror the ones src/lib/pipeline.js assertRunnable makes when the action runs (same rules, same words), so a button that
// is enabled here does not fail on the first step for a reason that was known all along. The pipeline still decides: nothing here
// lets anything through that it would refuse.
import { FEATURES, isFeatureAvailable } from '../../../../features/registry.js';
import { profilesOfFeature, shownFor } from '../../../../profiles/profiles.js';
import { GROUPS, STAGE_WORDS, SUGGEST, cautionFor, groupOf, stageOf, whenAllows } from '../../../../features/stages.js';
import { isFeatureEnabled, isSensitiveByPolicy, isTableAllowed } from '../../../../policy/policy.js';
import { resolveProviderConfig } from '../../../../providers/config.js';
import { requiredMode } from '../../../../lib/pipeline.js';
import { isolate, t } from '../../../../i18n/index.js';

/** How many actions show as the main choices before "More actions". */
export const MAX_SUGGESTED = 3;

const MODE_RANK = { standard: 0, strict: 1, 'local-only': 2 };
const modeLabel = (mode) => ({ strict: t('Strict'), 'local-only': t('Local-only') })[mode] || mode;

// What the pipeline would know about this record before reading it: its table, and whether it is already known to be sensitive.
const packLike = (record) => ({ table: String(record?.table || '').trim(), ...(record?.sensitive === true ? { sensitive: true } : {}) });
const below = (eff, mode) => Boolean(mode) && (MODE_RANK[eff?.values?.piiMode] ?? 0) < (MODE_RANK[mode] ?? 0);

/**
 * Why no AI action can run on this record, or ''. The same rules as the pipeline: a table the organisation blocked; HR content
 * (sn_hr_ tables and the policy's sensitive prefixes) unless the organisation allows it AND has pinned where it may go (or the
 * model runs on this computer); and HR records only in Strict privacy mode or stricter (TRACKER.md AI0.2).
 * @param {{ record: object, eff: object }} input
 */
export function recordBlock({ record, eff }) {
  const table = String(record?.table || '').trim();
  const policy = eff?.policy || {};
  if (!table) return '';
  if (!isTableAllowed(table, policy)) return t('Your organisation does not allow Agent Buddy to use {table} records with AI. Insights still works.', { table: isolate(table) });
  if (record?.sensitive === true || isSensitiveByPolicy(table, policy)) {
    if (!policy.allowHrContent) return t('HR case content is not sent to an AI unless your organisation allows it. Insights still works.');
    let local = false;
    try {
      local = Boolean(resolveProviderConfig(eff?.values || {}, eff?.apiKey || '').local);
    } catch {
      local = false;
    }
    if (!(policy.aiProvider || policy.aiBaseUrl || local)) return t('HR case content can only go to an AI your organisation has approved. Ask your administrator.');
  }
  // Every function on an HR record needs Strict (or Local-only): the pipeline's own rule (requiredMode), said once for the record.
  const recordNeeds = requiredMode({}, packLike(record), policy);
  if (below(eff, recordNeeds)) return t('HR records need {mode} privacy mode (or stricter). Change it in Settings.', { mode: modeLabel(recordNeeds) });
  return '';
}

/**
 * Why this one action cannot run, or '' (shown on its button, which is disabled). The privacy mode it needs is the pipeline's
 * requiredMode (its own `requires.minMode`, and Strict for anything on an HR record); a need the whole record has is said once by
 * recordBlock instead, so it is not repeated on every button.
 */
export function featureBlock(feature, eff, record = null) {
  const policy = eff?.policy || {};
  if (!isFeatureEnabled(feature?.id, policy) || !isFeatureAvailable(feature, policy)) return t('Switched off by your organisation.');
  const pack = packLike(record);
  const needed = requiredMode(feature, pack, policy);
  if (below(eff, needed) && needed !== requiredMode({}, pack, policy)) return t('Needs {mode} privacy mode. Change it in Settings.', { mode: modeLabel(needed) });
  return '';
}

/**
 * The actions this record offers, in registry order.
 * @param {{ record: object, header?: object|null, eff: object, features?: object[], gates?: Record<string, boolean|null> }} input
 *   gates: per feature id, a check made elsewhere (the checklist is offered only when the instructions have no steps): only `true`
 *   lets that feature through; a feature with no gate is not affected.
 */
export function offeredFeatures({ record, header = null, eff, features = FEATURES, gates = {} }) {
  const kind = record?.kind || 'other';
  const policy = eff?.policy || {};
  return features.filter(
    (f) =>
      (f.kinds || []).includes(kind) &&
      isFeatureAvailable(f, policy) &&
      shownFor(profilesOfFeature(f), eff) &&
      whenAllows(f, record, header) &&
      (!Object.prototype.hasOwnProperty.call(gates, f.id) || gates[f.id] === true)
  );
}

/**
 * @returns {{
 *   stage: string|null, words: string, block: string,
 *   suggested: { feature, reason, caution }[],             the main choices; suggested[0] is the primary button
 *   groups: { id, label, items: { feature, reason, caution }[] }[],   the rest, under "More actions", by group (empty groups left out)
 *   more: number, total: number,
 * }}
 */
export function actionPlan({ record, header = null, eff, features = FEATURES, gates = {}, max = MAX_SUGGESTED }) {
  const stage = stageOf(record, header);
  const offered = offeredFeatures({ record, header, eff, features, gates });
  const item = (feature) => ({ feature, reason: featureBlock(feature, eff, record), caution: cautionFor(feature, record) });
  const items = offered.map(item);
  const byId = new Map(items.map((i) => [i.feature.id, i]));

  // The stage's list first, then whatever else the record offers; only actions that can run are suggested (a disabled button is no
  // main choice), and never more than `max`.
  const order = [...(SUGGEST[stage || 'unknown'] || []), ...offered.map((f) => f.id)];
  const suggested = [];
  for (const id of order) {
    const it = byId.get(id);
    if (!it || it.reason || suggested.includes(it)) continue;
    suggested.push(it);
    if (suggested.length >= max) break;
  }
  const rest = items.filter((i) => !suggested.includes(i));
  const groups = GROUPS.map((g) => ({ id: g.id, label: g.label, items: rest.filter((i) => groupOf(i.feature) === g.id) })).filter((g) => g.items.length);
  return {
    stage,
    words: STAGE_WORDS[stage || 'unknown'],
    block: recordBlock({ record, eff }),
    suggested,
    groups,
    more: rest.length,
    total: items.length,
  };
}
