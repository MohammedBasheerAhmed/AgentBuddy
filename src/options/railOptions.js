// What Settings > Side rail shows and saves, worked out without a record (pure: no chrome.*, no React). The section itself is
// basics/RailSection.jsx.
//
//   railKinds(eff)              the kinds of record that can be arranged (HR cases only for someone with the HR profile)
//   railRows(kind, half, eff, layout)
//                               one kind's list for one half, as the rail draws it: what the kind offers in the suggested order, the
//                               person's order first, each item with its hidden flag (src/features/railLayout.js arrangeRail)
//   toggleRailItem / moveRailItem / resetRail
//                               a new railLayout after one change (setRailPrefs; the stored layout is never changed in place)
//   pagePicks(kind, eff, pins)  the AI actions the small bar on the ServiceNow page can hold for a kind, and the ones it holds now
//   togglePagePick(...)         a new quickPins after one pill is pressed
//
// What a kind offers: on the Insights side its cards (src/features/railCatalog.js: the kind, the person's work profiles); on the AI
// Assist side its AI actions (featuresFor: the kind, minus what the organisation switched off; then the person's profiles, as AI Assist
// itself filters them) in assistDefaultOrder. An open record can offer less (a card that does not apply to it, an action its state
// rules out): the rail then simply leaves those out.
import { featuresFor } from '../features/registry.js';
import { MAX_QUICK, QUICK_LABELS, cleanPins, isQuickId, quickActions } from '../features/quick.js';
import { arrangeRail, assistDefaultOrder, railPrefsFor, setRailPrefs } from '../features/railLayout.js';
import { railCardsFor } from '../features/railCatalog.js';
import { activeProfiles, aiOffByPolicy, profilesOfFeature, shownFor } from '../profiles/profiles.js';
import { cardIcon, featureIcon } from '../sidepanel/ui/featureIcons.js';
import { t } from '../i18n/index.js';

export { MAX_QUICK };

// The kinds of record Settings lets a person arrange: `label` names the tab, `many` goes into a sentence ("Insights for incidents").
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

/** The kinds this person can arrange: all of them, HR cases only with the HR profile (which the organisation has to approve). */
export const railKinds = (eff) => RAIL_KINDS.filter((k) => k.id !== 'hr_case' || activeProfiles(eff).includes('hr'));

/** Does this person have an AI Assist half at all? Not when the organisation switched AI off. ("Skip AI for now" still lets them arrange it.) */
export const railHasAssist = (eff) => !aiOffByPolicy(eff);

/** The name of an AI action in the rail and here: its short label (src/features/quick.js) when it has one, else its own title. */
export const actionLabel = (feature) => (isQuickId(feature?.id) ? QUICK_LABELS[feature.id] : feature?.title) || String(feature?.id || '');

/**
 * What one half of a kind offers, in the suggested order (before the person's arrangement).
 * @returns {{ id: string, label: string, icon: string }[]}
 */
export function railOffer(kindId, half, eff) {
  if (half === 'assist') {
    if (!railHasAssist(eff)) return [];
    const offered = featuresFor(kindId, eff?.policy || {}).filter((f) => shownFor(profilesOfFeature(f), eff));
    const byId = new Map(offered.map((f) => [f.id, f]));
    const ids = assistDefaultOrder([...byId.keys()], { kind: kindId, stage: null, byState: eff?.values?.railByState !== false });
    return ids.map((id) => ({ id, label: actionLabel(byId.get(id)), icon: featureIcon(id) }));
  }
  return railCardsFor(kindId, eff).map((c) => ({ id: c.id, label: c.title, icon: cardIcon(c.id) }));
}

/**
 * One kind's list for one half as the rail draws it, with the hidden ones in their place (Settings shows them, switched off).
 * @returns {{ rows: { id, label, icon, hidden: boolean }[], shown: number, arranged: boolean }}
 *   arranged: the person changed something for this kind and half (an order or a hidden item), so "Reset" has something to undo
 */
export function railRows(kindId, half, eff, layout) {
  const offer = railOffer(kindId, half, eff);
  const byId = new Map(offer.map((o) => [o.id, o]));
  const prefs = railPrefsFor(layout, kindId, half);
  const { all } = arrangeRail(offer.map((o) => o.id), prefs);
  const rows = all.map((x) => ({ ...byId.get(x.id), hidden: x.hidden }));
  return { rows, shown: rows.filter((r) => !r.hidden).length, arranged: prefs.arranged };
}

/** Show or hide one item. The order is left as it was: hiding an item does not fix the order of the others. */
export function toggleRailItem(layout, kindId, half, id) {
  const prefs = railPrefsFor(layout, kindId, half);
  const hidden = prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id];
  return setRailPrefs(layout, kindId, half, { order: prefs.order, hidden });
}

/**
 * Move one item a place up (step -1) or down (+1) in the list as shown (`ids`, every item in its current place). The whole list is
 * saved as the order from then on; ids the saved order had that this list does not show (an action of another work profile) stay
 * after it, so they keep their place among themselves.
 */
export function moveRailItem(layout, kindId, half, ids, id, step) {
  const at = ids.indexOf(id);
  const to = at + step;
  const prefs = railPrefsFor(layout, kindId, half);
  if (at < 0 || to < 0 || to >= ids.length) return setRailPrefs(layout, kindId, half, prefs);
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return setRailPrefs(layout, kindId, half, { order: [...next, ...prefs.order.filter((x) => !next.includes(x))], hidden: prefs.hidden });
}

/** Back to the suggested order, everything shown, for one kind and half. */
export const resetRail = (layout, kindId, half) => setRailPrefs(layout, kindId, half, null);

/**
 * The small bar on the ServiceNow page for one kind: the AI actions it can hold (those with a short label, minus what the organisation
 * switched off; the kind's suggestions first) and the ones it holds now: the person's own choice, or the bar's suggestions until they
 * choose (src/features/quick.js quickActions, the very function the bar uses). Not filtered by work profile: the bar is not either.
 * @returns {{ items: { id, label, icon }[], chosen: string[], own: boolean }}
 */
export function pagePicks(kindId, eff, pins) {
  if (!railHasAssist(eff)) return { items: [], chosen: [], own: false };
  const policy = eff?.policy || {};
  const ids = assistDefaultOrder(featuresFor(kindId, policy).map((f) => f.id).filter(isQuickId), { kind: kindId, stage: null, byState: true });
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
