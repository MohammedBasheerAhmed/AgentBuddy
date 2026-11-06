# Agent Buddy

A privacy-first browser extension that helps ServiceNow **fulfillers** (IT, customer service, HR cases, catalog) and their
**team leads** work tickets faster. No admin role needed. It works on the classic UI, on Workspaces and on portals (Service Portal,
Employee Center, customer service and HR portals).

What it does (the side panel has five screens, chosen from an icon dock at the bottom: Ticket, My work, Team, Write, Knowledge):

- **Quick actions**: a short bar of the 3 or 4 main actions for the open ticket, at the top of the side panel and as a small icon dock at the
  bottom centre of the ServiceNow page itself (hover an icon for its name; a click opens the panel and starts the action there). You
  choose which actions it holds; an organisation can switch the on-page dock off.
- **Understand a ticket**: summary, hand-off brief, missing information, sentiment and escalation risk, next-best action, thread
  summary, routing hint, request explainer, resolution check, fulfilment checklist. No AI needed for the checks and lists.
- **Answer formats**: choose how the summary, the hand-off brief and the discussion catch-up are laid out (the sections you name, a style
  and a length), and add a few lines of extra instructions to any of 20 AI actions, in Settings or under the action in the panel. An
  organisation can publish or lock a format by policy. The rules about facts, privacy and customers always stay on.
- **Domain packs**: major-incident updates, problem statement / RCA, change / CAB brief, account briefing, case-to-engineering
  escalation, HR case brief (Strict privacy mode, policy-gated).
- **Write**: customer reply drafts, six email types, rewrite (shorter, friendlier, plain, formal, fix spelling, translate, bilingual),
  notes to a new ticket, personal snippets, a safe-to-send check before text goes to a customer.
- **Knowledge**: article from a ticket, article checks and optimise, duplicate finder with a merge draft, knowledge-gap radar, chat
  summary and chat reply suggestions.
- **My work and Team**: your queue most urgent first; team dashboards (overview, SLA radar, fulfilment, workload, quality), a report
  builder, saved dashboards, CSV export with names masked, a full-page view, shift hand-over, "explain this dashboard", and an
  opt-in coaching snapshot (off unless the organisation switches it on).
- Works with any AI key: Azure OpenAI, OpenAI or a company gateway, Anthropic, Gemini, Mistral, Groq, DeepSeek, OpenRouter, or a
  model on your own computer (Ollama). An organisation can pin the provider, address, models and key storage by policy.
- Personal data is masked before any AI call (the record's people, plus names the words around them mark in the text); you see
  exactly what is sent and can mask more in the preview. Passwords, card and ID numbers never come back into an answer. Nothing is
  ever written to ServiceNow by the extension: "Insert" fills a field on the open form and you press Save.

Details: `docs/plan.md` (the approved plan and use-case catalogue), `docs/security.md` (controls, limits, threat model),
`docs/deployment.md` (managed policy, feature ids, enterprise build), `docs/review-pack/` (for the security review: reviewer guide,
data flow, STRIDE, DPIA template, policy samples, SBOM, traceability), `docs/contracts.md` (module contracts), `docs/build-rules.md` (the rules every
change follows), `docs/live-questions/` (what must be checked on a real instance), `docs/review/` (the independent reviews),
`TRACKER.md` (the live plan: the status of every item and where to pick up; `PROGRESS.md` is the earlier log).

## Browsers

- **Chrome and Edge**: `dist/`, one build for both. The panel is the browser's side panel.
- **Firefox 128 or later**: `dist-firefox/`. The panel is Firefox's sidebar. New (2026-11-06) and not yet checked on a real instance
  (`docs/live-questions/firefox.md`). Firefox does not let a click on the page's dock open the sidebar: the dock asks you to click the
  toolbar button, and the action starts if the panel opens within 30 seconds.
- **Safari**: planned, not supported yet.

How the browsers differ is in one module, `src/lib/platform.js`; the Firefox manifest is made from `manifest.json` by
`scripts/lib/browsers.js`. Install and policy for Firefox: `docs/deployment.md`, section "Firefox".

## Build and run

Needs Node.js 22.12 or later (`.nvmrc` says 22; `engines` in `package.json`) and npm.

```
npm ci               # exactly the versions in package-lock.json (not `npm install`, which may rewrite the lockfile)
npm run build        # writes dist/ (Chrome and Edge)
npm run build:firefox  # writes dist-firefox/ (node build.js --browser firefox)
npm test             # unit tests (node tests/run.js <part of a file name> runs only those files)
npm run check        # compiles every build entry for Chrome and Edge and for Firefox, without writing anything; a warning fails it
npm run lint         # ESLint (eslint.config.mjs says why each rule is on); npm run lint:fix applies the safe fixes
npm run verify       # before a commit: lint, unit tests, compile check, traceability check, Arabic check (stops at the first failure)
npm run e2e          # rebuilds dist/, then real Chrome against a fake ServiceNow and a stub AI server (see "End-to-end" below)
npm run e2e:firefox  # the Firefox build in real Firefox (e2e/firefox/)

npm run watch        # rebuild dist/ on every change (the static files too; node build.js --browser firefox --watch for Firefox)
npm run build:enterprise -- enterprise/example.json   # dist-enterprise/: one organisation's hosts and policy compiled in
npm run package      # builds both, then release/agentbuddy-<version>.zip (Chrome and Edge) and agentbuddy-<version>-firefox.zip
npm run package -- --minify   # the release: the same two zips minified (built in release/unpacked/ and release/unpacked-firefox/)
                              # and a readable zip of the Chrome and Edge build; -- --browser firefox makes only the Firefox zip
npm run repro        # builds twice from two folders and compares SHA-256 of every file (-- --minify, -- --browser firefox)
npm run sbom         # CycloneDX 1.5 SBOM from package-lock.json, no network
npm run traceability # control-to-test matrix (docs/review-pack/traceability.md); npm run traceability:check verifies it
npm run i18n         # every text a person reads has an Arabic entry
```

Load `dist/` at `chrome://extensions` (Developer mode, Load unpacked), click the Agent Buddy toolbar button to open the side panel,
then "Turn on for this site" on your ServiceNow tab and add an AI key in Settings.

Firefox, for testing: open `about:debugging`, then This Firefox, Load Temporary Add-on, and choose `dist-firefox/manifest.json`. It
stays until Firefox closes. If the Agent Buddy button is not on the toolbar, pin it from the Extensions button (the puzzle piece). The
button opens the sidebar; then the same steps as above.

### End-to-end

`npm run e2e` (or `node e2e/run.js a,c,g` for some scenarios, on a build that is already there) drives a real Chrome with the built
extension. It needs:

- `puppeteer-core`, a pinned devDependency: `npm ci` installs it. It drives a Chrome that is already installed and downloads none.
- Chrome: `CHROME_PATH` is its executable (default `C:/Program Files/Google/Chrome/Application/chrome.exe`; on Linux, for example
  `/usr/bin/google-chrome`).
- A TLS certificate for the fake ServiceNow at https://localhost, made for each run: by `openssl` on the PATH or the one that comes
  with Git for Windows; with neither, `npm i --no-save selfsigned` once. Chrome is started with `--ignore-certificate-errors`.
- Optional: `E2E_DIST=<folder>` tests a build in another folder (for example the minified one: `node build.js --minify --out
  .build-tmp-min`); `AB_E2E_TMP=<folder>` keeps the run's screenshots there (default: a new folder in the system temp folder, printed
  at the start); `E2E_HEADED=1` shows the browser.

