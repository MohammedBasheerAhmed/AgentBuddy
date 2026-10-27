# Reports and dashboards: things to check on a real instance

Written from the reports engineer's hand-back. Nothing here has run against a real ServiceNow instance. Check each as a
**non-admin fulfiller or team lead** (an `itil` user, plus csm / approval roles where it matters). "If wrong" says what to change.

## Instance

1. **`active=true` means open** for incident, sc_req_item, sc_task, sn_customerservice_case, problem and change_request. Compare the
   tile with the "Open" list count in ServiceNow. If wrong, add a per-table open condition in `REPORT_TABLES`
   (`src/reports/engine/constants.js`).
2. **Date literals in `sysparm_query` are read as UTC.** Compare "opened today" with the UI's "on Today" filter for a user whose time
   zone is not UTC. If wrong, change `snLiteral` in `src/reports/engine/time.js`.
3. **"Today" is the browser's time zone**, assumed equal to the person's ServiceNow time zone.
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
