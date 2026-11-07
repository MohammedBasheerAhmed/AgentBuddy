# Audit 7: does each record type get what ITS worker needs, and the right words?

Scope: read-only. Method: read the code named in the brief, plus one `node` run of the pure state classifiers (script:
`...\scratchpad\cls.mjs`, output pasted in section 3). Every claim is tagged VERIFIED (read the code / ran it) or ASSUMED
(how ServiceNow behaves; the repo does not prove it). Paths are under `D:\AgentBuddy\`. Known items of
`docs/review/audit-2026-11-04.md` (five state classifiers disagree, five "Label: text" parsers) are not re-reported as such; only
the per-table dimension the brief asked about is added.

## 0. The short answer

The panel was built incident-first. Everything that makes a fulfiller's day easy (the requested item's answers, approvals, task
chain, checklist, the plain-words status message) exists, but it lives on the **requested item (RITM)** only. A **catalog task
(sc_task)**, which is what most fulfillers actually hold, gets the incident treatment: its pack has no requester, no catalog item,
no answers; its "caller" is `opened_by`; its Close row asks whether "the caller confirmed"; its resolution prompt asks for
"Cause / Fix / Verification / Suggested close code". Changes get the thinnest no-AI view of any kind. Custom task tables get no
Insights card at all. Labels never follow the instance (no read of `sys_documentation` anywhere). The state words are classified
from display text by five English-only regex lists, none keyed by table.

Best served: incident, then CSM case, then requested item. Worst served: change, custom/other tables, then sc_task, HR case, the
task kinds (change_task, problem_task, incident_task, CSM task, HR task), sc_request.

## 1. Matrix per kind

Legend. READS = columns in the kind's display ceiling (`src/context/allowlists.js:56-111`) plus the extras (`specs/*.js`).
SHOWS = what a no-AI card draws. SAYS = the words. CLOSES = what Prepare to close / the close row touch. NEEDS = what the worker
opens first.

### incident (agent)
- READS: number, short_description, description, state, hold_reason, priority, impact, urgency, category, subcategory, group,
  assignee, caller_id, opened_by, cmdb_ci, business_service, dates, close_code, close_notes, contact_type, parent (allowlists.js:56-61), plus problem_id, reopen/reassignment counts (specs/checks.js:88, specs/itsm.js:88).
- SHOWS: Glance (state, SLA, owner, customer waiting, VIP), missing details, routing, steps, caller's other tickets, related, knowledge, recent changes and known errors on the CI, outage, risk, email, journey, Ready to resolve (cards/index.js:63-86).
- SAYS: "Caller", "Resolution notes" (box), "Ready to resolve?". Right for this kind.
- CLOSES: close_code (choice, by stored value, `CODE_KINDS = ['incident']`, prepareClose.js:25) + close_notes. Matches the OOB incident (close_code and close_notes are the mandatory pair; ASSUMED OOB).
- NEEDS vs gap: nothing material. Best served.

### problem (agent)
- READS: known_error, cause_notes, workaround, fix_notes, resolution_code, close_notes (allowlists.js:62-65).
- SHOWS: no card shows the problem's own known-error flag, workaround or cause. Linked incidents are read only for the AI RCA (related.js `readLinkedIncidents`, specs/domain.js:60) although `docs/agent-pain-points.md:140` promised them "as Insights on the problem"; there is no such card in `INSIGHT_CARDS` (cards/index.js:63-86) (VERIFIED).
- SAYS: "Caller's other tickets" for a problem (no caller; falls to `opened_by`, callerTickets.js:21-24).
- CLOSES: inserts fix_notes and cause_notes (core.js:96-97). `resolution_code` is a hand pick (prepareClose.js:23-25). Fine.
- Gap: the problem's workaround and linked-incident count are what the worker opens first and they are AI-only.

### change (agent)
- READS: type, risk, start/end, approval, conflict_status, close_code, close_notes, requested_by (allowlists.js:72-76) plus justification and plans (specs/domain.js:100-103, only for the CAB brief).
- SHOWS: only Glance, Caller's other tickets (resolves to nobody: change has no caller_id/opened_by, `CALLER_ROLES` lacks `requested_by`, callerTickets.js:24), Related, Which email fits, Journey. No Missing details, Steps, Knowledge, Risk signals, Changes-on-CI or Ready to resolve (kinds lists, cards/index.js:50-86). The glance READS type/risk/start/end (specs/insights.js:34) but `glanceDetails` draws none of them (Glance.jsx:44-58). Conflicts, approvals, change tasks exist only inside the AI "Prepare the CAB brief" (domain.js:196-249), which is the `mpc` profile only (profiles.js FEATURE_PROFILES).
- SAYS: nothing change-specific.
- CLOSES: nothing. `resolution-notes` kinds exclude change (core.js:83); no `close_code` fill (CODE_KINDS), no Ready-to-resolve. OOB change closure needs close code and notes (ASSUMED).
- Worst no-AI coverage of any agent kind.

### request (sc_request) (fulfiller)
- READS: request_state, stage, approval, requested_for, special_instructions, due_date. No close_notes (allowlists.js:77-80).
- SHOWS: Request status card (items chain with approvals), caller card, related, knowledge, email, journey, Ready to resolve.
- Gap: Ready to resolve applies to `request` (cards/index.js:86) but the ceiling has no close_notes, so its notes check can only ever say "No resolution notes yet" (resolutionCheck.js:147). ASSUMED: sc_request does have a close notes box (inherited from task).

### requested_item (RITM) (fulfiller)
- READS: cat_item, request, requested_for, stage, approval, quantity, due_date, close_notes (allowlists.js:81-85). `quantity` is in the ceiling but NO spec reads it (grep: only allowlists.js:84) (VERIFIED). Answers: `sc_item_option_mtom` with question text labels, falling back to the variable name; secret/layout types dropped; reference answers resolved to names; ordered by `order` (related.js:161-306). Question labels are in the person's words (VERIFIED). Variable sets: ASSUMED included because they ride the same mtom table.
- SHOWS: Request status (one chase line, approvals, task chain with the open one marked, answers folded), checklist from the instructions. NOT drawn: `view.facts` (Requested for, Catalog item, Stage, Approval, Opened) is built (requestView.js:107) but `RequestCard.jsx:43` destructures only `{ status, answers, approvals, chain }` (VERIFIED). The Glance "Ticket details" (folded by default, Glance.jsx:32-37) names "Requested for" but never the catalog item or quantity.
- SAYS: "Requested for" (Glance), "Catalog tasks", "Answers to the request questions". Good.
- CLOSES: close_notes, labelled "Close notes" (core.js:95); no state step is mentioned. Children check ("N catalog tasks still open") is right (resolutionCheck.js:41-45).
- Well served. Gaps: facts line, quantity.

### catalog_task (sc_task) (fulfiller, the common case)
- READS: number, short_description, description, state, priority, request_item, group, assignee, opened_by, dates, due_date, close_notes, special_instructions, hold_reason (allowlists.js:86-89, specs/checks.js:96). NO requested_for, NO request, NO cat_item, no quantity. RELATED = `['slas']` only (related.js:25): no variables, no approvals.
- SHOWS: Request card and Checklist card climb to the parent RITM (`requestTarget`, ops/checks.js:201-212; RequestCard.jsx:19-33; ChecklistCard.jsx:25-30) so answers, approvals and sibling tasks (marked "(this one)") DO show. That is the good news. Not shown anywhere: who the task is for.
- SAYS: "Caller's other tickets" (it is `opened_by`), "Customer replied" / "Waiting on customer" / "No update to the customer" in My work, "Ready to resolve?", "No resolution notes yet ... the cause", "the caller has not confirmed".
- AI: only `request-explain` and `fulfilment-checklist` climb to the RITM (checks.js:94, 161). Summarise, Draft reply, Write resolution notes, Prepare to close, Next steps, Hand-off, Brief me on the caller read the bare task (no answers, no requester, no item) (VERIFIED: no `enrich` on them).
- CLOSES: close_notes only, box named "Close notes" (core.js:95). The state change (Closed Complete 3 / Incomplete 4 / Skipped 7) is never named; "Then press Save" is the whole instruction (fillable.js `describeInsert`).
- Worst of the common kinds.

### case (CSM) (agent)
- READS: account, contact, consumer, product, asset, entitlement, resolution_code, close_notes, parent (allowlists.js:90-94).
- SHOWS: Account at a glance (account, entitlement, product, asset, the account's other cases, recent changes on the CI, priority-account mark; AccountCard.jsx), plus the incident set. Caller = contact/consumer, correct (callerTickets.js:24).
- CLOSES: resolution_code is picked by hand, close_notes inserted. Resolve check has the code check (resolutionCheck.js:31).
- Well served.

### hr_case (HR) (sensitive)
- READS: hr_service, subject_person, opened_for (allowlists.js:95-99), only with `allowSensitive` (HR_HIDDEN). Identities/free text hidden otherwise (VERIFIED, allowlists.js:123-124).
- SHOWS: caller card (employee), related, knowledge, email, journey. No Missing details, Steps, Ready to resolve (cards/index.js). HR service is in the pack but `labelFor('hr_service')` falls through to "Hr service" (parts.js:45; no LABELS entry).
- CLOSES: nothing. `resolution-notes` kinds exclude hr_case (core.js:83); no resolve card. "Close well" row is empty for HR. (HR content may be policy-blocked anyway; for the allowed case this is a hole.)

### task kinds (change_task, problem_task, incident_task, CSM task, HR task) -> kind `task` (kinds.js:8-22)
- READS: the generic task ceiling (allowlists.js:100-104): parent number as text only.
- SHOWS: no card reads `parent` (grep over src/sidepanel and src/insights: no hit), so the user is never told "this is a task of CHG0030001" or given the link. Caller = `opened_by`.
- Replies: `hasCustomer` is false only for change_task and problem_task (stages.js:138); incident_task, CSM task and HR task are offered "Draft a reply to the customer".

### other / custom u_* x_* tables
- READS: generic ceiling without cmdb_ci, category, caller (allowlists.js:105-110).
- SHOWS: NO Insights card lists `other` (cards/index.js:50-86 all exclude it) (VERIFIED). AI: Summarise and Catch up only. My work does list them (class count on `task`, read.js countByClass), under the instance's own class label (`pluralOf`, tables.js:75-83), but with no customer column, so no "replied" marker and no follow-ups (`hasCustomer` false).

## 2. Words (question 2), per the brief

| Where | Hard-coded for incident | Wrong for | Evidence |
|---|---|---|---|
| "Caller", "Same caller", "the caller wrote", "Nobody is named as the caller" | caller | RITM (requester), HR (employee), CSM (customer), sc_task | focus.js:30; resolutionCheck.js:423; related.js insights:46; CallerCard.jsx:44. Only the Glance row picks the column's own label (Glance.jsx:32-37) |
| "Customer replied / Waiting on customer / Customer not updated" (My work) | customer | sc_task, HR, change | mywork/parts.jsx:14-16; followups.js:100-107 |
| "Ready to resolve?", group "Resolve", "No resolution notes yet ... what was the cause" | resolve, cause | sc_task/RITM ("Close complete", "what was delivered") | cards/index.js:86; stages.js GROUPS; resolutionCheck.js:147 |
| Insert label: "Resolution notes" vs "Close notes" | right per kind for the insert button | OK | core.js:94-95 (the one place that is kind-aware) |
| AI "service desk agent" / "ticket" / "customer" | all prompts | fulfiller, HR, change | core.js:36,64,100,130,155; itsm.js:95,129,161,207; compose.js:77; only checks.js:165 says "fulfiller" |
| Summary lines "Issue / Impact / Done so far / Current state / Next step" | incident shape | RITM/sc_task/change | core.js:36-42 |
| Resolution lines "Cause / Fix / Verification / Suggested close code" | incident shape | sc_task, RITM (what was delivered), change | core.js:100-106, checks.js:133-139 |
| Instance's renamed labels | not followed anywhere | any renamed field | `grep sys_documentation|sys_dictionary|getLabel src` = no hit (VERIFIED) |
| Field labels in AI parts | fixed English `LABELS`; missing entries show "Hr service", "Request item" | HR, sc_task | parts.js:12-45 |
| Workspace box lookup | fixed `fieldLabel` ('Resolution notes', 'Close notes') used as aria-label fallback | renamed or translated forms | formFields.js:19-23, fillable.js FIELD_NAMES |

## 3. States (question 3)

Per-table meaning is NOT handled. Five classifiers read the DISPLAY text only; none takes the table; `workState` alone has stored
overrides, for incident/case/problem only (mywork/states.js:24-26). A run of the real modules (`cls.mjs`) gave:

```
table / state                   | features/stages | insights/order | mywork/states | reports (stateClass)
sc_task Pending                 | new             | hold           | on-hold       | waiting
sc_task Open                    | working         | new            | open          | working
sc_task Work in Progress        | working         | progress       | open          | working
sc_task Closed Complete/Incompl/Skipped | closed  | closed         | resolved      | resolved   (checks: done / ended / ended)
sc_req_item Pending             | new             | hold           | on-hold       | waiting
change Assess                   | new             | progress       | open          | new
change Authorize / Scheduled    | working         | progress       | open          | new
change Review                   | resolve         | progress       | open          | working
hr_case Ready                   | new             | progress       | open          | other
hr_case Awaiting Info           | working         | hold           | waiting-customer | waiting
problem Root Cause Analysis     | working         | progress       | open          | other
sc_task "Geschlossen abgeschlossen" (German "Closed Complete") | null | progress | open | other
```

Consequences for a fulfiller (VERIFIED by the run): an sc_task in Pending (waiting on approval or an earlier task) is a "new
ticket" to the Ticket screen (suggestions start with Summarise, "Prepare to close" is hidden) and "on hold" to My work and the
Insights order. An sc_task in Open (the normal working state, 1) is "new" to the Insights order (which puts Missing details and
routing first for a "new" ticket) and "working" elsewhere. `stage` on the RITM (Request Approved / Fulfillment / Delivery) is read
(allowlists.js:82) but not used by any classifier. A non-English instance: display-text regexes miss (stage null); the actions
are not hidden (null never hides), so it fails soft, but the ordering and the follow-up logic fall back to "open".

What a fulfiller sees for "close well": the Close row shows "Nothing wrong, a few notes" on practically every sc_task, never
"Looks ready", because the customer check is always `info` for a kind whose customer is not on the pack (`identities().known` is
false: resolutionCheck.js:165-185, identity.js:14,71-79). The code check and link check do not apply (CODE_FIELD,
LINK_KINDS: resolutionCheck.js:31,35). There is no children check on an sc_task (CHILD_LIST, :37-44).

## 4. Close, per kind (question 4)

| Kind | Fields OOB needs (ASSUMED) | Prepare to close fills | Check row | Gap |
|---|---|---|---|---|
| incident | state Resolved, close_code, close_notes | close_code (by value) + close_notes | notes, code, customer, links, pii, hold | none |
| problem | state, resolution_code, fix_notes/cause_notes | fix_notes, cause_notes | notes, code (by hand) | resolution_code by hand: acceptable |
| change | close_code, close_notes | nothing | none (no resolve card) | no close help at all |
| request | state, close_notes | nothing (kind excluded, core.js:83) | notes check always warns (no close_notes in ceiling) | wrong warning |
| RITM | state Closed Complete/Incomplete/Skipped, close_notes | close_notes ("Close notes") | notes, customer, children (tasks still open), pii | state step unnamed |
| sc_task | state 3/4/7, close_notes | close_notes | notes (words "cause/fix"), customer (always info), pii | state step unnamed; prompt and words are incident-shaped |
| case | state, resolution_code, close_notes | close_notes ("Resolution notes") | notes, code, customer, children, links | none |
| hr_case | state, close_notes (ASSUMED) | nothing | none | no close help |
| task kinds | state, close_notes | close_notes | notes, customer, children, links | `customer` for change_task/problem_task has no customer |
| other | unknown | nothing | none | none |

## 5. Reply (question 5)

| Kind | Who the panel calls the caller | Channel the insert uses | Right? |
|---|---|---|---|
| incident | caller_id | `comments` | yes |
| problem | opened_by (fallback) | `comments` | weak: the "customer" is a stakeholder |
| change | nobody (requested_by not mapped) | no reply feature | acceptable, but "Nobody is named" is shown |
| request / RITM | requested_for | `comments` | yes (RITM comments reach the requester; ASSUMED for sc_request) |
| sc_task | opened_by (requester NOT on pack) | `comments` of the sc_task | no. The repo itself says the requester does not see sc_task comments (stages.js:172-175, docs/live-questions/assist.md item 6). The draft is offered, then the caution is shown |
| case | contact / consumer | `comments` | yes |
| hr_case | opened_for / subject_person | `comments` | yes (if HR allowed) |
| task kinds | opened_by | `comments` | offered on incident_task, CSM task, HR task (INTERNAL_TASK_TABLES lists only change_task and problem_task) |

Four modules disagree on whether an sc_task has a customer: `stages.js:138` (yes), `itsm.js:18` INTERNAL (no, no mood check),
`mywork/tables.js:38` (yes, via request_item.requested_for), `identity.js:14` CUSTOMER_ROLES (cannot find one). Root cause of
many findings below.

## 6. My work and Team for fulfillers (question 6)

- My work is NOT incident-centric (good, VERIFIED). It counts `task` by class (read.js `countByClass`, one Aggregate read), reads
  each class from its own table (own state labels, own customer column), covers sc_task, RITM, CSM case and task, HR case and
  task (HR only with the HR profile and HR content allowed), change/problem tasks and custom classes (cap 12 classes), shows
  "Approvals waiting on you" and "Unassigned in my groups" (assignment_group IN my groups, assigned_to empty, active). Words:
  the class's own singular/plural, or the instance's class label for unknown classes (tables.js:75-90). Right.
- Gaps: (a) the unassigned queue is sorted oldest-first only (read.js `live...sort(openedAt)`) although SLAs are read for those
  rows; for a fulfiller picking work, breached/at-risk SLA and priority should lead. (b) It lists Pending sc_tasks (not ready)
  next to Open ones with no distinction beyond the chip. (c) The row shows the task's short description, not who it is for or
  which item (an sc_task title is often the item name; ASSUMED). (d) "Customer replied / No update to the customer" logic treats
  an sc_task as customer-facing, see F5.
- Team: has a "Request fulfilment" section (requested items and catalog tasks by state, approvals waiting, oldest open:
  reports/engine/fulfilment.js:7). `REPORT_TABLES` (constants.js:12-72) has no sc_request, sn_customerservice_task,
  sn_hr_core_task, incident_task, problem_task or custom classes, so a lead of a CSM-task or HR-task group sees nothing for them.
  Its `stateClass` is the fourth classifier.

## 7. Silently incident-centric (question 7)

| Where | What | Effect on other kinds |
|---|---|---|
| callerTickets.js:24, identity.js:14 | caller roles; `opened_by` fallback | sc_task, task kinds, problem, change: wrong or no caller |
| allowlists.js:86-89 | sc_task ceiling lacks requested_for/request/cat_item | requester, item, quantity missing everywhere on the task |
| related.js:19-29 RELATED_BY_KIND | variables only for RITM | no answers for AI on sc_task |
| resolutionCheck.js:31-45 | CODE_FIELD, CHILD_LIST, LINK_KINDS | no checks that fit sc_task/change/HR |
| prepareClose.js:25 | CODE_KINDS incident | only incident gets the code filled |
| core.js:36-106 | prompts and five-line shapes | wrong shape for RITM/sc_task/change |
| order.js:12 `stateBucket`, stages.js:40-43 | "open" means new / "pending" means new | sc_task |
| cards/index.js:50-52 | `FAULTS`, `WITH_CI` lists | change and 'other' excluded |
| history.js:19-24 | history tables: incident, RITM, case, HR case | fine for callers; no change history (OK) |
| notesToTicket.js:38 | `TICKET_KINDS = incident, case` | by design |

## 8. AI prompts (question 8)

The model is never told the record type or the kind of worker. Every core prompt opens "You help a service desk agent ..." and
treats the data as "a ServiceNow ticket" (VERIFIED, lines above). The record's `Number` (INC/RITM/SCTASK/CHG) and field labels
are in the data, so a good model can infer, but the output SHAPE is fixed by the prompt: a summary with "Impact" for a laptop
order, resolution notes with "Cause: what went wrong" for a delivered account. The one fulfiller prompt is the checklist
(checks.js:165). A fixed one-sentence kind line chosen by `pack.kind` and appended to `system` is allowed by build rule 3 (fixed
text) and is invisible.

## 9. Findings table

Severity: High = a fulfiller or agent on a COMMON ticket gets wrong, empty or misleading output.
Invisible = no new screen element, inside the five rows; New UI = flagged.

| ID | Sev | Kind | Scenario | File:line | Fix direction | Invisible / New UI | Status |
|---|---|---|---|---|---|---|---|
| F1 | High | sc_task | The requester is not on the pack. "Caller's other tickets", the caller briefing, the email greeting ("Hello,") and the customer check all use `opened_by` or nobody. The requester lives on the parent RITM | allowlists.js:86-89; callerTickets.js:21-24; identity.js:14; Glance.jsx:32-37 | Read `request_item.requested_for` (dot-walk, like My work already does, tables.js:38) into the sc_task pack under role `requested_for`, plus `request_item.cat_item`; add to the ceiling as aliases and to PERSON_COLUMNS | Invisible | VERIFIED (code). ASSUMED: sc_task.opened_by is often a system or workflow user, not the requester |
| F2 | High | sc_task | AI Summarise, Draft reply, Resolution notes, Prepare to close, Next steps, Hand-off, Caller briefing run on the bare task: no answers, no item, no requester. Only request-explain and checklist climb to the RITM | related.js:25; checks.js:94,161; core.js:30-48 | One generic parent merge in `readContextPack` (or a shared `enrich`) for sc_task: variables + approvals + requested_for + cat_item from the RITM with the RITM's own spec | Invisible | VERIFIED |
| F3 | High | RITM, sc_task | "Requested for", catalog item, stage and approval are read and built (`view.facts`) but not drawn; quantity is never read. The fulfiller cannot see who/what/how many without opening the form | requestView.js:107-118; RequestCard.jsx:43; allowlists.js:84 | Draw one line "For X · Item · Qty n" inside the existing status line / Understand row; read `quantity` in `request-status` | Invisible (inside the existing card line) | VERIFIED |
| F4 | High | sc_task, RITM | Close is incident-shaped: prompt asks "Cause / Fix / Verification / Suggested close code"; check says "No resolution notes yet ... what was the cause"; the Close row always says "a few notes" because the customer check is always info; "Ready to resolve?" title | core.js:100-106; checks.js:133-139; resolutionCheck.js:147,165-185; cards/index.js:86 | Per-kind prompt variant (fulfilment: what was delivered, to whom, how confirmed; no close-code line) and per-kind check wording; skip the customer check where the customer is not on the record | Invisible | VERIFIED |
| F5 | High | sc_task (and any task whose requester sits on the parent) | My work "Follow-ups due" lists every sc_task older than N days as "No update to the customer in N d" with a "Copy draft"; "Customer replied" compares the sc_task's comments with the RITM requester, who cannot comment there | tables.js:38; followups.js:75,100-107; read.js `customerColumn` use; stages.js:172-175 | Treat sc_task like change_task for follow-ups (no customer), or read the RITM's comments; do not offer the draft | Invisible | VERIFIED (logic). ASSUMED: requester sees no sc_task comments (repo's own assumption, live-questions/assist.md item 6) |
| F6 | High | change | No no-AI view of risk, type, schedule, approval, conflicts or plans; no Missing/Steps/Knowledge/Risk/Ready-to-resolve cards; no caller (requested_by unmapped); no close help; CAB brief is AI + `mpc` profile only | cards/index.js:50-86; Glance.jsx:44-58; specs/insights.js:34; callerTickets.js:24; core.js:83; profiles.js FEATURE_PROFILES | Add a change line (type · risk · window · approval · conflicts count) to the existing Understand row and Ticket details; map `requested_by` as the change's person; add change to resolution-notes (close_code + close_notes) | Mostly invisible (a line in an existing row); a conflicts list is New UI | VERIFIED |
| F7 | High | custom u_*/x_* | A custom task table gets zero Insights cards and only two AI actions; My work lists it but with no customer logic | cards/index.js:50-86; allowlists.js:105-110; tables.js:38-49 | Map unknown task-derived classes to the generic `task` ceiling and add `other` to journey, related, email, knowledge | Invisible | VERIFIED (cards). ASSUMED: custom classes extend `task` |
| F8 | Medium | sc_task | `reply-draft` and `missing-info` are offered on sc_task and insert into the sc_task's `comments`, the box the requester does not read; the caution is shown after | core.js:61-92,150-165 (WORKABLE); stages.js:172-175 | Retarget the draft to the parent RITM (link to it) or hide on sc_task and offer request-explain | Invisible + a link target | VERIFIED. ASSUMED requester visibility |
| F9 | Medium | all non-incident | State meaning is not per table; sc_task Pending is new/hold/on-hold; Open is working/new; change Assess/Authorize/Scheduled differ; non-English display text falls through. `stage` unused | stages.js:40-43; order.js:12-18; mywork/states.js:15-26; reports/engine/common.js:30; checks/states.js:12 (run output in section 3) | One classifier keyed by (table, stored value) with the display text as fallback; read `state` value in the header read | Invisible | VERIFIED (ran it) |
| F10 | Medium | all | Labels never follow the instance (renamed/translated); AI part labels fixed English; "Hr service" fallback | grep sys_documentation = 0; parts.js:12-45; fillable.js FIELD_NAMES; formFields.js:19-23 | Read field and table labels once per table (sys_documentation) and use them for display and Workspace lookup | Invisible | VERIFIED (absence). ASSUMED: sys_documentation readable by a non-admin |
| F11 | Medium | all non-incident | The five-row title "Same caller", "the caller wrote", "Nobody is named as the caller" for requester, employee, customer contact | focus.js:30; resolutionCheck.js:423; insights/related.js:46; CallerCard.jsx:44 | A per-kind noun (requester, employee, customer) in the same strings; row title stays short | Invisible (same row) | VERIFIED |
| F12 | Medium | sc_task, RITM, change, HR | AI prompts never name the record type or the worker; summary has "Impact", notes have "Cause" | core.js:36,64,100,130,155; itsm.js:95 | Append one fixed kind sentence by `pack.kind` | Invisible | VERIFIED |
| F13 | Medium | sc_task, RITM | Prepare to close never names the state step (Closed Complete / Incomplete / Skipped); "Then press Save" is all it says | fillable.js `describeInsert`; prepareClose.js:25-65 | Per-kind next-step line ("set State to Closed Complete, then Save") | Invisible | VERIFIED. ASSUMED state is mandatory |
| F14 | Medium | problem | Known error, workaround, cause and linked incidents are read but only the AI RCA uses them; the promised Insights are not built | cards/index.js; related.js readLinkedIncidents; agent-pain-points.md:140 | A "Known error: workaround" + "N linked incidents" line in the Understand row; Copy workaround exists in KnownErrorsCard | Invisible | VERIFIED |
| F15 | Medium | task kinds | `parent` is read as text only; never shown or linked; caller = opened_by; reply offered on incident_task, CSM task, HR task | allowlists.js:100-104; stages.js:138; (no sidepanel use of `parent`) | Show "Part of CS0001234" with a link in the Understand row; read the parent's person | Invisible (line + link) | VERIFIED |
| F16 | Medium | HR case | No Ready-to-resolve, no close assist, no Missing/Steps; row 5 absent; HR service label "Hr service" | cards/index.js:63-86; core.js:83; parts.js:45 | Add hr_case to resolution-notes and resolve with close_notes only; add LABELS | Invisible | VERIFIED. HR may be policy-blocked |
| F17 | Medium | all (fulfiller pickup) | Unassigned-in-my-groups is oldest-first only, not by SLA/priority; Pending (not ready) tasks mixed in | read.js groupQueue `live...sort`; cards.jsx GroupsCard | Order by SLA risk, priority, then age; dim `on-hold` items | Invisible | VERIFIED |
| F18 | Medium | sc_task | Knowledge and look-alike search for an sc_task have no catalog item (`kb-recs` and `similar` read cat_item for RITM only) | allowlists.js 'kb-recs'/'similar' by: requested_item | Same dot-walk as F1 (`request_item.cat_item`) | Invisible | VERIFIED |
| F19 | Low | request | Ready to resolve applies to `request`, whose ceiling has no close_notes: the notes check is always the same warning | cards/index.js:86; allowlists.js:77-80; resolutionCheck.js:147 | Drop `request` from `resolve`, or add close_notes | Invisible | VERIFIED. ASSUMED sc_request has a notes box |
| F20 | Low | Team | REPORT_TABLES lacks sc_request, sn_customerservice_task, sn_hr_core_task, incident_task, problem_task, custom | reports/engine/constants.js:12-72 | Add the task classes (HR sensitive-gated) | New section content, not new UI | VERIFIED |
| F21 | Low | RITM, sc_task | Fulfilment instructions are read only from the task `description` and `special_instructions`; the catalog item's own fulfilment text is not read | specs/checks.js:63-67; checklist.js:273 | Read the item's instructions via `request_item.cat_item` (dot-walk) if the user can see sc_cat_item | Invisible | ASSUMED (where the instructions live) |
| F22 | Low | problem | Reply draft and "Caller's other tickets" offered with `opened_by` as the person | stages.js hasCustomer; callerTickets.js:24 | Treat problem like change_task (no customer) | Invisible | VERIFIED |
| F23 | Low | RITM | Approval state is shown (approver names, state tags), but the approval request date and "who to chase" for a group approval are only in the status line | requestStatus.js, RequestCard.jsx:50-60 | none needed; mention only | - | VERIFIED (works) |

