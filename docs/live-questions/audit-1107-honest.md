# Live questions: honest reads (audit of 2026-11-07, part 3, R-02 to R-22)

Workstream "honest reads": the panel states an absence ("none", "nobody", "no warning signs", a green "all clear") only when the read for
it completed (`src/context/seen.js`), and says plainly that it could not check otherwise. Built without a real instance. Each question
below is something the build ASSUMES about what ServiceNow answers; the safe reading was built (an unknown stays unknown). Check each as
a user with only the fulfiller roles (`itil`), in the browser console of an already open ServiceNow tab (GET only). For each: what was
assumed, how to check it, what changes if it is wrong. Nothing here asks for an administrator, except where it says so.

1. **A column the user may not read is left OUT of the row (the key is missing); an empty column comes back as an empty value.** The whole
   "could not read it" versus "empty" distinction rests on it (R-14): `absentColumns` in `src/context/access.js`, used by the pack
   (`pack.unreadable`), the changes, problems and outage reads (the ticket's configuration item and service), the account of a case, the
   caller's VIP flag and email, and the ticket's own notes columns. Audit 5 (4d) has no source for the Table API; the live check C10 is
   the same question.
   Check: pick a ticket and a column whose read is restricted by a field ACL for your role (ask an administrator which one, on a test
   instance; or `work_notes` for a user without the role that reads it). Run
   `(await (await fetch('/api/now/table/incident?sysparm_limit=1&sysparm_display_value=all&sysparm_fields=number,work_notes,cmdb_ci,description', {credentials:'same-origin'})).json()).result[0]`
   and write down, for the restricted column: missing key, empty string, `{value:'',display_value:''}`, or a mask. Also write down what an
   ordinary empty column (a ticket with no CI) looks like.
   Change if wrong: if a restricted column comes back as an empty value, a hidden field cannot be told from an empty one and the
   "could not check" lines never fire for fields; the code stays harmless (nothing worse than before), and the checks that cannot be
   known should stay worded as "empty, or not readable" (as the AI text already is). If it comes back masked, treat the mask as empty in
   `absentColumns`' callers.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (the key is missing: asking an ITIL User for seven user columns returned only the four that role may read).

2. **A reference whose target the user may not read comes back with an empty `display_value` (or the id as the display value).**
   `disp()` (`src/context/util.js`) now returns '' for any 32-hex display value, so a group, an assignee, an approver or a requester
   whose name is hidden is never shown as an id (D1, R-13); the pack lists the column in `pack.unreadable`, and the Glance says "Not
   shown to you" instead of "Nobody yet" or an "Unassigned" chip. Audit 1 (D1) could not settle which of the three the instance sends.
   Check: open a ticket whose assignment group or assignee your role cannot read (a group with a read ACL on `sys_user_group` for another
   role) and run the same `fetch` with `sysparm_fields=number,assignment_group,assigned_to`. Write down `value` and `display_value` of
   that column.
   Change if wrong: if the instance sends something else for a hidden name (a placeholder text, `null`), add it to `disp()` as a
   hidden marker. If it sends the NAME of the group even when the row is hidden, nothing needs to change.

3. **`/api/now/stats` (the Aggregate API) may count rows the user cannot list.** Team numbers and My work totals come from it (R-15). Not
   changed in the panel: no line was added to the Team screen (the owner asked for no new text on a clean screen); the zero counts
   already go through `visibility()`. If counts disagree with the lists, the fix is one visible line on Team and My work.
   Check: as a user whose rows are filtered by a row ACL or a domain, compare
   `(await (await fetch('/api/now/stats/incident?sysparm_count=true&sysparm_query=active=true', {credentials:'same-origin'})).json()).result.stats.count`
   with the number of rows a list of `active=true` incidents shows (the list's header, or paging the Table API to the end).
   Change if wrong (the count is larger than the list): show "counts from ServiceNow's summary; your list may show fewer" under Team
   and My work, in `src/sidepanel/reports` and `src/sidepanel/mywork`.

4. **For a user without read access to `work_notes`, ServiceNow removes the work-note rows from `sys_journal_field`.** The journal read
   then finds comments only, and (R-18) says "Some internal notes may be hidden from you" only when the ticket's own `work_notes` column
   did not come back either (question 1) and no work note was found. Check: as a user who cannot read work notes on a ticket that has
   some, run
   `(await (await fetch('/api/now/table/sys_journal_field?sysparm_query=name=incident^element_id=<sys_id>^element=work_notes&sysparm_fields=element,value&sysparm_limit=5', {credentials:'same-origin'})).json()).result`
   and write down whether rows come back. Change if wrong: if the rows come back, nothing is hidden and the note never fires (harmless);
   if the rows are removed and the ticket's own column comes back EMPTY (not missing), the note cannot fire and the AI text keeps its
   "may be hidden" hedge (`src/features/parts.js`).

5. **The Table API applies a knowledge base's "Can read" criteria for the signed-in agent, but the agent's reading is not the
   customer's.** The Knowledge card's "Copy link" now asks the agent to check that the customer can open the article (R-10); nothing is
   checked. The articles listed are `workflow_state=published`, not expired (`valid_to`) and not retired (`active`, read on the same row,
   no new read). Check: with a requester (non-fulfiller) account, open `…/kb_view.do?sysparm_article=KB0000001` for an article only a
   knowledge base of fulfillers can read, and for an article in a public base. Write down which open and what the end user sees for the
   other. Change if wrong: if an end user can open every published article, the hint can go; if not, label the knowledge bases that are
   not public using a column an agent can read (`kb_knowledge_base` fields; ask which one is readable).

6. **`sysapproval_approver` is readable by a fulfiller who is not an approver.** The request status says "Waiting for approval (the
   approval is not visible to you)" when the approval column says requested and no row is readable (R-07), and the AI text for an empty
   list says "No approval requests that your user can see were found". Check: as plain `itil`, on a request item with a pending
   approval, `(await (await fetch('/api/now/table/sysapproval_approver?sysparm_query=sysapproval=<sys_id>&sysparm_limit=1', {credentials:'same-origin'})).json()).result.length`.
   Change if wrong: nothing; if the table is never readable, the probe (`confirmEmptyIsReallyEmpty`) already says "you can see none at
   all".

7. **A user may not see every class of child task** (R-05). The resolve check says "No {tasks} that you can see under this ticket"
   and the AI text "No child tasks that your user can see"; the read cannot prove more (the table `task` is declared visible without a
   probe). Check: as plain `itil`, on an incident that has a security task or a change task under it,
   `(await (await fetch('/api/now/table/task?sysparm_query=parent=<sys_id>&sysparm_fields=number,sys_class_name', {credentials:'same-origin'})).json()).result`
   and compare it with the form's Child tasks list. Change if wrong: probe each class the ticket can have (one more read per class).

8. **`g_user.userID` (and the session token) changes when an administrator impersonates a user or when the signed-in user changes.** The
   panel keys every cached read by `page.user.userId` and clears them when it changes (R-16, R-17); the "Me" lookup is dropped when the
   page names another user name or the session token was forgotten. Check: with an administrator on a test instance, impersonate a
   user and run `[g_user.userID, g_user.userName]` before and after; then sign out and in as another user in the same tab and run it
   again. Change if wrong: if `g_user.userID` does NOT change on impersonation, key by `g_user.userName` as well (`userKeyOf` in
   `src/sidepanel/ticket/cards/useInsight.js`, `shareKey` in `src/sidepanel/team/teamShare.js`, the hash in `src/lib/lastViewed.js`).

9. **A page that does not name the signed-in user (a portal) still gets an id from the "Me" lookup.** "Since you last looked" needs it
   (the times are kept per person, as a hash of the user id); without an id nothing is remembered and nothing is said, instead of
   measuring against another person's visit (R-17). Check: on a Service Portal and an Employee Center page, with the panel open, look
   at Settings > Stored data: the count of "Tickets you opened" should grow when you open tickets there. Change if wrong: if it stays at
   zero on portals, the "Me" lookup is failing there (`src/content/sessionToken.js` `lookUpMe`).
