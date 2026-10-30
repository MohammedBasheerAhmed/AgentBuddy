# Reporting with AI (shift hand-over, coaching snapshot, explain this dashboard): things to check on a real instance

Nothing here has run against a real ServiceNow instance or AI endpoint. Check each as a **non-admin fulfiller or team lead** (an `itil`
user, plus csm / approval roles where it matters). "If wrong" says what to change. The questions in `docs/live-questions/reports.md`
(open, ageing, SLA queries, group membership) apply here too, because the hand-over page reuses those reads.

## Shift hand-over page (src/reports/engine/handover.js)

1. **"Breached during the period" is judged by the SLA's planned end.** Query: `has_breached=true` with `planned_end_time` between the
   start of the period and now, on `task_sla`, for the tickets in scope. Check against a few SLAs that breached in the last hours: is
   `planned_end_time` the moment of the breach? Paused SLAs and schedules can move it. If wrong, use `end_time` for completed SLAs or
   `sys_updated_on` of the breached row.
2. **"Handed over 3+ times and touched in the period"** is `reassignment_count >= 3` with `sys_updated_on` inside the period, on open
   tickets. `reassignment_count` is a lifetime total and `sys_updated_on` moves on any edit, so this approximates "big reassignments in
   the period" (the title says so). If wrong: the period's reassignments cannot be counted without `sys_audit`, which fulfillers
   usually cannot read.
3. **Urgent means `priority` 1 or 2** on every ticket table (`priorityIN1,2`). Check the priority choice lists on cases, problems,
   changes, requested items. If wrong, make the list per table in `REPORT_TABLES`.
4. **What a state waits for is judged from its label** (`waitingKind`): approval, customer (caller, user, requester, information,
   reply...), or other. Check each table's waiting labels in the instance's language. "On Hold" is "other"; the hold reason column is
   not read. If wrong, extend the two regular expressions in `waitingKind`.
5. **The requester's name is read only to mask it.** The lists read `opened_by` (a `task` column) and, on incident, `caller_id`. They are
   never shown or exported; they reach the AI only as `pack.people`, so a name in the title of a listed ticket is masked when it is
   that ticket's requester. Check `opened_by` exists on cases and catalog tasks. If not, the preview shows any name that stays.
6. **Approvals** use the same reads as the Request fulfilment section (`approver=<me>^state=requested`; for a team
   `sysapproval.sys_class_name=sc_req_item^sysapproval.<scope>`). Compare with the approval lists in ServiceNow.
7. **Number of reads.** Per table about 7 list reads and 1 grouped count, plus the SLA reads, behind the shared limit of 4 at a time and
   the 45 s limit. Check how long it takes on a large instance. If too slow, offer fewer tables by default or drop "oldest waiting".

## Coaching snapshot (src/reports/engine/coaching.js, src/reports/ai/coaching.js, src/reports/ai/scoring.js)

8. **A fulfiller can read `sys_user_group`, `sys_user_grmember` and `sys_journal_field`** for the group they pick. If
   `sys_user_grmember` is denied the snapshot stops with a sentence and reads nothing about tickets (it will not guess which comments
   an agent of the group wrote). If many fulfillers cannot read it, decide with the organisation whether to use the ticket's assignee.
9. **Dot-walking in the member query:** `group=<id>^user.active=true` with `sysparm_fields=user,user.user_name`, display values on.
   Rows should carry `user` (name) and `user.user_name` (login). If not returned, comments from `sys_journal_field` (author = login)
   cannot be matched and no agent comments are found. If wrong, read `sys_user` by id chunks for the logins.
10. **`sys_journal_field.sys_created_by` holds logins** (`beth.anglin`). With some SSO setups it is an email or employee id and nothing
    matches. The fallback (the ticket's own `comments` field, display names) is used only when the journal table gives nothing.
    Check one resolved ticket from a real group.
11. **`element=comments` is the customer-visible journal and `name=<table>` the record's class** (same assumption as
    `src/context/journal.js`). Work notes are never asked for.
12. **"Resolved by the group"** = `assignment_group = <group>` at read time, resolved date (`resolved_at`, else `closed_at`) inside the
    days. A ticket resolved and then moved to another group is missed; one moved in afterwards is included. Fixing this needs audit data.
13. **Close columns:** `close_notes` on every task table, `close_code` on incident and change, `resolution_code` on problem and case
    (spec `coaching-snapshot`). Check a fulfiller sees them filled. A blank is sent as "(empty)" and the AI says "Not enough to judge".
14. **Minimum group size of 3** (`COACHING_LIMITS.minMembers`) is a design choice so a snapshot cannot describe one or two people.
    Confirm with HR / the works council; change the constant for another number.
15. **The sample rule** (sort by resolution time, then evenly spaced positions) is simple and cannot see names. HR may prefer random
    sampling with a recorded seed; that would change `pickSample` only.
16. **Managed policy `coachingEnabled`** must reach the panel as `true`. Test with a policy that sets it and one that does not: the
    section appears in Customize only with it. Without it, a saved coaching (or "Explain this dashboard") widget is left out of the
    dashboard with one line, "Turned off by your organisation, so not shown: ...", and in Customize it still shows its calm line so it can
    be removed.
17. **How well the output check catches per-person language.** `flagPerPersonScoring` looks for ranking words, labels like "Agent A",
    leftover [PERSON_n], and the group's own people next to rating words. It cannot know a name it was not given. Try the real model
    with tempting prompts ("who is best?") and see whether the answer is held back. Tune the word lists, not the principle.
18. **Printing from the side panel.** `window.print()` prints the panel with the dashboard print styles. If the side panel will not
    print in Chrome or Edge, use "Open full page" first.

## Explain this dashboard (src/reports/ai/insights.js)

19. **It explains what the other widgets of the same dashboard loaded** (kept in memory in `env.loaded`). Custom builder reports are not
    included. Check that after changing the quality period or the scope, the explanation follows what is on screen.
20. **Category and configuration-item names are sent** (top five of each) because the counts are counted by them. A CI named after a
    person would not be masked; the preview shows it. If objected to, drop `cis` from `qualityLines`.

## Preview

21. **`pack.requirePreview`** is set on the hand-over and coaching packs, so in "first time per feature" preview mode the person still
    sees the exact text each time (the tickets differ). `never` and `always` are unchanged. This relies on `needsPreview` in
    `src/sidepanel/runLogic.js` honouring the flag.
