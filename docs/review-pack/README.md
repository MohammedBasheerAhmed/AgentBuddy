# Agent Buddy: review pack

For the security team and the data protection officer. Everything here can be checked against the source in this repository; nothing
needs a network connection except `npm ci` (to fetch the pinned packages) and `npm audit`.

| File | What it is |
|---|---|
| `../security.md` | Permissions, controls (each with the test that enforces it), known limits, threat summary. **Read this first.** |
| `data-flow.svg` | Where data goes: the ServiceNow tab, the extension, the instance, the AI endpoint, the organisation's policy |
| `stride.md` | Threats by STRIDE category: component, control, test, residual risk, owner role |
| `traceability.md` | Every control and threat with its test files and whether they exist (generated: `npm run traceability`) |
| `dpia-template.md` | Data protection impact assessment, filled in for what the extension does; your parts are marked [to fill] |
| `policies/` | Managed-policy samples for Chrome and Edge: Windows `.reg`, macOS `.mobileconfig`, Linux `.json`, Google Admin console `.json`, and `recommended-policy.json` (the same locked-down values as a plain object) |
| `policies-firefox/` | Managed-policy samples for Firefox, with the same recommended values: `firefox-policies.json` (any system), `firefox-windows.reg`, `firefox-macos.mobileconfig`. They install the add-on and set its policy; where each goes is in `../deployment.md`, section "Firefox" |
| `sbom.cdx.json` | Software bill of materials, CycloneDX 1.5, from `package-lock.json` (`npm run sbom`) |
| `../deployment.md` | Every policy key, the recommended profile, the enterprise build, installing for everyone; Firefox in its own section |

Agent Buddy runs in Chrome and Edge (one package) and Firefox 128 or later (its own package, new on 2026-11-06 and not yet checked on a
real instance). Safari is not supported. What differs in Firefox, and why it matters for the review: `../security.md` section 3A.

## 1. Build from source

Needs Node.js 22.12 or later (`.nvmrc`; CI uses it) and npm.

```
npm ci                      # exactly the versions in package-lock.json, checked against their integrity hashes
npm run build               # dist/: the extension for Chrome and Edge
npm run build:firefox       # dist-firefox/: the same extension for Firefox (node build.js --browser firefox)
npm run build:enterprise -- enterprise/<your config>.json   # dist-enterprise/: your hosts and policy compiled in
node build.js --browser firefox --enterprise enterprise/<your config>.json   # dist-firefox-enterprise/: the same, for Firefox
```

`build.js` is short; read it. It bundles six entry points with esbuild (no minification, no source maps, no remote code) and copies the
manifest, the policy schema, three HTML pages, the icons, one stylesheet and the licence file of every package bundled into the code
(`licenses/<package>/LICENSE`: React, ReactDOM, scheduler). Nothing is downloaded during the build. The Firefox build bundles the same
entry points for Firefox 128 and writes a manifest made from `manifest.json` by `scripts/lib/browsers.js`; every difference is listed in
`../security.md` section 3A and pinned by `tests/manifest-firefox.test.js`. `package-lock.json` also lists the
test tools (esbuild, puppeteer-core and what they need): they build and test the extension and are not part of it (the SBOM marks them
`excluded`).

## 2. Check that a build is the one you reviewed

- `npm run repro` builds twice into fresh temporary folders, from two different working folders, and compares every file byte for
  byte. It prints the SHA-256 of each file in `sha256sum` format (`npm run repro -- --write SHA256SUMS` saves it).
  `npm run repro -- --browser firefox` does the same for the Firefox build. The two builds have different bytes (another manifest,
  another compile target), so keep a list for each.
- `node scripts/hashes.js <folder> --check SHA256SUMS` compares a folder (for example the unpacked extension you were given, or your
  own `dist/`) with such a list. On Linux or macOS `sha256sum -c SHA256SUMS` does the same from inside the folder.
- The same source, lockfile and esbuild version give the same bytes on Windows, macOS and Linux: text files are written with Unix line
  endings and esbuild's path comments are relative to the project folder.
- A packed `.crx` adds a signature around these files; compare the unpacked contents. A Firefox `.xpi` signed by Mozilla adds its
  signature files inside the package (`META-INF/`); compare the other files.

