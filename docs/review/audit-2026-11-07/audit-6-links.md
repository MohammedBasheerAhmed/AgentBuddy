# Audit 6: link-target consistency (read-only, 2026-11-07)

Scope: every place `D:\AgentBuddy\src` builds or opens a ServiceNow address, or puts one into text. Read `docs/build-rules.md` first.
Evidence labels: **VERIFIED** = I read the code and/or ran it with `node` (scripts and raw output are in the scratchpad: `matrix.mjs` / `matrix-out.txt`,
`matrix2.mjs` / `matrix2-out.txt`, `matrix3.mjs`; nothing was written in the repo). **ASSUMED** = depends on how ServiceNow behaves, which the repo cannot show and the platform
researcher is checking. The repo's own docs already list the same facts as unverified (`docs/live-questions/insights.md` 13/15, `knowledge.md` 26, `portal.md` 1-3).

Short answer to the owner's complaint (VERIFIED): the address of an article is chosen by *which kind of tab the agent happens to be on*, by *which screen* asked, and by
*whether the agent clicked "open" or "Copy link"*. There are THREE builders for an article address (not two), plus a fourth for its "customer" copy. For other record types the same
"tab decides" logic exists (portal page vs classic form vs Workspace route), and a few other links behave differently from their neighbours (see section 3).

---------------------------------------------------------------------------------------------------------------------------------------

## 1. Inventory

Surfaces: classic / workspace / portal / other. "nav_to form" = `/nav_to.do?uri=<table>.do?sys_id=<id>` (the classic FORM, editable if the person has write access: ASSUMED about editability).
"W-route" = `<prefix>/record/<table>/<id>`. "tab" = the tab the panel is attached to (`chrome.tabs.update`); "new tab" = `chrome.tabs.create` next to it.

### 1a. Builders (functions that produce an address)

| ID | file:line | audience | record types | classic / workspace / portal / other result | verdict |
|---|---|---|---|---|---|
| B1 | `src/sidepanel/openRecord.js:51-65` `recordUrl(page,{table,sysId})` | AGENT (opens in panel; also the real `href` for Ctrl+click) | any table incl. `kb_knowledge` (takes NO article number) | classic: nav_to form. workspace on a record page: W-route (prefix from the page, `workspacePrefix` :41). workspace on home/list: nav_to form. `kb_knowledge` on workspace: nav_to FORM (CLASSIC_ONLY :18). portal: `<portal>?id=<ticket \| csm_ticket \| hr_ticket>&table=&sys_id=` (page id copied from the CURRENT portal page, :34-38); article: `?id=kb_article&table=kb_knowledge&sys_id=`. other: nav_to form | INCONSISTENT: the tab picks the view (VERIFIED, section 2 tables A and C). The comment at :17 says "an article has its own reader" but the code opens the form |
| B2 | `src/sidepanel/openRecord.js:68-75` `newRecordUrl` | AGENT | any table (blank form) | always nav_to `sys_id=-1`, on every surface | Leaves Workspace and portal; deliberate (same tab, draft waits) but different rule from B1 (VERIFIED table D) |
| B3 | `src/insights/links.js:12-33` `articleShareUrl` (A) | CUSTOMER (copied to clipboard to paste into a reply) | `kb_knowledge` | number valid (`^KB\d{4,12}$`): classic/workspace/other `/kb_view.do?sysparm_article=KBn`; portal `<portal>?id=kb_article_view&sysparm_article=KBn`. no valid number, sys_id only: ALWAYS `/kb_view.do?sys_kb_id=<id>` (even on a portal). accepts `http:` | Depends on the agent's tab; page id differs from B4 (VERIFIED) |
| B4 | `src/sidepanel/knowledgeScreen/articleInfo.js:42-59` `articleShareUrl` (B), SAME NAME as B3 | CUSTOMER (clipboard) | `kb_knowledge` | number valid (`^[A-Za-z]{2,8}\d{4,12}$`): classic/workspace/other `/kb_view.do?sysparm_article=`; portal `<portal>?id=kb_article&sysparm_article=` (different page id). sys_id only: `/kb_view.do?sys_kb_id=` or on portal `?id=kb_article&sys_id=`. https only. portal base falls back to `/sp` (not the first path segment) | Second, different builder with the same name (VERIFIED) |
| B5 | `src/mywork/links.js:9-20` `fullListUrl` | AGENT | any table (list) | classic list via nav_to on every surface | OK as a rule ("lists are classic"), but a duplicate of B6 |
| B6 | `src/sidepanel/reports/drill.js:10-22` `listUrl` | AGENT / team lead | any table (list) | same address as B5; different guards (`QUERY_RE` vs `MAX_QUERY`), no scheme check | Duplicate of B5 (VERIFIED, table E identical output) |
| B7 | `src/compose/emailRecommend.js:411-421` `emailFormUrl` | AGENT | any ticket | `/email_client.do?...` on every surface, https only | Leaves Workspace (VERIFIED table F); documented question 16 |

