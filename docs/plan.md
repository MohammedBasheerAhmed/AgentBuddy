# Plan: Agent Buddy — a fulfiller-focused sibling extension to NowBuddy

## Context

NowBuddy is aimed at ServiceNow *developers* (debug, code, explore). The new extension is for the people who **work tickets**: IT fulfillers, customer-service agents, HR case handlers, catalog/request fulfillers, and their team leads. None of them have `admin`. The goal is to cut the time they spend reading, remembering, typing and reporting, with AI where it helps and plain deterministic tooling where it does not.

Two constraints shape every decision:

1. **A security team must approve it.** So the design starts from "what does the reviewer ask?" and the answers are enforced by the architecture (permissions, data flow, managed policy), not by promises.
2. **It must be simple.** One side panel, one-click actions, works on classic UI and Workspaces, works with any AI key (or a local model).

Persona rule for every feature: *"Would an agent or a team lead, with only their normal roles, reach for this daily?"* If it needs admin, it is out.

---

## 1. Use-case catalog

Legend — **AI**: needs a model. **Det**: deterministic (no AI key needed, lowest risk). **Hyb**: deterministic data gathering + AI wording. **Wave**: 1 = MVP, 2 = next, 3 = later. **★** = comes straight from your list.

### A. Understand the record (works on incident, problem, change, case, HR case, request, RITM, catalog task)

| # | Name | What it does | Why agents want it | Type | Wave |
|---|------|--------------|--------------------|------|------|
| A1 | ★ **Record summary** | One click gives: issue, impact, what was tried, current state, waiting-on, next step, in a fixed structure. Same engine for every task table, with a prompt pack per table. | Picking up a ticket mid-flight (shift change, reassignment, callback) takes seconds instead of 5–10 minutes of scrolling. | Hyb | 1 |
| A2 | **Caller / requester history ("what happened before")** | Timeline of this person's last N tickets across incident, case, request/RITM and (if allowed) HR case. Flags repeat issues, shows the last fix that worked and anything still open. Optional AI "pattern" line. | Ends the "have you tried…" loop, spots chronic problems, lets the agent open with context and empathy. | Hyb | 1 |
| A3 | **Similar and already-solved tickets** | Finds open duplicates and resolved look-alikes (same CI/category/keywords/time window) and shows their resolution notes and the KB they used. | The fastest route to a fix is usually "someone solved this last week". | Hyb | 1 |
| A4 | **Hand-off / escalation brief** | Structured note for L1→L2, group→group or shift→shift: symptoms, evidence, steps tried, what is needed. Pastes into a work note. | The next person does not have to re-ask the customer; fewer bounce-backs. | Hyb | 1 |
| A5 | ★ **Sentiment and escalation risk** | Reads customer-visible comments and flags frustration, urgency, VIP/executive tone, reopen count; shows the quotes that triggered the flag. | Lets the agent change approach early and lets leads see tickets about to escalate. | AI | 2 |
| A6 | **Missing-info check + questions to ask** | Detects missing basics (affected user, CI, error text, steps to reproduce, business impact) and proposes 3–5 clarifying questions. | Fewer pending-customer round trips; better first-contact resolution. | Hyb | 1 |
| A7 | **Next-best-action checklist** | Turns similar resolved tickets and matching KB into a tickable troubleshooting list. | New joiners work like seniors; consistent handling. | AI | 2 |
| A8 | ★ **Activity-stream / sidebar discussion summary** | Condenses long comment/work-note threads and the record's sidebar (Connect/discussion) conversation into decisions, open questions and owners. | Long threads are where context is lost. | Hyb | 1 |
| A9 | **Request explainer (catalog)** | Shows a RITM's variables as a readable table, the approval and task chain, what is blocking it and who owns the blocker. | Answers "where is my request?" in one look; no clicking through five related lists. | Hyb | 1 |

### B. Communicate (draft → agent edits → agent sends; nothing is sent automatically)

