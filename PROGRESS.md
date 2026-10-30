# Agent Buddy: progress

Plan: `C:\Users\bashe\.claude\plans\we-need-to-create-stateful-dawn.md` (approved 2026-10-26). Contracts between modules: `docs/contracts.md`.
Rules every change follows: `docs/build-rules.md`.

## RESUME HERE (2026-10-30): second round, "improve it to the core", security approval

Asked: every function working, nothing a security team would refuse. Done by seven parallel engineers with fixed file ownership
(`docs/build-rules.md`), then integrated and checked end to end by the lead. NOT committed yet.

| Check (2026-10-30) | Result |
|---|---|
| `node tests/run.js` (unit) | **2291 pass, 0 fail** (was 1914) |
| `E2E_HEADED=1 node e2e/run.js` (visible desktop Chrome) | 890 pass; the 2 fails were harness-only and are fixed or pass alone (a hidden window stops repainting; a visible scrollbar). A click on the page bar opened Chrome's real side panel. |
| `node scripts/check-compile.js` | all ok |
| `npm run e2e` (real Chrome, fake ServiceNow, stub AI; scenarios a-z) | **894 pass, 0 fail, 0 warnings** (was 889 pass, 2 warnings; both warnings were unmasked names, now masked) |
| `npm run traceability -- --check` | 53 controls and threats, every named test exists |

What changed (details in `docs/security.md`, `docs/contracts.md` "Additions from the second round", the reports below):

- **Security approval.** Second independent audit, `docs/review/security-audit-2.md` (no Critical/High; 3 Medium fixed: a turned-off
  site kept working in open tabs, the switched-off bar still looked at the page, `chrome.storage.local` open to content scripts).
  Review pack `docs/review-pack/`: reviewer guide, data-flow diagram, STRIDE (26 threats with owners), DPIA template, Chrome/Edge
  policy samples (Windows, macOS, Linux, Admin console), CycloneDX SBOM, control-to-test traceability. **Enterprise build**
  (`npm run build:enterprise -- enterprise/<cfg>.json`): exact host permissions and `connect-src`, policy compiled in as a floor.
  Reproducible build (`npm run repro`), exact dependency pins, `npm audit --omit=dev` clean.
- **Personal data.** Names inside sentences are now masked when the words around them mark a name (salutations, sign-offs, Dr/Mr,
  "manager is", "spoke with", cc, @mentions; Strict also masks capitalised full names). "Mask this too" in the preview. Masked CSV
  finds names in titles. Passwords, card and ID numbers are never put back into answers (a notice says so). Both old e2e warnings gone.
- **AI key.** Moved out of `chrome.storage.local` into an IndexedDB vault content scripts cannot open; PBKDF2 600k; policy key
  storage enforced on keys saved earlier. Provider calls: time limits, bounded retries, cancel, no redirects, no cookies, plain errors.
  **Azure OpenAI** is a provider (v1 and classic api-version forms, `api-key` header).
- **Policy.** `allowedProviders`; organisation key only with a pinned provider; preview and privacy modes are floors; wildcard
  instance addresses refused; `aiBaseUrl` compared canonically; unknown keys reported.
- **Features.** Every feature walked; 9 bugs fixed (duplicate finder matched CIs by display name, "Missing:" line inserted into the
  customer comment, close-code line in close notes, snippet {{priority}}, consumer callers, UTC vs local times in email suggestions,
  ...). Prompts rewritten around shared rules (`src/prompts/rules.js`) with a contract test per parser. `kb_use` column detected.
- **Side panel.** First-run steps, "Open Settings" and "Try again" everywhere, record tabs keep their state, per-tab error
  boundaries, focus and screen-reader fixes, stale/race bugs fixed (7, each with a test), a DOM harness that drives real views.
- **Team reports.** No restart on navigation, real links on charts, 14 bugs (summer time, business-time SLA, paused SLAs, "cannot see"
  shown as 0, cache races, policy guard bypass in reports), one "as of" per load, per-widget error boundary.