### 1b. Openers (what is clicked and where it opens)

| ID | file:line | audience | record types | opens in | verdict |
|---|---|---|---|---|---|
| O1 | `src/sidepanel/RecordLink.jsx:14-37` | AGENT | whatever the caller gives | `<a href target=_blank>`; plain click: tab (`openUrl`) unless `newTab` (default FALSE) | Default is "replace the tab"; each caller must remember `newTab` |
| O2 | `src/sidepanel/openRecord.js:85-114` `openUrl` / `openInNewTab` | AGENT | n/a | tab / new tab right after the ticket's tab. `openRecordTab` (:117) is exported and never used | OK; dead export |
| O3 | `src/sidepanel/ticket/cards/bits.jsx:88-99` `ItemLink` (`newTab`) used by `KnowledgeCard.jsx:29`, `StepsCard.jsx:85,87,131`, `AccountCard.jsx:85`, `ChangesCard.jsx:29`, `CallerCard.jsx:43`, `KnownErrorsCard.jsx:51`, `RelatedCard.jsx:42,53`, `OutageCard.jsx:32`, `RoutingCard.jsx:36` | AGENT | article, incident, case, change, problem, solved tickets (table from the row) | new tab | Good: Ticket screen never replaces the ticket. View still depends on the tab (B1) |
| O4 | `PrepareClose.jsx:52`, `ResolveCard.jsx:101` (`RecordLink newTab`) | AGENT | the ticket's own table | new tab | OK |
| O5 | `src/sidepanel/knowledgeScreen/SearchCard.jsx:32` (also used by "Articles for INC..." `TicketArticles` :164-230) | AGENT | `kb_knowledge` (sysId only, no number passed) | SAME TAB | Replaces the ticket being worked on when a ticket is open (VERIFIED by reading; no `newTab`). Same article opens in a new tab from the Ticket screen |
| O6 | `src/sidepanel/knowledge/DuplicatesPanel.jsx:296` | AGENT (knowledge manager) | `kb_knowledge` | SAME TAB | Same as O5 |
| O7 | `src/sidepanel/knowledge/GapsPanel.jsx:201` | AGENT (knowledge manager) | `e.table` tickets | SAME TAB | Same as O5 |
| O8 | `src/sidepanel/mywork/MyWorkView.jsx:49` + `parts.jsx:56`; `cards.jsx:49-54` `FullList` | AGENT | ticket rows / lists | SAME TAB (intended; panel then jumps to Ticket screen) | Intentional, tooltip says "in this tab" |
| O9 | `src/sidepanel/reports/drill.js:25-38`, `ReportsDashboard.jsx:219-222`, `TicketList.jsx:28-44`, `DataTable.jsx:53`, `DrillLink.jsx:17` | AGENT / lead | lists, tickets | SAME TAB (focus the source tab on the full-page dashboard) | Intentional. NOTE the full-page dashboard's `page` has NO `portal` object (`src/dashboard/sourceTab.js:43`) |
| O10 | `src/sidepanel/compose/NotesPanel.jsx:317`, `ResultView.jsx:274`, `AnswerCard.jsx:394` (`openNewRecord`) | AGENT | blank incident/case/article form | SAME TAB (draft kept) | Intentional; classic blank form on every surface (B2) |
| O11 | `EmailCard.jsx:51,98`, `AnswerCard.jsx:83,176` | AGENT | any ticket | NEW TAB (email client) | OK |