| # | Name | What it does | Why agents want it | Type | Wave |
|---|------|--------------|--------------------|------|------|
| B1 | ★ **Activity reply drafter** | Drafts the next customer comment or work note from the latest message, KB facts and record state. One engine for **incident, request, requested item, catalog task, case, HR case** (your four "activity response" items). | Typing replies is the biggest daily time sink; drafts keep tone and policy consistent. | AI | 1 |
| B2 | ★ **Email recommendation + composer** | Suggests *which* email fits the moment (ask for info, status update, resolution, approval nudge, apology, closure) and drafts it; opens in the standard email compose. | Removes blank-page time and wrong-template mistakes. | AI | 1 |
| B3 | **Safe-to-send check** | Scans a customer-visible comment or email draft for passwords, tokens, card/ID numbers, internal-only phrases and other people's data *before* it is sent. Local rules, no AI. | Real service desks leak data through comments. This is also the feature the security team will like most. | Det | 1 |
| B4 | **Tone / clarity / translation helper** | Rewrites selected text: shorter, friendlier, plain language, translate or bilingual. Keeps placeholders and links intact. | Non-native writers and stressed agents sound clear and calm. | AI | 2 |
| B5 | **Snippets and macros** | Personal canned replies with variables (`{{caller.first_name}}`, `{{number}}`, `{{sla.due}}`). Stored locally, export/import as JSON. | Fast, predictable, works with zero AI. | Det | 1 |
| B6 | **Notes-to-ticket** | Agent pastes rough call/chat notes; gets short description, description, category hint and impact filled into a new record's fields for review. | Phone and walk-up tickets get logged in 30 seconds with better quality. | AI | 2 |
| B7 | **Major-incident comms (leads)** | Stakeholder updates (exec, technical, customer-facing) from the major incident, its tasks and the timeline. | Updates every 30 minutes without a scramble. | AI | 3 |

### C. Close it right (resolution and knowledge)

| # | Name | What it does | Why agents want it | Type | Wave |
|---|------|--------------|--------------------|------|------|
| C1 | ★ **Resolution notes + close code** | Writes cause / fix / verification from the work notes and comments, suggests the close code, fills `close_notes` on the form for review. | Resolution notes are the most skipped, lowest-quality field; they feed every future A3 search. | Hyb | 1 |
| C2 | **Resolution quality gate** | Before resolve/close: checks notes completeness, customer confirmation, linked KB/problem, and PII in the notes. Warns, never blocks. | Cleaner data, fewer reopens, fewer audit findings. | Det | 2 |
| C3 | ★ **KB article from ticket** | Drafts an article (symptom, cause, resolution, steps) in the KB template, PII-stripped, after first checking for an existing similar article. Opens as a draft in the standard KB form. | Turns solved tickets into reusable knowledge without a second writing session. | AI | 2 |
| C4 | ★ **Knowledge recommendations for this ticket** | Searches KB and ranks the articles that would answer this ticket; shows why; attach/share link. | Agents stop re-solving documented problems; KB usage rises. | Hyb | 1 |
| C5 | ★ **Article optimization recs** | For KB authors: structure, title and keywords, clarity, missing prerequisites, stale-looking steps. | Better articles → more self-service, fewer tickets. | AI | 3 |
| C6 | ★ **Duplicate-article finder + merge draft** | Local similarity finds near-duplicate articles; AI drafts one merged article and lists which to retire. | A cluttered KB makes agents distrust it. | Hyb | 3 |
| C7 | ★ **Knowledge-gap radar** | Clusters resolved tickets that have no KB link, and repeated questions, into a ranked "articles to write" list. | Tells KB owners what to write next, backed by volume. | Hyb | 3 |

### D. Chat and live interactions

| # | Name | What it does | Why agents want it | Type | Wave |
|---|------|--------------|--------------------|------|------|
| D1 | ★ **Chat summarization** | At wrap-up: summary, disposition, follow-ups, ready to paste into the case or incident. | Wrap-up time is dead time between chats. | AI | 2 |
| D2 | ★ **Chat reply recommendation** | Three suggested replies to the customer's last message, grounded in KB and the record. Agent clicks to insert. | Handles several chats in parallel at consistent quality. | AI | 2 |

### E. Triage and routing hints (suggestions only, the agent decides)

| # | Name | What it does | Why agents want it | Type | Wave |
|---|------|--------------|--------------------|------|------|
| E1 | **Classification / routing hint** | Suggests category, assignment group and priority with reasoning, using similar tickets and only values the user can see. | Fewer mis-routed tickets and reassignments. | Hyb | 2 |
| E2 | **Duplicate / major-incident spotter** | "9 other open incidents on the same CI/service in the last 2 hours" with a link to propose a parent. | Catches an outage while it is still a trickle. | Det | 2 |

