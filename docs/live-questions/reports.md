# Reports and dashboards: things to check on a real instance

Written from the reports engineer's hand-back. Nothing here has run against a real ServiceNow instance. Check each as a
**non-admin fulfiller or team lead** (an `itil` user, plus csm / approval roles where it matters). "If wrong" says what to change.

## Instance

1. **`active=true` means open** for incident, sc_req_item, sc_task, sn_customerservice_case, problem and change_request. Compare the
   tile with the "Open" list count in ServiceNow. If wrong, add a per-table open condition in `REPORT_TABLES`
   (`src/reports/engine/constants.js`).
2. **Date literals in `sysparm_query` are read as UTC.** Compare "opened today" with the UI's "on Today" filter for a user whose time
   zone is not UTC. If wrong, change `snLiteral` in `src/reports/engine/time.js`.
3. **"Today" is the browser's time zone**, assumed equal to the person's ServiceNow time zone. Since the 2026-10-30 review the zone's
   summer time is followed day by day (`offsetAt` in `src/reports/engine/time.js`): on the day the clocks change, "today" and every daily
   bucket start at that day's real local midnight. Still assumed: the browser's zone IS the person's ServiceNow zone. Check with a user
   whose ServiceNow profile has another time zone than the computer: "Opened today" against the list's "Opened on Today". If they
   differ, the zone has to come from ServiceNow (for example by comparing `value` and `display_value` of one date column read with
   `sysparm_display_value=all`, which the probe read could do at no extra cost).
4. **Aggregate API with two group-by columns.** `sysparm_group_by=assigned_to,state` with `sysparm_display_value=all` should return two
   `groupby_fields`, and an empty reference comes back as a group with value `''`. Open the stats URL in the browser to see. If
   wrong, the Workload people and group boards are unavailable; the fix is to group by one column and read states separately.
5. **`sysparm_avg_fields=reassignment_count`** returns `stats.avg.reassignment_count` as a numeric string. If wrong, the
   reassignments tile is left out.
6. **Dot-walking in the SLA radar query works in the Table API:** `task.sys_class_nameIN...`, `task.assignment_groupIN...`,
   `task.assigned_to=`, and the `^OR` chain `has_breached=true^ORpercentage>=75^ORplanned_end_time<=...`. Check in a `task_sla` list.
   DANGER: if an unknown dot-walk is silently ignored, the radar could return every SLA. The alternative is to read the tickets first,
   then `taskIN` chunks, as My Day does.
7. **The `task` table is readable by `sys_idIN`** for the classes the person can read. If denied, the radar shows counts only.
8. **`sys_user_grmember` (`user=<me>`) and `sys_user_group` (`nameLIKE...^active=true`) are readable by a fulfiller.** If not, "my groups"
   falls back to the groups of my own tickets and the picker says groups are not available.
9. **Which date and count columns exist.** `resolved_at` for incident, problem and case; `closed_at` for requested items, catalog tasks
   and changes; `reassignment_count` and `reopen_count` on incident only. The first column that appears in a probe row is used and the
   section says when none exists.
10. **State words decide "waiting" and the New / Open / Waiting groups** (`stateClass` in `src/reports/engine/common.js`). Check each
    table's choice labels. Customised labels may need the regex extended.
11. **`sysapproval_approver` is readable** for one's own approvals (`approver=<me>^state=requested`) and, for a team, via
    `sysapproval.assignment_groupIN...^sysapproval.sys_class_name=sc_req_item`.
12. **Aggregate counts equal what the person's own list shows** (row-level ACLs). Compare one number per table with the UI.
13. **The repeat-caller breakdown** (one group per caller over 30 days) is fast enough on a large instance.
14. **`category` and `cmdb_ci` group-by need those columns readable.** Otherwise the top lists are left out.

## Browser

15. **Full page.** The content script now answers an extension page open in a tab (sender origin check in `src/content/index.js`).
    Check: Team tab, then "Open full page". It must show the dashboard, not "open ServiceNow and reload".
16. **`chrome.tabs.get(tabId).url` is filled for an enabled instance's tab without the `tabs` permission.** If empty, the full page
    says "not enabled".
17. **Print / Save as PDF.** `window.print()` works on the full page. In the side panel it may not. The print stylesheet forces dark
    text on white through system colours and the accent becomes `LinkText`. Check printing with the browser in dark mode.
