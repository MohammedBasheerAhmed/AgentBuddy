import { resolveProviderConfig } from '../providers/config.js';
import { aiOffProblem } from '../lib/pipeline.js';
import { t, tm, t as tr } from '../i18n/index.js';

// "Can the AI buttons work?" in one place. It asks the same questions the pipeline asks (assertRunnable): has the organisation
// switched AI off, or is the AI address in its policy not valid (then nothing in Settings helps)? Is there a key, or does
// this provider need none (Ollama, or an OpenAI-compatible server on this computer such as LM Studio)? A key the organisation
// provides counts too. And is the address set up (an address that did not pass the check, "my own server" with no address, an Azure
// resource that is not complete)? Before this there were four copies of the check, and they disagreed.

/**
 * Why the organisation's policy stops every AI call, as a sentence; '' when it does not: AI switched off (`aiEnabled: false`), or an
 * AI address in the policy that is not valid (`aiBlocked`, which says to ask the administrator). Checked before the person's own set-up,
 * as the pipeline does, so the panel never sends them to a Settings field they cannot change.
 */
export function policyBlock(eff) {
  return aiOffProblem(eff?.policy) || (eff?.policy?.aiBlocked ? String(eff.policy.aiBlocked) : '');
}

/** Why the provider set-up cannot be used yet, as a sentence; '' when it can (the key is a separate question). */
export function setupProblem(eff) {
  if (!eff?.values) return '';
  const config = resolveProviderConfig(eff.values, eff.apiKey || eff.values.providedApiKey || '');
  if (config.invalidBaseUrl) return config.invalidBaseUrl;
  if (config.provider === 'custom' && !config.baseUrl) return t('Enter the address of your AI server.');
  if (config.azure && !config.model) return t('Enter the name of your Azure deployment.');
  return '';
}

function hasKeyOrNeedsNone(eff) {
  if (eff.apiKey || eff.values.providedApiKey) return true;
  // A key was saved for this provider and is locked behind its passphrase: the person means to use it. A server that needs no key
  // would otherwise be sent the request WITHOUT it and answer 401, and the panel would blame the key instead of saying "locked".
  if (eff.keyLocked) return false;
  return resolveProviderConfig(eff.values, eff.apiKey || '').keyOptional;
}

/** @param {{ values?: object, apiKey?: string }} eff the effective settings (useEffective) */
export function isAiReady(eff) {
  if (!eff?.values || policyBlock(eff)) return false;
  return hasKeyOrNeedsNone(eff) && !setupProblem(eff);
}

/**
 * '' when ready; 'policy' when the organisation's policy stops every AI call (policyBlock); 'unlock' when a stored key is locked
 * behind the passphrase; 'add-key' when there is none; 'setup' otherwise.
 */
export function aiNeeds(eff) {
  if (isAiReady(eff)) return '';
  if (policyBlock(eff)) return 'policy';
  if (eff?.keyLocked) return 'unlock';
  if (!eff?.values || !hasKeyOrNeedsNone(eff)) return 'add-key';
  return 'setup';
}

// What the panels put after "to use": a fragment, translated here so every panel gets the same Arabic. Each panel names its own
// (the ones in use are marked here so the catalogue has them; `tr` looks the fragment up like t, for a word that is not known here).
export const USE_WHAT = Object.freeze([tm('these actions'), tm('this action'), tm('this'), tm('these buttons'), tm('this button')]);

/** The sentence for a panel that cannot use the AI yet; '' when it can. `what` finishes "...to use ...". */
export function aiNeedsText(eff, what = 'these actions') {
  const needs = aiNeeds(eff);
  if (needs === 'policy') return policyBlock(eff);
  if (needs === 'unlock') return t('Your AI key is locked. Unlock it in Settings.');
  if (needs === 'add-key') return t('Add an AI key in Settings to use {what}.', { what: tr(what) });
  if (needs === 'setup') return t('Finish the AI set-up in Settings to use {what}: {problem}', { what: tr(what), problem: setupProblem(eff) });
  return '';
}
