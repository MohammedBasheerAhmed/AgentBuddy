// What Settings > Side rail shows and saves, worked out without a record (pure: no chrome.*, no React). The section itself is
// basics/RailSection.jsx. The rail has nothing left to arrange (2026-11-05, docs/focus-layout.md: it lists the five of each screen,
// then All tools), so what is worked out here is the small bar on the ServiceNow page: which AI actions it holds per kind of record.
//
//   railKinds(eff)              the kinds of record the bar's actions are chosen for (HR cases only for someone with the HR profile)
//   railHasAssist(eff)          is there anything AI to choose at all (not when the organisation switched AI off)
//   pagePicks(kind, eff, pins)  the AI actions the small bar on the ServiceNow page can hold for a kind, and the ones it holds now
//   togglePagePick(...)         a new quickPins after one pill is pressed
import { featuresFor } from '../features/registry.js';
import { MAX_QUICK, QUICK_LABELS, cleanPins, isQuickId, quickActions, quickDefaults } from '../features/quick.js';
import { activeProfiles, aiOffByPolicy } from '../profiles/profiles.js';
import { featureIcon } from '../sidepanel/ui/featureIcons.js';
import { t } from '../i18n/index.js';

export { MAX_QUICK };

// The kinds of record Settings offers: `label` names the tab, `many` goes into a sentence ("Its actions for incidents").
const kind = (id, label, many) => Object.freeze({
  id,
  get label() {
    return label();
  },
  get many() {
    return many();
  },
});
export const RAIL_KINDS = Object.freeze([
  kind('incident', () => t('Incident'), () => t('incidents')),
  kind('requested_item', () => t('Requested item'), () => t('requested items')),
  kind('catalog_task', () => t('Catalog task'), () => t('catalog tasks')),
  kind('change', () => t('Change'), () => t('changes')),
  kind('problem', () => t('Problem'), () => t('problems')),
  kind('case', () => t('Case'), () => t('cases')),
  kind('hr_case', () => t('HR case'), () => t('HR cases')),
]);

/** The kinds this person can choose for: all of them, HR cases only with the HR profile (which the organisation has to approve). */
export const railKinds = (eff) => RAIL_KINDS.filter((k) => k.id !== 'hr_case' || activeProfiles(eff).includes('hr'));

/** Is there an AI action to choose at all? Not when the organisation switched AI off. ("Skip AI for now" still lets them choose.) */
export const railHasAssist = (eff) => !aiOffByPolicy(eff);

/** The kind's suggestions first (what the bar shows until the person chooses: quick.js quickDefaults), then the rest as given. */
function suggestedFirst(ids, kindId) {
  const first = quickDefaults(kindId, null).filter((id) => ids.includes(id));
  return [...first, ...ids.filter((id) => !first.includes(id))];
}

/**
 * The small bar on the ServiceNow page for one kind: the AI actions it can hold (those with a short label, minus what the organisation
 * switched off; the kind's suggestions first) and the ones it holds now: the person's own choice, or the bar's suggestions until they
 * choose (src/features/quick.js quickActions, the very function the bar uses). Not filtered by work profile: the bar is not either.
 * @returns {{ items: { id, label, icon }[], chosen: string[], own: boolean }}
 */
export function pagePicks(kindId, eff, pins) {
  if (!railHasAssist(eff)) return { items: [], chosen: [], own: false };
  const policy = eff?.policy || {};
  const ids = suggestedFirst(featuresFor(kindId, policy).map((f) => f.id).filter(isQuickId), kindId);
  const chosen = quickActions({ kind: kindId, pins, policy }).map((a) => a.id);
  const own = cleanPins(pins, kindId).some((id) => chosen.includes(id));
  const all = [...ids, ...chosen.filter((id) => !ids.includes(id))];
  return { items: all.map((id) => ({ id, label: QUICK_LABELS[id], icon: featureIcon(id) })), chosen, own };
}

/**
 * quickPins after one pill is pressed: the chosen list with that action added (while there is room) or taken out. Turning the last
 * one off removes the kind's choice, so the bar goes back to its suggestions (it is never empty; the switch above hides it).
 * The other kinds' choices are kept as they are.
 */
export function togglePagePick(pins, kindId, chosen, id) {
  const on = chosen.includes(id);
  if (!on && chosen.length >= MAX_QUICK) return pins;
  const list = on ? chosen.filter((x) => x !== id) : [...chosen, id];
  const next = { ...(pins && typeof pins === 'object' && !Array.isArray(pins) ? pins : {}) };
  if (list.length) next[kindId] = list;
  else delete next[kindId];
  return next;
}
