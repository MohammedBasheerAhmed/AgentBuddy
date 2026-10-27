# Domain features: questions only a real instance can answer

Features: `hr-case-brief` (G1), `account-briefing` (G2), `case-eng-escalation` (G3), `problem-rca` (G4), `change-cab-brief` (G5).
Code: `src/features/packs/domain.js`, `src/context/specs/domain.js`, `src/context/related.js`, `src/content/ops/domain.js`, `src/domain/`.

Nothing below was checked on a real instance; the tests use a fake Table API (`tests/domain-fixtures.js`). Check each as a
**non-admin** user with only fulfiller roles: `itil` for problem and change, a CSM agent role for cases, an HR agent role for HR
cases. Where an answer is "no", the code already degrades (an `access` entry, and the part is listed as "not available" in the
request), so a wrong guess costs a missing section, not a wrong one.

## Problem write-up (G4)

1. **Which form field is "Problem statement"?** I insert the problem statement into `description` (label "Description"), as the
   brief says. On some releases the field *labelled* "Problem statement" is `short_description`. Check: open a problem form,
   look at the label above the short description and the description. If it is `short_description`, change the first insert in
   `problemRca.insert` to `{ field: 'short_description', fieldLabel: 'Problem statement' }` and shorten the first heading's
   instruction to one sentence (a short description is capped at 160 characters on most forms), or keep both inserts.
2. **Can a fulfiller read `incident.problem_id`, `incident.close_notes` and `incident.cmdb_ci`?** Check:
   `/api/now/table/incident?sysparm_query=problem_id=<problem sys_id>&sysparm_fields=number,close_notes,cmdb_ci&sysparm_limit=3`
   as the test user. If `close_notes` comes back empty on resolved incidents, the timeline loses the fixes (it still has the
   dates and descriptions). If the call is a 403, the pack says "Linked incidents: not readable by your user".
3. **Does `ORDERBYopened_at` / `ORDERBYDESCopened_at` return what we think on `incident`?** The oldest 10 and newest 10 are read when
   a problem has more than 20 incidents. Check with a problem that has more than 20 linked incidents (the PDI can be seeded with
   a script run by an admin; the check itself is a normal read).
4. **Is the Aggregate API (`/api/now/stats/incident?sysparm_count=true`) open to fulfillers?** It is used only to say how many
   incidents are linked in total. If it is refused the note says "more than 20" and the brief says the list is partial.
5. **Do `cause_notes` and `workaround` fill on a problem form in Workspace?** `fieldLabel` is "Cause notes" and "Workaround". If the
   form uses other labels (aria-labels), change `fieldLabel` in the three inserts. Classic forms use `g_form` and do not need it.

## CAB brief (G5)

6. **Do these `change_request` columns exist and can a fulfiller read them?** `justification`, `implementation_plan`,
   `backout_plan`, `test_plan`, `risk_impact_analysis`, `cab_date` (added with `extendFields`). Check:
   `/api/now/table/change_request?sysparm_limit=1&sysparm_fields=justification,implementation_plan,backout_plan,test_plan,risk_impact_analysis,cab_date`.
   A column an instance does not have is simply absent from the answer; the brief then lists it as "no value on the record
   (empty, or not readable by your user)" and says "Missing". If the instance renamed a column (for example a custom
   `u_backout_plan`), add it through `extendFields` in `src/context/specs/domain.js`.
7. **Does a date literal work in a Table API condition?** The conflicts read uses
   `start_date<=2026-11-12 01:00:00^end_date>=2026-11-09 23:00:00` (UTC, padded by a day on each side; the exact overlap is decided in
   code on the stored values, so a time-zone offset cannot hide a change). Check one such condition in the browser address bar
   as the test user. If the instance rejects it, switch to `javascript:gs.dateGenerate('2026-11-12','01:00:00')` form.
8. **Does `active=true` exist on `change_request` and mean "not closed"?** Closed and cancelled changes are left out of the conflicts
   by that condition. If `active` is missing, the condition is ignored and closed changes would be listed as conflicts (the state
   column is shown, so the CAB can see it).
9. **Is `cmdb_ci=<sys_id>` / `business_service=<sys_id>` a valid condition for a fulfiller?** (Reference columns compared by
   sys_id.) The code also re-checks every returned row against the CI or service it asked for, and reports "the instance did not
   apply the filter" instead of listing other changes.
10. **Do fulfillers see every change, or only their own groups'?** The conflicts list says "that your user can see". If row-level rules
    hide other groups' changes, a conflict can exist that is not shown. Worth a sentence in the roll-out guide.
