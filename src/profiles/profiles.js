// Work profiles: what a person works on decides which cards, actions and screens they see first (TRACKER.md 2.5). Pure: the panel
// passes in the person's roles and settings, nothing here reads chrome.* or the page.
//
// Three rules hold everywhere:
//   1. Several profiles can be on at once (people wear several hats).
//   2. A profile only decides what is SHOWN. A ticket outside the person's profiles still works: its actions are one click away
//      ("Show customer service tools"), never refused.
//   3. "Show everything" overrides the profiles for people who want the full list.
import { PROFILE_IDS, cleanProfilesFor } from './ids.js';
// (core.js: the service worker's bundle carries this file too, and has no Arabic catalogue; the labels are read in the panel)
import { t } from '../i18n/core.js';

export { PROFILE_IDS };

// (label, short and description are read when they are shown, so they follow the language of the panel)
export const PROFILES = Object.freeze([
  {
    id: 'it',
    get label() { return t('IT service desk and resolver'); },
    short: 'IT',
    addOn: false,
    get description() { return t('Incidents and requests: routing, recent changes, known errors and outages.'); },
  },
  {
    id: 'req',
    get label() { return t('Request fulfilment'); },
    get short() { return t('Requests'); },
    addOn: false,
    get description() { return t('Requested items and catalog tasks: request status, checklists, approvals.'); },
  },
  {
    id: 'csm',
    get label() { return t('Customer service'); },
    short: 'CSM',
    addOn: false,
    get description() { return t('Cases and accounts: account at a glance, escalation to engineering, chat.'); },
  },
  {
    id: 'hr',
    get label() { return t('HR service delivery'); },
    short: 'HR',
    addOn: false,
    get description() { return t('HR cases, always in Strict privacy mode. Your organisation has to approve it.'); },
  },
  {
    id: 'lead',
    get label() { return t('Team lead'); },
    get short() { return t('Lead'); },
    addOn: true,
    get description() { return t('The Team screen: dashboards, workload, shift hand-over.'); },
  },
  {
    id: 'km',
    get label() { return t('Knowledge manager'); },
    get short() { return t('Knowledge'); },
    addOn: true,
    get description() { return t('Duplicate articles, knowledge gaps and article reviews.'); },
  },
  {
    id: 'mpc',
    get label() { return t('Major incident, problem and change'); },
    get short() { return t('Major incident'); },
    addOn: true,
    get description() { return t('Major incident updates, problem write-ups and CAB briefs.'); },
  },
]);

export const profileById = (id) => PROFILES.find((p) => p.id === id) || null;

// ServiceNow roles that suggest a profile. Exact names, or a prefix ending in "." or "_" for a whole family of roles; `except` names
// roles of such a family that many ordinary employees hold (the HR basic role), which say nothing about the work. These are the
// base-system names; a customer's own roles do not match, and the person can always tick a profile themselves
// (docs/live-questions/audit-1107-roles.md lists what to check on a real instance). Roles only SUGGEST: the person's own choice wins,
// and a role never lets anything through that the form would refuse (docs/security.md: the page's word about roles is display-only).
// `req` and `lead` have a rule since the audit of 2026-11-07 (W-03, W-17): a fulfiller who only works catalog tasks was shown the IT
// tools, and a lead was never suggested from a role. The names that are in the bridge's fixed list (src/page/bridge.js ROLE_PROBE) are
// the ones that can be found when the page offers no list of roles.
// (the HR family is written in two pieces: a role name with a dot in it is not a dot-walked column, and the scan of src/ for those reads
// only whole dotted strings: tests/policy-hardening-dotwalk.test.js)
const HR_CORE = 'sn_hr_core';
const ROLE_RULES = {
  it: { exact: ['itil', 'itil_admin', 'sn_incident_write'], prefix: [] },
  req: { exact: ['sn_request_write', 'catalog_admin', 'catalog_manager', 'catalog_task_editor'], prefix: [] },
  csm: { exact: [], prefix: ['sn_customerservice', 'sn_csm_'] },
  hr: { exact: [], prefix: [HR_CORE + '.', 'sn_hr_le.', 'sn_hr_sp.'], except: [HR_CORE + '.basic'] },
  lead: { exact: ['sn_customerservice_manager', HR_CORE + '.manager'], prefix: [] },
  km: { exact: ['knowledge', 'knowledge_manager', 'knowledge_admin'], prefix: [] },
  mpc: { exact: ['problem_coordinator', 'problem_manager', 'change_manager', 'major_incident_manager'], prefix: ['sn_major_inc_mgmt.', 'sn_change_cab.'] },
};

const hasRole = (roles, rule) => roles.some((r) => !(rule.except || []).includes(r) && (rule.exact.includes(r) || rule.prefix.some((p) => r.startsWith(p))));

