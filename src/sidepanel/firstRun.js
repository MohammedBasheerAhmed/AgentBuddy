// The first steps with Agent Buddy, as one "Getting started" card the panel shows until they are done: turn it on for the ServiceNow
// site, say what you work on (work profiles), set up AI or skip it for now, open a ticket. Pure: the panel's state in, the steps
// out (tests/panel-first-run.test.js). FirstRun.jsx draws the card with the action of the step that is next; SetupView.jsx leaves
// out what the card already offers, so nothing is said twice.
import { PROFILES, suggestProfiles } from '../profiles/profiles.js';

/**
 * @param {{ page: object, lastSeen?: object|null, aiReady: boolean, eff?: object, activeInstances?: string[]|null }} input
 *   page: what usePage says about the active tab; lastSeen: the last ServiceNow page that answered; eff: the effective settings
 *   (useEffective); activeInstances: the sites the service worker runs on (null while not known yet)
 * @returns {{ show: boolean, next: string, steps: { id: string, label: string, state: 'done'|'next'|'later', hint: string }[] }}
 *   show: false once the setup steps are done (the card is for a first run, not for every page that is not a ticket). The last
 *   step (open a ticket) never keeps it on screen by itself.
 */
export function firstRunSteps({ page, lastSeen = null, aiReady, eff = null, activeInstances = null }) {
  const enabledHere = page?.status === 'record' || page?.status === 'no-record';
  const instances = Array.isArray(eff?.values?.instances) ? eff.values.instances : [];
  const siteOn = enabledHere || Boolean(lastSeen) || instances.length > 0 || (Array.isArray(activeInstances) && activeInstances.length > 0);
  const onTicket = page?.status === 'record';
  // Profiles: answered, or set by the organisation (then there is nothing to ask). Without settings (an old caller) it is not asked.
  const profilesDone = !eff?.values || eff.values.profilesConfirmed === true || Boolean(eff.locked?.profiles);
  // AI: set up, skipped for now ("Skip AI for now"), or switched off by the organisation (then the step is not there at all).
  const aiOff = eff?.policy?.aiEnabled === false;
  const aiDone = Boolean(aiReady) || eff?.values?.aiSkipped === true;

  const raw = [
    {
      id: 'site',
      label: 'Turn on Agent Buddy for your ServiceNow site',
      done: siteOn,
      // No hint: the step's own text (with the Turn on button) already says what turning it on reads, and without an address the
      // "Not turned on for this page" card below the steps says what to do. Said once (TRACKER.md 2.4).
      hint: '',
    },
    { id: 'profiles', label: 'Choose what you work on', done: profilesDone, hint: 'Agent Buddy then shows the tools for that work first. You can change it in Settings.' },
    ...(aiOff ? [] : [{ id: 'ai', label: 'Set up AI, or skip it for now', done: aiDone, hint: 'Add a key for your AI provider in Settings. Without AI, everything under Insights still works.' }]),
    { id: 'ticket', label: 'Open a ticket', done: onTicket, hint: 'An incident, request, catalog task or case. Agent Buddy offers help for it here.' },
  ];
  let next = '';
  const steps = raw.map(({ done, ...step }) => {
    if (done) return { ...step, state: 'done' };
    if (next) return { ...step, state: 'later' };
    next = step.id;
    return { ...step, state: 'next' };
  });
  const show = !(siteOn && profilesDone && (aiOff || aiDone));
  return { show, next: show ? next : '', steps };
}

export const STEP_WORD = Object.freeze({ done: 'Done', next: 'Next', later: 'Later' });

// ---- Is this tab a ServiceNow page? -------------------------------------------------------------------------------------------
//
// "Turn on for this site" is offered where it makes sense: on a ServiceNow address, or on a page that shows the marks of a ServiceNow
// page. Anywhere else (webmail, an intranet page) it says "This does not look like ServiceNow" and keeps a small "Turn on anyway"
// for an instance on a custom domain.

// ServiceNow's own hosting: commercial (service-now.com, servicenow.com) and the government cloud (servicenowservices.com).
const SN_HOST_RE = /\.(service-now|servicenow|servicenowservices)\.com$/i;

/** Is this origin on ServiceNow's own hosting? */
export function hostLooksLikeServiceNow(origin) {
  try {
    const url = new URL(String(origin || ''));
    return url.protocol === 'https:' && SN_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * What a one-time look at the page found (pageMarkers in usePage.js runs it in the page through the toolbar click's activeTab):
 *   { gck, now, glide, scripts } booleans; null when the page could not be looked at.
 * @returns {'servicenow'|'other'|'unknown'}
 */
export function siteVerdict({ origin, markers }) {
  if (hostLooksLikeServiceNow(origin)) return 'servicenow';
  if (!markers || typeof markers !== 'object') return 'unknown';
  return markers.gck === true || markers.now === true || markers.glide === true || markers.scripts === true ? 'servicenow' : 'other';
}

// ---- What do you work on? -----------------------------------------------------------------------------------------------------

/** HR work is offered only where the organisation approved it (it names the profile in allowedProfiles, or allows HR content). */
export const hrApprovedBy = (policy) => Boolean(policy?.allowedProfiles?.includes('hr') || policy?.allowHrContent);

/**
 * The profiles a person may choose here, split into the main ones and the add-ons, and the ones ticked to start with.
 * @param {{ eff: object, roles?: string[], hints?: { managesGroup?: boolean, hasCatalogWork?: boolean } }} input
 * @returns {{ main: object[], addOns: object[], ticked: string[], locked: boolean }}
 *   ticked: the person's own choice when they made one, else the suggestion from their roles and work
 */
export function profileChoices({ eff, roles = [], hints = {} }) {
  const policy = eff?.policy || {};
  const allowed = Array.isArray(policy.allowedProfiles) ? policy.allowedProfiles : null;
  const hrApproved = hrApprovedBy(policy);
  const offered = PROFILES.filter((p) => (p.id !== 'hr' || hrApproved) && (!allowed || allowed.includes(p.id)));
  const ids = offered.map((p) => p.id);
  const own = Array.isArray(eff?.values?.profiles) ? eff.values.profiles.filter((id) => ids.includes(id)) : [];
  const suggested = suggestProfiles({ roles, managesGroup: hints.managesGroup === true, hasCatalogWork: hints.hasCatalogWork === true, hrApproved }).filter((id) => ids.includes(id));
  const ticked = eff?.values?.profilesConfirmed && own.length ? own : suggested.length ? suggested : ids.slice(0, 1);
  return { main: offered.filter((p) => !p.addOn), addOns: offered.filter((p) => p.addOn), ticked, locked: Boolean(eff?.locked?.profiles) };
}

/** The settings to save when the person confirms: known, allowed ids in the profiles' own order; never empty. */
export function confirmedProfiles(ticked, choices) {
  const order = [...choices.main, ...choices.addOns].map((p) => p.id);
  const picked = order.filter((id) => ticked.includes(id));
  // Every add-on needs a base (someone with only a lead role still opens tickets): the first main profile when none is ticked.
  const hasBase = picked.some((id) => choices.main.some((p) => p.id === id));
  const withBase = hasBase || !choices.main.length ? picked : [choices.main[0].id, ...picked];
  return { profiles: withBase, profilesConfirmed: true };
}