## 3. Run the tests

```
npm test            # every unit test (node:test); no browser, no network
npm run check       # every entry point compiles
npm run traceability:check       # every test file named in the review documents exists, and traceability.md is current
npm run verify      # all of the above, and every text has its Arabic entry
npm run e2e         # optional: real Chrome against a fake ServiceNow and a stub AI (puppeteer-core comes with npm ci; see README)
npm run e2e:firefox # optional: the Firefox build in real Firefox (e2e/firefox/)
```

`npm run check` compiles every entry point twice: for Chrome and Edge 116 and for Firefox 128.

## 4. What to look at first

1. `manifest.json` and `tests/manifest.test.js`: the permissions and the extension-page CSP, as a snapshot that fails on any change.
2. `tests/readonly.test.js`: no writes to ServiceNow; only the provider layer and the content script's GET client make requests.
3. `tests/seal.test.js` and `src/pii/`: nothing reaches the AI without the PII firewall.
4. `src/policy/policy.js`: how the organisation's policy is read and combined (users can tighten, never loosen); `tests/policy*.test.js`.
5. `docs/security.md` section 5: the known limits, stated plainly.
6. For Firefox: `src/lib/senderCheck.js` with `src/lib/platform.js` (who may send the extension a message, in every browser;
   `tests/senderCheck-content.test.js`, `tests/platform.test.js`) and `scripts/lib/browsers.js` (the Firefox manifest;
   `tests/manifest-firefox.test.js`). These are the only places the browsers differ.

## 5. Dependencies

- `sbom.cdx.json` lists every package of the lockfile. Three are inside the extension (`agentbuddy:bundled` = true): React, React DOM
  and scheduler. esbuild is a build tool only (scope `excluded`).
- `npm audit --omit=dev` checks what ships; `npm audit` also checks the build tools. At the time of writing the only finding is a
  moderate advisory for esbuild's development server (GHSA-67mh-4wv8-2f99), which this project does not use (`build.js` never calls
  `serve`).
- Versions are exact in `package.json` and pinned with integrity hashes in `package-lock.json`. `npm run sbom -- --out <file>`
  regenerates the SBOM; a test fails when the committed one is out of date.

## 6. Policy samples

Replace `EXTENSION_ID` with the id of your build (shown on the browser's extensions page) and the example addresses with yours. Check a
file before deploying it:

```
node scripts/check-policy.js docs/review-pack/policies/chrome-windows.reg
```

It prints every key Agent Buddy would ignore or read differently from how it is written, and the policy as Agent Buddy will read it.
After deploying, the browser's policy page (`chrome://policy`, `edge://policy`) shows each Agent Buddy key with its status; a value
that does not match `managed_schema.json` is rejected there and has no effect. Where these formats and paths come from, and what was
not verified on a managed device, is in `docs/deployment.md`.

Firefox (`policies-firefox/`) is different: it does not support `managed_schema.json`, so the browser checks no value's type and
Agent Buddy's own reading of the policy (`src/policy/policy.js`) is the only check. A registry REG_DWORD or a macOS `<true/>` would
reach Agent Buddy as 1 or 0, which it reads as "not set", so the `.reg` file and the profile carry the policy as one JSON text. A change
takes effect after Firefox restarts; `about:policies` shows what Firefox read. `scripts/check-policy.js` does not read the Firefox
files yet; `tests/selfhost-firefox.test.js` checks that each one reads back to the recommended policy. Details: `docs/deployment.md`,
section "Firefox".

## 7. Still open

- Results of a test run on a real ServiceNow instance as a non-admin user (`docs/live-questions/`).
- The policy samples were checked by `scripts/check-policy.js` and the tests, not yet on a managed Windows, macOS, Linux or ChromeOS
  device; the Firefox samples by the tests only, not yet on a managed computer.
- Firefox (new): its checks on a real instance (`docs/live-questions/firefox.md`), whether it closes storage to content scripts
  (`docs/security.md` limit 17), and what to declare in `data_collection_permissions` before a listing on addons.mozilla.org.
- Edge: the same package as Chrome; its checks on a real instance are gathered in `docs/live-questions/edge.md`.