## Round 1 state (2026-10-27 to 2026-10-29)

**Everything in the plan is built (waves 1, 2 and 3), plus portals and reports/dashboards (asked for later). Next step is a person
testing it on a real instance and improving it.** Nothing here has run against a real ServiceNow instance or a real AI model yet; the
fake instance and stub AI server in `e2e/` stand in for them.

Verified by me on 2026-10-29 (the quick-actions work below is NOT committed yet; the rest was committed locally on 2026-10-27, never pushed):

| Check | Result |
|---|---|
| `node tests/run.js` (unit) | **1914 pass, 0 fail** |
| `node scripts/check-compile.js` (every build entry compiles) | all ok |
| `npm run e2e` (real Chrome, fake ServiceNow, stub AI; scenarios a-z) | **889 pass, 0 fail, 2 warnings** (about 145 s) |
| `node build.js` | `dist/` builds |

The two e2e warnings are documented limits: a person named only inside a sentence ("manager is María-José O'Neil") reaches the AI
(the preview shows it), and the masked CSV still shows a person named inside a ticket title (the panel says so next to the Mask switch).

### What is in it

- Side panel with five sections: **This page**, **My day**, **Team**, **Write**, **Knowledge**. Works on the classic UI, Workspaces and
  portals (Service Portal, Employee Center, customer service and HR portals). Options page for settings; full-page dashboard.
- Around 40 AI features in seven packs (`src/features/packs/`): record summary, reply draft, resolution notes, hand-off brief, missing
  info, sentiment and risk, next-best action, thread summary, routing hint, KB article draft, major-incident comms, HR case brief
  (Strict), account briefing, case-to-engineering escalation, problem RCA, change/CAB brief, article optimise, KB merge draft, KB gap
  outline, chat summary and reply, six email types, seven rewrite modes, notes-to-ticket, request explainer, resolution improve,
  fulfilment checklist, shift hand-over, coaching snapshot (off by default, Strict, policy-gated), dashboard insights.
- Deterministic tools that need no AI: Related tab, My day, Check tab (resolution quality gate), Request tab, article checks,
  duplicate finder, knowledge-gap radar, snippets, safe-to-send check, team dashboards (overview, SLA radar, fulfilment, workload,
  quality), report builder, saved dashboards, CSV export with name masking.
- Security spine: PII firewall (detect, placeholders, seal, preview, rehydrate locally), sealed-request rule, GET-only reads, Insert
  fills one whitelisted field on the record the text was written for (never saves), managed policy enforced at the read boundary and
  in the AI run, daily token budget, no-content audit log, three key-storage modes. Controls and limits: `docs/security.md`.
- Reviews done: independent security audit (`docs/review/security-audit.md`) and integration review
  (`docs/review/integration-review.md`); their findings were fixed (fix notes in `docs/review/security-fixes-insert.md`).

### Added after user feedback (2026-10-27)

- **DeepSeek** is a provider preset (fixed address `https://api.deepseek.com/v1`, `deepseek-chat` by default, any model name allowed).
- **Settings key box:** Show/Hide for what is typed; a line for what is saved (first and last four characters, length, where it is
  kept) with "Show saved key" (20 seconds); "Test connection" tests the typed key even when it is not saved yet; a pasted key is cleaned
  (quotes, "Bearer ", whitespace); clearer AI errors (no balance, rate limit, unreachable).
- **Company gateway and models:** "OpenAI / Azure OpenAI / company gateway" takes the company address and any model name
  (for example `gpt-5-mini-preprod`). "Load models from the server" (`GET <address>/models`, only the key) fills a list; Settings and a
  selector in the panel header switch the model; policy `allowedModels` limits the list. Azure-style addresses (`?api-version`,
  `api-key` header) were not supported then; round 2 added the Azure OpenAI provider. Questions: `docs/live-questions/ai-provider.md`.
