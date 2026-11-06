# Live questions: Find the fix, error codes and "solved before by" (round 4, C1)

None of this could be checked against a real instance. Each question says what the code assumes, how to check it as a user with only
fulfiller roles (no admin), and what to change when the assumption is wrong. A wrong guess fails soft: the search says what could not
be read (an `access` note) or finds less, it never shows a record the person's own session could not read.

Where to look: `src/insights/errorCodes.js` (which codes are found), `src/content/ops/fix.js` (the `fixCodeSearch` read),
`src/insights/solvedBy.js` (the group and the person), `src/sidepanel/ticket/cards/StepsCard.jsx` (where both are shown).

## The code search (`fixCodeSearch`)

1. **LIKE on `kb_knowledge.text`.** Assumed: `textLIKE800CCC0F` finds an article whose HTML body contains the code, as it does for the
   existing "Knowledge for this ticket" search (`searchKnowledge` in `src/context/similar.js`). Check: in the classic list
   `/kb_knowledge_list.do`, filter "Text contains 0x800CCC0F" (or any code an article of yours quotes); call
   `/api/now/table/kb_knowledge?sysparm_query=workflow_state=published^textLIKE800CCC0F&sysparm_fields=number&sysparm_limit=5`. Wrong
   (no rows although an article quotes it, or the read times out): drop `text` from `articleCodeQuery` (title only) and say so in the
   card's hint.
2. **Knowledge access.** Assumed: the Table API applies the knowledge bases' "Can read" user criteria to `kb_knowledge` for a non-admin,
   so an article the agent may not read is never returned. Check: as a fulfiller who cannot open a given article in the knowledge
   portal, ask the request in question 1 with that article's number (`number=KB...`): it must answer no row. Wrong (it answers): this
   is a platform setting, not ours to work around; tell the customer's ServiceNow team and do not show articles from that read (the
   same is then true of the existing knowledge card).
3. **Which tickets count as solved.** Assumed: close notes written (`close_notesISNOTEMPTY` in the query) AND a resolved or closed time
   set (`resolved_at` or `closed_at`, checked on each row, because the state values differ per table: incident 6/7, case 6/3, catalog
   task 3...). Check, on the list of each table you use: does a reopened incident keep `resolved_at`? Does a cancelled incident, or a
   catalog task "Closed Incomplete" or "Closed Skipped", have close notes and `closed_at`? Wrong: add a per-table list of stored state
   values to `searchSolvedByCode` and keep only those rows (read `state` as a stored value, not its display text).
4. **LIKE on `description` and `close_notes` of the ticket table.** Assumed: allowed and fast enough for one read of 20 rows on a large
   incident table (the read has the usual time limit; a time-out is shown as "ServiceNow did not answer in time"). Check on a
   production-sized instance: time `/api/now/table/incident?sysparm_query=close_notesISNOTEMPTY^short_descriptionLIKE1603^ORdescriptionLIKE1603^ORclose_notesLIKE1603^ORDERBYDESCsys_updated_on&sysparm_fields=number&sysparm_limit=20`.
   Wrong (slow): drop `description` from `ticketCodeQuery`, or add `sys_updated_on>=` one year back.
5. **LIKE is not case-sensitive.** Assumed: `LIKE800CCC0F` also finds `0x800ccc0f` (the database's default collation). Check: the list
   filter "Short description contains 800ccc0f" against a ticket written in capitals. Wrong: nothing breaks (the check on each row is
   not case-sensitive), but lower-case writings are missed; search each code in upper and lower case (two OR conditions).
6. **A general task table.** Assumed, as for the look-alikes: a record opened as `task` searches `task` and checks each row's
   `sys_class_name`; a row whose class cannot be read is left out. Check: open a catalog task through `/task.do?sys_id=...` and press
   the search. Wrong: none expected; this is the same rule as `findSimilarTickets`.

## "Solved before by"

7. **`assigned_to` on a solved look-alike is who solved it.** Assumed: the person still assigned when the ticket was resolved is the one
   who solved it. Check: on a few resolved incidents, compare "Assigned to" with "Resolved by". Wrong (they often differ): read
   `resolved_by` for incidents in the look-alike read (`src/context/similar.js`, the lead's file: add it to `TICKET_FIELDS` and
   `HIT_PERSON_COLUMNS`) and count that in `solvedBy`.
8. **`assignment_group` on a solved look-alike is the group that solved it.** Assumed: a resolved ticket is not moved to another group
   afterwards (the routing vote assumes the same). Check: on a few resolved incidents, the group at resolution in the activity
   history. Wrong: nothing to change cheaply; say "went to" instead of "solved" in the line.
9. **"This month".** The approved mockup says "3 look-alikes this month"; the look-alikes have no time window (the newest 30 candidates
   that share words, best 8), so the line says "3 solved look-alikes" and does not claim a month. To say it truly, the look-alike read
   would need a `sys_updated_on>=` condition (the lead's file).

## The codes themselves

10. **What agents paste.** Assumed: the codes in tickets are written as listed in `src/insights/errorCodes.js` (0x and eight hex digits;
    "error 1603"; "HTTP 503"; ORA-; SQLSTATE; exception class names; "Event ID 4625"). A bare number is a code only right after the
    words that say so, so "the error is 1603" or an Arabic "خطأ 1603" is not found. Check: read 20 recent incidents of the service desk
    that quote an error. Wrong: add the pattern (and a test in `tests/fix-errorcodes.test.js`, false positives first).
