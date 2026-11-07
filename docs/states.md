# One meaning of a ticket's state

From the audit of 2026-11-07 (part 7, F9) and the open decision of the audit of 2026-11-04 ("Still yours to decide", item 2). The owner
delegated the choice; this page is the table to review. Built in `src/domain/states.js`; `tests/states-*.test.js` check every row below
(`tests/states-docs.test.js` fails when a row of the code is not on this page, or says something else).

Before, five places each read a state's display text their own way, so the same ticket was "new", "working" and "on hold" at once:
the Ticket screen's stage (`src/features/stages.js`), the Insights card order (`src/insights/order.js`), My work
(`src/mywork/states.js`), the Team reports (`src/reports/engine/common.js`) and the checks (`src/checks/states.js`). Now there is one
reader, `classifyState({ table, value, label, stage })`, and each screen turns its answer into the words it already uses.

## How a state is understood

1. **The stored value, by table.** ServiceNow's own choice values are fixed: an incident's 3 is On Hold whatever the site calls it and
   in whatever language. A table marked **Sure** below is believed first.
2. **The label the person sees**, by words in English, German and Arabic (a new language is a new list of words in the same file). It
   decides when there is no stored value, when the value is one this file does not know (a state the site added), and, for a table that
   is not Sure, when the label is recognised and the value is not.
3. **Neither:** `unknown`. Every screen treats unknown as live work, never as closed and never as waiting ("fail towards look at it").

## The seven meanings, and what each screen does with them

| Meaning | Ticket screen (stage) | Insights card order | My work | Team report | Checks |
|---|---|---|---|---|---|
| new | new: the first suggestions are Summarise, missing details, routing | new: Missing details and Routing first | new (chip "New") | New | open |
| working | working | progress | open: waiting on you | Open or in progress | open |
| waiting | working (reply and move it on) | hold: the right email first | on-hold, or waiting-customer when the wait is for the customer: in "Waiting on the customer or others" | Waiting or on hold | on hold |
| resolved | resolve: wrap up, Prepare to close first | resolved: Ready to resolve? first | resolved: "Resolved, awaiting closure" | Resolved, not closed | done |
| closed | closed | closed | resolved (only while still active) | Resolved, not closed (only while still active) | done |
| cancelled | closed | closed | resolved (only while still active) | Resolved, not closed (only while still active) | ended (finished without the work being done) |
| unknown | no stage: the everyday suggestions | progress | open | Other | open |

## The table

One row per table and value. "ServiceNow's label" is the base system's English label, for reading only. **Sure** = the values are the base
values and are believed before the label (everything else is ASSUMED: `docs/live-questions/audit-1107-states.md` says how to check each).
A table that is not listed (a custom class, anything else) has no values: its labels decide.

