# Audit 2: what Agent Buddy does and shows on a ServiceNow page that is not a ticket form

Date 2026-11-07. Read-only. Scratch scripts (all read-only `node` runs importing the project's own pure modules):
`scratchpad/matrix.mjs`, `dock.mjs`, `label.mjs`, `glance.mjs`, `plain.mjs`. Nothing in D:\AgentBuddy was changed (`git status` clean).
VERIFIED = I ran the project's code and quote its output. ASSUMED = reasoned from code or from ServiceNow knowledge, not executed
(no browser, no real instance was touched, and the Glance component was not rendered, only its pure builder was run).

## 1. Root cause in one paragraph

Nothing in `src/` contains `ui_page`; the string comes from the page. The extension turns ANY address of the form
`/<name>.do?sys_id=<32 hex>` (or `?sysparm_query=sys_id=<hex>`, or a portal `?table=<name>&sys_id=`, or any `g_form` that reports a table and a
sys_id) into a "record" whose table is `<name>`, with no check that `<name>` is a table, let alone a ticket table. A record of an unknown
table gets kind `other`, the Ticket screen draws, and the top line of the Ticket screen is `record.number || header.number || record.table`:
the raw table name. The header read then goes to `/api/now/table/<name>`, fails (400 "Invalid table", or the table has no number/title
column), and every failure is worded "Details are not available to you." So the person sees `ui_page` / "Details are not available to
you." That second line is the "access" complaint: it is a wrong table being asked, not an access decision.

VERIFIED output of the project's own functions for the shape that produces the literal:

```
/ui_page.do?sys_id=<id>  ref {"table":"ui_page","sysId":..}  resolved ui_page/other  status record
buildGlance(record ui_page, header failed) -> {"number":"ui_page","title":"Details are not available to you.","titleKind":"denied"}
buildGlance(record ui_page, header loading) -> {"number":"ui_page","title":"Loading…"}
ticketLabel (Write screen) -> "For ui_page"
```

Which real ServiceNow home page carries `ui_page`: UNKNOWN (cannot be verified without the owner's address bar). The candidates that make
the extension print exactly `ui_page` are (a) an address `/ui_page.do?sys_id=<hex>` or `/now/nav/ui/classic/params/target/ui_page.do%3Fsys_id%3D<hex>`
(VERIFIED to give `ui_page`), or (b) `g_form.getTableName()` returning `ui_page` with a sys_id in some frame of the home page
(VERIFIED that the resolver then trusts it, `bridge.js:741-766` + `recordResolver.js:81-84`; ASSUMED that the owner's home page has such
a frame: `resolveFormWindow` `bridge.js:60-81` takes the FIRST of up to 20 child frames that has `g_form.getValue`, so a hidden or widget
iframe on a home page is enough). I rank (a)/(b) together as the cause with HIGH confidence in the mechanism, LOW confidence in the exact address.
Ask the owner for the address bar text of the page where `ui_page` shows; one line settles it.

What the home page itself does NOT do (VERIFIED, see table): `/now/nav/ui/home`, `/home.do`, `/welcome.do`, `/navpage.do`,
`/$pa_dashboard.do`, `/sp`, `/esc`, `/sp?id=ui_page` all give "no record", no read, and the plain "Open a ticket" empty state.
The portal `pageId` (`ui_page` from `?id=ui_page`) is VERIFIED to be kept in `portalInfo().pageId` but is never drawn anywhere
(only used to build links, `openRecord.js:34-38`), so it cannot be what the owner saw.

## 2. Table: URL shape -> function results -> what the person sees (host dev364920.service-now.com, ID = 32 hex)

Columns: parseRecordRef (ref) | surfaceOf | portalInfo | resolveRecord via makeRecordResolver with no g_form (resolved table/kind) | panel state.
All cells in this table are VERIFIED (run in `matrix.mjs`) unless marked.

| URL shape | ref | surface | portal | resolved | What the panel shows (Ticket screen) | Verdict |
|---|---|---|---|---|---|---|
| `/now/nav/ui/home` | null | workspace | null | none | "Open a ticket" help + bottom bar of screens (My work, Team, Write, Knowledge) | OK |
| `/home.do`, `/welcome.do`, `/navpage.do`, `/$pa_dashboard.do` | null | classic | null | none | same | OK |
| `/now/nav/ui/classic/params/target/%24pa_dashboard.do[...]` | null | classic | null | none | same | OK |
| `/nav_to.do?uri=%2Fhome.do` / `uri=%24pa_dashboard.do` | null | classic | null | none | same | OK |
| `/ui_page.do` (no sys_id) | null | classic | null | none | same | OK |
| **`/ui_page.do?sys_id=ID`** | `{table:ui_page,sysId}` | classic | null | **ui_page / other** | **top line `ui_page`, title "Details are not available to you."** | BUG (the complaint) |
| **`/now/nav/ui/classic/params/target/ui_page.do%3Fsys_id%3DID`** | `{ui_page}` | classic | null | **ui_page / other** | same | BUG |
| `/ui_page.do?sysparm_query=sys_id=ID` | `{ui_page}` | classic | null | ui_page / other | same | BUG |
| `/sys_ui_page.do?sys_id=ID` (a UI page record, admin) | `{sys_ui_page}` | classic | null | sys_ui_page / other | top line `sys_ui_page`, "Details are not available to you." | BUG |
| `/sys_ui_macro.do?sys_id=`, `/sys_script.do?sys_id=`, `/sys_report.do?sys_id=`, `/sys_user.do?sys_id=`, `/sys_user_group.do?sys_id=`, `/cmdb_ci_server.do?sys_id=`, `/sc_cat_item.do?sys_id=` | each table | classic | null | `<table>` / other | top line = the raw table name, same denied-looking title | BUG |
| custom UI page `/my_page.do?sys_id=ID` | `{my_page}` | classic | null | my_page / other | same | BUG |
| `/home.do?sys_id=ID`, `/welcome.do?sys_id=ID` | `{home}` / `{welcome}` | classic | null | home / other, welcome / other | top line `home` / `welcome` | BUG (any page that carries a sys_id param) |
| `/sys_ui_page_list.do`, `/incident_list.do[?sysparm_query=..]`, `.../target/incident_list.do%3F...`, `/task_list.do?sysparm_query=sys_id=ID`, `/sys_properties.do`, `/sys_properties_list.do`, `/$studio.do`, `/report_home.do`, `/catalog_home.do`, `/xmlstats.do`, `/login.do` | null | classic | null | none | "Open a ticket" help | OK (`_list` is excluded `kinds.js:275-276`) |
| `/incident.do?sysparm_query=active=true` | null | classic | null | none | same | OK |
| `/email_client.do?sysparm_table=incident&sysparm_sys_id=ID` | null | classic | null | none | same | OK |
| `/kb_view.do?sysparm_article=KB0010001`, `/com.glideapp.servicecatalog_cat_item_view.do?sysparm_id=ID` | null | classic | null | none | same | OK (so knowledge/catalog classic views are never recognised: a gap, not a leak) |
| `/now/sow/home`, `/now/sow/list/params/list-id/incident/...`, `/now/workspace/agent/home`, `/now/workspace/agent/list/...`, `/now/cwf/agent/home`, `/now/hr-agent-workspace/home`, `/now/sow/dashboard/params/sys-id/ID`, `/now/flow-designer/flow/ID` | null | workspace | null | none | "Open a ticket" help | OK |
| `/now/sow/record/incident/ID` (control) | `{incident}` | workspace | null | incident / incident | ticket view | correct |
| `/sp`, `/esc`, `/csm` | null | portal | `{base:/sp,pageId:''}` | none | "Open a ticket, request or case on this portal..." | OK |
| `/sp?id=index`, `/esc?id=index`, `/sp?id=search&q=vpn`, `/sp?id=ui_page`, `/esc?id=ui_page` | null | portal | pageId `index`/`search`/`ui_page` | none | portal help text; pageId `ui_page` is held but never drawn | OK |
| `/sp?id=ui_page&sys_id=ID`, `/sp?id=sc_cat_item&sys_id=ID` (no `table=`) | null | portal | pageId only | none | portal help text | OK (table is not guessed on an unknown page id) |
| `/sp?id=ui_page&table=sys_ui_page&sys_id=ID`, `/sp?id=form&table=sys_ui_page&sys_id=ID` | `{sys_ui_page}` | portal | pageId | sys_ui_page / other | top line `sys_ui_page` | BUG (any portal page with `table=`) |
| `/sp?id=ticket&table=incident&sys_id=ID` (control) | `{incident}` | portal | `ticket` | incident / incident | ticket view | correct |
| `/sp?id=kb_article_view&sysparm_article=KB0010001` | `{kb_knowledge, number}` | portal | `kb_article_view` | none unless the number resolves | READ made: `kb_knowledge?number=KB0010001 [sys_id,number]` | correct, but a read happens on every poll (cached 30 s on a miss) |
| `/kb_knowledge.do?sys_id=ID` (control) | `{kb_knowledge}` | classic | null | kb_knowledge / knowledge | article view, top line `kb_knowledge` until the header answers | usually fine (header read succeeds), still falls back to the raw table name |
| number-only: `/ui_page.do?sysparm_query=number=INC0010001` | `{ui_page, number}` | classic | null | none | no panel change | **READ made against `ui_page?number=INC0010001`** (`recordResolver.js:59-71`). Same for `/home.do?sysparm_query=number=...` -> reads table `home`. |
| number-only: `/sp?id=ui_page&number=INC0010001` | table guessed from the number prefix | portal | pageId | none | no panel change | one read on `incident?number=...` (correct table) |

g_form scenarios (VERIFIED with a faked bridge answer, so the g_form content itself is ASSUMED):

| bridge `getFormMeta` answer on a non-form page | resolved | shown |
|---|---|---|
| `{table:'ui_page', sysId:<hex>, isNewRecord:false}` | `ui_page / other` (g_form wins over the address, `recordResolver.js:81-84`) | `ui_page` + "Details are not available to you." |
| `{table:'ui_page', sysId:''}` or `{table:null}` | none | "Open a ticket" help |

Blank forms (`sys_id=-1`, `parseNewRecordRef`, `content/index.js:84-93`) VERIFIED:
`/ui_page.do?sys_id=-1` -> Write screen line "For a new ui page form"; `/home.do?sys_id=-1` -> "For a new home form";
`.../sys_ui_page.do%3Fsys_id%3D-1` -> "For a new sys ui page form".

## 3. Where a raw identifier reaches the person (file:line)

| Where | Code | Shown text | Status |
|---|---|---|---|
| Ticket screen top line | `recordHeader.js:27` `number = record.number \|\| header.number \|\| record.table`; `glance.js:105,125`; `Glance.jsx:139` renders `g.number` | `ui_page` | VERIFIED value (`buildGlance`), render ASSUMED |
| Ticket screen title | `TicketView.jsx:116-118` (any failure of the header read -> `phase:'failed'`); `recordHeader.js:14-17` (`headerPhase` is 'failed' when number, short_description, state and priority are all empty, which is every non-task table); `recordHeader.js:8` text | "Details are not available to you." | VERIFIED text; real read outcome ASSUMED (400 Invalid table, or a 200 row with none of those columns) |
| Write screen line | `ticketLabel.js:22-24`; new form `ticketLabel.js:31-33` (`replace(/_/g,' ')`) | "For ui_page", "For a new ui page form" | VERIFIED |
| Access notes / failed cards | `plainAccess.js:59-65` (`plainSource` -> "Some information"), `plainNote` only replaces names in its WORDS list | "Some information: ui_page is not on this instance." / "Some information: You cannot read ui_page." | VERIFIED (`plain.mjs`) |
| A read that returns 400 | `tableApi.js:135` message kept; `plainAccess.js:84-90` `readFailure` | `Table API query on "ui_page" failed (400): Invalid table ui_page` | VERIFIED |
| AI block note | `plan.js:43` | "Your organisation does not allow Agent Buddy to use ui_page records with AI" (only if the table is blocked) | by code, ASSUMED |
| Command palette (All tools) | `App.jsx:193-196`, `commands.js:129`: ticket commands only when `recordPage.record` | on a record of kind `other` it offers the record's cards/actions; no table name drawn | by code |
| On-page dock | `content/index.js:182` -> `bar.js` -> `background/bar.js:64-73`; `quick.js:152` | on `/ui_page.do?sys_id=` the dock offers "Summarise" and "Summarise discussion" (VERIFIED `barActions('ui_page')`); no table name drawn | BUG: an AI action offered on a non-ticket |
| "Last viewed" / since you last looked | `useNeeds.js:30-40` stores `{table, sysId, at}` for ANY record on screen incl. kind `other` (`lastViewed.js:55-62` only checks the table is an identifier) | nothing is drawn; storage gets entries like `ui_page` | VERIFIED by code; harmless to display, pollutes the 500-entry cap |
| Portal page id | `surface.js:47`, `usePage.js:30-35` | never drawn | no leak |
| Header chip | `recordHeader.js:28-35` builds `tags:[record.table,...]` | NOT drawn: `glance.js` does not use `tags`; only `Glance.jsx:139` shows the number | dead code that would leak the table if a view used it |

## 4. Reads on a non-record page and "access" honesty

* A plain non-record page (home, list, dashboard, portal home): VERIFIED no table read at all from `resolveRecord`. The screens My work / Team /
  Write / Knowledge read with their own fixed tables (My work: one `myWork` op, `useMyWork.js:80`; the page only supplies tab and origin).
* A page that LOOKS like a record (`x.do?sys_id=`, g_form, `table=`): the panel makes, for table `x`:
  1. `header` read (`TicketView.jsx:116` -> `header.js:33`): `GET /api/now/table/x?sysparm_query=sys_id=..&sysparm_fields=number,short_description,state,priority`.
  2. `glance` read (`data.js:15` -> `insights.js:218-229`): `readContextPack` (`pack.js:159` fetchRecord with the "other" ceiling,
     `allowlists.js:104-107`), then `readSlaTimes` (task_sla for that sys_id), `readVip`, `findOpenDuplicates`. Journal (`sys_journal_field`
     with name = `x`) when the feature wants notes.
  3. a `useLastViewed` write (`useNeeds.js`).
  4. the dock's `BAR_ACTIONS`.
  All are GET with the person's own session, so ACLs decide (rule 1, 9 hold). But they are unnecessary requests on a table the extension
  does not know, and the outcome is mis-worded: a 400 "Invalid table" or a row without ticket columns is shown as "not available to you"
  (`TicketView.jsx:118`, `recordHeader.js:14-17`, `plainAccess.js:87` also maps NOT_FOUND to "not available to you"). The person is
  looking at that very form, so "not available to you" is false for them. This is the accurate reading of "produces results without
  evaluating the user's access levels": the panel does not evaluate access, it misreports a mismatched request as an access result.
* Number-only addresses on a classic page read the table named by the page (`recordResolver.js:59-71`, VERIFIED: `home?number=INC0010001`,
  `ui_page?number=INC0010001`). Cached for 30 s on a miss (`MISS_MS`), so this repeats about twice a minute while the tab is open.

## 5. What a fulfiller should see on a non-record page, and what happens today

Should: no table name anywhere; the bottom bar of screens (My work, Team, Write, Knowledge) and the plain help "Open an incident, request,
catalog task or case and Agent Buddy offers help for it here." with "See my work". No dock actions. No reads except the screens' own.

Today: VERIFIED correct for home, lists, dashboards, workspaces' landing and list pages, portal home and portal pages without `table=`
(`planPanel`: `showSetup:true, showNav:true, recordPage:null`; `SetupView.jsx:111-129`). Wrong for every address, g_form or portal link that
carries a sys_id and names a non-ticket table (rows marked BUG above).

## 6. Smallest correct fix (description only)

1. One gate, in one place (`makeRecordResolver.resolveRecord`, `recordResolver.js:78-94`, plus the same check where `kinds.js` returns
   a ref): a page is "a record the panel works on" only if its table is a ticket-like table: `kindForTable(table) !== 'other'`, OR the table is
   in a list the organisation or person configured (like `PORTAL_PAGE_TABLES`), OR the form itself proves it (g_form answered and `getFormMeta`
   returned a non-empty `number`). Everything else resolves to "no record": the Ticket screen shows the plain help, the dock shows
   nothing, no header/glance/lastViewed read is made, and the number-only lookup is made only for tables with a known kind. This removes
   the `ui_page` display, the wrong-table reads and the false "not available to you" at once.
2. Never print a table name as a title: replace the `record.table` fallbacks in `recordHeader.js:27` and `ticketLabel.js:24` with a plain
   word ("Record") or the table's display label; map `sys_*`/unknown names to "some information" also inside notes (`plainAccess.js` `plainNote`).
3. Word failures by cause: only 403/ACL and "record not visible" become "not available to you"; a 400 missing table or a row without ticket
   columns becomes "This page is not a ticket" (or nothing). Do not collapse every header failure into `phase:'failed'`/denied.
4. Optional hardening: `resolveFormWindow` (`bridge.js:60-81`) should prefer the top window and `gsft_main` and ignore other child frames, so a
   widget iframe on a home page cannot make it a "form".

Risk to weigh: custom task tables (`u_*`, `x_*`) that extend `task` are kind `other` today and would need the g_form `number` proof or a list
entry; a form page (g_form present and a `number`) keeps working on classic and Next Experience; a Workspace/portal page of a custom table
would need the configured list.
