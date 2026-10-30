# The quick-actions bar: what was assumed and how to check it

Area: the bar at the top of a record in the side panel (`src/sidepanel/QuickBar.jsx`) and the small bar on the ServiceNow page
(`src/content/bar.js`, `src/background/bar.js`). Built and tested against the fake instance in `e2e/` (scenarios x, y and z) and against
plain unit tests. In that test Chrome, a real click on the bar opened Chrome's side panel and the panel started the action. None of it
has met a real ServiceNow instance or a headed browser that a person uses. Each question says what was assumed, how to check it as a
person with only fulfiller roles, and what to change if it is different.

## A. Opening the panel from the page

1. **Does a click on the bar open the side panel on a real, headed Chrome and Edge?**
   Assumed: yes. The click's permission to open a panel travels from the content script through the service worker, which asks for the
   panel before it waits for anything (`handleBarMessage`, `src/background/bar.js`). The test browser (Chrome, new headless mode) did open it, and so did installed desktop Chrome in a headed e2e run on 2026-10-30 (`E2E_HEADED=1 node e2e/run.js`, scenario z). Still to check: Edge, and a person clicking by hand.
   Check: on a ticket, open the bar and press "Summarise" with the side panel closed.
   If wrong: the bar already says "Click the Agent Buddy button in your browser toolbar. The action starts in the panel." and the request
   waits 30 seconds for the panel, so the person loses one click, not the action. If a browser never allows it, say so in the bar's tooltip
   and consider offering the bar only where the panel is already open.

2. **Does the panel start the action when it was closed and opens late?**
   Assumed: yes, within 30 seconds of the click (`LAUNCH_TTL_MS` in `src/lib/launch.js`). The panel reads the request when it opens.
   Check: press an action, close the panel at once, open it again from the toolbar button within 30 seconds.
   If wrong: raise the time, or read the request again when the panel's page becomes visible.

3. **Which window does the panel open in when two browser windows hold ServiceNow tabs?**
   Assumed: the window of the tab that was clicked (`chrome.sidePanel.open({ tabId })`), and the request is for that tab, so a panel in
   another window ignores it.
   Check: two windows, a ticket in each; press an action in the second.

## B. How it looks on the real pages

4. **Does the tab collide with something on the real page?** Assumed: a tab at the right edge, 38% down, does not hide anything a
   fulfiller needs. Possible collisions: the Workspace's right-hand contextual panel, the Employee Center and Virtual Agent chat bubble
   (bottom right), the classic UI's right-hand Next Experience tools.
   Check: open a ticket on the classic UI, a Workspace and a portal; look at the right edge, then press "Move to the left".
   If wrong: change the default side or `top` in `src/content/bar.js` (one line each), or default to the left.

5. **Is the bar above or below the page's own dialogs?** Assumed: above everything (`z-index` 2147483647, the maximum, since round 2), so
   a "session expired" or form dialog still has the bar over its backdrop. Something the page puts OVER the bar now makes a click on it
   say "something on the page was covering the bar" and start nothing (the anti-clickjacking rule, `src/content/barLogic.js`). Check:
   open a ServiceNow modal. If the bar looks wrong over a modal, lower the number.

6. **Does a real instance's Content-Security-Policy or Trusted Types setting block the bar's styles?** Assumed: no. The styles are a
   constructed stylesheet (`adoptedStyleSheets`), not an inline `<style>`, and the fake page's strict CSP did not block it.
   Check: the tab appears (a 30 by 60 green tab labelled "AB") on a ticket of each kind of page. If it appears unstyled or not at all,
   open the browser console for a CSP message.

7. **Does a Workspace or portal that rebuilds its page remove the bar?** Assumed: the bar notices within 2 seconds and puts itself back
   (`refresh()` in `src/content/bar.js`). Check: move between tickets in a Workspace without a reload; the tab should stay.

## C. Detecting the record

8. **Does the bar find the record on every surface the panel does?** It uses the same detection as the panel (`resolveRecord` in
   `src/content/index.js`). Check: a classic form, a Workspace record, a portal ticket page, a request, a requested item, a catalog task.
   The bar should offer the actions of that kind (the defaults are in `QUICK_DEFAULTS`, `src/features/quick.js`).

9. **How many reads does the bar add on a Workspace or portal page that has only a record number in its address?** Assumed: one,
   cached (the number is looked up once; a number that found nothing is not asked again for 30 seconds). Check the Network tab filtered
   to `api/now/table` while a Workspace ticket is open and the panel is closed: expect one request per ticket, not one every 2 seconds.

## D. Policy

10. **Does `disablePageBar` remove the bar on a managed browser?** Assumed: yes, within 30 seconds (the bar asks the service worker
    again that often; while it is off it does not look at the page at all) and at once after a page reload. Check: set the key in the managed policy (`docs/deployment.md`), open a ticket.

## E. From the second security audit (`docs/review/security-audit-2.md`)

11. **Does Chrome 116+ / Edge accept `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`?** Check: in the
    service worker's console, `await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})`, then in the ServiceNow
    tab's console (context "Agent Buddy") `await chrome.storage.local.get(null)` must fail. If not: the AI key is still safe (vault or
    session storage); settings and the activity log stay readable by a compromised page process (security.md limit 17).
12. **Does anything on a real classic, Workspace or portal page cover the bar?** The bar would then say "something on the page was
    covering the bar". Check with the page's dialogs, toasts and the Virtual Agent bubble; if a legitimate element does, move the bar
    ("Move to the left") or change its `top`.
13. **Is half a second on screen before a click counts too long for anyone?** A click within 0.5 s of the actions appearing says "Nothing
    was started yet. Click the action again". Watch real people use it; lower `ARM_MS` in `src/content/barLogic.js` if it trips them.
