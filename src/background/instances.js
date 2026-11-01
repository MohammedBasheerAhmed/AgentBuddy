// Which ServiceNow sites Agent Buddy runs on, and what the service worker does about the open tabs of those sites. Pure: the worker
// (service-worker.js) passes in the settings, the policy and the browser's answers, so every rule is unit-tested
// (tests/background-instances.test.js) without chrome.*.
import { isInstanceAllowed, normalizeAllowEntry, normalizeInstance } from '../policy/policy.js';

/**
 * The exact instance addresses the organisation lists in `allowedInstances` (in the managed policy, or compiled into an enterprise
 * build). Each one is turned on without the person doing anything, as long as the browser has granted access to it (an enterprise
 * build has it from installation; a normal build once the person allowed the site). A wildcard ("*.service-now.com") names no
 * particular site, so it is never turned on by itself.
 * @param {object} policy the normalised policy
 * @returns {string[]} canonical origins
 */
export function policyInstances(policy) {
  const list = Array.isArray(policy?.allowedInstances) ? policy.allowedInstances : [];
  const out = [];
  for (const entry of list) {
    const clean = normalizeAllowEntry(entry);
    if (!clean || clean.startsWith('*.')) continue;
    const origin = normalizeInstance(clean);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * The sites that should be on, before the browser's permission is checked: the ones the person turned on, then the organisation's
 * exact ones; only those the policy allows; each once.
 * @returns {string[]}
 */
export function wantedInstances(settings, policy) {
  const own = (Array.isArray(settings?.instances) ? settings.instances : []).map(normalizeInstance).filter(Boolean);
  const out = [];
  for (const origin of [...own, ...policyInstances(policy)]) {
    if (!out.includes(origin) && isInstanceAllowed(origin, policy)) out.push(origin);
  }
  return out;
}

/**
 * Should the worker inject the content scripts into the tabs that are already open, after `chrome.runtime.onInstalled`?
 *   install  an enterprise build (or a policy instance already granted) works on the ServiceNow tabs that were open at install
 *   update   the copy of the content script in those tabs belongs to the old version and is cut off from the extension: without a
 *            new copy the bar and the panel stop working there until each tab is reloaded
 * Not on 'chrome_update' or 'shared_module_update' (the browser restarted or a module changed: the tabs were reloaded anyway, or
 * the extension's own code did not change).
 */
export const reinjectAfterInstalled = (reason) => reason === 'install' || reason === 'update';

/**
 * Which of the person's own sites to list in Settings and which came from the organisation (shown as "turned on by your
 * organisation", with no Turn off: the policy would turn it on again).
 * @param {string[]} active the active instances (wanted and granted)
 * @returns {{ origin: string, managed: boolean }[]}
 */
export function describeInstances(active, settings, policy) {
  const own = new Set((Array.isArray(settings?.instances) ? settings.instances : []).map(normalizeInstance).filter(Boolean));
  const managed = new Set(policyInstances(policy));
  return (Array.isArray(active) ? active : []).map((origin) => ({ origin, managed: managed.has(origin) && !own.has(origin) }));
}