### 1c. Copy-to-text (an address that ends up in text a CUSTOMER may read)

| ID | file:line | audience | record types | result | verdict |
|---|---|---|---|---|---|
| C1 | `src/sidepanel/ticket/cards/KnowledgeCard.jsx:26-30` ("Copy link" next to the article row) | CUSTOMER | article | B3 | The same row also has an "open" link built by B1 (form) |
| C2 | `src/sidepanel/knowledgeScreen/SearchCard.jsx:43,91` ("Copy link") | CUSTOMER | article | B4 | Different from C1 on portals |
| C3 | AI output: `src/pii/firewall.js:72` "Plain text only: no links, images, HTML or other markup"; `src/features/packs/knowledge.js:90,113,136` "never invent links"; `src/features/packs/{assist.js:125,compose.js:168}` keep links as written | CUSTOMER | none | the AI is told NOT to write links, so no URL comes from the model (VERIFIED by grep of `src/prompts`, `src/features`, `src/pii`) | Good. The only URL a customer can receive from Agent Buddy is C1/C2 |
| C4 | email templates `src/insights/emailTemplates.js`, `src/snippets/**` | CUSTOMER | none | no URL placeholders (VERIFIED by grep for link/url/portal/href) | Nothing to align |
| C5 | `src/safeSend/review.js:90-110` `linkFindings` | CUSTOMER | any link already in a draft | not a builder: names the host of any link in a reply as a low hint | Fine; a pasted Agent Buddy link will trigger the hint (names the instance host) |

### 1d. Not ServiceNow addresses / inverse direction (listed so nothing is missed)

| ID | file:line | note |
|---|---|---|
| P1 | `src/context/kinds.js:163-169, 210-240`, `src/context/surface.js:12-58` | PARSERS. They accept both article portal pages (`kb_article`, `kb_article_view`) and list the sc_* page ids. Same assumption as B1/B3/B4 (docs/live-questions/portal.md 1-3, unverified) |
| P2 | `src/sidepanel/AiKeyNote.jsx:13`, `src/sidepanel/App.jsx:200`, `src/sidepanel/reports/ReportsDashboard.jsx:333` | extension's own pages (options.html, dashboard.html). Not SN |
| P3 | `src/content/**`, `src/page/bridge.js`, `src/background/**` | no address is built there (VERIFIED: grep of `href`, `location`, `nav_to`, `?id=`) |

---------------------------------------------------------------------------------------------------------------------------------------

## 2. Matrix (all VERIFIED by running the real functions; host `https://x.service-now.com` removed; ID = `0123456789abcdef0123456789abcdef`)

Page objects used: classic `{href:'/incident.do?sys_id=..',surface:'classic'}`; workspace record `{href:'/now/sow/record/incident/<id>',surface:'workspace'}` (and `/now/cwf/agent/record/sn_customerservice_case/<id>`);
workspace home `{href:'/now/nav/ui/home',surface:'workspace'}`; portal `{href:'/esc?id=ticket',surface:'portal',portal:{base:'/esc',pageId:'ticket'}}` (and `/sp`, `/csm csm_ticket`, `/hrsp hr_ticket`); other `{href:'/some/where',surface:'other'}`.

### A. B1 `recordUrl`: the AGENT opening a record

For all six ticket tables (incident, sc_req_item, sc_task, sn_hr_core_case, sn_customerservice_case, change_request) the output is identical apart from the table name `T`:

| agent is on | address (`T` = table) |
|---|---|
| classic | `/nav_to.do?uri=T.do%3Fsys_id%3D<id>` |
| workspace, record page (SOW) | `/now/sow/record/T/<id>` |
| workspace, record page (CSM `cwf/agent`) | `/now/cwf/agent/record/T/<id>` (also for `incident`, `sc_task`, `sn_hr_core_case`...: whatever table, the prefix is simply copied) |
| workspace, home `/now/nav/ui/home` or a list | `/nav_to.do?uri=T.do%3Fsys_id%3D<id>` (leaves the Workspace) |
| portal `/esc` or `/sp` (page `ticket`) | `/esc?id=ticket&table=T&sys_id=<id>` |
| portal `/csm` (page `csm_ticket`) | `/csm?id=csm_ticket&table=T&sys_id=<id>`, e.g. `/csm?id=csm_ticket&table=incident&sys_id=<id>` and `...table=change_request` |
| portal `/hrsp` (page `hr_ticket`) | `/hrsp?id=hr_ticket&table=change_request&sys_id=<id>` |
| portal home `/esc?id=index` | `/esc?id=ticket&table=T&sys_id=<id>` |
| other | `/nav_to.do?uri=T.do%3Fsys_id%3D<id>` |

`kb_knowledge` (recordUrl takes a sys_id; there is no by-number path):

