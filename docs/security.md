# Agent Buddy: security and privacy review pack (draft)

Status: draft for the security team. Every claim that a test enforces names the test. Anything not yet verified on a real
instance is marked **unverified**. Version 0.1.0.

## 1. What it is

A Chrome/Edge extension for ServiceNow fulfillers (IT, customer service, HR cases, catalog) and their team leads. It reads
the ticket the person already has open, masks personal data, asks an AI model of the organisation's choice for a summary,
reply draft, resolution notes and similar, and lets the person insert the result into the open form. It has no server, no
account, no analytics.

## 2. Data flow

```
ServiceNow page (user already signed in)
   |  content script: GET-only reads with the user's own session (ACLs apply)
   v
Side panel (extension page)
   |  PII firewall: detect -> replace with [PLACEHOLDERS] -> seal -> (preview, user confirms)
   v
AI endpoint chosen by the person or the organisation   <- the ONLY other network destination
   |  response
   v
Side panel: placeholders replaced with the real values locally; shown as plain text; Insert fills one form field
```

Destinations: (1) the user's own ServiceNow instance, (2) the AI endpoint. Nothing else. No vendor server exists.

## 3. Permissions and justification

| Permission | Why | Enforced by |
|---|---|---|
| `storage` | Settings, snippets, key (per chosen mode), local audit log | manifest test |
| `sidePanel` | The panel is the only UI | manifest test |
| `scripting` | Register the content script only on instances the person enabled | manifest test |
| `activeTab` | See the address of the tab the person clicked the button on, so "Turn on for this site" knows which site | manifest test |
| optional hosts `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Never granted wholesale. The browser asks for ONE host at a time: an instance or the AI address. Localhost is for a local model. | `tests/manifest.test.js` |

Not requested: `tabs`, `history`, `cookies`, `webRequest`, `debugger`, `downloads`, `clipboardRead`, `nativeMessaging`, static
host permissions, static content scripts, `web_accessible_resources`, `externally_connectable`, keyboard commands.
(`tests/manifest.test.js` fails if any of these appear.)

Extension-page CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https:
http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. No `unsafe-eval`, no
`unsafe-inline`, no remote scripts. `connect-src https:` is broad because the AI address is chosen by the organisation;
the real gate is the per-host browser permission above. An enterprise build can bake an exact list (planned).

## 4. Controls

| Concern | Control | Test |
|---|---|---|
| Writes to ServiceNow | None through the API. The instance client refuses every method except GET. "Insert" fills one field on the open form; the person presses Save, so ACLs, business rules and the audit trail apply. The page bridge has no save, no network, no eval. | `tests/readonly.test.js` |
| Personal data to the AI | Every request goes through the PII firewall; the provider dispatcher refuses any request that was not sealed by it. Only the firewall module can seal. | `tests/seal.test.js`, `tests/pii-*.test.js` |
| Visibility | A preview shows the exact outgoing text with masked values highlighted, configurable always / first time / never (policy can force). In "first" mode the preview is shown EVERY time when the request carries text about other people's tickets or articles (`pack.requirePreview`: look-alike tickets, linked incidents, an account's other cases, overlapping changes, article excerpts). "never" is kept as the explicit choice it is. | `tests/pipeline.test.js`, `tests/policy-hardening-pipeline.test.js`, `tests/policy-hardening-people.test.js` |
| Data minimisation | Each feature has a field allowlist per record kind; whole records are never read or sent. HR free text is excluded unless policy allows it. Every feature that sends text also reads every person column of the kind (to mask those people by name); those columns are not sent as fields. | `tests/context-*.test.js`, `tests/policy-hardening-people.test.js` |
| Prompt injection | Ticket text is wrapped as untrusted data; the model gets no tools and cannot act; output is plain text. | `tests/pii-*.test.js` |
| Exfiltration through output | Output is rendered by a plain-text parser: no HTML, no images, no loading links. Markdown image syntax is shown as text. | `tests/render-*.test.js` |
| Customer-visible text | A safe-to-send check scans text before it is inserted into a customer-visible field. | `tests/safesend*.test.js` |
| Key handling | The key is only read by extension pages, never by content scripts or the page; sent only to its own provider. Modes: browser storage (default), memory-only, passphrase-encrypted (PBKDF2 + AES-GCM). Policy can force a mode or supply the key. | `tests/keystore.test.js`, `tests/policy.test.js` |
| Organisation control | `chrome.storage.managed` policy: allowed instances, AI endpoint and models, privacy mode floor, preview mode, key storage, disabled features, blocked tables and fields, extra sensitive table prefixes, HR switch, token budget. Users can tighten, never loosen. Feature ids, table names and field names are not case-sensitive. | `tests/policy.test.js`, `tests/policy-hardening-policy.test.js` |
| Blocked tables | Enforced where data is READ, not only when an AI run is prepared: the content script loads the managed policy (every 30 seconds) and refuses any read of a blocked table with the code `BLOCKED_TABLE`: the record, related lists, reference answers (the table a variable points at), the journal rows of a blocked table, `task` rows whose class is blocked. The panel shows "your organisation does not allow reading X", never an empty result and never "you cannot see it". The run pipeline also refuses a blocked table (the pack's table and the table of the form the person is on). **Unverified:** that the content script can read `chrome.storage.managed` (limit 7 and `docs/live-questions/policy.md`). | `tests/policy-hardening-guard.test.js`, `tests/policy-hardening-pipeline.test.js` |
| Blocked fields | The firewall refuses a request when `blockedFields` names a part's field OR any column the part carries: a list of linked incidents carries their short description and close notes, a table of SLAs carries its dates. The map is `src/features/partColumns.js`; a test fails when a new derived part has no entry. | `tests/policy-hardening-partcolumns.test.js` |
| HR content | Records of `sn_hr_*` tables and of the prefixes in `sensitiveTablePrefixes` are read minimised (no free text, no identities) unless the policy allows HR content, and are never sent unless the policy ALSO pins the AI endpoint (`aiProvider` or `aiBaseUrl`) or the model runs on this computer. A record opened through the base class `task` is looked up for its real class first; when that fails it is treated as HR. | `tests/policy-hardening-policy.test.js`, `tests/policy-hardening-pipeline.test.js`, `tests/domain-features.test.js` |
| Other people's tickets | The people named on the rows of look-alike tickets, linked incidents, an account's other cases and overlapping changes (display names, from columns already on those rows) are added to the people list, so they are masked exactly. The routing hint no longer receives other tickets' resolution text. The preview is mandatory for these requests (see Visibility). | `tests/policy-hardening-people.test.js` |
| Accountability | Local audit log: feature, table, salted record hash, provider/model, counts of masked items, tokens, outcome. It never holds content. CSV export. | `tests/audit.test.js`, `tests/pipeline.test.js` |
| Cost / abuse | Daily call/token caps and a usage log, per provider (the person's own caps in Settings). The policy key `tokenBudgetPerDay` is enforced before every call: when today's tokens in the local usage log reach it, nothing is sent (`BUDGET`, audited as blocked). The smaller of the two caps applies. | `tests/policy-hardening-pipeline.test.js` |
| Supply chain | One runtime dependency family (React). No remote code, no CDN. Bundled with esbuild, no source maps shipped. SBOM and lockfile in the repo. | `npm ls`, `package-lock.json` |

## 5. Known limits (stated plainly)

1. **Names written inside sentences can be missed.** Pattern detection reliably finds emails, phone numbers, card and ID
   numbers, secrets. Names are masked precisely when they are on the record (caller, assignee, journal authors) but a third
   party's name typed in prose may pass. Mitigations: the preview, strict mode, a local model.
2. **Default key storage is browser storage.** Anyone or any malware that can read the browser profile can read the key.
   Recommended for an approved rollout: policy `keyStorage = session`, or a gateway that issues short-lived keys.
3. **The page can see the bridge events.** A script on the ServiceNow page can observe or forge the bridge's answers; they
   are treated as data to check, never as authority. A hostile page script could already read the same form.
4. **Workspace forms** use shadow DOM, so "Insert" may fall back to Copy there. **Unverified** on a real Workspace.
5. **The AI provider sees the masked text.** The organisation's contract with that provider governs retention.
6. **`connect-src https:`** (see section 3).
7. **Blocked tables depend on the content script reading the managed policy.** The content script asks `chrome.storage.managed`
   every 30 seconds. If the browser does not let a content script read it (**unverified**, `docs/live-questions/policy.md` question 1)
   or no policy is set, the read-boundary check blocks nothing; the run pipeline still refuses a blocked table before any AI call, so
   nothing from it is SENT, but the panel can still read and show it locally. The header line of the open record (number, title, state,
   priority) is read by `src/content/index.js` outside the guard until that file uses `policyGuard.deps()`. Counts of the base table
   `task` do not tell classes apart. A table reached through a dot-walked column is matched by the column's name, which for variables
   is the table's name (`sc_item_option`, `item_option_new`).
8. **A person named only inside another ticket's prose is still not masked.** The names that ARE masked are the people on the
   columns of the rows (caller, opener, assignee, contact...). A colleague or customer mentioned in a close note who is on no
   column of that row passes unless a pattern (an email, a phone number) catches something next to them. The preview is mandatory
   for these requests so the person can see it; strict mode and a local model remain the stronger answers.
9. **HR detection is by table name.** `sn_hr_` plus the policy's `sensitiveTablePrefixes`. A record addressed by the base class
   `task` is resolved to its real class (one small read); a record addressed through another custom parent class is not
   re-resolved, so add the customer's HR prefix to `sensitiveTablePrefixes`. Legal, employee-relations or security-incident tables
   are ordinary unless a prefix or `blockedTables` names them.
10. **"Pinned endpoint" means the policy sets `aiProvider` or `aiBaseUrl`.** `aiProvider: openai` alone still allows the public
    OpenAI address; pin `aiBaseUrl` as well (docs/deployment.md) for HR.
11. **The daily token budget is counted on this computer** from the local usage log. A second browser profile has its own count, and
    one request can overshoot the number because the tokens are known only after the call. The panel must pass the usage reader to
    `executeRun`; until it does the budget is not applied.

## 5A. Auxiliary reads (tables and columns that are not fields of the open record)

Besides the open record's own allowlisted columns, a few reads look at other tables. None of them is a field of the pack unless the
table says so; each is bounded (a limit, a condition on the record, every row checked against the record again), GET-only, with the
person's own session, and passes the blocked-table check above. Columns marked **ids / yes-no** return nothing but a link or a yes/no
to the panel. Names are display names: no other table is read to resolve them, except where the row says so.

| Table | Columns read | Purpose | Returns |
|---|---|---|---|
| `task_sla` | sla, stage, has_breached, percentage, business_percentage, planned_end_time, task | SLAs of the record | SLA name, stage, percent, planned end |
| `sysapproval_approver` | approver, group, state, sys_updated_on, sysapproval | Approvals of the record | approver name, state, time |
| `task` | number, short_description, state, assigned_to, assignment_group, sys_class_name, active, parent | Child tasks; and the real class of a record opened as `task` (`sys_id`, `sys_class_name` only) | task lines; the class name |
| `sc_task`, `change_task`, `sc_req_item` | number, short_description, state, assigned_to, assignment_group, active, plus `request_item` / `change_task_type` / `stage`, `cat_item`, `approval`, `due_date`, `request` | Tasks and items under the record | task lines |
| `sc_item_option_mtom` | request_item, sc_item_option.value, .order, .item_option_new.question_text, .name, .type, .reference | Answers to the request form (secret-named and masked ones are left out) | question and answer |
| tables a variable refers to | sys_id and one display column (`name`, `number`, `title`) | Show the NAME of a referenced record instead of an id. Only these tables: sys_user, sys_user_group, cmn_location, cmn_department, cmn_cost_center, core_company, customer_account, csm_consumer, customer_contact, cmdb_ci (and `cmdb_ci_*`), cmdb_ci_service, cmdb_model, sc_cat_item, kb_knowledge, kb_knowledge_base, task, incident, problem, change_request, sc_request, sc_req_item, sc_task. Any other table named by a variable is not read | a display name |
| `incident` (problem-rca) | number, short_description, state, opened_at, resolved_at, cmdb_ci, close_notes, problem_id, caller_id, opened_by, assigned_to | Incidents linked to a problem (up to 20); the three person columns only for their names | incident lines; names go to the people list |
| `incident.problem_id` (Check tab) | sys_id, problem_id | Is the incident linked to a problem? On the `resolution-check` spec | **ids / yes-no** |
| `change_request` (CAB brief, case briefing) | number, short_description, state, type, risk, start_date, end_date, cmdb_ci, business_service, requested_by, assigned_to | Overlapping changes; recent changes on the case's CI; the two person columns only for their names | change lines; names go to the people list |
| the case table (account briefing) | number, short_description, state, priority, opened_at, resolved_at, account, contact, consumer, assigned_to | The account's other cases (up to 10); the person columns only for their names | case lines; names go to the people list |
| `m2m_kb_task`, `kb_use` | task / task_id, kb_knowledge / article | Is a ticket tied to a knowledge article? (Check tab, knowledge gaps) | **ids / yes-no** |
| `sc_task.request_item` | sys_id, request_item | Which requested item a catalog task belongs to (Request and Checklist tabs). On the `request-status` spec | **ids / yes-no** |
| look-alike tickets (the ticket's own table) | number, short_description, state, close_notes, close_code, resolution_code, resolved_at, closed_at, category, cmdb_ci, cat_item, product, sys_updated_on, caller_id, opened_for, contact, consumer, requested_for, opened_by, assigned_to; the routing read adds assignment_group, priority, subcategory | Similar solved tickets (Related tab, next best action, routing hint) | ticket lines; names go to the people list |
| `kb_knowledge` (search) | sys_id, number, short_description, text, sys_updated_on, kb_knowledge_base, view_count, sys_view_count, valid_to, author | Articles that match a ticket | article lines; the author's name goes to the people list |
| `sys_user`, `csm_consumer` | sys_id, user_name, name, email, first_name, last_name | Emails and names of the people on the record, so they are masked | names and emails stay local |
| `sys_journal_field` | element, value, sys_created_on, sys_created_by, element_id | Notes and comments of the record | note lines |
| `sys_cs_conversation`, `live_group_profile` | sys_id and the column that points at the record (`interaction`, `document_id`, `document`) | Find the conversation of a chat record. **Unverified** table and column names | **ids / yes-no** |
| `sys_cs_message`, `live_message` | sys_id, sys_created_on, sys_created_by, message, formatted_message, text, body, value, payload, direction, message_type, sender_type, type, sender, author, profile, user, and the link column | The messages of a chat. **Unverified** column names; a column the table does not have is not returned | message lines |
| incidents and cases resolved lately (Knowledge gaps) | number, short_description, category, cmdb_ci, close_notes (only its LENGTH is kept), resolved_at, caller_id / contact / consumer (names only) | Topics for new articles (up to 500 tickets, stays on this computer) | counts and topic words |

## 6. Threat model summary

| Threat | Outcome |
|---|---|
| Malicious ticket text tries to steer the model | No tools, no actions, plain-text output; worst case is a misleading draft the person reads before using. |
| Model output tries to leak data through an image or link | Not rendered; shown as text. |
| Compromised page script | Can read what the page already has; cannot reach the AI key (extension pages only) or write through the extension. |
| Stolen AI key | Limited by the provider-side spend cap and by sending only to its own host; mode and policy options above. |
| Malicious update | Distribution through the organisation's controlled channel (private/unlisted store listing or force-install with a self-hosted update URL); build is reproducible from source. |
| Over-collection | Field allowlists, HR free text off by default, tables and fields blockable by policy. |

## 7. Still to deliver for the full review pack

Data-flow diagram (image), STRIDE table with owners, DPIA template, sample managed-policy JSON for Chrome and Edge,
SBOM export, results of a test run on a real instance as a non-admin user, enterprise build with baked-in hosts.
