# Live questions: one meaning of a ticket's state, My work and Team for fulfillers (audit of 2026-11-07, F5, F9, F17, F20)

Workstream "states, My work, Team". Built without a real instance. Each question below is something the build ASSUMES about ServiceNow;
the safe reading was built (an unknown state is live work; a count that could not be made is said, never shown as none). Check each as a
user with only the fulfiller roles (`itil`; then a CSM agent without `itil`; then an HR agent where HR is allowed), in the browser console
of an already open ServiceNow tab (GET only). The meanings the answers feed are in `docs/states.md`; the code is
`src/domain/states.js` (`STATE_TABLES` holds every stored value).

## How to list the real choice values (question 1 is the tool for all the others)

1. **The real states of a table: their stored values and the labels the site shows.** Assumed: a fulfiller may read the choice list of
   a table, either through the Table API on `sys_choice` or through the UI meta service. Run, for each table named below (replace
   `incident`):

   `(await (await fetch('/api/now/table/sys_choice?sysparm_query=name=incident^element=state^inactive=false^ORDERBYsequence&sysparm_fields=value,label,language,dependent_value&sysparm_limit=100', {credentials:'same-origin'})).json()).result.map(r => [r.value, r.label, r.language].join(' | '))`

   If that is refused or empty (the table may inherit its choices from `task`: use `name=task` and `element=state` too, and look for
   the rows whose `name` is the table), use the UI meta service, which answers with the choices the form itself shows:

   `(await (await fetch('/api/now/ui/meta/incident', {credentials:'same-origin'})).json()).result.columns.state.choices.map(c => [c.value, c.label].join(' | '))`

   Write down value and label for every row, in the person's language too (change the language in your profile once, run it again).
   What it changes: each answer below says which row of `STATE_TABLES` to correct. A value that is not in `STATE_TABLES` is read by its
   label (safe); a value that IS in it with a different meaning would be believed over the label on a table marked Sure, so the Sure
   questions (2 to 5) matter most.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (a plain agent cannot read the choice table (403); GET /api/now/ui/meta/<table> gives each column's label and choices).

## The base values (docs/states.md, "Sure" = yes)

2. **Incident: 1 New, 2 In Progress, 3 On Hold, 6 Resolved, 7 Closed, 8 Canceled.** Believed before the label. Check with question 1 on
   `incident`. Also write down any other value the site has (the old base had 4 Awaiting User Info and 5 Awaiting Evidence) and whether
   the site changed what 6 means (a repurposed 6 would be filed as Resolved by this build).
   Change if wrong: correct the row in `STATE_TABLES.incident.rows`, or, if the site's states are not the base ones at all, set
   `sure: false` for the table so the label is read first.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (1, 2, 3, 6, 7 and 8 confirmed).
3. **Problem: 101 New, 102 Assess, 103 Root Cause Analysis, 104 Fix in Progress, 106 Resolved, 107 Closed.** Check with question 1 on
   `problem`. Is there a 105 (Known error?) or a cancelled value? An older release used 1 to 4: those are unknown here and read by label.
   Change if wrong: as 2.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (101, 102, 103, 104, 106 and 107 confirmed).
4. **Change request: -5 New, -4 Assess, -3 Authorize, -2 Scheduled, -1 Implement, 0 Review, 3 Closed, 4 Canceled.** Check with question 1
   on `change_request` (Normal changes; a state model for Standard or Emergency changes may add states). Change if wrong: as 2.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (-5, -4, -3, -2, -1, 0, 3 and 4 confirmed).
5. **Tasks (catalog task, requested item, change task, incident task, problem task): -5 Pending, 1 Open, 2 Work in Progress, 3 Closed
   Complete, 4 Closed Incomplete, 7 Closed Skipped.** Check with question 1 on `sc_task`, `sc_req_item`, `change_task`,
   `incident_task`, `problem_task`. Does Pending (-5) really mean "not ready yet" (waiting for an earlier task or an approval) on
   catalog tasks? Is a requested item that waits for approval in state Open or Pending? Change if wrong: as 2.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (task, sc_task and sc_req_item: -5, 1, 2, 3, 4, 7; change_task: -5, 1, 2, 3, 4; problem_task has its own values 151, 152, 154, 157).

## The assumed values (docs/states.md, "Sure" = no: the label is read first when it can be)

6. **Request (`sc_request`): the task values for `state`, and the text values requested, approved, in_process, closed_complete,
   closed_incomplete, closed_cancelled, closed_rejected, closed_skipped for `request_state`.** Check with question 1 on `sc_request`
   for both `state` and `request_state`. Which one does the Ticket screen's header show as "State"? Change if wrong: the `sc_request`
   rows in `STATE_TABLES`.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: the request state is requested (shown "Pending Approval"), in_process (shown "Approved") and closed_*).
7. **Customer service case: 1 New, 10 Open, 18 Awaiting Info, 6 Resolved, 3 Closed, 7 Cancelled; state 18 waits for the customer.**
   Check with question 1 on `sn_customerservice_case`. Is Awaiting Info really 18 and always the customer's wait? Change if wrong:
   the `sn_customerservice_case` rows and `CUSTOMER_STATE_VALUES` in `src/domain/states.js`.
