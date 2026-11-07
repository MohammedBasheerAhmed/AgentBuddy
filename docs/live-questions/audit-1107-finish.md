# Live questions: the last build wave, "finish the fulfiller items" (audit of 2026-11-07: F11, F13, F14, F15 and W-15)

What was built assumes the ServiceNow behaviour below. Each question says what was assumed, how to check it as an ordinary (non-admin)
fulfiller, and what to change if it is wrong. Every assumption has a safe version already: the panel says it could not read something rather
than guess, and a fact that is not told is never turned into "none" or "inactive".

1. **A dot-walked boolean comes back under its own name.** Assumed (W-15): `GET /api/now/table/incident?sysparm_fields=number,assignment_group,assignment_group.active&sysparm_display_value=all`
   returns the key `assignment_group.active` as `{ value: "true" | "false", display_value: "true" | "false" }`, like the other walks
   (`request_item.requested_for`). Check: run the call in the browser address bar on a ticket whose group was retired (Groups, uncheck Active).
   If the key is spelled differently, or a boolean's display value is a word such as "Yes", a retired group is simply never found (the flag is
   "not told", which keeps the group in the vote as before): change `flagOf` in `src/context/similar.js` and `activeFlag` in
   `src/content/ops/itsm.js`.
2. **A group the user may not read arrives as a missing key, not as `false`.** Assumed, as everywhere (docs/live-checks-2026-11-07.md, the
   missing key). Check: an ITIL User reading `assignment_group.active` on a ticket of a group their role cannot read. If it arrives as
   `"false"`, such groups would drop out of the vote: use the `value`, not the `display_value`, in `flagOf`.
3. **The policy guard knows the step.** The walk `assignment_group.active` needs `assignment_group: ['sys_user_group']` in `DOT_WALK_TABLES`
   (`src/content/policyGuard.js`, the lead applies it). Without it, a site with ANY table blocked refuses the look-alike read (the guard
   refuses a step it does not know while anything is blocked): the Routing card and "Suggest where it should go" would say they could not read.
   `tests/finish-routing.test.js` ("the walk through the group is checked...") and `tests/policy-hardening-dotwalk.test.js` fail until it is there.
4. **A task's `parent` holds its incident, change or case.** Assumed (F15): for `incident_task`, `sn_customerservice_task` and `sn_hr_core_task`
   the base column `parent` is the incident or case, so one read of that table by the id gives the person. The panel already shows "Part of
   CS0001234" from the same column (wave 3). Check: open a task of each class and see "Part of ..." in Ticket details; then the caller card should
   name the parent's person. If a class keeps its link in another column (a change task has `change_request`; an incident task may have its own
   reference), `parent` is empty for it and the task says "Nobody is named as the ..." as before: add the class's own column as the link in
   `src/context/specs/fit.js` (`PARENT_PERSON`) and read it where `PARENT_PERSON_LINK` is read (`src/context/pack.js`, `allowlists.js`).
5. **A dot-walk through `parent` was not used.** `parent` is a reference to the base class `task`; the person columns are the subclasses', so a
   walk like `parent.caller_id` is assumed NOT to work (it is why the parent is read by its id, one extra small GET per task of these four
   classes). If a walk works on your site, `readParentPerson` (`src/context/related.js`) can be replaced by walked columns in the task's own read.
6. **A parent that is not of the expected class.** An incident task whose `parent` is a problem or another task: the read of the incident table by
   that id returns no row, and the panel says the parent is not available to you ("could not read who the caller is"), not "nobody". Check: a task
   of a task. If common on your site, the class could be read from the task's `sys_class_name` first.
7. **A case names a contact or a consumer.** A customer service task reads `contact`, `consumer` and `account` of its case. `consumer` exists only
   where the business-to-consumer plugin is installed; a site without it returns no key for it, which is listed as unreadable but never hides a
   contact that was found. Check: the case table's columns as a fulfiller. The account is shown as the case's account (the priority-account mark of
   the glance), under the field `account` of the pack for the features that list it.
8. **An HR case's employee is `subject_person`.** Read only with sensitive content allowed (the organisation's policy and the person's choice, as
   for every HR read). Check: an HR task with HR content on; an HR task with it off must show "the people were not read" (the task's own entry),
   and no request goes to `sn_hr_core_case` (`tests/finish-parent.test.js`). Tasks of the other HR case classes are read through the base
   `sn_hr_core_case`, which returns its subclasses' rows.
9. **The linked-incident count is of rows, not of the instance's total.** Assumed (F14): `X-Total-Count` and the Aggregate API count rows the
   user may not read (docs/live-checks-2026-11-07.md, a row-filtered read: 200 with `[]` and the unfiltered total), so the line counts the rows of
   one limited read (50 shown, "at least 50" when the page is full) and says "that you can see". Check: a problem with linked incidents in a group
   the fulfiller is not in. A site that hides all incidents from the fulfiller gives no line (the empty answer is checked against the table).
10. **`incident.problem_id` is readable.** Used by the Check tab since wave 2 (it says "linked to a problem" or not); the count reads the same column.
    A user who may not read it gets no line (never "0").
11. **State names are the base system's.** The close step names Resolved, Closed Complete, Closed Incomplete, Closed Skipped and Closed (docs/live-checks-2026-11-07.md
    lists the real values). An instance that renamed them shows the base names in the advice (they come in as data, so they could be filled from
    the instance's own labels later: `readChoiceLabels`, `src/context/choices.js`; not done, the panel has no label for the state at the
    place the line is built). The advice is not a claim: it never says the state is required.
12. **Whether saving needs the state** is not known (a business rule or a mandatory field may or may not ask for it); the sentence is "Set State to
    Resolved, then save.", not "the ticket will close". An HR case or a customer service case says "Set the state your process uses to close,
    then save." because no base value is right for every process.