/**
 * What the page said about the person's roles: 'known' (a list of names), 'none' (it answered with an empty list: asked, and the
 * person holds none of the roles it looked for) or 'unknown' (it could not say: null or anything that is not a list). Unknown is NOT
 * "no roles": nothing is derived from it, and it never counts against the person (audit of 2026-11-07, W-03).
 */
export function rolesState(roles) {
  if (!Array.isArray(roles)) return 'unknown';
  return roles.some((r) => String(r || '').trim()) ? 'known' : 'none';
}

/** The profiles the roles point at, in the order of PROFILE_IDS. Only what a role says: no base profile is added here. */
export function profilesFromRoles(roles, { hrApproved = false } = {}) {
  if (rolesState(roles) !== 'known') return [];
  const r = roles.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  const on = new Set();
  for (const [id, rule] of Object.entries(ROLE_RULES)) if (hasRole(r, rule)) on.add(id);
  if (!hrApproved) on.delete('hr');
  return PROFILE_IDS.filter((id) => on.has(id));
}

/**
 * The profiles to suggest at first run.
 * @param {{ roles?: string[]|null, managesGroup?: boolean, hasCatalogWork?: boolean, hrApproved?: boolean }} hints
 *   roles: the person's ServiceNow roles (from the page; null when the page could not say, see rolesState); managesGroup: they manage
 *   an assignment group; hasCatalogWork: catalog tasks or requested items are assigned to them; hrApproved: the organisation allows
 *   the HR profile.
 * @returns {string[]} profile ids in the order of PROFILE_IDS; never empty (IT when nothing points anywhere else, also when the roles are unknown)
 */
export function suggestProfiles({ roles = null, managesGroup = false, hasCatalogWork = false, hrApproved = false } = {}) {
  const on = new Set(profilesFromRoles(roles, { hrApproved }));
  if (hasCatalogWork) on.add('req');
  if (managesGroup) on.add('lead');
  // Every add-on needs a base: someone with only a knowledge or a lead role still opens tickets.
  if (!['it', 'req', 'csm', 'hr'].some((id) => on.has(id))) on.add('it');
  return PROFILE_IDS.filter((id) => on.has(id));
}

/**
 * Did THIS person confirm the profiles that are stored? The stored choice belongs to whoever confirmed it (the setting `profilesFor`: a
 * short one-way hash of the site and their user id, never the id), so a second person on the same browser does not inherit it
 * (audit of 2026-11-07, W-18). False only when all of this holds: the profiles were confirmed, the confirmation recorded who made it,
 * the person at the screen is known and is someone else, and the page told us their roles (see rolesState; the roles are what the
 * new suggestion is made from). An unknown person, unknown roles or a confirmation from before the person was recorded all keep the
 * stored choice: not knowing never takes a choice away. Pure.
 * @param {object} values  the settings (eff.values)
 * @param {{ who?: string, roles?: string[]|null }} [input]  who: the hash of the person at the screen ('' when not known)
 */
export function profilesConfirmedFor(values, { who = '', roles = null } = {}) {
  if (values?.profilesConfirmed !== true) return false;
  const confirmedBy = cleanProfilesFor(values.profilesFor);
  const me = cleanProfilesFor(who);
  if (!confirmedBy || !me || confirmedBy === me) return true;
  return rolesState(roles) === 'unknown';
}

/**
 * The settings to save when the person confirms their profiles: the list, confirmed, and who confirmed it. `eff.signedIn` is the hash
 * withProfiles carries (a string, empty when the person is not known: then the record of who is cleared too, so an earlier person's hash
 * is not left standing for this one). Without it (the Settings page, which does not know who is signed in) the record is left as it is.
 * @param {string[]} profiles
 * @param {object} [eff]
 */
export function confirmPatch(profiles, eff = null) {
  const patch = { profiles, profilesConfirmed: true };
  return typeof eff?.signedIn === 'string' ? { ...patch, profilesFor: cleanProfilesFor(eff.signedIn) } : patch;
}

/** The person's profiles, or IT when none are chosen yet (the panel works before the first-run question is answered). */
export function activeProfiles(eff) {
  const p = eff?.values?.profiles;
  return Array.isArray(p) && p.length ? p : ['it'];
}

/**
 * Is an item for these profiles shown? `itemProfiles` lists the profiles it is for, or 'all'.
 * @param {string[]|undefined} itemProfiles
 * @param {string[]} active the person's profiles
 * @param {{ showEverything?: boolean }} [options]
 */
export function isVisibleFor(itemProfiles, active, { showEverything = false } = {}) {
  if (showEverything) return true;
  const list = Array.isArray(itemProfiles) && itemProfiles.length ? itemProfiles : ['all'];
  if (list.includes('all')) return true;
  const set = Array.isArray(active) && active.length ? active : ['it'];
  return list.some((p) => set.includes(p));
}

