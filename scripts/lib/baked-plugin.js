// The esbuild plugin of the enterprise build: while bundling, the contents of src/policy/baked.js are replaced by the policy from the
// enterprise config (the text comes from src/policy/enterprise.js bakedModuleSource). Shared by build.js and
// tests/policy-enterprise.test.js, so the test bundles with exactly what the build uses.
function bakedPolicyPlugin(source, filter) {
  if (typeof source !== 'string' || !/export const BAKED_POLICY = \{/.test(source)) throw new Error('bakedPolicyPlugin: the source must export a BAKED_POLICY object.');
  return {
    name: 'agentbuddy-baked-policy',
    setup(build) {
      build.onLoad({ filter }, () => ({ contents: source, loader: 'js' }));
    },
  };
}

module.exports = { bakedPolicyPlugin };
