# Audit 9: surface parity (classic, Next Experience, Workspaces, portals, non-record pages, Firefox/Edge)

Auditor 9 of 9. Date 2026-11-07. READ-ONLY: nothing in D:\AgentBuddy was changed, no build, no unit suite, no e2e, no browser touched.
Method: read docs/build-rules.md, security.md, live-questions (portal, reads, fix, understand, close, compose, quickbar, edge, firefox, knowledge,
insights), src/context/{surface,kinds}.js, src/content/*, src/page/bridge.js, src/lib/fillable.js, src/sidepanel/{insertFlow,openRecord,usePage,
pageState,sections,App,RecordLink}.js(x), src/background/*, e2e/fakeInstance.js and e2e/site/*. Two read-only `node` probes were run against the
project's own pure modules: `scratchpad/s9-urls.mjs` (surface, record ref, recordUrl, both share-link functions over ~75 address shapes) and
`scratchpad/s9-email.mjs` (email-client address detection). Quoted outputs below are from those runs.

Legend
- Cell status: W = works, D = degrades (how, and what the person is told), S = silently fails or says something false, U = untested/unknown.
- V = VERIFIED (read the code, or ran it); A = ASSUMED (a ServiceNow behaviour nobody has confirmed on a real instance).
- e2e = does the fake instance (e2e/fakeInstance.js + e2e/site) exercise it: Y, N, or part. "Fake" always means the fake, never ServiceNow.
- Severity: High = a common agent screen where a feature fails silently or lies. Medium = visible failure/degrade on a common screen, or silent on a
  rarer one. Low = rare or cosmetic. Overlaps with sibling audits are cross-referenced (audit-1 screens, audit-2 non-record pages, audit-5 platform,
  audit-6 links), not repeated.

Surfaces: A classic UI (/incident.do, /nav_to.do?uri=...); B Next Experience shell with classic form in an iframe
(/now/nav/ui/classic/params/target/...); C Workspaces (/now/sow, /now/workspace/agent, /now/cwf/agent, HR, scoped); D portals (/sp /esc /csm /hrsp /ec,
custom suffix); E non-record pages; F Firefox and Edge.

---------------------------------------------------------------------------------------------------------------------------------
## 0. What runs where (the facts every cell rests on)

- Both scripts are registered for `https://<instance>/*` only, top frame only: `allFrames: false` for the MAIN-world bridge and the isolated content
  script (src/background/service-worker.js:71,73). Nothing runs inside any iframe; the bridge reaches same-origin frames from the top window.
  A portal on another host is another origin and needs its own "Turn on" (service-worker.js:63-67). V.
- Record detection, in this order (src/content/recordResolver.js:78-94): (1) `getFormMeta` from the bridge: `g_form` of the top window, else the
  frame named `gsft_main`, else the FIRST of up to 20 child frames whose `g_form.getValue` exists (src/page/bridge.js:60-81, 741-766); (2) the
  address of the top window, read afresh each request (src/content/index.js:124), parsed by src/context/kinds.js:242-281. The g_form wins over the
  address. V.
- Surface label, from the address only (src/context/surface.js:24-28, 53-58): any `*.do` or `/now/nav/ui/classic/` = 'classic'; any other `/now/...`
  or any `/record/<table>/<32 hex>` = 'workspace'; a short first segment with `id=` (or a known suffix) = 'portal'; else 'other'. The label drives
  the Insert wording ("Then press Save / Post / Send"), the Save counter, and where "open another record" goes. V (ran).
- Insert: with a form window = `g_form.setValue` (bridge.js:801-853). Without = DOM search of the top document, every OPEN shadow root and every
  same-origin iframe (bridge.js:276-311), by exact English label (Workspace, 616-669) or by the portal word lists (portal, 250-263, 428-451). V.
- The panel follows the page by asking PAGE_STATE every 2.5 s plus tabs.onActivated/onUpdated (src/sidepanel/usePage.js:6,88-104); the dock asks
  every 2 s (src/content/barLogic.js:5; bar.js:463-488). V.
- Nothing in src/ checks whether the form is dirty: no `modified`, `isUserModified`, `beforeunload` anywhere (grep). V.

---------------------------------------------------------------------------------------------------------------------------------
## 1. The matrix (feature x surface)

Cell format: STATUS (V/A) | e2e | note [file:line]. "gf" = g_form. Paths are under D:\AgentBuddy\src unless stated.

### 1.1 Detect the open record (number, table, sys_id)

| Surface | Result |
|---|---|
| A classic | W (V) \| e2e Y (fake gf) \| gf first: table, sys_id, number (page/bridge.js:741-766; content/recordResolver.js:80-84); URL fallback `/x.do?sys_id=` or `sysparm_query=number=` (context/kinds.js:273-277). `nav_to.do?uri=` unwrapped (kinds.js:254-257). Real g_form untested; the fake defines its own. |
| B Next Experience | W/D (V for URL, A for frame) \| e2e N \| URL `/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D..` parses (kinds.js:260-261; ran: table+sys_id; also `kb_view.do` and `_list.do` targets give null). The form is read through `window.frames['gsft_main']` (bridge.js:63); the author saw named-frame access work on dev364920 although `getElementById('gsft_main')` does not (content/sessionToken.js:12-14), so this is observed once, not under test. The fake serves only `/nav_to.do` with a LIGHT-DOM `<iframe id=gsft_main>` (e2e/fakeInstance.js `p === '/nav_to.do'`), never `/now/nav/ui/classic/...` and never a shadow-DOM frame. |
| C Workspaces | D (V) \| part \| address only: needs `/record/<table>/<sys_id>` (kinds.js:264). Table+sys_id found; NUMBER is '' until the header read (audit-1 T1: the number slot shows the table name while loading/refused). Any Workspace page without that route shape (list with a preview pane, inbox, home) = "no record" and the generic "Open an incident, request, catalog task or case" help, with no reason (sidepanel/SetupView.jsx:111-129). Fake serves only `/now/<ONE segment>/record/` (fakeInstance.js workspace regex `/now/[a-z-]+/record/`), so `/now/cwf/agent/..` and `/now/workspace/agent/..` are unit-tested only (tests/context-kinds.test.js:85-95). |
| D portals | W (V) \| e2e Y for /sp /esc /csm, N for /hrsp, custom suffix \| portalRef (kinds.js:210-240); table inferred only for 5 page ids (kinds.js:163-169); list pages never a record (173-176). |
| E non-record | W (V, ran) \| e2e part (/home, one list) \| lists/home/dashboards/PA = null. GAP: classic `kb_view.do?sysparm_article=KB..` and `kb_view.do?sys_kb_id=..` = null while the same article on a portal (`?id=kb_article_view&sysparm_article=`) IS a record (ran). A hidden or widget iframe with a g_form can still create a bogus record (bridge.js:68-76; audit-2 section 1/6.4). |
| F Firefox / Edge | Edge = Chrome code path (U: never run automated, edge.md "Answers so far" only checked a classic form by hand). Firefox: e2e only `/incident.do` (e2e/firefox/run.js:152,164); named access to a SHADOW-DOM iframe in Firefox is A (firefox.md does not ask it). |

### 1.2 Header and Insights cards

| Surface | Result |
|---|---|
| A, B | W (V) \| e2e Y (fake) \| REST GET by table+sys_id through content/tableApi.js; surface independent. Unsaved-value cards ("Ready to resolve?") read gf fields: close_notes, close_code, resolution_code, state, hold_reason, comments, work_notes (content/ops/checks.js:19,64-84). |
| C | D (V) \| part \| header and cards work once table+sys_id are known; "Ready to resolve?" reads ONLY the three notes boxes by label (checks.js:26,32,89-108), never the code/state; panel says so ("Text you have typed and not saved on this page was not checked", checks/resolutionCheck.js:325). Honest. |
| D | D (V) \| e2e Y \| same, no typed text at all (getBoxValues refuses on portals, bridge.js:966); panel says it checked the saved ticket only (t-portal-sections). |
| E | n/a (no record). F | same code; Firefox untested beyond classic. |

### 1.3 Knowledge search; sharing a link; opening an article

| Surface | Result |
|---|---|
| A, B | search W (V, REST). Copy link: `/kb_view.do?sysparm_article=KBn` from BOTH implementations (insights/links.js:29; sidepanel/knowledgeScreen/articleInfo.js:57). Open article: `nav_to.do?uri=kb_knowledge.do?sys_id=` = the authoring FORM (openRecord.js:18,64); Knowledge screen opens it in the SAME tab (SearchCard.jsx:32 has no `newTab`; RecordLink.jsx:157-163), the Ticket card in a new tab (bits.jsx:88-90). e2e Y for copy link only (e2e/scenarios/r-knowledge-chat.js:197). |
| C | S (V) \| N \| Open = classic form even in a Workspace (CLASSIC_ONLY, openRecord.js:18,62), same tab from the Knowledge screen: the agent's Workspace tab is replaced. Copy link = classic `kb_view.do` (ran). |
| D | D (V, ran) \| part \| Open = `<portal>?id=kb_article&table=kb_knowledge&sys_id=` (openRecord.js:59). Copy link from the Ticket card = `?id=kb_article_view&sysparm_article=` (links.js:26); from the Knowledge screen = `?id=kb_article&sysparm_article=` (articleInfo.js:54). Two different pages for the same article. |
| E | same as A for the classic reader: no record is detected there (see 1.1). |
| F | same code. |

### 1.4 Read the journal / AI actions / Copy

| Feature | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| Journal (REST `sys_journal_field`, fallback record fields) | W V Y | W V N | W V part | W V Y | n/a | W (A in Firefox) |
| AI action (pack read, preview, send) | W V Y | W V N | W V part | W V Y | n/a | W (Firefox Y classic only) |
| Rewrite / "Check my comment" read what is typed | W (gf, content/ops/compose.js:47-66) V Y | W if frame reachable A N | D "paste the text instead" V part (compose.js:46-50 returns available:false; no box path, unlike Ready-to-resolve) | D same V Y (t-portal) | n/a | same |
| Copy (panel clipboard) | W | W | W | W | W | Firefox clipboard from sidebar: not in firefox.md (U) |

### 1.5 Insert (reply / work note / resolution notes), Prepare to close, Undo

| Surface | Insert | Prepare to close (code + notes) | Undo |
|---|---|---|---|
| A classic | W (V) e2e Y (fake gf, `getEditableFields` etc. faked; real g_form semantics A). Append never replaces typed text (bridge.js:200-218); resolution/close/fix/cause notes REPLACE by default (features/packs/core.js:94-97, close.js:67-70) with "Replaces what is in X" said first (fillable.js:123-128). | W (V): code by stored value via gf, `getOption` check, read-back (bridge.js:838-848). | W (V): `restoreField` only while the box still holds exactly what the insert left (bridge.js:868-901); dropped when `formStamp` changes (loadedAt of the form window, index.js:119; fillable.js:371-375). |
| B Next Experience | W if `gsft_main` is reachable (A); if not, bridge falls to the DOM search through the iframe's contentDocument with `.field` name suffix (bridge.js:290-308, 635) and reports method 'dom' (A). e2e N. | D (V): when no gf the code is by hand: 'choice-by-hand' (bridge.js:859) -> notes only (insertFlow.js:388-395). | same as A (A for frame). |
| C Workspaces | D (V code, A platform) e2e part (fake labels were written to match the code). Exact English label of the control: "Additional comments", "Work notes", "Resolution notes", "Close notes", "Short description" (features/packs/*; bridge.js:616-623). Not found/hidden/two look-alikes = 'no-form' (bridge.js:447,663-666); the panel says "Agent Buddy could not reach a form field on this page" and copies instead (useInsertActions.js:84-88). Insert is still offered because 'unknown' never blocks (fill.js:190; insertFlow.js:222). Text says "Then press Post." (fillable.js:140-142), a button name nobody has checked. | D (V): `closePlan` uses surface AND the page's own `form` answer (prepareClose.js:52-65): code "by hand", notes only. Honest. | D: DOM restore only if the box shows the same text (bridge.js:590-609); Undo stays offered after a save that is not an English-labelled button press (S6). |
| D portals | D (V) e2e Y (fake): comment box found by words, ambiguity refuses, never presses Send (bridge.js:250-263, 428-451; fillable.js:143-144). | D same as C. | D: after the person presses Send the box is empty: Undo answers 'changed' (safe). |
| E | no record, no Insert. | | |
| F | Edge = Chrome. Firefox: rich-text `execCommand('insertText')` path (bridge.js:486) U; e2e Firefox only classic Insert. | | |

### 1.6 Open another record / article / new form / list (same tab or new tab)

| Surface | Record | Article | New form | List |
|---|---|---|---|---|
| A | `nav_to.do?uri=T.do?sys_id=` (openRecord.js:64) | classic FORM | `nav_to.do?uri=T.do?sys_id=-1` always (openRecord.js:71) | `nav_to.do?uri=T_list.do` (mywork/links.js:19; reports/drill.js:21) |
| B | same (A: nav_to redirects into the shell) | same | same | same |
| C record page | `<prefix>/record/T/<id>` with the prefix copied from the current address (openRecord.js:16,62-63; ran) | classic form, leaves Workspace | classic, leaves | classic, leaves |
| C home / list / dashboard (surface 'workspace', no `/record/`) | classic `nav_to.do` (ran: `/now/sow/home`, `/now/sow/list/..`, `/now/nav/ui/home`) | classic | classic | classic |
| D | `<portal>?id=ticket|csm_ticket|..&table=&sys_id=` (openRecord.js:59) | portal `kb_article` page | classic (leaves portal) | classic (leaves portal) |
| Tab used | plain click = `chrome.tabs.update(page.tabId, {url})` (openRecord.js:85-95) from My work (MyWorkView.jsx:49), Knowledge (SearchCard.jsx:32, DuplicatesPanel.jsx:296, GapsPanel.jsx:201), list links (mywork/cards.jsx:52), blank forms (NotesPanel.jsx:317, ResultView.jsx:274, AnswerCard.jsx:394), report drill (reports/drill.js:29). New tab only on the Ticket screen's item links (bits.jsx:88-90, ResolveCard.jsx:101, PrepareClose.jsx:52) and Ctrl/middle click. | | | |

e2e: Y for classic only; the Workspace prefix rule is unit-tested (tests/portal-openrecord.test.js:15-16). Workspace validity of the route for every table is A (audit-6 I9).

### 1.7 My work, Team, command palette

| Feature | Result |
|---|---|
| My work / Team | Page independent in the sense that they need ANY enabled ServiceNow tab, not a record (App.jsx:220-256; sections.js:34-59; reads via content script GET). "Who am I": `g_user`, else `NOW`/Angular scope, else ONE REST "Me" read (content/sessionToken.js:107-147): works on every surface (A on /csm "Me" id and Workspace g_ck, portal.md 8-13). Rows open in the SAME tab (see 1.6). When the active browser tab is not ServiceNow the screens keep the last ServiceNow tab (`lastGood`, sections.js:47) and a click updates THAT background tab with no `active: true` (openRecord.js:90), so nothing visible happens (S12). e2e Y classic (g, s), Y portal (/csm Me). |
| Command palette (Ctrl+K in the panel) | W (V): panel only, page independent; record commands only with a record (App.jsx:193-209). Browser shortcuts Alt+Shift+1/2/3 use PAGE_STATE of the active tab (background/commands.js:56-60). e2e Y (zx); Firefox shortcuts A (firefox.md 8). |

### 1.8 On-page bar and dock

| Surface | Result |
|---|---|
| A | W (V) e2e Y (y, z on the fake classic form). Modal detection looks at the top document and `window.frames.gsft_main` (bar.js:74-92). |
| B | W (A) e2e N: `gsft_main` named access for the modal check; dialogs of Next Experience inside shadow roots are invisible to the script; only the z-index (BAR_Z 1000, barLogic.js:89) protects (quickbar.md 14, A). |
| C | D (A) e2e N: same shadow-DOM blind spot; collisions with a Workspace's own bottom controls unverified (quickbar.md 4, 15, 16). |
| D | W (A) e2e part. E | hidden unless a record is open. |
| F | Chrome/Edge: click opens the panel (A for Edge/headed, quickbar.md 1). Firefox: a dock click cannot open the sidebar; the dock says so and waits 30 s (firefox.md 9, documented, honest). |

### 1.9 Unsaved-change guard, record change in the shell, frames, two records, stale record

| Row | A | B | C | D | Notes |
|---|---|---|---|---|---|
| Unsaved-change guard | S (V): none in code | S | S | S | Same-tab opens (1.6) rely entirely on the page's own "leave site?" prompt (A, not tested anywhere). Insert append never replaces typed text; replace-mode inserts do (with Undo). |
| Detect a record change without reload | W via g_form + form reload (V) | W: top URL changes (A) + g_form | W: URL via pushState, lag <= 2.5 s (A; the fake has NO Workspace navigation) | W (V, e2e Y l-portal: pushState moves between tickets and a list) | UI16 (`nav_to.do` shell) may NOT update the top URL when the iframe moves to a list; then (no g_form on a list) the address still names the previous form (A, S8). |
| Multiple frames with g_form | D (V): first of top, `gsft_main`, any of 20 child frames (bridge.js:60-81); no visibility check, does not compare with the address | same | same (embedded classic frames, hidden tabs) | n/a | e2e N: one `gsft_main` only. audit-2 6.4. |
| Two records in two Workspace tabs | n/a | n/a | Browser tabs: panel follows the active tab, `send(page.tabId)`, `expect` re-checked at click (V, fill.js:38-48). In-app sub-tabs: URL names the active one; inactive boxes are skipped if not rendered visible (bridge.js:329-342, A); two visible equal boxes = refuse (bridge.js:666, V). | n/a | e2e N. |
| Stale record after navigation | W (V) | W | W (lag <= 2.5 s) | W | TicketView keys everything on `table:sysId` (TicketView.jsx:40-47, answers per ticket answers/index.js header), the answer card compares its record with the live page (AnswerCard.jsx:66), Insert re-checks at the click (fill.js:38-48). A screen NOT on show keeps its last page until shown again (App.jsx:214-218): harmless. Lag window shows the old record for <= one poll. e2e Y (j-panel-state, l-portal). |

---------------------------------------------------------------------------------------------------------------------------------
## 2. Where the code assumes the classic form (and what a Workspace gets)

| # | Where | Assumption | On a Workspace |
|---|---|---|---|
| 1 | page/bridge.js:60-81 `resolveFormWindow` | the form is `window.g_form`, `gsft_main`, or some child frame | none found: falls to DOM search by label; or a WRONG child frame wins (S7) |
| 2 | page/bridge.js:741-766 `getFormMeta` | gf gives table/sys_id/number/isNew/loadedAt | null: address only; number empty (audit-1 T1); `loadedAt` empty so the save stamp is the click counter only (content/index.js:119) |
| 3 | page/bridge.js:801-862 `fillField` | field names are columns, `hasField`, `getEditableFields`, `getGlideUIElement(name).type` for HTML fields | name -> English exact label; HTML (article body) goes as plain text into the editor |
| 4 | page/bridge.js:838 choice fields (`close_code`) | `g_form.getOption/setValue` | refused 'choice-by-hand' (honest, by design) |
| 5 | content/index.js:84-93 `newRecordState` | blank form = `g_form.isNewRecord()`; address `sys_id=-1` as second source | URL `/record/<table>/-1` also detected, so Notes-to-ticket "Fill" IS offered; but impact/urgency/contact_type are selects and the DOM chooser only takes text controls (bridge.js:313-323); compose.md 13 says Fill is off there: doc is stale (S15) |
| 6 | content/index.js:95-119 save detection | classic reload = `loadedAt`; Workspace = click on a button labelled exactly Save/Update/Save and close/Resolve/Submit, or Ctrl+S | English labels only; any other label never counted (S6) |
| 7 | lib/fillable.js:138-144 `describeInsert` | default "Then press Save"; Workspace "Then press Post"; portal "page's own Send" | wording is a guess; the real button name is unverified (L7) |
| 8 | lib/fillable.js:223-235 `emailClientTarget` | email form address is `/email_client.do?...` or `nav_to.do?uri=email_client.do..` | the shell-wrapped address is not recognised (ran: null) -> "That field is not on this form" (S10) |
| 9 | sidepanel/openRecord.js:64,71; mywork/links.js:19; reports/drill.js:21; compose/emailRecommend.js:416 | classic `nav_to.do`, `sys_id=-1`, `T_list.do`, `email_client.do` | leave the Workspace (S3) |
| 10 | insights/links.js:29; knowledgeScreen/articleInfo.js:57 | the article reader is `kb_view.do` | fine for sharing, but opening an article goes to the authoring form (S1) |
| 11 | context/kinds.js:273 classic regex | ANY `/name.do` is a table form | (audit-2) unknown tables become "records" |
| 12 | context/surface.js:28 | `*.do` and `/now/nav/ui/classic/` = classic; everything else under `/now/` = workspace | `/now/nav/ui/home` (Polaris home) and `/now/pa/...` are labelled 'workspace' (ran); tests use 'classic' for them (S11) |
| 13 | content/bar.js:74-92 | dialogs are in the top document or in `gsft_main` | shadow-DOM dialogs invisible |
| 14 | content/sessionToken.js:12-32,49-59 | token from `g_ck`, form window, `NOW.g_ck`, Angular header, `sysparm_ck` input or markup regex in top doc + `gsft_main` | `g_ck` on Workspaces is A (L6); failure = "Could not read your ServiceNow session" for every read |
| 15 | content/ops/compose.js:47-66, checks.js:19 | typed text is read from g_form | Rewrite/Check-my-comment: "paste the text"; Ready-to-resolve: three notes boxes |
| 16 | `sys_` prefixed names | none found in any DOM/field rule. All `sys_id`, `sys_journal_field`, `sys_audit`, `sys_user` use is REST, surface independent. The fillable columns are a fixed list (lib/fillable.js:35-58), so a custom `u_` close-notes column is never filled on any surface. V |

What an agent on a Workspace sees that is WRONG because the panel thinks classic (or generic): the ticket number slot shows the table name (audit-1 T1); "open" for anything not a ticket opened from a record page goes to the classic UI; Insert offered with an unverified English label; "Then press Post" unverified; Undo stays offered after a save with another label; an article opens as an editable form; Notes-to-ticket Fill offered on Workspace blank forms whose choices it cannot set.
What a classic or portal agent sees wrong because of Workspace logic: little. `/now/nav/ui/home` counts as 'workspace' (harmless today: only the Post wording and the Save counter use it); the portal agent is told "press the page's own Send" (correct); a portal agent opening a blank form or a list leaves the portal for the classic UI.

---------------------------------------------------------------------------------------------------------------------------------
## 3. Unsaved typing: does a link, a ticket switch or Insert ever replace it?

| Action | Replaces unsaved typing? | Evidence |
|---|---|---|
| Insert, append mode (comments, work notes, description, cause/workaround, email body) | No. Text goes below; only the exact earlier Agent Buddy block is swapped (appendOrSwap) | bridge.js:200-218; V |
| Insert, replace mode: resolution/close/fix/cause notes (default), short description, subject, impact/urgency/channel, close code | YES, whatever is in the box. Said before the click ("Replaces what is in ..."), Undo keeps the old text in memory while the same record is open and not saved | features/packs/core.js:94-97; close.js:67-70; fillable.js:123-128; V |
| Switching ticket in the panel (record change) | No. Per-record state; Insert re-checks the record at the click | TicketView.jsx:40-47; fill.js:38-48; V |
| Plain click on a ticket row in My work | YES at risk: whole tab navigates (a Workspace reloads entirely). No dirty check; depends on the page's own prompt (A) | MyWorkView.jsx:49; openRecord.js:85-95; V code |
| Plain click on a Knowledge result, duplicate, gap row, list link, report drill, blank-form button | same | SearchCard.jsx:32; DuplicatesPanel.jsx:296; GapsPanel.jsx:201; mywork/cards.jsx:52; drill.js:29; NotesPanel.jsx:317; V |
| Ticket screen item links, related-ticket buttons, Ctrl/middle click | No: new tab right after the ticket's tab | bits.jsx:88-90; openRecord.js:101-114; V |
| Undo | No: refuses ('changed') unless the box still holds exactly what the insert left | bridge.js:868-901; V |

---------------------------------------------------------------------------------------------------------------------------------
## 4. Findings

| ID | Sev | Surface | Scenario | file:line | Fix direction | Status |
|---|---|---|---|---|---|---|
| S1 | High | A B C D (owner's complaint) | One article, three views: "Open" = authoring form via `nav_to.do` on classic, Next Experience and Workspace (leaves the Workspace); portal page on a portal; "Copy link" = `kb_view.do` reader on non-portals; on portals the Ticket card copies `?id=kb_article_view&sysparm_article=` but the Knowledge screen copies `?id=kb_article&sysparm_article=` (two functions with the same name). The Knowledge screen opens the article in the SAME tab. Ran for classic, Workspace record/home/list, portals. | sidepanel/openRecord.js:18,59,62-64; insights/links.js:12-33; sidepanel/knowledgeScreen/articleInfo.js:42-59; knowledgeScreen/SearchCard.jsx:32,43,91; ticket/cards/KnowledgeCard.jsx:26-30; RecordLink.jsx:157-163 | One article function (reader by number, same for open and copy), one number pattern; reader in a NEW tab on every surface; keep the form only for an explicit "Edit article". See audit-6 I1-I6, section 5. | V (ran s9-urls.mjs) |
| S2 | High | A B C D | No unsaved-change guard. Nine call sites replace the agent's tab in place with `chrome.tabs.update`; on a Workspace/Next Experience that is a full application reload. Only the Ticket screen's item links open a new tab. Whether the page prompts "Leave site?" on a programmatic navigation of a dirty Workspace form is unknown. | openRecord.js:85-95; mywork/MyWorkView.jsx:49; SearchCard.jsx:32; DuplicatesPanel.jsx:296; GapsPanel.jsx:201; mywork/cards.jsx:52; reports/drill.js:29; compose/NotesPanel.jsx:317; ResultView.jsx:274; AnswerCard.jsx:394 | Default to a new tab whenever a record is open (or the bridge reports dirty: `g_form.modified` on classic; no Workspace equivalent known) and say "opens in a new tab"; keep same-tab for My work only when no record is open. | V code; A page prompt |
| S3 | High | C, and D for blank form/list | Anything opened from a Workspace page that is not a record page (home, list, dashboard, inbox), and every blank form, email form, list and article, goes to the classic UI. Portal agents also leave the portal for a blank form or list. Ran: `/now/sow/home`, `/now/sow/list/..`, `/now/nav/ui/home` give `nav_to.do?uri=incident.do..`. | openRecord.js:62-64,68-75; mywork/links.js:19; reports/drill.js:21; compose/emailRecommend.js:416 | Remember the Workspace prefix from the last record page in the panel (memory only), or open these in a new tab and say so; no silent change of UI. Audit-6 I6. | V (ran) |
| S4 | Medium (highest-impact unknown) | C | Insert needs an exact English label ("Additional comments", "Work notes", "Resolution notes", "Short description"). compose.md 21 itself warns the composer may say "Customer comments". Non-English Workspace languages will never match. Not-found, hidden, collapsed tab and "two look-alikes" all return the same 'no-form'; the panel offers Insert as the main button anyway (state 'unknown' never blocks) and only after the click says "could not reach a form field on this page" and copies. The fake workspace was written with exactly these labels. | page/bridge.js:616-669; features/packs/core.js:94-97 (fieldLabel); lib/fillable.js:35-58; sidepanel/insertFlow.js:217-226; fill.js:190; useInsertActions.js:84-88 | Run L1/L12 first. If labels differ: per-workspace label lists in the packs; match the column name in `name`/`data-field-name` too; give 'no-form' sub-reasons ("open the Notes tab", "two boxes look alike"); do not show Insert as primary when the box was not found. | V code; A platform |
| S5 | Medium | C | The DOM search stops after 25,000 visited elements across the document, every shadow root and every iframe, in document order. A Service Operations Workspace record page with shadow DOM can be larger than that; the composer is typically late in the DOM. Result is 'unknown' / 'no-form', indistinguishable from S4. The fake page has ~20 nodes. | page/bridge.js:277,286 | Count nodes in L2. If near the cap: search only the main region first, prefer visible subtrees, raise the cap with a time budget. | V code; A size |
| S6 | Medium | C, D | Save detection counts only buttons whose label is exactly Save / Update / Save and close / Resolve / Submit and Ctrl+S; a portal is never counted. A Workspace in Arabic or with "Save & Close", "Close incident", "Mark complete", or a keyboard-less autosave never refreshes the header and leaves Undo offered, which then "puts the earlier text back on the form, unsaved". close.md 10 lists it as a question, not fixed. | content/index.js:99-119; lib/fillable.js:371-375; close.md 10 | Also treat a changed record `sys_updated_on` (one tiny read) or a visible "saved" toast as a save; or drop Undo on any click inside the form's action bar. | V code; A labels |
| S7 | Medium | A B C E | `resolveFormWindow` accepts the first of up to 20 child frames with `g_form.getValue`, not only `gsft_main`, and the g_form beats the address. A widget/preview iframe on a home page, or a hidden classic frame inside a Workspace or a second Next Experience tab, makes the panel (and dock, and Insert target) believe in that record. audit-2 traced the `ui_page` home-page case to this path. | page/bridge.js:60-81; content/recordResolver.js:80-84 | Prefer top window then `gsft_main`; accept another frame only when its form's table+sys_id agree with the address, or it is visible and large. e2e: add a second frame. | V code; A which pages have such frames |
| S8 | Medium/Low | A (UI16 `nav_to.do` shell) | If the top address does not follow the iframe (A), moving from a form to a list leaves a stale address naming the previous form; with no g_form on a list, the panel and dock keep showing the previous ticket. Next Experience updates the address, so this is UI16 only. | content/recordResolver.js:85-93; surface.js | L11 decides. If true: when `gsft_main` has no g_form and its own `location` is a list, answer "no record". | A |
| S9 | Medium | A B E vs D | The agent's native reader `kb_view.do?sysparm_article=KB..` (the very link the panel copies) is not a record; the same article on a portal is. The Knowledge tools that need an open article (Article optimise, which needs the article form) do not exist there; the panel says "Open an incident, request, catalog task or case" while the agent is reading an article. | context/kinds.js:273-277 (ran: null); sidepanel/SetupView.jsx:111-129; docs knowledge.md 32 | Parse `kb_view.do` (`sysparm_article`, `sys_kb_id`) as kb_knowledge; say "Open the article form to change it". | V (ran) |
| S10 | Medium | B | The email form opened through the shell (`/now/nav/ui/classic/params/target/email_client.do%3Fsysparm_table..`) is not recognised: Insert subject/body answers 'no-such-field' = "That field is not on this form", which is false. Works for `/email_client.do` and `nav_to.do?uri=email_client.do`. Ran. | lib/fillable.js:223-235; content/fill.js:42 | Unwrap `/params/target/` like kinds.js:260 does. | V (ran s9-email.mjs) |
| S11 | Low | B, tests | `surfaceOf('/now/nav/ui/home')` is 'workspace' (also `/now/pa/..`, Flow Designer, any `/now/..`), but fixtures (tests/mywork-view.test.js:15, tests/screens-rail.test.js:169, tests/reports-links-ui.test.js:30) use surface 'classic' for it: tests prove a state production never produces. | context/surface.js:24-28 | Give Polaris non-workspace pages their own label ('shell') and fix the fixtures. | V (ran) |
| S12 | Low/Medium | A B C D | When the active browser tab is not ServiceNow, the screens keep the last ServiceNow tab and a plain link click updates that tab in the background without activating it: the agent sees nothing happen. | sidepanel/openRecord.js:90; sections.js:47; App.jsx:253 | Pass `active: true` for same-tab opens, or open in a new tab. | V code |
| S13 | Medium | C (B) | Dock hides only for dialogs visible in the top document or `gsft_main`; a Workspace dialog sits in a shadow root so the dock stays over it, protected by z-index 1000 only. Collisions with Workspace bottom controls unverified. | content/bar.js:74-92,484; quickbar.md 4,14-16 | L-checks; walk shadow roots for `[aria-modal]`/`dialog[open]` in the bar (read-only). | A |
| S14 | Medium | C | One composer box that serves both customer comments and work notes: if its label is fixed, an internal note could be inserted while the composer is in customer mode. The safe-to-send review guards `comments` only (`work_notes` is not customer-visible in the table). The panel only says "check it is set to Work notes before you post". | lib/fillable.js:37-38,140-143; page/bridge.js:649-669 | L13. If one element keeps one label in both modes, refuse Insert for journal fields when the mode cannot be read. | A |
| S15 | Low/Medium | C | Notes-to-ticket "Fill the form" is offered on Workspace blank forms (`/record/<table>/-1` is detected), but impact/urgency/channel are choice components; the DOM chooser takes text controls only. compose.md 13 says Fill is off there. | content/index.js:87-93; page/bridge.js:313-323; docs compose.md 13; sidepanel/compose/NotesPanel.jsx:88,259,307 | Mark those three 'choice-by-hand' on pages without g_form, fix the doc. | V code |
| S16 | Low/Medium | C D | "Check my comment" and Rewrite cannot read typed text on Workspace/portal (g_form only), though "Ready to resolve?" reads the same boxes by label. Honest ("paste the text") but inconsistent. | content/ops/compose.js:47-66 vs ops/checks.js:89-108 | Reuse `getBoxValues` for the comment/work-notes/description boxes. | V |
| S17 | Medium | F | Firefox e2e covers `/incident.do` only; Edge has no automated run; Workspace, portal, Next Experience, shadow-DOM iframe and rich-text Insert in Firefox are untested. Named-frame access to a shadow-DOM iframe is a Chrome observation (sessionToken.js:12-14). | e2e/firefox/run.js:152,164; docs edge.md; firefox.md | One L5/L1 walk in Firefox and Edge; add a shadow-DOM iframe page to the fake. | V coverage; A behaviour |
| S18 | Medium | all | The fake instance is the only proof for: g_form semantics (`getEditableFields`, `getOption`, `isNewRecord`), Workspace labels, composer behaviour, portal comment boxes, pushState navigation, document_idle timing. It does NOT model: `/now/nav/ui/classic/..`, shadow-DOM iframe, `/now/cwf|workspace/agent/record`, Workspace SPA navigation or sub-tabs, Save/Post buttons, composer modes, big DOMs, non-English labels, `kb_view.do`, hrsp/custom suffix, any dialog in a shadow root, Firefox/Edge beyond classic. | e2e/fakeInstance.js (header comment; `/now/[a-z-]+/record/`; `/nav_to.do`); e2e/site/workspace.js | See section 6. | V |
| S19 | Low | D | Two implementations of "is this a portal page": `surfaceOf/portalInfo` (excludes api, now, angular, images, scripts, styles, assets) and the bridge's `onPortalPage` (excludes only .do, now, api, angular). They can disagree on a single-segment path with `id=`. | context/surface.js:13-18,38-51; page/bridge.js:236-247 | Share one list. | V |
| S20 | Low | D | A portal action (comment Send) is not noticed: `formStamp` is constant on portals, so the header does not refresh until the Ticket screen is re-shown after 60 s. | content/index.js:99-119,134; sidepanel/ticket/TicketView.jsx header effects | Same as S6. | V |
| S21 | Low | docs | Docs and code disagree: knowledge.md 26 says portal share link is `kb_article`; the Ticket card uses `kb_article_view` (insights.md 15 agrees with code). compose.md 13 says Workspace blank forms are not detected; code detects them. | docs/live-questions/knowledge.md:26; compose.md:13 | Update docs after S1/S15 are decided. | V |
| S22 | Medium | C | The Workspace route is built by copying the current prefix for ANY table (`/now/cwf/agent/record/incident/<id>`, `/now/sow/record/sn_hr_core_case/<id>`). Whether each Workspace opens each table is unknown; a wrong guess opens an error page in the agent's tab. | sidepanel/openRecord.js:16,62-63; tests/portal-openrecord.test.js:15-16 | L14; fall back to classic in a new tab for tables outside the Workspace's own family. | V code; A platform |
| S23 | Low | C | Workspace record changes the address on sub-tab/params changes too; the answer card re-reads field states on every `href` change, each a DOM walk (up to 25k nodes). | sidepanel/ticket/assist/answers/AnswerCard.jsx:87-93 | Key on table+sys_id plus tab, not the whole href. | V |

Surfaces best and worst served
- Best: A classic (g_form path, e2e on a fake that defines its own g_form, every feature wired) and D portals (a dedicated rule set, pushState test, honest "press the page's own Send").
- B Next Experience: same features as A IF the iframe is reachable; the only evidence is one observation and unit tests of the address; no e2e of the real shape.
- Worst: C Workspaces. Every write rests on guessed English labels; record found by address only; number empty; many opens leave the Workspace; no real-instance check for any Workspace claim (security.md limit 4; live-questions say "Unverified" 12+ times).

---------------------------------------------------------------------------------------------------------------------------------
## 5. UNVERIFIED claims that most affect agents/fulfillers, with the one-step real-instance check

Run in an already signed-in tab, DevTools Console, top frame (Workspaces are top-level pages). All snippets print structure (tag names, labels, types, counts), never ticket text. Do not paste ticket text into a bug report.

| # | Claim (where) | One-step check | If wrong |
|---|---|---|---|
| L1 | The Workspace composer and form boxes carry the exact English labels "Additional comments", "Work notes", "Resolution notes", "Short description" (compose.md 21; d-insert; bridge.js:616-669) | On a SOW (and CSM) incident, with the Notes tab visible: `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);if(e.tagName==='TEXTAREA'\|\|(e.tagName==='INPUT'&&(e.type\|\|'text')==='text')\|\|e.getAttribute('contenteditable')!==null)o.push([e.tagName,e.getAttribute('aria-label'),e.name\|\|e.id\|\|'',e.getClientRects().length>0])});return o})(document,[])` then `console.table` it. Is there exactly one visible row per label? | change `fieldLabel` lists in the packs, or match `name`/`data-field-name` too |
| L2 | The 25,000-node search cap is enough (bridge.js:277,286) | `(function c(r){let n=0;r.querySelectorAll('*').forEach(e=>{n++;if(e.shadowRoot)n+=c(e.shadowRoot)});return n})(document)` on a SOW record; compare with 25,000 (iframe documents add to it) | raise cap / smarter search |
| L3 | Every Workspace record page carries `/record/<table>/<sys_id>` | `location.pathname` on: a record opened from a list, from the inbox/side preview, from global search, in a sub-tab, in CSM, HR, Agent Workspace and any scoped Workspace | add the shape to kinds.js:264 |
| L4 | No other frame hijacks the record (S7) | `[...Array(window.length).keys()].map(i=>{try{const f=window.frames[i];return[i,f.location.pathname,typeof f.g_form,f.g_form&&f.g_form.getTableName&&f.g_form.getTableName()]}catch(e){return[i,'cross-origin']}})` on the Polaris home, a Workspace home, a Workspace record, a record with two Next Experience tabs | restrict `resolveFormWindow` |
| L5 | `window.frames['gsft_main']` reaches the classic frame in Next Experience, and in Firefox and Edge too | On `/now/nav/ui/classic/params/target/incident.do..`: `[typeof window.frames['gsft_main'], typeof window.frames['gsft_main'].g_form]`; repeat in Firefox | find the frame another way (iterate frames, shadow-walk) |
| L6 | `g_ck` exists on Workspaces and no `g_form`/`g_user` global does (sessionToken.js; portal.md 12) | `[typeof g_ck, typeof g_user, typeof g_form, typeof NOW]` on a Workspace record | token from markup / NOW |
| L7 | The buttons are called Save/Update/Resolve/Post (fillable.js:140-142; index.js:100) | `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);const t=e.tagName.toLowerCase();if(t==='button'\|\|e.getAttribute('role')==='button'\|\|t.startsWith('now-button'))o.add((e.getAttribute('aria-label')\|\|e.getAttribute('label')\|\|e.textContent\|\|'').replace(/\s+/g,' ').trim().slice(0,40))});return[...o]})(document,new Set())` on a record in each Workspace | fix `SAVE_LABEL_RE` and the "Post" wording |
| L8 | A dirty form asks before the tab is navigated away by the extension (S2) | Type a few words in Work notes (do not save); in the panel click a ticket row in My work (plain click); see whether the page or the browser asks "Leave site?". Do it on classic, Next Experience and a Workspace | add a guard (bridge `g_form.modified` or new tab) |
| L9 | Article views (S1) | As an agent open `https://<inst>/kb_view.do?sysparm_article=<KB number>` and note the final address; open `/nav_to.do?uri=kb_knowledge.do%3Fsys_id%3D<id>`; in a Workspace open the same article from its Knowledge area and read the address | audit-6 section 5 |
| L10 | The email client address on Next Experience (S10) | On a Next Experience incident press the form's Email action; read the address bar (is it `/now/nav/ui/classic/params/target/email_client.do..`?) | unwrap in `emailClientTarget` |
| L11 | UI16 top address follows the iframe (S8) | Where UI16 is still on: open a form via `nav_to.do`, click Incident > All; does the address change? | detect list in `gsft_main` |
| L12 | Labels in a non-English Workspace (Arabic agents) | Set the test user's language to Arabic, rerun L1 and L7 | label sets per language |
| L13 | The composer is one box with two modes, or two boxes (S14) | Rerun L1 with the composer on "Customer comments" and again on "Work notes"; does the visible box's `aria-label` change? | refuse journal Insert when the mode is unreadable |
| L14 | A Workspace opens other tables on its route (S22) | In SOW open `/now/sow/record/sn_customerservice_case/<id>`; in CSM Workspace `/now/cwf/agent/record/incident/<id>`; does a record render? | fall back to classic in a new tab |
| L15 | `kb_view.do` / `/kb?id=kb_article_view` for an agent: is the article a record the panel should read (S9)? | Open both and compare with L9 | parse them |

---------------------------------------------------------------------------------------------------------------------------------
## 6. What the e2e fake instance does and does NOT prove

Proves (against the fake): the Table API is only ever called with GET; the content scripts register and answer in a MAIN/ISOLATED pair; a classic form with a fake g_form is detected and filled (append, replace, undo); a light-DOM `gsft_main` frame is read; a Workspace-style page of nested open-shadow components with exactly the labels the code wants is detected from `/now/<x>/record/<table>/<id>` and filled by label; three portals with pushState navigation, three different ways of telling who is signed in, a comment box found by words; the dock and bar behaviours on the classic fake.

Does NOT prove: anything about the real g_form (`getEditableFields`, `getOption`, `getGlideUIElement`), the real Workspace composer (labels, modes, rich text engine, `Post`), Next Experience (`/now/nav/ui/classic/..`, shadow-DOM iframe), `cwf/agent` and `workspace/agent` routes in a browser, Workspace SPA navigation or sub-tabs, Save/Update clicks on a Workspace, big DOMs (25k cap), non-English labels, `kb_view.do`, hrsp or a custom portal suffix, dialogs in shadow roots, beforeunload behaviour, UI16 address behaviour, Firefox/Edge beyond a classic form, an iframe with another g_form.

Claims that rest only on the fake: Workspace Insert by label (d, t-portal-sections, q); "Ready to resolve?" reads Workspace boxes (q); portal comment-box rule set and "never presses Send" (l); record detection on a Workspace-style page (b); the modal-hiding dock (y); the record-change-without-reload behaviour on portals (l). Pure unit tests (no browser, no fake) carry the address shapes for `cwf/agent`, `workspace/agent`, `/now/nav/ui/classic/..`.

Probe files (scratchpad): s9-urls.mjs, s9-email.mjs.
