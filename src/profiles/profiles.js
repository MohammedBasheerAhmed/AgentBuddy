// Work profiles: what a person works on decides which cards, actions and screens they see first (TRACKER.md 2.5). Pure: the panel
// passes in the person's roles and settings, nothing here reads chrome.* or the page.
//
// Three rules hold everywhere:
//   1. Several profiles can be on at once (people wear several hats).
//   2. A profile only decides what is SHOWN. A ticket outside the person's profiles still works: its actions are one click away
//      ("Show customer service tools"), never refused.
//   3. "Show everything" overrides the profiles for people who want the full list.
import { PROFILE_IDS } from './ids.js';
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

// ServiceNow roles that suggest a profile. Exact names, or a prefix ending in "." or "_" for a whole family of roles. These are the
// base-system names; a customer's own roles do not match, and the person can always tick a profile themselves
// (docs/live-questions/profiles.md lists what to check on a real instance).
const ROLE_RULES = {
  it: { exact: ['itil', 'itil_admin', 'sn_incident_write'], prefix: [] },
  csm: { exact: [], prefix: ['sn_customerservice', 'sn_csm_'] },
  hr: { exact: [], prefix: ['sn_hr_core.', 'sn_hr_le.', 'sn_hr_sp.'] },
  km: { exact: ['knowledge', 'knowledge_manager', 'knowledge_admin'], prefix: [] },
  mpc: { exact: ['problem_coordinator', 'problem_manager', 'change_manager', 'major_incident_manager'], prefix: ['sn_major_inc_mgmt.', 'sn_change_cab.'] },
};

const hasRole = (roles, rule) => roles.some((r) => rule.exact.includes(r) || rule.prefix.some((p) => r.startsWith(p)));

/**
 * The profiles to suggest at first run.
 * @param {{ roles?: string[], managesGroup?: boolean, hasCatalogWork?: boolean, hrApproved?: boolean }} hints
 *   roles: the person's ServiceNow roles (from the page); managesGroup: they manage an assignment group; hasCatalogWork: catalog
 *   tasks or requested items are assigned to them; hrApproved: the organisation allows the HR profile.
 * @returns {string[]} profile ids in the order of PROFILE_IDS; never empty (IT when nothing points anywhere else)
 */
export function suggestProfiles({ roles = [], managesGroup = false, hasCatalogWork = false, hrApproved = false } = {}) {
  const r = (Array.isArray(roles) ? roles : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
  const on = new Set();
  for (const [id, rule] of Object.entries(ROLE_RULES)) if (hasRole(r, rule)) on.add(id);
  if (!hrApproved) on.delete('hr');
  if (hasCatalogWork) on.add('req');
  if (managesGroup) on.add('lead');
  // Every add-on needs a base: someone with only a knowledge or a lead role still opens tickets.
  if (!['it', 'req', 'csm', 'hr'].some((id) => on.has(id))) on.add('it');
  return PROFILE_IDS.filter((id) => on.has(id));
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

// ---- AI functions ---------------------------------------------------------------------------------------------------------------

// Who sees each AI function by default (TRACKER.md section 3). A feature may carry its own `profiles` to override this.
const ALL = ['all'];
export const FEATURE_PROFILES = Object.freeze({
  'record-summary': ALL,
  'thread-summary': ALL,
  'sentiment-risk': ['it', 'csm'],
  'hr-case-brief': ['hr'],
  'account-briefing': ['csm'],
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