### F. Team-lead and queue reporting (read-only aggregates, no admin)

| # | Name | What it does | Why they want it | Type | Wave |
|---|------|--------------|------------------|------|------|
| F1 | **My Day** | My queue ordered by SLA risk and age; "customer replied" and "waiting on me" markers. | Tells an agent what to do next without building list filters. | Det | 1 |
| F2 | **Team workload and aging board** | By assignee/group/state; stale (no update in X days), unassigned, reassignment ping-pong. | Leads rebalance work before SLAs break. | Det | 2 |
| F3 | **SLA risk radar** | At-risk and breached tasks from `task_sla`, grouped by owner and group. | Early warning instead of a post-mortem. | Det | 2 |
| F4 | **Shift handover report** | One page: open, at-risk, waiting-on-customer, notable events; AI-written summary; export. | Clean shift changes. | Hyb | 2 |
| F5 | **Quality and trend report** | Reopen rate, mean time to resolve, reassignments, top categories/CIs, repeat callers, backlog trend. Aggregate API only. | Evidence for staffing, training and problem management. | Det | 2 |
| F6 | **Coaching snapshot (opt-in, policy-gated)** | Rubric review of a sample of closed tickets: note quality, tone, completeness. Off unless the organisation enables it. | Supports coaching; needs HR/works-council sign-off, so it is off by default. | AI | 3 |
| F7 | **Export** | CSV/XLSX of any report, with a "mask names and emails" toggle. | Reports leave the browser only when the agent asks. | Det | 2 |

### G. Domain packs (extra prompt packs and panels on the same engine)

| # | Name | What it does | Why | Type | Wave |
|---|------|--------------|-----|------|------|
| G1 | **HR case brief (strict mode)** | Case summary and reply drafts for HR; strict PII mode; disabled unless policy enables it and the endpoint is approved/local. | HR data is special-category; handling must be explicit. | Hyb | 2 |
| G2 | **CSM account briefing** | Contact, account, entitlements, open and recent cases, sentiment, recent changes affecting the customer. | Agent walks into the call prepared. | Hyb | 2 |
| G3 | **Case-to-engineering escalation draft** | Bug-report style hand-off with repro steps and evidence from the case. | Engineering stops bouncing cases back. | AI | 3 |
| G4 | **Problem statement / RCA draft** | From linked incidents: problem statement, timeline, probable cause. | Gets problem records written. | AI | 3 |
| G5 | **Change summary + CAB brief** | Plain-language change summary, risk readout and conflicting changes. | Faster CAB prep. | Hyb | 3 |
| G6 | **Fulfillment checklist** | Turns catalog-task instructions and variables into a checklist with completion tracking. | Consistent fulfillment; fewer missed steps. | Det | 3 |

**Deliberately excluded:** reading attachments/screenshots, writing to records via REST, bulk updates, impersonation, anything needing admin or a scoped app on the instance, auto-sending any message.

**MVP (Wave 1) = A1 A2 A3 A4 A6 A8 A9 B1 B2 B3 B5 C1 C4 F1** — covers every item on your list except sentiment, chat, KB gen/optimise/merge/gaps, which follow in Waves 2–3 on the same engine.

---

## 2. Security and privacy design (what we put in front of the security team)