| Table | Stored value | ServiceNow's label | Meaning | Ticket screen | Insights order | My work | Team | Sure | Why |
|---|---|---|---|---|---|---|---|---|---|
| incident | 1 | New | new | new | new | new | new | yes | Not started. VERIFIED LIVE 2026-11-07. |
| incident | 2 | In Progress | working | working | progress | open | working | yes | Being worked. VERIFIED LIVE 2026-11-07. |
| incident | 3 | On Hold | waiting | working | hold | on-hold | waiting | yes | On hold, whatever the site calls it. The hold reason says for whom (1 = the caller). VERIFIED LIVE 2026-11-07. |
| incident | 6 | Resolved | resolved | resolve | resolved | resolved | resolved | yes | Done, but the incident stays active until it closes by itself, so it is not open work. VERIFIED LIVE 2026-11-07. |
| incident | 7 | Closed | closed | closed | closed | resolved | resolved | yes | Finished. VERIFIED LIVE 2026-11-07. |
| incident | 8 | Canceled | cancelled | closed | closed | resolved | resolved | yes | Ended without being done. VERIFIED LIVE 2026-11-07. |
| problem | 101 | New | new | new | new | new | new | yes | Not started. VERIFIED LIVE 2026-11-07. |
| problem | 102 | Assess | working | working | progress | open | working | yes | Someone is assessing it: live work. Was "new" on the Ticket screen and in Team, "open" in My work. VERIFIED LIVE 2026-11-07. |
| problem | 103 | Root Cause Analysis | working | working | progress | open | working | yes | Being worked. VERIFIED LIVE 2026-11-07. |
| problem | 104 | Fix in Progress | working | working | progress | open | working | yes | Being worked. VERIFIED LIVE 2026-11-07. |
| problem | 106 | Resolved | resolved | resolve | resolved | resolved | resolved | yes | Done; stays active until it closes. VERIFIED LIVE 2026-11-07. |
| problem | 107 | Closed | closed | closed | closed | resolved | resolved | yes | Finished. VERIFIED LIVE 2026-11-07. |
| change_request | -5 | New | new | new | new | new | new | yes | Not started. VERIFIED LIVE 2026-11-07. |
| change_request | -4 | Assess | working | working | progress | open | working | yes | Someone is assessing it: live work. Was "new" on the Ticket screen and in Team, "open" in My work. VERIFIED LIVE 2026-11-07. |
| change_request | -3 | Authorize | waiting | working | hold | on-hold | waiting | yes | Waits for a decision (an approval). Was "working", "new" and "open" on different screens. VERIFIED LIVE 2026-11-07. |
| change_request | -2 | Scheduled | working | working | progress | open | working | yes | Approved and dated; nothing blocks it, so it stays live work. Was "new" in Team. VERIFIED LIVE 2026-11-07. |
| change_request | -1 | Implement | working | working | progress | open | working | yes | Being carried out. VERIFIED LIVE 2026-11-07. |
| change_request | 0 | Review | working | working | progress | open | working | yes | The review after the change is still work (a person closes it). Was "resolve" on the Ticket screen. VERIFIED LIVE 2026-11-07. |
| change_request | 3 | Closed | closed | closed | closed | resolved | resolved | yes | Finished. VERIFIED LIVE 2026-11-07. |
| change_request | 4 | Canceled | cancelled | closed | closed | resolved | resolved | yes | Ended without being done. VERIFIED LIVE 2026-11-07. |
| change_task | -5 | Pending | waiting | working | hold | on-hold | waiting | yes | VERIFIED LIVE 2026-11-07. Not ready: waits for an earlier task or an approval. |
| change_task | 1 | Open | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07. Ready to be worked. |
| change_task | 2 | In Progress | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07. Being worked. |
| change_task | 3 | Closed | closed | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07. Finished and done. |
| change_task | 4 | Canceled | cancelled | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07. Ended without the work being done ("ended" in the checks). |
| change_task | 7 | Closed Skipped | cancelled | closed | closed | resolved | resolved | yes | Not on the live list (a change task offers -5, 1, 2, 3 and 4); kept for a stored value an import may have left. Not verified. |
| incident_task, sc_task, sc_req_item | -5 | Pending | waiting | working | hold | on-hold | waiting | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Not ready: waits for an earlier task or an approval. Was "new" on the Ticket screen, "on hold" elsewhere. |
| incident_task, sc_task, sc_req_item | 1 | Open | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Ready to be worked. Was "new" in the Insights order, "working" or "open" elsewhere. |
| incident_task, sc_task, sc_req_item | 2 | Work in Progress | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Being worked. |
| incident_task, sc_task, sc_req_item | 3 | Closed Complete | closed | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Finished and done. |
| incident_task, sc_task, sc_req_item | 4 | Closed Incomplete | cancelled | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Finished without the work being done ("ended" in the checks). |
| incident_task, sc_task, sc_req_item | 7 | Closed Skipped | cancelled | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07 for sc_task and sc_req_item (the task values); incident_task was not looked at. Skipped: finished without the work being done ("ended" in the checks). |
| problem_task | 151 | New | new | new | new | new | new | yes | VERIFIED LIVE 2026-11-07. Not started. |
| problem_task | 152 | Assess | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07. Someone is assessing it: live work. |
| problem_task | 154 | Work in Progress | working | working | progress | open | working | yes | VERIFIED LIVE 2026-11-07. Being worked. |
| problem_task | 157 | Closed | closed | closed | closed | resolved | resolved | yes | VERIFIED LIVE 2026-11-07. Finished. |
| problem_task | -5 | Pending | waiting | working | hold | on-hold | waiting | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| problem_task | 1 | Open | working | working | progress | open | working | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| problem_task | 2 | Work in Progress | working | working | progress | open | working | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| problem_task | 3 | Closed Complete | closed | closed | closed | resolved | resolved | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| problem_task | 4 | Closed Incomplete | cancelled | closed | closed | resolved | resolved | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| problem_task | 7 | Closed Skipped | cancelled | closed | closed | resolved | resolved | yes | Not on the live list (a problem task has its own values there); kept for a release that still uses the task values. Not verified. |
| sc_request | -5 | Pending | waiting | working | hold | on-hold | waiting | no | Assumed (question 6). |
| sc_request | 1 | Open | working | working | progress | open | working | no | Assumed (question 6). |
| sc_request | 2 | Work in Progress | working | working | progress | open | working | no | Assumed (question 6). |
| sc_request | 3 | Closed Complete | closed | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | 4 | Closed Incomplete | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | 7 | Closed Skipped | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | requested | Requested | new | new | new | new | new | no | Not started (the request state). Assumed (question 6). |
| sc_request | approved | Approved | working | working | progress | open | working | no | Approved, being fulfilled. Assumed (question 6). |
| sc_request | in_process | In Process | working | working | progress | open | working | no | Being fulfilled. Assumed (question 6). |
| sc_request | closed_complete | Closed Complete | closed | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | closed_incomplete | Closed Incomplete | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | closed_cancelled | Closed Cancelled | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | closed_rejected | Closed Rejected | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sc_request | closed_skipped | Closed Skipped | cancelled | closed | closed | resolved | resolved | no | Assumed (question 6). |
| sn_customerservice_case | 1 | New | new | new | new | new | new | no | Assumed (question 7). |
| sn_customerservice_case | 10 | Open | working | working | progress | open | working | no | Assumed (question 7). |
| sn_customerservice_case | 18 | Awaiting Info | waiting | working | hold | waiting-customer | waiting | no | Waits for the customer. Stored value 18 is what makes it "waiting for the customer". Assumed (question 7). |
| sn_customerservice_case | 6 | Resolved | resolved | resolve | resolved | resolved | resolved | no | Done; stays active until it closes. Assumed (question 7). |
| sn_customerservice_case | 3 | Closed | closed | closed | closed | resolved | resolved | no | Assumed (question 7). |
| sn_customerservice_case | 7 | Cancelled | cancelled | closed | closed | resolved | resolved | no | Assumed (question 7). |
| sn_customerservice_task, sn_hr_core_task, task | -5 | Pending | waiting | working | hold | on-hold | waiting | no | Not ready: waits for an earlier task or an approval. Was "new" on the Ticket screen, "on hold" elsewhere. Assumed (question 9). |
| sn_customerservice_task, sn_hr_core_task, task | 1 | Open | working | working | progress | open | working | no | Ready to be worked. Was "new" in the Insights order, "working" or "open" elsewhere. Assumed (question 9). |
| sn_customerservice_task, sn_hr_core_task, task | 2 | Work in Progress | working | working | progress | open | working | no | Being worked. Assumed (question 9). |
| sn_customerservice_task, sn_hr_core_task, task | 3 | Closed Complete | closed | closed | closed | resolved | resolved | no | Finished and done. Assumed (question 9). |
| sn_customerservice_task, sn_hr_core_task, task | 4 | Closed Incomplete | cancelled | closed | closed | resolved | resolved | no | Finished without the work being done ("ended" in the checks). Assumed (question 9). |
| sn_customerservice_task, sn_hr_core_task, task | 7 | Closed Skipped | cancelled | closed | closed | resolved | resolved | no | Skipped: finished without the work being done ("ended" in the checks). Assumed (question 9). |
| sn_hr_core_case | 2 | Work in Progress | working | working | progress | open | working | no | Assumed (question 8). |
| sn_hr_core_case | 18 | Awaiting Info | waiting | working | hold | waiting-customer | waiting | no | Waits for the employee. Assumed. Assumed (question 8). |
| sn_hr_core_case | 6 | Resolved | resolved | resolve | resolved | resolved | resolved | no | Assumed (question 8). |
| sn_hr_core_case | 3 | Closed Complete | closed | closed | closed | resolved | resolved | no | Assumed (question 8). |
| sn_hr_core_case | 4 | Closed Incomplete | cancelled | closed | closed | resolved | resolved | no | Assumed (question 8). |
| sn_hr_core_case | 7 | Cancelled | cancelled | closed | closed | resolved | resolved | no | Assumed (question 8). |

