# Live questions: the catalog fulfiller pass (wave 6: "Fulfilled before", the exact comment words, the approval chase)

What was built assumes the ServiceNow behaviour below. Each question says what was assumed, a line to run in the browser console on a
ServiceNow page you are signed in to (as an ordinary fulfiller, not an administrator; the lines use the page's own token `g_ck`, as the
extension does, and only read), and what to change if the answer is different. Every assumption has a safe version already: the panel says
"could not check" or names who without how long, and never claims "none" or "the requester can read it" on a guess.

Replace `ITEM` with the sys_id of a catalog item that has been fulfilled before (`sc_cat_item`), `RITM` with the sys_id of an open requested
item of that item, and `TASK` with the sys_id of a catalog task. A helper for the lines below:

```js
const get = (path) => fetch(path, { headers: { 'X-UserToken': window.g_ck, Accept: 'application/json' }, credentials: 'same-origin' }).then((r) => r.json().then((j) => ({ status: r.status, total: r.headers.get('X-Total-Count'), j })));
```

## Fulfilled before (`src/content/ops/fix.js` `readFulfilledBefore`, `src/context/specs/fix.js`)

1. **A dot-walked condition works in a query.** Assumed: `sc_task` accepts `request_item.cat_item=<sys_id>` in `sysparm_query` for a fulfiller
   (the pack already READS that walked column, `docs/live-questions/audit-1107-fit.md` question 1; this is the first time it is a CONDITION).
   Check:
   `get('/api/now/table/sc_task?sysparm_query=' + encodeURIComponent('request_item.cat_item=ITEM^state=3^request_item!=RITM^ORDERBYDESCclosed_at') + '&sysparm_limit=15&sysparm_fields=number,state,request_item,request_item.cat_item&sysparm_display_value=all&sysparm_exclude_reference_link=true').then((r) => console.log(r.status, r.total, r.j.result?.map((x) => [x.number?.display_value, x['request_item.cat_item']?.value, x.state?.value])))`
   Expect `200` and rows whose item is `ITEM`. If the status is `403` ("Insufficient rights to query records") the card says "Could not check
   earlier tasks for this item" and nothing else breaks; the fix is to read `sc_req_item` first (`cat_item=ITEM^state=3`, their ids), then
   `sc_task` by `request_itemIN<ids>`, in `readFulfilledBefore`. If the status is `200` but a row is of another item, the card shows "ServiceNow
   did not narrow the results as asked" (every row is checked again) and lists nothing.
2. **`state=3` is Closed Complete on a catalog task.** Assumed (verified on `dev364920`, `docs/live-checks-2026-11-07.md`; not on a customer
   site): the stored value 3 means Closed Complete on `sc_task`, and the site has not changed the list. Check: `get('/api/now/ui/meta/sc_task').then((r) => console.log(JSON.stringify(r.j.result?.columns?.state?.choices)))`.
   If the site renumbered its states, the query finds nothing or the wrong rows; every row is also checked with the one state reader
   (`src/domain/states.js`), so a wrong row is dropped, and when nothing usable is left the card says it could not check. Change `state=3`
   in the query to the site's value (or drop it and rely on the reader, reading more rows).
