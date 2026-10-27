# Portals: what was assumed and how to check it

Area: Service Portal (`/sp`), Employee Center (`/esc`), customer service portal (`/csm`, `/csp`), HR portal (`/hrsp`) and any
portal a customer built. Everything below was built and tested against a FAKE portal (`e2e/site/portal.js`) and against plain
unit tests; none of it has met a real instance. Each question says what was assumed, how a person with only fulfiller roles can
check it in the browser (open the developer tools with F12, then the Console), and what to change if the answer is different.

The console snippets only print attribute names and ids, never ticket text. Do not paste ticket content into a bug report.

## A. Addresses and navigation

1. **Which page ids show one record without a `table` parameter?**
   Assumed: the ticket pages (`ticket`, `standard_ticket`, `csm_ticket`, `hr_ticket`, `form`) always carry `table=` and
   `sys_id=`; a request, requested item or catalog task page may be `?id=sc_request&sys_id=...` (also `sc_req_item`, `sc_task`),
   and an article page `?id=kb_article&sys_id=...`.
   Check: on each portal open a request from "My requests", a requested item, a catalog task and a knowledge article and read the
   address bar. Note `id=` and which of `table`, `sys_id`, `number`, `sysparm_article` are present.
   If wrong: add `<page id>: '<table>'` to `PORTAL_PAGE_TABLES` in `src/context/kinds.js` (one line each) and a case to
   `tests/context-kinds.test.js`.

2. **What do the ticket addresses look like on each portal?**
   Assumed: `/sp?id=ticket&table=incident&sys_id=<32 hex>`, `/esc?id=ticket&table=...&sys_id=...`,
   `/csm?id=csm_ticket&table=sn_customerservice_case&sys_id=...`, `/hrsp?id=hr_ticket&table=sn_hr_core_case&sys_id=...`.
   Check: open one ticket on each portal; compare the address bar.
   If wrong (another parameter name): add the spelling in `portalRef` (`get('sys_id', ...)`) in `src/context/kinds.js`.

3. **Knowledge article addresses: is `sys_kb_id` the ARTICLE's sys_id or the knowledge BASE's?**
   Assumed: unknown, so it is ignored. An article is found from `sys_id=` (page `kb_article`) or from `sysparm_article=KB...`
   (page `kb_article_view`).
   Check: open an article from a search result; read `sysparm_article` and `sys_kb_id`. In the console, open
   `/kb_knowledge.do?sys_id=<sys_kb_id>` in a new tab: an article means `sys_kb_id` is the article.
   If it is the article id: accept it as a sys_id for pages `kb_article_view` in `portalRef`.

4. **Does the address change without a reload, and how?**
   Assumed: the portals change the address with `history.pushState` (query string) and sometimes a hash route (`#/?id=...`);
   `chrome.tabs.onUpdated` reports it, and the panel also polls every 2.5 seconds.
   Check: open a ticket, click "My requests", then another ticket; watch the address bar and the panel. The panel should follow
   within about 3 seconds. Also check whether the page ever flashes the OLD ticket's number while loading the new one.
   If the panel is slow or wrong: the content script reads `location.href` at every request (nothing is cached except
   number to sys_id); the delay is `POLL_MS` in `src/sidepanel/usePage.js`.

5. **Do list or home pages ever carry `table` and `sys_id` (so they would look like a record)?**
   Assumed: no; the page ids in `PORTAL_LIST_PAGES` (`index`, `home`, `my_requests`, `tickets`, `list`, `search`, ...) never parse as a
   record even when a table and sys_id are present.
   Check: browse "My requests", "My approvals", a search result and a list page; look for `sys_id=` in the address.
   If a list page is mistaken for a record: add its page id to `PORTAL_LIST_PAGES`.

6. **Are there portals on their own web address (another host than the instance)?**
   Assumed: they are a different origin and must be turned on separately (the setup help says so). Same-host portals are covered by
   the instance's `https://<host>/*` match.
   Check: look at the address of each portal your fulfillers use.