/** Shorthand for the panel: is this item shown for the person in `eff`? */
export const shownFor = (itemProfiles, eff) => isVisibleFor(itemProfiles, activeProfiles(eff), { showEverything: Boolean(eff?.values?.showEverything) });

// ---- What the roles and the open ticket add to the person's own choice -------------------------------------------------------------

// The profile whose tools a kind of ticket NEEDS, whatever the person chose: a requested item or a catalog task always gets the
// fulfilment tools (the checklist, the request status), a case the customer service tools. A profile may reorder or hide what is
// irrelevant to the open ticket's kind, never what its kind needs (delegated decision, audit of 2026-11-07, W-03). HR and knowledge
// are not here: HR work needs the organisation's approval and Strict privacy mode (it keeps its hint, missingProfileFor), and
// managing articles is not the work of everyone who opens one.
export const KIND_NEEDS = Object.freeze({ request: ['req'], requested_item: ['req'], catalog_task: ['req'], case: ['csm'] });

/**
 * The effective settings with the profiles the panel should act on for THIS person and THIS ticket, worked out from three things in this
 * order, and nothing else changed (the settings on disk are never touched):
 *   1. The person's own choice (`profiles`, or the profiles the organisation set) always wins. It is theirs when they made it: a choice
 *      someone else confirmed on this browser is not (profilesConfirmedFor, W-18): it is set aside, the profiles are not confirmed again
 *      here, and the first-run question comes back with the roles' suggestion.
 *   2. Until they have chosen: the profiles their roles point at, when the page told us the roles (null/unknown: IT, as before).
 *   3. The tools the open ticket's kind needs (KIND_NEEDS), unless the organisation set the profiles or does not allow that profile.
 * Roles only decide what is SHOWN: this function changes `values.profiles` (and, for a stranger's choice, `profilesConfirmed`) and
 * nothing that decides what may be written or sent.
 * Returns `eff` itself when nothing changes, so a memo on it stays still. When `who` is given (even empty) the result also carries
 * `signedIn`, the same hash: confirmPatch saves it with the person's choice.
 * @param {object} eff  useEffective()'s settings
 * @param {{ roles?: string[]|null, kind?: string, who?: string }} [input]  roles: page.user.roles; kind: the open record's kind;
 *   who: the hash of the signed-in person (useProfileOwner; '' when not known)
 */
export function withProfiles(eff, { roles = null, kind = '', who } = {}) {
  const values = eff?.values;
  if (!values) return eff;
  const policy = eff.policy || {};
  const locked = Boolean(eff.locked?.profiles);
  const allowed = (id) => !Array.isArray(policy.allowedProfiles) || policy.allowedProfiles.includes(id);
  const hrApproved = Boolean(policy.allowedProfiles?.includes('hr') || policy.allowHrContent);
  // (the organisation's set belongs to nobody: it is never a stranger's)
  const stranger = !locked && values.profilesConfirmed === true && !profilesConfirmedFor(values, { who, roles });
  const own = !stranger && Array.isArray(values.profiles) ? values.profiles : [];
  let next = own;
  if (!locked && !own.length && (stranger || values.profilesConfirmed !== true)) {
    const fromRoles = profilesFromRoles(roles, { hrApproved }).filter(allowed);
    // (every add-on needs a base: someone with only a lead or knowledge role still opens tickets)
    if (fromRoles.length) next = ['it', 'req', 'csm', 'hr'].some((id) => fromRoles.includes(id)) ? fromRoles : ['it', ...fromRoles].filter(allowed);
  }
  if (!locked) {
    const needed = (KIND_NEEDS[kind] || []).filter((id) => allowed(id) && !next.includes(id));
    // (nothing chosen and nothing known: the panel works as IT, so the ticket's tools come on top of IT, not instead of it)
    if (needed.length) next = [...(next.length ? next : ['it']), ...needed];
  }
  const signedIn = typeof who === 'string' ? { signedIn: cleanProfilesFor(who) } : {};
  if (!stranger && next === own) return who === undefined ? eff : { ...eff, ...signedIn };
  const changed = stranger ? { profilesConfirmed: false, profilesFor: '' } : {};
  return { ...eff, ...signedIn, values: { ...values, ...changed, profiles: PROFILE_IDS.filter((id) => next.includes(id)) } };
}

// ---- AI functions ---------------------------------------------------------------------------------------------------------------

