# Links: what was assumed (audit of 2026-11-07, "knowledge articles open sometimes in the native view, sometimes in the portal view")

Area: every address the panel builds or opens: a record, a knowledge article, a list, a blank form, the email form. They all come from
one module, `src/lib/snLinks.js`, so a live answer below is a change to ONE line in that file. The tests that pin the rules are
`tests/links-matrix.test.js` (page x record x audience x intent) and `tests/links-open.test.js` (which tab an address opens in).
This file replaces `insights.md` 13 and 15 and `knowledge.md` 26 (the same facts, asked once).

The rules that were built (nothing here needs ServiceNow to be proven):

- An agent who opens an article and a customer who receives the copied link get the SAME address, on every surface and from every tab:
  `<instance>/kb_view.do?sysparm_article=KB0010001` (by number: it follows the newest published version), or
  `<instance>/kb_view.do?sys_kb_id=<sys_id>` when the article has no usable number. Only the Duplicates screen opens the authoring form
  (`kb_knowledge.do`), because a knowledge manager edits and merges there.
- A ticket stays in the UI the agent works in: the Workspace record route, the portal's ticket page, else the classic form.
- A list, a blank form and the email form are classic pages. A look-at link (a related ticket, an article, a duplicate, a card) opens in
  a NEW tab; a go-work-on-this link (My work, a report drill-down, a list, a blank form) opens in the tab the panel is attached to,
  except that a Workspace or portal tab is never replaced by a classic page: that opens in a new tab beside it.

Console snippets only print addresses and status codes, never ticket text. Run them in an already signed-in tab.

## A. The article reader

1. **`kb_view.do?sysparm_article=` for a person without the classic UI.** Assumed: it opens the article (or sends the person to a
   portal) for an employee or customer who only uses a portal. Nothing found in the platform documentation says it redirects; the
   comment in the old code said so, and was removed.
   Check: sign in (or impersonate on a dev instance) as a plain employee with no roles, paste
   `https://<instance>/kb_view.do?sysparm_article=<a published KB number the person may read>` into the address bar, and note where it
   lands and whether the article text shows. Then, signed in as an agent in the console:
   `for (const u of ['/kb_view.do?sysparm_article=KB0010001','/sp?id=kb_article_view&sysparm_article=KB0010001','/esc?id=kb_article_view&sysparm_article=KB0010001']) { const r = await fetch(u,{credentials:'same-origin'}); console.log(u, r.status, r.redirected, r.url); }`
   (use a real number). If the plain employee is refused or lands on a blank page, the customer link needs the customers' portal:
   that is an owner decision (a per-instance value, the portal suffix and its article page id, as an enterprise-policy key, never a
   button). The change is then in `linkFor`'s article branch (`customerArticleLink` only), and Open and Copy stay one string only if
   the agent's Open follows it.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (kb_view.do does not send the person to a portal here (enable_redirect is false); a user with no roles saw a full article page for two of three articles).

2. **`kb_view.do?sys_kb_id=` takes the article's sys_id.** Assumed: `sys_kb_id` is the sys_id of the article row (one version), as the
   platform's own article widget builds it. Used only when an article has no number. Community posts differ on whether it names the
   article or its knowledge base.
   Check: open `https://<instance>/kb_view.do?sys_kb_id=<sys_id of a kb_knowledge row>` (copy the sys_id from the article form's
   header menu, Copy sys_id) and see whether the article shows.
   If wrong: change the parameter name in `linkFor` (`sys_kb_id`), one place.