7. **Is the new Employee Center (or a portal built in UI Builder) served from `/now/...` rather than `/esc?id=...`?**
   Assumed: `/esc?id=...` style. A `/now/<experience>/...` address is treated as a workspace: records are found only when the
   address contains `/record/<table>/<sys_id>`.
   Check: open a ticket in Employee Center; read the whole address.
   If it is another shape: add it to `parseRelative` in `src/context/kinds.js` and to `surfaceOf`/`portalInfo`.

## B. Who is signed in, and the session token (no `g_user`)

8. **Is `g_user` defined on portal pages?** Assumed: often not.
   Check (console): `typeof g_user`.

9. **The `NOW` global.** Assumed: `NOW.user_id`, `NOW.user_name`, `NOW.user_display_name`, or an object `NOW.user` with
   `userID`/`userName`/`firstName`/`lastName`/`roles`.
   Check (console): `Object.keys(window.NOW || {})` and `Object.keys((window.NOW || {}).user || {})`; then
   `typeof NOW.user_id`. Do not print the values.
   If the names differ: add them to `userFromObject` in `src/page/bridge.js` (and a case in `tests/portal-bridge.test.js`).

10. **The Angular root scope.** Assumed: the signed-in user may be at `$rootScope.user` (`sys_id`, `user_name`, `name`).
    Check (console): `Object.keys(angular.element(document.body).injector().get('$rootScope').user || {})`.
    If the user is somewhere else (for example `$rootScope.portal.user` or a page scope), add the path in `portalSessionInfo`.

11. **Roles on a portal page.** Assumed: not available; `roles` is then an empty list. Nothing in the panel depends on roles today.
    Check: is there any list of roles on `NOW.user` or `$rootScope.user`? Same console checks as 9 and 10 (`roles`).