A requested item (`sc_req_item`) also has a stage. The stage `waiting_for_approval` (VERIFIED LIVE 2026-11-07) moves live or unknown
work to **waiting** (an approval); it never reopens a finished ticket. The other stages decide only where the state says nothing (see "Verified live"). `sc_request` values are the task values and its request state (text values). The
child tables of an HR case (`sn_hr_*_case`, `sn_hr_*_task`) and of customer service (`sn_customerservice_*_task`) take their family's row.
A kind (`change`, `request`, `requested_item`, `catalog_task`, `case`, `hr_case`) can stand where a table is asked for.

## Where this changes what a person saw

Each line is a disagreement the audits found, and the choice made. The reason in every case: the meaning ServiceNow gives the state, then
what an agent would expect, then the majority of the five readers (a state nobody could settle stays live work).

| State | Before | Now | Why |
|---|---|---|---|
| Open (a task) | new (Insights order), working (Ticket screen, Team), open (My work) | working | ready to be worked; "new" would put Missing details and Routing first on a task that is already routed |
| Pending (a task or a requested item), Awaiting Approval | new (Ticket screen), on hold (My work, Insights order), waiting (Team) | waiting | it cannot be worked yet; "Prepare to close" and "Draft a reply" were wrong for it |
| On Hold | working (Ticket screen), on hold (the rest) | waiting; the Ticket screen has no waiting stage, so it keeps "working" there | unchanged on every screen; the Ticket screen's four stages stay |
| Closed, Complete, Cancelled | resolved (Team, My work), closed (Insights order, Ticket screen) | closed or cancelled; each screen keeps its own word for "finished" | one meaning, the same words on each screen |
| Fulfilled, Delivered | not classified (Ticket screen), other (Team) | closed | finished and done |
| Skipped, Incomplete (Closed Incomplete, Closed Skipped) | closed (Insights order), open (My work: "Incomplete" alone), not finished (checks) | cancelled: finished without the work being done | the checks already called it "ended" |
| Review (a change) | resolve (Ticket screen), working (the rest) | working | the review is still work; a person closes the change |
| Scheduled (a change) | new (Team), working (the rest) | working | approved and dated; nothing blocks it |
| Assess (a change, a problem) | new (Ticket screen, Team), open (My work, Insights order) | working | someone is assessing it |
| Authorize (a change) | working (Ticket screen), new (Team), open (My work, Insights order) | waiting | it waits for a decision |
| Requested | open (My work), new (the rest) | new | not started |
| Ready (an HR case) | new (Ticket screen), progress (Insights order), open (My work), other (Team) | new | not started |
| Awaiting Info, Awaiting Caller (any table) | waiting (Team), on hold (Insights order), "waiting on the customer" (My work) | waiting; the hold reason or the words say it is for the customer | unchanged |
| A state in German or Arabic that the English words did not know | unknown, filed as open or "other" | understood by its stored value, or by its German or Arabic words | an Arabic or German label no longer falls through |

