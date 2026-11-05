// "Copy diagnostics" in Settings: what support needs to understand a problem, as plain text the person can paste into a ticket or an
// email, and nothing that must not leave the computer. Pure (no chrome.*), so tests can check that no secret ever gets in
// (tests/options-diagnostics.test.js).
//
// Only fields named here are copied (a list of what goes IN, never a list of what to leave out), so a setting added later cannot slip
// in by accident:
//   - versions: Agent Buddy, the build (normal or enterprise), the browser
//   - the effective settings without secrets: never a key, never a key preview, never a key's length; only whether one is saved
//   - the organisation's policy: which keys are set; lists as counts where their entries could name people or teams
//   - the sites Agent Buddy runs on, as host names
//   - the last problems from the activity log: when, which action, which table, the outcome and its short code (the log holds no
//     content, see src/audit/auditLog.js)
const host = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
};
const yesNo = (value) => (value ? 'yes' : 'no');
const list = (value) => (Array.isArray(value) ? value : []);
// A short word or id from settings or the policy: letters, digits and - _ . : only, so free text cannot ride along.
const word = (value, max = 60) => (/^[A-Za-z0-9_.:-]{1,80}$/.test(String(value ?? '')) ? String(value).slice(0, max) : '');

/** "Chrome 130" / "Edge 130" from the browser's user agent string ('' when it says neither). */
export function browserName(userAgent) {
  const ua = String(userAgent || '');
  const edge = /\bEdg\/(\d+)/.exec(ua);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = /\bChrome\/(\d+)/.exec(ua);
  return chrome ? `Chrome ${chrome[1]}` : '';
}

const PROBLEM_OUTCOMES = new Set(['error', 'blocked']);

/**
 * @param {object} input
 *   manifest   chrome.runtime.getManifest()
 *   userAgent  navigator.userAgent
 *   eff        the effective settings ({ values, policy, locked, apiKey?, keyLocked? })
 *   keyMode    where the key for the provider in use is kept: 'none' | 'local' | 'session' | 'encrypted'
 *   instances  the active sites (origins)
 *   audit      the activity log (oldest first)
 *   now        a Date (for the time stamp)
 * @returns {string}
 */
