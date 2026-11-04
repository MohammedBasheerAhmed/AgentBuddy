// The enterprise build: one organisation's ServiceNow instances, AI endpoint and policy compiled into the extension.
//
//   node build.js --enterprise enterprise/<name>.json        (npm run build:enterprise -- enterprise/<name>.json)
//
// This module is used by build.js and the tests only; the extension never imports it. What reaches the extension is (1) a manifest
// whose host access and connect-src name exactly the configured hosts, and (2) the configured policy in src/policy/baked.js, which
// src/policy/policy.js uses as a floor under the browser's managed policy. Everything here is pure (tests/policy-enterprise.test.js).
//
// The config is a managed policy (the keys of managed_schema.json, written in canonical form) plus a few build keys. It is checked
// strictly: anything unknown, mistyped, not canonical or wider than one exact host fails the build with a message saying what to write.
import { PROVIDERS, ANTHROPIC_API_URL, OPENAI_API_URL } from '../providers/config.js';
import { FEATURES } from '../features/registry.js';
import { KEY_STORAGE_MODES, PII_MODES, POLICY_KEYS, PREVIEW_MODES, PRIORITY_ACCOUNT_LIMITS, instancePattern, normalizeEndpoint, normalizeInstance } from './policy.js';
import { HIDEABLE_SCREENS, PROFILE_IDS } from '../profiles/ids.js';
import { LAYOUT_KIND, LAYOUT_MAX_CHARS, LAYOUT_VERSION } from '../reports/layoutFile.js';
import { FORMAT_LIMITS, normalizeFormat, specOf } from '../formats/formats.js';
import { orgDashboardProblems } from '../reports/dashboards.js';
import { FIELD_RE, TABLE_RE } from '../context/util.js';

/** Keys that describe the build, not the policy. `$comment` is ignored. */
export const BUILD_KEYS = Object.freeze(['$comment', 'label', 'updateUrl']);

/** esbuild onLoad filter for the file whose contents the enterprise build replaces. */
export const BAKED_MODULE_FILTER = /[\\/]src[\\/]policy[\\/]baked\.js$/;

// The vendor's own address for the providers whose address may be left empty (resolveProviderConfig then calls these).
export const VENDOR_BASE_URLS = Object.freeze({
  anthropic: ANTHROPIC_API_URL.replace(/\/messages$/, ''),
  openai: OPENAI_API_URL.replace(/\/chat\/completions$/, ''),
});

// Exactly these two hosts may be reached over plain http, and only for a model on the person's own computer.
const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1']);
const PREFIX_RE = /^[a-z][a-z0-9_]{1,63}$/;
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,39}$/;
const MAX_INSTANCES = 50;

// `reports` is not a feature of its own: it switches off the whole Team section (docs/deployment.md, "Feature ids").
const FEATURE_IDS = new Set([...FEATURES.map((f) => f.id), 'reports']);