3. **A fulfiller sees the earlier tasks of other requests.** Assumed: the read rule of `sc_task` lets a fulfiller read tasks assigned to
   other groups (many sites show a fulfiller only their own groups' tasks). A row-filtered read is `200` with fewer rows, so the card says
   "No earlier tasks for this item that you can see" (never "none"). Check: the call in question 1 as the fulfiller and as an administrator
   (impersonate); compare `X-Total-Count`. If a site shows a fulfiller only their group's tasks the card is still honest, but smaller; nothing
   to change.
4. **The close notes, the time and the name come back.** Assumed: `close_notes`, `opened_at`, `closed_at` and `assigned_to` are readable on
   `sc_task` for a fulfiller; one that is not arrives as a missing key (`docs/live-checks-2026-11-07.md`). Check: the call in question 1 with
   those four names in `sysparm_fields`, then `Object.keys(r.j.result[0])`. A missing `close_notes` shows "Close notes are not shown to you."
   on that row, a missing `assigned_to` leaves the name out, missing times leave "took ..." and "closed ..." out. Nothing to change.
5. **"Opened to closed" is how long it took.** Assumed: `opened_at` is when the task was created (for a workflow task, when the item
   reached it) and `closed_at` when it was closed, so the span includes any time it waited. It is what the brief asked for and what a person
   reading a task sees; a task that sat in Pending for a week reads "7 days". Nothing to change unless fulfillers find it misleading; then
   use `work_start` where the site fills it.
6. **A requested item with a deleted or empty catalog item.** Assumed: `cat_item` on a requested item can be empty (an item ordered from a
   record producer, an import); the card then says "This ticket has no catalog item, so earlier tasks for it were not looked up." Check:
   `get('/api/now/table/sc_req_item?sysparm_query=cat_itemISEMPTY&sysparm_limit=1&sysparm_fields=number,cat_item')`. Nothing to change.

## The exact comment words (`src/domain/requesterReads.js`, `src/lib/fillable.js`)

7. **A requester reads a catalog task only when `opened_by` is them.** Assumed (from the read rule in `docs/live-checks-2026-11-07.md`, with
   "plus scripted rules"): so a comment on a task they opened is read by them, and a comment on a task someone else opened is not.
   Check as the requester (Impersonate user): `get('/api/now/table/sc_task/TASK?sysparm_fields=number,opened_by,comments&sysparm_display_value=true')`
   for a task they opened (expect `200` with the comments) and for one opened by someone else, such as the system user or a colleague who
   ordered for them (expect `403`, or `200` with no rows from a list read). If a site also lets the requester read tasks of their items
   (`request_item.requested_for` in the rule), then "The requester may not see this." is too careful for those tasks: it says "may not", so it
   is not wrong, but change `requesterCanRead` to say `true` when the requester is the item's `requested_for` and the task's `opened_by` is
   anyone. If a site stops the requester reading a task they opened, "can read" is wrong: make `requesterCanRead` return `null` there.
8. **`opened_by` of a catalog task is the person who placed the order.** Assumed: it is the user who submitted the request (a self-service
   order: the requester themselves; an order for someone else: the colleague who placed it; a flow-created task: sometimes the system user).
   Check: `get('/api/now/table/sc_task?sysparm_limit=10&sysparm_fields=number,opened_by,request_item.requested_for&sysparm_display_value=true')`
   and compare the two names on a few tasks. If most tasks are opened by a system user, the answer is mostly `false` ("may not see"), which
   is the careful one; nothing to change.
9. **The panel's people list names the opener and the requester.** Assumed: the Ticket screen's own read (`insights-ticket`) lists both
   `opened_by` and the requester walked from the item among the pack's people, once each (one entry when they are one person), and a
   column the person cannot read is in `pack.unreadable` (then the answer is "not known"). This is tested with the fixtures; on a real
   instance the only thing that can differ is a hidden column, which already gives "not known".

## The approval chase (`src/checks/approvalChase.js`, `src/context/related.js`)

10. **`sys_created_on` of an approval is when it was asked for.** Assumed: the approval row of a requested item is created when the approval
    is requested, so its creation time is the start of the wait. Where a flow creates all the approval rows when the request is placed and
    sets later ones to "Not Yet Requested" (an ordered chain), a row that has become "Requested" is older than its wait, and the line says
    "for N days" for a wait that started later. Check: an item with two approvers in order; after the first approves, read
    `get('/api/now/table/sysapproval_approver?sysparm_query=sysapproval=RITM&sysparm_fields=approver,state,sys_created_on,sys_updated_on&sysparm_display_value=all')`
    and compare the second row's two times. If they differ by days, change the shape in `src/context/related.js` to use `sys_updated_on` for
    a row whose creation is more than a minute before its last update, and say so in the line (or leave the time out for such rows).
11. **A fulfiller can read `sys_created_on` of an approval.** Assumed: it is a system column and arrives with the row like `sys_updated_on`
    (which was already read). If it is missing from the row (hidden), the line names who without how long ("Waiting on Dana Lee."), never
    the last update in its place. Check: the call in question 10 and `Object.keys(r.j.result[0])`. Nothing to change.
12. **A group approval names the group.** Assumed: a row of a group approval has `group` set and `approver` empty or a member; the line
    names the approver when there is one (the person to chase) and the group otherwise. Check: an approval assigned to a group on the
    dev instance. If the group is on the row but the person is a different member each time, name the group first in `describeApproval`
    (`src/checks/requestStatus.js`).
