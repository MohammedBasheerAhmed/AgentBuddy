import { resolveProviderConfig } from '../providers/config.js';

// "Can the AI buttons work?" in one place. It asks the same questions the pipeline asks (assertRunnable): is there a key, or does
// this provider need none (Ollama, or an OpenAI-compatible server on this computer such as LM Studio)? A key the organisation
// provides counts too. And is the address set up (an address that did not pass the check, "my own server" with no address, an Azure
// resource that is not complete)? Before this there were four copies of the check, and they disagreed.

/** Why the provider set-up cannot be used yet, as a sentence; '' when it can (the key is a separate question). */
export function setupProblem(eff) {
  if (!eff?.values) return '';
  const config = resolveProviderConfig(eff.values, eff.apiKey || eff.values.providedApiKey || '');
  if (config.invalidBaseUrl) return config.invalidBaseUrl;
  if (config.provider === 'custom' && !config.baseUrl) return 'Enter the address of your AI server.';
  if (config.azure && !config.model) return 'Enter the name of your Azure deployment.';
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
  if (!eff?.values) return false;
  return hasKeyOrNeedsNone(eff) && !setupProblem(eff);
}

/** '' when ready; 'unlock' when a stored key is locked behind the passphrase; 'add-key' when there is none; 'setup' otherwise. */
export function aiNeeds(eff) {
  if (isAiReady(eff)) return '';
  if (eff?.keyLocked) return 'unlock';
  if (!eff?.values || !hasKeyOrNeedsNone(eff)) return 'add-key';
  return 'setup';
}

/** The sentence for a panel that cannot use the AI yet; '' when it can. `what` finishes "...to use ...". */
export function aiNeedsText(eff, what = 'these actions') {
  const needs = aiNeeds(eff);
  if (needs === 'unlock') return 'Your AI key is locked. Unlock it in Settings.';
  if (needs === 'add-key') return `Add an AI key in Settings to use ${what}.`;
  if (needs === 'setup') return `Finish the AI set-up in Settings to use ${what}: ${setupProblem(eff)}`;
  return '';
}
