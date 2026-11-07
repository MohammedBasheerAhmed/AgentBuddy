# Live questions: the record gate (which pages count as a ticket), the form frames, the article reader

Area: audit of 2026-11-07, part 2 ("what Agent Buddy shows on a page that is not a ticket form") and findings S7, S9 and S11 of
part 9. Built without a real instance. The owner's complaint was the panel showing the raw word `ui_page` and "Details are not
available to you." on ServiceNow's home page. Cause (verified by running the project's own code): any `/<name>.do?sys_id=<hex>`,
any portal address with `table=<name>&sys_id=`, and any `g_form` that reported a table and a sys_id was trusted as "a record of
table <name>".

What was built: ONE gate (`isTicketTable`, `src/context/kinds.js`; used by `src/content/recordResolver.js` for a saved record and
for a blank form, by the bar and the shortcuts in `src/background`, by "since you last looked" and by the panel's second look in
`usePage.js`). A page is a ticket record only when its table is one the product knows, or a family it handles (HR, security,
vulnerability, GRC, risk, compliance, audit) or one the organisation's policy names (`sensitiveTablePrefixes`), or is in
`PORTAL_PAGE_TABLES` / `TICKET_TABLES`, or the live form proves it: `g_form.getValue('number')` is not empty. Everything else is
"no record": the plain "Open a ticket" help, no reads of a table named after the page, no bar, nothing stored.

Each question says what was assumed, how a person with only fulfiller roles can check it (F12, then the Console, in the top frame
of the page; nothing below prints ticket text), and what to change if the answer is different.

## A. The owner's home page

1. **Which address, which frame and which `g_form` made the home page say `ui_page`?** The audit could not see the owner's address
   bar. Assumed: either an address like `/ui_page.do?sys_id=<hex>` (or the same wrapped in `/now/nav/ui/classic/params/target/...`),
   or a `g_form` in the top window, in `gsft_main` or in a hidden child frame that reports `ui_page`.
   Check: on the page where `ui_page` shows, `[location.href, typeof g_form, typeof g_form === 'object' && g_form.getTableName && g_form.getTableName(), [...Array(window.length).keys()].map(i => { try { const f = window.frames[i]; return [i, f.location.pathname, typeof f.g_form, f.g_form && f.g_form.getTableName && f.g_form.getTableName(), f.frameElement && f.frameElement.getBoundingClientRect().width] } catch (e) { return [i, 'other origin'] } })]`.
   What it changes: the gate rejects all of these (no number, not a ticket table), so the page shows the plain help whichever it was.
   If the table comes from `gsft_main` or the top window, the frame rule (question 8) did not matter and the number proof did. If
   `g_form.getValue('number')` is NOT empty on that page, the proof is wrong for it: see question 3.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (the classic home page is a UI Page record opened as /ui_page.do?sys_id=<hex> in an inner frame; the old code read it as a record of the table ui_page).