## 10. Fixes that fit inside the five rows, versus new UI (question 9)

Invisible, inside the existing rows (preferred): F1, F2, F4, F5, F7, F9, F10, F11, F12, F13, F15, F16, F17, F18, F19, F21, F22.
Two of them (F1+F2+F18) are one change: a parent read for sc_task in the pack reader, which also fixes the caller card, the
caller briefing, the email greeting, the customer check, knowledge and look-alikes.

One line in an existing row (no new component): F3 (For/Item/Qty), F6 (change facts line), F14 (workaround and linked-incident
count), F15 (parent link).

Needs new UI or a content decision (flag): F6 conflicts list; F8 (an "Open the requested item" action replaces a button);
F20 (Team table choices).

## 11. What is already right (so it is not undone)

Question labels from `question_text`, with the variable name as the fallback; secret/masked answers left out with a count;
references shown as names, never ids (related.js:230-300). Approvals, sibling tasks and the "(this one)" marker. The sc_task to
RITM climb for the Request card, checklist, request-explain. My work reads each class from its own table (own state labels),
handles unknown classes by the instance's own label, shows approvals and the group queue. The Insert label "Close notes" vs
"Resolution notes" vs "Fix notes" by kind. The CSM account card and case escalation. No raw table names reach a person in
My work (class labels).
