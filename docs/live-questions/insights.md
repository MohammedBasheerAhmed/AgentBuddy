# Live questions: the Ticket screen's Insights half (round 3)

What the Insights cards (`src/sidepanel/ticket/cards`, `src/insights`, `src/content/ops/insights.js`) assume about ServiceNow and could
not check against a real instance. Each item: what was assumed, how to check it as a non-admin (`itil`) user, what to change if wrong.
Everything here fails soft today: a read that is refused or empty is said as such, never shown as "none".

## Reads and columns

1. **SLA times (N1 "SLA 2h 10m").** `task_sla.planned_end_time` read with `sysparm_display_value=all` gives the stored UTC time in
   `value`; `stage` values are `in_progress`, `paused`, `completed`, `cancelled` (and some instances `achieved` / `breached`), and
   `has_breached` is `true`/`false`. *Check:* `/api/now/table/task_sla?sysparm_query=task=<incident sys_id>&sysparm_display_value=all`.
   *If wrong:* adjust the stage words in `src/insights/glance.js` (`isFinished`, `isPaused`). A paused SLA's planned end moves; the
   glance says "SLA paused" instead of a time.
2. **VIP flag (N1, N9).** `sys_user.vip` is readable for the caller by an `itil` user. *Check:* `/api/now/table/sys_user/<caller>?sysparm_fields=vip`.
   If a field ACL hides it the answer has no `vip` and the glance shows no mark (it never says "not a VIP"). CSM contacts are
   `customer_contact` rows (a `sys_user` subclass); consumers (`csm_consumer`) have no VIP flag and show none.
3. **Field history (N24).** `sys_audit` (`tablename`, `documentkey`, `fieldname`, `oldvalue`, `newvalue`, `sys_created_on`) is often
   admin-only. *Check:* `/api/now/table/sys_audit?sysparm_query=tablename=incident^documentkey=<id>&sysparm_limit=1` as itil.
   If refused, the journey shows the counters (`reassignment_count`, `reopen_count`), the conversation and the SLA events, and says the
   group path is not readable. *If it is readable on most instances:* nothing to change. *If `sys_history_line` is readable instead:*
   add it as a second source in `readFieldHistory`.
4. **Choice labels for state and priority (N24).** `sys_choice` rows `name IN <table>,task`, `element IN state,priority`, `language=en`.
   *Check* readability and whether non-English instances need the session language instead of `en`. Fallbacks: the base priority
   labels and the base incident states; anything else shows "State 6".
5. **Group names (N24).** `sys_user_group.name` by sys_id. A group the user cannot read shows as "a group you cannot see".
6. **reassignment_count / reopen_count.** `reassignment_count` is assumed on every task table (case, problem, requested item, catalog
   task, task: added to those ceilings by `src/context/specs/insights.js`); `reopen_count` only on incident. *Check* a case and a
   problem form for the column. A missing column is simply not returned.
7. **Recent changes (N25).** Changes are matched by `cmdb_ci` OR `business_service` (by sys_id) with a planned window
   (`start_date`/`end_date`) touching the last 7 days or the next 3. Implemented changes may only have `work_start`/`work_end` filled.
   *Check* a few implemented changes. *If so:* also ask `work_end>=` in `readChangesOnTarget` (src/context/related.js).
8. **Known errors (N26).** `problem` rows on the same CI or service, `active=true` OR `known_error=true`, with `workaround`. On newer
   releases known errors are also knowledge articles (Known Error template, `kb_knowledge` linked through `problem`). *Check* whether
   itil can read `problem` at all and whether the instance uses known-error articles; if so, add them to the card.
9. **Account at a glance (N28).** Uses the case's `account`, `entitlement`, `product`, `asset` display values and the existing
   `accountCases` read. **Not built:** the "priority account" flag; I could not find a standard column on `customer_account` for it.
   *Check* the account form on the instance (and whether entitlements carry a service level) and name the column to read.
10. **Outage threshold (N29).** "Possible outage" = 3 or more OTHER open tickets on the same CI or service opened in the last 2 hours
    (from the existing open-duplicates check, 24-hour window, at most 25 listed). *Check* with a team lead whether 3 in 2 h is right
    for the instance's volume; the rule is `OUTAGE_RULE` in `src/insights/outage.js`.

## Time

11. **Note times in the reader's time zone.** When `sys_journal_field` is not readable the notes come from the record's own strings, in
    the reader's zone. The cards work out the offset from `sys_updated_on` (display value vs stored value) when the display format is
    `YYYY-MM-DD HH:MM:SS`; with any other date format the time is said in days only ("about 3 d"). *Check* a user with a dd/MM/yyyy
    format: "Customer waiting" should read "about N d".
12. **Who is the customer.** "Customer waiting" and the risk words use the same rule as the mood feature: a comment whose author is the
    caller (name, email or login). A comment by an unknown author stops the count. *Check* a ticket where the caller answers by email
    (author may be the email address) and one answered through the portal.

## Links and pages

13. **Workspace record route (N2 links).** On a Workspace page, another record opens at `<prefix>/record/<table>/<sys_id>`, the prefix
    taken from the page's own address (`/now/sow`, `/now/cwf/agent`). Away from a record page, and for knowledge articles, the classic
    `nav_to.do` address is used. *Check* in Service Operations Workspace and CSM Configurable Workspace that a related incident, a
    change and a problem open in the workspace. *If a table has no workspace page:* add it to `CLASSIC_ONLY` in `openRecord.js`.
14. **New tab next to the ticket.** From the Ticket screen a plain click opens the record with `chrome.tabs.create` right after the
    ticket's tab (`openerTabId`), so the ticket and any unsaved typing stay. *Check* in Chrome and Edge, and with tab groups.
15. **"Copy link" for an article (N3).** Classic and Workspace: `<instance>/kb_view.do?sysparm_article=KB...`; on a portal
    `<portal>?id=kb_article_view&sysparm_article=KB...`. *Check* that a customer without the classic UI is sent to the portal article,
    and which portal the instance's customers use (Employee Center `/esc` vs Service Portal `/sp`).
16. **"Open the email form" (N20).** The classic email client (`email_client.do`), in a new tab. Workspaces have their own composer;
    *check* whether agents there prefer the Workspace composer and whether `email_client.do` is allowed for them.

## Wording

17. **State words for the card order.** New / In progress / On hold / Resolved / Closed are recognised from the state's display text
    in English ("Awaiting caller" counts as on hold, "Work in progress" as in progress). An instance with other state names falls back to
    the in-progress order. *Check* the state lists of incident, case, requested item and catalog task.
