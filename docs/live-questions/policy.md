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

## Round 3: sites turned on by the organisation, setup (F1, Foundation)

11. **Exact instances in `allowedInstances` are turned on by themselves.** The service worker treats every exact address in the policy's
    `allowedInstances` (managed policy, or compiled into an enterprise build) as wanted, and registers the content scripts for those the
    browser has granted (`src/background/instances.js`). A wildcard entry turns nothing on. In a normal build the browser grants a site
    only after the person allowed it once, or after the organisation granted it with the browser's own `runtime_allowed_hosts` /
    ExtensionSettings policy. Check: put `allowedInstances: ["https://<instance>"]` in the managed policy, grant the site (or use the
    enterprise build), open the instance: the tab should work without "Turn on". Change if an organisation does not want that: a policy
    key such as `autoEnableInstances: false` (it would be a new key: the lead's).
12. **`permissions.onAdded` fires when the browser's own site-access menu grants a site.** The worker then registers the scripts and
    injects into that site's open tabs. Check: Chrome's puzzle menu, "This can read and change site data", "On <site>".
13. **After an update the open tabs keep working.** On `onInstalled` with reason `update` the worker injects the new content script into
    the open tabs of every active site; the new copy replaces an old one whose `chrome.runtime.id` is gone and tells copies in another
    isolated world to remove their bar (`agentbuddy-content-takeover`). Not checked with a real store update. Check: load the unpacked
    build, open an incident, change the version in the built manifest, press "Update" in chrome://extensions, and use the bar and the
    panel without reloading the tab. The page bridge (MAIN world) of the old version stays (it guards against a second copy); it answers
    the same requests, so this only matters if a later version changes the bridge's protocol.
14. **The one-time look at a tab that is not turned on.** To offer "Turn on" only on ServiceNow, the panel runs one small function in
    the tab (chrome.scripting, MAIN world, through the toolbar click's `activeTab`; no new permission) that answers four booleans: is
    there `g_ck`, a `NOW` object, `GlideAjax` or `g_user`, a script from `/scripts/*.jsx`, `/uxasset/`, `/api/now/` or `/amb/`. Check on a
    customer domain instance (not *.service-now.com) that the look finds at least one of them on the login-free pages people land on
    (`/now/nav/ui/...`, `/navpage.do`, `/sp`). If not, the panel says "This does not look like ServiceNow" and offers "Turn on anyway",
    which still works.

## Round 3: the organisation's dashboard and priority accounts (N17, N28)

15. **The browser accepts `defaultDashboard` as one nested object.** `managed_schema.json` declares every part of a saved layout file
    (kind, version, dashboard with name, scope, tables and widgets, and inside a widget its section, settings or custom report), because
    the browser leaves out what the schema does not declare. Assumed, not checked on a managed device: (a) a `"tables": null` is refused
    by the browser's check (the docs say to leave `tables` out, which means every table); (b) on Windows the value can be written as one
    `REG_SZ` holding the file's JSON, which Chrome and Edge turn into the object for a key whose schema type is `object`. Check: deploy
    the example from docs/deployment.md (as a `REG_SZ` on Windows, a dict in a `.mobileconfig`, an object in the Linux JSON), open
    `chrome://policy`, find Agent Buddy and check that `defaultDashboard` shows status OK with every part present; then open the Team
    screen on an instance with no saved dashboards. Change if wrong: if parts are dropped, declare them; if the registry string is not
    turned into an object, document subkeys, or accept the JSON text as the value (src/policy/policy.js already reads a string as the
    file's JSON).
16. **`priorityAccounts` names match the account as the case shows it.** The case's account is read as its display value (the account's
    name, `customer_account.name`), the same text the Account card shows. Assumed: an organisation writes those names exactly as
    ServiceNow shows them, and a name is at most 100 characters (the account name column is assumed to be shorter). Check: open a case
    of an account on the list and see "Priority account" on the Account card and in the top line; rename the account in a test instance
    and see the mark go. Change if wrong: if organisations prefer the account number, match `account.number` too (it is not read today:
    that would be one more column on the case spec, src/context/specs/insights.js).