`npm run e2e:firefox` (or `node e2e/firefox/run.js` on a Firefox build that is already there) does the same for the Firefox build,
with a smaller set of checks (install, turn on, the page bridge, the panel, Summarise with masking, the dock, Settings, storage,
network). It needs a Firefox: `FIREFOX_PATH` (default: the one in puppeteer's cache, put there by
`node node_modules/@puppeteer/browsers/lib/main-cli.js install firefox@stable`). Port 443 on this computer must be free: Firefox's
match patterns ignore ports, so the fake ServiceNow is reached at `https://localhost` itself. Optional: `E2E_FIREFOX_DIST`,
`AB_E2E_TMP`, `E2E_HEADED=1`.

## Layout

```
src/background   service worker (registers content scripts only on enabled instances; in Firefox the same file runs as an event page)
src/lib          shared helpers; platform.js is the only code that knows how browsers differ (side panel or sidebar, the toolbar
                 button, the address of the extension's own pages); senderCheck.js says who may send the extension a message
src/content      content script: record detection, GET-only reads (ops/), policy guard, fill one field, the icon dock on the page (bar.js)
src/page         page-world bridge (reads form identity/values; fills one field on classic, Workspace and portal pages; no save)
src/context      what a feature may know about a record (field allowlists, specs per kind, journal, history, similar, KB, related)
src/pii          the PII firewall: detect, mask, seal, rehydrate (only place that may import the seal)
src/safeSend     check text before it goes to a customer (one implementation)
src/providers    AI provider adapters (only accept firewall-sealed requests)
src/policy       managed policy rules; the baked-in floor of the enterprise build (baked.js)
src/features     feature registry and packs (core, itsm, domain, knowledge, compose, reports, checks)
src/prompts      shared prompt rules (untrusted data, language, customer-safe); each feature keeps its own fixed prompt
src/formats      answer formats: the sections, style, length and extra instructions a person or the organisation chose, and the editor
src/itsm src/domain src/knowledge src/chat src/compose src/checks   deterministic parts of each area
src/reports      report engine (injected deps, cache, limiter), AI hand-over / coaching / insights
src/dashboard    the full-page dashboard         src/render     safe plain-text renderer for model output
src/snippets     canned replies with variables   src/audit      no-content audit log
src/sidepanel    the side panel UI (sections, tabs, quick-actions bar, charts, compose, knowledge, checks)
src/options      the settings page               src/ui         shared styles (tokens --ab-*) per area
e2e              end-to-end harness: leak detector, request-log checks, scenarios a-z
docs             security, deployment, contracts, build rules, live questions, reviews, review pack
enterprise       example config for the enterprise build
scripts          compile check, SBOM, repro, hashes, policy check, traceability, Arabic check, release package, self-hosted install
                 (scripts/lib/entries.js: the build's entry points and esbuild options, shared by build.js and the scripts;
                 scripts/lib/browsers.js: the browser families, their build folders and the Firefox manifest)
```
