# Agent Buddy: progress

Plan: `C:\Users\bashe\.claude\plans\we-need-to-create-stateful-dawn.md` (approved 2026-10-26). Contracts between modules: `docs/contracts.md`.
Rules every change follows: `docs/build-rules.md`.

## RESUME HERE (2026-10-27)

**Everything in the plan is built (waves 1, 2 and 3), plus portals and reports/dashboards (asked for later). Next step is a person
testing it on a real instance and improving it.** Nothing here has run against a real ServiceNow instance or a real AI model yet; the
fake instance and stub AI server in `e2e/` stand in for them.

Verified by me on 2026-10-27 (all committed locally, never pushed):

| Check | Result |
|---|---|
| `node tests/run.js` (unit) | **1860 pass, 0 fail** |
| `node scripts/check-compile.js` (every build entry compiles) | all ok |
| `npm run e2e` (real Chrome, fake ServiceNow, stub AI; scenarios a-w) | **834 pass, 0 fail, 2 warnings** (about 125 s) |
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
  `api-key` header) are NOT supported yet. Questions: `docs/live-questions/ai-provider.md`.
- **Links:** tickets and articles in lists are real links (see "Small things left").

### Decisions taken without the user (change if you disagree)

- AI key default storage is plain local (the user's choice, like NowBuddy); `session` and passphrase-encrypted modes exist and
  `docs/deployment.md` recommends `session` through policy for the security-approved rollout.
- `kb_use` is read through the column `task_id` in both places (`src/context/knowledge.js` LINK_SOURCES and `src/content/ops/checks.js`
  KB_SOURCES). Unverified: if the real column is `task`, change both (`docs/live-questions/knowledge.md` question 21).
- Coaching snapshot stays off unless the organisation sets `coachingEnabled` (needs HR / works-council sign-off).

### NOT verified (needs a person on a real instance)

The numbered questions are in `docs/live-questions/` (checks 17, compose 24, domain 26, itsm 16, knowledge 24, policy 10, portal 23,
reports 20, reports-ai 21). Each says what was assumed, how to check it as a non-admin, and what to change if wrong. The biggest:
1. Table and column names for CSM, HR, chat (`sys_cs_*`, `live_message`), `kb_use`, `m2m_kb_task`, `task_sla`, `sysapproval_approver`.
2. Insert on Workspaces and portals (control labels, rich-text boxes, the email client form) and on the classic email client.
3. Portal URL and DOM assumptions (widget boxes, route names, session user fallbacks).
4. Whether the content script can read `chrome.storage.managed` (read-time `blockedTables`); the AI-run check works either way.
5. Real Chrome side-panel behaviour and permission prompts, `chrome.storage.session` in the panel, printing, real downloads. Also: that a
   right-click on a ticket link in the real side panel offers "Open link in new tab" (Ctrl+click and middle-click are tested; a context
   menu cannot be driven headless), and the DeepSeek key against the real DeepSeek API (tested only against the stub).
6. Real model output quality for every prompt, and how well the output check catches per-person wording in the coaching snapshot.
7. Aggregate API behaviour for dot-walked group-by and time zones on a real instance.

### Known limits (documented in `docs/security.md`)

Names only inside prose are not masked; an internal-notes paraphrase can reach a customer draft (the safe-to-send review is the
control); the portal box is not confined to the ticket widget; HR families are detected by table name prefix.

### Small things left

- While the Team tab is on screen, every navigation of the ServiceNow tab restarts all widgets (`page.href` is in the env deps of
  `ReportsDashboard.jsx`).
- Pressing Escape in the preview before it has taken focus does nothing.
- Options page could show the effective daily token cap and list unknown ids in `disabledFeatures`.
- The `dashboards` preset does not include hand-over or insights.
- The e2e coverage check (scenario e) once saw one browser request the instance never recorded (a read cancelled in flight). It now
  tolerates and reports such extras, and still fails if the instance saw a read the browser log missed.
- Tickets and articles in Related, My day, Knowledge (duplicates, gaps) and the Team ticket tables are real links (click = this tab,
  Ctrl/middle-click = new tab). Chart segments, legend rows and tiles that open a LIST are still buttons that open in the same tab.
- Backlog ideas: select text in the preview and "Mask this too"; an enterprise build with baked-in instance hosts.

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