| Reviewer concern | Design answer | How it is verifiable |
|---|---|---|
| Where does data go? | Only two destinations: the user's own ServiceNow instance (already signed in) and the AI endpoint the org approved. No vendor server, no analytics, no telemetry, no error reporting. | Manifest host list; network capture; data-flow diagram in the review pack. |
| Over-broad permissions | No `<all_urls>`. Instance hosts and AI hosts are *optional* host permissions requested at setup; policy can pre-grant a fixed list. No `cookies`, `tabs`-wide, `history`, `webRequest`, `debugger`. | Manifest + permission justification table. |
| AI key theft | Keys never go to ServiceNow or the page; only the service worker reads them. Three storage modes: **local** (your chosen default, as NowBuddy does today), **memory-only** (`chrome.storage.session`), **passphrase-encrypted** (WebCrypto AES-GCM). Managed policy can force memory-only or supply the key/endpoint centrally. Keys are never logged or put in URLs, a key is only ever sent to its own provider host, and a per-user spend cap limits the damage of a leaked key. | Source review; storage inspection; policy test. **Open finding to expect:** unencrypted local storage is readable by malware running as the user. The rollout guide will recommend the policy-forced memory-only mode for the security-approved deployment. |
| Which AI is used? | Bring any key: OpenAI-compatible (covers Azure OpenAI, internal gateways, LiteLLM, Groq, Mistral, OpenRouter), Anthropic, Gemini, and **local models** (Ollama/LM Studio on localhost = zero egress). Policy can pin one endpoint and model list. | Provider adapter code; managed-policy schema. |
| PII to a third party | **PII firewall** (§3) runs before every call: detect → replace with reversible placeholders → send → put real values back locally. A preview shows the exact outgoing text. Strict mode refuses sensitive tables/fields. | Unit tests with a PII corpus; preview panel; audit counts. |
| Data minimisation | Each use case has a *field allowlist* (e.g. short description, description, last N journal entries, state, priority). Whole records are never sent. | Per-feature field list in code, shown in the preview. |
| Prompt injection from ticket text | Ticket content is untrusted: wrapped in delimiters, model gets **no tools and no actions**, output is text only. | Prompt packs; injection test cases. |
| Exfiltration via model output | Output rendered as **plain text/sanitised** — no markdown images, no auto-loaded links, no HTML. CSP blocks remote img/script/frame. | CSP + render tests. |
| Writes to ServiceNow | **The extension never writes through the API.** "Insert" only fills the field on the open form; the agent presses the form's own Save, so ACLs, business rules, client scripts and the audit trail all apply. Reports are read-only. | Code search: no PATCH/POST/PUT/DELETE to the instance. |
| Privilege | Reads only through the agent's own session, so ACLs and field masking already apply. No impersonation, no elevation, no admin endpoints; a 401/403 is shown as "you don't have access", never worked around. | Test as a non-admin user. |
| Remote code / supply chain | MV3, no remote code, no CDN, no `eval`, strict CSP, bundled and pinned dependencies (aim for ≈0 runtime deps), lockfile, SBOM, signed release artifacts, reproducible build. | Build script; SBOM; `npm audit` in CI. |
| Deployment control | Force-install and configure through Chrome/Edge enterprise policy (`chrome.storage.managed`): allowed instances, AI endpoint and models, PII mode locked on, disabled features, blocked tables, audit export on. | Policy JSON schema + sample. |
| Accountability | Local audit log: time, feature, table, record-id hash, provider/model, token counts, redaction counts, outcome — **never content**. Exportable CSV. Optional "AI-assisted" stamp in the inserted text. | Audit log viewer; export. |
| Retention | Nothing about records is persisted. Placeholder maps live in memory for the one request. Snippets and settings only. "Clear all data" button. | Storage inspection. |
| Cost / abuse | Per-feature token cap, daily budget, local cost log, rate limit. | Settings. |

**Review pack we will ship with the build:** architecture and data-flow diagram, permission justification, threat model (STRIDE + prompt injection), PII-handling spec with test results, DPIA template, policy schema with samples, SBOM, "what we collect: nothing" statement.

## 3. PII firewall (the core security component)

1. **Detect** with deterministic detectors: email, phone, national IDs (SSN/NI/Aadhaar-style, configurable per region), card numbers (Luhn), IBAN, IP/MAC, dates of birth, street addresses (heuristic), employee IDs, secrets (API keys, bearer tokens, passwords after "password:", private-key blocks). Plus a **record-aware dictionary**: the names and emails of the caller, opened-by, assigned-to, account and contact on *this* record are known exactly, so they are masked precisely.
2. **Replace** with stable placeholders (`[PERSON_1]`, `[EMAIL_1]`, `[ID_1]`), consistent within one request so the model can still reason about "who said what".
3. **Send** only the redacted text, limited to the feature's field allowlist.
4. **Re-hydrate** the response locally (placeholders → real values) so the agent sees a natural draft.
5. **Show** the exact outgoing payload in a preview (configurable: always / first time per feature / off if policy allows).
6. **Modes:** *Standard* (above), *Strict* (also drops free-text fields on sensitive tables, HR by default, requires approved or local endpoint), *Local-only* (refuses any non-localhost endpoint).
7. **Fail closed:** if redaction throws or a blocked table/field is hit, nothing is sent.
8. **Honest limits** (stated in the review pack): pattern detection is not perfect for free-form names or addresses in prose; hence the preview, strict mode and local-model option.