- **Links:** tickets and articles in lists are real links (see "Small things left").

### Added after user feedback (2026-10-29): "good in functionality, ease of use is not great"

The Actions list was 9 to 12 equal buttons per ticket. Now the main ones are one click away, in two places:

- **Quick-actions bar in the side panel** (`src/sidepanel/QuickBar.jsx`): above the record's tabs, folds to one strip (remembered), the person
  chooses up to 4 actions per kind of record ("Choose"; saved in settings `quickPins`), "Use the suggested ones" resets. It shows only where
  the Actions list has 4 or more actions (a chat or an article already has its own short list and its own tab). The full list is unchanged.
  A click is exactly a click in the list: same preview, same policy.
- **Small bar on the ServiceNow page** (`src/content/bar.js`, `src/background/bar.js`): a tab on the edge of the page, opens to the same
  actions, can move to the other edge, remembers open/closed and side. A click asks the service worker to open the side panel and leave a
  30-second request (`src/lib/launch.js`: tab, table, sys_id, feature id); the panel starts the action behind its usual preview.
  It is the first UI the extension puts into a ServiceNow page, so: closed shadow root, real clicks only, two worker requests only,
  nothing runs outside the panel (`docs/security.md`, "The bar on the page" and limits 15 and 16). Settings has a switch for it
  (`pageBar`), and the policy key `disablePageBar` removes it for everyone (`docs/deployment.md`). No manifest change, no new permission.
- Shared choice of actions and short labels: `src/features/quick.js` (a test keeps it in step with the feature registry).
- Tests: `tests/quick-*.test.js`, `tests/bar-*.test.js`, policy cases; e2e scenarios x (panel bar), y (bar on the page, driven through the
  devtools protocol because it lives in a closed shadow root), z (click on the page -> side panel -> preview).
- Found by the e2e run: in the test Chrome a real click on the bar DID open Chrome's side panel (the click's permission travels page ->
  worker -> `chrome.sidePanel.open`), and a first version that also showed the bar for chats was caught by scenario r (it would have
  offered chat buttons the Chat tab deliberately switches off), hence the "4 or more actions" rule.