const shown = (value) => JSON.stringify(value);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function checkStringList(key, value, errors, { each, min = 0, max = 500 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${key} must be a list, for example [${key === 'allowedInstances' ? '"https://acme.service-now.com"' : '"..."'}].`);
    return [];
  }
  if (value.length < min) errors.push(`${key} needs at least ${min} entr${min === 1 ? 'y' : 'ies'}.`);
  if (value.length > max) errors.push(`${key} has ${value.length} entries; at most ${max} are allowed.`);
  const seen = new Set();
  value.forEach((item, i) => {
    if (typeof item !== 'string' || !item) return errors.push(`${key}[${i}] must be text; got ${shown(item)}.`);
    if (item !== item.trim()) return errors.push(`${key}[${i}] has spaces around it: write ${shown(item.trim())}.`);
    if (seen.has(item)) errors.push(`${key}[${i}] ${shown(item)} is listed twice.`);
    seen.add(item);
    if (each) {
      const problem = each(item);
      if (problem) errors.push(`${key}[${i}] ${shown(item)}: ${problem}`);
    }
    return undefined;
  });
  return value.filter((item) => typeof item === 'string');
}

function instanceProblem(item) {
  if (item.includes('*')) return 'wildcards are not allowed in an enterprise build; list each instance.';
  if (/^http:\/\//i.test(item)) return 'instances must use https://.';
  const canonical = normalizeInstance(item);
  if (!canonical) return 'not an https address of one host.';
  if (canonical !== item) return `write it as ${shown(canonical)}.`;
  return '';
}

// The organisation's dashboard in a config: exactly a saved layout file (an object, not its text), with nothing left out or read
// differently by the Team screen. Every note the policy check would give is an error here.
function dashboardConfigProblems(value) {
  const shape = `{ "kind": "${LAYOUT_KIND}", "version": ${LAYOUT_VERSION}, "dashboard": { "name", "scope", "tables", "widgets" } }`;
  if (!isPlainObject(value)) return [`must be one dashboard layout as "Save layout as a file" writes it: ${shape}.`];
  const out = [];
  const extra = Object.keys(value).filter((k) => !['kind', 'version', 'dashboard'].includes(k));
  if (extra.length) out.push(`may only have kind, version and dashboard (not ${extra.join(', ')}).`);
  if (value.kind !== LAYOUT_KIND || value.version !== LAYOUT_VERSION) out.push(`kind must be "${LAYOUT_KIND}" and version ${LAYOUT_VERSION}.`);
  if (!isPlainObject(value.dashboard)) return [...out, `dashboard must be an object: ${shape}.`];
  const inner = Object.keys(value.dashboard).filter((k) => !['name', 'scope', 'tables', 'widgets'].includes(k));
  if (inner.length) out.push(`dashboard may only have name, scope, tables and widgets (not ${inner.join(', ')}).`);
  if (JSON.stringify(value).length > LAYOUT_MAX_CHARS) out.push(`it is longer than ${LAYOUT_MAX_CHARS} characters.`);
  if (!out.length) out.push(...orgDashboardProblems(value).map((p) => p.message));
  return out;
}

/**
 * The AI address calls will go to under this config, the origin for connect-src and the pattern the browser grants.
 * @returns {{ baseUrl: string, origin: string, pattern: string, local: boolean, error: string }}
 */
export function aiEndpointFor(provider, aiBaseUrl) {
  const def = PROVIDERS[provider];
  const fail = (error) => ({ baseUrl: '', origin: '', pattern: '', local: false, error });
  if (!def) return fail(`aiProvider must be one of ${Object.keys(PROVIDERS).join(', ')}.`);
  let address;
  if (def.baseUrl) {
    // A preset (Gemini, Mistral, Ollama...) always calls its own fixed address; a different aiBaseUrl could never be used.
    if (aiBaseUrl !== undefined && aiBaseUrl !== def.baseUrl) return fail(`the ${provider} provider always calls ${def.baseUrl}; leave aiBaseUrl out or write exactly that.`);
    address = def.baseUrl;
  } else if (aiBaseUrl !== undefined) {
    if (!def.userBaseUrl) return fail(`the ${provider} provider takes no aiBaseUrl.`);
    address = aiBaseUrl;
  } else if (VENDOR_BASE_URLS[provider]) {
    address = VENDOR_BASE_URLS[provider];
  } else {
    return fail(`the ${provider} provider needs aiBaseUrl (the address of your ${def.azure ? 'Azure OpenAI resource' : 'AI server'}).`);
  }
  if (typeof address !== 'string') return fail('aiBaseUrl must be text.');
  const endpoint = normalizeEndpoint(address);
  if (!endpoint.ok) return fail(`aiBaseUrl ${shown(address)} is not valid: ${endpoint.error}.`);
  if (endpoint.url !== address) return fail(`write aiBaseUrl as ${shown(endpoint.url)}.`);
  const url = new URL(endpoint.url);
  if (url.protocol === 'http:' && !LOCAL_HTTP_HOSTS.has(url.hostname)) return fail('plain http:// is only allowed for localhost or 127.0.0.1 (a model on this computer).');
  // The same pattern src/lib/aiPermission.js asks the browser about (any port on that host), so the check finds it granted.
  return { baseUrl: endpoint.url, origin: endpoint.origin, pattern: `${url.protocol}//${url.hostname}/*`, local: endpoint.local, error: '' };
}

/**
 * Check an enterprise config. Nothing is guessed: every problem is reported with what to write instead.
 * @returns {{ ok: boolean, errors: string[], plan: null | {
 *   label: string, updateUrl: string, policy: object, instances: string[], ai: { provider: string, baseUrl: string, origin: string, pattern: string, local: boolean },
 *   hostPermissions: string[], connectSrc: string[] } }}
 */
export function validateEnterpriseConfig(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { ok: false, errors: ['The config must be a JSON object.'], plan: null };
  const known = new Set([...POLICY_KEYS, ...BUILD_KEYS]);
  for (const key of Object.keys(raw)) {
    if (key === 'providedApiKey') errors.push('providedApiKey is not allowed: a key compiled into a build can be read by anyone who has the build. Supply keys through the managed policy or a gateway.');
    else if (!known.has(key)) {
      const near = [...known].find((k) => k.toLowerCase() === key.trim().toLowerCase());
      errors.push(`"${key}" is not a config key.${near ? ` Did you mean "${near}"?` : ''}`);
    }
  }

  const has = (key) => Object.prototype.hasOwnProperty.call(raw, key);
  const policy = {};

  // Where Agent Buddy may run: exact https origins, nothing wider.
  if (!has('allowedInstances')) errors.push('allowedInstances is required: the https addresses of your ServiceNow instances.');
  else policy.allowedInstances = checkStringList('allowedInstances', raw.allowedInstances, errors, { each: instanceProblem, min: 1, max: MAX_INSTANCES });

  // The one AI endpoint.
  let ai = null;
  if (!has('aiProvider')) errors.push(`aiProvider is required: one of ${Object.keys(PROVIDERS).join(', ')}.`);
  else if (typeof raw.aiProvider !== 'string' || !PROVIDERS[raw.aiProvider]) errors.push(`aiProvider ${shown(raw.aiProvider)} must be one of ${Object.keys(PROVIDERS).join(', ')} (lower case).`);
  else {
    const endpoint = aiEndpointFor(raw.aiProvider, has('aiBaseUrl') ? raw.aiBaseUrl : undefined);
    if (endpoint.error) errors.push(`aiProvider/aiBaseUrl: ${endpoint.error}`);
    else {
      ai = { provider: raw.aiProvider, ...endpoint };
      policy.aiProvider = raw.aiProvider;
      // Always pinned, also when the config left it out (the vendor's address): Settings then shows it as set by the organisation,
      // and nobody can type an address the build's connect-src would refuse anyway.
      policy.aiBaseUrl = endpoint.baseUrl;
    }
  }
  if (has('allowedProviders')) {
    const ids = Object.keys(PROVIDERS);
    policy.allowedProviders = checkStringList('allowedProviders', raw.allowedProviders, errors, {
      min: 1,
      each: (item) => (PROVIDERS[item] ? '' : `not a provider id; use one of ${ids.join(', ')} (lower case).`),
    });
    if (typeof raw.aiProvider === 'string' && Array.isArray(raw.allowedProviders) && !raw.allowedProviders.includes(raw.aiProvider)) {
      errors.push(`allowedProviders does not include aiProvider ${shown(raw.aiProvider)}: no AI call could ever be made.`);
    }
  }
  if (has('allowedModels')) policy.allowedModels = checkStringList('allowedModels', raw.allowedModels, errors, { min: 1, max: 100 });

  const enumKey = (key, allowed) => {
    if (!has(key)) return;
    if (!allowed.includes(raw[key])) errors.push(`${key} ${shown(raw[key])} must be one of ${allowed.join(', ')} (lower case).`);
    else policy[key] = raw[key];
  };
  enumKey('piiMode', PII_MODES);
  enumKey('previewMode', PREVIEW_MODES);
  enumKey('keyStorage', KEY_STORAGE_MODES);
  if (policy.piiMode === 'local-only' && ai && !ai.local) errors.push('piiMode "local-only" refuses every endpoint that is not on this computer, and aiBaseUrl is not: no AI call could ever be made.');

  const nameList = (key, re, what) => {
    if (has(key)) policy[key] = checkStringList(key, raw[key], errors, { each: (item) => (re.test(item) ? '' : `not ${what} in lower case.`) });
  };
  nameList('blockedTables', TABLE_RE, 'a table name');
  nameList('blockedFields', FIELD_RE, 'a column name');
  nameList('sensitiveTablePrefixes', PREFIX_RE, 'a table-name prefix (letters, digits, _; at least 2 characters)');
  if (has('disabledFeatures')) {
    policy.disabledFeatures = checkStringList('disabledFeatures', raw.disabledFeatures, errors, {
      each: (item) => (FEATURE_IDS.has(item) ? '' : 'not a feature id (the list is in docs/deployment.md, "Feature ids").'),
    });
  }

  const wordList = (key, allowed) => {
    if (has(key)) policy[key] = checkStringList(key, raw[key], errors, { each: (item) => (allowed.includes(item) ? '' : `not one of ${allowed.join(', ')} (lower case).`) });
  };
  wordList('disabledSections', HIDEABLE_SCREENS);
  wordList('allowedProfiles', PROFILE_IDS);
  wordList('lockedProfiles', PROFILE_IDS);
  if (has('internalPhrases')) policy.internalPhrases = checkStringList('internalPhrases', raw.internalPhrases, errors, { max: 200 });
  if (has('orgSnippets')) {
    if (!Array.isArray(raw.orgSnippets)) errors.push('orgSnippets must be a list of { "title", "body" } objects.');
    else {
      raw.orgSnippets.forEach((item, i) => {
        if (!isPlainObject(item) || typeof item.title !== 'string' || !item.title.trim() || typeof item.body !== 'string' || !item.body.trim()) errors.push(`orgSnippets[${i}] needs a text "title" and a text "body".`);
        else if (Object.keys(item).some((k) => !['title', 'body', 'shortcut'].includes(k))) errors.push(`orgSnippets[${i}] may only have title, body and shortcut.`);
      });
      if (raw.orgSnippets.length > 200) errors.push(`orgSnippets has ${raw.orgSnippets.length} entries; at most 200 are allowed.`);
      if (!errors.some((e) => e.startsWith('orgSnippets'))) policy.orgSnippets = raw.orgSnippets.map((s) => ({ ...s }));
    }
  }
  if (has('orgFormats')) {
    if (!Array.isArray(raw.orgFormats)) errors.push('orgFormats must be a list of { "feature", ... } objects.');
    else {
      const seen = new Set();
      raw.orgFormats.forEach((item, i) => {
        const id = isPlainObject(item) && typeof item.feature === 'string' ? item.feature.trim().toLowerCase() : '';
        if (!id) errors.push(`orgFormats[${i}] needs a text "feature" (the id of an AI action).`);
        else if (!specOf(id)) errors.push(`orgFormats[${i}]: "${id}" is not an AI action whose format can be changed.`);
        else if (seen.has(id)) errors.push(`orgFormats[${i}]: "${id}" is listed twice.`);
        else if (Object.keys(item).some((k) => !['feature', 'sections', 'style', 'words', 'extra', 'locked'].includes(k))) errors.push(`orgFormats[${i}] may only have feature, sections, style, words, extra and locked.`);
        else if (!normalizeFormat(item, id)) errors.push(`orgFormats[${i}]: "${id}" has nothing that changes the action's format.`);
        else seen.add(id);
      });
      if (raw.orgFormats.length > FORMAT_LIMITS.orgCount) errors.push(`orgFormats has ${raw.orgFormats.length} entries; at most ${FORMAT_LIMITS.orgCount} are allowed.`);
      if (!errors.some((e) => e.startsWith('orgFormats'))) policy.orgFormats = raw.orgFormats.map((f) => JSON.parse(JSON.stringify(f)));
    }
  }
  if (has('priorityAccounts')) {
    const { count, length } = PRIORITY_ACCOUNT_LIMITS;
    policy.priorityAccounts = checkStringList('priorityAccounts', raw.priorityAccounts, errors, { max: count, each: (item) => (item.length > length ? `longer than ${length} characters.` : '') });
  }
  if (has('defaultDashboard')) {
    const problems = dashboardConfigProblems(raw.defaultDashboard);
    problems.forEach((p) => errors.push(`defaultDashboard: ${p}`));
    if (!problems.length) policy.defaultDashboard = JSON.parse(JSON.stringify(raw.defaultDashboard));
  }

  for (const key of ['allowHrContent', 'auditExport', 'coachingEnabled', 'disablePageBar', 'aiEnabled']) {
    if (!has(key)) continue;
    if (typeof raw[key] !== 'boolean') errors.push(`${key} must be true or false (not ${shown(raw[key])}).`);
    else policy[key] = raw[key];
  }
  if (has('tokenBudgetPerDay')) {
    const n = raw.tokenBudgetPerDay;
    if (!(typeof n === 'number' && Number.isInteger(n) && n >= 0)) errors.push(`tokenBudgetPerDay must be a whole number of 0 or more (not ${shown(n)}).`);
    else policy.tokenBudgetPerDay = n;
  }

  let label = '';
  if (has('label')) {
    if (typeof raw.label !== 'string' || !LABEL_RE.test(raw.label)) errors.push('label must be 1 to 40 letters, digits, spaces or . _ ( ) -, starting with a letter or digit.');
    else label = raw.label;
  }
  let updateUrl = '';
  if (has('updateUrl')) {
    let url;
    try {
      url = typeof raw.updateUrl === 'string' && !/\s/.test(raw.updateUrl) ? new URL(raw.updateUrl) : null;
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.hash) errors.push('updateUrl must be the https address of your update manifest (no user name, password or #fragment).');
    else updateUrl = url.href;
  }

  // A policy key added to POLICY_KEYS later but not checked above would otherwise be dropped from the build without a word.
  for (const key of POLICY_KEYS) if (key !== 'providedApiKey' && has(key) && policy[key] === undefined && !errors.some((e) => e.includes(key))) errors.push(`${key} is not supported in an enterprise config yet.`);
  if (errors.length) return { ok: false, errors, plan: null };

  // Keys in the order of POLICY_KEYS, so the compiled-in text is the same for the same config whatever order it was written in.
  const ordered = {};
  for (const key of POLICY_KEYS) if (policy[key] !== undefined) ordered[key] = policy[key];
  const instances = [...policy.allowedInstances];
  // Exactly the strings the extension asks the browser about (instancePattern, aiOriginPattern), so permissions.contains finds them.
  const hostPermissions = [...new Set([...instances.map(instancePattern), ai.pattern])];
  return {
    ok: true,
    errors: [],
    plan: { label, updateUrl, policy: ordered, instances, ai, hostPermissions, connectSrc: [ai.origin] },
  };
}

/** The extension-page CSP with its connect-src replaced by exactly these origins. Throws when the CSP has no connect-src. */
export function cspWithConnectSrc(csp, origins) {
  const directives = String(csp).split(';').map((d) => d.trim()).filter(Boolean);
  const at = directives.findIndex((d) => /^connect-src(\s|$)/.test(d));
  if (at < 0) throw new Error('The manifest CSP has no connect-src directive to narrow.');
  directives[at] = `connect-src ${origins.join(' ')}`;
  return directives.join('; ');
}

/**
 * The enterprise manifest from the normal one: host access is granted for exactly the configured hosts (host_permissions, in place
 * of the optional wildcard), connect-src names only the AI origin, and nothing else changes (same permissions, same CSP otherwise).
 */
export function enterpriseManifest(base, plan) {
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    if (key === 'optional_host_permissions') out.host_permissions = [...plan.hostPermissions];
    else if (key === 'content_security_policy') out[key] = { ...value, extension_pages: cspWithConnectSrc(value.extension_pages, plan.connectSrc) };
    else out[key] = JSON.parse(JSON.stringify(value));
    if (key === 'version' && plan.label) out.version_name = `${base.version} ${plan.label}`;
  }
  if (!out.host_permissions) out.host_permissions = [...plan.hostPermissions];
  if (plan.updateUrl) out.update_url = plan.updateUrl;
  return out;
}

/** The text that replaces src/policy/baked.js in an enterprise build. Same config, same text. */
export function bakedModuleSource(policy, label = '') {
  return [
    '// Generated by build.js --enterprise. Do not edit: change the config file and build again.',
    `// The organisation policy compiled into this build${label ? ` (${label.replace(/[^\w .()-]/g, '')})` : ''}. src/policy/policy.js uses it as a floor`,
    '// under the browser\'s managed policy, which can only make it stricter.',
    `export const BAKED_POLICY = ${JSON.stringify(policy, null, 2)};`,
    '',
  ].join('\n');
}