11. **Is `sysapproval_approver` readable** (the approvals so far) and does `sysapproval=<change sys_id>` return the change's approvals?
    This is the existing extra; the question is the same as question 7 in `PROGRESS.md`.

## Account briefing (G2)

12. **Is `sn_customerservice_case.account` a reference to the customer account, with the sys_id as the stored value?** The read
    operation `accountCases` takes the account from the case itself and asks for `account=<sys_id>^sys_id!=<this case>`. Check:
    read one case with `sysparm_fields=account&sysparm_display_value=false`; the value must be 32 hex characters. If the account
    is held in another column (for example `u_account`), the operation reports "This case has no account" and the briefing
    works without history.
13. **Does `ORDERBYDESCactive^ORDERBYDESCopened_at` put open cases first?** Used to show open cases before the newest closed ones.
    Check on an account with both. If not, change the order in `readAccountCases` or sort the ten rows in code.
14. **Which other cases of the account can an agent see?** Row-level rules may show only the agent's own queue. The note then
    reads "No other cases for this account that your user can see" and the prompt says "that your user can see". Check with an
    account that has cases in several groups.
15. **Is the Aggregate API open for `sn_customerservice_case`?** Used only to say how many more cases exist beyond ten. If refused,
    the briefing says more cases exist without a number.
16. **Does a CSM case usually carry `cmdb_ci`?** The "recent changes" extra needs it (changes on the case's configuration item in the
    last 14 days or planned in the next 7). Many CSM cases use `asset` or an install-base item instead; then the extra is skipped
    with a reason and the briefing does not mention changes. Check a few real cases. If the link is the install base, add a
    second lookup (`sn_install_base_item.configuration_item` or the product's CI) in `readRecentChanges`.
17. **Can a customer-service agent read `change_request` at all?** Often not. The extra then shows "Other changes: not readable by
    your user" and the briefing carries on.
18. **Entitlement detail is not read.** Only the case's own `entitlement` reference (its display name) is used, so the briefing cannot
    say when an entitlement ends. The table is probably `service_entitlement` (columns such as `account`, `start_date`, `end_date`,
    `active`), but the names were not verified, so no read was written. Check the table and columns as an agent; if readable, add an
    `entitlements` extra in `related.js` (at most 5 rows, active first) and name it in the spec.
19. **Names of other customers.** The short descriptions of the account's other cases are sent (masked by pattern: emails, phone numbers,
    IDs). A name written only inside a sentence in another case's title is not masked (the firewall's documented limit). The preview
    shows the exact text. Decide with the security team whether titles of other cases may go to the AI, or whether the history should
    send only number, state, priority and dates.

## HR case brief (G1)

20. **Does `sn_hr_core_case` have `due_date`, and can an HR agent read it?** Added with `extendFields` for "status and due date". If the
    HR product uses another column (a custom `u_due`, or `sla_due`), the line stays "Not stated". Check:
    `/api/now/table/sn_hr_core_case?sysparm_limit=1&sysparm_fields=due_date,hr_service,state`.
21. **Are HR child tasks `task` rows with `parent=<case sys_id>`?** The existing `childTasks` extra reads them (to say what is done and
    pending). If the HR tasks hang off a different column, the brief relies on the notes alone. Same question as question 5 in
    `PROGRESS.md`, now for HR.
22. **How does a denial look for an HR agent without the right role: 403 or HTTP 200 with no rows?** The code treats both honestly
    (a 403 is "denied"; an empty 200 is "empty or hidden"). The HR gate (`allowHrContent`) is a policy switch, not a role check.
23. **Preview check before the first real use.** Run the HR brief on a case with a realistic note (not a real person's) in Strict mode with
    `allowHrContent` on and read the preview: people should all be `[PERSON_n]`, and nothing the handler would not want a third party
    to see should be left. A person named only inside a sentence who is not the subject, requester or handler is not masked (the
    firewall's documented limit). Decide with HR and the security team whether the HR brief may be used with a hosted model or only
    with a local one (Local-only mode also satisfies the Strict requirement).
24. **Does the work-notes field on the HR workspace form answer to the label "Work notes"?** The same question as for every other
    feature; the result view uses `fieldLabel` to find the control by its aria-label.

## Engineering escalation (G3)

25. **Where do product, asset and version live on your cases?** The brief reads `product`, `asset`, `cmdb_ci`, `category`, `subcategory`,
    `entitlement` and `account` and the notes. A version number is usually only in the text. If your cases keep it in a custom
    column, add it through `extendFields` and the spec.
26. **Do engineering tasks hang under the case as child tasks (`task.parent`)?** They are shown under "Child tasks" so the brief can say
    what engineering already knows. Same question as `PROGRESS.md` 5.
