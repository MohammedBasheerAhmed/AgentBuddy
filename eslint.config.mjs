// ESLint (npm run lint; also part of npm run verify and CI). Small on purpose: the recommended rules, the two rules of React hooks,
// and a few rules for mistakes this code base has actually made. The security rules in docs/build-rules.md that a test already
// enforces (no innerHTML, no eval, GET only, no seal in views...) stay in those tests; rule 2 is also here, where an editor shows it.
//
// - no-shadow (src): a name that hides another of the same name in an outer scope. The custom report editor once named its state
//   `shown`, which hid the shown() function every label of that view calls, and it threw as it opened. Loop variables named `t`
//   hide the text function t() the same way.
// - no-await-in-loop (src): reads one after another where they could run together. Where the order is the point (a page of results
//   needs the one before, a lock, a sequence the person sees), the line says why in an eslint-disable comment.
// - react-hooks/exhaustive-deps: an effect that reads a value it does not list runs with a stale copy of it. Where that is the point
//   (an effect that must run once per record, not on every poll), the line says why.
// Tests and e2e steps are sequential and short-lived on purpose: the two src-only rules are off there.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// The views: they send to the AI only through useRun() / <RunPanel> (src/sidepanel/useRun.js) and never touch the seal.
const VIEWS = ['src/sidepanel/**', 'src/options/**', 'src/dashboard/**', 'src/formats/**/*.jsx'];

export default [
  { ignores: ['dist/**', 'dist-enterprise/**', 'dist-firefox/**', 'dist-firefox-enterprise/**', 'release/**', 'selfhost/**', 'node_modules/**', '.test-dist*/**', '.build-tmp*/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
    rules: { 'no-shadow': 'error', 'no-await-in-loop': 'error' },
  },
  { files: ['src/background/**'], languageOptions: { globals: { ...globals.serviceworker, chrome: 'readonly' } } },
  // The page bridge runs in the page's own world as a classic script (an IIFE), not a module.
  { files: ['src/page/bridge.js'], languageOptions: { sourceType: 'script' } },
  // Node scripts. The e2e steps also hold functions that puppeteer runs inside the browser (document, window, chrome).
  {
    files: ['build.js', 'scripts/**', 'e2e/**', 'tests/run.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } },
  },
  // The e2e data and dot-walk helpers are ES modules: the harness bundles them with the source they test (e2e/run.js).
  { files: ['e2e/data.entry.js', 'e2e/data.more.js', 'e2e/dotwalk.js'], languageOptions: { sourceType: 'module' } },
  { files: ['tests/**'], ignores: ['tests/run.js'], languageOptions: { globals: { ...globals.node, ...globals.browser, chrome: 'readonly' } } },
  {
    files: VIEWS,
    ignores: ['src/sidepanel/useRun.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/providers/index.js', '**/providers/openai.js', '**/providers/anthropic.js', '**/providers/messages.js'],
              message: 'Views send to the AI only through useRun() / <RunPanel> (docs/build-rules.md rule 2).',
            },
            { group: ['**/pii/seal.js'], message: 'Views never touch the seal (docs/build-rules.md rule 2).' },
          ],
        },
      ],
    },
  },
];