2. **Does a form of a custom task table (`u_*`, `x_*`) report a number?** Assumed: a form of a table that extends `task` has a
   `number` field on its form layout, and `g_form.getValue('number')` is the record's number (also on a blank form).
   Check: on one such form (a customer's own request or task table), `g_form.getValue('number')`.
   If empty (the field is not on the form layout, or the table has no number): the form is not proved. Add the table name to
   `TICKET_TABLES` in `src/context/kinds.js` (one line) and a case in `tests/gate-kinds.test.js`.

3. **Does any form that is not a ticket carry a number?** Assumed: no (a user, a group, a UI page, a script, a report, a catalog item
   and a CI have no `number` column; some contract or asset tables might).
   Check: open a form of each kind an agent opens and run `g_form.getValue('number')`.
   If one has a number (a contract number): the proof is too wide. Make `getFormMeta` in `src/page/bridge.js` also report
   `g_form.hasField('short_description')` and require both in `ticketLike` (`src/content/recordResolver.js`).

4. **Are all tables of the built-in families tasks?** The gate lets the families `sn_hr_`, `sn_si_`, `sn_vul_`, `sn_grc_`,
   `sn_risk_`, `sn_compliance_` and `sn_audit_` through (the product already treats them as sensitive work records, and a Workspace
   page has no `g_form` to prove them). Assumed: the pages an agent opens in these families are tickets or tasks.
   Check: in each application, open a record of a table that is not a ticket (a profile, a policy, a control) and see what the
   Ticket screen says on it.
   If a non-ticket table of a family shows the Ticket screen with "This page is not a ticket.": replace the prefix rule in
   `isTicketTable` by a list of the real task tables.

5. **Do the fulfillers work in other task tables on Workspaces or portals?** Those pages have no `g_form`, so a customer's own task
   table (or Field Service `wm_order`, `wm_task`, Agile `rm_story`...) is not a ticket there until it is listed.
   Check: ask which tables the fulfillers open from a Workspace or a portal; read the table in the address (`/record/<table>/<id>` on
   a Workspace, `table=<table>` on a portal).
   Change: add each to `TICKET_TABLES` (or `PORTAL_PAGE_TABLES` for a portal page without `table=`).

## B. Words for a failed header read

6. **What does the instance answer for a table it does not have, and for a row without ticket columns?** Assumed: HTTP 400 with
   "Invalid table <name>" for a table that does not exist; HTTP 200 with a row whose requested columns are all empty for a table
   that exists but has none of `number`, `short_description`, `state`, `priority`.
   Check: `fetch('/api/now/table/not_a_table?sysparm_limit=1').then(r => r.status)` (expect 400), and
   `fetch('/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=number,short_description,state,priority').then(r => r.json())` (expect
   rows of empty objects, or no `number` at all).
   Change: `MISSING_TABLE` and `headerPhaseFor` in `src/sidepanel/recordHeader.js`. Only a 403 (code `ACCESS_DENIED`) or a record that is
   not visible still says "Details are not available to you."; a table the instance lacks or a row without ticket columns on a table
   that is not a ticket's says "This page is not a ticket."; a lost session or a busy instance says the details could not be loaded.

## C. The form frame (S7)

7. **Which frames exist on the Next Experience home, a Workspace home and a record?** (The audit's L4.)
   Check: `[...Array(window.length).keys()].map(i => { try { const f = window.frames[i]; return [i, f.location.pathname, typeof f.g_form, f.frameElement && f.frameElement.id] } catch (e) { return [i, 'other origin'] } })` on the Polaris home, a Workspace home, a Workspace record and a record in two Next Experience tabs.
   Change: nothing if only `gsft_main` carries a `g_form`. Otherwise the rule below decides what Agent Buddy trusts.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: a Workspace has no frames and the classic home page has one inner frame (/ui_page.do); the Polaris home and a record in two tabs were not looked at).

8. **Is the real form frame always on screen and at least 300 x 200 pixels, or does it hold the record the address names?** Assumed
   by the new rule in `resolveFormWindow` (`src/page/bridge.js`, bridge version 5): the top window and `gsft_main` are trusted as
   before; any other child frame is the form only when it is on screen and form-sized, or its `g_form.getUniqueValue()` appears in
   the address.
   Check: in a Workspace that embeds a classic form in a frame (an unsupported form), `const f = window.frames[0]; [f.frameElement.getBoundingClientRect().width, f.frameElement.getBoundingClientRect().height, f.g_form && f.g_form.getUniqueValue()]`.
   Change: `FORM_FRAME_MIN_WIDTH` and `FORM_FRAME_MIN_HEIGHT` in the bridge; and `tests/gate-bridge.test.js`.

9. **Does a same-origin child frame give its iframe element (`frame.frameElement`) in Chrome, Edge and Firefox?** Assumed: yes for
   same-origin frames, null or an error for another origin.
   Check: `window.frames[0].frameElement` on the Next Experience page in each browser.
   Change: if it is null for the real form frame, only the address rule applies there; relax the size rule.

## D. The article reader (S9)

10. **`kb_view.do?sys_kb_id=` is the article's own id?** Assumed: on the classic reader `sys_kb_id` is the `sys_id` of the
    `kb_knowledge` row (the portal's `sys_kb_id` may be the knowledge base's: the existing portal test says so and is unchanged). The
    number (`sysparm_article=KB0010001`) is used first and is the sure part.
    Check: open an article from search results in the classic UI, copy the address, then
    `fetch('/api/now/table/kb_knowledge?sysparm_query=sys_id=<the sys_kb_id value>&sysparm_fields=number&sysparm_limit=1').then(r => r.json())`.
    Change: if no row comes back, remove the `sys_kb_id` line from `articleReaderRef` in `src/context/kinds.js` and its cases in
    `tests/gate-kinds.test.js`.

11. **Is the reader always `kb_view.do`?** Assumed: `/kb_view.do` (also inside `nav_to.do?uri=` and `/now/nav/ui/classic/params/target/`),
    and `kb_view_customer.do` for the customer view.
    Check: open an article as an agent from the knowledge base, from search and from a ticket's related article, and read the address.
    Change: `ARTICLE_READER_RE` in `src/context/kinds.js`.

## E. The surface of the Next Experience shell (S11)

12. **Does the shell home (`/now/nav/ui/home`) behave like the classic UI for the panel?** Decided: `surfaceOf` says `'classic'` for
    everything under `/now/nav/ui/` (so the three test files that already said `'classic'` for it are right, and a record opened
    from there goes through `nav_to.do`, a form is saved with Save). Assumed: a ticket opened from the shell home through
    `nav_to.do?uri=incident.do?sys_id=...` lands in the same shell on the right ticket, and the Insert wording "press Save" is the
    right one on forms there.
    Check: from the panel's My work tab on the shell home, open a ticket (a plain click), then Insert a work note.
    Change: `isClassicOrWorkspace` in `src/context/surface.js` (give the shell its own label if it needs different wording) and the
    cases in `tests/gate-surface.test.js`.
