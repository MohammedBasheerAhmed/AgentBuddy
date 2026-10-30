// Check a managed-policy file before it is deployed: every key Agent Buddy would ignore, read differently, or that would stop it
// working, with the policy as Agent Buddy will read it. Uses the extension's own code (src/policy/policy.js).
//
//   node scripts/check-policy.js <file> [<file> ...]
//
// Files: a Windows .reg, a macOS .mobileconfig or .plist, a Linux managed-policy .json ({"3rdparty": ...}), the Google Admin console
// JSON ({"key": {"Value": ...}}) or a plain JSON object of policy keys. Exit code 1 when any file has an error.
const fs = require('fs');
const path = require('path');
const { loadEsm } = require('./lib/load-esm.js');
const { readPolicyFile } = require('./lib/policy-files.js');

const root = path.join(__dirname, '..');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/check-policy.js <policy file> [<policy file> ...]');
  process.exit(1);
}

const { normalizePolicy, policyProblems } = loadEsm(root, 'src/policy/policy.js');
// The provider ids this version knows, so a misspelt aiProvider or allowedProviders entry is reported.
const providers = Object.keys(loadEsm(root, 'src/providers/config.js').PROVIDERS);
const schema = JSON.parse(fs.readFileSync(path.join(root, 'managed_schema.json'), 'utf8'));

let failed = false;
for (const file of files) {
  let found;
  try {
    found = readPolicyFile(file, fs.readFileSync(file, 'utf8'), schema);
  } catch (err) {
    console.log(`${file}\n  ERROR  ${err.message}`);
    failed = true;
    continue;
  }
  if (!found.length) {
    console.log(`${file}\n  ERROR  no Agent Buddy policy found (3rdparty\\extensions\\<id>\\policy, com.google.Chrome.extensions.<id>, ...).`);
    failed = true;
    continue;
  }
  for (const { browser, extensionId, policy, browserPolicy } of found) {
    console.log(`${file}${browser ? ` (${browser}${extensionId ? `, extension ${extensionId}` : ''})` : ''}`);
    const problems = policyProblems(policy, { providers });
    const forced = browserPolicy?.ExtensionInstallForcelist;
    if (Array.isArray(forced) && extensionId && !forced.some((entry) => String(entry).split(';')[0] === extensionId)) {
      problems.push({ level: 'error', message: `ExtensionInstallForcelist does not install ${extensionId}, the extension this policy is for.` });
    }
    for (const p of problems) console.log(`  ${p.level === 'error' ? 'ERROR' : 'note '}  ${p.message}`);
    if (problems.some((p) => p.level === 'error')) failed = true;
    if (!problems.length) console.log('  ok     every key is understood as written');
    const read = normalizePolicy(policy);
    const shown = Object.entries(read)
      .filter(([k, v]) => k !== 'providedApiKey' && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`);
    console.log(`  Agent Buddy reads it as:\n${shown.join('\n')}${read.providedApiKey ? '\n    providedApiKey: (set, not shown)' : ''}`);
  }
}
process.exit(failed ? 1 : 0);