## Who a wait is for

`waitsOn(...)` says who a waiting ticket waits for: **customer** (an incident's hold reason 1 "Awaiting Caller", a case's state 18, or the
words caller, customer, user, requester, employee, info, reply, feedback, acceptance, confirmation, contact in the hold reason, or in the
label when there is no hold reason), **approval** (a change in Authorize, a requested item at the stage waiting for approval, or the word
approval or authorization), else **other** (a vendor, a change, a problem, an earlier task). The state decides whether a ticket waits; a
hold reason left behind after it went back to work never hides live work. My work shows "waiting on the customer" for the first and "on
hold" for the others; the Team hand-over splits its waiting list the same way.

## Add a customer's own state

A site that adds a state (an incident's "Awaiting Vendor" as 10) needs nothing when its label has the usual words (awaiting, waiting, hold,
pending, resolved, closed, cancelled, in progress...): the label decides. A state whose label has none of them ("With Acme") is
**unknown** and stays live work, which is safe but not exact. To make it exact:

1. Find the stored value: `docs/live-questions/audit-1107-states.md`, question 1 (one line in the browser console).
2. In `src/domain/states.js`, add a row `['10', 'With Acme', 'waiting']` to that table's `rows` in `STATE_TABLES`. For a table that is not
   there (a custom class) add the table with `sure: false`.