---

## 4. Architecture

**New, separate codebase** (folder `D:\AgentBuddy`, own git repo, own manifest, extension name "Agent Buddy"). Same stack as NowBuddy so the code is familiar: plain JS + JSX, React 18 as the only runtime dependency, esbuild, `node --test`. MV3, Chrome and Edge (`chrome.sidePanel` exists in both).

```
SN page (classic or workspace)
   │  content script: detect table + sys_id from URL/DOM; GET-only Table/Aggregate reads
   │  with the user's own session (ACLs apply); tiny page-world bridge: read form values,
   │  fill ONE field. No save, no REST write.
   ▼
service worker  ── PII firewall → (preview) → provider adapter → AI endpoint
   │              key lives only here; audit + budget here; policy enforced here
   ▼
side panel (extension origin, own CSP) ── safe text renderer, Insert / Copy buttons, reports
```

Why a **side panel** as the main surface: it behaves the same on classic forms and on Service Operations / CSM / HR workspaces (whose forms sit in shadow DOM), and it is an extension-origin page with its own CSP, so ticket text never runs in a page we control. The content script only reads, plus the single "fill field" call.

**Reuse from NowBuddy — copy and trim, not a shared dependency** (so the reviewed surface stays small):

| Take | From (NowBuddy `src/`) | Change |
|---|---|---|
| Provider layer: config, dispatcher, Anthropic + OpenAI-compatible adapters, message translation, spend caps, usage log, URL validation | `providers/config.js`, `index.js`, `anthropic.js`, `openai.js`, `messages.js`, `budget.js`; `lib/aiUsage.js` (`validateBaseUrl`, `checkCaps`, `summarize`) | Provider hosts become *optional* permissions; add key-storage modes; add streaming (NowBuddy has none) for chat suggestions. |
| Sender validation | `lib/senderCheck.js` | As is. |
| Session token + Table/Aggregate client | `content/sessionToken.js`, `content/tableApi.js` (`queryTable`, `fetchRecord`, `countRecords`, `countByColumn`, retry/backoff, `serviceNowErrorText`) | **Strip create/update/delete.** Add a runtime guard that rejects any non-GET. |
| "ACL-hidden answers 200 with no rows" handling | `content/adminSession.js`, `content/processView.js:141-144` | Generalise as `confirmEmptyIsReallyEmpty()`; show "you can't see this table" instead of "no results". |
| Approvals / SLA / child-task reading | `lib/processView.js`, `content/processView.js` | Feeds A9, F3, F1. |
| Similar tickets (keyword) | `lib/similar.js` | Base for A3 and E2; add resolved-ticket ranking. |
| Ticket tables and number parsing | `lib/ticketTables.js`, `lib/recordNumber.js` | Add record-type pack per table. |
| Page bridge (user, roles, form values, set value) | `page/bridge.js` (`getUserInfo`, `getSessionInfo`, `getFormValues`, `setFieldValue`) | **Drop `saveForm`.** Fill-only; clipboard fallback when the form can't be reached. |
| Export | `lib/export.js` (`toCsv` with formula-injection guard), `lib/report.js` | Add column masking. |
| Look and feel | forest palette + AA contrast test (see theme rules), toast, shadow-root helpers | Panel-sized layout. |
| Test scaffolding | `tests/run.js`, `preview/fakeInstance.js`, axe run, smoke run | New fulfiller fixtures. |

**Left behind on purpose:** agent loop with write tools, MCP bridge (127.0.0.1), impersonation, cross-instance Basic-Auth credentials, script run, recorder, offscreen/sandbox pages, screenshots, `<all_urls>`-style permissions.

**New modules:** `pii/` (detectors, record-aware dictionary, tokenizer, re-hydrate, test corpus), `context/` (per-table context-pack builders with field allowlists), `prompts/` (one hardened pack per use case, shared injection preamble), `policy/` (`chrome.storage.managed` schema + enforcement), `audit/` (no-content log + CSV export), `render/` (safe text renderer), `reports/` (Aggregate-API queries), `snippets/`, `safeSend/` (outgoing-text checker).

