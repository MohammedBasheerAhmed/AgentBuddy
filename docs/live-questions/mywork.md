# Live questions: the My work screen (N13 My queue, N14 Unassigned in my groups, N27 Follow-ups due)

Nothing here has run against a real instance: the unit tests use the shared fake Table API (`tests/fixtures/sn-fakeDeps.js`) and the
end-to-end run uses the fake instance (`e2e/fakeInstance.js`). Check each as a NON-ADMIN fulfiller (`itil`; then a CSM agent without
`itil`; then an HR agent where HR is allowed), on the classic UI and on a Workspace. What My work reads: `src/mywork/read.js`.

## Counting and reading the queue

1. **One count on `task`, grouped by class.** My work first asks `GET /api/now/stats/task?sysparm_count=true&sysparm_group_by=sys_class_name&sysparm_query=assigned_to=<me>^active=true`.
   Assumed: an `itil` user may use the Aggregate API on `task`, and the counts match what the person sees (the Aggregate API applies
   the table's read rule, maybe not every row rule). Check: open My work, compare each count ("Incidents 12") with the classic list
   `task_list.do?sysparm_query=assigned_to=javascript:gs.getUserID()^active=true` grouped by Task type. If the stats call is refused
   (403) for some roles, My work counts each table of the person's work profiles on its own instead (`tablesForProfiles` in
   `src/mywork/tables.js`): check a CSM-only agent still sees cases. If a count is higher than the rows the person can read (row ACLs),
   the screen says what it read, not the count (`readPages` stops at the first short page).
2. **Rows per class from the class's own table**, ordered `ORDERBYpriority^ORDERBYsys_updated_on^ORDERBYnumber`, 100 per page, at most
   200 per class (then "Showing 200 of 340. Open the full list"). Assumed: `sysparm_offset` paging is stable enough with that order (rows
   are de-duplicated by sys_id). Check with an agent who has more than 100 open incidents.
3. **State labels.** Read with display values from each class's own table, because the `task` table's state choices differ (incident
   3 = On Hold would show as "Closed Complete" on `task`). Assumed meanings (`src/mywork/states.js`): display words first ("Resolved",
   "On Hold", "Awaiting Info", "Pending", "Suspended", "Awaiting Acceptance"), then the base values incident 3/6/7, case 3/6, problem
   106/107, hold reason 1 = Awaiting Caller. Check the words on a customised instance; a word that is not recognised counts as live work.
4. **Resolved but active.** Assumed: a resolved incident or case stays `active=true` until it auto-closes, so it shows in "Resolved,
   awaiting closure". Check on the instance's auto-close setting (`glide.ui.autoclose.time`).
5. **`hold_reason` on requested items, catalog tasks and cases.** Asked for on those tables too; the Table API ignores a column a table
   does not have. Check on your release that asking for it causes no 400.

## Who wrote last (Customer replied, follow-ups)

6. **`sys_journal_field` by element_id.** One GET per 40 tickets: `element=comments^element_idIN<ids>^ORDERBYDESCsys_created_on`,
   columns `element_id, sys_created_on, sys_created_by` only (no text), at most 400 rows. Assumed: an `itil` user may read
   `sys_journal_field` rows of the tickets they can read. If it is denied, the screen says "Who wrote last is not visible to you" and
   shows no follow-ups. Check both on a classic user and on a CSM agent.
7. **Matching the customer.** `sys_created_by` is a login (user_name); the customer's login is read as a dot-walked column on the ticket:
   incident `caller_id.user_name`, requested item `requested_for.user_name`, catalog task `request_item.requested_for.user_name`, change
   `requested_by.user_name`, case `contact.user_name`, HR case `opened_for.user_name`. Check that the Table API returns these dot-walked
   columns for a non-admin (a reference the person cannot read may come back empty: then a comment by anyone else after mine shows as
   "New comment", not "Customer replied"). Comments added by email may carry a system user (`system`, `guest`) as author: check
   what an email reply from a caller shows as `sys_created_by` on your instance.
8. **My login.** Taken from the page (`g_user.userName`); on a portal page that gives none, one read of my own `sys_user` row. Check on
   Service Portal / Employee Center.

## SLAs

9. **`planned_end_time` is UTC** in the stored value (`sysparm_display_value=all` gives `value` in UTC, `display_value` in the person's
   zone). "SLA due in 2h 10m" is computed from the stored value and the browser clock. Check one ticket against the SLA's own form.
10. **Paused SLAs are `active=true`** with `stage=paused` and are read with the others. Check a ticket On Hold awaiting the caller.

## Approvals and groups

11. **Approvals waiting on me**: `sysapproval_approver` with `approver=<me>^state=requested`. Delegated approvals (someone delegated
    theirs to me) are NOT included. Titles come from one `task` read by sys_id, only for classes the person may read; the class comes from
    `source_table` or the dot-walked `sysapproval.sys_class_name`. Check on a user with a pending catalog approval; and that a click opens
    the approval record where Approve / Reject are.