18. **Download CSV** (a `blob:` link in an extension page) and **Copy as table** (clipboard API, with a text-area fallback) work in
    the side panel and on the full page.
19. **`/nav_to.do?uri=<table>_list.do?sysparm_query=...`** (query encoded twice) opens the right filtered list on classic and in
    Workspaces. Check a long query (several groups) and `sn_customerservice_case` and `task_sla`.
20. **Layout at 320 px** was checked only in headless Chrome with a mock. Check tiles (two per row), stacked bars, the trend chart
    (it measures its own width) and the table cards in the real panel, light and dark.

## Policy

The feature id `reports` in `disabledFeatures` turns the Team tab off. `blockedTables` is honoured on every report read. Mention both
to the policy author (`docs/deployment.md`).

## Added by the 2026-10-30 review (correctness, links, load on the instance)

21. **`task_sla.business_percentage` is filled for every SLA** (equal to `percentage` on an SLA without a schedule), and an SLA with a
    schedule breaches when IT reaches 100. The reports and My day now judge "at risk" by it, as the record view does
    (`src/context/related.js`); the plain `percentage` (which counts nights and weekends) is used only when the business one is empty.
    Check an 8-to-5 SLA in the evening: plain above 100, business below, not breached. If business is empty on real rows, nothing
    breaks (the plain one is used), but say so here. The SLA read asks for `business_percentage>=75^ORpercentage>=75` so no row is missed.
22. **A paused SLA has `stage` = `paused`** (raw value). It is never counted "due soon" (its clock is stopped and its planned end moves
    when it resumes), and the "Due soon" list adds `stage!=paused`. Check the stage choice values on `task_sla`.
23. **"0" from `task_sla` and `sysapproval_approver` is checked.** When a count is 0, one unfiltered one-row read asks whether the person
    can see ANY row of the table; if not, the tile says "not available" (you can see no SLA / approval records at all) instead of 0.
    Check with a user who has no SLA read access: the SLA tiles must not say 0.
24. **The Aggregate API's `sysparm_having`** (`count^caller_id^>^2`) returns only the groups with at least 3 tickets. The engine now passes
    `having` to the table client for the repeat-caller breakdown, but `aggregate()` in `src/content/tableApi.js` (not owned by reports)
    does not send it yet, so today the instance still returns one group per caller and the engine filters. Check on a real instance:
    `/api/now/stats/incident?sysparm_count=true&sysparm_group_by=caller_id&sysparm_having=count^caller_id^>^2`. If the syntax differs,
    change the string in `groups()` (`src/reports/engine/reader.js`).
25. **A list drill-down is a real link** (`/nav_to.do?uri=<table>_list.do?sysparm_query=...`, target `_blank`, `rel=noopener noreferrer`):
    a plain click opens it in the ServiceNow tab, Ctrl/middle-click in a new tab, the right-click menu offers "Open link in new tab".
    Check in the real side panel and on the full page, light and dark, with the keyboard (Tab to a bar, Enter).
26. **SLA counts filter by the exact ticket class** (`task.sys_class_nameINincident,...`), while ticket counts on a parent table include
    its child classes (a case subclass, for example). If an instance uses child classes of the report tables, the SLA tiles may count
    fewer tickets than the Open tile. Check whether your cases or changes use child tables.
27. **Reports go through the content script's policy guard** (`src/content/policyGuard.js`): the managed policy's `blockedTables` is now
    refused inside the ServiceNow page as well (row reads through the guard, Aggregate API reads checked with its `isBlocked`), not
    only by the list the panel sends. Check with a managed policy that blocks `problem`: no request to `problem` in the network log.
28. **One "as of" instant per dashboard load.** All widgets of one load send the same `params.asOf` (the moment Refresh was pressed or the
    dashboard opened), so "no update in 3 days" and "due within 4 hours" are the same question for every widget and the second
    widget's reads come from the cache. The engine ignores an instant older than ten minutes. Check in the network log: a Team
    overview load should not repeat a count with a timestamp one minute later.
29. **The ServiceNow tab moving does not reload the Team tab.** Widgets read again only when the tab, the instance, the scope, the tables,
    a section's own setting or Refresh change. A read that was on its way when the page changed waits and asks again (1.5 s, then
    4 s). On the full page, the dashboard stays (with a line saying the tab is not answering) while the tab loads. Check: open the
    Team tab, click around in ServiceNow, and watch the network log: no new report reads.
