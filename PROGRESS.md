# Agent Buddy: progress

Plan: `C:\Users\bashe\.claude\plans\we-need-to-create-stateful-dawn.md` (approved 2026-10-26). Contracts between modules: `docs/contracts.md`.

## RESUME HERE (2026-10-26)

Built (M0 foundations, all unit-tested):
- Repo, build (`npm run build` -> `dist/`), test runner (`npm test`, `node tests/run.js <filter>`).
- `src/policy` managed policy (floors, locks, allow-lists), `src/lib/keyStore.js` (local / session / passphrase-encrypted), `src/audit` (no-content audit log), `src/providers` (trimmed from NowBuddy; only accepts firewall-sealed requests), `src/content/tableApi.js` (GET-only), `src/page/bridge.js` (read + fill one field, no save), service worker (registers content scripts only on enabled instances), side panel + settings page.
- Guard tests: `manifest.test.js` (permission snapshot), `readonly.test.js` (no writes anywhere), `pipeline.test.js` (policy gating, audit has no content).

Built by parallel agents, each verified by running its suite myself: `src/pii` + `src/safeSend` (114 tests), `src/render` + `src/snippets` (134), `src/context` (147). Full unit suite: 448 passing. `npm run build` works; `dist/` loads as an unpacked extension (not yet opened in a real browser by a person).

Probe of the real firewall on a hostile ticket: caller/author names, emails, phone, card, password, SSN, IP and a `</ticket_data>` injection were all handled. A third party's name written only inside a sentence ("Manager is Priya Raman") is NOT masked: documented limit, which the preview shows.

Backlog ideas (not built): select text in the preview and "Mask this too"; enterprise build with baked-in instance hosts; A2/A3/C4 "Related" tab (caller history, similar tickets, KB suggestions, duplicates; the reads exist in `src/context` and `reads.js`, only the panel UI is missing); email composer (B2); snippets UI (B5); request explainer (A9).

Also built since: the Related tab (caller history, solved look-alikes, open duplicates, KB suggestions; no AI call) and My Day.

### End-to-end harness (2026-10-27)

`npm i --no-save puppeteer-core` once, then `npm run e2e` (rebuilds `dist/`, drives it in real Chrome against a fake ServiceNow and a
stub AI server; `node e2e/run.js c,g` runs only some scenarios). Verified by me: **202 checks pass, 0 fail, 1 warning (~40 s)**,
unit suite **453 pass**.
- Scenarios a-k: startup, enable + record detection, full AI path, insert, read-only + network proof, failure modes, My Day, settings UI,
  Related tab, panel state, key storage modes.
- Proved: preview text and every AI request body contain none of the seeded name, email, phone, card or password; the instance saw only
  GETs to `/api/now/table|stats` with the token; nothing else was contacted; no ticket data in storage or console; the injected image/link
  is never fetched. `E2E_MUTATE=write|leak|beacon` breaks a copy of the extension on purpose and the run then fails, as it should.
- Bugs it found and fixed: Workspace Insert used the button text as the field label (never matched) and replaced the agent's typed text;
  a bare repeated password passed the safe-to-send check; Related caller history was always empty (the `similar` pack has no caller);
  My Day dropped the SLA-denied note; provider `custom` with an empty address fell back to api.openai.com (now refused in the pipeline
  AND inside `sendChat`); fast typing in Settings dropped characters and concurrent `saveSettings` calls undid each other.
- Two PII gaps it found are closed: `call me on 555-0199` (7-digit number after a calling verb) and `employee id is E12345`.
- Still open (documented limit): a person named only inside a sentence ("manager is María-José O'Neil") reaches the AI; the preview shows it.
- NOT verified (needs a person): real Chrome side-panel chrome and permission prompts (a new AI host's `permissions.request` hangs headless,
  so NOT_LOCAL / BLOCKED_FIELD through the UI were not driven; only HR_BLOCKED was), managed policy, real ServiceNow/Workspace behaviour
  including real aria-labels, a real 401 login popup on an expired session, service-worker idle wake-up inside the suite.

Open next:
1. Live check on the PDI (dev364920) as a NON-admin user: record detection (classic + workspace), reads, ACL-hidden tables, journal fallback, Insert on classic and workspace forms.
3. Wave 1 features still to build: A9 request explainer, B2 email composer, B5 snippets UI (A1/A2/A3/A4/A6/B1/B3/C1/C4/F1 are in).
4. M4 security review pack (`docs/security.md`, threat model, data-flow diagram, permission table, DPIA template, SBOM).

## Live-instance questions (cannot be settled without a real non-admin PDI user)

From the context-engine build. Check each as a user with only fulfiller roles (itil, and csm/hr roles where relevant):
1. `sys_journal_field`: 403, 200-empty or rows? Is `name` the record's own table for RITM and child classes?
2. `comments` / `work_notes` with display_value=all: label wording, date format, time zone (the fallback parser depends on it).
3. Dot-walked `sc_item_option_mtom` read: response key names, ACLs on question definitions, the "Masked" type label, whether the reference column holds a table name.
4. Does `sc_req_item.requested_for` exist? (`request.requested_for` fallback is coded.)
5. Are `incident_task` / `problem_task` linked through `parent`, or an `incident` / `problem` column?
6. Is `sc_task.requested_for` a column? (Not read today.)
7. Can fulfillers read `task_sla`, `sysapproval_approver`, `kb_knowledge.text`, `view_count` vs `sys_view_count`, `valid_to`?
8. Can they read `sys_user.email`? (Names are masked precisely only when emails are known.)
9. CSM/HR column names (`consumer`, `entitlement`, `opened_for`, `hr_service`) and whether HR denials are 403 or empty-200.
10. Do `cmdb_ci.name=`, `sys_idIN..^ORuser_nameIN..` and `close_notesISNOTEMPTY` conditions work for a fulfiller?
Also: Insert on a classic form (g_form) and on a Workspace form (DOM fallback), Chrome side panel behaviour, permission prompts.

Decisions: see memory `agent-buddy-extension` (separate repo, side panel, plain local key storage by user choice with switchable modes, name "Agent Buddy").
