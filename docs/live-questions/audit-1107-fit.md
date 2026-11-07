# Live questions: the "kind fit" pass (audit of 2026-11-07, root cause 6, "the panel is incident-first")

What was built assumes the ServiceNow behaviour below. Each question says what was assumed, how to check it as an ordinary (non-admin)
fulfiller, and what to change if it is wrong. Every assumption has a safe version already: the panel says it could not read something
rather than guess.

1. **A dot-walked column comes back under its own name.** Assumed: `GET /api/now/table/sc_task?sysparm_fields=request_item.requested_for,request_item.cat_item,request_item&sysparm_display_value=all`
   returns the keys `request_item.requested_for` and `request_item.cat_item` as `{ value, display_value }`, like any reference. My work
   already depends on the same walk for the customer of a catalog task (`src/mywork/tables.js`). Check: open a catalog task, run the call in
   the browser address bar. If the key is spelled differently (`request_item__requested_for`...), the requester stays unread and the panel
   says "not shown to you": change `PARENT_WALK` in `src/context/specs/fit.js` and the key read in `src/context/pack.js`.
2. **An item you cannot read gives an empty value or no key.** Assumed: for a catalog task whose requested item is hidden from you by an
   access rule, the walked columns come back empty or not at all (both are shown as "could not read", never as "nobody"). Check: a task of
   an item your role cannot open. If the whole task read fails with a 403 instead, the panel shows the task as "not available" like any
   refused ticket; widen nothing.
3. **The answers of a request form are readable from the item's id.** Assumed: `sc_item_option_mtom` rows are found by `request_item=<item id>`
   for a fulfiller, as for the requested item itself (the Request card already reads them that way when a task climbs to its item).
   Check: a catalog task of an item with questions; the AI "Summarise this ticket" part "Answers to the request form" should list them.
4. **Custom task tables.** Assumed: a table that extends `task` returns the columns `opened_at`, `opened_by` and `assignment_group` as keys
   (empty if unset), and a table that does not extend `task` does not return them at all. The panel treats a row with all three as a task
   (`taskRowEvidence`, `src/context/kinds.js`). Check: one custom task table and one custom non-task table in the Table API. If a non-task
   table returns them, add another task-only column (for example `reassignment_count`) to `TASK_ONLY_COLUMNS`. Also assumed: a record opened
   through `/task.do?sys_id=<id>` reports its real class in `sys_class_name` (the panel already relies on it) and that class is a kind of task.
   Known limit: the first look at a custom table (before any pack read or `/task.do` open) still says "kind not known"; the lead may add one
   `task` lookup by sys_id in `recordResolver.js` if that is not good enough.
5. **An HR case has a close notes box.** Assumed: the HR case form has `close_notes` and it can be filled like the other forms' (labelled
   "Close notes"). Check: an HR case with a Strict-mode user. If the box has another label, change `fieldLabel` of the HR entry in
   `src/features/packs/core.js`, `close.js` and `checks.js`; if there is no such box, remove `hr_case` from `CLOSE_NOTES_KINDS`
   (`src/features/packs/kinds.js`).
6. **A change has `close_code` and `close_notes`.** Assumed: `change_request` has both, the notes box is labelled "Close notes", and the code is a
   choice the agent picks by hand (Prepare to close does not fill it for a change). Check: a change in Review or Closed. If the notes box has
   another label, change the `fieldLabel` of the change entry.
7. **A request has `close_notes`.** Assumed: `sc_request` has the column (every task table does), so "Ready to resolve?" can check it. Check
   one request. If it is absent, the check says "Could not read the saved close notes" (no wrong warning).
8. **The state choices are readable in more than one language.** Assumed: a fulfiller can read `sys_choice` (name `IN` the table, its
   family and `task`; element `state` and `priority`; `language` `IN` `en` and the panel's two-letter language) including inactive rows, and the
   rows exist per language only where the instance has translated them. Check: the call for `task` in `ar` on a translated instance. If
   `language` is stored in another form (`ar-SA`), widen `languageOf` in `src/content/ops/insights.js`.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (a plain agent cannot read the choice table in any query shape (403); the UI meta service gives each column's label and choices instead).
9. **The close state of a catalog task is "Closed Complete".** The "Ready to resolve?" card tells a fulfiller of a catalog task or a requested
   item to set the state to Closed Complete (or Closed Incomplete). Check: the choices of `sc_task.state` and `sc_req_item.state`. An instance
   that renamed them shows the base names in the sentence; change the sentence in `ResolveCard.jsx` if that is common.
10. **A catalog task's comments are not read by the requester.** Assumed (already assumed in `docs/live-questions/assist.md`, item 6): so
    "Ready to resolve?" has no customer check on a catalog task, a change, a problem or a task (`NO_CUSTOMER_CONVERSATION` in
    `src/checks/resolutionCheck.js`). Check: comment on a catalog task and look at the requester's portal.
    Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (not guaranteed: a catalog task's comments have no field rule, so who reads them depends on the task's read rule (opened_by is the user)).
11. **A problem's `known_error` shows as true or yes.** Assumed: the display value of the flag is "true" or "Yes" when set. Check: a known
    error. The panel also shows the workaround whenever it is written, so a different spelling only loses the words "Known error".
12. **`parent` opens through `/task.do`.** Assumed: the parent of a task, opened by its id through the base class `task`, opens the right
    record (the panel resolves the real class, as it already does for a record opened that way). Check: "Part of" in Ticket details on a
    customer service task or an HR task.
13. **The model follows the kind sentence.** The AI prompts now add a fixed sentence about the kind of ticket and, for the summary and the
    notes, how the lines read for it. Check with a real AI key: "Summarise" on a catalog task (no "Impact" about harm), "Write resolution
    notes" on a delivered item (Delivered / Done / Requester to do, no Cause) and on a change (Outcome / Implementation / Verification / Issues).