- Not verified on a real instance and a headed browser: `docs/live-questions/quickbar.md` (does the panel open from the click in headed
  Chrome and Edge, does the tab collide with Workspace or portal tools, z-order over ServiceNow dialogs, a real page's CSP).

### Decisions taken without the user (change if you disagree)

- AI key default storage is "This browser" (the user's choice, like NowBuddy), now in the extension's own IndexedDB vault rather than
  `chrome.storage.local`; `session` and passphrase-encrypted modes exist and `docs/deployment.md` recommends `session` through
  policy for the security-approved rollout.
- `kb_use`: the link column (`task_id` or `task`) is now detected with one GET (`detectLinkColumn`, `src/context/knowledge.js`),
  shared by the gap radar and the Check tab (`docs/live-questions/knowledge.md` question 21).
- Passwords, card, IBAN and ID numbers are never put back into an answer (round 2). The answer says so and the check before Insert
  explains the marker. Change `NEVER_REHYDRATE` in `src/pii/firewall.js` if the organisation wants them back.
- `reply-draft` and `missing-info` are still offered on problem records (no requester); the quick-actions defaults rely on it.
- Coaching snapshot stays off unless the organisation sets `coachingEnabled` (needs HR / works-council sign-off).

### NOT verified (needs a person on a real instance)

The numbered questions are in `docs/live-questions/` (checks 17, compose 24, domain 26, itsm 16, knowledge 24, policy 10, portal 23,
reports 20, reports-ai 21, quickbar 10). Each says what was assumed, how to check it as a non-admin, and what to change if wrong. The biggest:
1. Table and column names for CSM, HR, chat (`sys_cs_*`, `live_message`), `kb_use`, `m2m_kb_task`, `task_sla`, `sysapproval_approver`.
2. Insert on Workspaces and portals (control labels, rich-text boxes, the email client form) and on the classic email client.
3. Portal URL and DOM assumptions (widget boxes, route names, session user fallbacks).
4. Whether the content script can read `chrome.storage.managed` (read-time `blockedTables`); the AI-run check works either way.
5. Real Chrome side-panel behaviour and permission prompts, `chrome.storage.session` in the panel, printing, real downloads. Also: that a
   right-click on a ticket link in the real side panel offers "Open link in new tab" (Ctrl+click and middle-click are tested; a context
   menu cannot be driven headless), and the DeepSeek key against the real DeepSeek API (tested only against the stub).
6. Real model output quality for every prompt, and how well the output check catches per-person wording in the coaching snapshot.
7. Aggregate API behaviour for dot-walked group-by and time zones on a real instance.

8. The bar on the page (`docs/live-questions/quickbar.md`): opening the panel from a click in headed Chrome/Edge, collisions with real
   Workspace and portal layouts, z-order over ServiceNow dialogs.

### Known limits (documented in `docs/security.md`)

A name with no cue around it passes in Standard mode; an internal-notes paraphrase can reach a customer draft (the safe-to-send review
is the control); the portal box is not confined to the ticket widget; HR families are detected by table name prefix; closing
`chrome.storage.local` to content scripts depends on the browser (limit 17).

### Small things left

- The e2e coverage check (scenario e) once saw one browser request the instance never recorded (a read cancelled in flight). It now
  tolerates and reports such extras, and still fails if the instance saw a read the browser log missed.
- Tickets and articles in Related, My day, Knowledge (duplicates, gaps) and the Team ticket tables are real links (click = this tab,
  Ctrl/middle-click = new tab), and so are chart segments, legend rows and tiles that open a list (round 2).
- The engine assumes the browser's time zone is the person's ServiceNow time zone (`docs/live-questions/reports.md` question 3).
- esbuild has one moderate advisory in its dev server, which this project never runs; upgrading changes the bundle bytes, so it is a
  separate change.

## How to test it yourself

1. `npm install`, `npm run build`, load `dist/` at `chrome://extensions` (Developer mode, Load unpacked).
2. Open a ServiceNow tab as a NON-admin fulfiller (itil; csm / hr roles where relevant), click the toolbar button, "Turn on for this
   site", add an AI key in Settings (or point it at Ollama).
3. Work through `docs/live-questions/*.md`, in this order: portal, itsm, checks, compose, knowledge, domain, reports, reports-ai, policy.
4. Dev instance used earlier: dev364920 (it was not reachable from the browser on 2026-10-27; it may be hibernating).
5. Before changing code: `node tests/run.js`, `node scripts/check-compile.js`, `npm run e2e` (rebuilds `dist/` first; running
   `node e2e/run.js` alone uses the OLD `dist/`).

## Test tooling notes

- `node tests/run.js [filter]` bundles each test file and runs `node --test` (per-process temp dir, safe to run twice at once). A filter
  that matches nothing runs everything unbundled and reports bogus file-level failures: ignore that.
- `npm i --no-save puppeteer-core` once for the e2e harness. `node e2e/run.js c,g` runs only some scenarios.
  `E2E_MUTATE=write|leak|beacon|portal-silent|portal-click` breaks a copy of the extension on purpose; the run must then fail.
  `E2E_DUMP=<folder>` writes the exact text of each AI run.
- Not exercisable headless: real side-panel chrome and permission prompts, managed policy, clipboard and downloads, printing, real
  ServiceNow behaviour, a real 401 login popup, service-worker idle shutdown.

## History

`git log --oneline` has one commit per stage: foundations (M0), PII firewall, context engine, Related tab and My day, the real-Chrome
harness, extension points for waves 1-3, ITSM and domain features, portal support, Write tools and checks, knowledge and chat, reports
and dashboards, the review fixes, AI reporting, docs, and the e2e coverage for the new features.