3. **An agent with only a portal can open `kb_view.do`.** Assumed: a fulfiller can open platform pages. (A portal-only fulfiller could
   not, the audit's decision D1.)
   Check: as a fulfiller who has no classic UI, open `/kb_view.do?sysparm_article=<number>`.
   If wrong: Open for an agent on a portal needs the portal's article page: add a portal article page id next to `PORTAL_TICKET_PAGES`
   in `snLinks.js`, used by `linkFor` for an agent on a portal; Copy for the customer stays as it is. Open would then no longer equal
   Copy on a portal, so decide that first.

4. **The article number prefixes.** Assumed: `KB`, `KBA` and other prefixes of two to eight letters followed by four to twelve digits
   (`ARTICLE0001234`); anything else is opened by sys_id.
   Check: open any article and read its number; ask the admin whether the `kb_knowledge` number prefix was changed.
   If wrong: change `ARTICLE_NUMBER_RE` in `snLinks.js`.

## B. Tickets on a portal

5. **The portal page that shows a ticket, by kind of table.** Assumed: `ticket` for incidents, requests, requested items, catalog tasks,
   changes, problems; `csm_ticket` for customer service cases (`sn_customerservice_*`, `csm_*`); `hr_ticket` for HR cases (`sn_hr_*`).
   `PORTAL_TICKET_PAGES` and `TABLE_FAMILIES` in `snLinks.js`. (Before, the page id was copied from the page the agent was on, so an
   incident opened from `/csm` asked for `csm_ticket`.)
   Check: on each portal your agents use (`/sp`, `/esc`, `/csm`, `/hrsp`), open one ticket of each kind the portal shows and read the
   address bar: `id=` and `table=`. Then try the address the panel would build: `<portal>?id=<page>&table=<table>&sys_id=<id>` for a
   table of another kind (an incident on `/csm`, a change on `/hrsp`) and see whether the portal shows it or an error.
   If wrong: change the family's page in `PORTAL_TICKET_PAGES`, or add a table pattern to `TABLE_FAMILIES`. One line each.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: the portal pages ticket, sc_request, kb_article and kb_article_view exist; csm_ticket and hr_ticket do not (CSM and HR are not installed on this instance)).

## C. Workspaces

6. **A Workspace opens a record of another table on its record route.** Assumed: only the table on screen and the tables of its family
   open (`/now/sow/record/sc_req_item/<id>` from an incident in the Service Operations Workspace). Any other table, and every address
   away from a record page, opens the classic form in a NEW tab beside the Workspace (audit 9, S22). Nothing about this was checked.
   Check: in each Workspace you use, edit the address of an open record to another table: `/now/sow/record/sc_req_item/<id>`,
   `/now/sow/record/change_request/<id>`, `/now/sow/record/sn_customerservice_case/<id>`; in the CSM Workspace
   `/now/cwf/agent/record/incident/<id>`; in the HR Workspace `/now/hr/agent/record/sn_hr_core_case/<id>` (use real ids). Does a record
   render, or an error page?
   If a table opens: add its pattern to the family of the Workspace, in `TABLE_FAMILIES` (`snLinks.js`), or widen
   `workspaceOpens`. If a whole family fails: tighten the same table.

7. **The classic UI opens for a Workspace-only agent.** Assumed: `/nav_to.do?uri=...`, `/email_client.do` and `/kb_view.do` open for
   an agent who normally lives in a Workspace, because a list, a blank form, an article and the email form have no Workspace
   equivalent here (audit 6, D5).
   Check: as a Workspace-only agent, open `/nav_to.do?uri=incident_list.do` and `/kb_view.do?sysparm_article=<number>` in a new tab.
   If wrong: those links need a Workspace equivalent (unknown) or must say "not available to you".

## D. Where a link opens

8. **A same-tab open of a form with unsaved typing.** The go-work-on-this links (My work rows, a report drill-down, a list, a blank
   form) still replace the tab the panel is attached to when that tab is a classic page. Whether the page asks "Leave site?" for a
   navigation started by the extension is not known (audit 9, L8).
   Check: on a classic form type a few words into Work notes (do not save), then click a ticket row in My work (plain click). Does the
   browser or the page ask before leaving? Repeat in the Next Experience shell.
   If there is no prompt: make My work open in a new tab whenever a record with typed text is on screen (the panel knows it from the
   bridge), or always. The change is the one condition in `openWork` (`src/sidepanel/openRecord.js`).

9. **A new tab placed next to the ticket.** `openInNewTab` places the tab right after the ticket's tab (`openerTabId`, `index`).
   Check in Chrome, Edge and Firefox (and with tab groups) that the new tab opens beside the ticket and in front, and that the panel
   follows the tab in front.
   If the placement fails the tab simply opens at the end (the code falls back); nothing else changes.