12. **Is the session token on the page?** Assumed: `window.g_ck`; otherwise `NOW.g_ck`, the `X-UserToken` default header of Angular's
    `$http`, or a `g_ck = '...'` / `"g_ck":"..."` in the page markup (`src/content/sessionToken.js`).
    Check (console): `typeof g_ck`; `typeof NOW !== 'undefined' && typeof NOW.g_ck`;
    `typeof angular.element(document.body).injector().get('$http').defaults.headers.common['X-UserToken']`.
    HIGH IMPACT: with no token every read fails with "Could not read the ServiceNow session token". If none of these is a string, find
    where the portal keeps the token (the Network tab shows the `X-UserToken` header on the portal's own `/api/now/...` calls).

13. **The "Me" read.** When the page names no user id, the content script does ONE GET:
    `/api/now/table/sys_user?sysparm_query=sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe&sysparm_fields=sys_id,user_name,name&sysparm_limit=2`
    and believes it only if exactly one row comes back. Assumed: (a) a fulfiller can read their own `sys_user` row (those three
    columns), (b) the dynamic filter "Me" works on the `sys_id` column in a Table API query, (c) `90d1921e5f510100a9ad2572f2b477fe`
    is the sys_id of the "Me" dynamic filter option on every instance.
    Check (console, the page's own token): `fetch('/api/now/table/sys_user?sysparm_query=sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe&sysparm_fields=user_name&sysparm_limit=2', {headers: {'X-UserToken': g_ck, Accept: 'application/json'}}).then(r => r.json()).then(j => console.log(j.result.length))`
    (GET only). It must print 1 and the row must be you. Also open `/sys_filter_option_dynamic_list.do?sysparm_query=label=Me` (if you
    may) and compare the sys_id.
    If it prints more than 1 the filter was ignored (the extension then refuses to believe it and My Day shows its message); if it
    prints 0 or errors, the id or the column is wrong. Alternatives, in this order of preference: query a reference column that
    points at sys_user (for example `task.assigned_to`) with the same filter and read the id from the first row, or read the user name
    from the portal's profile menu and query `user_name=`. Do NOT switch to `javascript:gs.getUserID()` without the security review.

## C. Insert on a portal page

14. **The comment box.** Assumed: a `<textarea>` (or a rich-text area) whose own attributes call it a comment or a reply: `name`, `id`,
    `ng-model`, `aria-label`, a `<label>`, `placeholder`. Customer-visible text goes only into a box whose words include
    `comment(s)`/`reply`, and never into a box that also says `work note`, `internal`, `private`, `search`, `resolution`.
    Check (console, prints attribute names only):
    `[...document.querySelectorAll('textarea,input[type=text],[contenteditable]')].map(e => [e.tagName, e.name, e.id, e.getAttribute('ng-model'), e.placeholder, e.getAttribute('aria-label'), e.offsetParent !== null])`
    on a ticket page of each portal. Is there exactly one visible row that a person would call "the comment box"?
    If it has other words ("Add a message", "Your answer"): add them to `PORTAL_WORDS.comments.is` in `src/page/bridge.js`.

15. **Is the comment box a plain textarea, a rich-text editor, an iframe or in a shadow root?** Assumed: any of them is reached
    (open shadow roots and same-origin frames are walked; an editable area is typed into with the browser's own text insertion).
    Check: in the Elements tab, right-click the box, "Inspect". Is it inside `#shadow-root (open)`, `<iframe>`, or marked
    `contenteditable`? A CLOSED shadow root or a cross-origin frame cannot be reached: Insert then falls back to Copy.
    If a rich-text editor ignores the insertion: look at the panel note after Insert ("The form did not accept the text") and report
    the editor's name.

16. **Does the portal's model follow?** Assumed: the native setter plus `input` and `change` events make Angular's `ngModel` (and a
    React-controlled input) take the value, and the portal's Send button then enables.
    Check: press Insert, then look at the page: does the Send button enable? Press Send yourself and check the comment arrives complete.
    If the box shows the text but Send stays disabled: the box needs another event (for example `keyup`); add it to `fireEvent` calls
    in `fillPortalField`.

17. **Boxes that update on blur.** Assumed: such a box declares `ng-model-options="{updateOn: 'blur'}"`; then `blur` and `focusout` are sent too.
    Check: the box's `ng-model-options` attribute in the Elements tab.

18. **Is there a work-notes box on a portal?** Assumed: only on agent-facing portals (for example `/csm` for agents); labelled
    `work notes` or `internal note`. On the usual customer portals there is none: Insert into work notes then refuses and the panel copies.
    Check: open a ticket as a fulfiller on each portal. Is there a box for internal notes, and what is it called?
    If it has other words: add them to `PORTAL_WORDS.work_notes.is`.

19. **Length limits.** Assumed: `maxlength` on the box if there is a limit; a longer text is refused ("too long") and copied.
    Check: the `maxlength` attribute of the comment box.

20. **Does the portal save or send on `blur`/`change`?** Assumed: no (the extension never focuses a plain textarea and sends `blur` only
    to boxes that update on blur). A rich-text area IS focused to be typed into.
    Check: after Insert, did the comment appear in the activity stream without you pressing Send? It must not.
    If it does: tell the lead at once; the `blur`/`focusout` dispatch and the focus in `writeEditable` are the only candidates.

21. **Are two comment boxes ever visible at once?** (A sticky bar and an inline form.) Assumed: no; if so Insert refuses (ambiguous) and copies.
    Check: scroll a long ticket and see whether a second "Add a comment" box appears.
    If yes and one of them is the right one: name it more precisely in the portal, or prefer the one inside the activity stream (needs a code change; ask).

## D. Frames and registration

22. **Is any ticket page shown inside a frame?** Assumed: no; the scripts run in the top frame only (`allFrames: false`) and the bridge
    reaches same-origin frames from there.
    Check: Elements tab, look for `<iframe>` around the ticket or the comment box; check the frame's address.

23. **Scripts run at `document_idle`; the bridge at `document_start`.** Assumed fine for single-page apps because every answer is
    computed when the panel asks.
    Check: reload a ticket page and open the panel at once: the ticket should appear within about 3 seconds.
