# Live questions: record checks (request explainer, resolution check, fulfilment checklist)

Everything below was built without access to a real instance (it was driven in real Chrome against the fixture instance, see the
report). Check each one as a user with only fulfiller roles (itil, and the catalog roles for requests). For each: what was assumed,
how to check it, what to change if it is wrong. A wrong assumption makes a line say "could not check" or leaves a section out;
none of them can make the tabs write anything.

## The Request tab (A9)

1. **`special_instructions` and `hold_reason` exist on `sc_req_item`, `sc_task` (and `hold_reason` on `sc_request` and the CSM case).**
   They are added to the display ceilings with `extendFields` in `src/context/specs/checks.js`. A column a table does not have is
   not returned by the Table API, so nothing breaks; the checklist then reads only `description`, and an "On hold" line says
   "No reason is given on the record".
   Check: `/api/now/table/sc_task?sysparm_limit=1&sysparm_fields=special_instructions,hold_reason,description`.
   Change: drop the column from `extendFields` (and from the specs) where the table never has it.

2. **`sc_task.request_item` returns the requested item's sys_id** with `sysparm_display_value=false` and
   `sysparm_exclude_reference_link=true`. The `requestTarget` read (`src/content/ops/checks.js`) uses it to show the item's answers,
   approvals and tasks on a catalog task. If it is not a bare sys_id the tab says "no requested item you can see" and shows the task on its own.
   Check: the Request tab on an SCTASK shows "This task belongs to RITM...".

3. **State and approval words.** The status line works on what the person sees (src/checks/states.js): finished = Closed Complete /
   Closed Incomplete / Closed Skipped / Cancelled / Resolved; on hold = On Hold / Pending / Awaiting ...; approval waiting =
   "Requested", not asked yet = "Not Yet Requested", plus Approved / Rejected / No Longer Required. An unrecognised word is never
   read as closed or as an approval: it falls through to "In progress".
   Check: a RITM waiting for approval shows "Waiting for approval from <who>"; a rejected one shows "rejected by"; a closed one "Finished".
   Change: add the instance's wording to the patterns in `src/checks/states.js` (tests in `tests/checks-requestStatus.test.js`).

4. **Approvals live on the requested item (`sysapproval_approver.sysapproval = RITM`)**, not only on the request. For a request the
   tab reads approvals on the request itself and the `approval` column of each item. If this instance approves at request level
   only, the item's approval row is absent and the tab says "approval record is not visible to you" while the column says "Requested".

5. **Masked and secret answers are left out by `src/context/related.js` and counted in the access note** ("2 masked or secret answers
   were left out."). The tab turns that count into one "hidden (N)" row by reading the note text. If the wording of that note changes the
   row disappears (the answers stay hidden); the tests in `tests/checks-request.test.js` catch a change.

6. **"Past due" is only claimed when the due date is more than 14 hours past**, because the display value is in the reader's time zone.
   Check: a due date of yesterday shows "(past due)"; one earlier today shows nothing.

## The Check tab (C2)

7. **The page bridge returns the unsaved form values** (`getFormValues`) for `close_notes, close_code, resolution_code, state,
   hold_reason, comments, work_notes` on the classic form, including inside the `gsft_main` frame, and `getFormMeta` returns the
   same table and sys_id as the panel's record. On a Workspace or portal it returns null and the tab says "Checked the saved ticket only".
   Check: type notes without saving, press "Check again": the notes check changes. On a Workspace record: the "saved ticket only" line shows.
   Not done by the checks: `work_notes` is read but only used for one sentence ("the work note you have typed is separate").

8. **`g_form.getValue('state')` returns the choice value (a number), not the label.** The checks do not use the form's state at all
   (the saved record's label decides "already resolved"); the bridge cannot give the label. If a future check needs the target state it needs a bridge action.

9. **Which field holds the code**: incident `close_code`, problem and CSM case `resolution_code`. Other kinds get no close-code check.
   Check: a problem and a case form; if the CSM case uses `close_code` the check always says "No close code chosen" (a false warning).
   Change: the map `CODE_FIELD` in `src/checks/resolutionCheck.js`, and the case spec in `src/context/specs/checks.js`.

10. **`incident.problem_id` is readable.** A blank value is read as "no problem linked", but a field-level ACL also returns blank.
    The check says "No problem or article is linked" (an info line, never a warning), so a hidden link costs only a note.

11. **`m2m_kb_task` (columns `task`, `kb_knowledge`) is where "Attach to incident" stores an article, and `kb_use` has `task_id` and `article`.**
    Both are read defensively: every returned row is checked against the ticket's own id (a table that ignores an unknown column
    answers with every row), and "none" is only said when the user can see rows of the table at all (`confirmEmptyIsReallyEmpty`).
    A table that is hidden, denied or missing gives "Could not fully check", never "none".
    Check: attach an article to an incident, then press "Check again": "Linked to an article". If not, run the two queries in the Table API Explorer.
    Change: the `KB_SOURCES` list in `src/content/ops/checks.js`.

12. **Who is the customer.** The "did the customer answer" check compares the name on each customer-visible comment with the names of
    the caller / requested for / contact / consumer on the pack. It assumes comment authors appear as the person's display name
    (via sys_journal_field logins or the "date - Name (Additional comments)" header). Customers answering by email may show as another
    name ("Guest", the mailbox), which reads as an agent message.
    Check: an incident where the caller replied: "The customer wrote the last message". Change: the matching in `customerCheck`.

13. **The timestamps of the notes** must be year-first (`2026-10-26 09:14:03`) for "N days since your last message". Other formats
    (day-first, month names) leave the age unknown and the check says "no reply yet" without a number.

14. **`task.parent` links child tasks** (the read behind "open tasks left") and `sc_task.request_item` / `sc_req_item.request`
    link catalog tasks and items (PROGRESS question 5). A wrong link shows "No tasks under this ticket".

## The Checklist tab (G6)

15. **Instruction text.** The splitter reads numbered lists, bullets, check boxes, "Step N", and prose with action verbs in English
    (`src/checks/checklist.js`). HTML lists arrive as "- item" lines (stripHtml). Instructions in another language split only when
    they are a numbered or bulleted list. Check with a few real catalog task descriptions; add verbs to `VERBS` or send them through the AI button.

16. **`chrome.storage.local` key `agentbuddy_checklists`** holds only `{ [recordSysId]: { done: [8-hex hashes], at } }`, at most 200
    records. A reviewer can inspect it in the extension's storage view: there must be no step text and no names.

## Findings that belong to other areas

17. **Variable answers that are references to people** ("Manager: Dave Loftus") are shown by name but the person is not added to
    `pack.people` by `src/context/related.js` (`readVariables`), so the firewall cannot mask that name when it is sent (the
    fulfilment checklist sends the answers). Suggested change for the context area: for answers whose reference table is `sys_user`,
    return `refs: [{ role: 'variable_reference', sysId, name }]` like the approvers. Until then the name goes out unless the same
    person is also the requester, opener, assignee or an approver.