// Who sees each AI function by default (TRACKER.md section 3). A feature may carry its own `profiles` to override this.
const ALL = ['all'];
export const FEATURE_PROFILES = Object.freeze({
  'record-summary': ALL,
  'thread-summary': ALL,
  'sentiment-risk': ['it', 'csm'],
  'hr-case-brief': ['hr'],
  'account-briefing': ['csm'],
  // The "Same caller" pain point (docs/focus-layout.md): every fulfiller has a caller.
  'caller-briefing': ALL,
  'request-explain': ['req', 'it'],
  'reply-draft': ALL,
  'missing-info': ALL,
  'chat-reply': ['csm', 'it'],
  'next-best-action': ['it', 'csm', 'req'],
  'routing-hint': ['it', 'csm'],
  'handoff-brief': ALL,
  'case-eng-escalation': ['csm'],
  'major-incident-comms': ['mpc'],
  'problem-rca': ['mpc'],
  'change-cab-brief': ['mpc'],
  'fulfilment-checklist': ['req'],
  'resolution-notes': ALL,
  'resolution-improve': ALL,
  'kb-article-draft': ['it', 'csm', 'km'],
  'chat-summary': ['csm', 'it'],
  'notes-to-ticket': ['it', 'csm'],
  'article-optimise': ['km'],
  'kb-merge-draft': ['km'],
  'kb-gap-outline': ['km'],
  'shift-handover': ['lead'],
  'dashboard-insights': ['lead'],
  'coaching-snapshot': ['lead'],
});

/** The profiles an AI feature is for: its own `profiles`, else the table above, else everyone (email and rewrite modes). */
export const profilesOfFeature = (feature) => (Array.isArray(feature?.profiles) && feature.profiles.length ? feature.profiles : FEATURE_PROFILES[feature?.id] || ALL);

// ---- Screens --------------------------------------------------------------------------------------------------------------------

/** The screens of the panel, in order, and who they are for. Team is for team leads; everything else is for everyone. */
export const SCREENS = Object.freeze([
  { id: 'ticket', get label() { return t('Ticket'); }, profiles: ALL },
  { id: 'mywork', get label() { return t('My work'); }, profiles: ALL },
  { id: 'team', get label() { return t('Team'); }, profiles: ['lead'] },
  { id: 'write', get label() { return t('Write'); }, profiles: ALL },
  { id: 'knowledge', get label() { return t('Knowledge'); }, profiles: ALL },
]);

/** The screens this person sees: their profiles, minus what the organisation hides. The Ticket screen is always there. */
export function screensFor(eff) {
  const hidden = Array.isArray(eff?.policy?.disabledSections) ? eff.policy.disabledSections : [];
  return SCREENS.filter((s) => s.id === 'ticket' || (!hidden.includes(s.id) && shownFor(s.profiles, eff)));
}

// ---- A ticket outside the person's profiles -------------------------------------------------------------------------------------

// The profile a kind of record belongs to, for the hint "This is a customer service case. Show customer service tools?".
const KIND_PROFILE = { case: 'csm', hr_case: 'hr', requested_item: 'req', catalog_task: 'req', request: 'req', knowledge: 'km' };
// The whole sentence for each kind, so a language can say "this is ..." the way it needs to (the tools are named by the profile).
const KIND_HINT = {
  case: (tools) => t('This is a customer service case. Show {tools} tools?', { tools }),
  hr_case: (tools) => t('This is an HR case. Show {tools} tools?', { tools }),
  requested_item: (tools) => t('This is a requested item. Show {tools} tools?', { tools }),
  catalog_task: (tools) => t('This is a catalog task. Show {tools} tools?', { tools }),
  request: (tools) => t('This is a request. Show {tools} tools?', { tools }),
  knowledge: (tools) => t('This is a knowledge article. Show {tools} tools?', { tools }),
};

/**
 * The profile this record calls for when the person does not have it, so the panel can offer to add it; null when nothing is missing.
 * The HR profile is only offered where the organisation approved it.
 */
export function missingProfileFor(kind, eff) {
  const id = KIND_PROFILE[kind];
  if (!id || eff?.values?.showEverything) return null;
  if (activeProfiles(eff).includes(id)) return null;
  if (id === 'hr' && !(eff?.policy?.allowedProfiles?.includes('hr') || eff?.policy?.allowHrContent)) return null;
  if (Array.isArray(eff?.policy?.allowedProfiles) && !eff.policy.allowedProfiles.includes(id)) return null;
  if (eff?.locked?.profiles) return null;
  const profile = profileById(id);
  return profile ? { profile, text: KIND_HINT[kind](profile.label.toLowerCase()) } : null;
}

// ---- AI on or off ---------------------------------------------------------------------------------------------------------------

/** The organisation switched AI off for everyone: no AI Assist half anywhere. */
export const aiOffByPolicy = (eff) => eff?.policy?.aiEnabled === false;

/** AI Assist offers its actions: the organisation allows AI and the person has not chosen "Skip AI for now". */
export const aiAvailable = (eff) => !aiOffByPolicy(eff) && !eff?.values?.aiSkipped;