**Managed-policy keys** (all optional): `allowedInstances`, `aiEndpoint`, `allowedModels`, `piiMode` (`standard|strict|local-only`, can be locked), `previewMode`, `keyStorage`, `providedApiKey`, `disabledFeatures`, `blockedTables`, `blockedFields`, `tokenBudgetPerDay`, `auditExport`.

**Role awareness for non-admins:** no admin tier. Features appear by *capability probe* (can this user read `task_sla`, `sn_customerservice_case`, `sn_hr_core_case`, `kb_knowledge`?), reusing NowBuddy's 403 / empty-200 handling, with a new "fulfiller / team lead" view instead of NowBuddy's user/developer/admin tiers (`lib/roleTier.js`).

---

## 5. Build order

| Milestone | Scope | Gate to move on |
|---|---|---|
| M0 Foundations | Repo, manifest, build, test harness, theme, settings page, trimmed provider layer, key-storage modes, no-content audit log, policy loader | Manifest permission snapshot test passes; no write verb in the Table client. |
| M1 PII firewall | Detectors, record-aware dictionary, placeholders, re-hydrate, preview panel, fail-closed, safe renderer | PII corpus tests pass (zero misses on explicit patterns); nothing can reach the provider except through the firewall. |
| M2 Context engine | Record detection (classic + workspace URLs), context-pack builders for incident, RITM, SCTASK, CSM case, HR case, ACL-aware reads | Works as a non-admin test user on the PDI; hidden tables reported correctly. |
| M3 Wave 1 | A1 → C1 → B1 → A2 → A3 → C4 → B2 → A4 A6 A8 A9 → B3 B5 → F1 | Each feature live-checked, with AI on and off. |
| M4 Security review pack | Data-flow diagram, permission table, threat model, PII spec + results, DPIA template, policy samples, SBOM, hardening pass | Internal self-review, then hand to the security team. |
| M5 Wave 2 | E1 E2 F2–F5 F7 A5 A7 B4 B6 C2 C3 D1 D2 G1 G2 | Chat tables verified on a real instance first. |
| M6 Wave 3 | B7 C5–C7 F6 G3–G6 | F6 only after governance sign-off. |

---

## 6. Verification

- **Unit (`node --test`):** PII corpus with expected placeholders; managed-policy enforcement; "no non-GET reaches the instance" guard; safe-renderer tests with hostile markdown/HTML/image links; prompt-injection cases against mocked model output; manifest snapshot that fails if a permission or host is added; CSP check.
- **Preview harness:** fake instance seeded with fulfiller tickets whose notes contain emails, phones, card numbers, passwords and an injection attempt; assert the preview shows placeholders only.
- **Live on the PDI (dev364920), driven through Chrome by me:** create a non-admin test user with fulfiller roles, run every Wave 1 feature as that user, confirm ACL-denied tables degrade cleanly, confirm Insert fills the field on a classic form and check the Workspace path (confirm first that the PDI has a workspace plugin; if not, say so and mark the Workspace path unverified). Use your key or a local Ollama for the first AI run. Clean up test data afterwards.
- **Network proof:** capture requests during a full run and show that only the instance and the configured AI host were contacted.
- **Quality:** axe accessibility run, `npm audit`, SBOM generation, size/permission report.

---

## 7. Risks to know about

1. **Plain local key storage** (your choice) will likely draw a security comment. Mitigations are built in: policy-forced memory-only, key-per-host binding, spend cap. Recommended for the approved rollout: set `keyStorage=session` via policy.
2. **Workspace forms** use shadow DOM, so direct field fill may not work everywhere. Clipboard fallback is the guaranteed path; direct fill is verified per workspace, not assumed.
3. **PII detection is not perfect** for names written in prose. The preview, strict mode and local-model option are the answer; the review pack says so plainly.
4. **Chat, Connect and HR tables** (`interaction`, `sys_cs_*`, `live_message`, `sn_hr_core_*`) depend on the products and roles an organisation has. These features hide themselves when the user cannot read the data, and they are verified on a real instance before Wave 2 ships.
5. **Coaching snapshot (F6)** evaluates individuals; some countries require works-council or HR approval. Off by default, policy-gated, Wave 3.
6. **Distribution:** private or unlisted store listing, or enterprise force-install with a self-hosted update URL. Decide with the security team.