8. **HR case: 2 Work in Progress, 18 Awaiting Info, 6 Resolved, 3 Closed Complete, 4 Closed Incomplete, 7 Cancelled; the other states
   (Draft, New, Ready, Awaiting Triage, Awaiting Approval...) are left to the label.** Only where HR is allowed (the HR profile on and
   the organisation allowing HR content). Check with question 1 on `sn_hr_core_case` and on one child table. Write down the value of
   every state, so the label-only ones can get a row. Change if wrong: the `sn_hr_core_case` rows.
9. **Case, HR and other task tables (`sn_customerservice_task`, `sn_hr_core_task`) have the task values of question 5.** Check with
   question 1 on each. Change if wrong: their `rows` in `STATE_TABLES`.
10. **The stage of a requested item: `waiting_for_approval` means it waits for its approval.** Run
    `(await (await fetch('/api/now/table/sc_req_item?sysparm_limit=5&sysparm_fields=number,state,stage,approval&sysparm_display_value=all', {credentials:'same-origin'})).json()).result`
    on requested items that wait for approval, and write down the stored value of `stage` and of `approval` next to `state`. My work
    reads `stage` on requested items (one more column on a read it already makes). Change if wrong: `STAGE_WAITING_APPROVAL` in
    `src/domain/states.js` (or read `approval=requested` instead).
    Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (the stages seen are waiting_for_approval, fulfillment and delivery).
11. **A state in German or Arabic.** The label words of the other two languages (`LABEL_RULES`) were written from the base system's
    translations as remembered, not read. Check: change your ServiceNow language to German, then Arabic, run question 1 for
    `incident`, `sc_task` and `change_request`, and see whether every label contains one of the words of its meaning. This only matters
    for a state whose stored value this build does not know (a custom state, a custom table); a known value never needs the words.
    Change if wrong: add the site's word to the list of that meaning.
12. **The state label comes back with the aggregate (`sysparm_display_value=true` on `/api/now/stats`).** The Team reports group by
    state and show the label. Assumed: the group-by answer carries a display value for `state`. Check:
    `(await (await fetch('/api/now/stats/incident?sysparm_count=true&sysparm_group_by=state&sysparm_display_value=true&sysparm_query=active=true', {credentials:'same-origin'})).json()).result.map(g => JSON.stringify(g.groupby_fields))`
    Change if wrong: nothing breaks: a state with no label is named by what it means ("In progress", "On hold") and never by its number
    (`stateName` in `src/reports/engine/common.js`); a site that returns numbers would show those plain words instead of its own.

## My work: follow-ups (F5) and the unassigned queue (F17)

13. **The requester does not see the comments of a catalog task, only those of the requested item.** The repo's own caution says so
    (`src/features/stages.js` `cautionFor`), and F5 builds on it: My work offers no "No update to the customer" and no draft for a
    catalog task, a problem or the task of another ticket (`reachesCustomer` in `src/mywork/tables.js`). Check as a requester (or ask a
    test requester): add a customer-visible comment to a catalog task and see whether it shows on the request in the portal and in the
    notification. Change if wrong (the requester does see them): take `sc_task` out of `TEAM_ONLY` in `src/mywork/tables.js`. If the
    requester sees the requested item's comments and the team wants the follow-up on the task to count them, My work would have to read the
    comments of the requested item as well (`request_item` on the task): not built.
    Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (not guaranteed: it depends on who opened the task; the task's comments have no field rule).
14. **The unassigned queue is read most urgent priority first, then oldest** (`ORDERBYpriority^ORDERBYopened_at^ORDERBYnumber`, 50 per
    class), and shown by SLA state (breached, then at risk), ready work before work on hold, priority, age. Assumed: sorting by
    `priority` ascending puts 1 Critical first on a task table (the queue of the person's own tickets already relies on it). Check: the
    first rows of the group queue against the classic list of the same filter sorted by priority. Also: a low-priority ticket with a
    breached SLA beyond the first 50 per class is not read (the card says "Showing x of y"); check how often that happens in your groups.
    Change if wrong: the `order` of `readGroupQueue` in `src/mywork/read.js`.

## Team: the other kinds of ticket (F20)

15. **The Team "Ticket types" list now offers requests, incident tasks, problem tasks, customer service tasks and (with the HR profile)
    HR tasks, and the fulfilment section covers requests and customer service and HR tasks.** Assumed: those tables exist and a fulfiller
    can read them (an instance without the customer service or HR plugin shows them as "could not be read" or leaves them out of the
    usable list, as the HR cases already are). Check: open Team > Ticket types and see which of the new ones are available to you.
    Change if wrong: take the table out of `REPORT_TABLES` (`src/reports/engine/constants.js`).
16. **Other kinds of ticket (custom classes, other products) are counted with one read: `GET /api/now/stats/task?sysparm_count=true&sysparm_group_by=sys_class_name&sysparm_display_value=true&sysparm_query=<scope>^active=true`.**
    Assumed: the answer names each class with its label as the display value (My work already relies on it, `docs/live-questions/mywork.md`
    item 1), a custom class shows up in it, and the count matches the list the person sees. Check: run it for your group and compare with
    `task_list.do?sysparm_query=assignment_groupIN<your group>^active=true` grouped by Task type. Security, risk and compliance classes and
    classes the organisation blocks are never listed (a sentence says that some kinds are not counted). Change if wrong: `otherKinds` in
    `src/reports/engine/fulfilment.js`.