| agent is on | address |
|---|---|
| classic | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` (FORM) |
| workspace (record page, home or list, SOW or CSM) | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` (FORM, leaves Workspace) |
| portal `/esc`, `/sp`, `/csm`, `/hrsp` | `<portal>?id=kb_article&table=kb_knowledge&sys_id=<id>` (portal PAGE) |
| other | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` (FORM) |

Extra raw lines (matrix2-out.txt): HR workspace prefix, open article `/nav_to.do?uri=kb_knowledge.do%3Fsys_id%3DABCDEF0123456789abcdef0123456789` and `HR workspace prefix, open change: /now/hr/agent/record/change_request/...`; the nav_to branch keeps the sys_id's CASE, every other branch lowercases it.

### B/C. The article, by who asks (the number case; `KB0010001`)

| agent is on | "open" link (B1, form or portal page) | Ticket-screen "Copy link" (B3) | Knowledge-screen "Copy link" (B4) |
|---|---|---|---|
| classic | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` | `/kb_view.do?sysparm_article=KB0010001` | `/kb_view.do?sysparm_article=KB0010001` |
| workspace (any) | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` | `/kb_view.do?sysparm_article=KB0010001` | `/kb_view.do?sysparm_article=KB0010001` |
| portal `/esc` | `/esc?id=kb_article&table=kb_knowledge&sys_id=<id>` | `/esc?id=kb_article_view&sysparm_article=KB0010001` | `/esc?id=kb_article&sysparm_article=KB0010001` |
| portal `/sp` | `/sp?id=kb_article&table=kb_knowledge&sys_id=<id>` | `/sp?id=kb_article_view&sysparm_article=KB0010001` | `/sp?id=kb_article&sysparm_article=KB0010001` |
| portal `/csm` | `/csm?id=kb_article&table=kb_knowledge&sys_id=<id>` | `/csm?id=kb_article_view&sysparm_article=KB0010001` | `/csm?id=kb_article&sysparm_article=KB0010001` |
| portal `/hrsp` | `/hrsp?id=kb_article&table=kb_knowledge&sys_id=<id>` | `/hrsp?id=kb_article_view&sysparm_article=KB0010001` | `/hrsp?id=kb_article&sysparm_article=KB0010001` |
| other | `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>` | `/kb_view.do?sysparm_article=KB0010001` | `/kb_view.do?sysparm_article=KB0010001` |

The sys_id-only case (no usable number), same functions:

| agent is on | B3 (Ticket screen) | B4 (Knowledge screen) |
|---|---|---|
| classic / workspace / other | `/kb_view.do?sys_kb_id=<id>` | `/kb_view.do?sys_kb_id=<id>` |
| portal (any) | `/kb_view.do?sys_kb_id=<id>` (leaves the portal) | `/esc?id=kb_article&sys_id=<id>` (stays on the portal) |

Other edge results:
- A custom number prefix, `ARTICLE0001234`, both numbers AND sys_id given (as the callers do): B3 gives `/kb_view.do?sys_kb_id=<id>`, B4 gives `/kb_view.do?sysparm_article=ARTICLE0001234` (number regexes differ: `KB\d{4,12}` vs `[A-Za-z]{2,8}\d{4,12}`). `KBA0010001` and `ARTICLE0001234` are rejected by B3 and accepted by B4 (matrix-out.txt section G).
- `http://` instance: B3 builds `http://x.../kb_view.do?...`, B4 returns '' (so the "Copy link" button is disabled on the Knowledge screen but works on the Ticket screen).
- Portal page without a `portal` object (the full-page dashboard builds its page that way; also when `cleanPortal` rejects the content script's answer): `/esc?id=index` gives B1 `/esc?id=kb_article&...`, B3 `/esc?id=kb_article_view&...`, **B4 `/sp?id=kb_article&sysparm_article=KB0010001`** (silently another portal). For a portal at `/myportal` B4 also falls to `/sp`.
- Full-page dashboard on a `/csm` ticket page: opening a ticket gives `/csm?id=ticket&table=incident&...` there but `/csm?id=csm_ticket&table=incident&...` in the side panel (matrix2-out.txt): the two surfaces of the same product build different portal pages for the same ticket.

### D. B2 `newRecordUrl`, E. B5/B6 lists, F. B7 email form

Same address on ALL 13 test pages (classic, workspace record/home/list, every portal, other): `/nav_to.do?uri=incident.do?sys_id=-1`, `/nav_to.do?uri=incident_list.do?sysparm_query=<twice-encoded>`, `/email_client.do?sysparm_table=incident&sysparm_sys_id=<id>&sysparm_target=incident&sysparm_uniqueValue=<id>`. B5 and B6 return identical strings.

### G. "A link for a CUSTOMER by where the AGENT is" (matrix2-out.txt, verbatim)

```
customer link, agent on classic      Ticket screen: /kb_view.do?sysparm_article=KB0010001   Knowledge screen: /kb_view.do?sysparm_article=KB0010001
customer link, agent on workspace    Ticket screen: /kb_view.do?sysparm_article=KB0010001   Knowledge screen: /kb_view.do?sysparm_article=KB0010001
customer link, agent on portal /esc  Ticket screen: /esc?id=kb_article_view&sysparm_article=KB0010001   Knowledge screen: /esc?id=kb_article&sysparm_article=KB0010001
customer link, agent on portal /sp   Ticket screen: /sp?id=kb_article_view&sysparm_article=KB0010001   Knowledge screen: /sp?id=kb_article&sysparm_article=KB0010001
customer link, agent on portal /csm  Ticket screen: /csm?id=kb_article_view&sysparm_article=KB0010001   Knowledge screen: /csm?id=kb_article&sysparm_article=KB0010001
```

---------------------------------------------------------------------------------------------------------------------------------------

## 3. Inconsistencies

| # | What | Evidence | Status |
|---|---|---|---|
| I1 | **Same article, three different views depending only on the tab** (classic FORM `kb_knowledge.do`, portal page `?id=kb_article&table=..&sys_id=..`, and, in a Workspace, the classic form again which leaves the Workspace). THIS is the owner's complaint. | tables A/C (B1) | VERIFIED |
| I2 | **"Open" and "Copy link" on the same row disagree.** On classic/Workspace the row opens the editable form but "Copy link" yields the reader `kb_view.do`; on a portal the row opens `id=kb_article&table=..&sys_id=` and the copy is `id=kb_article_view&sysparm_article=`. | `KnowledgeCard.jsx:29-30`, table C | VERIFIED |
| I3 | **Two functions named `articleShareUrl` with different behaviour**: portal page id `kb_article_view` vs `kb_article`; number pattern; sys_id-only on a portal; scheme; `/sp` fallback. Each has its own test pinning its own behaviour (`tests/insights-rules.test.js:373-378`, `tests/knowledge-search-ops.test.js:122-124`). A third builder (B1) exists for the "open" side. | table B/C/G | VERIFIED |
| I4 | **A link for a CUSTOMER depends on the UI the AGENT is in.** An agent who happens to have `/sp`, `/esc` or `/csm` open gives the customer a link on THAT portal (maybe the wrong portal, or the customer-service portal when the employee uses Employee Center); an agent on classic or in a Workspace gives `kb_view.do`. A customer-facing address must not depend on the agent's tab. | table G | VERIFIED (behaviour); ASSUMED (that the portal differs from what the customer uses) |
| I5 | **A link that opens an edit FORM where a reader is meant.** For an article on classic, Workspace and "other", "open" is `kb_knowledge.do` (the authoring form). `openRecord.js:17` even says "an article has its own reader" yet routes to the form. The form is right for the Duplicates/merge screen (a knowledge manager), not for Search hits, Steps or the Ticket screen's Knowledge card. | `openRecord.js:17-18,64` | VERIFIED (what the code does); ASSUMED (that the form is editable for that person) |
| I6 | **Links that leave the Workspace**: articles (always), tickets when the current Workspace page is not a record page (home/list, e.g. `/now/nav/ui/home`), blank forms (`newRecordUrl`), the email form, lists. Only "a record opened from a record page" stays in. | tables A, D, E, F | VERIFIED |
| I7 | **Same tab vs new tab is inconsistent**: the Ticket screen cards open a NEW tab (never replaces the ticket) but the Knowledge screen's article hits, "Articles for INC...", Duplicates, Gaps and the "Open ..." rows use `RecordLink` without `newTab`, so a click REPLACES the ticket tab (and any unsaved typing). The same article opens in a new tab from the Ticket screen and in the same tab from the Knowledge screen. `RecordLink` defaults to "replace". | `RecordLink.jsx:14`, `SearchCard.jsx:32`, `DuplicatesPanel.jsx:296`, `GapsPanel.jsx:201` | VERIFIED (by reading) |
| I8 | **The portal ticket page is chosen by the current page, not by the record.** Opening an incident from the customer-service portal gives `/csm?id=csm_ticket&table=incident&...`; a change from the HR portal gives `/hrsp?id=hr_ticket&table=change_request&...`. Whether those pages render a different family's ticket is unknown. The full-page dashboard (no `portal` object) says `id=ticket` where the panel says `id=csm_ticket`. | matrix2-out.txt, `sourceTab.js:43` | VERIFIED (strings); ASSUMED (rendering) |
| I9 | **The Workspace route is assumed valid for every table in every Workspace** (e.g. `sn_hr_core_case` from the SOW prefix, `incident` from `/now/cwf/agent`). Only `kb_knowledge` is exempt (CLASSIC_ONLY). | table A; `docs/live-questions/insights.md` 13 | VERIFIED (strings); ASSUMED (does the route open) |
| I10 | **Portal page ids and `sys_kb_id` are unproven**: `kb_article`, `kb_article_view`, `ticket`, `csm_ticket`, `hr_ticket`, `kb_view.do?sys_kb_id=<article sys_id>` (the repo's own `portal.md` Q3 says it does not know whether `sys_kb_id` is the article or the base), `kb_view.do?sysparm_article=` redirecting portal-only users to their portal (`links.js:3-4` comment; `knowledge.md` 26). From general ServiceNow knowledge I believe `kb_article` and `kb_article_view` both exist on Service Portal and `kb_article` is used by Employee Center, but that is NOT proven here. | | ASSUMED |
| I11 | **Number patterns differ** (see I3), so on an instance with a custom article prefix the Ticket-screen link is `sys_kb_id=<id>` (changes with a new version, per the code's own comment in `articleInfo.js:35-36`) and the Knowledge-screen link is by number. | matrix3 | VERIFIED |
| I12 | **Portal base fallback differs**: B1/B3 use the first path segment, B4 uses `/sp`. With no `portal` object (full-page dashboard, `cleanPortal` returning null) B4 moves the customer to `/sp`. | table G / matrix-out section G | VERIFIED |
| I13 | **Duplicate list builders** (`mywork/links.js` vs `reports/drill.js`) with different validation; `openRecordTab` is dead; `recordUrl` keeps the sys_id's case in the nav_to branch and lowercases elsewhere. | matrix2-out.txt | VERIFIED (minor) |
| I14 | The "Articles for the open ticket" panel and the Ticket screen's Knowledge card show the SAME search results (same ranking) but open them differently (I7) and copy them differently (I2/I3). | `SearchCard.jsx`, `KnowledgeCard.jsx` | VERIFIED |

Things that are consistent (VERIFIED): all builders use the page's own origin only; `openUrl` and `openInNewTab` refuse any other origin; the AI never writes a link; no email template or snippet carries a URL placeholder; lists are always the classic list.

---------------------------------------------------------------------------------------------------------------------------------------

## 4. Proposed single rule set

Principle: **the address is decided by (audience, kind of thing, intent), never by which screen asked, and, for anything a customer may read, never by the agent's tab.** Where the agent's tab matters at all (staying in the Workspace or portal the agent works in), that rule lives in one function.

Address kinds: **Form** (nav_to form), **WRoute** (`<prefix>/record/<t>/<id>`), **PortalTicket** (`<portal>?id=<page>&table=&sys_id=`), **Reader** (`/kb_view.do?sysparm_article=KBn`, fallback `?sys_kb_id=<id>`), **PortalReader** (`<portal>?id=<article page>&sysparm_article=KBn`), **List** (classic list), **Email** (`email_client.do`).

| Audience / intent | Record type | classic | workspace | portal | other / non-record |
|---|---|---|---|---|---|
| AGENT, open a ticket to look or work | incident, sc_req_item, sc_task, case, change, problem... | Form | WRoute when the page is a Workspace record page AND the table is not in a short "classic only" set (today: none for tickets); else Form | PortalTicket, page chosen from the record's table family, not copied from the current page (D1) | Form |
| AGENT, read an article | kb_knowledge | Reader | Reader | Reader (or PortalReader: D2) | Reader |
| AGENT, author / compare / merge an article (Duplicates screen, new article) | kb_knowledge | Form | Form | Form | Form |
| CUSTOMER, link pasted into a reply/email/work note | kb_knowledge | Reader | Reader | Reader | Reader (identical on every surface; D3) |
| CUSTOMER, link to a ticket | any | not built today; do not add (D8) | n/a | n/a | n/a |
| AGENT, list / report drill | any | List | List | List | List |
| AGENT, blank form | any | Form (same tab, draft waits) | Form | Form | Form |
| AGENT, email | any ticket | Email (new tab) | Email (new tab) | Email (new tab) | Email (new tab) |
| Tab behaviour | | New tab for "look at this" links (cards, search hits, duplicates, gaps, "Open X"); SAME tab only for "go work on this" (My work rows, report drills, lists, blank form) | | | |

(In the CUSTOMER article row the four cells are one address.) Open and Copy link therefore yield the SAME string for an article, which removes I1, I2, I3, I4, I5 and I11 together.

### The smallest code change (described, not written)

One new pure module, for example `src/lib/snLinks.js` (no `chrome`, no React), the only place that knows the address shapes:

- `linkFor(page, ref, opts)` with `ref = { table, sysId?, number? }` and `opts = { audience: 'agent' | 'customer', intent: 'work' | 'read' | 'author' }`. Defaults: tickets are `work`; `kb_knowledge` is `read`; `customer` always implies `read` and ignores the tab.
- Inside it: one `originOf(page)` (https only), one `portalOf(page)` (base from `page.portal`, else first path segment, one fallback), one `workspacePrefix(page)` (move from `openRecord.js`), one `ticketPageFor(table, page)`, one `articleReader({number, sysId})` with ONE number pattern (the wider `[A-Za-z]{2,8}\d{4,12}`), one `list(page, table, query)` (merge `mywork/links.js` and `reports/drill.js`), one `emailForm(page, ref)` (move `emailFormUrl`), one `newForm(page, table)`.
- Callers change by one line each: `openRecord.recordUrl` and `newRecordUrl` become thin wrappers over `linkFor`; `RecordLink` computes its intent from the table (article = read) and passes the article NUMBER through (`ItemLink` already has `item.number`; `SearchCard` and `DuplicatesPanel` have `hit.number` / `a.number` and currently pass only `sysId`); `KnowledgeCard` and `SearchCard` "Copy link" call `linkFor(page, ref, {audience:'customer'})`; delete both `articleShareUrl` functions (leave no function with that name); `DuplicatesPanel` passes `intent: 'author'`.
- Make `RecordLink` open in a NEW tab by default and give the real "worklist" cases an explicit `sameTab` (My work rows already pass `onOpen`; `FullList` and the report drills use their own openers). This removes I7 without touching each Knowledge-screen caller.
- Tests: change `tests/insights-rules.test.js:373-378`, `tests/knowledge-search-ops.test.js:122-124`, `tests/portal-openrecord.test.js:20,45` to the new strings, and add one table-driven test (page x ref x audience) that asserts Open and Copy-link produce the same article address on every surface and that no customer address changes with `page`. Add the matrix script in this audit as the basis. `docs/live-questions/insights.md` 13/15 and `knowledge.md` 26 become one question.
- No manifest, permission, setting or button change. A policy key for the customers' portal is the only optional addition (D3).

---------------------------------------------------------------------------------------------------------------------------------------

## 5. Decisions that are the OWNER's

| # | Decision | Options | Recommendation (reason) |
|---|---|---|---|
| D1 | An agent on a PORTAL tab opens a ticket: stay on the portal's ticket page, or always the agent's work UI? | (a) keep staying on the portal; (b) always Form/WRoute | (a) for now: some fulfillers are portal-only and cannot open `nav_to` forms. But choose the page id from the table's family, not from the page the agent is on (I8) |
| D2 | What does "read an article" mean for an AGENT: the native reader (`kb_view.do`), the portal reader, or the editable form (today on classic/Workspace)? | native reader / portal reader / form | Native reader on every surface: needs no portal guess, works on an instance with no portal, is identical to what the customer gets. Form only on the Duplicates screen |
| D3 | The CUSTOMER article link: instance-level `kb_view.do?sysparm_article=` for everybody, or the customers' portal page? | instance-level / portal page / per-instance choice | Instance-level by default (the code already assumes `kb_view.do` sends portal-only people to the portal: ASSUMED, platform researcher). If it does not, the owner needs ONE per-instance value (the customers' portal suffix and article page id) as an enterprise-policy key, not a button |
| D4 | Instance with no portal | n/a | `kb_view.do` is a platform page, so the instance-level rule works with no portal; portal addresses are only built when the agent is on a portal. Confirm no tenant has the classic UI blocked for customers |
| D5 | Agents in a Workspace: may an article, blank form, email form or list take them out of the Workspace (in a new tab), or should the product look for Workspace equivalents? | accept / build equivalents | Accept (new tab); Workspace equivalents are unverified (`insights.md` 13, 16) |
| D6 | New tab vs same tab | one rule: new tab for "look at"; same tab for "go work on this" | Confirm the rule in section 4 |
| D7 | Knowledge managers on the Duplicates screen: reader or form? | reader / form | Form (they merge and edit); everything else reader |
| D8 | Should Agent Buddy ever give the customer a link to THEIR ticket? | no / yes | No (nothing builds one today; it would need the customers' portal, D3) |

---------------------------------------------------------------------------------------------------------------------------------------

## 6. What I did not verify

Real ServiceNow behaviour: whether `kb_view.do` redirects portal-only users, whether `sys_kb_id` is the article's sys_id, whether `kb_article` / `kb_article_view` / `ticket` / `csm_ticket` / `hr_ticket` exist on a given portal and render a different table's record, whether a Workspace route opens every table, whether `kb_knowledge.do` is editable for a given person. All marked ASSUMED above; none can be proven from the repo.