12. **My groups**: the Team screen's reading (`readMyTeam` in `src/reports/engine/scope.js`: active groups, at most 25; over that the
    ones with the most open work). Then `assignment_groupIN<groups>^assigned_toISEMPTY^active=true`, oldest first. Check a fulfiller
    may read their own `sys_user_grmember` rows.

## Links and the rest

13. **"Open the full list"** opens the classic list (`/nav_to.do?uri=task_list.do?sysparm_query=...`) in the same tab, also from a
    Workspace (a Workspace list address is not built). Check the filter shows the same tickets.
14. **HR**: HR cases are listed only when the organisation allows HR content (`allowHrContent`) AND the person has the HR profile on;
    otherwise My work says how many are not listed and why. A class in `blockedTables` is never read (only counted, on `task`) and is
    named in one line. Check with a policy that blocks `problem`.
15. **Several of my tickets on one CI**: from 3 open tickets of mine with the same `cmdb_ci`. A simple count; the full outage spotter
    is on the Ticket screen (Insights agent).
16. **Templates** (follow-ups) are fixed English text with the ticket number and title only. Check the wording with the service desk
    lead, and whether the "may be closed" line matches the desk's own rule (3 strikes, 5 days...).

## Tickets at risk (round 4, 2026-11-06)

What it reads and why: `src/context/specs/mywork.js` (`RISK_COLUMNS`, `VIP_COLUMNS`, `ACCOUNT_COLUMNS`); the rule: `src/mywork/risk.js`.
Only the rows of the person's own queue carry these columns (not the unassigned tickets of their groups), and a column the instance
does not return is unknown, never zero: the reason is simply not shown.

17. **`reassignment_count` on every ticket table.** Read on incident, problem, sc_req_item, sc_task, sn_customerservice_case and the
    task-kind tables (incident_task, problem_task, change_task, sn_customerservice_task, sn_hr_core_task); not on change_request or HR
    cases (not on their field ceilings). Assumed: a task column every class inherits, readable by `itil` and by a CSM agent without
    `itil` (no field ACL). Check: on a ticket reassigned twice (two group changes in its activity), My work shows "Reassigned 2 times";
    or open the classic list of your queue, add the "Reassignment count" column (list personalisation, no admin needed) and compare.
    If an instance hides it: nothing to change (the reason does not show); if the count is reset by a custom rule, say so here.
18. **`reopen_count` on incident only.** Assumed: the base incident column, raised each time a resolved incident goes back to work.
    Not asked on other tables: is there a reopen counter on `sn_customerservice_case`, `sn_hr_core_case` or `sc_req_item` on this
    release? Check the dictionary from a list (add the column "Reopen count" to the cases list if it exists). If cases have one, add
    `case` to `RISK_COLUMNS.reopen_count` and to the case ceiling (`extendFields` in `src/context/specs/mywork.js`; note that this also
    lets the `insights-ticket` spec read it on cases: check with its owner first).
19. **The customer's VIP flag, dot-walked.** `caller_id.vip` (incident), `requested_for.vip` (sc_req_item),
    `request_item.requested_for.vip` (sc_task), `contact.vip` (sn_customerservice_case: a customer contact is a `sys_user` row, so it
    has the column). The walks are the ones My work already makes for the customer's login (`.user_name`), so a policy that blocks
    `sys_user` already stops both. Assumed: `itil` (and a CSM agent) may read `sys_user.vip` through a dot-walk in the Table API, and
    it comes back as `true` / `false`. Check: a ticket whose caller is marked VIP (the Ticket screen's Glance shows "VIP", read
    directly from `sys_user`) also says "VIP caller" in My work; a non-VIP caller's ticket does not. If the walk comes back empty while
    the Glance says VIP, a field rule hides it from dot-walks: then read the flag like the Glance does (one `sys_user` read by sys_id
    per batch of customers) instead.
20. **Waiting on you.** From the same authors-and-times read as "Customer replied" (questions 6 and 7): the customer (or, where the
    ticket names no customer we could match, anybody else) wrote a customer-visible comment after the agent's last one, 2 whole days
    ago or more by the browser clock. Check: a ticket the caller answered by email three days ago and nobody answered says "waiting
    on you 3 days"; answering it (a customer-visible comment) takes the reason away at the next read.
21. **Priority account.** A case's `account` is read (display name) only when the policy names `priorityAccounts`; it is compared in
    the panel exactly as N28 compares the Account card's name (`isPriorityAccount`). Check with a policy naming one account: its cases
    in My work say "priority account"; with no list, the read asks for no `account` column.
22. **The SLA reason** uses the queue's existing SLA rule (`src/mywork/sla.js`): breached, or 75 % used, or a running SLA with under
    2 hours left. Check with the desk lead that "under 2 hours left" belongs in "At risk" (it keeps every ticket the SLA ranks first
    inside the at-risk group, so the order stays breach, SLA risk, ...).
