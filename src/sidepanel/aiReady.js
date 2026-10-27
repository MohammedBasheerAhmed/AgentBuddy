import { resolveProviderConfig } from '../providers/config.js';

// "Can the AI buttons work?" in one place. It asks the same question the pipeline asks (assertRunnable): is there a key, or does
// this provider need none (Ollama, or an OpenAI-compatible server on this computer such as LM Studio)? A key the organisation
// provides counts too. Before this there were four copies of the check, and they disagreed.

/** @param {{ values?: object, apiKey?: string }} eff the effective settings (useEffective) */
export function isAiReady(eff) {
  if (!eff?.values) return false;
  if (eff.apiKey || eff.values.providedApiKey) return true;
  return resolveProviderConfig(eff.values, eff.apiKey || '').keyOptional;
}

/** '' when ready; 'unlock' when a stored key is locked behind the passphrase; 'add-key' otherwise. */
export function aiNeeds(eff) {
  if (isAiReady(eff)) return '';
  return eff?.keyLocked ? 'unlock' : 'add-key';
}

/** The sentence for a panel that cannot use the AI yet; '' when it can. `what` finishes "...to use ...". */
export function aiNeedsText(eff, what = 'these actions') {
  const needs = aiNeeds(eff);
  if (needs === 'unlock') return 'Your AI key is locked. Unlock it in Settings.';
  if (needs === 'add-key') return `Add an AI key in Settings to use ${what}.`;
  return '';
}