export function diagnosticsText({ manifest = {}, userAgent = '', eff = {}, keyMode = 'none', instances = [], audit = [], now = new Date() } = {}) {
  const v = eff.values || {};
  const p = eff.policy || {};
  const lines = [];
  const add = (text = '') => lines.push(text);

  add('Agent Buddy diagnostics');
  add(`Made: ${new Date(now).toISOString()}`);
  add(`Version: ${word(manifest.version) || 'unknown'}`);
  add(`Build: ${Array.isArray(manifest.host_permissions) && manifest.host_permissions.length ? 'enterprise (sites fixed at install)' : 'normal'}`);
  add(`Browser: ${browserName(userAgent) || 'unknown'}`);
  add();

  add('Settings (no key and nothing about a key but whether one is saved)');
  const provider = word(v.provider);
  add(`  AI provider: ${provider || 'none'}`);
  add(`  Model: ${word(v.models?.[v.provider], 80) || 'default'}`);
  add(`  AI address: ${host(v.baseUrls?.[v.provider]) || 'the provider\'s own'}`);
  add(`  Key: ${v.providedApiKey ? 'supplied by the organisation' : keyMode && keyMode !== 'none' ? `saved (${word(keyMode)})${eff.keyLocked ? ', locked' : ''}` : 'none saved'}`);
  add(`  Where to keep the key: ${word(v.keyStorage) || 'local'}`);
  add(`  Privacy: ${word(v.piiMode) || 'standard'}; check what is sent: ${word(v.previewMode) || 'first'}`);
  add(`  AI skipped for now: ${yesNo(v.aiSkipped)}`);
  add(`  Work profiles: ${list(v.profiles).map((id) => word(id)).filter(Boolean).join(', ') || 'none chosen'}${v.profilesConfirmed ? '' : ' (not confirmed)'}; show everything: ${yesNo(v.showEverything)}`);
  add(`  Bar on ServiceNow pages: ${yesNo(v.pageBar !== false)}; quick actions pinned for ${Object.keys(v.quickPins || {}).length} kind(s)`);
  add(`  Side rail: ${yesNo(v.railShow === true)}; names shown: ${yesNo(v.railNames === true)}`);
  add(`  Follow-ups due after: ${Number.isFinite(Number(v.followUpDays)) ? Math.floor(Number(v.followUpDays)) : 3} days`);
  add();

  add("Organisation's policy");
  const set = [];
  if (p.aiEnabled === false) set.push('AI switched off');
  if (p.aiBlocked) set.push('AI address not valid');
  if (p.aiProvider) set.push(`provider ${word(p.aiProvider)}`);
  if (p.aiBaseUrl) set.push(`AI address ${host(p.aiBaseUrl) || 'set'}`);
  if (Array.isArray(p.allowedProviders)) set.push(`allowed providers ${p.allowedProviders.map((x) => word(x)).filter(Boolean).join(', ') || 'none'}`);
  if (Array.isArray(p.allowedModels)) set.push(`allowed models ${p.allowedModels.length}`);
  if (p.piiMode) set.push(`privacy at least ${word(p.piiMode)}`);
  if (p.previewMode) set.push(`check at least ${word(p.previewMode)}`);
  if (p.keyStorage) set.push(`key kept ${word(p.keyStorage)}`);
  if (p.providedApiKey) set.push('key supplied (not shown)');
  if (Array.isArray(p.allowedInstances)) set.push(`allowed instances ${p.allowedInstances.length}`);
  if (list(p.disabledFeatures).length) set.push(`switched-off features ${p.disabledFeatures.map((x) => word(x)).filter(Boolean).join(', ')}`);
  if (list(p.disabledSections).length) set.push(`hidden screens ${p.disabledSections.map((x) => word(x)).filter(Boolean).join(', ')}`);
  if (list(p.blockedTables).length) set.push(`blocked tables ${p.blockedTables.length}`);
  if (list(p.blockedFields).length) set.push(`blocked fields ${p.blockedFields.length}`);
  if (p.allowHrContent) set.push('HR content allowed');
  if (Array.isArray(p.allowedProfiles)) set.push(`allowed profiles ${p.allowedProfiles.map((x) => word(x)).filter(Boolean).join(', ') || 'none'}`);
  if (Array.isArray(p.lockedProfiles)) set.push(`locked profiles ${p.lockedProfiles.map((x) => word(x)).filter(Boolean).join(', ') || 'none'}`);
  if (Number(p.tokenBudgetPerDay) > 0) set.push(`daily tokens ${Math.floor(Number(p.tokenBudgetPerDay))}`);
  if (p.disablePageBar) set.push('page bar off');
  if (p.coachingEnabled) set.push('coaching on');
  if (p.auditExport === false) set.push('activity log export off');
  if (list(p.orgSnippets).length) set.push(`organisation snippets ${p.orgSnippets.length}`);
  if (list(p.orgFormats).length) set.push(`organisation formats ${p.orgFormats.length}`);
  if (list(p.internalPhrases).length) set.push(`internal phrases ${p.internalPhrases.length}`);
  if (p.defaultDashboard) set.push('organisation dashboard set');
  if (list(p.priorityAccounts).length) set.push(`priority accounts ${p.priorityAccounts.length}`);
  add(`  ${set.length ? set.join('; ') : 'none set'}`);
  add();

  add('Sites Agent Buddy runs on');
  const hosts = list(instances).map(host).filter(Boolean);
  add(`  ${hosts.length ? hosts.join(', ') : 'none'}`);
  add();

  add('Last problems in the activity log (no content is ever kept there)');
  const problems = list(audit).filter((e) => PROBLEM_OUTCOMES.has(e?.outcome)).slice(-10).reverse();
  if (!problems.length) add('  none');
  for (const e of problems) {
    const when = word(String(e.time || '').replace(/\.\d+Z$/, 'Z'), 30) || '?';
    add(`  ${when}  ${word(e.feature, 40) || '?'}  ${word(e.table, 80) || '-'}  ${e.outcome}${word(e.reason, 30) ? ` (${word(e.reason, 30)})` : ''}`);
  }
  // Last line of defence: a key pasted into the wrong box (the model name, say) would pass the checks above as a plain word.
  let text = `${lines.join('\n')}\n`;
  for (const secret of [eff.apiKey, v.providedApiKey, p.providedApiKey]) {
    const s = String(secret || '').trim();
    if (s.length >= 8) text = text.split(s).join('[hidden]');
  }
  return text;
}