3. Add a row to the test in `tests/states-classify.test.js` and the same row to the table above (`tests/states-docs.test.js` tells you the
   exact line). Nothing else changes: every screen follows.

To add a language, add its words to the three lists of each meaning in `LABEL_RULES` and a test line for it.

## Who calls it

- **Built on it:** My work (`src/mywork/states.js` `workState`), the Team reports (`src/reports/engine/common.js` `stateClass`,
  `stateName`, `resolvedStates`; `overview.js` `waitingStates`; `workload.js` `foldByOwner`; `fulfilment.js` `stateRows`; `handover.js`
  `waitingKind`).
- **To re-point** (not mine to change, listed for the lead): `src/features/stages.js` `stageOfState` and `stageOf` (use `stageFor`);
  `src/insights/order.js` `stateBucket` (use `bucketFor`); `src/checks/states.js` `isFinishedState`, `finishedKind`, `isHoldState`,
  `isOpenItem` (use the same names from `src/domain/states.js`); `src/compose/emailRecommend.js` (its own closed and on-hold test);
  the closed-state patterns in `src/context/history.js`, `src/domain/callerTickets.js` and `src/sidepanel/ticket/cards/AccountCard.jsx`.
  They need the ticket's table (its kind) and, where the header read can give it, the stored value of `state`.

## Verified live, 2026-11-07

Read on the developer instance `dev364920` (Zurich family) with the signed-in session, read-only (`docs/live-checks-2026-11-07.md`). A row
of the table above says **VERIFIED LIVE 2026-11-07.** when its value was seen in the choice list there; only a customer's own list can differ.

| What | Measured |
|---|---|
| incident | 1 New, 2 In Progress, 3 On Hold, 6 Resolved, 7 Closed, 8 Canceled |
| problem | 101 New, 102 Assess, 103 Root Cause Analysis, 104 Fix in Progress, 106 Resolved, 107 Closed |
| change_request | -5 New, -4 Assess, -3 Authorize, -2 Scheduled, -1 Implement, 0 Review, 3 Closed, 4 Canceled |
| task, sc_task, sc_req_item | -5 Pending, 1 Open, 2 In Progress or Work in Progress, 3 Closed Complete, 4 Closed Incomplete, 7 Closed Skipped |
| change_task | -5 Pending, 1 Open, 2 In Progress, 3 Closed, 4 Canceled (no 7) |
| problem_task | 151 New, 152 Assess, 154 Work in Progress, 157 Closed (not the task values) |
| sc_request (request state, text values) | requested (shown "Pending Approval"), in_process (shown "Approved"), closed_* |
| sc_req_item stage | waiting_for_approval, fulfillment, delivery (and complete, request_cancelled at the end) |

The stage of a requested item decides only where its state says nothing, apart from "waiting for approval", which moves live work to
waiting. Each stage, **VERIFIED LIVE 2026-11-07.**:

| Stage (stored value) | Meaning | Why |
|---|---|---|
| waiting_for_approval | waiting | Moves new, working or unknown work to waiting; never reopens a finished ticket. |
| fulfillment | working | Being fulfilled. |
| delivery | working | Being delivered. |
| complete, closed_complete | closed | Finished and done. |
| request_cancelled, closed_cancelled | cancelled | Ended without being done. |
| any other stage | by the words of its label | The same word lists as a state's label (English, German, Arabic); a stage with none of the words stays unknown. |

One thing the live read shows that the table above does not settle: a request in the request state `requested` is shown as **Pending
Approval** there. Its stored value is filed as **new** (not started), but the label says it waits, and for a table that is not Sure the label
wins when it is recognised, so on that instance it reads as **waiting**. Whether the stored value itself should be **waiting** is the
owner's call (it would change the "new" of a request on every screen).

## What is still assumed

Every row marked "no" in **Sure**, a customer's own states, the German and Arabic words, and the values of incident_task, the HR and
customer service tables (the base values of the tables listed above were read live on 2026-11-07). `docs/live-questions/audit-1107-states.md`
lists one question per assumption, with how to check it as a non-admin user and what changes if it is wrong.
