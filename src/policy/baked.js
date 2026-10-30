// The organisation policy compiled into an ENTERPRISE build (`node build.js --enterprise enterprise/<name>.json`). In the normal
// build, in the tests and in scripts/check-compile.js this file is used as it is: no compiled-in policy, so only the browser's
// managed policy (chrome.storage.managed) applies.
//
// The enterprise build replaces this file's contents while bundling (build.js, plugin `agentbuddy-baked-policy`, source text from
// src/policy/enterprise.js bakedModuleSource) with the validated policy from the config file. src/policy/policy.js then uses it as a
// floor: the managed policy can make every setting stricter, never looser (mergePolicies).
export const BAKED_POLICY = null;
