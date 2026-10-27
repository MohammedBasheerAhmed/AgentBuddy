# Live questions: policy at the read boundary (blocked tables, HR classes, reference people, token budget)

Everything below was built without access to a managed browser or a real instance. Check each one as a user with only fulfiller
roles, in a browser that has a managed policy for the extension (see docs/deployment.md). For each: what was assumed, how to check
it, what to change if it is wrong.

## The managed policy in the content script

1. **A content script can read `chrome.storage.managed`.** `src/content/policyGuard.js` calls `chrome.storage.managed.get(null)` from
   the content script every 30 seconds. Chrome documents `storage.managed` for extension pages; whether the content-script copy of
   `chrome.storage` exposes it is not something this build could test.
   Check: set `blockedTables` to `["task_sla"]` in the managed policy, reload the extension, open an incident, open the Related tab
   or run "Summarise this ticket" and look at the notes under the pack: `task_sla` should say "Your organisation does not allow
   Agent Buddy to read task_sla records" and no request for `task_sla` should appear in the network panel of the instance tab. If
   the SLAs are read, open the content script console and run `chrome.storage.managed` to see whether it exists.
   Change if wrong: the guard falls back to "no policy known" and blocks nothing at read time (the AI run still refuses a blocked
   table). The fix is a small message from the content script to the service worker (which can read managed storage) asking for the
   policy, or the panel passing `blockedTables` with every read (the reports reads already do). Both need a change in
   `src/background/service-worker.js` or `src/sidepanel/ask.js`, which belong to other areas.

2. **A policy change reaches an open page within 30 seconds.** `chrome.storage.managed` policy changes normally need no reload, but a
   browser may cache them. Check: change `blockedTables` while a record is open and wait 30 seconds.

## Real classes and HR

3. **A fulfiller can read `sys_id` and `sys_class_name` of a `task` row** (one GET with `sys_id=<id>`) for the records they work
   on. `readContextPack` uses it when a record is opened as the base class `task` to find the real class. If the read is refused
   (403, or an empty answer) the record is treated as sensitive: minimised and, for AI, HR-gated. Check: open `/task.do?sys_id=<an
   incident id>` and run "Summarise": the pack should be an incident, with free text. Then do the same where the ACL on `task`
   hides rows: the record should be reported as "its real type could not be looked up" and nothing should be sent unless HR is
   allowed. Change if wrong: if too many ordinary tasks end up treated as sensitive, resolve the class from the page (the form
   knows `sys_class_name`) instead of the base table.

4. **`sys_class_name` is the table name** (`incident`, `sn_hr_core_case`), not a label, in `sysparm_display_value=false` reads. The
   class lookup and the blocked-class check rely on it. Check: `/api/now/table/task?sysparm_query=sys_id=<id>&sysparm_fields=sys_class_name`.

5. **A custom HR family has a common prefix.** `sensitiveTablePrefixes` matches by prefix. An organisation whose HR tables share no
   prefix must list them in `blockedTables` instead. Check with the customer's table list.

## Reading rules

6. **`sys_journal_field` has a `name` column holding the table of the record.** The journal reader already queries `name=<table>`.
   For a second check the guard adds `name` to the columns asked for when something is blocked and refuses rows of a blocked table.
   Check: `/api/now/table/sys_journal_field?sysparm_limit=3&sysparm_fields=name,element_id`. If `name` is empty or refused, the
   query clause still protects the normal read; only the second check does nothing.

7. **The columns of `sc_item_option_mtom` that go through other tables are named after those tables** (`sc_item_option`,
   `item_option_new`). The guard treats every dot-walked step as a possible table name, so blocking `sc_item_option` stops the
   variable answers. If an instance names the reference columns differently, a block on those tables does not stop the answers (block
   `sc_item_option_mtom` instead).

8. **The person columns of other tickets return display names for a fulfiller.** The look-alike, linked-incident, change and case
   reads ask for `caller_id`, `opened_by`, `assigned_to` and the like with display values, and use the display name. If a fulfiller
   cannot read the user table, the display value can be the sys_id; such a value is dropped (never shown or sent), and that person is
   then not masked by name. Check: read a look-alike ticket from `/api/now/table/incident?sysparm_display_value=all&sysparm_fields=caller_id`.

9. **A child task of a blocked class refuses the whole list.** The guard refuses a whole `task` read when any row is of a blocked class
   (a child task that is an incident when `incident` is blocked), rather than filtering the row out. Check: block `change_task`, open
   an incident with a change task as a child and look at the child tasks: the list should say the organisation does not allow it.

## Budget

10. **The usage log is the right count for the budget.** `tokenBudgetPerDay` is compared with the tokens in the local usage log
    (`agentbuddy_ai_usage`, written by `src/providers/budget.js`). Providers that return no usage numbers add zero. Check: make three
    calls against a provider that returns usage and one that does not, and compare the Usage view with `tokenBudgetPerDay`.
    Change if wrong: count the calls as an estimate (characters / 4) when a provider reports no usage.
