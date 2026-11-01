// What the answer area decides without React (AI0.4, AI23): titles, which button leads, the refine choices and the text pack a
// refinement sends. Pure; tests/assist-answers-refine.test.js and tests/assist-answers-store.test.js.
import { isFeatureAvailable } from '../../../../features/registry.js';
import { primaryOf } from '../../../insertFlow.js';
import { LANGUAGES, buildComposePack, languageName, mergePeople, withLanguage } from '../../../../compose/rewrite.js';
import { withWantedResult } from '../../../../features/packs/assist.js';
import { parseSafeText, toPlainText } from '../../../../render/safeText.js';
import { isolate, t, tm, tn, t as tr } from '../../../../i18n/index.js';

/** "just now", "1 min ago", "12 min ago", "2 h ago". */
export function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - Number(at || 0)) / 1000));
  if (s < 60) return t('just now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('{minutes} min ago', { minutes: m });
  return t('{hours} h ago', { hours: Math.floor(m / 60) });
}

/** The answer's text as plain text (what Copy copies and a refinement rewrites): the safe renderer's own reading of it. */
export const plainOf = (text) => toPlainText(parseSafeText(String(text ?? '')));

/**
 * The feature an answer counts as for Insert, Copy and its title. A refinement ("Shorter") is still a draft reply: it goes where the
 * draft reply went. `meta.base` is the feature of the answer that was refined (kept through refinements of refinements).
 */
export const baseFeatureOf = (answer) => answer?.meta?.base || answer?.feature || null;

/** "Draft a reply to the customer" or, for a refinement, "Draft a reply to the customer · Shorter". */
export function titleOf(answer) {
  if (answer?.meta?.question && !answer.meta.label) return t('Answer to your question');
  const base = baseFeatureOf(answer);
  const title = answer?.meta?.question ? t('Answer to your question') : base?.title ? tr(base.title) : t('Answer');
  return answer?.meta?.label ? `${title} · ${answer.meta.label}` : title;
}

/**
 * Which button leads: 'copy' for a note to self (`feature.primary === 'copy'`: a summary, an answer to a question) or when there is
 * nowhere to insert on this kind of record; otherwise 'insert' (a reply goes into the form). The Actions agent's rule
 * (src/sidepanel/insertFlow.js primaryOf), applied to the feature the answer counts as.
 */
export const answerPrimary = (answer, kind) => primaryOf(baseFeatureOf(answer), kind);

// The refinements offered on an answer (src/features/packs/compose.js rewrite-*, run on the answer's text) and the own-instruction one.
export const REFINE_PRESETS = Object.freeze([
  Object.freeze({ id: 'short', label: tm('Shorter'), featureId: 'rewrite-short' }),
  Object.freeze({ id: 'formal', label: tm('More formal'), featureId: 'rewrite-formal' }),
  Object.freeze({ id: 'friendly', label: tm('Friendlier'), featureId: 'rewrite-friendly' }),
  Object.freeze({ id: 'translate', label: tm('Translate'), featureId: 'rewrite-translate', needsLanguage: true }),
  Object.freeze({ id: 'own', label: tm('Your own instruction'), featureId: 'rewrite-own', needsText: true }),
]);

/**
 * The refinements this person may use: the organisation can switch any of them off by its id (disabledFeatures).
 * @param {(id: string) => object|null} byId featureById (injected so the list can be tested without the whole registry)
 */
export function refineChoices(policy, byId) {
  return REFINE_PRESETS.filter((p) => isFeatureAvailable(byId(p.featureId), policy));
}

/**
 * The feature to run for one refinement, or null when it cannot run (unknown language, no instruction, switched off). The language
 * comes from the fixed list (src/compose/rewrite.js LANGUAGES); the own instruction becomes a part (src/features/packs/assist.js),
 * never prompt text.
 */
export function refineFeature(preset, { language = '', instruction = '' } = {}, byId) {
  const feature = preset ? byId(preset.featureId) : null;
  if (!feature) return null;
  if (preset.needsLanguage) return withLanguage(feature, language);
  if (preset.needsText) return withWantedResult(feature, instruction);
  return feature;
}

/** The label the refined answer carries: "Shorter", "Translated to French", "Your instruction". */
export function refineLabel(preset, { language = '' } = {}) {
  if (!preset) return '';
  if (preset.needsLanguage) {
    const named = languageName(language); // (English, marked with tm() in src/compose/rewrite.js)
    return t('Translated to {language}', { language: named ? tr(named) : t('another language') });
  }
  if (preset.needsText) return t('Your instruction');
  return tr(preset.label);
}

export { LANGUAGES };

/**
 * The names and emails the answer's own firewall masked on the way out, found again in the answer (its scan() also recognises the
 * values it replaced). They join the record's people, so a refinement masks every name the first run masked, also one that was found
 * in prose rather than on the record. At most 30.
 */
export function peopleFromScan(scan, text) {
  if (typeof scan !== 'function') return [];
  let found = [];
  try {
    found = scan(String(text ?? '')) || [];
  } catch {
    return [];
  }
  const out = [];
  for (const f of found) {
    const value = String(f?.value ?? '').trim();
    if (!value || value.length > 80) continue;
    if (f.kind === 'PERSON') out.push({ role: 'named', name: value });
    else if (f.kind === 'EMAIL') out.push({ role: 'named', email: value });
    if (out.length >= 30) break;
  }
  return out;
}

/**
 * The ContextPack-shaped object a refinement sends: the answer's plain text as the only data (src/compose/rewrite.js
 * buildComposePack), the people of the run that made it plus the ones its firewall masked (so names that were put back are masked
 * again), and the table of the ticket it was written for, so the table policy and the HR gate apply as they did to the answer.
 */
export function refinePack(answer, page) {
  const text = plainOf(answer?.text);
  const people = mergePeople(Array.isArray(answer?.people) ? answer.people : [], peopleFromScan(answer?.scan, text));
  const table = answer?.lastPack?.table || answer?.source?.expect?.table || page?.record?.table || page?.newRecord?.table || '';
  return buildComposePack({ text, people, table, field: 'text' });
}

/** The meta a refined answer carries: which answer it came from, the feature it counts as, and its label. */
export function refineMeta(answer, preset, choice = {}) {
  return { refineOf: answer?.id || '', base: baseFeatureOf(answer), label: refineLabel(preset, choice) };
}

/**
 * What the answer area says about other tickets with something waiting (a run in flight, a preview to check, an answer not seen yet):
 * one short line per ticket, newest first, at most 3. `runs` and `answersOf` come from the session; `current` is the ticket on screen.
 */
export function elsewhereLines({ runs = [], answersOf = () => [], current = '' }) {
  const lines = [];
  const seen = new Set();
  for (const r of runs) {
    if (!r || r.key === current || seen.has(r.key)) continue;
    const number = r.number ? isolate(r.number) : t('another ticket');
    if (r.phase === 'preview') lines.push({ key: r.key, text: t('{number}: waiting for you to check what is sent.', { number }) });
    else if (r.phase === 'reading' || r.phase === 'sending') lines.push({ key: r.key, text: t('{number}: answer on its way.', { number }) });
    else continue;
    seen.add(r.key);
  }
  for (const r of runs) {
    if (!r || r.key === current || seen.has(r.key)) continue;
    const fresh = answersOf(r.key).filter((a) => a.unseen);
    if (!fresh.length) continue;
    lines.push({ key: r.key, text: tn(fresh.length, '{number}: an answer is ready.', '{number}: {n} answers are ready.', { number: r.number ? isolate(r.number) : t('another ticket') }) });
    seen.add(r.key);
  }
  return lines.slice(0, 3);
}
